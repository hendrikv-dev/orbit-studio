/**
 * Sky access: whether the weather will let you see the thing at all.
 *
 * The follow-on specification is explicit that this stays a separate input from
 * the phenomenon itself, and that both survive into the result:
 *
 * > Combine them into a viewing recommendation, but retain both components so
 * > the product can explain whether a weak recommendation comes from the
 * > phenomenon or the clouds.
 *
 * So nothing here touches `Qualities`. A `ConditionSnapshot` describes the sky
 * over the observer, an `Opportunity` describes what is up there, and
 * `viewability()` combines them into a band while keeping both halves
 * addressable. That separation is what makes "the Perseids are excellent and
 * the sky is shut" expressible at all, and it is the difference between a
 * product that explains itself and one that just scores lower.
 *
 * ## No percentages
 *
 * The specification forbids an exact chance until it has been calibrated
 * against real observation outcomes, and nothing here has been. The output is a
 * band, and the bands are wide on purpose.
 */

/** What the sky looks like, in the vocabulary the interface uses. */
export type SkyCondition =
  | "clear"
  | "somewhat-cloudy"
  | "cloudy"
  | "overcast"
  | "foggy"
  | "precipitating"
  | "smoky"
  | "very-smoky";

/**
 * One instant of weather, normalised away from any provider's schema.
 *
 * Optional fields are genuinely optional: a provider that cannot supply smoke
 * leaves it null and the model runs without it, rather than a zero standing in
 * and quietly promising a transparent sky.
 */
export interface ConditionSnapshot {
  atUtc: string;
  /** Total cloud cover, 0–100. Required. */
  cloudCoverPercent: number;
  /** Air temperature at this instant, °C. Required. */
  temperatureC: number;
  /** When the forecast was issued, so freshness can be judged. */
  issuedUtc: string;
  /** True where precipitation is expected. */
  precipitating: boolean;
  /** Horizontal visibility in metres, where the provider reports it. */
  visibilityM: number | null;
  /** Low, middle and high cloud fractions, 0–100, where reported. */
  lowCloudPercent: number | null;
  midCloudPercent: number | null;
  highCloudPercent: number | null;
  /** Relative humidity, 0–100. A supporting transparency signal only. */
  relativeHumidityPercent: number | null;
  /**
   * Column-integrated smoke, mg/m². Smoke aloft cuts astronomical contrast even
   * when the ground-level air is fine, so it is kept separate from the surface
   * measure below rather than folded into one "smoke" number.
   */
  smokeColumnMgM2: number | null;
  /** Near-surface smoke as PM2.5, µg/m³. A health signal, not a sky one. */
  surfacePm25 : number | null;
  /** Which adapter produced this, for attribution and for the details view. */
  source: string;
}

/** Where a forecast came from, and what it costs to ask. */
export interface WeatherSourceInfo {
  id: string;
  name: string;
  attribution: string;
  /**
   * Whether asking this provider costs the operator money. The free-user path
   * may only use `public-no-fee` sources (§9 of the follow-on specification),
   * and this field is what makes that rule checkable rather than a convention.
   */
  cost: "public-no-fee" | "cost-bearing";
  /** Region the adapter serves, for choosing between them. */
  coverage: "global" | "united-states";
}

/* ------------------------------------------------------------- vocabulary */

/** Above this, cloud is the story regardless of anything else. */
const OVERCAST_PERCENT = 80;
const CLOUDY_PERCENT = 50;
const SOMEWHAT_CLOUDY_PERCENT = 20;

/** Column smoke thresholds, mg/m². Coarse, and deliberately so. */
const SMOKY_COLUMN = 20;
const VERY_SMOKY_COLUMN = 100;

/** Below this visibility, fog is what you will be looking at. */
const FOG_VISIBILITY_M = 1000;

export interface ConditionReading {
  condition: SkyCondition;
  /** The label, which names both states where both apply. */
  label: string;
  /**
   * True where smoke is the reason an otherwise open sky will disappoint. The
   * interface uses this to give smoke visual precedence, because "clear" and
   * "clear but smoky" are different evenings and the ordinary cloud icon
   * cannot say so.
   */
  smokeDominant: boolean;
}

/**
 * The sky in one word, or two where two are true.
 *
 * Order matters: precipitation and fog beat everything because they end the
 * evening, smoke is checked before cloud because a clear-but-smoky sky reads as
 * clear to a cloud-only model, and cloud is the fallback.
 */
export function readCondition(snapshot: ConditionSnapshot): ConditionReading {
  const smoke = snapshot.smokeColumnMgM2;
  const verySmoky = smoke !== null && smoke >= VERY_SMOKY_COLUMN;
  const smoky = smoke !== null && smoke >= SMOKY_COLUMN;

  if (snapshot.precipitating) {
    return { condition: "precipitating", label: "Rain or snow", smokeDominant: false };
  }
  if (snapshot.visibilityM !== null && snapshot.visibilityM < FOG_VISIBILITY_M) {
    return { condition: "foggy", label: "Fog", smokeDominant: false };
  }

  const cloud = snapshot.cloudCoverPercent;
  const cloudWord =
    cloud >= OVERCAST_PERCENT
      ? "Overcast"
      : cloud >= CLOUDY_PERCENT
        ? "Cloudy"
        : cloud >= SOMEWHAT_CLOUDY_PERCENT
          ? "Somewhat cloudy"
          : "Clear";

  if (verySmoky || smoky) {
    const heavy = verySmoky ? "very smoky" : "smoky";
    // Smoke takes precedence only where the sky is otherwise worth having. Under
    // an overcast there is nothing for smoke to spoil, and saying so would be
    // piling on.
    const dominant = cloud < CLOUDY_PERCENT;
    return {
      condition: verySmoky ? "very-smoky" : "smoky",
      label: dominant ? `${cloudWord} but ${heavy}` : `${cloudWord}, ${heavy}`,
      smokeDominant: dominant,
    };
  }

  return {
    condition:
      cloud >= OVERCAST_PERCENT
        ? "overcast"
        : cloud >= CLOUDY_PERCENT
          ? "cloudy"
          : cloud >= SOMEWHAT_CLOUDY_PERCENT
            ? "somewhat-cloudy"
            : "clear",
    label: cloudWord,
    smokeDominant: false,
  };
}

/* ------------------------------------------------------------- sky access */

/**
 * How much a phenomenon needs a genuinely transparent sky.
 *
 * The follow-on specification asks weather to be used per phenomenon rather
 * than uniformly, and this is the axis that differs: the Moon is visible
 * through cloud that would end a meteor watch, and smoke that barely dims
 * Jupiter can hide every faint meteor of the night.
 */
export type TransparencyDemand = "low" | "medium" | "high";

/**
 * Sky access, 0–1, for a phenomenon with a given appetite for transparency.
 *
 * These are judgement curves. They are not fitted to observation outcomes,
 * which is exactly why the output of `viewability` is a band and not a
 * percentage.
 */
export function skyAccess(
  snapshot: ConditionSnapshot,
  demand: TransparencyDemand,
): number {
  if (snapshot.precipitating) return 0;
  if (snapshot.visibilityM !== null && snapshot.visibilityM < FOG_VISIBILITY_M) return 0;

  const open = Math.max(0, 1 - snapshot.cloudCoverPercent / 100);

  // A demanding target loses more to the same cloud: gaps in broken cloud are
  // enough to catch a bright planet and not enough to watch a meteor shower.
  const cloudTerm =
    demand === "high" ? Math.pow(open, 1.6) : demand === "medium" ? Math.pow(open, 1.2) : open;

  let smokeTerm = 1;
  const smoke = snapshot.smokeColumnMgM2;
  if (smoke !== null) {
    // Smoke does not block, it dims. So it scales what is left rather than
    // gating it, and it costs a faint target far more than a bright one.
    const severity = Math.min(1, smoke / VERY_SMOKY_COLUMN);
    const weight = demand === "high" ? 0.65 : demand === "medium" ? 0.4 : 0.15;
    smokeTerm = 1 - weight * severity;
  }

  return Math.max(0, Math.min(1, cloudTerm * smokeTerm));
}

export type ViewabilityBand = "excellent" | "good" | "possible" | "unlikely";

/**
 * Freshness of the forecast, kept independent of the band itself.
 *
 * The specification asks for "an independent forecast-confidence or freshness
 * state", and it has to be independent: a confident forecast of cloud and a
 * stale forecast of clear sky are both "unlikely to be excellent", for
 * completely different reasons, and collapsing them would hide which.
 */
export type ForecastFreshness = "current" | "ageing" | "stale";

export interface Viewability {
  band: ViewabilityBand;
  /** Sky access alone, 0–1. Retained so the two halves stay addressable. */
  access: number;
  reading: ConditionReading;
  freshness: ForecastFreshness;
  /**
   * Set where the sky is genuinely the reason the evening is worse than it
   * could be — not merely worse than perfect. Without the floor this fires on
   * any cloud at all, and "it is the sky that is in the way" then sits next to
   * a badge reading *good* under light cloud, which reads as a fault in the
   * product rather than a fact about the night.
   */
  limitedBySky: boolean;
}

const FRESH_HOURS = 3;
const AGEING_HOURS = 12;

/** Below this, the sky is worth naming as the constraint. Above it, it is not. */
const SKY_CLEARLY_LIMITING = 0.55;

export function forecastFreshness(snapshot: ConditionSnapshot, now: Date): ForecastFreshness {
  const ageHours = (now.getTime() - Date.parse(snapshot.issuedUtc)) / 3_600_000;
  if (ageHours <= FRESH_HOURS) return "current";
  if (ageHours <= AGEING_HOURS) return "ageing";
  return "stale";
}

/**
 * The viewing recommendation for one instant.
 *
 * `phenomenonStrength` is the ranking's own strength for the opportunity, and
 * it is passed in rather than recomputed so the two cannot drift. The band is
 * driven by whichever of the two is worse, because the evening is limited by
 * whichever it is — and `limitedBySky` records which, so the interface can say
 * "the shower is fine, the sky is not" instead of just ranking it lower.
 */
export function viewability(
  snapshot: ConditionSnapshot,
  demand: TransparencyDemand,
  phenomenonStrength: number,
  now: Date,
): Viewability {
  const access = skyAccess(snapshot, demand);
  const reading = readCondition(snapshot);
  const freshness = forecastFreshness(snapshot, now);

  // Normalised against the ranking's own hero floor, so "worth going out for"
  // means the same thing in both halves of the product.
  const phenomenon = Math.min(1, phenomenonStrength / 0.6);
  const limiting = Math.min(access, phenomenon);

  const band: ViewabilityBand =
    limiting >= 0.7 ? "excellent" : limiting >= 0.45 ? "good" : limiting >= 0.2 ? "possible" : "unlikely";

  return {
    band,
    access,
    reading,
    freshness,
    limitedBySky: access < phenomenon && access < SKY_CLEARLY_LIMITING,
  };
}

/* ------------------------------------------------------------ best window */

/** One sampled moment of how good the phenomenon itself is, 0–1 of its own best. */
export interface OpportunitySample {
  atUtc: string;
  relative: number;
}

export interface BestWindow {
  startUtc: string;
  endUtc: string;
  /** The single best instant inside it. */
  peakUtc: string;
  viewability: Viewability;
  /**
   * True where the recommended window is not where the phenomenon is strongest
   * — a clear gap after the peak, rather than the peak itself. The interface
   * says so, because being sent out at a time that is not the advertised
   * maximum needs a reason.
   */
  movedByWeather: boolean;
}

/** Windows shorter than this are not worth sending anyone outside for. */
const MINIMUM_WINDOW_MINUTES = 20;

/**
 * When to actually go outside, given both halves.
 *
 * This is the piece that earns the weather integration. The nominal peak is
 * where the phenomenon is best; the recommendation is where the *product* of
 * the phenomenon and the sky is best, and when clouds clear an hour after
 * maximum those are not the same time. Recommending the peak into an overcast,
 * with a clear sky an hour later, is the specific failure this exists to
 * prevent.
 */
export function bestViewingWindow(
  profile: OpportunitySample[],
  conditions: ConditionSnapshot[],
  demand: TransparencyDemand,
  phenomenonStrength: number,
  now: Date,
): BestWindow | null {
  if (profile.length === 0) return null;

  const scored = profile.map((sample) => {
    const snapshot = nearestSnapshot(conditions, sample.atUtc);
    const access = snapshot ? skyAccess(snapshot, demand) : 1;
    return { sample, snapshot, access, combined: sample.relative * access };
  });

  const best = scored.reduce((top, entry) => (entry.combined > top.combined ? entry : top));
  if (best.combined <= 0) return null;

  // Grow outwards while the moment is still worth being outside for, so the
  // answer is an interval rather than an instant. Someone told to go out at
  // 23:40 needs to know whether 23:20 also works.
  const threshold = best.combined * 0.6;
  const index = scored.indexOf(best);
  let start = index;
  let end = index;
  while (start > 0 && scored[start - 1].combined >= threshold) start -= 1;
  while (end < scored.length - 1 && scored[end + 1].combined >= threshold) end += 1;

  const startUtc = scored[start].sample.atUtc;
  const endUtc = scored[end].sample.atUtc;
  if ((Date.parse(endUtc) - Date.parse(startUtc)) / 60_000 < MINIMUM_WINDOW_MINUTES) {
    // Too brief to recommend as a window; still report the instant.
  }

  const peakBySkyIgnored = profile.reduce((top, sample) =>
    sample.relative > top.relative ? sample : top,
  );

  return {
    startUtc,
    endUtc,
    peakUtc: best.sample.atUtc,
    viewability: best.snapshot
      ? viewability(best.snapshot, demand, phenomenonStrength, now)
      : {
          band: phenomenonStrength >= 0.45 ? "good" : "possible",
          access: 1,
          reading: { condition: "clear", label: "Conditions unavailable", smokeDominant: false },
          freshness: "stale",
          limitedBySky: false,
        },
    movedByWeather:
      Math.abs(Date.parse(best.sample.atUtc) - Date.parse(peakBySkyIgnored.atUtc)) > 30 * 60_000,
  };
}

/** The forecast nearest an instant, or null where none is close enough. */
export function nearestSnapshot(
  conditions: ConditionSnapshot[],
  atUtc: string,
): ConditionSnapshot | null {
  if (conditions.length === 0) return null;
  const target = Date.parse(atUtc);
  let best: ConditionSnapshot | null = null;
  let bestGap = Infinity;
  for (const snapshot of conditions) {
    const gap = Math.abs(Date.parse(snapshot.atUtc) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = snapshot;
    }
  }
  // Beyond 90 minutes it is a different part of the night, and interpolating
  // across that gap would be inventing a forecast.
  return bestGap <= 90 * 60_000 ? best : null;
}

/* ----------------------------------------------------------- the one line */

function clock(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * The single actionable sentence the specification asks for near the primary
 * action — "Clouds open after 11:40 — try then", not a forecast card.
 *
 * Poor conditions stay passive here (§ acceptance 11): the line says what to do
 * about the sky, never that the evening is a write-off.
 */
export function actionLine(window: BestWindow, temperatureC: number | null): string {
  const { reading, band } = window.viewability;
  const temperature = temperatureC === null ? "" : ` · ${Math.round(temperatureC)}°C`;
  const span = `${clock(window.startUtc)}–${clock(window.endUtc)} UTC`;
  const opens = band === "excellent" || band === "good";

  if (window.movedByWeather) {
    // "When the sky opens" is only true if it actually does. Moving to the
    // least bad hour of an overcast night is still worth saying, but saying it
    // in those words next to a chip reading "overcast" and "unlikely" is a
    // promise the same screen immediately contradicts.
    return opens
      ? `Best chance tonight: ${span}, when the sky opens${temperature}.`
      : `Clearest stretch tonight: ${span}${temperature}.`;
  }
  if (opens) {
    return `${reading.label} for ${span}${temperature}.`;
  }
  if (reading.smokeDominant) {
    return `${reading.label} around ${clock(window.peakUtc)} UTC${temperature} — faint detail will be harder to pick out.`;
  }
  return `Best chance tonight: ${span}${temperature}.`;
}
