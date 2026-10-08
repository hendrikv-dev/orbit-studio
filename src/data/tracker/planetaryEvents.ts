import { Body, SearchRelativeLongitude } from "astronomy-engine";
import {
  angularSeparationDegrees,
  utcInstant,
  type AngularSeparationDegrees,
  type UtcInstant,
} from "./scientificUnits";

export const OPPOSITION_BODIES = [Body.Mars, Body.Jupiter, Body.Saturn] as const;
export type OppositionBody = (typeof OPPOSITION_BODIES)[number];

export interface PlanetaryOpposition {
  kind: "opposition";
  body: OppositionBody;
  atUtc: UtcInstant;
  /** Heliocentric ecliptic longitude difference between body and Earth. */
  targetRelativeLongitudeDeg: 0;
  geometricMeaning: "Earth lies between the Sun and a superior planet";
}

export function supportsOpposition(body: Body): body is OppositionBody {
  return (OPPOSITION_BODIES as readonly Body[]).includes(body);
}

/** Returns an opposition only when its physical instant belongs to this period. */
export function oppositionDuring(
  body: Body,
  startUtc: string,
  endUtc: string,
): PlanetaryOpposition | null {
  if (!supportsOpposition(body)) return null;
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  const event = SearchRelativeLongitude(body, 0, new Date(start - 86_400_000));
  const stamp = event.date.getTime();
  if (stamp < start || stamp > end) return null;
  return {
    kind: "opposition",
    body,
    atUtc: utcInstant(event.date),
    targetRelativeLongitudeDeg: 0,
    geometricMeaning: "Earth lies between the Sun and a superior planet",
  };
}

/**
 * The opposition nearest an instant, in days, signed.
 *
 * Negative before, positive after. `oppositionDuring` answers a different and
 * narrower question — did an opposition happen *inside this night* — which is
 * the right test for "is there an event tonight" and useless for "how close to
 * its best is this planet", because a planet three weeks from opposition is
 * within a few percent of its largest and brightest and the narrow test says
 * nothing at all.
 *
 * Returns null for Venus and Mercury, whose orbits are inside Earth's and which
 * therefore never reach opposition. Reporting one for them would be a
 * fabricated geometry rather than a rounding error.
 */
export function nearestOpposition(body: Body, at: Date): number | null {
  if (!supportsOpposition(body)) return null;
  const next = SearchRelativeLongitude(body, 0, at).date.getTime();
  // Synodic periods here run from about 780 days (Mars) to 378 (Saturn), so a
  // search started two Martian synodic periods back is guaranteed to bracket
  // the previous opposition for every supported body.
  let previous: number | null = null;
  let cursor = SearchRelativeLongitude(body, 0, new Date(at.getTime() - 1600 * 86_400_000)).date;
  for (let step = 0; step < 8 && cursor.getTime() < at.getTime(); step += 1) {
    previous = cursor.getTime();
    cursor = SearchRelativeLongitude(body, 0, new Date(cursor.getTime() + 30 * 86_400_000)).date;
  }
  const toNext = (next - at.getTime()) / 86_400_000;
  const sincePrevious = previous === null ? Infinity : (at.getTime() - previous) / 86_400_000;
  return Math.abs(toNext) <= Math.abs(sincePrevious) ? -toNext : sincePrevious;
}

export function angularSeparation(
  a: { altitudeDeg: number; azimuthDeg: number },
  b: { altitudeDeg: number; azimuthDeg: number },
): AngularSeparationDegrees {
  const toRad = Math.PI / 180;
  const cosine =
    Math.sin(a.altitudeDeg * toRad) * Math.sin(b.altitudeDeg * toRad) +
    Math.cos(a.altitudeDeg * toRad) *
      Math.cos(b.altitudeDeg * toRad) *
      Math.cos((a.azimuthDeg - b.azimuthDeg) * toRad);
  return angularSeparationDegrees(Math.acos(Math.min(1, Math.max(-1, cosine))) / toRad);
}

