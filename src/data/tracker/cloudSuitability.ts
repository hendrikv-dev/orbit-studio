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
 * What each level says, in words a reader does not have to decode.
 *
 * These were "Sky open / Mostly open / Gaps to work around / Sky closed". The
 * middle two were the problem: "gaps to work around" is a phrase an observer
 * with a plan understands and nobody else does, and it appeared as the primary
 * label of a warning system — the one place vagueness costs the most.
 *
 * The vocabulary is now the plainest thing that still distinguishes four
 * states. Specific language still belongs in the warning copy, where there is
 * room to say what is actually happening and when: "Clouds moving in",
 * "Clouds clearing", "Poor cloud conditions during peak". A label is for
 * recognising a state at a glance; a warning is for acting on it.
 */
export const SUITABILITY_LABEL: Record<Suitability, string> = {
  good: "Mostly clear",
  fair: "Some cloud",
  poor: "Mostly cloudy",
  bad: "Overcast",
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
 * How long conditions must persist before a warning is raised, and cleared.
 *
 * ## Why this is time and not samples
 *
 * The previous rule was "two bad samples to warn, three good to relent", and
 * the intent was right while the unit was wrong. A sample is not a fixed amount
 * of the night. NOAA scans the CONUS every five minutes; the forecast lattice
 * is hourly. Under a raw-count rule the same words meant
 *
 *     two observations  = ten minutes
 *     two forecast hours = two hours
 *
 * so the layer was twelve times more eager to warn about the observed half of
 * the night than the forecast half, and would become something else again the
 * day a third cadence arrived. Persistence has to be measured in the thing the
 * reader experiences, which is elapsed time.
 *
 * ## The two durations, and why they differ
 *
 * Forty minutes of deteriorating sky raises a warning; ninety minutes of
 * improving sky clears one. The asymmetry is deliberate and it is not
 * symmetric caution: being told the sky is closed when it opens costs an
 * evening indoors, and being told it is open when it is closed costs a drive,
 * a setup, and an event that does not come round again. Stronger evidence is
 * required for the claim whose failure is unrecoverable.
 *
 * Forty minutes is long enough that a single cloud crossing a two-kilometre
 * pixel does not trigger it, and short enough to be useful while a front is
 * arriving. Ninety is a little over one forecast step, so a clearance has to be
 * supported by more than one hour of a model changing its mind.
 */
export const RAISE_AFTER_MINUTES = 40;
export const CLEAR_AFTER_MINUTES = 90;

/**
 * How long a sample is taken to stand for when the next one is missing.
 *
 * A series ends somewhere, and the last sample still describes a stretch of
 * time. Without a cap it would either stand for nothing — losing the end of
 * every window — or for the rest of the night, which is a claim about hours
 * nobody sampled. One hour is the coarsest real cadence in use, so it is the
 * longest a single sample can honestly speak for.
 */
export const MAX_SAMPLE_SPAN_MINUTES = 60;

/**
 * A gap long enough that the samples either side are not one stretch.
 *
 * A missing scan is a hole in the evidence, not a continuation of whatever came
 * before it. Beyond this the accumulated persistence resets rather than
 * carrying across the gap: three hours of silence must not be read as three
 * hours of the last thing seen.
 */
export const GAP_RESETS_AFTER_MINUTES = 90;

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
 * How much time each sample stands for.
 *
 * The distance to the next sample, capped — so a five-minute scan counts for
 * five minutes and an hourly forecast step counts for an hour, which is what
 * makes the durations above mean the same thing on both halves of the night.
 */
function spanMinutes(samples: readonly CloudSample[], index: number): number {
  const at = Date.parse(samples[index].atUtc);
  const nextAt = index + 1 < samples.length ? Date.parse(samples[index + 1].atUtc) : null;
  /** This sample's own cadence, from the step that produced it. */
  const cadence =
    index > 0 ? (at - Date.parse(samples[index - 1].atUtc)) / 60_000 : MAX_SAMPLE_SPAN_MINUTES;
  const own = Math.min(Math.max(cadence, 0) || MAX_SAMPLE_SPAN_MINUTES, MAX_SAMPLE_SPAN_MINUTES);

  // The last sample stands for one more step of its own cadence, not for the
  // rest of the night.
  if (nextAt === null) return own;

  const toNext = (nextAt - at) / 60_000;
  if (!Number.isFinite(toNext) || toNext <= 0) return 0;

  /**
   * A sample immediately before a gap speaks for its own cadence, not for the
   * hole after it.
   *
   * Without this, a five-minute scan followed by four hours of silence banked a
   * full capped hour of "the sky was like that" before the gap reset had a
   * chance to run — so an outage read as an hour of whatever was last seen, and
   * two scans either side of a dead feed could raise a warning between them.
   */
  if (toNext > GAP_RESETS_AFTER_MINUTES) return own;

  return Math.min(toNext, MAX_SAMPLE_SPAN_MINUTES);
}

/**
 * The stretches of the window where the sky is not worth planning around.
 *
 * A state machine over elapsed time rather than over sample counts, so the
 * answer depends on how long conditions held instead of on how often the
 * source happens to publish. Samples must already be in time order; they come
 * off a timeline that is built in order.
 */
export function warningsIn(samples: readonly CloudSample[]): CloudWarning[] {
  const warnings: CloudWarning[] = [];
  let warning = false;
  /** Minutes of the current run, bad while clear of a warning, good while in one. */
  let held = 0;
  /** Where the current run began, as an index into `samples`. */
  let runStart = 0;
  let warningStart = 0;

  const close = (endIndex: number) => {
    const span = samples.slice(warningStart, endIndex + 1);
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
    // A hole in the evidence is not a continuation of what came before it.
    if (index > 0) {
      const gap = (Date.parse(sample.atUtc) - Date.parse(samples[index - 1].atUtc)) / 60_000;
      if (gap > GAP_RESETS_AFTER_MINUTES) {
        held = 0;
        runStart = index;
      }
    }

    const bad = unusable(sample.suitability);
    const minutes = spanMinutes(samples, index);

    if (warning) {
      if (bad) {
        held = 0;
        runStart = index;
        return;
      }
      if (held === 0) runStart = index;
      held += minutes;
      if (held >= CLEAR_AFTER_MINUTES) {
        // The warning ends where the clear run began, not where it was
        // confirmed: the sky opened at the first clear sample, and dating it
        // later would hold a warning over time the evidence says was fine.
        close(Math.max(warningStart, runStart - 1));
        warning = false;
        held = 0;
        runStart = index;
      }
      return;
    }

    if (!bad) {
      held = 0;
      runStart = index;
      return;
    }
    if (held === 0) runStart = index;
    held += minutes;
    if (held >= RAISE_AFTER_MINUTES) {
      warning = true;
      warningStart = runStart;
      held = 0;
      runStart = index;
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
  open: "Clear for most of tonight",
  intermittent: "Cloud on and off tonight",
  closed: "Cloudy for most of tonight",
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
