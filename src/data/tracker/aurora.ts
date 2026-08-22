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
 * `NOWCAST_VALID_MINUTES` is the outer edge for treating a *request* as being
 * about the nowcast at all, not a statement about the data's own age — that is
 * what `auroraFreshness` below is for, and conflating the two is what let a
 * six-hour-old grid drive a present-tense recommendation.
 */
export const NOWCAST_VALID_MINUTES = 120;

/**
 * How old a nowcast may be before Tracker stops concluding from it.
 *
 * Taken from the product rather than chosen for the interface. Each OVATION
 * file carries an observation time and a forecast time, and the forecast time
 * is the instant the model is predicting for — roughly half an hour ahead. So
 * the grid has an explicit expiry printed on it, and the states are defined
 * against that:
 *
 * - **fresh** — now is at or before the forecast time. The grid is describing
 *   the sky Tracker is being asked about.
 * - **aging** — up to `AURORA_AGING_GRACE_MINUTES` past it. The oval has moved,
 *   but the broad picture usually has not, so the figure is still worth
 *   showing while being explicitly out of date.
 * - **stale** — beyond that. Aurora restructures itself over tens of minutes;
 *   a grid this old cannot support a claim about now, and Tracker must stop
 *   making one rather than making it with a caveat attached.
 *
 * The grace period is one further OVATION cycle plus a margin. It is a
 * judgement, and it is the only number here that is.
 */
export const AURORA_AGING_GRACE_MINUTES = 30;

export type AuroraFreshness = "fresh" | "aging" | "stale" | "unavailable";

export function auroraFreshness(grid: AuroraGrid | null, now: Date): AuroraFreshness {
  if (!grid) return "unavailable";
  const pastValidity = (now.getTime() - Date.parse(grid.forecastUtc)) / 60_000;
  if (pastValidity <= 0) return "fresh";
  if (pastValidity <= AURORA_AGING_GRACE_MINUTES) return "aging";
  return "stale";
}
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
 * visible aurora at that location. Wherever a percentage is shown it is this
 * number, unmodified and attributed — the product's rule against inventing a
 * percentage is a rule against inventing one, not against quoting a source's.
 *
 * Tracker does derive from it: `auroraRankingStrength` turns it into a position
 * in the cross-phenomenon ranking. That derivation is declared as Tracker's and
 * never surfaces as a percentage, so the two never trade on each other's
 * authority.
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
  /** NOAA's grid gives a real chance of visible aurora at the observer. */
  | "plausible-tonight"
  /**
   * The modelled oval is poleward of the observer.
   *
   * Deliberately not "not visible". The OVATION grid reports the probability of
   * aurora being *overhead* at each point, and a display well poleward of you
   * can still be seen low on the horizon — the two questions are different, and
   * the product that answers the second (NOAA's viewline) is not read here. The
   * copy says the oval is elsewhere and stops short of saying you cannot see
   * anything.
   */
  | "north-of-you"
  /** Quiet. Nothing worth going out for. */
  | "quiet"
  /**
   * No usable product reached this instant — including the case where one did
   * arrive but has since expired. Staleness lands here rather than in a
   * qualifier on a live outlook.
   */
  | "unknown";

export interface AuroraAssessment {
  outlook: AuroraOutlook;
  horizon: AuroraHorizon;
  /** Whether the nowcast is current enough to conclude from. */
  freshness: AuroraFreshness;
  /**
   * What NOAA last published for this location, whatever its age.
   *
   * Kept separate from `probabilityPercent` on purpose. The two answer
   * different questions — "what did the source say" and "what may Tracker
   * conclude" — and the interface shows them in different places. A stale grid
   * still has a reported figure worth surfacing for transparency; it has no
   * figure worth acting on.
   */
  reportedProbabilityPercent: number | null;
  /** The figure Tracker is willing to reason from. Null once the grid is stale. */
  probabilityPercent: number | null;
  kp: number | null;
  nearby: NearbyAurora | null;
  /** The one sentence that carries the judgement, matched to the horizon. */
  statement: string;
  /** What the reader should understand about how far ahead this can be trusted. */
  certainty: string;
  gridAgeMinutes: number | null;
  /**
   * The interval the nowcast actually covers.
   *
   * This is the aurora equivalent of an observing window, and it is minutes
   * long rather than hours. Tracker used to hand the interface the whole of
   * astronomical darkness under the label "best window", which took a
   * half-hour claim and stretched it across eight.
   */
  validity: { fromUtc: string; toUtc: string } | null;
}

/**
 * Aurora at a place and an instant, said only as far as the source supports.
 *
 * The three horizons produce three different *kinds* of sentence, not three
 * confidence levels attached to the same one. That is the whole point: "27%
 * chance from your location in the next half hour" and "Kp 5 expected on
 * Thursday evening" are different claims, and a single template that produced
 * both from one number would be dressing the weaker of them in the stronger's
 * clothes.
 *
 * ## Staleness ends the claim rather than qualifying it
 *
 * An earlier version noticed an old grid and appended a warning sentence, while
 * leaving the probability, the outlook and the ranking weight exactly as they
 * were. The result was a confident recommendation with a disclaimer under it —
 * which is worse than either, because the recommendation is what gets read. A
 * stale grid now produces `outlook: "unknown"` and a null
 * `probabilityPercent`, so nothing downstream can conclude from it, and the
 * figure NOAA last reported moves to `reportedProbabilityPercent` where the
 * interface can show it as history rather than as advice.
 */
export function assessAurora(
  conditions: AuroraConditions | null,
  latitudeDeg: number,
  longitudeDeg: number,
  atUtc: string,
  now: Date,
): AuroraAssessment {
  const horizon = auroraHorizonFor(atUtc, now);
  const freshness = auroraFreshness(conditions?.grid ?? null, now);
  const blank = {
    freshness,
    reportedProbabilityPercent: null,
    probabilityPercent: null,
    kp: null,
    nearby: null,
    gridAgeMinutes: null,
    validity: null,
  } as const;

  if (!conditions) {
    return {
      ...blank,
      outlook: "unknown",
      horizon,
      statement: "No space-weather product has been read yet.",
      certainty: "Aurora cannot be computed from geometry; it needs a live feed.",
    };
  }

  if (horizon === "beyond-forecast") {
    return {
      ...blank,
      outlook: "unknown",
      horizon,
      statement: "Too far ahead for any aurora forecast.",
      certainty: `Nothing beyond ${SHORT_RANGE_HORIZON_DAYS} days is forecastable. Check again closer to the night.`,
    };
  }

  if (horizon === "short-range") {
    const point = kpNear(conditions.kpForecast, atUtc);
    if (!point) {
      return {
        ...blank,
        outlook: "unknown",
        horizon,
        statement: "The three-day forecast does not reach this night.",
        certainty: "Only the planetary K-index reaches beyond the next hour, and it stops here.",
      };
    }
    const storm = stormScaleFor(point.kp);
    return {
      ...blank,
      outlook: point.kp >= 5 ? "plausible-tonight" : point.kp >= 4 ? "north-of-you" : "quiet",
      horizon,
      kp: point.kp,
      statement: storm
        ? `Kp ${point.kp.toFixed(1)} forecast — ${storm.label} conditions.`
        : `Kp ${point.kp.toFixed(1)} forecast: ordinary activity.`,
      certainty:
        "A three-day K-index forecast describes how disturbed the field will be, not where the oval will sit. Nothing finer is knowable this far out.",
    };
  }

  const { grid } = conditions;
  if (!grid) {
    return {
      ...blank,
      outlook: "unknown",
      horizon,
      kp: conditions.currentKp,
      statement: "The aurora nowcast is unavailable.",
      certainty: "Without the nowcast grid there is nothing to say about where the oval is.",
    };
  }

  const ageMinutes = Math.round((now.getTime() - Date.parse(grid.observationUtc)) / 60_000);
  const reported = auroraProbabilityAt(grid, latitudeDeg, longitudeDeg);
  const validity = { fromUtc: grid.observationUtc, toUtc: grid.forecastUtc };

  if (freshness === "stale") {
    // Deliberately terminal. No outlook, no probability, no nearby suggestion —
    // a stale grid cannot support "drive north" any more than it can support
    // "go outside", and offering one would be the same error in a smaller box.
    return {
      outlook: "unknown",
      horizon,
      freshness,
      reportedProbabilityPercent: reported,
      probabilityPercent: null,
      kp: conditions.currentKp,
      nearby: null,
      gridAgeMinutes: ageMinutes,
      validity,
      statement: "Current auroral conditions are unavailable.",
      certainty: `The last nowcast reached this device ${describeAge(ageMinutes)} and has expired. Aurora restructures itself over tens of minutes, so it cannot say what the sky is doing now.`,
    };
  }

  const nearby = strongestNearby(grid, latitudeDeg, longitudeDeg);
  const outlook: AuroraOutlook =
    reported >= 10 ? "plausible-tonight" : nearby ? "north-of-you" : "quiet";

  return {
    outlook,
    horizon,
    freshness,
    reportedProbabilityPercent: reported,
    probabilityPercent: reported,
    kp: conditions.currentKp,
    nearby,
    gridAgeMinutes: ageMinutes,
    validity,
    statement:
      reported >= 10
        ? `NOAA puts the chance of visible aurora at ${reported}% over your location.`
        : nearby
          ? `The oval is not over you — NOAA gives ${nearby.probabilityPercent}% about ${Math.round(nearby.distanceKm)} km ${compassWord(nearby.bearingDeg)}. Strong aurora can still show low on the horizon from outside it.`
          : "The oval is well away from you and the field is quiet.",
    certainty:
      freshness === "aging"
        ? `This nowcast expired ${describeAge(Math.round((now.getTime() - Date.parse(grid.forecastUtc)) / 60_000))} — treat it as the last known picture rather than the current one.`
        : "A nowcast, valid for about half an hour from its observation. Aurora cannot be forecast reliably further ahead than that.",
  };
}

/* ------------------------------------------------- Tracker's own judgement */

export interface AuroraRanking {
  /** 0-1, in the same space the rest of the ranking uses. */
  strength: number;
  /** Where the number came from, in words the interface can attribute. */
  basis: string;
  /** True where this is Tracker's editorial model rather than a source figure. */
  editorial: true;
}

/**
 * How strongly Tracker recommends aurora relative to everything else tonight.
 *
 * **This is Tracker's judgement, not NOAA's.** NOAA publishes a probability of
 * visible aurora; it does not publish an opinion about whether that is a better
 * use of an evening than Saturn. Turning one into the other is an editorial
 * act, and the previous implementation performed it invisibly — `probability /
 * 55`, inline, with no stated reasoning and no test — while the documentation
 * claimed NOAA's figure was never rescaled into a Tracker judgement. It was.
 * This is the same act, named and argued.
 *
 * The ranking space runs 0-1, and the rest of the product treats about 0.6 as
 * "worth going out for". The anchors below place aurora against that scale:
 *
 * - **10%** — the lowest figure Tracker will call possible at all. Ranked
 *   `marginal`: worth knowing about, not worth a journey.
 * - **30%** — ranked around `good`. On a clear night this is a real chance and
 *   people do drive for it.
 * - **60%** — ranked `very good`. At this level aurora is the best thing in the
 *   sky for most observers who can see it.
 *
 * Between the anchors it interpolates; outside them it clamps. Straight-line
 * segments rather than a curve, because a curve would imply a calibration
 * against observed outcomes that does not exist.
 *
 * The three-day K-index is capped far below any of that on purpose. It says how
 * disturbed the field will be and nothing about where the oval will sit, so it
 * can never outrank an event whose position is known.
 *
 * A stale or missing nowcast scores zero. Data that cannot support a claim about
 * now must not win a ranking against data that can.
 */
export function auroraRankingStrength(assessment: AuroraAssessment): AuroraRanking {
  if (assessment.freshness === "stale" || assessment.freshness === "unavailable") {
    return {
      strength: 0,
      basis: "No current nowcast, so aurora is not ranked against tonight's other options.",
      editorial: true,
    };
  }

  if (assessment.probabilityPercent !== null) {
    const anchors: [number, number][] = [
      [0, 0],
      [10, 0.2],
      [30, 0.45],
      [60, 0.85],
      [100, 1],
    ];
    const p = Math.max(0, Math.min(100, assessment.probabilityPercent));
    let strength = 0;
    for (let index = 1; index < anchors.length; index += 1) {
      const [x0, y0] = anchors[index - 1];
      const [x1, y1] = anchors[index];
      if (p <= x1) {
        strength = y0 + ((p - x0) / (x1 - x0)) * (y1 - y0);
        break;
      }
    }
    return {
      strength,
      basis: `Tracker's ranking, from NOAA's ${assessment.probabilityPercent}% chance of visible aurora.`,
      editorial: true,
    };
  }

  if (assessment.kp !== null && assessment.horizon === "short-range") {
    if (assessment.kp < 5) {
      return {
        strength: 0,
        basis: "Below storm level, which rarely rewards a journey.",
        editorial: true,
      };
    }
    // Kp 5 -> 0.25, Kp 9 -> 0.40. Capped low because it locates nothing.
    const strength = 0.25 + Math.min(1, (assessment.kp - 5) / 4) * 0.15;
    return {
      strength,
      basis: `Tracker's ranking, from a forecast Kp of ${assessment.kp.toFixed(1)}. The K-index says nothing about where the oval will be.`,
      editorial: true,
    };
  }

  return { strength: 0, basis: "Nothing to rank from.", editorial: true };
}

/** "12 minutes ago", "3 hours ago" — for an age already measured in minutes. */
function describeAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassWord(bearingDeg: number): string {
  return COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8];
}
