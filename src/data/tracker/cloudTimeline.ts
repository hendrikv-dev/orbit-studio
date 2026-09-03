import type { CloudForecastSeries } from "./cloud";
import type { ObservedSeries } from "./cloudObservation";
import {
  suitabilityOfCategory,
  suitabilityOfPercent,
  verdictOf,
  warningsIn,
  type CloudBasis,
  type CloudSample,
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
 * ## Why nothing is ever removed for cloud
 *
 * Cloud is the one condition that can be wrong in the reader's favour. A closed
 * forecast breaks up; a two-kilometre pixel says nothing about the gap over the
 * next valley. Light pollution and the Moon do not do this — they are where
 * they are — so those may gate an opportunity and cloud may not. A layer that
 * deleted tonight's occultation because the model said eighty percent would
 * eventually delete one that happened in a clear hour, and the reader would
 * never know it had.
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
  /** The warning to show beside it, or null when the sky is not in the way. */
  warning: string | null;
  /** True when the reader should be told to go anyway. */
  goAnyway: boolean;
}

/**
 * Why this does not reorder anything.
 *
 * An earlier version of this returned a demotion for the ranking to apply. It
 * was wrong, and the reason is worth writing down: cloud at the reader's own
 * place is the same cloud for everything in the sky above it. A penalty applied
 * equally to every opportunity changes no order at all, and one scaled by
 * significance only amplifies a tier ordering the significance model has
 * already done deliberately and defended.
 *
 * So cloud changes what the reader is *told*, not what they are offered. That
 * is also the safer failure: an opportunity pushed off the end of the rail by a
 * forecast is one the reader can never discover was there, on a night the sky
 * may well have opened.
 */
const RARE: ReadonlySet<CloudAdviceTier> = new Set(["favourable", "notable"]);

export function cloudAdvice(
  timeline: CloudTimeline,
  tier: CloudAdviceTier,
  timeZone: string | null,
): CloudAdvice {
  if (timeline.verdict === "unknown" || timeline.verdict === "open") {
    return { warning: null, goAnyway: false };
  }

  const rare = RARE.has(tier);
  const change = nextChange(timeline);
  const opening =
    change?.kind === "clearing"
      ? ` The sky is expected to open around ${clock(change.atUtc, timeZone)}.`
      : "";

  if (timeline.verdict === "closed") {
    return {
      warning: rare
        ? `Cloud is forecast across most of the window.${opening} Worth going anyway if you can — this is not a common sight, and cloud breaks up locally in ways a satellite pixel cannot see.`
        : `Cloud is forecast across most of the window.${opening}`,
      goAnyway: rare,
    };
  }

  return {
    warning: `Cloud comes and goes through the window.${opening}`,
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
