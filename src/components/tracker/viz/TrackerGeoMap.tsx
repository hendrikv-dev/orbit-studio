import { Crosshair, Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  baseViewport,
  centreViewportOn,
  elementPointToMap,
  ornamentScale,
  panViewport,
  viewBoxOf,
  zoomLevel,
  zoomViewport,
  type Viewport,
} from "../../../data/tracker/mapViewport";
import landGeometry from "../../../data/natural-earth/ne_110m_land.geojson.json";

/**
 * The one map.
 *
 * Aurora and eclipses both need geography and they need the *same* geography,
 * drawn the same size, in the same box, with the observer marked the same way.
 * Two maps built separately drift apart within a week — different extents,
 * different coastline weights, different legends — and the reader ends up
 * learning two interfaces for one idea.
 *
 * So this owns everything that is common: the projection, the coastlines, the
 * graticule, the observer's marker, the frame and the legend rail. What it does
 * not own is the field drawn on top, which is the only thing that differs
 * between an auroral oval and an eclipse track.
 *
 * ## Why a plain equirectangular projection
 *
 * Because the alternative is worse for this job. Every question the map answers
 * is local — how far is the oval from me, which side of the track am I on — and
 * over the twenty to sixty degrees of longitude a Tracker map spans, the
 * distortion of a plate carrée is small and uniform. A conic or an orthographic
 * would look more cartographic and would make the reader's own position harder
 * to find, which is the one thing they are looking for.
 *
 * Latitude is compressed by the cosine of the box's middle latitude, so a
 * degree of longitude and a degree of latitude cover comparable ground and
 * coastlines keep their shape.
 */

export interface MapBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface MapProjection {
  x(longitudeDeg: number): number;
  y(latitudeDeg: number): number;
  /** The inverse, so a point on the drawing can become a place on Earth. */
  longitudeAt(x: number): number;
  latitudeAt(y: number): number;
  width: number;
  height: number;
  bounds: MapBounds;
}

interface Props {
  bounds: MapBounds;
  /** Where the observer is. Always drawn, always on top of the field. */
  marker: { latitudeDeg: number; longitudeDeg: number; label: string };
  /** The phenomenon field, drawn under the coastlines' highlights. */
  children: (projection: MapProjection) => ReactNode;
  legend: { swatch: string; label: string }[];
  /** What the map is of, and when it is valid for. */
  title: string;
  timing: string;
  /** Opens the fuller view; the map itself is never the whole answer. */
  action?: { label: string; onSelect: () => void };
  ariaLabel: string;
  /**
   * Whether the reader can pan, zoom and pick a place.
   *
   * Off for the panel beside the hero, which is a glance rather than a tool and
   * shares a scroll surface with the page — a map that captured drags there
   * would fight the reader for the wheel. On for the expanded map, which is the
   * exploratory state and has the screen to itself.
   */
  interactive?: boolean;
  /** A place the reader is inspecting, distinct from where they live. */
  selected?: { latitudeDeg: number; longitudeDeg: number; label: string } | null;
  onSelectPoint?: (latitudeDeg: number, longitudeDeg: number) => void;
  /** Rendered under the map: the textual equivalent of what it shows. */
  summary?: ReactNode;
}

const VIEW_WIDTH = 640;

interface LandFeature {
  geometry: { type: string; coordinates: unknown };
}

/**
 * Every land ring as a flat list of coordinate arrays.
 *
 * Natural Earth 110m ships polygons and multipolygons; both reduce to the same
 * thing once the holes are kept as separate rings, which is all a filled
 * coastline needs at this scale.
 */
const LAND_RINGS: [number, number][][] = (() => {
  const rings: [number, number][][] = [];
  for (const feature of (landGeometry as { features: LandFeature[] }).features) {
    const { type, coordinates } = feature.geometry;
    if (type === "Polygon") {
      for (const ring of coordinates as [number, number][][]) rings.push(ring);
    } else if (type === "MultiPolygon") {
      for (const polygon of coordinates as [number, number][][][]) {
        for (const ring of polygon) rings.push(ring);
      }
    }
  }
  return rings;
})();

export function TrackerGeoMap({
  bounds,
  marker,
  children,
  legend,
  title,
  timing,
  action,
  ariaLabel,
  interactive = false,
  selected = null,
  onSelectPoint,
  summary,
}: Props) {
  const projection = useMemo<MapProjection>(() => {
    const lonSpan = bounds.east - bounds.west;
    const latSpan = bounds.north - bounds.south;
    const middleLatitude = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
    // Height follows from the aspect the projection produces, then is clamped.
    //
    // The clamp exists because the cosine correction runs away near the poles:
    // an aurora map centred on Fairbanks has a middle latitude near 70°, where
    // cos is 0.35, and the true aspect makes the drawing taller than it is
    // wide. That is cartographically correct and useless in a panel — the map
    // becomes a vertical strip and the coastline the reader is looking for
    // falls off both ends.
    //
    // Inside the clamp the projection is exact. Outside it the drawing is
    // stretched by at most a factor of about two in one axis, which changes
    // where a coastline appears to bulge and changes nothing about which side
    // of a line the observer is on — the only thing these maps are read for.
    const trueHeight =
      (VIEW_WIDTH * latSpan) / Math.max(1e-6, lonSpan * Math.cos(middleLatitude));
    const height = Math.round(
      Math.max(VIEW_WIDTH * 0.42, Math.min(VIEW_WIDTH * 0.72, trueHeight)),
    );
    return {
      width: VIEW_WIDTH,
      height,
      bounds,
      x(longitudeDeg: number) {
        // Unwrap onto the box: a map centred on the Pacific still receives
        // longitudes either side of the antimeridian.
        let lon = longitudeDeg;
        while (lon < bounds.west - 180) lon += 360;
        while (lon > bounds.east + 180) lon -= 360;
        return ((lon - bounds.west) / lonSpan) * VIEW_WIDTH;
      },
      y(latitudeDeg: number) {
        return ((bounds.north - latitudeDeg) / latSpan) * height;
      },
      longitudeAt(x: number) {
        return bounds.west + (x / VIEW_WIDTH) * lonSpan;
      },
      latitudeAt(y: number) {
        return bounds.north - (y / height) * latSpan;
      },
    };
  }, [bounds]);

  const landPath = useMemo(() => {
    const parts: string[] = [];
    for (const ring of LAND_RINGS) {
      // Skip rings entirely outside the box, which is most of the world for a
      // regional map and by far the cheapest optimisation available.
      let minLon = Infinity;
      let maxLon = -Infinity;
      let minLat = Infinity;
      let maxLat = -Infinity;
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      if (maxLat < bounds.south - 5 || minLat > bounds.north + 5) continue;
      const westEdge = bounds.west - 5;
      const eastEdge = bounds.east + 5;
      const overlaps =
        (maxLon >= westEdge && minLon <= eastEdge) ||
        (maxLon + 360 >= westEdge && minLon + 360 <= eastEdge) ||
        (maxLon - 360 >= westEdge && minLon - 360 <= eastEdge);
      if (!overlaps) continue;

      parts.push(
        `M ${ring
          .map(([lon, lat]) => `${projection.x(lon).toFixed(1)},${projection.y(lat).toFixed(1)}`)
          .join(" L ")} Z`,
      );
    }
    return parts.join(" ");
  }, [bounds, projection]);

  const graticule = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const lonStep = bounds.east - bounds.west > 80 ? 30 : 10;
    const latStep = bounds.north - bounds.south > 50 ? 20 : 10;
    for (let lon = Math.ceil(bounds.west / lonStep) * lonStep; lon <= bounds.east; lon += lonStep) {
      lines.push({ x1: projection.x(lon), y1: 0, x2: projection.x(lon), y2: projection.height });
    }
    for (let lat = Math.ceil(bounds.south / latStep) * latStep; lat <= bounds.north; lat += latStep) {
      lines.push({ x1: 0, y1: projection.y(lat), x2: projection.width, y2: projection.y(lat) });
    }
    return lines;
  }, [bounds, projection]);

  const base = { width: projection.width, height: projection.height };
  const [viewport, setViewport] = useState<Viewport>(() => baseViewport(base));
  const frameRef = useRef<HTMLDivElement | null>(null);
  /** Live pointers, so one is a drag and two are a pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
  const pinchStart = useRef<{ distance: number; viewport: Viewport } | null>(null);

  // The map is re-fitted when the extent behind it changes — a different event,
  // or the same event drawn at a different size. Keeping a stale viewport there
  // would leave the reader zoomed into a corner of something they did not open.
  useEffect(() => {
    setViewport(baseViewport({ width: projection.width, height: projection.height }));
  }, [projection.width, projection.height, bounds.west, bounds.east, bounds.north, bounds.south]);

  /** Where a client point falls in the map's own coordinates. */
  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const frame = frameRef.current?.querySelector("svg");
      if (!frame) return null;
      const rect = frame.getBoundingClientRect();
      return elementPointToMap(
        { x: clientX - rect.left, y: clientY - rect.top },
        { width: rect.width, height: rect.height },
        viewport,
      );
    },
    [viewport],
  );

  /** Map units per client pixel, so a drag moves the world under the finger. */
  const unitsPerPixel = useCallback(() => {
    const frame = frameRef.current?.querySelector("svg");
    if (!frame) return 1;
    const rect = frame.getBoundingClientRect();
    const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height);
    return scale === 0 ? 1 : 1 / scale;
  }, [viewport]);

  const zoomBy = useCallback(
    (factor: number, focus?: { x: number; y: number }) => {
      setViewport((current) =>
        zoomViewport(
          current,
          factor,
          focus ?? { x: current.x + current.width / 2, y: current.y + current.height / 2 },
          base,
        ),
      );
    },
    [base.width, base.height],
  );

  const recentreOnMarker = useCallback(() => {
    setViewport((current) =>
      centreViewportOn(
        current,
        { x: projection.x(marker.longitudeDeg), y: projection.y(marker.latitudeDeg) },
        base,
      ),
    );
  }, [base.width, base.height, marker.latitudeDeg, marker.longitudeDeg, projection]);

  /**
   * Whether a pointer event began on one of the overlaid controls.
   *
   * The controls sit inside the frame so they can float over the map, which
   * means their events bubble to it. Without this guard the frame captured the
   * pointer on `pointerdown` and the button never received a click at all —
   * the zoom controls looked live and did nothing, and a press on one also
   * dropped an inspection pin behind it.
   */
  const fromControls = (event: React.PointerEvent<HTMLDivElement>) =>
    event.target instanceof Element && event.target.closest(".tk-geomap-controls") !== null;

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || fromControls(event)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        viewport,
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart.current.distance > 0) {
        dragged.current = true;
        const centre = toMap((a.x + b.x) / 2, (a.y + b.y) / 2);
        const factor = distance / pinchStart.current.distance;
        setViewport((current) =>
          zoomViewport(
            current,
            factor,
            centre ?? { x: current.x + current.width / 2, y: current.y + current.height / 2 },
            base,
          ),
        );
        pinchStart.current = { distance, viewport };
      }
      return;
    }

    if (pointers.current.size !== 1) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragged.current = true;
    const perPixel = unitsPerPixel();
    setViewport((current) => panViewport(current, -dx * perPixel, -dy * perPixel, base));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    if (fromControls(event) && !pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    // A press that did not move is a place the reader is asking about. A press
    // that moved was a drag, and must not also drop a marker.
    if (!dragged.current && onSelectPoint && pointers.current.size === 0) {
      const point = toMap(event.clientX, event.clientY);
      if (point) {
        onSelectPoint(projection.latitudeAt(point.y), projection.longitudeAt(point.x));
      }
    }
  }

  // Wheel zoom is registered natively rather than through React, because React
  // attaches wheel passively and a passive listener cannot preventDefault — so
  // zooming the map would scroll the page behind it at the same time.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !interactive) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const point = toMap(event.clientX, event.clientY);
      zoomBy(event.deltaY < 0 ? 1.16 : 1 / 1.16, point ?? undefined);
    }
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [interactive, toMap, zoomBy]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!interactive) return;
    const step = viewport.width / 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      setViewport((current) => panViewport(current, dx, dy, base));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.4);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(1 / 1.4);
    } else if (event.key === "0") {
      event.preventDefault();
      setViewport(baseViewport(base));
    }
  }

  const zoom = zoomLevel(viewport, base);
  const ornament = ornamentScale(viewport, base);

  const markerX = projection.x(marker.longitudeDeg);
  const markerY = projection.y(marker.latitudeDeg);

  return (
    <div className="tk-geomap">
      <div className="tk-geomap-head">
        <div>
          <p className="tk-viz-title">{title}</p>
          <p className="tk-viz-timing">{timing}</p>
        </div>
        {action ? (
          <button type="button" className="tk-viz-open" onClick={action.onSelect}>
            {action.label}
          </button>
        ) : null}
      </div>

      <div
        className="tk-geomap-frame"
        data-interactive={interactive ? "true" : undefined}
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        // The map is a control the reader operates, so it takes focus and
        // announces what it is. Without a role and a name it would be a div
        // that mysteriously responds to arrow keys.
        tabIndex={interactive ? 0 : undefined}
        role={interactive ? "application" : undefined}
        aria-label={interactive ? `${ariaLabel} Pan with the arrow keys, zoom with plus and minus, reset with zero.` : undefined}
      >
        <svg
          viewBox={viewBoxOf(viewport)}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            {/* The field is a sampled grid, and a grid drawn as squares reads as
                a screenshot of a spreadsheet. Blurring it back into a continuous
                surface is honest here: the underlying quantity genuinely is
                continuous, and the legend states the sampling resolution. */}
            {/* Enough blur to dissolve the sampling lattice without dissolving
                the shape it describes. Under about 7 the cell edges survive as
                stair-steps, which read as a rendering fault; much over it and
                a narrow band of high coverage stops being narrow. */}
            <filter id="tk-geomap-smooth" x="-12%" y="-12%" width="124%" height="124%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
            <clipPath id="tk-geomap-clip">
              <rect x="0" y="0" width={projection.width} height={projection.height} />
            </clipPath>
          </defs>

          <g clipPath="url(#tk-geomap-clip)">
            <rect
              x="0"
              y="0"
              width={projection.width}
              height={projection.height}
              className="tk-geomap-sea"
            />

            {/* The field, under the coastline so geography stays readable. */}
            {children(projection)}

            <path d={landPath} className="tk-geomap-land" />

            {graticule.map((line, index) => (
              <line
                key={index}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                className="tk-geomap-graticule"
              />
            ))}

            {/* The observer, last, because finding yourself is the first thing
                anybody does with a map like this. */}
            {/* A place the reader is asking about, drawn under their own pin
                so the two can never be confused when they overlap. */}
            {selected ? (
              <g
                className="tk-geomap-selected"
                transform={`translate(${projection.x(selected.longitudeDeg)} ${projection.y(selected.latitudeDeg)}) scale(${ornament})`}
              >
                <circle r={9} className="tk-geomap-selected-halo" />
                <circle r={3.4} className="tk-geomap-selected-dot" />
                <text x={11} y={4} className="tk-geomap-selected-label">
                  {selected.label}
                </text>
              </g>
            ) : null}

            {/* The observer, last, because finding yourself is the first thing
                anybody does with a map like this. Counter-scaled: drawn in map
                coordinates, a pin would otherwise become a billboard at 4x. */}
            <g
              className="tk-geomap-marker"
              transform={`translate(${markerX} ${markerY}) scale(${ornament})`}
            >
              <circle r={11} className="tk-geomap-marker-halo" />
              <path d="M 0 0 l -5.5 -8.5 a 6.6 6.6 0 1 1 11 0 Z" className="tk-geomap-marker-pin" />
              <circle cy={-10.5} r={2.4} className="tk-geomap-marker-dot" />
              <text x={11} y={-6} className="tk-geomap-marker-label">
                {marker.label}
              </text>
            </g>
          </g>
        </svg>
        {interactive ? (
          <div className="tk-geomap-controls">
            <button
              type="button"
              className="tk-map-control"
              onClick={() => zoomBy(1.4)}
              disabled={zoom >= MAX_ZOOM - 1e-6}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="tk-map-control"
              onClick={() => zoomBy(1 / 1.4)}
              disabled={zoom <= MIN_ZOOM + 1e-6}
              aria-label="Zoom out"
            >
              &minus;
            </button>
            <button
              type="button"
              className="tk-map-control"
              onClick={recentreOnMarker}
              aria-label="Recentre on me"
            >
              <Crosshair size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="tk-map-control"
              onClick={() => setViewport(baseViewport(base))}
              disabled={zoom <= MIN_ZOOM + 1e-6}
              aria-label="Reset the map"
            >
              <Maximize2 size={13} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <ul className="tk-geomap-legend">
        {legend.map((entry) => (
          <li key={entry.label}>
            <span style={{ background: entry.swatch }} aria-hidden />
            {entry.label}
          </li>
        ))}
      </ul>

      {/* What the map shows, in words.
          A reader who cannot see the drawing still has to be able to reach the
          decision it exists for, and a `role="img"` with a one-line label
          cannot carry a local circumstance that changes as places are picked. */}
      {summary ? <div className="tk-geomap-summary">{summary}</div> : null}
    </div>
  );
}
