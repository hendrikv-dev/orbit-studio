import { useEffect, useRef, useState } from "react";
import {
  addProtocol,
  AttributionControl,
  MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
  type ImageSource,
  type LngLatLike,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { BASEMAP } from "../../../data/tracker/basemapSource";
import { dismissOpenSurfaces } from "../../../data/tracker/dismissable";
import { TERRAIN } from "../../../data/tracker/terrainSource";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from "../../../data/tracker/mapNavigation";
import { subsolarPoint, sunAltitudeAt, twilightBandFor } from "../../../data/tracker/daylight";
import {
  bilinear,
  clearFieldSampler,
  setTileField,
  fieldTileUrl,
  registerFieldProtocol,
  setField,
  type FieldColour,
} from "../../../data/tracker/fieldRaster";
import type { AuroraGrid } from "../../../data/tracker/aurora";
import type { EventOverlay } from "../../../data/tracker/eventOverlay";
import {
  LIGHT_POLLUTION_ATTRIBUTION,
  lightPollutionRamp,
  type LightPollutionArchive,
} from "../../../data/tracker/lightPollution";

/**
 * The map, as an actual map.
 *
 * ## What this replaces, and why
 *
 * The version before this projected Natural Earth outlines onto a fixed
 * equirectangular viewBox and panned by moving it. It worked, and it was the
 * wrong thing to keep building: at any zoom useful for choosing an observing
 * site it showed coastlines and nothing else — no roads, no villages, no
 * terrain — so the reader could see *that* somewhere was dark without being
 * able to tell whether it was reachable. Hand-building the rest of that is
 * rebuilding a renderer other people maintain.
 *
 * MapLibre owns the projection, the tiling, the label placement and the input
 * handling now. What is left here is Tracker's own: the palette, the night, the
 * pin, and the coupling to the history model.
 *
 * ## The tiles are a separate decision
 *
 * Nothing in this file names a tile server. `basemapSource.ts` does, once, and
 * explains why the current one is temporary and what replaces it. This
 * component works the same either way, which is the point.
 *
 * ## The palette is applied, not hard-coded
 *
 * Rather than repainting a list of known layer ids — which binds us to one
 * style's naming and breaks silently on the switch to our own — the style's
 * layers are walked after load and adjusted by role. A basemap Tracker draws on
 * has to recede: the astronomy is the figure and the geography is the ground,
 * and a general-purpose dark style is still tuned to be the figure itself.
 */

/**
 * Tell MapLibre where its own worker went.
 *
 * Left alone, it resolves the worker as `./maplibre-gl-worker.mjs` relative to
 * whichever module is running — which is true in `node_modules` and false in a
 * build, where the bundle lives in a hashed asset directory the worker was
 * never copied into. The worker then 404s, and because every failure it causes
 * is a *silence* rather than an error, the result is a map that draws its
 * background, reports no problem, and never finishes loading anything.
 *
 * `?worker&url` is the combination that works. Plain `?url` copies the one file
 * and nothing else, and MapLibre's worker imports a sibling chunk — so it
 * spawned, fetched, failed to resolve that import and closed again within a
 * frame, leaving every source waiting on a worker that was no longer there.
 * `?worker` bundles the worker with its dependencies; `&url` hands back the
 * address rather than a constructor, which is what MapLibre wants.
 *
 * Done at module scope because the setting has to be in place before any map is
 * constructed.
 */
setWorkerUrl(maplibreWorkerUrl);

/**
 * Tracker's own tile scheme, for the fields it draws over the geography.
 *
 * Registered once at module scope, beside the worker, because both have to be
 * in place before any map is constructed.
 */
registerFieldProtocol(addProtocol as never);

export interface MapPoint {
  latitudeDeg: number;
  longitudeDeg: number;
}

interface Props {
  centre: MapPoint;
  zoom: number;
  /** Looking around. The caller decides this replaces rather than pushes. */
  onMove: (centre: MapPoint, zoom: number) => void;
  /** A decision: this is the place now. No confirmation step. */
  onPick: (point: MapPoint) => void;
  pin: MapPoint | null;
  /**
   * Which way to face for the event the reader has open, in degrees from north.
   *
   * Null whenever there is no such direction — nothing open, the object below
   * the horizon, or a meteor shower, whose meteors arrive over the whole sky.
   */
  bearingDeg?: number | null;
  /** What to call the selected point, beside the target. Null while unknown. */
  pinLabel: string | null;
  /** When to draw the night for, or null to leave the map undarkened. */
  daylightAt: Date | null;
  /** NOAA's aurora nowcast, drawn when the aurora layer is on. */
  auroraGrid: AuroraGrid | null;
  /** The vendored VIIRS composite, once it has decoded. */
  lightPollution: LightPollutionArchive | null;
  /**
   * Which environment layers are on.
   *
   * A set, not one value: these describe the place, several of them can be true
   * at once, and that is the whole difference between them and the event
   * overlay below.
   */
  layers: ReadonlySet<string>;
  /**
   * The selected event's geography, or null when no event is selected.
   *
   * Deliberately a separate prop rather than another member of `layers`. It is
   * not a persistent property of anywhere: it belongs to one event, it changes
   * when the event changes, and it goes away when the reader stops looking at
   * that event. Turning off clouds must not touch it.
   */
  eventOverlay: EventOverlay | null;
  label: string;
}

/** Ink for the geography, chosen so the target and an overlay read on top. */
const INK = {
  /** Near-navy, and lighter than the land so rivers and coasts read. */
  water: "#101c33",
  waterLine: "#16294a",
  land: "#0e1219",
  green: "#131c1c",
  building: "#161b26",
  road: "#242b3b",
  roadMajor: "#333c50",
  boundary: "#39415a",
  label: "#9fadc6",
  labelFaint: "#7c89a3",
  labelHalo: "#05070c",
} as const;

export function TrackerMapCanvas({
  centre,
  zoom,
  onMove,
  onPick,
  pin,
  pinLabel,
  bearingDeg = null,
  daylightAt,
  auroraGrid,
  lightPollution,
  layers,
  eventOverlay,
  label,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  /** Which map instance the marker above is attached to. */
  const markerEpoch = useRef(-1);
  /**
   * True while the camera is being driven by us rather than by the reader.
   *
   * MapLibre fires the same `moveend` for both, and reporting a programmatic
   * move back to the history hook would write the state we just read — a loop
   * that shows up as the map refusing to sit still after a Back.
   */
  const programmatic = useRef(false);
  const [failed, setFailed] = useState(false);
  /**
   * Which map instance is live, and whether it is ready for layers.
   *
   * A counter rather than a boolean, because everything attached to the map —
   * the night, the pin — has to be reattached when the instance is replaced,
   * and a flag that is already `true` cannot say "a different map now". React
   * replaces the instance on every remount, which StrictMode does on purpose
   * in development: with a boolean the marker stayed bound to the map that had
   * just been destroyed, so the pin silently stopped appearing.
   *
   * Distinct from `settled`, which asks whether the map has stopped working
   * rather than whether it exists. Keying the night on `settled` made them
   * circular: adding the night starts a data load, a data load un-settles the
   * map, and an un-settled map re-ran the effect that added the night.
   */
  const [epoch, setEpoch] = useState(0);
  const [settled, setSettled] = useState(false);
  /**
   * The current callbacks, read by listeners that were attached once.
   *
   * Assigned during render rather than in an effect so that a click arriving
   * before the effect flushes still reaches this render's handler.
   */
  const handlers = useRef({ onMove, onPick });
  handlers.current = { onMove, onPick };

  useEffect(() => {
    if (!host.current || map.current) return;

    const instance = new MapLibreMap({
      container: host.current,
      style: BASEMAP.styleUrl,
      center: [centre.longitudeDeg, centre.latitudeDeg],
      zoom,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      // Tracker's questions are all "where on the ground": tilting and turning
      // the map answers none of them and makes the night harder to read.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
      /**
       * Many worlds, so east and west never end.
       *
       * The Pacific is one place, and a map that stops at the antimeridian cuts
       * it in half and makes you drag all the way back around to see the other
       * side. Repeated copies are what every map people already know does.
       *
       * Two things have to hold for it to be honest rather than merely
       * scrollable, and both are handled here rather than by switching it off:
       * everything Tracker draws over the geography is emitted in the copies
       * either side as well, so a repeated world is never lit where the real
       * one is dark; and a click on any copy is wrapped back to the one
       * longitude that names that place before it becomes state.
       */
      renderWorldCopies: true,
      attributionControl: false,
    });
    instance.touchZoomRotate.disableRotation();
    map.current = instance;
    /**
     * The verification harness's handle on the camera.
     *
     * `scripts/verify/tracker-refinement.mjs` asks the map directly whether it
     * is still moving after a world-wrap pan, because the regression it guards
     * — a camera that re-clamps every frame and so never comes to rest — is a
     * question about the camera and cannot be answered from the DOM. There is
     * no other route to a MapLibre instance from outside React.
     *
     * Deliberate and named, not a leftover: it was briefly deleted as debug
     * scaffolding and took the refinement gate with it.
     */
    (window as unknown as { __trackerMap?: MapLibreMap }).__trackerMap = instance;

    instance.addControl(
      // No `customAttribution`: the style and every source we add carry their
      // own credit, and restating OpenFreeMap/OpenMapTiles/OSM here printed the
      // same three names twice in one line.
      new AttributionControl({ compact: true }),
      "bottom-right",
    );

    /**
     * `style.load`, not `load`.
     *
     * MapLibre's `load` fires after the first *visually complete* render, which
     * means it waits for every tile in the opening viewport. Recolouring the
     * style needs none of that — the layers exist the moment the style JSON is
     * parsed — and hanging it off `load` made the palette depend on the tile
     * server's mood.
     *
     * The failure was not subtle and did not look like a failure. OpenFreeMap's
     * own dark style paints land #0c0c0c and water #1b1b1d, six percent apart;
     * Tracker's palette is what separates them, by painting water *lighter*
     * than the land. So whenever the opening view needed more tiles than the
     * server felt like serving — a whole continent at low zoom, which is
     * exactly what fitting an eclipse path asks for — `load` never fired, the
     * recolour never ran, and the map rendered as a uniform near-black
     * rectangle: no coastline, no rivers, no hillshade, and no error anywhere.
     *
     * This is the same lesson as the settled signal a few lines down. Anything
     * gated on a third party finishing will, sooner or later, not happen.
     */
    instance.on("style.load", () => {
      recolour(instance);
      addHillshade(instance);
      setEpoch((n) => n + 1);
      setSettled(true);
    });

    /**
     * Make the renderer's idea of its own size match the box it is in.
     *
     * MapLibre measures the container once, in its constructor, and falls back
     * to 400×300 when that measurement comes back empty. Under React the
     * element is in the document by the time the effect runs but has not
     * necessarily been laid out, so the fallback is what it keeps — a map that
     * paints a quarter of its container and never settles.
     *
     * The observer is not belt-and-braces for that first call: it is also what
     * keeps the map correct when the mobile sheet expands and when the window
     * changes shape.
     */
    const watchSize = new ResizeObserver(() => instance.resize());
    watchSize.observe(host.current);

    // A tile source that will not load is a real state, not a blank rectangle
    // with no explanation. The controls and the search still work without it.
    instance.on("error", (event) => {
      if (event?.error && "status" in event.error) setFailed(true);
    });

    /**
     * Settled means the camera has come to rest, not that every source is done.
     *
     * MapLibre's `idle` is the honest signal when it arrives: camera still and
     * all tiles drawn. But it waits on *every* source, including the terrain
     * DEM, which comes from a rate-limited public service — and when that
     * service throttles, its source never reports loaded, `idle` never fires,
     * and the map is pinned "unsettled" forever. Everything downstream that
     * waits for this flag then waits for a third party's goodwill: the terrain
     * card, and every automated check of our own camera behaviour.
     *
     * So `idle` still marks it settled, and a bounded fallback marks it settled
     * anyway once the camera has been still for a moment. A map whose relief
     * has not arrived is a map that is missing some shading; it is not a map
     * that is still moving, and it should not claim to be.
     */
    let restTimer: number | undefined;
    const settleWhenStill = () => {
      window.clearTimeout(restTimer);
      restTimer = window.setTimeout(() => {
        if (!instance.isMoving() && !instance.isZooming() && !instance.isRotating()) {
          setSettled(true);
        }
      }, 2_500);
    };

    instance.on("movestart", () => {
      window.clearTimeout(restTimer);
      setSettled(false);
    });
    instance.on("dataloading", () => {
      setSettled(false);
      settleWhenStill();
    });
    instance.on("moveend", settleWhenStill);
    instance.on("idle", () => {
      window.clearTimeout(restTimer);
      setSettled(true);
    });

    instance.on("moveend", () => {
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      const next = instance.getCenter();
      handlers.current.onMove(
        { latitudeDeg: next.lat, longitudeDeg: next.lng },
        instance.getZoom(),
      );
    });

    instance.on("click", (event) => {
      /**
       * The first click outside an open menu dismisses it, and does nothing
       * else. Without this, closing the event finder by clicking the map also
       * moved the reader's observing location — dismissing a menu threw away
       * the place they had chosen.
       */
      if (dismissOpenSurfaces()) return;
      handlers.current.onPick({
        latitudeDeg: event.lngLat.lat,
        longitudeDeg: event.lngLat.wrap().lng,
      });
    });

    return () => {
      watchSize.disconnect();
      instance.remove();
      map.current = null;
      const global = window as unknown as { __trackerMap?: MapLibreMap };
      if (global.__trackerMap === instance) delete global.__trackerMap;
    };
    // Built once. The handlers read refs and props through closures that are
    // replaced below, so re-running this would tear down a live map for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Follow the history model when it moves the camera from outside. */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const at = instance.getCenter();
    const movedFar =
      Math.abs(at.lat - centre.latitudeDeg) > 1e-4 ||
      Math.abs(at.lng - centre.longitudeDeg) > 1e-4 ||
      Math.abs(instance.getZoom() - zoom) > 1e-3;
    if (!movedFar) return;
    programmatic.current = true;
    const target: LngLatLike = [centre.longitudeDeg, centre.latitudeDeg];
    // Far jumps get the flight, small corrections get an ease: a search result
    // across the world should read as travel, a nudge should not.
    const km = distanceKm(at.lat, at.lng, centre.latitudeDeg, centre.longitudeDeg);
    if (km > 400) instance.flyTo({ center: target, zoom, duration: 900, essential: true });
    else instance.easeTo({ center: target, zoom, duration: 360, essential: true });
  }, [centre.latitudeDeg, centre.longitudeDeg, zoom]);

  /** The pin, as a marker the renderer keeps in place for us. */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    // A marker left over from a previous instance is attached to a map that no
    // longer exists; rebuilding is the only way to get it onto this one.
    if (marker.current && markerEpoch.current !== epoch) {
      marker.current.remove();
      marker.current = null;
    }
    if (!marker.current) {
      const element = document.createElement("div");
      /**
       * A target, not a pin.
       *
       * A teardrop says "there is something here" and points at a spot below
       * itself; concentric rings around a centre dot say "this exact point is
       * selected", which is the only thing this marker is for. It also sits on
       * the coordinate rather than above it, so nothing is hidden by it and the
       * geography underneath stays readable.
       */
      element.className = "tk-map-target";
      element.innerHTML =
        '<span class="tk-map-target-glow"></span>' +
        '<span class="tk-map-target-ring"></span>' +
        '<span class="tk-map-target-dot"></span>' +
        // The name belongs *on* the map, next to the point it names. Without it
        // the target says "somewhere is selected" and the panel says which
        // place, and joining the two is left to the reader.
        '<span class="tk-map-target-label"></span>' +
        // Which way to face, drawn from the point the reader is standing on.
        '<span class="tk-map-target-bearing" aria-hidden="true"></span>';
      marker.current = new Marker({ element, anchor: "center" });
      markerEpoch.current = epoch;
      marker.current.setLngLat([pin.longitudeDeg, pin.latitudeDeg]).addTo(instance);
      pulse(element);
      return;
    }
    marker.current.setLngLat([pin.longitudeDeg, pin.latitudeDeg]);
    // Landing somewhere new is acknowledged where the reader is looking, which
    // is the point they just clicked rather than the panel that opens later.
    pulse(marker.current.getElement());
  }, [pin?.latitudeDeg, pin?.longitudeDeg, epoch]);

  /** The name, once it resolves — separately, so the target lands immediately. */
  useEffect(() => {
    const element = marker.current?.getElement().querySelector(".tk-map-target-label");
    if (element) element.textContent = pinLabel ?? "";
  }, [pinLabel, pin?.latitudeDeg, pin?.longitudeDeg, epoch]);

  /**
   * The direction to face, as a wedge on the pin.
   *
   * Screen space, not geography, and that is the point. A ray drawn on the
   * ground would have a length, and a length on a map is a distance — it would
   * say the planet is forty kilometres to the south-west, which is not a thing
   * anyone should be told. A fixed-size wedge that fades out says only "this
   * way", stays the same size at every zoom, and never lands on a place.
   *
   * A plain CSS rotation is the bearing because the map's own bearing is always
   * zero: rotation is disabled, north is up, and screen-up is north.
   */
  useEffect(() => {
    const element = marker.current
      ?.getElement()
      .querySelector<HTMLElement>(".tk-map-target-bearing");
    if (!element) return;
    if (bearingDeg === null || !Number.isFinite(bearingDeg)) {
      element.dataset.on = "false";
      return;
    }
    element.dataset.on = "true";
    element.style.setProperty("--tk-bearing", `${bearingDeg}deg`);
  }, [bearingDeg, pin?.latitudeDeg, pin?.longitudeDeg, epoch]);

  /**
   * Twilight, as geography rather than a filter over the whole page.
   *
   * Guarded on `epoch` rather than on `isStyleLoaded()`. The two sound
   * interchangeable and are not: `isStyleLoaded` is false whenever *any* source
   * is still fetching, which includes ordinary tile loading, so an overlay
   * whose data arrived during a pan was dropped and — since neither the data
   * nor the epoch changed again — never drawn at all. `epoch` asks the question
   * that actually matters, which is whether this map has finished loading its
   * style once and can therefore accept layers.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || epoch === 0) return;
    if (!daylightAt || !layers.has("twilight")) {
      clearField(instance, TWILIGHT_ID);
      return;
    }
    drawTwilight(instance, daylightAt);
  }, [daylightAt?.getTime(), layers, epoch]);

  /** Where the aurora is likely to be visible from, as a field. */
  useEffect(() => {
    const instance = map.current;
    if (!instance || epoch === 0) return;
    if (!auroraGrid || !layers.has("aurora")) {
      clearField(instance, AURORA_ID);
      return;
    }
    drawAurora(instance, auroraGrid);
  }, [auroraGrid, layers, epoch]);

  /**
   * Artificial light on the ground.
   *
   * The one layer that describes the place rather than the night — it does not
   * change with the date, only with where the reader is standing — but it draws
   * through the same field pipeline as the others, so switching it on has the
   * same cost and the same wrapping behaviour across the antimeridian.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || epoch === 0) return;
    if (!lightPollution || !layers.has("light-pollution")) {
      clearField(instance, LIGHT_ID);
      return;
    }
    drawLightPollution(instance, lightPollution);
  }, [lightPollution, layers, epoch]);

  /**
   * The selected event's own geography, in whatever shape it actually has.
   *
   * Its own effect, not a branch of the layer effect above, because it is not a
   * layer: it belongs to one event rather than to the place, and turning the
   * cloud layer off must not touch it.
   */
  useEffect(() => {
    const instance = map.current;
    if (!instance || epoch === 0) return;
    if (!eventOverlay) {
      clearEventOverlay(instance);
      return;
    }
    drawEventOverlay(instance, eventOverlay);
  }, [eventOverlay, epoch]);

  return (
    <div className="tk-map-canvas" data-map-settled={settled ? "true" : "false"}>
      <div
        ref={host}
        className="tk-map-surface"
        role="application"
        aria-label={label}
        tabIndex={0}
      />
      {failed ? (
        <p className="tk-map-basemap-failed" role="status">
          Basemap unavailable. Search still works, and everything about the sky is unaffected.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One short acknowledgement that the selection landed.
 *
 * Honoured rather than assumed: `prefers-reduced-motion` exists because motion
 * makes some people ill, and a pulse that draws the eye is exactly the kind
 * that does.
 */
function pulse(element: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(
    [
      { transform: "scale(0.55)", opacity: 0.2 },
      { transform: "scale(1.12)", opacity: 1, offset: 0.65 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: 420, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" },
  );
}


/**
 * Push the basemap back so Tracker's own drawing reads on top of it.
 *
 * By role rather than by layer id. A style is free to call its motorways
 * anything, and the switch to a basemap we host ourselves will rename most of
 * them; what does not change is that a line in the transportation source-layer
 * is a road and should be dim, and that a symbol is a label and should stay
 * legible. Both OpenMapTiles' names and Protomaps' are matched, so the cutover
 * does not take the palette with it.
 */
function recolour(instance: MapLibreMap) {
  const layers = instance.getStyle().layers ?? [];
  for (const layer of layers) {
    const id = layer.id;
    const source = "source-layer" in layer ? String(layer["source-layer"] ?? "") : "";
    // The property names are decided by the layer's own type, which is not
    // something the compiler can follow through a loop over a whole style.
    const paint = (property: string, value: unknown) => {
      try {
        instance.setPaintProperty(id, property as never, value as never);
      } catch {
        // A style is allowed not to have a property this tries to set.
      }
    };
    const layout = (property: string, value: unknown) => {
      try {
        instance.setLayoutProperty(id, property as never, value as never);
      } catch {
        /* as above */
      }
    };

    const isWater = source === "water" || source === "waterway" || /water|ocean|sea|lake|river/i.test(id);
    const isGreen = source === "landcover" || source === "landuse" || source === "park" || /wood|forest|park|landcover|landuse/i.test(id);
    const isBoundary = source === "boundary" || /boundary|admin|border/i.test(id);
    const isBuilding = source === "building" || /building/i.test(id);
    const isMotorway = /motorway|trunk|highway_major|primary/i.test(id);

    if (layer.type === "background") {
      paint("background-color", INK.land);
    } else if (layer.type === "fill") {
      if (isWater) {
        // Navy, and deliberately *lighter* than the land rather than darker.
        // Drawn a shade below it, the Columbia disappeared into its own valley
        // and the map lost the feature that orients everybody local.
        paint("fill-color", INK.water);
        paint("fill-opacity", 1);
      } else if (isBuilding) {
        paint("fill-color", INK.building);
        paint("fill-opacity", 0.45);
      } else if (isGreen) {
        paint("fill-color", INK.green);
        paint("fill-opacity", 0.5);
      } else {
        paint("fill-color", INK.land);
      }
    } else if (layer.type === "line") {
      if (isWater) {
        paint("line-color", INK.waterLine);
        paint("line-opacity", 0.9);
      } else if (isBoundary) {
        paint("line-color", INK.boundary);
        paint("line-opacity", 0.5);
      } else {
        paint("line-color", isMotorway ? INK.roadMajor : INK.road);
        paint("line-opacity", isMotorway ? 0.9 : 0.62);
      }
    } else if (layer.type === "symbol") {
      /**
       * Place names in the case people write them in.
       *
       * The style sets every place label to uppercase, which is a reasonable
       * house style and the wrong one here: at a regional scale the map is a
       * list of towns, and a column of shouted capitals flattens the hierarchy
       * the style went to the trouble of building.
       */
      if (source === "place") layout("text-transform", "none");
      paint("text-color", /country|state/i.test(id) ? INK.labelFaint : INK.label);
      paint("text-halo-color", INK.labelHalo);
      paint("text-halo-width", 1.5);
      paint("text-halo-blur", 0.4);
      if (source === "transportation_name") paint("text-color", INK.labelFaint);
    } else if (layer.type === "raster") {
      /**
       * Shaded relief, kept rather than switched off.
       *
       * Where the hills are decides what an observer can see: a ridge to the
       * south is the difference between Saturn at thirty degrees and Saturn
       * behind a hill. Held well below the labels so it reads as ground rather
       * than as content, but emphatically present.
       */
      paint("raster-opacity", 0.5);
      paint("raster-saturation", -0.55);
      paint("raster-contrast", 0.15);
      paint("raster-brightness-max", 0.5);
    }
  }
}

/* --------------------------------------------------------------- hillshade */

const HILLSHADE_SOURCE = "tracker-terrain-dem";

/**
 * Relief, from the same DEM the horizon analysis reads.
 *
 * ## Why the map needed it
 *
 * The basemap carried a shaded-relief raster from the style, and at the zooms
 * Tracker works at it was close to invisible — the map read as a street plan
 * floating in space. Where the hills are is not decoration for an observing
 * product: a ridge to the south is the difference between a target at thirty
 * degrees and a target behind a hill, and a reader choosing between two valleys
 * should be able to see that they are valleys.
 *
 * ## Why it stays restrained
 *
 * This is not a terrain viewer. The shading is low-contrast, sits under every
 * label and every overlay, and is drawn without exaggeration or 3D — the map
 * has to stay a dark, calm surface that Tracker's own drawing reads on top of.
 * Legibility of the geography, not drama.
 */
function addHillshade(instance: MapLibreMap) {
  if (instance.getSource(HILLSHADE_SOURCE)) return;
  try {
    instance.addSource(HILLSHADE_SOURCE, {
      type: "raster-dem",
      url: TERRAIN.tileJsonUrl,
      // Mapterhorn publishes Terrarium; saying so explicitly means a TileJSON
      // that ever stops carrying the field cannot silently decode as Mapbox's.
      encoding: "terrarium",
      tileSize: TERRAIN.tileSize,
      // Overrides the TileJSON's terse "© Mapterhorn": the elevation is not
      // Mapterhorn's own survey, and the agencies that flew it should be named
      // on the map that draws it.
      attribution: TERRAIN.attribution,
    });
    // Above the land and water fills, below everything Tracker draws and below
    // every label — relief is ground, not content.
    const firstSymbol = instance.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
    instance.addLayer(
      {
        id: "tracker-hillshade",
        type: "hillshade",
        source: HILLSHADE_SOURCE,
        /**
         * Not drawn at world scale.
         *
         * Below about zoom 6 a hillshade is texture rather than information —
         * no one chooses an observing site by looking at a continent — and it
         * is expensive texture: the terrain service is rate-limited, and a
         * world-scale view asks it for tiles across every visible landmass. A
         * measured pan across the antimeridian took ten seconds to finish
         * streaming relief that told the reader nothing.
         *
         * Six is where a ridge line starts to mean "that hill is between me and
         * the target", which is the only reason this layer exists.
         */
        minzoom: 6,
        paint: {
          /**
           * Half, not a third.
           *
           * This shipped at 0.32, which was tuned against Mount Hood — 2,500 m
           * of relief will read at almost any setting. Checked afterwards
           * against the Santa Lucia range behind Big Sur, terrain of the kind
           * most observing sites actually sit in, 0.32 rendered the coast
           * almost flat: the ridge that decides whether a target clears the
           * horizon was invisible on the map that is supposed to show it.
           *
           * Measured across both sites, 0.5 raises the land's tonal spread from
           * about 12 to about 19 levels and leaves the two looking like the
           * same map. It is still restrained — no exaggerated 3D, low contrast,
           * drawn under every label — but moderate terrain is now legible,
           * which is the only reason the layer exists.
           */
          "hillshade-exaggeration": 0.5,
          "hillshade-shadow-color": "#000308",
          "hillshade-highlight-color": "#5c6f92",
          "hillshade-accent-color": "#0d1422",
          // North-west, the cartographic convention: relief lit from anywhere
          // else reads as holes rather than hills to most people.
          "hillshade-illumination-direction": 315,
          "hillshade-illumination-anchor": "map",
        },
      },
      firstSymbol,
    );
  } catch {
    // A terrain service that will not answer costs the map its relief and
    // nothing else. The analytical path fetches its own tiles regardless.
  }
}

/* ---------------------------------------------------------------- overlays */

/**
 * Every overlay is one image source, repeated across the world copies.
 *
 * ## Why images
 *
 * These are continuous fields sampled on coarse grids. As polygons they are
 * tens of thousands of features with hard edges the underlying quantities do
 * not have; as one texture each they cost a single upload and the renderer
 * scales them for free.
 *
 * ## Why three copies
 *
 * MapLibre repeats *tiled* sources across world copies and does not repeat an
 * image source, so an overlay drawn once ended at a dead-straight vertical edge
 * one world away — which is what the rectangular boundary in the review was.
 * Three sources, at −360, 0 and +360, cover every copy a reader can reach
 * before the renderer stops drawing them at all.
 */
/**
 * Add or update one field overlay, as raster tiles.
 *
 * The source is replaced rather than mutated when the data changes: a raster
 * source's tiles are cached by URL, so a new version in the template is what
 * makes the renderer fetch the new field instead of redrawing the old one.
 */
function paintField(
  instance: MapLibreMap,
  id: string,
  sample: (latitudeDeg: number, longitudeDeg: number) => FieldColour,
  opacity: number,
  maxzoom = 5,
) {
  const version = setField(id, sample);
  attachField(instance, id, version, opacity, maxzoom);
}

/** The raster source and layer a field is drawn through, however it renders. */
function attachField(
  instance: MapLibreMap,
  id: string,
  version: number,
  opacity: number,
  maxzoom: number,
  attribution?: string,
) {
  clearField(instance, id, { keepSampler: true });
  const firstSymbol = instance.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
  instance.addSource(id, {
    type: "raster",
    tiles: [fieldTileUrl(id, version)],
    tileSize: 256,
    minzoom: 0,
    /**
     * Where the data stops, so the renderer stretches rather than inventing.
     *
     * Five for the computed fields: a one-degree nowcast and an eight-degree
     * eclipse sample carry no more information at finer tiles and would cost a
     * render each, and overzooming is exactly the smooth interpolation they
     * want. Light pollution passes its own, because it has real measurements
     * out to zoom 8 and stopping at 5 would throw away the resolution the whole
     * archive exists to provide.
     */
    maxzoom,
    // Only the layers whose data carries an attribution condition set this, and
    // MapLibre shows it exactly while that source is on the map — which is the
    // behaviour CC BY wants: the credit appears with the data and leaves with it.
    ...(attribution ? { attribution } : {}),
  });
  instance.addLayer(
    {
      id,
      type: "raster",
      source: id,
      paint: {
        "raster-opacity": opacity,
        "raster-resampling": "linear",
        "raster-fade-duration": 0,
      },
    },
    firstSymbol,
  );
}

function clearField(instance: MapLibreMap, id: string, { keepSampler = false } = {}) {
  if (instance.getLayer(id)) instance.removeLayer(id);
  if (instance.getSource(id)) instance.removeSource(id);
  if (!keepSampler) clearFieldSampler(id);
}

/* ------------------------------------------------------------- twilight */

const TWILIGHT_ID = "tracker-twilight";

/**
 * Day and the four twilights, as one field.
 *
 * Drawn from the Sun's altitude directly rather than from cap polygons, which
 * is what makes five bands cost the same as two. The palette moves from a cool
 * daylight lift through progressively deeper blue-blacks: the map stays a dark
 * map at noon, and the difference between "the sky is still blue" and "faint
 * work is possible" is a step you can see rather than a shade you have to hunt
 * for.
 */
const TWILIGHT_PAINT: Record<string, [number, number, number, number]> = {
  day: [126, 148, 184, 0.13],
  civil: [70, 88, 124, 0.1],
  nautical: [22, 30, 54, 0.26],
  astronomical: [10, 14, 30, 0.42],
  night: [3, 5, 14, 0.56],
};

function drawTwilight(instance: MapLibreMap, at: Date) {
  const subsolar = subsolarPoint(at);
  const sample = (latitudeDeg: number, longitudeDeg: number): FieldColour => {
      const altitude = sunAltitudeAt(subsolar, latitudeDeg, longitudeDeg);
      const band = twilightBandFor(altitude);
      const paint = TWILIGHT_PAINT[band.id];
      /**
       * Softened across each boundary rather than stepped.
       *
       * A hard edge between nautical and astronomical would be a line the sky
       * does not have; a pure gradient would lose the boundaries entirely,
       * which are the whole point. Blending over two degrees keeps the bands
       * legible as bands and stops them looking like a weather map.
       */
      const lower = TWILIGHT_PAINT[twilightBandFor(altitude - 2).id];
      const upper = TWILIGHT_PAINT[twilightBandFor(altitude + 2).id];
      const mix = (index: number) => (paint[index] * 2 + lower[index] + upper[index]) / 4;
      return [
        Math.round(mix(0)),
        Math.round(mix(1)),
        Math.round(mix(2)),
        Math.round(mix(3) * 255),
      ];
  };
  paintField(instance, TWILIGHT_ID, sample, 1);
}

/* --------------------------------------------------------------- aurora */

const AURORA_ID = "tracker-aurora";
/** Below this the nowcast is not saying anything an observer should act on. */
const AURORA_FLOOR_PERCENT = 8;
/**
 * Where the ramp reaches full strength.
 *
 * Not the top of NOAA's scale. A quiet-to-moderate night peaks around forty per
 * cent, and a ramp stretched to ninety spends most of its range on values that
 * almost never occur, so the oval that is actually there comes out as a faint
 * wash. Above this the colour stops changing, which the panel's own number
 * makes honest: the ramp says "at least this likely".
 */
const AURORA_CEILING_PERCENT = 45;

function auroraColour(t: number): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const stops: [number, [number, number, number]][] = [
    [0, [22, 86, 74]],
    [0.45, [47, 163, 111]],
    [0.75, [110, 231, 160]],
    [1, [190, 255, 214]],
  ];
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let index = 0; index < stops.length - 1; index += 1) {
    if (clamped >= stops[index][0] && clamped <= stops[index + 1][0]) {
      lower = stops[index];
      upper = stops[index + 1];
      break;
    }
  }
  const span = upper[0] - lower[0] || 1;
  const f = (clamped - lower[0]) / span;
  const rgb = [0, 1, 2].map((i) => Math.round(lower[1][i] + (upper[1][i] - lower[1][i]) * f));
  return [rgb[0], rgb[1], rgb[2], Math.round(255 * (0.34 + 0.5 * clamped))];
}

function drawAurora(instance: MapLibreMap, grid: AuroraGrid) {
  const cell = (latitudeDeg: number, longitudeDeg: number) => {
    const lon = ((Math.round(longitudeDeg) % 360) + 360) % 360;
    const lat = Math.max(0, Math.min(grid.latCount - 1, Math.round(latitudeDeg) + 90));
    return grid.values[lon * grid.latCount + lat] ?? 0;
  };
  const sample = (latitudeDeg: number, longitudeDeg: number): FieldColour => {
    const percent = bilinear(cell, latitudeDeg, longitudeDeg);
    if (percent <= AURORA_FLOOR_PERCENT) return null;
    return auroraColour(
      (percent - AURORA_FLOOR_PERCENT) / (AURORA_CEILING_PERCENT - AURORA_FLOOR_PERCENT),
    );
  };
  paintField(instance, AURORA_ID, sample, 0.85);
}

/* ------------------------------------------------------- light pollution */

const LIGHT_ID = "tracker-light-pollution";

/**
 * Artificial light, in Tracker's own palette rather than as imagery.
 *
 * The archive holds radiance, not a picture, so nothing here draws a photograph
 * of city lights onto the basemap — the numbers are recoloured into a single
 * warm ramp that reads as one of Tracker's own layers, transparent wherever no
 * light was detected. That was true of the old coarse composite too and stays
 * true now; what changed is that the numbers underneath are measurements at
 * 500 m rather than colours read back out of a rendered image at 14 km.
 */
function drawLightPollution(instance: MapLibreMap, archive: LightPollutionArchive) {
  const version = setTileField(LIGHT_ID, async (z, x, y) => {
    const grid = await archive.tile(z, x, y);
    if (!grid) return null;
    const size = archive.tileSize;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let index = 0; index < grid.length; index += 1) {
      const t = lightPollutionRamp(grid[index]);
      if (t <= 0) continue;
      const offset = index * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = Math.round(214 - 74 * t);
      pixels[offset + 2] = Math.round(150 - 120 * t);
      pixels[offset + 3] = Math.round(255 * (0.1 + 0.62 * t));
    }
    return pixels;
  });
  clearField(instance, LIGHT_ID, { keepSampler: true });
  attachField(instance, LIGHT_ID, version, 0.9, archive.maxZoom, LIGHT_POLLUTION_ATTRIBUTION);
}

/* -------------------------------------------------------- event overlay */

const EVENT_ID = "tracker-event";
const ECLIPSE_PATH_SOURCE = "tracker-eclipse-path";

/**
 * The selected event's own geography.
 *
 * Each kind gets the representation its physics has: a solar eclipse gets a
 * coverage field *and* a drawn central band, because the band is a line on the
 * ground and a gradient cannot say where it is; a lunar eclipse gets regions of
 * visibility, because that is what it has; a meteor shower gets an opportunity
 * field and no track at all, because it touches nothing.
 */
function drawEventOverlay(instance: MapLibreMap, overlay: EventOverlay) {
  clearEventOverlay(instance);

  if (overlay.kind === "solar-eclipse") {
    const { coverage, centralPath } = overlay;
    const byKey = new Map<string, number>();
    for (const cell of coverage.cells) {
      byKey.set(`${cell.latitudeDeg},${cell.longitudeDeg}`, cell.sunUp ? cell.obscuration : 0);
    }
    const step = coverage.stepDeg;
    const at = (latitudeDeg: number, longitudeDeg: number) => {
      const lat = Math.round(latitudeDeg / step) * step;
      const lon = ((Math.round(longitudeDeg / step) * step + 540) % 360) - 180;
      return byKey.get(`${lat},${lon}`) ?? 0;
    };
    const sample = (latitudeDeg: number, longitudeDeg: number): FieldColour => {
      const fraction = bilinear(at, latitudeDeg, longitudeDeg, step);
      if (fraction <= 0.02) return null;
      // Warm and pale where the Sun is barely touched, deepening towards the
      // band. Not a rainbow: one quantity, one ramp.
      const t = Math.min(1, fraction);
      return [
        Math.round(250 - 90 * t),
        Math.round(210 - 90 * t),
        Math.round(150 - 40 * t),
        Math.round(255 * (0.16 + 0.5 * t)),
      ];
    };
    paintField(instance, EVENT_ID, sample, 1);

    if (centralPath.length > 1) {
      const centre: [number, number][] = centralPath.map((point) => [
        point.longitudeDeg,
        point.latitudeDeg,
      ]);
      const withLimits = centralPath.filter((point) => point.limits);
      const band: [number, number][] =
        withLimits.length > 1
          ? [
              ...withLimits.map(
                (point) =>
                  [point.limits!.northLongitudeDeg, point.limits!.northLatitudeDeg] as [
                    number,
                    number,
                  ],
              ),
              ...withLimits
                .slice()
                .reverse()
                .map(
                  (point) =>
                    [point.limits!.southLongitudeDeg, point.limits!.southLatitudeDeg] as [
                      number,
                      number,
                    ],
                ),
            ]
          : [];
      /**
       * Three copies of the path, so it crosses the antimeridian with the map.
       *
       * GeoJSON sources, unlike image sources, do render outside the canonical
       * world — a longitude of 200 is drawn where 200 is. So the eclipse band
       * gets explicit copies either side, which is what keeps a track running
       * across the Pacific from stopping dead at the seam.
       */
      const features: GeoJSON.Feature[] = [];
      for (const offset of [-360, 0, 360]) {
        if (band.length > 2) {
          features.push({
            type: "Feature",
            properties: { part: "band" },
            geometry: {
              type: "Polygon",
              coordinates: [[...band, band[0]].map(([lon, lat]) => [lon + offset, lat])],
            },
          });
        }
        features.push({
          type: "Feature",
          properties: { part: "centre" },
          geometry: {
            type: "LineString",
            coordinates: centre.map(([lon, lat]) => [lon + offset, lat]),
          },
        });
      }
      instance.addSource(ECLIPSE_PATH_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
      const firstSymbol = instance.getStyle().layers?.find((l) => l.type === "symbol")?.id;
      instance.addLayer(
        {
          id: `${ECLIPSE_PATH_SOURCE}-band`,
          type: "fill",
          source: ECLIPSE_PATH_SOURCE,
          filter: ["==", ["get", "part"], "band"],
          paint: { "fill-color": "#1b1526", "fill-opacity": 0.62 },
        },
        firstSymbol,
      );
      instance.addLayer(
        {
          id: `${ECLIPSE_PATH_SOURCE}-edge`,
          type: "line",
          source: ECLIPSE_PATH_SOURCE,
          filter: ["==", ["get", "part"], "band"],
          paint: { "line-color": "#c9b6ff", "line-opacity": 0.55, "line-width": 1 },
        },
        firstSymbol,
      );
      instance.addLayer(
        {
          id: `${ECLIPSE_PATH_SOURCE}-centre`,
          type: "line",
          source: ECLIPSE_PATH_SOURCE,
          filter: ["==", ["get", "part"], "centre"],
          paint: {
            "line-color": "#f2ecff",
            "line-opacity": 0.85,
            "line-width": 1.6,
            "line-dasharray": [3, 2],
          },
        },
        firstSymbol,
      );
    }
    return;
  }

  if (overlay.kind === "lunar-eclipse") {
    /**
     * Regions, not a gradient, and computed where they are drawn.
     *
     * "The Moon rises during the eclipse" is a different answer from "you see
     * all of it", not a lesser amount of the same thing — so these are flat
     * bands with their own colours rather than a ramp, and nothing is drawn
     * where the Moon never comes up. Asking the caps directly at each pixel is
     * both exact and faster than any grid fine enough to hide its own steps.
     */
    const paint: Record<string, [number, number, number, number] | null> = {
      all: [92, 150, 226, 0.34],
      moonrise: [86, 122, 190, 0.19],
      moonset: [86, 122, 190, 0.19],
      none: null,
    };
    /**
     * The cap test, without the arc cosine.
     *
     * `lunarBandAt` is the readable form and the one the tests check; this is
     * the same comparison with the trigonometry hoisted out. Two things cost
     * the time: converting degrees to radians for every cap at every pixel, and
     * taking `acos` only to compare the result against a constant. Comparing
     * cosines directly removes the second entirely, and precomputing each cap's
     * sine and cosine removes most of the first — half a million pixels times
     * nine caps is four and a half million of each.
     */
    const DEG = Math.PI / 180;
    const caps = overlay.caps.map((cap) => ({
      sinLat: Math.sin(cap.latitudeDeg * DEG),
      cosLat: Math.cos(cap.latitudeDeg * DEG),
      lonRad: cap.longitudeDeg * DEG,
      cosRadius: Math.cos(cap.radiusDeg * DEG),
    }));
    let rowLat = Number.NaN;
    let sinP = 0;
    let cosP = 0;
    const sample = (latitudeDeg: number, longitudeDeg: number): FieldColour => {
      if (latitudeDeg !== rowLat) {
        rowLat = latitudeDeg;
        sinP = Math.sin(latitudeDeg * DEG);
        cosP = Math.cos(latitudeDeg * DEG);
      }
      const lonRad = longitudeDeg * DEG;
      let up = 0;
      let firstUp = false;
      for (let index = 0; index < caps.length; index += 1) {
        const cap = caps[index];
        const cosine = cap.sinLat * sinP + cap.cosLat * cosP * Math.cos(lonRad - cap.lonRad);
        if (cosine >= cap.cosRadius) {
          up += 1;
          if (index === 0) firstUp = true;
        }
      }
      const band = up === 0 ? "none" : up === caps.length ? "all" : firstUp ? "moonset" : "moonrise";
      const colour = paint[band];
      return colour ? [colour[0], colour[1], colour[2], Math.round(colour[3] * 255)] : null;
    };
    paintField(instance, EVENT_ID, sample, 1);
    return;
  }

  const { field } = overlay;
  const byKey = new Map<string, number>();
  for (const cell of field.cells) {
    byKey.set(`${cell.latitudeDeg},${cell.longitudeDeg}`, cell.potential);
  }
  const step = field.stepDeg;
  const at = (latitudeDeg: number, longitudeDeg: number) => {
    const lat = Math.round(latitudeDeg / step) * step;
    const lon = ((Math.round(longitudeDeg / step) * step + 540) % 360) - 180;
    return byKey.get(`${lat},${lon}`) ?? 0;
  };
  // Scaled to the night's own best, so a quiet shower still shows its shape
  // rather than being uniformly dim — the panel carries the absolute words.
  const ceiling = Math.max(0.05, field.peak);
  const sample = (latitudeDeg: number, longitudeDeg: number): FieldColour => {
    const value = bilinear(at, latitudeDeg, longitudeDeg, step) / ceiling;
    if (value <= 0.06) return null;
    const t = Math.min(1, value);
    /**
     * Weaker than the eclipse ramp, because it covers a hemisphere.
     *
     * An eclipse field is a band a few hundred kilometres wide and can afford
     * to be emphatic. A shower's potential varies smoothly over half the
     * planet, so the same opacity turns the whole continent into fog and takes
     * the coastline and the place names with it. The gradient is the
     * information; forty percent at the peak is enough to read it.
     */
    return [
      Math.round(96 + 120 * t),
      Math.round(112 + 128 * t),
      Math.round(210 + 40 * t),
      Math.round(255 * (0.06 + 0.34 * t)),
    ];
  };
  paintField(instance, EVENT_ID, sample, 1);
}

function clearEventOverlay(instance: MapLibreMap) {
  clearField(instance, EVENT_ID);
  for (const suffix of ["band", "edge", "centre"]) {
    const id = `${ECLIPSE_PATH_SOURCE}-${suffix}`;
    if (instance.getLayer(id)) instance.removeLayer(id);
  }
  if (instance.getSource(ECLIPSE_PATH_SOURCE)) instance.removeSource(ECLIPSE_PATH_SOURCE);
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const d = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * d) / 2) ** 2 +
    Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(((lon2 - lon1) * d) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
