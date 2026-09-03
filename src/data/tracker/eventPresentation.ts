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
import {
  cardinalAbbreviation,
  compassWords,
  observingInstruction,
  type ObservingInstruction,
} from "./observingInstruction";
import { describeAltitude, skyPathFor } from "./skyPath";
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
  /**
   * A short name for narrow places, where the subject supplies one.
   *
   * Optional: most presentations have titles that already fit, and only the
   * ones that would otherwise be clipped into nonsense need it.
   */
  shortTitle?: string | null;
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
  /**
   * True where the recommendation already explains its own limiting condition.
   *
   * Tonight replaces an ineligible event's recommendation with the eligibility
   * reason, so a reader who opens Meteors on a night with no shower is told
   * why rather than being sold the sporadic background. Aurora is the exception
   * and needs to be one: its recommendation is generated from the same
   * visibility model the eligibility verdict is, and the version it produces is
   * strictly more informative — "the oval is not over you, but NOAA shows 16%
   * about 1836 km north; aurora at 400 km would stand about 4° above your
   * northern horizon" against "No aurora is expected from here tonight."
   *
   * Overwriting that threw away the distance, the bearing and the height, which
   * is the whole of what a reader at that latitude can act on. The flag is on
   * the presentation rather than a check for `id === "aurora"` because the
   * property that matters is "this text already answers the question", and a
   * future phenomenon with its own state machine should be able to claim it.
   */
  selfExplaining?: boolean;
  /**
   * Which way to face, how high, and when — or null where there is no answer.
   *
   * Carried on the presentation rather than derived at each surface, because
   * the hero metric, the recommendation sentence, the drill-in and the calendar
   * reminder all have to say the same thing. A reader who takes the reminder
   * outside and finds it disagreeing with the page they read it on has been
   * told two different directions by one product.
   */
  where: ObservingInstruction | null;
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
 * How good the view of this event is expected to be.
 *
 * ## Why it is called "Visibility" and no longer "Worth it"
 *
 * "Worth it" is a lifestyle verdict, and the brief removes those: it tells a
 * reader nothing they can act on, and it collides with the ranking. A row
 * reading "Worth it: Excellent" invites exactly the reading the ranking then
 * contradicts — that this is the best thing tonight — when what the band
 * actually measures is how good *this* view will be, which is a different
 * question from how much it is worth noticing.
 *
 * The band is `min(sky access, phenomenon strength)`, so "Visibility" is an
 * accurate name for it: it falls when the sky is poor and it falls when the
 * phenomenon is weak, and either of those genuinely makes the view worse.
 * Overall priority is carried by the rank number beside it, computed from the
 * significance model, and the two no longer compete to mean the same thing.
 *
 * Read off `viewability` rather than derived again here. Two places deciding
 * independently what "good" means is how a card came to say *excellent* beside
 * a sentence saying the sky would spoil it.
 */
export const VISIBILITY_LABEL = "Visibility";

export function visibilityMetric(
  window: BestWindow | null,
  evidenceStatus: EnvironmentalEvidenceStatus,
  passed: boolean,
): EventMetric {
  if (passed) return { label: VISIBILITY_LABEL, value: "Already set", tone: "unknown" };
  if (!window || evidenceStatus === "not-supported" || evidenceStatus === "request-failed") {
    return { label: VISIBILITY_LABEL, value: "Not known", tone: "unknown" };
  }
  const band = BAND_LABEL[window.viewability.band];
  return { label: VISIBILITY_LABEL, value: band.value, tone: band.tone };
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

  /**
   * The practical instruction, computed from the same path the drill-in draws.
   *
   * On the main page rather than only behind "Where to look": the real-use
   * failure that prompted this was a reader who had the event, had the time,
   * and still had to work out which part of the sky to search. Burying the
   * answer one click away is the same failure with an extra step.
   */
  const where = observingInstruction(opportunity, skyPathFor(opportunity, window), window, context.clock);
  const metrics = metricsFor(entry, window, passed, context, where);
  const support = supportLineFor(entry, context, where, limitingConditionLine(level));

  return {
    id: opportunity.id,
    categoryId,
    title: opportunity.title,
    shortTitle: opportunity.shortTitle ?? null,
    pills: [...pills, ...secondPillFor(entry, context)].slice(0, 2),
    recommendation: recommendationSentence(level, opportunity.summary, where, passed),
    recommendationLevel: level,
    support,
    where,
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
        // The same sentence the page showed, so the reminder a reader takes
        // outside cannot disagree with the page they read it on.
        where?.sentence ?? "",
        where?.change ?? "",
        opportunity.guidance.appearance,
      ]
        .filter(Boolean)
        .join("\n\n"),
      startUtc: whenUtc,
      durationMinutes: guidance.durationMinutes,
    },
  };
}

/**
 * What the event is, and where and when to look at it.
 *
 * ## What changed and why
 *
 * This used to end in a verdict — "Worth a look if you are already out; not
 * worth a special trip", "Not worth a special trip from here tonight". The
 * brief removes that whole class of sentence, and the reason it is right to is
 * that it answers a question the reader did not ask. Somebody who has opened a
 * page about a lunar eclipse has already decided they are interested; what they
 * lack is the direction to face.
 *
 * So the second sentence is now the instruction, and the only judgement that
 * survives is the one that changes what the reader should *do*: if the sky is
 * expected to shut, say so, because that is a fact about tonight rather than an
 * opinion about them.
 */
function recommendationSentence(
  level: ReturnType<typeof recommendationFor>,
  summary: string,
  where: ObservingInstruction | null,
  passed: boolean,
): string {
  if (passed) return `${summary} It has already set for tonight.`;
  if (level === "unavailable") {
    return `${summary} It is not above the horizon for the rest of tonight.`;
  }
  /**
   * One fact. What this is.
   *
   * ## Measured, not assumed
   *
   * This briefly carried three sentences — what it is, where to look, and what
   * the sky was doing — and the browser showed why that was wrong. The hero
   * clamps this paragraph to two lines to hold the one-screen contract, and at
   * 1280×720 the paragraph wanted 108 pixels and was given 43. What fell off
   * the bottom was the cloud warning: sixty-five hidden pixels of "cloud is
   * forecast to cover most of the sky", on a page telling somebody to go
   * outside. A warning CSS can hide is not a warning.
   *
   * Shortening the wording would not have fixed it. The summaries alone run to
   * about two lines, so *any* appended sentence overflows — the paragraph can
   * hold one fact and the layout is what says so.
   *
   * So the three facts go to the three places that have room for them, and each
   * of those places is on the main page rather than behind a control:
   *
   *   what it is       → here
   *   where to look    → the third metric, and the panel beside the hero
   *   what limits it   → the support line, which is its own element
   *
   * The panel carries the full plain-language form — "about 43° up, about
   * halfway up the sky" — because it has the width for the interpretation as
   * well as the number.
   */
  return summary;
}

/**
 * What is standing between the reader and the view, in one line, or null.
 *
 * Separated from the recommendation so that it cannot be clipped along with it,
 * and stated as a fact about the sky rather than as advice about the evening —
 * "cloud is forecast to cover most of the sky" is checkable, "not worth a
 * special trip" is not.
 */
function limitingConditionLine(level: ReturnType<typeof recommendationFor>): string | null {
  switch (level) {
    // One line each, because one line is what the support slot is. Written to
    // fit rather than trimmed by CSS: the whole point of moving these out of
    // the recommendation was that they must not be the text that gets cut.
    case "conditions-limited":
      return "Cloud is forecast to cover most of the sky.";
    case "conditions-unknown":
      return "No forecast reached here — check the sky first.";
    default:
      return null;
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
 * The three metrics: when, what, and where.
 *
 * ## Why the third slot changed
 *
 * It used to be "Worth it" — a grade, on a page that already carried a rank and
 * a recommendation sentence. Three statements of the same judgement on three
 * different scales, which is how they came to contradict each other.
 *
 * The slot now answers the question the product was failing to answer at all:
 * which way to face and how high. It is the one fact a reader has to carry
 * outside with them, so it belongs on the card rather than one click away, and
 * the visibility band moves to the ranked list where a comparison between
 * events is what a reader is actually making.
 *
 * The middle slot still varies by phenomenon — a rate for a shower, coverage
 * for an eclipse, how long it lasts for a target — and no longer repeats a
 * height, which would have restated the third slot from a different moment of
 * the night and read as a contradiction.
 */
function metricsFor(
  entry: SkyAdjustedOpportunity,
  window: BestWindow | null,
  passed: boolean,
  context: TonightContext,
  where: ObservingInstruction | null,
): [EventMetric, EventMetric, EventMetric] {
  const { opportunity } = entry;
  const best: EventMetric = {
    label: "Best time",
    value: passed
      ? "Passed tonight"
      : windowText(window, opportunity.guidance.whenUtc, context.clock),
    tone: "plain",
  };
  const look: EventMetric = passed
    ? { label: "Where to look", value: "Already set", tone: "unknown" }
    : where
      ? { label: "Where to look", value: where.metric, tone: "plain" }
      : { label: "Where to look", value: "No direction", tone: "unknown" };

  if (opportunity.kind === "meteors") {
    return [best, meteorRateMetric(context, window), look];
  }

  if (opportunity.kind === "lunar-eclipse" && opportunity.science?.kind === "lunar-eclipse") {
    const percent = Math.round(opportunity.science.obscurationFraction * 100);
    return [
      best,
      // Named for what it measures rather than graded. The brief's own worked
      // example: "Local eclipse view / 97% covered" beats a bare "Excellent".
      { label: "Covered at maximum", value: `${percent}%`, tone: "plain" },
      look,
    ];
  }

  const aboveHorizon = minutesAboveHorizon(entry);
  if (aboveHorizon !== null) {
    return [
      best,
      { label: "Above the horizon", value: durationWords(aboveHorizon), tone: "plain" },
      look,
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
    look,
  ];
}

/** How long the target is up during the observing period, in minutes. */
function minutesAboveHorizon(entry: SkyAdjustedOpportunity): number | null {
  const samples = entry.opportunity.profile.filter(
    (sample) => sample.altitudeDeg !== undefined,
  );
  if (samples.length < 2) return null;
  let minutes = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index].altitudeDeg ?? -1) > 0) {
      minutes += (Date.parse(samples[index].atUtc) - Date.parse(samples[index - 1].atUtc)) / 60_000;
    }
  }
  return minutes > 0 ? minutes : null;
}

function durationWords(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
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
/**
 * The one extra line, and what it is allowed to be.
 *
 * The brief forbids exposing a numeric novelty score and asks instead that the
 * result be communicated "through concrete facts". This is where those facts
 * go: not "significance 0.46" but "Saturn is 37 days from opposition and
 * already larger and brighter than usual" — the same sentence the ranking
 * recorded when it decided the band, so the explanation cannot drift from the
 * decision it explains.
 *
 * Order is by what would change the reader's evening: the sky first where the
 * sky is what decides it, then how the target moves while they are outside,
 * then why this showing is unusual, then what equipment changes.
 *
 * The limiting condition is passed in rather than derived here because it is
 * also the thing the recommendation paragraph must *not* carry — see
 * `limitingConditionLine`, and the clipped cloud warning that put it there.
 */
function supportLineFor(
  entry: SkyAdjustedOpportunity,
  context: TonightContext,
  where: ObservingInstruction | null,
  limiting: string | null,
): string | null {
  const { opportunity } = entry;
  if (limiting) return limiting;
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
  if (where?.change) return where.change;
  const reason = entry.significance.reasons[0];
  if (reason && entry.significance.tier !== "routine") return reason;
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
/**
 * Which horizon to watch, from the visibility model rather than from OVATION.
 *
 * The distinction matters and is the same one the aurora work has turned on
 * throughout: OVATION reports the chance of aurora *overhead at a cell*, and a
 * reader two thousand kilometres south of the oval sees it low in the north or
 * not at all. The metric answers the reader's version of the question.
 */
function auroraLookMetric(
  visibilityModel: AuroraVisibility | null,
  usable: boolean,
): EventMetric {
  const label = "Where to look";
  if (!usable || !visibilityModel) return { label, value: "Not known", tone: "unknown" };
  switch (visibilityModel.kind) {
    case "overhead":
      return { label, value: "Overhead", tone: "plain" };
    case "horizon": {
      // The bearing of the cell actually driving the answer, not an assumption
      // that aurora is always north: from the southern hemisphere it is not,
      // and near the oval's edge the strongest reachable patch can be off to
      // one side rather than straight poleward.
      const bearing =
        visibilityModel.source !== null
          ? cardinalAbbreviation(visibilityModel.source.bearingDeg)
          : null;
      const elevation = visibilityModel.apparentElevationDeg;
      if (bearing && elevation !== null && elevation !== undefined) {
        return { label, value: `${bearing} · ${Math.round(elevation)}°`, tone: "plain" };
      }
      return { label, value: bearing ? `${bearing} horizon` : "Low horizon", tone: "plain" };
    }
    case "unlikely":
      return { label, value: "Not visible", tone: "unknown" };
    default:
      return { label, value: "Not known", tone: "unknown" };
  }
}

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
        ? "well-placed"
        : usable && visibilityModel?.kind === "horizon"
          ? "modest"
          : "conditions-unknown",
    support: darknessLine ? `${assessment.certainty} ${darknessLine}` : assessment.certainty,
    // Every branch above states the aurora's own limiting condition, in more
    // detail than any generic verdict could.
    selfExplaining: true,
    /**
     * Aurora has no target to point at, so "where to look" is a horizon rather
     * than a bearing — and saying which horizon is the single most useful thing
     * Tracker can tell somebody standing outside at a latitude the oval does
     * not reach. `visibility` moves to the row, where a comparison between
     * events is what the reader is making.
     */
    where: null,
    metrics: [window, middle, auroraLookMetric(visibilityModel, usable)],
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
      quality: usable ? visibility : { label: VISIBILITY_LABEL, value: "Not known", tone: "unknown" },
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

  /**
   * Where the Sun will be at maximum, from the same circumstances as the times.
   *
   * A solar eclipse is the one case where "where to look" carries a safety
   * obligation as well as a practical one, so the sentence never says to look
   * at the Sun — it says where it will be. The unsuppressable filter warning
   * renders above everything on the card and is not repeated here.
   */
  const where: ObservingInstruction | null =
    local.visibleFromHere && local.peakUtc
      ? {
          compass: compassWords(local.sunAzimuthAtPeakDeg),
          cardinal: cardinalAbbreviation(local.sunAzimuthAtPeakDeg),
          azimuthDeg: local.sunAzimuthAtPeakDeg,
          altitudeDeg: local.sunAltitudeAtPeakDeg,
          altitudeWords: describeAltitude(local.sunAltitudeAtPeakDeg),
          motion: null,
          atUtc: local.peakUtc,
          sentence: `At maximum the Sun is ${Math.round(local.sunAltitudeAtPeakDeg)}° up in the ${compassWords(local.sunAzimuthAtPeakDeg)}, ${describeAltitude(local.sunAltitudeAtPeakDeg)}.`,
          change: null,
          metric: `${cardinalAbbreviation(local.sunAzimuthAtPeakDeg)} · ${Math.round(local.sunAltitudeAtPeakDeg)}°`,
        }
      : null;

  return {
    id: event.id,
    categoryId: "eclipses",
    title,
    pills: pills.slice(0, 2),
    recommendation: recommendationForSolarEclipse(event, local, placeName, where),
    // Geometry is certain; the sky over it is not, and the row of condition
    // cards below says so rather than this card implying a clear morning.
    recommendationLevel: "conditions-unknown",
    where,
    /**
     * The full partial phase, and nothing else.
     *
     * The caveat about the weather used to be appended here and made the line
     * two lines long in a one-line slot, so it clipped. It is also already on
     * the page: three of the four condition cards read "Forecast closer to
     * date" for an eclipse years out, which is the same statement rendered by
     * the row whose job it is. Saying it twice cost the times, which are said
     * nowhere else.
     */
    support:
      local.visibleFromHere && windowValue !== "Not from here"
        ? `Partial phase runs ${windowValue}.`
        : "Eclipse geometry is exact; the weather over it this far ahead is not.",
    /**
     * When, what, and where — the same three questions as every other event.
     *
     * The viewing window moves to the support line and the peak takes the first
     * slot, because "be outside at 10:20" is the actionable half of a two-hour
     * partial phase almost nobody watches end to end.
     */
    metrics: [
      {
        label: "Best time",
        value: local.peakUtc ? formatClockTime(local.peakUtc, clock) : "—",
        tone: "plain",
      },
      yourView,
      where
        ? { label: "Where to look", value: where.metric, tone: "plain" }
        : { label: "Where to look", value: "Below the horizon", tone: "unknown" },
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
  where: ObservingInstruction | null,
): string {
  const place = placeName.split(",")[0];
  /**
   * Deliberately empty, and kept as a parameter so it cannot drift back.
   *
   * The facing sentence used to be appended here, and it clipped: at 1280×800
   * the paragraph wanted three lines and the hero gives it two, so the reader
   * lost the tail of "at maximum the Sun is 6° up in the south-east". The same
   * mistake the tonight recommendation made, in the other presenter.
   *
   * The direction has two places of its own on this card — the third metric
   * (`SE · 6°`) and the eclipse map beside it — and both are on the main page
   * rather than behind a control. It does not need a third that cannot hold it.
   */
  const facing = "";
  void where;
  if (!local.visibleFromHere) {
    return `This eclipse happens while the Sun is below the horizon at ${place}, so there is nothing to see from here.`;
  }
  if (local.kind === "total") {
    const duration =
      local.centralDurationSeconds !== null
        ? ` The Sun is completely covered for ${formatDuration(local.centralDurationSeconds)}.`
        : " The Sun is completely covered at maximum.";
    return `${place} is inside the path of totality.${duration}${facing}`;
  }
  if (local.kind === "annular") {
    const duration =
      local.centralDurationSeconds !== null
        ? ` for ${formatDuration(local.centralDurationSeconds)}`
        : " at maximum";
    return `${place} is inside the annular path, so the Moon leaves a ring of Sun${duration}.${facing}`;
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
  return `${place} sees a ${percent}% partial eclipse — a bite out of the Sun, not darkness.${travel}${facing}`;
}
