import type { ConditionSnapshot, WeatherSourceInfo } from "./conditions";

/**
 * Aerosol, which is what "smoke" actually means for an observer.
 *
 * The condition row has always had a smoke card and has almost always had
 * nothing to put in it: neither shipping forecast provider carries an aerosol
 * layer, so the slot read "Not reported" everywhere, permanently, while
 * occupying a quarter of the most valuable row on the page.
 *
 * ## Why aerosol optical depth rather than a smoke concentration
 *
 * Because it is the quantity that answers the question. Optical depth is
 * defined by what a column of atmosphere does to light passing through it:
 * transmission is `e^(-τ)`, so τ converts directly into magnitudes of
 * extinction — the unit astronomy already thinks in. A surface concentration
 * of PM2.5 is a health measurement taken at head height and can be high while
 * the sky is fine, or low while smoke aloft is ruining it.
 *
 * Both are fetched. Optical depth drives the judgement; PM2.5 is kept because
 * it is what somebody with asthma standing outside for an hour actually needs,
 * and because it is the fallback where the aerosol model has no value.
 *
 * ## The source
 *
 * Open-Meteo's air-quality API, which serves the Copernicus Atmosphere
 * Monitoring Service reanalysis and forecast. Free for non-commercial use, no
 * key, `access-control-allow-origin: *`, CC BY 4.0. CAMS is already a
 * documented upstream in this repository's provenance inventory.
 */

export const OPEN_METEO_AIR_QUALITY_SOURCE: WeatherSourceInfo = {
  id: "open-meteo-air-quality",
  name: "Open-Meteo Air Quality (CAMS)",
  attribution:
    "Aerosol and particulate data from Open-Meteo, derived from the Copernicus Atmosphere Monitoring Service, licensed CC BY 4.0.",
  cost: "public-no-fee",
  coverage: "global",
};

const ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";

export interface AerosolSample {
  atUtc: string;
  /**
   * Aerosol optical depth at 550 nm, dimensionless.
   *
   * Roughly: 0.05 is a clean sky, 0.2 is noticeable haze, 0.5 is obvious
   * smoke, above 1 the sky is visibly brown by day.
   */
  aerosolOpticalDepth: number | null;
  /** Near-surface PM2.5, µg/m³. A health signal, not a sky one. */
  surfacePm25: number | null;
}

/**
 * Extinction added by aerosol, in magnitudes at the zenith.
 *
 * `2.5 · log10(e) · τ` is the definition rather than a fit: transmission
 * through optical depth τ is `e^(-τ)`, and a magnitude is `-2.5 log10` of a
 * flux ratio. Quoting it this way is what lets the interface say how much of
 * the sky is being taken away instead of printing a bare index nobody can act
 * on.
 */
export function aerosolExtinctionMagnitudes(opticalDepth: number): number {
  return 1.0857362 * opticalDepth;
}

export type AerosolReading = "clean" | "slight" | "hazy" | "smoky" | "heavy";

/**
 * How much the aerosol matters, in five steps.
 *
 * The boundaries are the conventional descriptive ranges for 550 nm optical
 * depth, chosen so each step is about a third of a magnitude of extinction —
 * the point at which the difference is visible to somebody looking for faint
 * things.
 */
export function readAerosol(opticalDepth: number): AerosolReading {
  if (opticalDepth < 0.08) return "clean";
  if (opticalDepth < 0.2) return "slight";
  if (opticalDepth < 0.4) return "hazy";
  if (opticalDepth < 0.8) return "smoky";
  return "heavy";
}

/* --------------------------------------------------- health, not observing */

/**
 * The air as a health question, which is a different question from the sky.
 *
 * ## Why this is separate from everything above
 *
 * Optical depth answers "how much light is the atmosphere taking away", which
 * is what an observer wants. PM2.5 answers "what is it like to stand in this
 * for an hour", which is what a *person* wants, and the two genuinely disagree:
 * a thin high smoke layer wrecks a night's transparency while the air at head
 * height is fine, and a still winter inversion can be unhealthy under a
 * perfectly transparent sky.
 *
 * Tracker asks people to go outside and stay there. That makes the health
 * reading its business — but only when there is something to say. An index that
 * reports "23, Good" every night is a dashboard, and the brief is right that
 * telling somebody normal air is normal has no value.
 */
/**
 * ## What the source actually gives us, and what it does not
 *
 * `fetchAerosol` asks Open-Meteo for `pm2_5` hourly, one day back and three
 * forward. That is a *modelled* concentration from the Copernicus Atmosphere
 * Monitoring Service — an analysis for hours that have passed and a forecast
 * for hours that have not. It is never a monitor reading, and nothing here is
 * allowed to imply otherwise.
 *
 * The past day is requested because the NowCast needs it. Without it the series
 * begins at 00:00 UTC of the current day, so at 03:00 there were three hours of
 * history and no twelve-hour window existed at all — and the code took the
 * single value nearest the event and called the result an AQI.
 *
 * ## Why a single hourly value may not be called AQI
 *
 * The US AQI's PM2.5 breakpoints are defined against a **24-hour average**.
 * Feeding them one hour's concentration is a category error: it answers a
 * question the scale was not built for, and it errs high — a twenty-minute
 * plume that a 24-hour average would barely register comes out as "AQI 175 ·
 * Unhealthy". Tracker was doing exactly that.
 *
 * EPA's own answer for reporting current air quality is the NowCast: a weighted
 * average of the last twelve hours that reacts quickly when conditions are
 * changing and behaves like an average when they are not. That is what is
 * implemented below, and the AQI is derived from its output rather than from
 * any single reading.
 */

/** Half an hour either side, which is the resolution the model is published at. */
const MATCH_TOLERANCE_MS = 45 * 60_000;

/** One hour of the series, as the NowCast consumes it. */
export interface Pm25Hour {
  atUtc: string;
  /** Concentration in µg/m³, or null where the model reported nothing. */
  pm25: number | null;
}

/**
 * The twelve-hour window the NowCast is defined over.
 *
 * EPA's specification is explicit about the length; it is not a tunable.
 */
export const NOWCAST_WINDOW_HOURS = 12;

/**
 * The floor on the weight, also from the specification.
 *
 * Without it a violently changing hour would drive the weight towards zero and
 * the NowCast would collapse onto the single most recent value — which is the
 * defect this whole function exists to prevent.
 */
export const NOWCAST_MINIMUM_WEIGHT = 0.5;

export interface NowCastPm25 {
  /** The NowCast concentration, µg/m³, truncated to one decimal as specified. */
  value: number;
  /** How many of the twelve hourly slots carried a usable value. */
  hoursUsed: number;
  /** The weight the rate of change produced, before rounding. */
  weight: number;
  /** The hour the most recent contributing sample describes. */
  latestUtc: string;
  /**
   * Whether every contributing hour is already in the past.
   *
   * The series runs into the future, and Tracker asks about an event that is
   * usually a few hours ahead. A window ending at a future hour is a projection
   * of what the NowCast *would* read then if the model is right — a real and
   * useful thing, and not the same claim as a reading of air that has already
   * been breathed. The interface is required to be able to tell them apart.
   */
  basis: "analysis" | "forecast";
}

/**
 * The EPA NowCast for PM2.5, over whatever of the last twelve hours exists.
 *
 * ## The method, in the order the specification states it
 *
 *  1. Take the twelve hourly concentrations ending at the hour in question,
 *     most recent first.
 *  2. Require at least two of the three most recent hours to be present. This
 *     is EPA's validity rule and it is the whole of the validity rule — an
 *     extra condition invented here would be a different method wearing the
 *     same name.
 *  3. Let `range = max − min` over the available values, and the scaled rate of
 *     change `w* = 1 − range / max`. A flat twelve hours gives `w*` near 1; a
 *     spike gives it near 0.
 *  4. Clamp: `w = max(w*, 0.5)`.
 *  5. `NowCast = Σ cᵢ·wⁱ / Σ wⁱ` over the available hours, `i` counting back
 *     from the most recent.
 *  6. Truncate to one decimal place.
 *
 * ## What it does to a spike, which is the point
 *
 * Eleven quiet hours and one bad one give a large range, so `w` hits its floor
 * of 0.5 and the denominator is close to 2 — the bad hour contributes about
 * half its value rather than all of it. Twelve consistently bad hours give a
 * small range, `w` near 1, and an answer close to the plain average. The
 * measure tracks a genuine change quickly and refuses to be moved far by a
 * single hour, which is exactly the behaviour the 24-hour breakpoints assume.
 *
 * Returns null when the validity rule is not met. Null is a real answer and the
 * caller is required to treat it as one: there is no fallback to the latest
 * hour, because that fallback was the bug.
 */
export function nowCastPm25(
  series: readonly Pm25Hour[],
  atUtc: string,
  now: Date,
): NowCastPm25 | null {
  const target = Date.parse(atUtc);
  if (!Number.isFinite(target)) return null;

  /**
   * The twelve slots ending at the target hour, most recent first.
   *
   * Indexed by whole hours back from the target rather than by position in the
   * array, so a series with holes in it puts its samples in the right slots
   * instead of sliding later hours into earlier ones. Nothing is forward-filled
   * — a missing hour stays missing and simply drops out of both sums, which is
   * what the specification says to do with it.
   */
  const slots: (Pm25Hour | null)[] = Array.from({ length: NOWCAST_WINDOW_HOURS }, () => null);
  for (const hour of series) {
    if (hour.pm25 === null || hour.pm25 === undefined || !Number.isFinite(hour.pm25)) continue;
    if (hour.pm25 < 0) continue;
    const at = Date.parse(hour.atUtc);
    if (!Number.isFinite(at) || at > target + 30 * 60_000) continue;
    const hoursBack = Math.round((target - at) / 3_600_000);
    if (hoursBack < 0 || hoursBack >= NOWCAST_WINDOW_HOURS) continue;
    // A later sample wins a contested slot: the series is hourly, so two
    // samples in one slot means an off-grid series and the nearer one is meant.
    const held = slots[hoursBack];
    if (!held || Math.abs(Date.parse(held.atUtc) - target) > Math.abs(at - target)) {
      slots[hoursBack] = hour;
    }
  }

  // EPA's validity rule: two of the three most recent hours.
  const recentPresent = slots.slice(0, 3).filter((slot) => slot !== null).length;
  if (recentPresent < 2) return null;

  const present = slots
    .map((slot, index) => (slot ? { index, value: slot.pm25 as number, atUtc: slot.atUtc } : null))
    .filter((entry): entry is { index: number; value: number; atUtc: string } => entry !== null);
  if (present.length === 0) return null;

  const values = present.map((entry) => entry.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // A window of pure zeroes has no rate of change to scale; the specification's
  // ratio is undefined there and the weight is 1.
  const scaled = max === 0 ? 1 : 1 - (max - min) / max;
  const weight = Math.max(NOWCAST_MINIMUM_WEIGHT, Math.min(1, scaled));

  let numerator = 0;
  let denominator = 0;
  for (const entry of present) {
    const factor = weight ** entry.index;
    numerator += entry.value * factor;
    denominator += factor;
  }
  if (denominator === 0) return null;

  const latest = present[0];
  return {
    // Truncated, not rounded — the specification says truncate.
    value: Math.trunc((numerator / denominator) * 10) / 10,
    hoursUsed: present.length,
    weight,
    latestUtc: latest.atUtc,
    basis: Date.parse(latest.atUtc) <= now.getTime() ? "analysis" : "forecast",
  };
}

export type AirQualityCategory =
  | "good"
  | "moderate"
  | "sensitive"
  | "unhealthy"
  | "very-unhealthy"
  | "hazardous";

export interface AirQualityIndex {
  /** US AQI, rounded, as the scale is defined. */
  aqi: number;
  category: AirQualityCategory;
  /** The category's published name. */
  label: string;
  /**
   * Whether this category carries outdoor-exposure guidance at all.
   *
   * The gate for showing anything. Below it the honest interface says nothing.
   */
  advisory: boolean;
  /**
   * The EPA's own cautionary statement for this category, paraphrased for
   * length and not for meaning. Null where the category has none.
   *
   * Deliberately quoted rather than composed: Tracker is not qualified to
   * invent health advice, and the published categories already carry theirs.
   */
  guidance: string | null;
}

/**
 * Where the index starts carrying advice.
 *
 * 101 is "Unhealthy for Sensitive Groups", the first category whose published
 * statement asks anybody to change what they do outdoors. Moderate (51–100)
 * mentions only unusually sensitive people and would fire on ordinary summer
 * afternoons in most cities, which is how a health warning becomes wallpaper.
 */
export const AQI_ADVISORY_FLOOR = 101;

/**
 * The US EPA PM2.5 breakpoints, in the 2024 revision.
 *
 * Concentration in µg/m³ to index, piecewise linear between each pair.
 */
const PM25_BREAKPOINTS: {
  concentration: readonly [number, number];
  index: readonly [number, number];
  category: AirQualityCategory;
  label: string;
  guidance: string | null;
}[] = [
  {
    concentration: [0, 9],
    index: [0, 50],
    category: "good",
    label: "Good",
    guidance: null,
  },
  {
    concentration: [9.1, 35.4],
    index: [51, 100],
    category: "moderate",
    label: "Moderate",
    guidance:
      "Unusually sensitive people may want to limit how long they spend outdoors.",
  },
  {
    concentration: [35.5, 55.4],
    index: [101, 150],
    category: "sensitive",
    label: "Unhealthy for sensitive groups",
    guidance:
      "People with heart or lung conditions, older adults and children should limit prolonged time outdoors.",
  },
  {
    concentration: [55.5, 125.4],
    index: [151, 200],
    category: "unhealthy",
    label: "Unhealthy",
    guidance:
      "Everyone should limit prolonged time outdoors; sensitive groups should avoid it.",
  },
  {
    concentration: [125.5, 225.4],
    index: [201, 300],
    category: "very-unhealthy",
    label: "Very unhealthy",
    guidance: "Everyone should avoid prolonged time outdoors.",
  },
  {
    concentration: [225.5, 325.4],
    index: [301, 500],
    category: "hazardous",
    label: "Hazardous",
    guidance: "Everyone should stay indoors.",
  },
];

/**
 * The index for a PM2.5 concentration.
 *
 * ## The honest caveat
 *
 * The breakpoints above are defined against a *24-hour* average, and what is
 * available here is an hourly value. The official index applies a NowCast
 * weighting over the preceding hours instead, which damps brief spikes. So a
 * short plume reads higher here than the published figure would, and the card
 * says where its number came from rather than presenting it as the official
 * reading for the area.
 *
 * Erring high on a health measure is the right direction to err, but it is
 * still an error and is labelled as one.
 */
/**
 * Everything the interface is allowed to know about the air, in one value.
 *
 * The four quantities are kept apart on purpose, because collapsing them is how
 * the defect happened: a raw hourly concentration became an AQI number with a
 * category name attached, and nothing downstream could tell that it had.
 *
 *   `pm25`     the model's concentration for that hour — raw, never displayed
 *              as an index
 *   `nowCast`  the twelve-hour weighted average, or null
 *   `index`    the AQI, derived only from `nowCast`, or null
 *   `basis`    whether the window is analysis or forecast, and how fresh
 */
export interface AirQualityReading {
  /** The hourly concentration at the instant asked about. Null where absent. */
  pm25: number | null;
  /** Null whenever EPA's validity rule is not met. */
  nowCast: NowCastPm25 | null;
  /** Null whenever `nowCast` is null. There is no other way to obtain one. */
  index: AirQualityIndex | null;
}

/**
 * Read the air at one instant.
 *
 * The single guarantee this function exists to provide: `index` is non-null
 * only when `nowCast` is non-null. There is no path from a bare concentration
 * to an index, which is the defect being fixed, and the type makes the absence
 * of that path visible rather than relying on the caller to remember it.
 */
export function readAirQuality(
  series: readonly Pm25Hour[],
  atUtc: string,
  now: Date,
): AirQualityReading {
  const target = Date.parse(atUtc);
  let pm25: number | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const hour of series) {
    if (hour.pm25 === null || hour.pm25 === undefined) continue;
    const gap = Math.abs(Date.parse(hour.atUtc) - target);
    if (gap < bestGap && gap <= MATCH_TOLERANCE_MS) {
      bestGap = gap;
      pm25 = hour.pm25;
    }
  }
  const nowCast = nowCastPm25(series, atUtc, now);
  return { pm25, nowCast, index: nowCast ? airQualityIndex(nowCast.value) : null };
}

export function airQualityIndex(pm25: number): AirQualityIndex {
  const concentration = Math.max(0, pm25);
  const band =
    PM25_BREAKPOINTS.find(
      (entry) =>
        concentration >= entry.concentration[0] && concentration <= entry.concentration[1],
    ) ?? PM25_BREAKPOINTS[PM25_BREAKPOINTS.length - 1];
  const [cLow, cHigh] = band.concentration;
  const [iLow, iHigh] = band.index;
  const aqi =
    cHigh === cLow
      ? iHigh
      : Math.round(iLow + ((iHigh - iLow) * (concentration - cLow)) / (cHigh - cLow));
  return {
    aqi: Math.min(500, Math.max(0, aqi)),
    category: band.category,
    label: band.label,
    advisory: aqi >= AQI_ADVISORY_FLOOR,
    guidance: band.guidance,
  };
}

interface AirQualityBody {
  hourly?: {
    time?: string[];
    pm2_5?: (number | null)[];
    aerosol_optical_depth?: (number | null)[];
  };
}

export function parseAerosolSamples(body: unknown): AerosolSample[] {
  const hourly = (body as AirQualityBody)?.hourly;
  const times = hourly?.time;
  if (!Array.isArray(times) || times.length === 0) return [];
  const depths = hourly?.aerosol_optical_depth ?? [];
  const particulates = hourly?.pm2_5 ?? [];
  return times.map((time, index) => ({
    // Requested in UTC, and returned without a zone suffix.
    atUtc: new Date(`${time}Z`).toISOString(),
    aerosolOpticalDepth: typeof depths[index] === "number" ? (depths[index] as number) : null,
    surfacePm25: typeof particulates[index] === "number" ? (particulates[index] as number) : null,
  }));
}

/**
 * Aerosol for a location, over the coming days.
 *
 * Coordinates are rounded for the same reason the weather adapters round them:
 * two observers in the same model cell should share one cache entry, and a
 * precise location should never be used as a cache key.
 */
export async function fetchAerosol(
  latitudeDeg: number,
  longitudeDeg: number,
  signal?: AbortSignal,
): Promise<AerosolSample[]> {
  /**
   * `past_days=1`, which is what makes the NowCast possible at all.
   *
   * Without it the hourly series begins at 00:00 UTC of the current day, so
   * before noon there is no twelve-hour window to average — and the previous
   * implementation responded to that by taking the single value nearest the
   * event and calling the result an AQI. The past day is the same endpoint and
   * the same model, asked for the hours it has already produced.
   */
  const url =
    `${ENDPOINT}?latitude=${latitudeDeg.toFixed(2)}&longitude=${longitudeDeg.toFixed(2)}` +
    `&hourly=pm2_5,aerosol_optical_depth&past_days=1&forecast_days=3&timezone=UTC`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Open-Meteo air quality responded ${response.status}`);
  return parseAerosolSamples(await response.json());
}

/**
 * Fold aerosol into the forecast snapshots the rest of Tracker already uses.
 *
 * Matched by time with a tolerance rather than by index: the two providers are
 * on different grids and different cadences, and lining them up by position
 * would silently attach one hour's smoke to another hour's cloud. A snapshot
 * with no aerosol within tolerance keeps its nulls, which the interface renders
 * as "not reported" rather than as clean air.
 */
export function withAerosol(
  snapshots: ConditionSnapshot[],
  aerosol: AerosolSample[],
): ConditionSnapshot[] {
  if (aerosol.length === 0) return snapshots;
  return snapshots.map((snapshot) => {
    const target = Date.parse(snapshot.atUtc);
    let best: AerosolSample | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const sample of aerosol) {
      const gap = Math.abs(Date.parse(sample.atUtc) - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = sample;
      }
    }
    if (!best || bestGap > MATCH_TOLERANCE_MS) return snapshot;
    return {
      ...snapshot,
      aerosolOpticalDepth: best.aerosolOpticalDepth,
      surfacePm25: best.surfacePm25 ?? snapshot.surfacePm25,
    };
  });
}
