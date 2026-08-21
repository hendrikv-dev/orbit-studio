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

