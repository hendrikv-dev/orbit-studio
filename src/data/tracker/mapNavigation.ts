import type { PhenomenonCategoryId } from "./phenomenonCategories";
import { isSupportedDate } from "./skyContext";

/**
 * Where the reader is on the map, as one value.
 *
 * ## What this replaces, and why the old model could not be adjusted
 *
 * `trackerNavigation.ts` describes a product made of destinations: a `view` that
 * is Tonight or Upcoming, an `eventId` that replaces the page, a `mode` that
 * chooses between three ways of listing things. Every field answers "which page
 * am I on".
 *
 * Map-first asks a different question — "where am I looking, and what have I
 * picked" — and the difference is not a rename. A destination model has no
 * place to put a viewport, and a viewport is the thing that must survive a
 * drill-in and come back intact. So this is a second model rather than an
 * extension of the first, and the old one stays exactly as it is for the pages
 * that are still pages.
 *
 * ## The three kinds of state, and how each reaches history
 *
 * Not everything here belongs in the browser's back stack, and getting that
 * wrong in either direction is a defect a reader feels immediately.
 *
 *  - **The viewport** — centre and zoom. Changes continuously while a finger is
 *    down. It is written with `replaceState`, so a drag leaves one entry rather
 *    than four hundred, and Back from a drill-in still lands on the map the
 *    reader was actually looking at.
 *  - **The selection** — the pin, the temporal mode, the filter. Deliberate
 *    acts, each of which a reader would expect Back to undo. Pushed.
 *  - **The drill-in** — a detail page, and a drill within it. Pushed.
 *
 * The rule is not "how much changed" but "did the reader ask for it". Panning is
 * looking around; dropping a pin is a decision.
 */

/** A point the reader has picked, in degrees. */
export interface MapPin {
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface TrackerMapLocation {
  /** Where the map is centred, in degrees. */
  centre: { latitudeDeg: number; longitudeDeg: number };
  /** How far in, in MapLibre's zoom levels. */
  zoom: number;
  /** The selected point, or null for an unobstructed map. */
  pin: MapPin | null;
  /**
   * The night being shown. Null means today, and today is not stored, so a
   * shared link opens on the reader's own tonight rather than the day it was
   * copied.
   */
  date: string | null;
  category: PhenomenonCategoryId;
  /**
   * The event whose full-screen detail is open, or null while the reader is on
   * the map. This is the only field that takes the map off the screen.
   */
  detail: string | null;
  /**
   * A drill-in inside the detail view.
   *
   * Only the sky chart now. "View visibility map" used to be a second one —
   * a modal holding a larger copy of the panel beside it — and goes to the map
   * itself instead, where the geography actually lives. An old link carrying
   * `drill=field` lands on the event page, which is where its geography now is.
   */
  drill: "sky" | null;
  /**
   * The environment layers that are on, as ids.
   *
   * A list, because these describe the place and several of them are true at
   * once — cloud over a dark site is a different answer from either alone. It
   * used to be a single value, which made the map able to say only one thing
   * about anywhere at a time.
   */
  layers: string[];
  /**
   * The selected notable event, or null.
   *
   * Separate from `layers` on purpose: an event is not a property of the map,
   * it is a thing the reader is looking at, and it carries its own date. And
   * separate from `detail`, which is whether the full page is open — the map
   * can draw an eclipse without the reader having left the map.
   */
  event: string | null;
  /**
   * The observing card the reader has expanded, if any.
   *
   * Map state, not view state: expanding a card makes that object the map's
   * active context — an eclipse draws its path, a shower its field — so
   * returning to the map has to return to the same card, not to a default rail.
   */
  card: string | null;
}

export const TRACKER_APP_PARAM = "app";
export const TRACKER_APP_VALUE = "tracker";

/** `field` is deliberately absent: see `drill` above. */
const DRILLS = new Set(["sky"]);

/**
 * The zoom range, in MapLibre's convention: level 0 is the whole world in one
 * tile and each step doubles the scale.
 *
 * The ceiling is not a rendering limit. It is the zoom the basemap archive we
 * intend to serve ourselves will actually carry — see `basemapSource.ts` — so
 * the interface never learns to ask for detail we will not have. z10 shows
 * villages, lanes and the shape of the terrain, which is what choosing between
 * two observing sites an hour apart requires; street level is a different
 * product's problem and is what makes the archive expensive.
 *
 * The floor keeps at least a hemisphere on screen. Below it the map is an
 * illustration rather than a place, and eclipse geography stops being readable.
 */
export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 10;

/**
 * Where the map opens before anything is known.
 *
 * Zoomed out over the Atlantic so both populated hemispheres are on screen: the
 * reader has not told Tracker where they are yet, and centring on any one
 * country would be a guess dressed as a default. The moment a place is known —
 * from storage, from a search, from the device — the map moves to it.
 */
export function defaultMapLocation(): TrackerMapLocation {
  return {
    centre: { latitudeDeg: 25, longitudeDeg: -20 },
    zoom: 1,
    pin: null,
    date: null,
    category: "all",
    detail: null,
    drill: null,
    layers: [],
    event: null,
    card: null,
  };
}

function coordinate(value: string | null, limit: number): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return null;
  return parsed;
}

/**
 * Read a location out of a query string.
 *
 * Deliberately total: anything unrecognised falls back to the default rather
 * than throwing, because this parses whatever is in the address bar — including
 * a URL somebody edited, and one from an older build.
 */
export function parseMapLocation(search: string): TrackerMapLocation {
  const params = new URLSearchParams(search);
  const location = defaultMapLocation();


  const centre = params.get("at")?.split(",") ?? [];
  const centreLat = coordinate(centre[0] ?? null, 90);
  const centreLon = coordinate(centre[1] ?? null, 180);
  if (centreLat !== null && centreLon !== null) {
    location.centre = { latitudeDeg: centreLat, longitudeDeg: centreLon };
  }

  const zoom = Number(params.get("z"));
  if (Number.isFinite(zoom)) {
    location.zoom = Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, zoom));
  }

  const pin = params.get("pin")?.split(",") ?? [];
  const pinLat = coordinate(pin[0] ?? null, 90);
  const pinLon = coordinate(pin[1] ?? null, 180);
  if (pinLat !== null && pinLon !== null) {
    location.pin = { latitudeDeg: pinLat, longitudeDeg: pinLon };
  }

  const date = params.get("date");
  if (date && isSupportedDate(date)) location.date = date;


  const category = params.get("filter");
  if (category) location.category = category as PhenomenonCategoryId;

  // `event` is the page that is open; `show` is the notable event the map is
  // drawing. They are different questions and the URL keeps them apart.
  const detail = params.get("event");
  if (detail) location.detail = detail;

  const chosen = params.get("show");
  if (chosen) location.event = chosen;

  const card = params.get("card");
  if (card) location.card = card;

  const drill = params.get("drill");
  if (drill && DRILLS.has(drill)) location.drill = drill as TrackerMapLocation["drill"];

  const layers = params.get("layers");
  if (layers) {
    location.layers = layers
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return location;
}

/**
 * Whether two layer selections are the same, order aside.
 *
 * Compared as sets rather than as arrays: turning cloud off and on again must
 * not read as a change of state just because it ended up later in the list.
 */
function sameLayers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((entry, index) => entry === right[index]);
}

/** Coordinates at about a hundred metres, which is finer than any pin is meant. */
function coordinatePair(latitudeDeg: number, longitudeDeg: number): string {
  return `${latitudeDeg.toFixed(3)},${longitudeDeg.toFixed(3)}`;
}

/**
 * Write a location back into a query string.
 *
 * Only what differs from the default is written, so a resting URL stays short
 * rather than accumulating eight parameters that all say "the default".
 * `app=tracker` is always kept: it is what routes the page to this bundle, and
 * losing it on a refresh would drop the reader into the Explorer entry with its
 * 17 MB catalogue.
 */
export function mapLocationToSearch(location: TrackerMapLocation): string {
  const params = new URLSearchParams();
  params.set(TRACKER_APP_PARAM, TRACKER_APP_VALUE);
  const fallback = defaultMapLocation();

  if (
    location.centre.latitudeDeg !== fallback.centre.latitudeDeg ||
    location.centre.longitudeDeg !== fallback.centre.longitudeDeg
  ) {
    params.set("at", coordinatePair(location.centre.latitudeDeg, location.centre.longitudeDeg));
  }
  if (location.zoom !== fallback.zoom) params.set("z", location.zoom.toFixed(2));
  if (location.pin) {
    params.set("pin", coordinatePair(location.pin.latitudeDeg, location.pin.longitudeDeg));
  }
  if (location.date) params.set("date", location.date);
  if (location.category !== "all") params.set("filter", location.category);
  if (location.detail) params.set("event", location.detail);
  if (location.drill) params.set("drill", location.drill);
  if (location.layers.length > 0) params.set("layers", [...location.layers].sort().join(","));
  if (location.event) params.set("show", location.event);
  if (location.card) params.set("card", location.card);

  return `?${params.toString()}`;
}

/** How far two pins have to differ before they are different pins. */
const PIN_EPSILON_DEG = 1e-4;

function samePin(a: MapPin | null, b: MapPin | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.latitudeDeg - b.latitudeDeg) < PIN_EPSILON_DEG &&
    Math.abs(a.longitudeDeg - b.longitudeDeg) < PIN_EPSILON_DEG
  );
}

/**
 * Whether moving between two locations is a step Back should undo.
 *
 * The viewport is deliberately absent from this test. Panning and zooming are
 * how a reader looks around a map, and a back stack that recorded them would
 * take dozens of presses to leave — while the entry the reader actually wants
 * to return to, the one with their pin on it, scrolls out of reach.
 *
 * What is here is everything a reader chose: the point, the horizon, the
 * filter, the overlay, and the drill-in. Each is a decision, and Back undoing a
 * decision is exactly what Back is for.
 */
export function isMapNavigationStep(
  from: TrackerMapLocation,
  to: TrackerMapLocation,
): boolean {
  return (
    !samePin(from.pin, to.pin) ||

    from.detail !== to.detail ||
    from.drill !== to.drill ||
    from.date !== to.date ||
    from.event !== to.event ||
    from.card !== to.card ||
    from.category !== to.category ||
    !sameLayers(from.layers, to.layers)
  );
}

export function sameMapLocation(a: TrackerMapLocation, b: TrackerMapLocation): boolean {
  return (

    a.zoom === b.zoom &&
    a.centre.latitudeDeg === b.centre.latitudeDeg &&
    a.centre.longitudeDeg === b.centre.longitudeDeg &&
    samePin(a.pin, b.pin) &&
    a.date === b.date &&
    a.event === b.event &&
    a.card === b.card &&
    sameLayers(a.layers, b.layers) &&
    a.category === b.category &&
    a.detail === b.detail &&
    a.drill === b.drill &&
    true
  );
}
