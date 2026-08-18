import { MeteorNight, meteorNight } from "./meteorActivity";
import type { ObservationPeriod } from "./observationPeriod";
import { trackerObservationPeriod } from "./observationPeriod";
import type { Ranking } from "./opportunity";
import { rankOpportunities } from "./opportunity";
import { tonightsOpportunities } from "./phenomena";

/**
 * One event-generation and ranking layer, for every view.
 *
 * Tracker's model used to understand exactly one night: the app computed
 * "tonight" inline and there was nowhere for a second night to come from. That
 * is not a limitation of the astronomy — `trackerObservationPeriod` has always
 * taken an arbitrary instant — it was a limitation of there being no layer
 * above it. So Now, Tonight, Upcoming and Calendar are not four pipelines; they
 * are four questions asked of this one.
 *
 * ## Astronomy here, weather on top
 *
 * A plan carries no forecast. That separation is deliberate and is the thing
 * that makes Upcoming and Calendar possible at all: where Saturn is on the 14th
 * of next month is known now, to a precision far beyond what anybody observing
 * needs, while the cloud cover that night is not knowable at any precision
 * whatsoever. Folding them together would drag the confidence of the whole
 * answer down to the confidence of its weakest part, and a month from now that
 * means refusing to say anything — which would be wrong, because "Saturn is at
 * opposition on the 14th" is worth planning around whatever the sky does.
 *
 * Callers apply `snapshots` over a plan where a forecast reaches; where it does
 * not, the plan still stands and is presented as astronomically certain and
 * meteorologically unknown.
 */

/**
 * How far Upcoming looks ahead by default.
 *
 * Thirty nights is a practical horizon rather than a computed one: it covers
 * the return of every planet to a usable position and every major shower's
 * approach, without the interface implying Tracker knows what the sky will be
 * doing in March. Exported so the horizon is a parameter of the data layer and
 * not a number buried in a component.
 */
export const DEFAULT_HORIZON_NIGHTS = 30;

const MS_PER_DAY = 86_400_000;

export interface NightPlan {
  /**
   * The calendar date the night belongs to, as YYYY-MM-DD in the observer's
   * own clock.
   *
   * Keyed by the evening rather than by the UTC instant, because a night that
   * runs to 4am belongs to the evening it started — which is how people talk
   * about it, and what a calendar has to agree with to put it on the right
   * square.
   */
  dateKey: string;
  period: ObservationPeriod;
  ranking: Ranking;
  meteors: MeteorNight;
}

/** The observer's local calendar date for an instant. */
function dateKeyFor(at: Date, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * One night, fully generated and ranked.
 *
 * Returns null where the astronomy cannot produce a period at all — polar day,
 * or a coordinate the ephemeris search cannot close on. A caller iterating a
 * month needs to skip those rather than fail the month.
 */
export function planNight(
  latitudeDeg: number,
  longitudeDeg: number,
  at: Date,
  timeZone: string | null = null,
): NightPlan | null {
  try {
    const period = trackerObservationPeriod(latitudeDeg, longitudeDeg, at);
    const ranking = rankOpportunities(
      tonightsOpportunities(latitudeDeg, longitudeDeg, period),
    );
    return {
      dateKey: dateKeyFor(new Date(period.startUtc), timeZone),
      period,
      ranking,
      meteors: meteorNight(latitudeDeg, longitudeDeg, period),
    };
  } catch {
    return null;
  }
}

/**
 * A run of consecutive nights, starting from the one `from` falls in.
 *
 * Each night is generated independently and at full fidelity — this is the same
 * call Tonight makes, repeated — so Upcoming cannot drift away from Tonight by
 * being computed a cheaper way. The cost is real but bounded, and it is what
 * "do not fake Upcoming by sorting Tonight differently" actually requires.
 */
export function planNights(
  latitudeDeg: number,
  longitudeDeg: number,
  from: Date,
  nights: number = DEFAULT_HORIZON_NIGHTS,
  timeZone: string | null = null,
): NightPlan[] {
  const plans: NightPlan[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < nights; index += 1) {
    const at = new Date(from.getTime() + index * MS_PER_DAY);
    const plan = planNight(latitudeDeg, longitudeDeg, at, timeZone);
    // Stepping by 24 hours can land twice in the same observing period around a
    // daylight-saving change, and can skip one going the other way. Keyed by
    // the local date so a night appears once and in order.
    if (plan && !seen.has(plan.dateKey)) {
      seen.add(plan.dateKey);
      plans.push(plan);
    }
  }
  return plans;
}

/**
 * Every night of one calendar month, computed when that month is asked for.
 *
 * Calendar navigates by month and computes on demand rather than precomputing a
 * range: a year of nights is a year of ephemeris work for a reader who will
 * look at two months of it, and any fixed range is both too much for most
 * readers and too little for the one who scrolls past its edge.
 */
export function planMonth(
  latitudeDeg: number,
  longitudeDeg: number,
  year: number,
  month: number,
  timeZone: string | null = null,
): NightPlan[] {
  // Noon local-ish, so the instant sits inside the day it names whatever the
  // longitude does to it, and `trackerObservationPeriod` resolves to that
  // day's night rather than the previous one.
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return planNights(latitudeDeg, longitudeDeg, first, days, timeZone).filter((plan) => {
    const [planYear, planMonth] = plan.dateKey.split("-").map(Number);
    return planYear === year && planMonth === month;
  });
}

/**
 * How much rarity counts when comparing nights rather than opportunities.
 *
 * Inside one night, ranking caps rarity's contribution at RARITY_CAP, and that
 * is right: a rare thing badly placed is still badly placed, and rarity must
 * not be able to override observability. Across nights the question inverts.
 * Every night has a Moon, and on most of them it is genuinely a good target —
 * so ordering nights by their best opportunity's strength put a waxing gibbous
 * at the top of nearly all thirty, gave a partial lunar eclipse the same band
 * as a routine Tuesday, and left the view unable to answer the only question
 * it exists to answer: which of these nights should I choose?
 *
 * What distinguishes a night is what you cannot see on the others. So rarity is
 * uncapped here and weighted heavily, deliberately and in one place.
 */
const CROSS_NIGHT_RARITY_WEIGHT = 1.6;

/**
 * What makes this night different from the nights either side of it.
 *
 * Deliberately not the same comparison ranking makes. Ranking answers "given
 * that I am going out tonight, what should I look at"; this answers "which
 * night should I go out". A Moon that is very good on all thirty nights is a
 * fine answer to the first and no answer at all to the second.
 */
export function nightDistinction(plan: NightPlan): number {
  return plan.ranking.ranked.reduce(
    (best, entry) =>
      Math.max(
        best,
        entry.strength * (1 + entry.opportunity.qualities.rarity * CROSS_NIGHT_RARITY_WEIGHT),
      ),
    0,
  );
}

/**
 * The opportunity that earned the night its place, which is not always the
 * top-ranked one.
 *
 * On the night of an eclipse the ranked list may still lead with the Moon as a
 * target; the reason to pick that night out of a month is the eclipse. Showing
 * the ranked lead there would have the view assert one thing and be sorted by
 * another.
 */
export function distinguishingOpportunity(plan: NightPlan): Ranking["ranked"][number] | null {
  let best: Ranking["ranked"][number] | null = null;
  let bestValue = -1;
  for (const entry of plan.ranking.ranked) {
    const value =
      entry.strength * (1 + entry.opportunity.qualities.rarity * CROSS_NIGHT_RARITY_WEIGHT);
    if (value > bestValue) {
      bestValue = value;
      best = entry;
    }
  }
  return best;
}

/**
 * The single best thing across a set of nights.
 *
 * Upcoming ranks nights against each other, which ranking itself does not do —
 * it ranks opportunities inside one night.
 */
export function leadOf(plan: NightPlan): Ranking["ranked"][number] | null {
  return plan.ranking.ranked[0] ?? null;
}

/* ------------------------------------------------------------- notability */

/**
 * What is worth planning around, as opposed to what is worth looking at.
 *
 * Tonight ranks the things above the horizon on one night. Applied across a
 * month that produces a list that is technically correct and useless: Saturn is
 * observable on the 12th, the 13th, the 14th, the 15th and the 16th, so it
 * appears five times, and a partial lunar eclipse sits among the copies with
 * the same weight. Nobody plans around Saturn being up again.
 *
 * The threshold here is different in kind, not degree. It asks whether somebody
 * would remember the date — stay up, get up early, drive somewhere, bring
 * binoculars, move something in their week. Most nights contain nothing that
 * clears it, and that is the correct answer rather than a gap to fill.
 *
 * The astronomy underneath is untouched. This is a selection layer over the
 * same plans Tonight uses, so a night that appears here is the same night
 * Tonight would describe.
 */

export type NotableKind =
  | "eclipse"
  | "shower-peak"
  | "conjunction"
  | "moon-phase"
  | "best-placement";

export interface NotableEvent {
  plan: NightPlan;
  entry: Ranking["ranked"][number];
  kind: NotableKind;
  /** Why this one is worth a place in the diary, in the interface's words. */
  reason: string;
}

/** Moon phases people actually mark; a waxing gibbous is not one of them. */
const MILESTONE_PHASES = ["Full Moon", "New Moon", "First Quarter", "Last Quarter"];

function classify(
  entry: Ranking["ranked"][number],
): { kind: NotableKind; reason: string; key: string } | null {
  const { opportunity } = entry;
  const title = opportunity.title;

  if (opportunity.kind === "lunar-eclipse") {
    return {
      kind: "eclipse",
      key: "eclipse",
      reason: "An eclipse is the one night this happens. Nothing else this month is on a clock.",
    };
  }

  if (opportunity.kind === "conjunction") {
    return {
      kind: "conjunction",
      key: `conjunction:${opportunity.id}`,
      reason: "Two objects close enough to hold in one glance, for a night or two only.",
    };
  }

  if (opportunity.kind === "meteors") {
    // Only the peak. A shower is active for weeks and worth a special effort on
    // roughly one night of them.
    return {
      kind: "shower-peak",
      key: `shower:${opportunity.id}`,
      reason: "The shower's best night — rates fall away either side of it.",
    };
  }

  if (opportunity.kind === "moon" && MILESTONE_PHASES.some((phase) => title.includes(phase))) {
    return {
      kind: "moon-phase",
      key: `moon:${MILESTONE_PHASES.find((phase) => title.includes(phase))}`,
      reason: "A phase worth timing an evening around rather than catching by accident.",
    };
  }

  if (opportunity.kind === "planet") {
    return {
      kind: "best-placement",
      key: `planet:${opportunity.id}`,
      reason: "As well placed as it gets from here for weeks either side.",
    };
  }

  return null;
}

/**
 * The notable events across a set of nights, one entry per thing.
 *
 * Deduplicated by what the event *is* rather than by date, keeping the single
 * best night for each. That is the whole fix for the repeated-Saturn problem:
 * Saturn is one entry at its best placement, not one entry per night it happens
 * to clear the horizon.
 */
export function notableEvents(plans: NightPlan[], limit = 6): NotableEvent[] {
  const best = new Map<string, NotableEvent & { score: number }>();

  for (const plan of plans) {
    for (const entry of plan.ranking.ranked) {
      const classified = classify(entry);
      if (!classified) continue;
      const score = entry.strength * (1 + entry.opportunity.qualities.rarity);
      const held = best.get(classified.key);
      if (!held || score > held.score) {
        best.set(classified.key, {
          plan,
          entry,
          kind: classified.kind,
          reason: classified.reason,
          score,
        });
      }
    }
  }

  // Rarer kinds first, then by how good the night itself is. Chronology is the
  // calendar's job; this list is ordered by significance and says so.
  const weight: Record<NotableKind, number> = {
    eclipse: 5,
    "shower-peak": 4,
    conjunction: 3,
    "moon-phase": 2,
    "best-placement": 1,
  };
  return [...best.values()]
    .sort((left, right) =>
      weight[right.kind] - weight[left.kind] || right.score - left.score,
    )
    .slice(0, limit)
    .map(({ score: _score, ...event }) => event);
}
