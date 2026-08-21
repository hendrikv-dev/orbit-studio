import type { AuroraConditions } from "./aurora";
import { SHORT_RANGE_HORIZON_DAYS, stormScaleFor } from "./aurora";
import { categoryForOpportunityKind, type EventCategoryId } from "./eventCategories";
import {
  localSolarCircumstances,
  nextSolarEclipses,
  type LocalSolarCircumstances,
  type SolarEclipseEvent,
} from "./solarEclipse";
import type { NightPlan, NotableEvent } from "./schedule";
import { notableEvents } from "./schedule";

/**
 * Everything beyond tonight, from three sources that cannot be merged upstream.
 *
 * Notable events come out of the ranking layer, one plan per night. Solar
 * eclipses come out of an eclipse search and belong to no observing night at
 * all — they happen in daylight, which is why they never appear in Tonight and
 * why a "sort the ranked list differently" approach to Upcoming could never
 * have produced them. Auroral risk comes from a three-day forecast and is the
 * only one of the three with a horizon shorter than the view itself.
 *
 * This is the layer that makes them one list without pretending they are one
 * kind of thing.
 *
 * ## What Upcoming is for
 *
 * Dates somebody would move something in their week for. Not "Saturn is up
 * again on the 14th" — Saturn is up on all of them, and a view that lists
 * ordinary nightly availability thirty times has buried the two dates that
 * mattered. `notableEvents` already applies that test; the two additions here
 * are held to the same one.
 */

export type UpcomingEvent =
  | {
      kind: "notable";
      id: string;
      dateKey: string;
      atUtc: string;
      category: EventCategoryId;
      title: string;
      label: string;
      reason: string;
      notable: NotableEvent;
    }
  | {
      kind: "solar-eclipse";
      id: string;
      dateKey: string;
      atUtc: string;
      category: "eclipses";
      title: string;
      label: string;
      reason: string;
      event: SolarEclipseEvent;
      local: LocalSolarCircumstances;
    }
  | {
      kind: "aurora";
      id: string;
      dateKey: string;
      atUtc: string;
      category: "auroras";
      title: string;
      label: string;
      reason: string;
      kp: number;
    };

const KIND_LABEL: Record<NotableEvent["kind"], string> = {
  eclipse: "Lunar eclipse",
  "shower-peak": "Meteor peak",
  conjunction: "Conjunction",
  "moon-phase": "Moon phase",
  opposition: "Opposition",
};

const SOLAR_LABEL: Record<SolarEclipseEvent["kind"], string> = {
  total: "Total solar eclipse",
  annular: "Annular solar eclipse",
  partial: "Partial solar eclipse",
};

function dateKeyFor(at: Date, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * The solar eclipses that reach this observer at all, within a horizon.
 *
 * "At all" is doing the filtering, and the threshold is deliberately low: a 20%
 * partial eclipse is a real thing to look at with a filter, and it is exactly
 * the kind of event people miss because nobody told them. An eclipse happening
 * entirely below the horizon is dropped, because there is nothing to see.
 *
 * The search runs eight eclipses ahead rather than the two or three that fill a
 * month, because most places get nothing for years and then a good one. From
 * Portland the next four are all on the far side of the planet and the fifth is
 * a 68% partial; a shorter search returns an empty list and implies there is no
 * eclipse coming, which is the opposite of true.
 */
export function solarEclipsesFor(
  latitudeDeg: number,
  longitudeDeg: number,
  from: Date,
  timeZone: string | null,
  searchCount = 8,
  horizonDays = 1500,
): UpcomingEvent[] {
  const events: UpcomingEvent[] = [];
  for (const event of nextSolarEclipses(from, searchCount)) {
    const daysAhead = (Date.parse(event.peakUtc) - from.getTime()) / 86_400_000;
    if (daysAhead > horizonDays) break;
    const local = localSolarCircumstances(event, latitudeDeg, longitudeDeg);
    if (!local.visibleFromHere || local.obscurationFraction < 0.02) continue;
    const percent = Math.round(local.obscurationFraction * 100);
    events.push({
      kind: "solar-eclipse",
      id: event.id,
      dateKey: dateKeyFor(new Date(local.peakUtc ?? event.peakUtc), timeZone),
      atUtc: local.peakUtc ?? event.peakUtc,
      category: "eclipses",
      title: SOLAR_LABEL[event.kind],
      label: "Solar eclipse",
      reason:
        local.kind === "total"
          ? "You are inside the path of totality — the rarest thing on this list."
          : local.kind === "annular"
            ? "You are inside the annular path: a ring of Sun at maximum."
            : `${percent}% of the Sun covered from here. A filter is mandatory.`,
      event,
      local,
    });
  }
  return events;
}

/**
 * Auroral risk, only where the forecast reaches.
 *
 * The K-index forecast runs three days and Upcoming runs a month, so this
 * populates a tenth of the view at most — which is the correct behaviour and
 * not a shortfall. Producing an aurora entry for the 14th of next month would
 * require inventing the solar wind three weeks ahead, and the whole reason this
 * product can show aurora at all is that it refuses to.
 *
 * The threshold is storm level. Kp 4 is unsettled and disappoints almost
 * everybody who drives out for it; Kp 5 is a G1 storm and is the point at which
 * mid-latitude observers have a real chance.
 */
export function auroraRiskFor(
  conditions: AuroraConditions | null,
  now: Date,
  timeZone: string | null,
): UpcomingEvent[] {
  if (!conditions) return [];
  const horizon = now.getTime() + SHORT_RANGE_HORIZON_DAYS * 86_400_000;
  const byDate = new Map<string, { kp: number; atUtc: string }>();

  // One entry per local date, holding that date's strongest three-hour bin.
  // The K-index is a planetary index over a three-hour window, so a night is
  // fairly described by its worst-disturbed bin and not by an average.
  for (const point of conditions.kpForecast) {
    const stamp = Date.parse(point.atUtc);
    if (stamp <= now.getTime() || stamp > horizon) continue;
    if (point.kp < 5) continue;
    const key = dateKeyFor(new Date(stamp), timeZone);
    const held = byDate.get(key);
    if (!held || point.kp > held.kp) byDate.set(key, { kp: point.kp, atUtc: point.atUtc });
  }

  return [...byDate.entries()].map(([dateKey, entry]) => {
    const storm = stormScaleFor(entry.kp);
    return {
      kind: "aurora" as const,
      id: `aurora-${dateKey}`,
      dateKey,
      atUtc: entry.atUtc,
      category: "auroras" as const,
      title: "Aurora watch",
      label: "Aurora",
      reason: storm
        ? `${storm.label} geomagnetic conditions forecast — Kp ${entry.kp.toFixed(1)}.`
        : `Kp ${entry.kp.toFixed(1)} forecast.`,
      kp: entry.kp,
    };
  });
}

/** Notable events from the plan layer, in this module's shared shape. */
export function notableUpcomingEvents(plans: NightPlan[], limit = 12): UpcomingEvent[] {
  return notableEvents(plans, limit).map((notable) => ({
    kind: "notable" as const,
    id: `${notable.plan.dateKey}:${notable.entry.opportunity.id}`,
    dateKey: notable.plan.dateKey,
    atUtc: notable.entry.opportunity.guidance.whenUtc,
    category: categoryForOpportunityKind(notable.entry.opportunity.kind),
    title: notable.entry.opportunity.title,
    label: KIND_LABEL[notable.kind],
    reason: notable.reason,
    notable,
  }));
}

/**
 * The whole of Upcoming, ordered by date.
 *
 * Chronological rather than by significance. The previous view ranked by
 * significance and said so, which was defensible in a single-feature layout;
 * in a list it makes the reader scan for "when", which is the one thing a
 * diary should never make you do. Significance survives in what is *on* the
 * list, which is where the selection layer already applies it.
 */
export function mergeUpcoming(...groups: UpcomingEvent[][]): UpcomingEvent[] {
  return groups
    .flat()
    .sort((left, right) => Date.parse(left.atUtc) - Date.parse(right.atUtc));
}

export function filterUpcoming(
  events: UpcomingEvent[],
  category: EventCategoryId | "all",
): UpcomingEvent[] {
  return category === "all" ? events : events.filter((event) => event.category === category);
}
