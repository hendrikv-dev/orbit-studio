import type { TrackerPlanningRequest } from "./planningProtocol";
import type { UpcomingEvent } from "./upcomingEvents";

/** A range is a planning input, not a presentation-only filter. */
export const UPCOMING_RANGES = [
  { id: "7-days", label: "7d", days: 7, notableLimit: 12 },
  { id: "30-days", label: "30d", days: 30, notableLimit: 24 },
  { id: "3-months", label: "3mo", days: 90, notableLimit: 40 },
  { id: "year", label: "Year", days: 365, notableLimit: 64 },
] as const;

export type UpcomingRangeId = (typeof UPCOMING_RANGES)[number]["id"];

export function upcomingRange(id: UpcomingRangeId) {
  return UPCOMING_RANGES.find((range) => range.id === id) ?? UPCOMING_RANGES[1];
}

export function upcomingRangeEnd(from: Date, id: UpcomingRangeId): Date {
  return new Date(from.getTime() + upcomingRange(id).days * 86_400_000);
}

/**
 * The complete authoritative input for one Upcoming request.
 *
 * Latitude and longitude remain unrounded here. Service-level weather grids
 * may share their own cells, but two selected observing points must never
 * share an astronomical plan merely because their display coordinates look
 * alike.
 */
export function upcomingPlanningRequest(input: {
  latitudeDeg: number;
  longitudeDeg: number;
  from: Date;
  timeZone: string | null;
  range: UpcomingRangeId;
}): TrackerPlanningRequest {
  return {
    kind: "nights",
    latitudeDeg: input.latitudeDeg,
    longitudeDeg: input.longitudeDeg,
    fromUtc: input.from.toISOString(),
    nights: upcomingRange(input.range).days,
    timeZone: input.timeZone,
  };
}

/**
 * A compact, location-aware line for the discovery sheet.
 *
 * The first two event families already carry local geometry. Aurora's
 * three-day K-index does not: it says how disturbed the magnetic field may be,
 * not where the oval will be. Saying that limitation is the local answer; a
 * latitude-derived promise would fabricate spatial precision the source does
 * not contain.
 */
export function upcomingLocalContext(event: UpcomingEvent): string {
  if (event.kind === "solar-eclipse") {
    const covered = Math.round(event.local.obscurationFraction * 100);
    const altitude = Math.round(event.local.sunAltitudeAtPeakDeg);
    return `${covered}% covered here · ${altitude}° above the horizon at maximum`;
  }

  if (event.kind === "aurora") {
    return "Global activity forecast · local oval position is not known yet";
  }

  const guidance = event.notable.entry.opportunity.guidance;
  const parts = [guidance.elevation];
  if (guidance.direction) parts.push(`face ${guidance.direction.toLowerCase()}`);
  if (guidance.equipment !== "eyes") parts.push(`${guidance.equipment} needed`);
  return parts.join(" · ");
}
