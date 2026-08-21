import type { WeatherSourceInfo } from "./conditions";

/**
 * Aurora, from the only kind of source that can honestly describe it.
 *
 * Nothing about tonight's aurora is geometry. Every other phenomenon Tracker
 * ranks is computed on the device from an ephemeris, and the answer is as good
 * a century from now as it is tonight. Aurora is the opposite: it is driven by
 * the solar wind arriving at Earth in the last hour, it cannot be computed from
 * anything that ships in the bundle, and its useful horizon is measured in
 * tens of minutes.
 *
 * `docs/TRACKER_V1_STATUS.md` recorded aurora as unbuildable, and the reason
 * given was a cost one: a nowcast needs a feed, a feed needs a caching proxy,
 * and a proxy is a backend somebody pays for. That reasoning holds for the
 * satellite catalogue, where the terms of both element sources require it.
 * It does not hold here. NOAA's Space Weather Prediction Center publishes the
 * OVATION product and the planetary K-index as static JSON on a public CDN,
 * with `access-control-allow-origin: *` and a one-minute cache header, as works
 * of the United States government in the public domain. A browser may fetch
 * them directly, at no cost to anybody, which is what this module does.
 *
 * ## Three horizons, never blurred together
 *
 * The specification for this product is explicit that aurora must distinguish
 * near-real-time conditions from a short-range forecast from a broad longer-range
 * risk, and must not invent a specific viewing date weeks out. Those are three
 * different products of NOAA's, with three different validities, and they are
 * kept as three fields rather than merged into one number:
 *
 * - **Nowcast.** The OVATION grid, issued every few minutes, valid for roughly
 *   the next half hour to hour. This is the only thing here that can answer
 *   "should I go outside now".
 * - **Short range.** The three-day planetary K-index forecast. It supports
 *   "there is a chance on Thursday night" and nothing finer.
 * - **Beyond that.** Nothing. `auroraHorizonFor` returns `beyond-forecast` and
 *   the interface says so, rather than producing a plausible number.
 */

export const NOAA_SWPC_SOURCE: WeatherSourceInfo = {
  id: "noaa-swpc",
  name: "NOAA Space Weather Prediction Center",
  attribution:
    "Aurora nowcast (OVATION) and planetary K-index from the NOAA Space Weather Prediction Center (public domain).",
  cost: "public-no-fee",
  coverage: "global",
};

const OVATION_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
const KP_FORECAST_URL =
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
const KP_NOW_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";

/**
 * How far ahead each product is worth quoting.
 *
 * The nowcast figure is NOAA's own: the OVATION model's forecast time runs
 * about thirty to ninety minutes ahead of its observation time. Two hours is a
 * deliberately generous outer edge for treating the grid as current at all,
 * after which the interface reports it as stale rather than silently ageing.
 */
export const NOWCAST_VALID_MINUTES = 120;
/** The planetary K-index forecast NOAA publishes runs three days. */
export const SHORT_RANGE_HORIZON_DAYS = 3;

export type AuroraHorizon = "nowcast" | "short-range" | "beyond-forecast";

/**
 * Which product, if any, can speak about an instant.
 *
 * The gap between the two is real and is not papered over: an event tomorrow
 * night is inside the K-index forecast and nowhere near the nowcast, so it gets
 * a Kp-based statement about the level of activity expected and no statement at
 * all about where the auroral oval will be.
 */
export function auroraHorizonFor(atUtc: string, now: Date): AuroraHorizon {
  const minutesAhead = (Date.parse(atUtc) - now.getTime()) / 60_000;
  if (minutesAhead <= NOWCAST_VALID_MINUTES) return "nowcast";
  if (minutesAhead <= SHORT_RANGE_HORIZON_DAYS * 24 * 60) return "short-range";
  return "beyond-forecast";
}

/* ------------------------------------------------------------------- grid */

/**
 * The OVATION nowcast as a grid rather than sixty-five thousand triples.
 *
 * NOAA publishes it as `[longitude, latitude, aurora]` rows on a one-degree
 * grid, longitudes 0–359 and latitudes −90–90. Held as a typed array indexed by
 * position, because the interface samples it per map cell and a linear scan of
 * the row list per sample is the difference between a map that draws and one
 * that stalls.
 *
 * `aurora` is NOAA's own published quantity: the probability, in percent, of
 * visible aurora at that location. It is reported as theirs and never rescaled
 * into a Tracker judgement — the product's rule against inventing a percentage
 * is a rule against inventing one, not against quoting a source's.
 */
export interface AuroraGrid {
  observationUtc: string;
  forecastUtc: string;
  /** Probability of visible aurora, percent, indexed by `indexOf`. */
  values: Uint8Array;
  lonCount: number;
  latCount: number;
}

interface OvationBody {
  "Observation Time"?: string;
  "Forecast Time"?: string;
  coordinates?: [number, number, number][];
}

const LON_COUNT = 360;
const LAT_COUNT = 181;

function indexOf(lonDeg: number, latDeg: number): number {
  const lon = ((Math.round(lonDeg) % 360) + 360) % 360;
  const lat = Math.max(0, Math.min(LAT_COUNT - 1, Math.round(latDeg) + 90));
  return lon * LAT_COUNT + lat;
}

export function parseAuroraGrid(body: unknown): AuroraGrid {
  const parsed = body as OvationBody;
  const rows = parsed?.coordinates;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("The aurora nowcast returned no grid.");
  }
  const values = new Uint8Array(LON_COUNT * LAT_COUNT);
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    values[indexOf(row[0], row[1])] = Math.max(0, Math.min(100, Math.round(row[2])));
  }
  const observationUtc = parsed["Observation Time"];
  const forecastUtc = parsed["Forecast Time"];
  if (!observationUtc || !forecastUtc) {
    throw new Error("The aurora nowcast carried no issue time.");
  }
  return {
    observationUtc: new Date(observationUtc).toISOString(),
    forecastUtc: new Date(forecastUtc).toISOString(),
    values,
    lonCount: LON_COUNT,
    latCount: LAT_COUNT,
  };
}

/** NOAA's published probability of visible aurora at a place, in percent. */
export function auroraProbabilityAt(
  grid: AuroraGrid,
  latitudeDeg: number,
  longitudeDeg: number,
): number {
  return grid.values[indexOf(longitudeDeg, latitudeDeg)];
}

export interface NearbyAurora {
  latitudeDeg: number;
  longitudeDeg: number;
  probabilityPercent: number;
  /** Great-circle distance from the observer, km. */
  distanceKm: number;
  /** Compass bearing from the observer, degrees clockwise from north. */
  bearingDeg: number;
}

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

function greatCircleKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLon = (bLon - aLon) * DEG;
  const y = Math.sin(dLon) * Math.cos(bLat * DEG);
  const x =
    Math.cos(aLat * DEG) * Math.sin(bLat * DEG) -
    Math.sin(aLat * DEG) * Math.cos(bLat * DEG) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * The best place within driving reach, where it is meaningfully better here.
 *
 * "Meaningfully" is doing real work. Every observer south of the oval has a
 * better spot somewhere north of them, and a product that always answers "drive
 * north" has said nothing. This returns a candidate only where the gain is
 * large enough to be worth the journey and the journey is short enough to make
 * tonight — otherwise null, which the interface renders as silence rather than
 * as advice.
 */
export function strongestNearby(
  grid: AuroraGrid,
  latitudeDeg: number,
  longitudeDeg: number,
  maximumDistanceKm = 400,
  minimumGainPercent = 15,
): NearbyAurora | null {
  const here = auroraProbabilityAt(grid, latitudeDeg, longitudeDeg);
  const searchDeg = Math.ceil(maximumDistanceKm / 111) + 1;
  let best: NearbyAurora | null = null;

  for (let dLat = -searchDeg; dLat <= searchDeg; dLat += 1) {
    for (let dLon = -searchDeg * 2; dLon <= searchDeg * 2; dLon += 1) {
      const lat = latitudeDeg + dLat;
      const lon = longitudeDeg + dLon;
      if (lat < -90 || lat > 90) continue;
      const distanceKm = greatCircleKm(latitudeDeg, longitudeDeg, lat, lon);
      if (distanceKm > maximumDistanceKm) continue;
      const probability = auroraProbabilityAt(grid, lat, lon);
      if (probability < here + minimumGainPercent) continue;
      if (!best || probability > best.probabilityPercent) {
        best = {
          latitudeDeg: lat,
          longitudeDeg: lon,
          probabilityPercent: probability,
          distanceKm,
          bearingDeg: bearingDeg(latitudeDeg, longitudeDeg, lat, lon),
        };
      }
    }
  }
  return best;
}

/* ---------------------------------------------------------- planetary Kp */

export interface KpPoint {
  atUtc: string;
  kp: number;
  observed: "observed" | "estimated" | "predicted";
}

/** NOAA's G-scale for geomagnetic storms, from the same Kp the forecast uses. */
export function stormScaleFor(kp: number): { label: string; level: number } | null {
  if (kp >= 9) return { label: "G5 extreme", level: 5 };
  if (kp >= 8) return { label: "G4 severe", level: 4 };
  if (kp >= 7) return { label: "G3 strong", level: 3 };
  if (kp >= 6) return { label: "G2 moderate", level: 2 };
  if (kp >= 5) return { label: "G1 minor", level: 1 };
  return null;
}

export function parseKpForecast(body: unknown): KpPoint[] {
  if (!Array.isArray(body)) return [];
  return body
    .map((row) => {
      const entry = row as { time_tag?: string; kp?: number; observed?: string };
      if (!entry?.time_tag || typeof entry.kp !== "number") return null;
      const observed =
        entry.observed === "observed"
          ? "observed"
          : entry.observed === "estimated"
            ? "estimated"
            : "predicted";
      return {
        atUtc: new Date(`${entry.time_tag}Z`.replace("ZZ", "Z")).toISOString(),
        kp: entry.kp,
        observed,
      } satisfies KpPoint;
    })
    .filter((point): point is KpPoint => point !== null);
}

export function parseCurrentKp(body: unknown): number | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const latest = body[body.length - 1] as { estimated_kp?: number; kp_index?: number };
  const value = latest?.estimated_kp ?? latest?.kp_index;
  return typeof value === "number" ? value : null;
}

/** The forecast Kp nearest an instant, within the product's own resolution. */
export function kpNear(points: KpPoint[], atUtc: string): KpPoint | null {
  if (points.length === 0) return null;
  const target = Date.parse(atUtc);
  let best: KpPoint | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const gap = Math.abs(Date.parse(point.atUtc) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = point;
    }
  }
  // The product is published in three-hour bins. Beyond half a bin either side
  // it is a different part of the forecast, and stretching it would be reading
  // the source for something it did not say.
  return bestGap <= 100 * 60_000 ? best : null;
}

/* ------------------------------------------------------------------ fetch */

export interface AuroraConditions {
  grid: AuroraGrid | null;
  currentKp: number | null;
  kpForecast: KpPoint[];
  /** When Tracker asked, as opposed to when NOAA issued. Both are shown. */
  fetchedAtUtc: string;
  source: WeatherSourceInfo;
  /** Each product that failed, so partial availability is visible, not silent. */
  failures: { product: string; message: string }[];
}

async function readJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`NOAA SWPC responded ${response.status}`);
  return response.json();
}

/**
 * The nowcast grid, on its own.
 *
 * Separated from the K-index products because they fail separately and are
 * worth retrying separately. Bundling all three behind one `allSettled` looked
 * tidier and had a specific bad failure: a reset connection on the 900 kB grid
 * resolved the combined request *successfully* with a null grid, so nothing
 * retried and the aurora page silently lost its map for the rest of the
 * session. Rejecting is what makes a retry possible.
 */
export async function fetchAuroraGrid(signal?: AbortSignal): Promise<AuroraGrid> {
  return parseAuroraGrid(await readJson(OVATION_URL, signal));
}

/** The planetary K-index: the current estimate and the three-day forecast. */
export async function fetchAuroraIndex(
  signal?: AbortSignal,
): Promise<{ currentKp: number | null; kpForecast: KpPoint[] }> {
  const [forecast, now] = await Promise.all([
    readJson(KP_FORECAST_URL, signal),
    readJson(KP_NOW_URL, signal),
  ]);
  return { currentKp: parseCurrentKp(now), kpForecast: parseKpForecast(forecast) };
}

/**
 * Both products, for callers that want one call.
 *
 * Still `allSettled` at this level: the page is genuinely better with the
 * K-index and no map than with nothing, and the failures are reported rather
 * than swallowed. Callers that need retries subscribe to the two functions
 * above instead.
 */
export async function fetchAuroraConditions(signal?: AbortSignal): Promise<AuroraConditions> {
  const [gridResult, indexResult] = await Promise.allSettled([
    fetchAuroraGrid(signal),
    fetchAuroraIndex(signal),
  ]);

  const failures: { product: string; message: string }[] = [];
  const reason = (result: PromiseRejectedResult) =>
    result.reason instanceof Error ? result.reason.message : "Request failed";

  if (signal?.aborted) throw new DOMException("Aurora request aborted", "AbortError");

  const grid = gridResult.status === "fulfilled" ? gridResult.value : null;
  if (gridResult.status === "rejected") {
    failures.push({ product: "ovation-nowcast", message: reason(gridResult) });
  }

  const index =
    indexResult.status === "fulfilled"
      ? indexResult.value
      : { currentKp: null, kpForecast: [] as KpPoint[] };
  if (indexResult.status === "rejected") {
    failures.push({ product: "planetary-k-index", message: reason(indexResult) });
  }

  return {
    grid,
    currentKp: index.currentKp,
    kpForecast: index.kpForecast,
    fetchedAtUtc: new Date().toISOString(),
    source: NOAA_SWPC_SOURCE,
    failures,
  };
}

/* ------------------------------------------------------------- judgement */

export type AuroraOutlook =
  /** The oval is over the observer or close enough to show low on the horizon. */
  | "plausible-tonight"
  /** Activity exists but is well poleward; a drive might reach it. */
  | "north-of-you"
  /** Quiet. Nothing worth going out for. */
  | "quiet"
  /** No usable product reached this instant. */
  | "unknown";

export interface AuroraAssessment {
  outlook: AuroraOutlook;
  horizon: AuroraHorizon;
  probabilityPercent: number | null;
  kp: number | null;
  nearby: NearbyAurora | null;
  /** The one sentence that carries the judgement, matched to the horizon. */
  statement: string;
  /** What the reader should understand about how far ahead this can be trusted. */
  certainty: string;
  gridAgeMinutes: number | null;
}

/**
 * Aurora at a place and an instant, said only as far as the source supports.
 *
 * The three horizons produce three different *kinds* of sentence, not three
 * confidence levels attached to the same one. That is the whole point: "27%
 * chance from your location in the next hour" and "Kp 5 expected on Thursday
 * evening" are different claims, and a single template that produced both from
 * one number would be dressing the weaker of them in the stronger's clothes.
 */
export function assessAurora(
  conditions: AuroraConditions | null,
  latitudeDeg: number,
  longitudeDeg: number,
  atUtc: string,
  now: Date,
): AuroraAssessment {
  const horizon = auroraHorizonFor(atUtc, now);

  if (!conditions) {
    return {
      outlook: "unknown",
      horizon,
      probabilityPercent: null,
      kp: null,
      nearby: null,
      statement: "No space-weather product has been read yet.",
      certainty: "Aurora cannot be computed from geometry; it needs a live feed.",
      gridAgeMinutes: null,
    };
  }

  if (horizon === "beyond-forecast") {
    return {
      outlook: "unknown",
      horizon,
      probabilityPercent: null,
      kp: null,
      nearby: null,
      statement: "Too far ahead for any aurora forecast.",
      certainty: `Nothing beyond ${SHORT_RANGE_HORIZON_DAYS} days is forecastable. Check again closer to the night.`,
      gridAgeMinutes: null,
    };
  }

  if (horizon === "short-range") {
    const point = kpNear(conditions.kpForecast, atUtc);
    if (!point) {
      return {
        outlook: "unknown",
        horizon,
        probabilityPercent: null,
        kp: null,
        nearby: null,
        statement: "The three-day forecast does not reach this night.",
        certainty: "Only the planetary K-index reaches beyond the next hour, and it stops here.",
        gridAgeMinutes: null,
      };
    }
    const storm = stormScaleFor(point.kp);
    return {
      outlook: point.kp >= 5 ? "plausible-tonight" : point.kp >= 4 ? "north-of-you" : "quiet",
      horizon,
      probabilityPercent: null,
      kp: point.kp,
      nearby: null,
      statement: storm
        ? `Kp ${point.kp.toFixed(1)} forecast — ${storm.label} conditions.`
        : `Kp ${point.kp.toFixed(1)} forecast: ordinary activity.`,
      certainty:
        "A three-day K-index forecast describes how disturbed the field will be, not where the oval will sit. Nothing finer is knowable this far out.",
      gridAgeMinutes: null,
    };
  }

  const { grid } = conditions;
  if (!grid) {
    return {
      outlook: "unknown",
      horizon,
      probabilityPercent: null,
      kp: conditions.currentKp,
      nearby: null,
      statement: "The aurora nowcast is unavailable.",
      certainty: "Without the nowcast grid there is nothing to say about where the oval is.",
      gridAgeMinutes: null,
    };
  }

  const ageMinutes = Math.round(
    (now.getTime() - Date.parse(grid.observationUtc)) / 60_000,
  );
  const probability = auroraProbabilityAt(grid, latitudeDeg, longitudeDeg);
  const nearby = strongestNearby(grid, latitudeDeg, longitudeDeg);

  const outlook: AuroraOutlook =
    probability >= 10 ? "plausible-tonight" : nearby ? "north-of-you" : "quiet";

  return {
    outlook,
    horizon,
    probabilityPercent: probability,
    kp: conditions.currentKp,
    nearby,
    statement:
      probability >= 10
        ? `NOAA puts the chance of visible aurora at ${probability}% over your location.`
        : nearby
          ? `Nothing over you, but ${nearby.probabilityPercent}% about ${Math.round(nearby.distanceKm)} km ${compassWord(nearby.bearingDeg)}.`
          : "The oval is well away from you and the field is quiet.",
    certainty:
      ageMinutes > NOWCAST_VALID_MINUTES
        ? "This nowcast is out of date. Aurora changes over tens of minutes."
        : "A nowcast, valid for roughly the next half hour. Aurora cannot be forecast reliably further ahead than that.",
    gridAgeMinutes: ageMinutes,
  };
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassWord(bearingDeg: number): string {
  return COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8];
}
