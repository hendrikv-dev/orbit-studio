import {
  bestViewingWindow,
  type EnvironmentalEvidence,
  type ViewabilityBand,
} from "./conditions";
import {
  generalEligibility,
  meteorEligibility,
  moonEligibility,
  type EligibilityVerdict,
} from "./bestTonightEligibility";
import { cardinalAbbreviation } from "./observingInstruction";
import { admissible, type EquipmentRule } from "./observingRules";
import type { NightPlan } from "./schedule";
import type { UpcomingEvent } from "./upcomingEvents";

/** A week is far enough to be useful and short enough to remain actionable. */
export const NEXT_BEST_HORIZON_NIGHTS = 7;

export interface NextBestChance {
  /** The plan identity that produced this result, retained for stale-state checks. */
  planIdentityKey: string;
  dateKey: string;
  opportunityId: string;
  title: string;
  startUtc: string;
  endUtc: string;
  peakUtc: string;
  brief: boolean;
  quality: Extract<ViewabilityBand, "excellent" | "good">;
  /** Dense, real geometry such as `SE · 47°`, or phenomenon guidance where it is not a point. */
  where: string;
  /** Why the underlying opportunity cleared Tracker's threshold. */
  reason: string;
  /** What can honestly be said about the forecast supporting this window. */
  forecastNote: string;
  reminder: {
    title: string;
    description: string;
    startUtc: string;
    durationMinutes: number;
  };
}

export interface NextBestChanceInput {
  plans: NightPlan[];
  evidence: EnvironmentalEvidence;
  equipment: EquipmentRule;
  observer: {
    latitudeDeg: number;
    longitudeDeg: number;
    timeZone: string | null;
  };
  /** The current on-screen plan. A result from any other request is stale. */
  anchorPlanIdentityKey: string;
  artificialLightRadiance: number | null;
  now: Date;
  horizonNights?: number;
}

function sameObserver(plan: NightPlan, input: NextBestChanceInput): boolean {
  return (
    Math.abs(plan.identity.latitudeDeg - input.observer.latitudeDeg) < 1e-6 &&
    Math.abs(plan.identity.longitudeDeg - input.observer.longitudeDeg) < 1e-6 &&
    plan.identity.timeZone === (input.observer.timeZone ?? "UTC")
  );
}

function eligibilityFor(plan: NightPlan, entry: NightPlan["ranking"]["ranked"][number]): EligibilityVerdict {
  const opportunity = entry.opportunity;
  if (opportunity.kind === "meteors") {
    return meteorEligibility(opportunity, plan.meteors.best?.showerPerHour ?? null);
  }
  if (opportunity.kind === "moon") return moonEligibility(opportunity);
  return generalEligibility(entry.strength);
}

function nearestPoint(
  plan: NightPlan,
  opportunityId: string,
  atUtc: string,
): { altitudeDeg?: number; azimuthDeg?: number } | null {
  const opportunity = plan.ranking.ranked.find(
    (entry) => entry.opportunity.id === opportunityId,
  )?.opportunity;
  if (!opportunity || opportunity.profile.length === 0) return null;
  const target = Date.parse(atUtc);
  return opportunity.profile.reduce((nearest, point) =>
    Math.abs(Date.parse(point.atUtc) - target) < Math.abs(Date.parse(nearest.atUtc) - target)
      ? point
      : nearest,
  );
}

function whereFor(plan: NightPlan, opportunityId: string, atUtc: string): string {
  const entry = plan.ranking.ranked.find(
    (candidate) => candidate.opportunity.id === opportunityId,
  );
  if (!entry) return "See observing guidance";
  const point = nearestPoint(plan, opportunityId, atUtc);
  if (
    point?.azimuthDeg !== undefined &&
    point.altitudeDeg !== undefined &&
    point.altitudeDeg > 0
  ) {
    return `${cardinalAbbreviation(point.azimuthDeg)} · ${Math.round(point.altitudeDeg)}°`;
  }
  return [entry.opportunity.guidance.direction ?? "Whole sky", entry.opportunity.guidance.elevation]
    .filter(Boolean)
    .join(" · ");
}

function forecastNote(peakUtc: string, now: Date, freshness: "current" | "ageing" | "stale"): string {
  if (freshness === "ageing") return "Forecast may have changed — check again before going out";
  const hoursAhead = (Date.parse(peakUtc) - now.getTime()) / 3_600_000;
  return hoursAhead > 36
    ? "Forecast-backed · check again closer to the night"
    : "Best forecast window";
}

/**
 * Find the nearest future window that clears both halves of Tracker's promise.
 *
 * Astronomy first: the opportunity must pass the existing equipment and
 * eligibility gates. Weather second: `bestViewingWindow` must find a forecast-
 * supported Good or Excellent interval. Missing or stale weather never becomes
 * optimism; it yields no chance and lets the caller fall back to Upcoming.
 */
export function findNextBestChance(input: NextBestChanceInput): NextBestChance | null {
  const first = input.plans[0];
  if (!first || first.identity.key !== input.anchorPlanIdentityKey) return null;
  if (!sameObserver(first, input)) return null;
  if (input.evidence.status !== "available") return null;

  const horizon = input.plans.slice(0, input.horizonNights ?? NEXT_BEST_HORIZON_NIGHTS);
  const candidates: (NextBestChance & { rank: number })[] = [];

  for (const plan of horizon) {
    if (!sameObserver(plan, input)) continue;
    for (const entry of plan.ranking.ranked) {
      const opportunity = entry.opportunity;
      const eligibility = eligibilityFor(plan, entry);
      if (!eligibility.eligible) continue;

      const window = bestViewingWindow(
        opportunity.profile,
        input.evidence,
        opportunity.transparency,
        entry.strength,
        input.now,
      );
      if (!window || window.viewability.access === null) continue;
      if (window.viewability.freshness === "stale") continue;
      if (window.viewability.band !== "excellent" && window.viewability.band !== "good") continue;

      const admission = admissible(input.equipment, opportunity, {
        latitudeDeg: input.observer.latitudeDeg,
        longitudeDeg: input.observer.longitudeDeg,
        atUtc: window.peakUtc,
        artificialLightRadiance: input.artificialLightRadiance,
      });
      if (!admission.admitted) continue;

      const where = whereFor(plan, opportunity.id, window.peakUtc);
      const durationMinutes = window.brief
        ? Math.max(20, opportunity.guidance.durationMinutes)
        : Math.max(20, Math.round((Date.parse(window.endUtc) - Date.parse(window.startUtc)) / 60_000));
      const reason = opportunity.significance?.reasons[0] ?? eligibility.reason;
      candidates.push({
        planIdentityKey: plan.identity.key,
        dateKey: plan.dateKey,
        opportunityId: opportunity.id,
        title: opportunity.title,
        startUtc: window.startUtc,
        endUtc: window.endUtc,
        peakUtc: window.peakUtc,
        brief: window.brief,
        quality: window.viewability.band,
        where,
        reason,
        forecastNote: forecastNote(window.peakUtc, input.now, window.viewability.freshness),
        reminder: {
          title: `Orbit Studio Tracker — ${opportunity.title}`,
          description: `${reason} Look ${where.toLowerCase()}. ${opportunity.guidance.appearance}`,
          startUtc: window.brief ? window.peakUtc : window.startUtc,
          durationMinutes,
        },
        rank: entry.rank,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      Date.parse(left.startUtc) - Date.parse(right.startUtc) || left.rank - right.rank,
  );
  const best = candidates[0];
  if (!best) return null;
  const { rank: _rank, ...chance } = best;
  return chance;
}

export function recoveryCopy(input: {
  withheldByCloud: number;
  selectedDate: string;
  today: string;
}): { title: string; detail: string } {
  const relative = input.selectedDate === input.today ? "tonight" : `on ${shortDate(input.selectedDate)}`;
  if (input.withheldByCloud > 0) {
    return {
      title: `Clouded out ${relative}`,
      detail:
        input.withheldByCloud === 1
          ? "1 worthwhile target is blocked by cloud."
          : `${input.withheldByCloud} worthwhile targets are blocked by cloud.`,
    };
  }
  return {
    title: input.selectedDate === input.today ? "Not tonight" : `Not on ${shortDate(input.selectedDate)}`,
    detail: "Nothing is well placed enough to recommend.",
  };
}

function shortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

/** Date language is anchored to the selected Tracker night, not the device's today. */
export function chanceDateLabel(dateKey: string, selectedDate: string, today: string): string {
  const toOrdinal = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  const offset = toOrdinal(dateKey) - toOrdinal(selectedDate);
  if (offset === 0) return selectedDate === today ? "Later tonight" : "Selected night";
  if (offset === 1 && selectedDate === today) return "Tomorrow";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

export type RecoveryContent =
  | { kind: "chance"; chance: NextBestChance }
  | { kind: "upcoming"; event: UpcomingEvent }
  | { kind: "none" };

/**
 * Upcoming is deliberately broad enough to serve lunar observers as well as
 * people planning around rare events. Recovery has a narrower job: name the
 * next thing worth anticipating after a disappointing night. Keep that policy
 * here, over Upcoming's authoritative events, rather than changing or copying
 * the Upcoming pipeline itself.
 */
export function anticipationWorthyRecoveryEvent(
  events: UpcomingEvent[],
): UpcomingEvent | null {
  return (
    events.find((event) => {
      if (event.kind === "solar-eclipse" || event.kind === "aurora") return true;

      const kind = event.notable.kind;
      if (kind === "moon-phase" || kind === "quarter-phase" || kind === "dark-sky") {
        return false;
      }

      // A wide, routine pairing can still be useful in Upcoming, but should
      // not become the hopeful headline of an otherwise empty night.
      if (kind === "conjunction") {
        const tier = event.notable.entry.significance.tier;
        return tier === "favourable" || tier === "notable";
      }

      // Eclipse maxima, shower peaks and oppositions are distinctive by their
      // physical classification rather than by an arbitrary display score.
      return kind === "eclipse" || kind === "shower-peak" || kind === "opposition";
    }) ?? null
  );
}

/** Normal nights never enter recovery; Upcoming is the authoritative fallback. */
export function recoveryContent(input: {
  currentRecommendationCount: number;
  chance: NextBestChance | null;
  upcomingEvents: UpcomingEvent[];
}): RecoveryContent | null {
  if (input.currentRecommendationCount > 0) return null;
  if (input.chance) return { kind: "chance", chance: input.chance };
  const event = anticipationWorthyRecoveryEvent(input.upcomingEvents);
  return event ? { kind: "upcoming", event } : { kind: "none" };
}
