import type { CloudCategory } from "./goesGrid";

/**
 * Cloud as an observing warning, rather than as a weather report.
 *
 * ## What this module is for
 *
 * Tracker's question is never "how cloudy is it". It is "will the sky be open
 * when the thing I want to look at is up". Those have different answers: forty
 * percent cloud at eleven o'clock is irrelevant if the conjunction sets at ten,
 * and a clear hour is worth driving to even if the night around it is closed.
 * So cloud enters the product as a judgement about a *window*, made of samples
 * that each carry the time they are for.
 *
 * ## Two evidence paths that never merge
 *
 * An observation is NOAA's per-pixel classification of what the satellite
 * actually saw. A forecast is a model's percentage of what it expects. They are
 * different kinds of claim, and averaging them would produce a number that is
 * neither — so they stay labelled, all the way to the interface, and the only
 * thing they share is the four-level suitability scale below.
 *
 * That scale is not a percentage and must never be printed as one. It exists so
 * a categorical observation and a numeric forecast can be laid on one timeline
 * without either being rewritten into the other's units.
 */

/** How usable the sky is, on the one scale both evidence paths map onto. */
export type Suitability = "good" | "fair" | "poor" | "bad";

export type CloudBasis = "observed" | "forecast";

export const SUITABILITY_ORDER: Record<Suitability, number> = {
  good: 0,
  fair: 1,
  poor: 2,
  bad: 3,
};

/**
 * What each level says, in observing terms.
 *
 * Deliberately about what a reader can do, not about how much sky is covered.
 * "Broken cloud" is a description; "gaps to work around" is an instruction.
 */
export const SUITABILITY_LABEL: Record<Suitability, string> = {
  good: "Sky open",
  fair: "Mostly open",
  poor: "Gaps to work around",
  bad: "Sky closed",
};

/**
 * The observed mapping, which is a relabelling and not a conversion.
 *
 * The mask's four levels already describe a pixel's own state, so each maps to
 * exactly one suitability. The two "probably" levels sit at a cloud boundary —
 * one clear pixel next to a cloudy one — which for an observer is precisely the
 * case where the sky is changing over their head, so they land in the middle of
 * the scale rather than being rounded to the nearest confident answer.
 */
export function suitabilityOfCategory(category: CloudCategory): Suitability {
  switch (category) {
    case "clear":
      return "good";
    case "probably_clear":
      return "fair";
    case "probably_cloudy":
      return "poor";
    case "cloudy":
      return "bad";
  }
}

/**
 * The forecast mapping, with thresholds chosen for observing rather than for
 * an even split.
 *
 * A fifth of the sky covered still leaves most targets reachable, so twenty is
 * the top of "good". Past eighty there is nothing to plan around. The middle
 * two bands are wide because an hourly model over a twelve-by-eight lattice
 * cannot resolve the difference between forty and fifty percent in any way that
 * would change what a reader does.
 */
export function suitabilityOfPercent(percent: number): Suitability {
  if (percent <= 20) return "good";
  if (percent <= 50) return "fair";
  if (percent <= 80) return "poor";
  return "bad";
}

export interface CloudSample {
  /** The instant this sample describes. */
  atUtc: string;
  basis: CloudBasis;
  suitability: Suitability;
  /** The mask's own category, when this came from the satellite. */
  category?: CloudCategory;
  /** The model's own percentage, when this came from the forecast. */
  percent?: number;
}

/* -------------------------------------------------------------- warnings */

/**
 * How many samples in a row it takes to raise a warning, and to stand one down.
 *
 * These are deliberately different. A single cloudy frame between clear ones is
 * a cloud crossing the pixel, not the end of the night, and warning on it would
 * make the layer flicker as frames arrive. But a single clear frame in a cloudy
 * stretch is a gap, and standing the warning down on it would tell a reader the
 * sky had opened when it had not.
 *
 * So: two to warn, three to relent. The asymmetry is the whole point. Being
 * told the sky is closed when it opens costs a reader an evening indoors; being
 * told it is open when it is closed costs them a drive, a setup, and the event
 * itself, which is not recoverable.
 */
export const RAISE_RUN = 2;
export const CLEAR_RUN = 3;

const unusable = (suitability: Suitability) => SUITABILITY_ORDER[suitability] >= SUITABILITY_ORDER.poor;

export interface CloudWarning {
  fromUtc: string;
  toUtc: string;
  /** The worst level inside the span. */
  severity: Suitability;
  /** Which evidence paths contributed, so the interface can say. */
  bases: CloudBasis[];
}

/**
 * The stretches of the window where the sky is not worth planning around.
 *
 * A state machine with two counters rather than a threshold on each sample, so
 * that the answer depends on persistence instead of on whichever frame the
 * reader happened to load. Samples must already be in time order; they come off
 * a timeline that is built in order.
 */
export function warningsIn(samples: readonly CloudSample[]): CloudWarning[] {
  const warnings: CloudWarning[] = [];
  let warning = false;
  let run = 0;
  let start = 0;

  const close = (endIndex: number) => {
    const span = samples.slice(start, endIndex + 1);
    if (!span.length) return;
    const severity = span.reduce<Suitability>(
      (worst, sample) =>
        SUITABILITY_ORDER[sample.suitability] > SUITABILITY_ORDER[worst] ? sample.suitability : worst,
      "good",
    );
    warnings.push({
      fromUtc: span[0].atUtc,
      toUtc: span[span.length - 1].atUtc,
      severity,
      bases: [...new Set(span.map((sample) => sample.basis))],
    });
  };

  samples.forEach((sample, index) => {
    const bad = unusable(sample.suitability);
    if (warning) {
      run = bad ? 0 : run + 1;
      if (run >= CLEAR_RUN) {
        // The warning ends where the clear run began, not where it was
        // confirmed — the sky opened at the first clear frame, and dating it
        // later would hold a warning over hours the satellite says were fine.
        close(Math.max(start, index - CLEAR_RUN));
        warning = false;
        run = 0;
      }
      return;
    }
    run = bad ? run + 1 : 0;
    if (run >= RAISE_RUN) {
      warning = true;
      // Clamped so a tuned-down RAISE_RUN can never index before the window and
      // hand `slice` a negative start, which counts from the end.
      start = Math.max(0, index - (RAISE_RUN - 1));
      run = 0;
    }
  });

  if (warning) close(samples.length - 1);
  return warnings;
}

/** What the whole window amounts to, once the warnings are known. */
export type WindowVerdict = "open" | "intermittent" | "closed" | "unknown";

/**
 * What each verdict says out loud.
 *
 * Phrased as an answer to "can I observe tonight", because that is the question
 * the reader brought. "Clear through the window" is a plan; "18% mean cloud
 * cover" is a number they would have to interpret into one.
 */
export const CLOUD_VERDICT_LINE: Record<WindowVerdict, string> = {
  open: "Sky open through the window",
  intermittent: "Cloud comes and goes tonight",
  closed: "Clouded out for most of the window",
  unknown: "No cloud information for tonight",
};

/**
 * The window's own verdict.
 *
 * Counted in samples rather than in clock time because the two evidence paths
 * have different cadences, and weighting by duration would quietly give an
 * hourly forecast point six times the say of a ten-minute observation.
 */
export function verdictOf(samples: readonly CloudSample[], warnings: readonly CloudWarning[]): WindowVerdict {
  if (!samples.length) return "unknown";
  if (!warnings.length) return "open";
  const inside = new Set<string>();
  for (const warning of warnings) {
    for (const sample of samples) {
      if (sample.atUtc >= warning.fromUtc && sample.atUtc <= warning.toUtc) inside.add(sample.atUtc);
    }
  }
  const covered = inside.size / samples.length;
  return covered >= 0.75 ? "closed" : "intermittent";
}
