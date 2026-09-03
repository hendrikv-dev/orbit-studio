import type { CloudForecastSeries } from "./cloud";
import type { ObservedSeries } from "./cloudObservation";
import {
  SUITABILITY_ORDER,
  suitabilityOfCategory,
  suitabilityOfPercent,
  verdictOf,
  warningsIn,
  type CloudBasis,
  type CloudSample,
  type Suitability,
  type CloudWarning,
  type WindowVerdict,
} from "./cloudSuitability";

/**
 * The observing window as one line of time: what was seen, then what is expected.
 *
 * ## Why the two halves stay separate
 *
 * Everything to the left of now is a measurement — NOAA's classification of a
 * two-kilometre pixel, scanned every five minutes. Everything to the right is a
 * model's opinion. They answer the same question with different authority, and
 * a reader deciding whether to drive an hour is entitled to know which one they
 * are looking at.
 *
 * So the timeline carries them as one ordered sequence and labels every sample
 * with where it came from. Nothing is blended across the boundary: there is no
 * smoothing between the last observation and the first forecast hour, because a
 * value invented in that gap would belong to neither source.
 *
 * ## Why it stops at the window
 *
 * A cloud layer that runs the whole day answers a question nobody asked. The
 * window is the stretch the reader could actually observe in — dusk to dawn, or
 * an event's own span — and cloud outside it is weather, not an obstacle.
 */

export interface CloudTimeline {
  /** In time order, observed then forecast. */
  samples: CloudSample[];
  nowUtc: string;
  /**
   * The last sample at or before now, or -1 when the window is entirely ahead.
   * A scrubber puts its "now" mark here.
   */
  nowIndex: number;
  warnings: CloudWarning[];
  verdict: WindowVerdict;
  /** Named sources, so the interface can say who said what. */
  observedSource: string | null;
  forecastModel: string | null;
  /** Which evidence paths are present at all. */
  bases: CloudBasis[];
}

export interface TimelineRequest {
  observed: ObservedSeries | null;
  forecast: CloudForecastSeries | null;
  windowStartUtc: string;
  windowEndUtc: string;
  nowUtc: string;
}

/**
 * How far outside the window an observation may sit and still be worth showing.
 *
 * The satellite scans on its own schedule, not the observer's, so the newest
 * frame before dusk is usually a few minutes early. Half an hour of lead-in
 * gives the timeline something to open with on an evening that has only just
 * begun, without letting this afternoon's weather into tonight's window.
 */
const LEAD_IN_MINUTES = 30;

function within(atUtc: string, fromUtc: string, toUtc: string): boolean {
  const at = Date.parse(atUtc);
  return at >= Date.parse(fromUtc) && at <= Date.parse(toUtc);
}

export function buildCloudTimeline(request: TimelineRequest): CloudTimeline {
  const { observed, forecast, windowStartUtc, windowEndUtc, nowUtc } = request;
  const leadIn = new Date(Date.parse(windowStartUtc) - LEAD_IN_MINUTES * 60_000).toISOString();

  const observedSamples: CloudSample[] = (observed?.frames ?? [])
    .filter((frame) => frame.category && within(frame.observedUtc, leadIn, windowEndUtc))
    .map((frame) => ({
      atUtc: frame.observedUtc,
      basis: "observed" as const,
      suitability: suitabilityOfCategory(frame.category!),
      category: frame.category!,
    }));

  // The forecast starts where the observations stop. Overlapping them would put
  // a model's guess about an hour the satellite already watched onto the same
  // line as the watching, and the guess would win half the ties.
  const lastObserved = observedSamples.length
    ? Date.parse(observedSamples[observedSamples.length - 1].atUtc)
    : -Infinity;

  const forecastSamples: CloudSample[] = (forecast?.hours ?? [])
    .filter((hour) => within(hour.validUtc, windowStartUtc, windowEndUtc))
    .filter((hour) => Date.parse(hour.validUtc) > lastObserved)
    .map((hour) => ({
      atUtc: hour.validUtc,
      basis: "forecast" as const,
      suitability: suitabilityOfPercent(hour.percent),
      percent: hour.percent,
    }));

  const samples = [...observedSamples, ...forecastSamples].sort((a, b) =>
    a.atUtc.localeCompare(b.atUtc),
  );

  const now = Date.parse(nowUtc);
  let nowIndex = -1;
  samples.forEach((sample, index) => {
    if (Date.parse(sample.atUtc) <= now) nowIndex = index;
  });

  const warnings = warningsIn(samples);
  return {
    samples,
    nowUtc,
    nowIndex,
    warnings,
    verdict: verdictOf(samples, warnings),
    observedSource: observedSamples.length && observed ? `${observed.satellite} ${observed.product}` : null,
    forecastModel: forecastSamples.length && forecast ? forecast.model : null,
    bases: [...new Set(samples.map((sample) => sample.basis))],
  };
}

/**
 * The next change worth telling a reader about, in their own terms.
 *
 * A timeline is a shape; this is the sentence. "Clearing around 11pm" is what
 * somebody deciding whether to go out actually needs, and it is only honest
 * when the change persists — a single clear hour in a closed night is not a
 * clearance, which is why this reads the warnings rather than the samples.
 */
export function nextChange(
  timeline: CloudTimeline,
): { kind: "clearing" | "closing"; atUtc: string; basis: CloudBasis } | null {
  const { samples, warnings, nowUtc } = timeline;
  const now = Date.parse(nowUtc);
  const inWarning = warnings.find(
    (warning) => Date.parse(warning.fromUtc) <= now && Date.parse(warning.toUtc) >= now,
  );

  if (inWarning) {
    // Where this warning ends is where the sky opens. The sample after its last
    // one is the first clear frame, and that is the time to quote.
    const index = samples.findIndex((sample) => sample.atUtc === inWarning.toUtc);
    const next = index >= 0 ? samples[index + 1] : undefined;
    return next ? { kind: "clearing", atUtc: next.atUtc, basis: next.basis } : null;
  }

  const ahead = warnings.find((warning) => Date.parse(warning.fromUtc) > now);
  if (!ahead) return null;
  const sample = samples.find((entry) => entry.atUtc === ahead.fromUtc);
  return { kind: "closing", atUtc: ahead.fromUtc, basis: sample?.basis ?? "forecast" };
}

/* -------------------------------------------------- what to do about it */

/**
 * How cloud should change what Tracker recommends.
 *
 * ## What cloud may and may not remove
 *
 * Cloud is the one condition that can be wrong in the reader's favour: a closed
 * forecast breaks up, and a two-kilometre pixel says nothing about the gap over
 * the next valley. That argues for caution, not for never acting.
 *
 * A repeatable target whose own interval is closed throughout is withheld. It
 * is up again tomorrow, and a rail of five things none of which can be seen
 * tonight is a catalogue with apologies attached rather than a recommendation.
 *
 * A rare or time-critical event is never withheld, however bad the sky. Missing
 * it because a model said eighty percent costs years, and the reader is the one
 * entitled to weigh that. For those, the obstruction is made unmistakable
 * instead.
 *
 * ## Why rarity changes the answer
 *
 * The cost of being wrong is not symmetric, and it is not the same for every
 * event. Missing a clear night for Jupiter costs nothing: Jupiter is up
 * tomorrow. Missing a total eclipse because a product said the sky would be
 * closed costs a decade. So the wording is scaled by the significance tier the
 * opportunity already earned — something rare under a closed sky is told to go
 * anyway, with the risk stated plainly, and a routine target under the same sky
 * is simply told the sky is closed.
 *
 * The tier comes from measured astronomy, not from an editorial list, so this
 * borrows a judgement Tracker has already defended rather than inventing one.
 */
export type CloudAdviceTier = "routine" | "good-example" | "favourable" | "notable";

export interface CloudAdvice {
  /**
   * True when the opportunity should not be offered at all.
   *
   * Only ever true for a repeatable target whose own observing interval is
   * effectively unusable. Never true for something rare.
   */
  suppress: boolean;
  /** The warning to show beside it, or null when the sky is not in the way. */
  warning: string | null;
  /** True when the reader should be told to go anyway. */
  goAnyway: boolean;
}

/**
 * What the sky does during one opportunity's own interval.
 *
 * ## Why the night's verdict is not enough
 *
 * Saturn sets at ten and a shower peaks at two. A single verdict for the whole
 * night gives them the same answer, and the answer is wrong for at least one of
 * them whenever the sky changes — which is most nights that are worth warning
 * about. Cloud arriving at midnight should take Saturn and leave the shower
 * alone; cloud clearing at midnight should do the reverse.
 *
 * So each opportunity is judged over the stretch a reader would actually be
 * outside for it, and two opportunities on the same night can legitimately
 * receive different outcomes.
 */
export interface IntervalCloud {
  verdict: WindowVerdict;
  /** How many samples fell inside the interval. */
  samples: number;
  /** The worst level reached inside it. */
  worst: Suitability | null;
}

export function cloudOver(
  timeline: CloudTimeline,
  fromUtc: string,
  toUtc: string,
): IntervalCloud {
  const from = Date.parse(fromUtc);
  const to = Date.parse(toUtc);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return { verdict: "unknown", samples: 0, worst: null };
  }
  const inside = timeline.samples.filter((sample) => {
    const at = Date.parse(sample.atUtc);
    return at >= from && at <= to;
  });
  if (!inside.length) return { verdict: "unknown", samples: 0, worst: null };

  const warnings = warningsIn(inside);
  const worst = inside.reduce<Suitability>(
    (bad, sample) =>
      SUITABILITY_ORDER[sample.suitability] > SUITABILITY_ORDER[bad] ? sample.suitability : bad,
    "good",
  );
  return { verdict: verdictOf(inside, warnings), samples: inside.length, worst };
}

/**
 * Which tiers are rare enough that cloud must not remove them.
 *
 * Drawn from the significance model rather than a list of event names, so this
 * borrows a judgement Tracker has already made from measured astronomy.
 */
const RARE: ReadonlySet<CloudAdviceTier> = new Set(["favourable", "notable"]);

export function cloudAdvice(
  timeline: CloudTimeline,
  tier: CloudAdviceTier,
  timeZone: string | null,
  interval?: { startUtc: string; endUtc: string } | null,
): CloudAdvice {
  // Judged over the opportunity's own interval where it has one, and over the
  // night only when it does not.
  const local = interval
    ? cloudOver(timeline, interval.startUtc, interval.endUtc)
    : { verdict: timeline.verdict, samples: timeline.samples.length, worst: null };

  if (local.verdict === "unknown" || local.verdict === "open") {
    return { suppress: false, warning: null, goAnyway: false };
  }

  const rare = RARE.has(tier);
  const change = nextChange(timeline);
  const opening =
    change?.kind === "clearing"
      ? ` The sky is expected to open around ${clock(change.atUtc, timeZone)}.`
      : "";

  if (local.verdict === "closed") {
    /**
     * A repeatable target under a sky that is closed for its whole interval is
     * not worth offering.
     *
     * The previous rule was "cloud warns but never removes", and it filled the
     * rail with things a reader could not see, on the reasoning that the sky
     * might surprise them. That reasoning is sound for an eclipse and wrong for
     * Saturn: Saturn is up again tomorrow, and a list of five things none of
     * which is visible tonight is not a recommendation, it is a catalogue with
     * apologies attached.
     *
     * Rare events keep their place. Missing a routine planet costs a night;
     * missing a total eclipse because a model said eighty percent costs years,
     * and cloud breaks up locally in ways a satellite pixel cannot see.
     */
    return {
      suppress: !rare,
      warning: rare
        ? `Cloud is forecast through this whole window.${opening} Worth going anyway if you can — this is not a common sight, and cloud breaks up locally in ways a satellite pixel cannot see.`
        : `Cloud is forecast through this whole window.${opening}`,
      goAnyway: rare,
    };
  }

  // Intermittent: the sky is changing, so it may well be open when the reader
  // is out. Kept for every tier, with the change named where one is expected.
  return {
    suppress: false,
    warning: `Cloud comes and goes during this window.${opening}`,
    goAnyway: false,
  };
}

/**
 * The time on the reader's own clock.
 *
 * A cloud warning is about tonight, where they are. Printing it in UTC would
 * make the one sentence that has to be acted on the one sentence that needs
 * arithmetic first.
 */
function clock(atUtc: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone ?? "UTC",
  }).format(new Date(atUtc));
}
