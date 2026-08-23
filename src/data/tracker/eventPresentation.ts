import {
  cadenceRangeDescription,
  compassPoint,
  type MeteorNight,
} from "./meteorActivity";
import type { BestWindow, EnvironmentalEvidenceStatus, ViewabilityBand } from "./conditions";
import {
  recommendationFor,
  type SkyAdjustedOpportunity,
} from "./opportunity";
import { categoryForOpportunityKind, type EventCategoryId } from "./eventCategories";
import type { AuroraAssessment, AuroraVisibility } from "./aurora";
import type { LocalSolarCircumstances, SolarEclipseEvent } from "./solarEclipse";
import { formatClockTime, formatWindowPhrase, type PlaceClock } from "../../lib/localTime";

/**
 * The fixed slots of the hero card, filled by whatever the event happens to be.
 *
 * The specification for this interface fixes the hero's structure and lets only
 * its content vary: a name, one or two state pills, a decision-oriented
 * recommendation, an optional supporting line, exactly three metrics, and two
 * actions. This type is that structure, and every phenomenon has to produce one
 * — which is what makes "the eclipse page has not drifted from the meteor page"
 * a property of the code rather than a thing to check by eye.
 *
 * The three metrics are a tuple on purpose. A phenomenon that wants a fourth has
 * to argue for it in the type system first, and none of them has needed to.
 */

export interface EventPill {
  label: string;
  /** `live` is happening now, `state` is a fact about the event, `caution` warns. */
  tone: "live" | "state" | "caution";
}

export type MetricTone = "plain" | "good" | "fair" | "poor" | "unknown";

export interface EventMetric {
  label: string;
  value: string;
  tone: MetricTone;
}

export interface EventAction {
  label: string;
  /** What opening it actually does; the page owns the behaviour. */
  kind: "sky-map" | "coverage-map" | "forecast-map" | "reminder";
}

export interface EventPresentation {
  id: string;
  categoryId: EventCategoryId;
  title: string;
  /** At most two. The layout allows no more and the type says so. */
  pills: EventPill[];
  /** The decision, in one or two sentences. Never a grade. */
  recommendation: string;
  /**
   * The judgement the sentence was generated from.
   *
   * Kept alongside the prose rather than only inside it, because the review
   * harness asserts an invariant on it — an unknown sky may never produce a
   * confident recommendation — and asserting that by matching English would
   * mean the check breaks every time the wording improves.
   */
  recommendationLevel: string;
  /** One short supporting line, or nothing. */
  support: string | null;
  metrics: [EventMetric, EventMetric, EventMetric];
  primaryAction: EventAction;
  secondaryAction: EventAction;
  /** The instant the conditions row is about. */
  atUtc: string;
  /** Row content for the ranked list, so the two can never disagree. */
  row: { state: string; window: string; quality: EventMetric };
  /** What a reminder file would contain. */
  reminder: { title: string; description: string; startUtc: string; durationMinutes: number };
}

/* ------------------------------------------------------------------ shared */

const BAND_LABEL: Record<ViewabilityBand, { value: string; tone: MetricTone }> = {
  excellent: { value: "Excellent", tone: "good" },
  good: { value: "Good", tone: "good" },
  possible: { value: "Fair", tone: "fair" },
  unlikely: { value: "Poor", tone: "poor" },
  unknown: { value: "Not known", tone: "unknown" },
};

/**
 * How good the opportunity actually is, from the band the ranking computed.
 *
 * Labelled "Worth it" rather than "Visibility". The band is
 * `min(sky access, phenomenon strength)` — it has always described the whole
 * opportunity rather than the weather — but under the old label a reader saw
 * "Visibility: Excellent" and read it as a statement about the sky. On aurora
 * that produced a direct contradiction: a clear night over a quiet field said
 * Excellent beside a page explaining the oval was too far north to see.
 *
 * Read off `viewability` rather than derived again here. Two places deciding
 * independently what "good" means is how a card came to say *excellent* beside
 * a sentence saying the sky would spoil it.
 */
export function visibilityMetric(
  window: BestWindow | null,
  evidenceStatus: EnvironmentalEvidenceStatus,
  passed: boolean,
): EventMetric {
  if (passed) return { label: "Worth it", value: "Already set", tone: "unknown" };
  if (!window || evidenceStatus === "not-supported" || evidenceStatus === "request-failed") {
    return { label: "Worth it", value: "Not known", tone: "unknown" };
  }
  const band = BAND_LABEL[window.viewability.band];
  return { label: "Worth it", value: band.value, tone: band.tone };
}

function windowText(window: BestWindow | null, whenUtc: string, clock: PlaceClock): string {
  if (!window) return formatClockTime(whenUtc, clock);
  if (window.brief) return formatClockTime(window.peakUtc, clock);
  return formatWindowPhrase(window, clock);
}

/* --------------------------------------------------------------- tonight */

export interface TonightContext {
  clock: PlaceClock;
  now: Date;
  /**
   * What to call the night being described: "tonight", "on 8 Apr 2024".
   *
   * The presentation layer used to hard-code "tonight", which was true while
   * the interface could only show tonight and became a small lie the moment it
   * could show any date. Passed in rather than derived here, so the pill, the
   * row and the heading all say the same words.
   */
  nightLabel?: string;
  meteors: MeteorNight;
  evidenceStatus: EnvironmentalEvidenceStatus;
}

/**
 * An opportunity from tonight's ranking, in the universal hero's shape.
 *
 * The recommendation sentence is the existing `recommendationFor` judgement
 * turned into a sentence rather than a badge. The badge was the previous
 * design's answer and it graded rather than advised — "Worth going out for" is
 * a verdict, "Still active tonight; best after midnight from darker skies" is
 * the thing somebody putting a coat on actually needs.
 */
export function presentTonightEvent(
  entry: SkyAdjustedOpportunity,
  window: BestWindow | null,
  passed: boolean,
  context: TonightContext,
): EventPresentation {
  const { opportunity } = entry;
  const { guidance } = opportunity;
  const categoryId = categoryForOpportunityKind(opportunity.kind);
  const whenUtc = window?.peakUtc ?? guidance.whenUtc;
  const level = recommendationFor(
    entry.band,
    passed,
    window ? window.viewability.access : null,
    window?.viewability.evidenceStatus ?? context.evidenceStatus,
  );

  const pills: EventPill[] = [];
  const opensAt = window ? window.startUtc : guidance.whenUtc;
  const closesAt = window ? window.endUtc : guidance.whenUtc;
  if (passed) {
    pills.push({ label: "Already set", tone: "caution" });
  } else if (
    context.now.getTime() >= Date.parse(opensAt) &&
    context.now.getTime() <= Date.parse(closesAt)
  ) {
    pills.push({ label: "Active now", tone: "live" });
  } else {
    pills.push({
      label: context.nightLabel
        ? context.nightLabel === "tonight"
          ? "Tonight"
          : context.nightLabel.replace(/^on /, "")
        : "Tonight",
      tone: "state",
    });
  }

  const metrics = metricsFor(entry, window, passed, context);
  const support = supportLineFor(entry, context);

  return {
    id: opportunity.id,
    categoryId,
    title: opportunity.title,
    pills: [...pills, ...secondPillFor(entry, context)].slice(0, 2),
    recommendation: recommendationSentence(level, opportunity.summary, guidance.howLong),
    recommendationLevel: level,
    support,
    metrics,
    primaryAction:
      categoryId === "meteors"
        ? // A shower has a radiant and therefore a direction; the sporadic
          // background has neither. Offering "View sky map" on a night with no
          // shower promises a target that does not exist — and the page itself
          // says so two lines above, in "the sky is the limit tonight, not the
          // target". The drill-in is still worth opening, because how to watch
          // sporadics is real advice, so the label says that instead of
          // promising a map.
          opportunity.geometry?.kind === "radiant"
          ? { label: "Where to look", kind: "sky-map" }
          : { label: "How to watch", kind: "sky-map" }
        : categoryId === "eclipses"
          ? { label: "View visibility map", kind: "coverage-map" }
          : { label: "View sky map", kind: "sky-map" },
    secondaryAction: { label: "Set reminder", kind: "reminder" },
    atUtc: whenUtc,
    row: {
      state: rowStateFor(entry, passed, context),
      window: passed ? "Already set" : windowText(window, guidance.whenUtc, context.clock),
      quality: visibilityMetric(window, context.evidenceStatus, passed),
    },
    reminder: {
      title: `${opportunity.title} — Orbit Studio Tracker`,
      description: [
        opportunity.summary,
        guidance.direction ? `Face ${guidance.direction}.` : "",
        guidance.elevation,
        guidance.appearance,
      ]
        .filter(Boolean)
        .join("\n\n"),
      startUtc: whenUtc,
      durationMinutes: guidance.durationMinutes,
    },
  };
}

/**
 * The decision sentence.
 *
 * The recommendation level supplies the verb and the summary supplies the
 * subject, so the sentence changes when the judgement changes rather than being
 * a fixed description with a grade bolted on.
 */
function recommendationSentence(
  level: ReturnType<typeof recommendationFor>,
  summary: string,
  howLong: string,
): string {
  const advice = howLong.split(".")[0];
  switch (level) {
    case "Exceptional":
      return `${summary} ${advice}.`;
    case "Worth going out for":
      return `${summary} ${advice}.`;
    case "Good if you're already outside":
      return `${summary} Worth a look if you are already out; not worth a special trip.`;
    case "Only if conditions improve":
      return `${summary} The sky is the problem tonight, not the target — go only if it clears.`;
    case "Astronomically promising — conditions unknown":
      return `${summary} Conditions unknown — no forecast reached here, so check before going.`;
    case "Conditions unknown — check before going":
      return `${summary} Conditions unknown — no forecast reached here, so check before going.`;
    default:
      return `${summary} Not worth a special trip from here tonight.`;
  }
}

/**
 * The second pill: one fact about the event's own state.
 *
 * Deliberately about the phenomenon rather than the weather. "Past peak" is
 * something a reader can act on — they now know the number they may have seen
 * elsewhere is not tonight's — where a second weather badge would only repeat
 * the conditions row three centimetres below it.
 */
function secondPillFor(entry: SkyAdjustedOpportunity, context: TonightContext): EventPill[] {
  const { opportunity } = entry;
  if (opportunity.kind === "meteors") {
    const headline = context.meteors.headline;
    if (headline && headline.daysFromPeak > 0.5) return [{ label: "Past peak", tone: "state" }];
    if (headline && headline.daysFromPeak < -0.5) return [{ label: "Before peak", tone: "state" }];
    if (headline) return [{ label: "At peak", tone: "live" }];
    return [{ label: "Background rate", tone: "state" }];
  }
  if (opportunity.kind === "lunar-eclipse") return [{ label: "Visible from here", tone: "state" }];
  if (opportunity.guidance.equipment === "telescope") {
    return [{ label: "Telescope", tone: "caution" }];
  }
  if (opportunity.guidance.equipment === "binoculars") {
    return [{ label: "Binoculars", tone: "caution" }];
  }
  return [];
}

/**
 * The three metrics.
 *
 * The middle one is the only slot that changes meaning between phenomena, and
 * it changes to whatever the reader would actually check second: a rate for a
 * shower, a height for a planet, coverage for an eclipse.
 */
function metricsFor(
  entry: SkyAdjustedOpportunity,
  window: BestWindow | null,
  passed: boolean,
  context: TonightContext,
): [EventMetric, EventMetric, EventMetric] {
  const { opportunity } = entry;
  const best: EventMetric = {
    label: "Best window",
    value: passed
      ? "Passed tonight"
      : windowText(window, opportunity.guidance.whenUtc, context.clock),
    tone: "plain",
  };
  const visibility = visibilityMetric(window, context.evidenceStatus, passed);

  if (opportunity.kind === "meteors") {
    return [best, meteorRateMetric(context, window), visibility];
  }

  if (opportunity.kind === "lunar-eclipse" && opportunity.science?.kind === "lunar-eclipse") {
    const percent = Math.round(opportunity.science.obscurationFraction * 100);
    return [
      best,
      { label: "Maximum", value: `${percent}% covered`, tone: "plain" },
      visibility,
    ];
  }

  const highest = highestAltitude(entry);
  if (highest !== null) {
    return [
      best,
      {
        label: "Highest",
        value: `${Math.round(highest.altitudeDeg)}° ${compassPoint(highest.azimuthDeg)}`,
        tone: "plain",
      },
      visibility,
    ];
  }

  return [
    best,
    {
      label: "Needs",
      value:
        opportunity.guidance.equipment === "eyes"
          ? "Eyes only"
          : opportunity.guidance.equipment === "binoculars"
            ? "Binoculars"
            : "Telescope",
      tone: "plain",
    },
    visibility,
  ];
}

/**
 * The rate a person will actually see, at the time they will be outside.
 *
 * Read at the recommended window rather than at the night's best, because those
 * are different numbers on a night whose best hour is clouded out — and the
 * whole point of moving the window is that the reader is not there at the peak.
 */
function meteorRateMetric(context: TonightContext, window: BestWindow | null): EventMetric {
  const { samples } = context.meteors;
  if (samples.length === 0) {
    return { label: "Expected rate", value: "Not dark enough", tone: "unknown" };
  }
  const target = Date.parse(window?.peakUtc ?? context.meteors.best?.atUtc ?? samples[0].atUtc);
  const sample = samples.reduce((closest, entry) =>
    Math.abs(Date.parse(entry.atUtc) - target) < Math.abs(Date.parse(closest.atUtc) - target)
      ? entry
      : closest,
  );
  // The same one-sided band the rest of the product uses: the modelled number is
  // a dark-sky ceiling, and everything unmodelled can only take away from it.
  const high = Math.round(sample.totalPerHour);
  const low = Math.round(sample.totalPerHour / 2.5);
  return {
    label: "Expected rate",
    value: high <= 0 ? "Nothing worth waiting for" : `${low}–${high} / hr`,
    tone: "plain",
  };
}

function highestAltitude(
  entry: SkyAdjustedOpportunity,
): { altitudeDeg: number; azimuthDeg: number } | null {
  let best: { altitudeDeg: number; azimuthDeg: number } | null = null;
  for (const sample of entry.opportunity.profile) {
    if (sample.altitudeDeg === undefined || sample.azimuthDeg === undefined) continue;
    if (!best || sample.altitudeDeg > best.altitudeDeg) {
      best = { altitudeDeg: sample.altitudeDeg, azimuthDeg: sample.azimuthDeg };
    }
  }
  return best && best.altitudeDeg > 0 ? best : null;
}

/** The one extra line under the recommendation, where there is one worth having. */
function supportLineFor(entry: SkyAdjustedOpportunity, context: TonightContext): string | null {
  const { opportunity } = entry;
  if (opportunity.kind === "meteors") {
    const headline = context.meteors.headline;
    if (headline && Math.abs(headline.daysFromPeak) > 0.5) {
      const days = Math.round(Math.abs(headline.daysFromPeak));
      return headline.daysFromPeak > 0
        ? `Peak was ${days} ${days === 1 ? "day" : "days"} ago.`
        : `Peak is in ${days} ${days === 1 ? "day" : "days"}.`;
    }
    const range = context.meteors.ratePerHourRange;
    return range ? `At best, ${cadenceRangeDescription(range[0], range[1])}.` : null;
  }
  if (opportunity.guidance.equipment !== "eyes") return opportunity.guidance.appearance;
  return null;
}

function rowStateFor(
  entry: SkyAdjustedOpportunity,
  passed: boolean,
  context: TonightContext,
): string {
  if (passed) return "Below the horizon";
  const { opportunity } = entry;
  if (opportunity.kind === "meteors") {
    const headline = context.meteors.headline;
    if (!headline) return "Background activity";
    if (headline.perHour >= 10) return "Active tonight";
    if (headline.perHour >= 3) return "Minor shower";
    return "Faint meteors";
  }
  if (opportunity.kind === "lunar-eclipse") return "Visible from here";
  if (opportunity.kind === "conjunction") return "Close pairing";
  if (opportunity.kind === "moon") return opportunity.summary.split(".")[0];
  return entry.band === "exceptional" || entry.band === "very good"
    ? "Well placed"
    : context.nightLabel && context.nightLabel !== "tonight"
      ? `Visible ${context.nightLabel}`
      : "Visible tonight";
}

/* ---------------------------------------------------------------- aurora */

/**
 * Aurora in the same hero shape as everything else.
 *
 * ## What the first metric is, and what it is not
 *
 * It is the interval the *source* covers, and for a nowcast that is about half
 * an hour. The first version put the whole of astronomical darkness there under
 * the label "Best window", which took a claim NOAA makes about the next thirty
 * minutes and presented it as a claim about the next eight hours. Darkness is a
 * precondition, not a forecast: the sky being dark from 9:51 PM says nothing
 * about whether the oval will be overhead at 3 AM.
 *
 * Darkness has not been dropped — it moves to the supporting line, where it
 * reads as the constraint it is.
 *
 * ## The metrics change label with the horizon
 *
 * A nowcast reports NOAA's probability at the observer; a three-day forecast
 * reports Kp and nothing spatial, because nothing spatial is known that far
 * out. A fixed label showing a Kp-derived guess would be the dishonest way to
 * keep the row tidy.
 */
export function presentAuroraEvent(
  assessment: AuroraAssessment,
  atUtc: string,
  clock: PlaceClock,
  /** When the sky is actually dark, which is a precondition and not a forecast. */
  darkness: { startUtc: string; endUtc: string } | null,
  visibility: EventMetric,
  /**
   * Whether it could be *seen* from here, which OVATION does not answer.
   *
   * Optional so that callers without a grid — the Upcoming K-index page, which
   * has a date and no field — keep the assessment's own wording rather than
   * being forced to invent a geometry they have no data for.
   */
  visibilityModel: AuroraVisibility | null = null,
): EventPresentation {
  const pills: EventPill[] = [];
  if (assessment.freshness === "stale") {
    pills.push({ label: "Nowcast expired", tone: "caution" });
  } else if (assessment.freshness === "unavailable") {
    pills.push({ label: "No nowcast", tone: "caution" });
  } else if (assessment.horizon === "nowcast") {
    pills.push({
      label: assessment.freshness === "aging" ? "Nowcast · ageing" : "Nowcast",
      tone: assessment.freshness === "aging" ? "state" : "live",
    });
  } else if (assessment.horizon === "short-range") {
    pills.push({ label: "3-day outlook", tone: "state" });
  } else {
    pills.push({ label: "Beyond forecast", tone: "caution" });
  }

  if (assessment.outlook === "north-of-you") {
    pills.push({ label: "Poleward of you", tone: "state" });
  } else if (assessment.outlook === "quiet") {
    pills.push({ label: "Quiet", tone: "state" });
  }

  // The interval the source covers, labelled as what it is.
  const window: EventMetric =
    assessment.validity && assessment.freshness !== "stale"
      ? {
          label: "Nowcast covers",
          value: `${formatClockTime(assessment.validity.fromUtc, clock)}–${formatClockTime(assessment.validity.toUtc, clock)}`,
          tone: "plain",
        }
      : assessment.horizon === "short-range"
        ? {
            label: "Forecast for",
            value: new Intl.DateTimeFormat(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              timeZone: clock.timeZone ?? "UTC",
            }).format(new Date(atUtc)),
            tone: "plain",
          }
        : { label: "Nowcast covers", value: "Expired", tone: "unknown" };

  const middle: EventMetric =
    assessment.probabilityPercent !== null
      ? {
          label: "NOAA chance here",
          value: `${assessment.probabilityPercent}%`,
          tone:
            assessment.probabilityPercent >= 25
              ? "good"
              : assessment.probabilityPercent >= 10
                ? "fair"
                : "poor",
        }
      : assessment.freshness === "stale" && assessment.reportedProbabilityPercent !== null
        ? {
            // Shown as history, not as advice: the label says when, the tone is
            // the same "not known" the rest of the row uses for absent evidence.
            label: "NOAA last reported",
            value: `${assessment.reportedProbabilityPercent}%`,
            tone: "unknown",
          }
        : assessment.kp !== null && assessment.horizon === "short-range"
          ? {
              label: "Forecast Kp",
              value: assessment.kp.toFixed(1),
              tone: assessment.kp >= 5 ? "good" : assessment.kp >= 4 ? "fair" : "poor",
            }
          : { label: "Activity", value: "Not known", tone: "unknown" };

  const darknessLine = darkness
    ? `Dark from ${formatClockTime(darkness.startUtc, clock)} to ${formatClockTime(darkness.endUtc, clock)}.`
    : null;

  const usable = assessment.freshness !== "stale" && assessment.freshness !== "unavailable";

  return {
    id: "aurora",
    categoryId: "auroras",
    title: "Aurora",
    pills: pills.slice(0, 2),
    // The visibility model answers the reader's question where it can; the
    // assessment answers OVATION's. "The oval is not over you" is true and
    // unhelpful next to "it would stand 8° above your northern horizon".
    //
    // Only where it has something to add, though. For expired and unavailable
    // data the assessment already says the right thing — that no claim is
    // being made — and the visibility model would only restate it in different
    // words, replacing wording those cases are separately tested for.
    recommendation:
      visibilityModel && visibilityModel.kind !== "expired" && visibilityModel.kind !== "unavailable"
        ? visibilityModel.statement
        : assessment.statement,
    // Aurora is never "confident": the nowcast is half an hour of validity and
    // the three-day product says nothing about where the oval will be. A stale
    // or missing nowcast is not a weaker version of that — it is no claim.
    recommendationLevel:
      usable && assessment.horizon === "nowcast" && visibilityModel?.kind === "overhead"
        ? "Good if you're already outside"
        : usable && visibilityModel?.kind === "horizon"
          ? "Worth a look if you have a clear horizon"
          : "Conditions unknown — check before going",
    support: darknessLine ? `${assessment.certainty} ${darknessLine}` : assessment.certainty,
    metrics: [window, middle, visibility],
    // "View forecast map" contradicted the panel it opens, which states that
    // the OVATION field describes now rather than tonight. The control names
    // what it shows.
    primaryAction: { label: "View current oval", kind: "forecast-map" },
    secondaryAction: { label: "Set reminder", kind: "reminder" },
    atUtc,
    row: {
      state:
        assessment.freshness === "stale"
          ? "Nowcast expired"
          : assessment.outlook === "plausible-tonight"
            ? "Possible now"
            : assessment.outlook === "north-of-you"
              ? "Poleward of you"
              : assessment.outlook === "quiet"
                ? "Quiet"
                : "Not known",
      window: window.value,
      quality: usable ? visibility : { label: "Worth it", value: "Not known", tone: "unknown" },
    },
    reminder: {
      title: "Aurora watch — Orbit Studio Tracker",
      description: [
        assessment.statement,
        assessment.certainty,
        darknessLine,
        "Check the nowcast again before going out; aurora changes over tens of minutes.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      startUtc: atUtc,
      durationMinutes: 90,
    },
  };
}

/* --------------------------------------------------------- solar eclipse */

/** "6m 23s", the way eclipse durations are always quoted. */
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

const ECLIPSE_KIND_LABEL: Record<string, string> = {
  total: "Total Solar Eclipse",
  annular: "Annular Solar Eclipse",
  partial: "Partial Solar Eclipse",
};

/**
 * A solar eclipse, in the same hero shape.
 *
 * The middle metric is maximum eclipse and the third is what this observer
 * actually gets, because those two are different and confusing them is the
 * classic eclipse disappointment: "total eclipse on the 8th" is true of the
 * event and false of nearly everywhere.
 *
 * Weather is absent from the metrics on purpose. An eclipse years out has
 * geometry known to the second and a sky that is not knowable at all, and the
 * conditions row says exactly that rather than this card implying otherwise.
 */
export function presentSolarEclipseEvent(
  event: SolarEclipseEvent,
  local: LocalSolarCircumstances,
  clock: PlaceClock,
  placeName: string,
): EventPresentation {
  const title = ECLIPSE_KIND_LABEL[event.kind] ?? "Solar Eclipse";
  const localPercent = Math.round(local.obscurationFraction * 100);

  const pills: EventPill[] = [{ label: "Upcoming", tone: "state" }];
  pills.push(
    local.visibleFromHere
      ? { label: `Visible from ${placeName.split(",")[0]}`, tone: "live" }
      : { label: "Not visible from here", tone: "caution" },
  );

  // Duration belongs with the central phase and nowhere else. "Totality" alone
  // is the same word for four minutes and for forty seconds, and the difference
  // is most of what somebody decides a journey on.
  const centralDuration =
    local.centralDurationSeconds !== null ? formatDuration(local.centralDurationSeconds) : null;
  const yourView: EventMetric = !local.visibleFromHere
    ? { label: "Your view", value: "Below the horizon", tone: "unknown" }
    : local.kind === "total"
      ? {
          label: "Your view",
          value: centralDuration ? `Totality · ${centralDuration}` : "Totality",
          tone: "good",
        }
      : local.kind === "annular"
        ? {
            label: "Your view",
            value: centralDuration ? `Annular · ${centralDuration}` : "Annular",
            tone: "good",
          }
        : {
            label: "Your view",
            value: `${localPercent}% partial`,
            tone: localPercent >= 80 ? "good" : localPercent >= 40 ? "fair" : "poor",
          };

  const windowValue =
    local.visibleFromHere && local.partialBeginUtc && local.partialEndUtc
      ? `${formatClockTime(local.partialBeginUtc, clock)} – ${formatClockTime(local.partialEndUtc, clock)}`
      : "Not from here";

  return {
    id: event.id,
    categoryId: "eclipses",
    title,
    pills: pills.slice(0, 2),
    recommendation: recommendationForSolarEclipse(event, local, placeName),
    // Geometry is certain; the sky over it is not, and the row of condition
    // cards below says so rather than this card implying a clear morning.
    recommendationLevel: "Conditions unknown — check before going",
    support:
      "Eclipse geometry is exact. Weather this far ahead is not, and no forecast is claimed for it.",
    metrics: [
      { label: "Viewing window", value: windowValue, tone: "plain" },
      {
        label: "Max eclipse",
        value: local.peakUtc ? formatClockTime(local.peakUtc, clock) : "—",
        tone: "plain",
      },
      yourView,
    ],
    primaryAction: { label: "View visibility map", kind: "coverage-map" },
    secondaryAction: { label: "Set reminder", kind: "reminder" },
    atUtc: local.peakUtc ?? event.peakUtc,
    row: {
      state: local.visibleFromHere ? `${localPercent}% from here` : "Not visible here",
      window: new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(event.peakUtc)),
      quality: yourView,
    },
    reminder: {
      title: `${title} — Orbit Studio Tracker`,
      description: [
        local.visibleFromHere
          ? `From ${placeName} the Sun is ${localPercent}% covered at maximum.`
          : `Not visible from ${placeName}: the Sun is below the horizon.`,
        local.centralBeginUtc && local.centralEndUtc && centralDuration
          ? `${local.kind === "annular" ? "Annularity" : "Totality"} lasts ${centralDuration}, from ${formatClockTime(local.centralBeginUtc, clock)} to ${formatClockTime(local.centralEndUtc, clock)}.`
          : "",
        "Never look at the Sun without a certified solar filter. Sunglasses, exposed film and smoked glass are not filters.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      startUtc: local.peakUtc ?? event.peakUtc,
      durationMinutes: 120,
    },
  };
}

function recommendationForSolarEclipse(
  event: SolarEclipseEvent,
  local: LocalSolarCircumstances,
  placeName: string,
): string {
  const place = placeName.split(",")[0];
  if (!local.visibleFromHere) {
    return `This eclipse happens while the Sun is below the horizon at ${place}, so there is nothing to see from here.`;
  }
  if (local.kind === "total") {
    const duration =
      local.centralDurationSeconds !== null
        ? ` The Sun is completely covered for ${formatDuration(local.centralDurationSeconds)}.`
        : " The Sun is completely covered at maximum.";
    return `${place} is inside the path of totality.${duration}`;
  }
  if (local.kind === "annular") {
    const duration =
      local.centralDurationSeconds !== null
        ? ` for ${formatDuration(local.centralDurationSeconds)}`
        : " at maximum";
    return `${place} is inside the annular path, so the Moon leaves a ring of Sun${duration}.`;
  }
  const percent = Math.round(local.obscurationFraction * 100);
  const distance = local.distanceToCentralLineKm;
  // Quoted only where there is a shadow axis to measure from. An eclipse whose
  // axis misses Earth has no centre line, and a distance to one would be a
  // distance to nothing.
  const travel =
    distance !== null && distance > 40 && event.greatestPoint
      ? ` The centre line passes about ${Math.round(distance / 10) * 10} km away.`
      : "";
  return `${place} sees a ${percent}% partial eclipse — a bite out of the Sun, not darkness.${travel}`;
}
