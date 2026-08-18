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
