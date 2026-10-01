import type { CloudForecastSeries } from "./cloud";
import type { ObservedSeries } from "./cloudObservation";
import type { ObstructionPersistence } from "./opportunity";
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
 * A point forecast or satellite pixel is not a reading of a target's azimuth
 * and altitude. It may lower quality and warn, but it never removes an
 * astronomically valid target by itself. A bright object can remain visible
 * through thin cloud or a local gap even while the area-wide percentage is
 * high.
 *
 * A repeatable target may be withheld only when fresh, high-confidence local
 * evidence explicitly covers that target direction. A time-critical event is
 * never withheld, however bad that evidence; the obstruction is made
 * unmistakable instead.
 *
 * Which is which is a property of the opportunity — `ObstructionPersistence`,
 * decided where the opportunity is built — and not a threshold on its score.
 *
 * ## Why rarity changes the answer
 *
 * The cost of being wrong is not symmetric, and it is not the same for every
 * event. Missing a clear gap for Saturn costs an evening; missing a total
 * eclipse costs years. Persistence still controls what high-confidence,
 * direction-specific obstruction may suppress, but coarse weather never gets
 * that authority.
 */


export interface CloudAdvice {
  /**
   * True when the opportunity should not be offered at all.
   *
   * Only ever true for a repeatable target with fresh, high-confidence evidence
   * that its own direction is substantially blocked. Never true for something
   * rare, and never true from an area-wide cloud percentage alone.
   */
  suppress: boolean;
  /** Whether the evidence can actually support an obscuration claim. */
  obscuration: "none" | "possible" | "likely" | "unknown";
  /** The warning to show beside it, or null when the sky is not in the way. */
  warning: string | null;
  /** True when the reader should be told to go anyway. */
  goAnyway: boolean;
}

/**
 * Current local evidence, independent of whichever implementation produced it.
 *
 * Sky Finder may eventually emit this from on-device camera analysis, but the
 * recommendation model knows nothing about cameras, frames or plate solving.
 * It only accepts a time-bounded statement about the sky region. Detecting
 * cloud or clear gaps is not the same as identifying the astronomical target,
 * which is why this contract cannot carry a visually-verified target state.
 */
export interface LocalSkyConditionEvidence {
  source: "camera" | "observer";
  observedUtc: string;
  scope: "sky-region" | "target-direction";
  targetId: string | null;
  finding: "clear-gaps" | "heavy-cloud";
  confidence: "low" | "medium" | "high";
  visualVerification: false;
}

export interface CloudAdviceContext {
  targetId: string;
  localEvidence?: LocalSkyConditionEvidence | null;
}

const LIVE_EVIDENCE_MAX_AGE_MINUTES = 10;

function applicableLocalEvidence(
  timeline: CloudTimeline,
  context: CloudAdviceContext | undefined,
): LocalSkyConditionEvidence | null {
  const evidence = context?.localEvidence;
  if (!evidence || evidence.confidence === "low") return null;
  const ageMinutes =
    (Date.parse(timeline.nowUtc) - Date.parse(evidence.observedUtc)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < -1 || ageMinutes > LIVE_EVIDENCE_MAX_AGE_MINUTES) {
    return null;
  }
  if (
    evidence.scope === "target-direction" &&
    evidence.targetId !== context?.targetId
  ) {
    return null;
  }
  return evidence;
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
  /** Evidence paths that actually fall inside this interval. */
  bases: CloudBasis[];
}

export function cloudOver(
  timeline: CloudTimeline,
  fromUtc: string,
  toUtc: string,
): IntervalCloud {
  const from = Date.parse(fromUtc);
  const to = Date.parse(toUtc);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return { verdict: "unknown", samples: 0, worst: null, bases: [] };
  }
  const inside = timeline.samples.filter((sample) => {
    const at = Date.parse(sample.atUtc);
    return at >= from && at <= to;
  });
  if (!inside.length) return { verdict: "unknown", samples: 0, worst: null, bases: [] };

  const warnings = warningsIn(inside);
  const worst = inside.reduce<Suitability>(
    (bad, sample) =>
      SUITABILITY_ORDER[sample.suitability] > SUITABILITY_ORDER[bad] ? sample.suitability : bad,
    "good",
  );
  return {
    verdict: verdictOf(inside, warnings),
    samples: inside.length,
    worst,
    bases: [...new Set(inside.map((sample) => sample.basis))],
  };
}

/**
 * Cloud advice for one opportunity, over its own observing window.
 *
 * `persistence` comes from the opportunity itself and answers "does missing
 * this cost anything I can get back". It is deliberately *not* the significance
 * tier, which answers "how good is this view" — the two correlate and are not
 * the same, and this function used to ask the wrong one. Under that rule a 3°
 * Moon–Venus pairing rated `favourable` and survived a closed sky while the
 * Moon passes a bright planet most months, and a modest occultation rating
 * `good-example` would have vanished.
 *
 * Nothing here touches the ranking. An opportunity that survives cloud keeps
 * the position its significance and qualities earned it; it is not promoted for
 * having been preserved.
 */
export function cloudAdvice(
  timeline: CloudTimeline,
  persistence: ObstructionPersistence,
  timeZone: string | null,
  interval?: { startUtc: string; endUtc: string } | null,
  context?: CloudAdviceContext,
): CloudAdvice {
  // Judged over the opportunity's own interval where it has one, and over the
  // night only when it does not.
  const local = interval
    ? cloudOver(timeline, interval.startUtc, interval.endUtc)
    : {
        verdict: timeline.verdict,
        samples: timeline.samples.length,
        worst: null,
        bases: timeline.bases,
      };

  const localEvidence = applicableLocalEvidence(timeline, context);
  if (localEvidence?.finding === "clear-gaps") {
    return {
      suppress: false,
      obscuration: "possible",
      warning: "Sky clearer than forecast — clear gaps are visible now. This does not visually verify the target.",
      goAnyway: false,
    };
  }

  const directionBlocked =
    localEvidence?.finding === "heavy-cloud" &&
    localEvidence.scope === "target-direction" &&
    localEvidence.confidence === "high";
  if (directionBlocked) {
    const rare = persistence === "time-critical";
    return {
      suppress: !rare,
      obscuration: "likely",
      warning: rare
        ? "The target direction appears substantially blocked right now. Worth checking again because this event is time-critical."
        : "The target direction appears substantially blocked right now.",
      goAnyway: rare,
    };
  }

  if (local.verdict === "unknown") {
    return { suppress: false, obscuration: "unknown", warning: null, goAnyway: false };
  }
  if (local.verdict === "open") {
    return { suppress: false, obscuration: "none", warning: null, goAnyway: false };
  }

  const change = nextChange(timeline);
  const opening =
    change?.kind === "clearing"
      ? ` The sky is expected to open around ${clock(change.atUtc, timeZone)}.`
      : "";

  if (local.verdict === "closed") {
    /**
     * These samples describe cloud over an area or one vertical model column,
     * not the selected object's line of sight. Even 95% forecast cover cannot
     * prove that Saturn's direction is blocked: a gap in the remaining sky is
     * enough for a bright target, and the Moon is routinely visible through
     * thin or broken cloud. This evidence can lower quality and raise a warning;
     * it cannot delete the astronomical answer.
     *
     * Hard suppression is reserved for `directionBlocked` above, where fresh,
     * high-confidence local evidence explicitly covers the selected direction.
     */
    const observed = local.bases.includes("observed");
    const urgency =
      persistence === "time-critical"
        ? " Worth going anyway because this event is time-critical."
        : "";
    return {
      suppress: false,
      obscuration: "possible",
      warning: observed
        ? `Satellite observations show substantial cloud over the area, but not whether this target's direction is blocked. Clear gaps may still make it worth checking.${opening}${urgency}`
        : `Cloud is forecast across the area, but this is not direction-specific. Clear gaps may still make this target worth checking.${opening}${urgency}`,
      goAnyway: persistence === "time-critical",
    };
  }

  // Intermittent: the sky is changing, so it may well be open when the reader
  // is out. Kept for every tier, with the change named where one is expected.
  return {
    suppress: false,
    obscuration: "possible",
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
