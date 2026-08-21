import { Body, Equator, Horizon, MakeTime, Observer, type LunarEclipseInfo } from "astronomy-engine";
import {
  minutes,
  minutesToMilliseconds,
  offsetUtc,
  subtractUtc,
  utcInstant,
  type Minutes,
  type UtcInstant,
} from "./scientificUnits";

export interface EclipseContactPair {
  startUtc: UtcInstant;
  endUtc: UtcInstant;
  durationMinutes: Minutes;
}

export interface LunarEclipseTiming {
  /** Astronomy Engine computes eclipse circumstances in UTC/UT. */
  timeScale: "UTC";
  maximumUtc: UtcInstant;
  penumbral: EclipseContactPair;
  partial: EclipseContactPair | null;
  totality: EclipseContactPair | null;
  /** The phase a user can reasonably be asked to watch for this eclipse kind. */
  observablePhase: EclipseContactPair;
}

function contacts(maximumUtc: UtcInstant, semiDurationMinutes: number): EclipseContactPair {
  const semi = minutes(semiDurationMinutes);
  const offset = minutesToMilliseconds(semi);
  return {
    startUtc: subtractUtc(maximumUtc, offset),
    endUtc: offsetUtc(maximumUtc, offset),
    durationMinutes: minutes(Number(semi) * 2),
  };
}

/**
 * Normalizes Astronomy Engine's semi-duration fields at the dependency edge.
 * Every `sd_*` field is minutes, not hours, and is half the corresponding phase.
 */
export function lunarEclipseTiming(eclipse: LunarEclipseInfo): LunarEclipseTiming {
  const maximumUtc = utcInstant(eclipse.peak.date);
  const penumbral = contacts(maximumUtc, eclipse.sd_penum);
  const partial = eclipse.sd_partial > 0 ? contacts(maximumUtc, eclipse.sd_partial) : null;
  const totality = eclipse.sd_total > 0 ? contacts(maximumUtc, eclipse.sd_total) : null;
  return {
    timeScale: "UTC",
    maximumUtc,
    penumbral,
    partial,
    totality,
    observablePhase: partial ?? penumbral,
  };
}

/* ------------------------------------------------------- visibility footprint */

/**
 * Where on Earth this eclipse can be seen.
 *
 * A lunar eclipse has no track. The Moon is eclipsed for everyone at once, so
 * the only question is whether the Moon is above your horizon while it happens —
 * which makes the footprint the night side of Earth, swept across the eclipse's
 * duration and centred on the sub-lunar point.
 *
 * That distinction matters for the interface as much as for the astronomy. A
 * solar eclipse map has to show a path because the phenomenon has one; a lunar
 * eclipse map showing a path would be inventing a structure the event does not
 * have. What it shows instead is how much of the eclipse each place gets, which
 * is a real gradient: at the edge of the footprint the Moon rises mid-eclipse or
 * sets part-way through it.
 */
export interface LunarVisibilityCell {
  latitudeDeg: number;
  longitudeDeg: number;
  /** Fraction of the observable phase with the Moon above the horizon, 0–1. */
  visibleFraction: number;
  /** Moon altitude at maximum eclipse. Negative means it is below the horizon. */
  altitudeAtMaximumDeg: number;
}

export interface LunarVisibilityField {
  cells: LunarVisibilityCell[];
  stepDeg: number;
  bounds: { south: number; north: number; west: number; east: number };
}

function moonAltitudeDeg(at: Date, latitudeDeg: number, longitudeDeg: number): number {
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const time = MakeTime(at);
  const equator = Equator(Body.Moon, time, observer, true, true);
  return Horizon(time, observer, equator.ra, equator.dec, "normal").altitude;
}

/** How much of the eclipse one place gets, from the same geometry the map draws. */
export function lunarVisibilityAt(
  timing: LunarEclipseTiming,
  latitudeDeg: number,
  longitudeDeg: number,
  samples = 9,
): LunarVisibilityCell {
  const start = Date.parse(timing.observablePhase.startUtc);
  const end = Date.parse(timing.observablePhase.endUtc);
  let up = 0;
  for (let index = 0; index < samples; index += 1) {
    const at = new Date(start + ((end - start) * index) / (samples - 1));
    if (moonAltitudeDeg(at, latitudeDeg, longitudeDeg) > 0) up += 1;
  }
  return {
    latitudeDeg,
    longitudeDeg,
    visibleFraction: up / samples,
    altitudeAtMaximumDeg: moonAltitudeDeg(new Date(timing.maximumUtc), latitudeDeg, longitudeDeg),
  };
}

export function lunarVisibilityField(
  timing: LunarEclipseTiming,
  bounds: { south: number; north: number; west: number; east: number },
  stepDeg = 4,
): LunarVisibilityField {
  const cells: LunarVisibilityCell[] = [];
  for (let lat = bounds.south; lat <= bounds.north + 1e-9; lat += stepDeg) {
    for (let lon = bounds.west; lon <= bounds.east + 1e-9; lon += stepDeg) {
      cells.push(lunarVisibilityAt(timing, lat, ((lon + 540) % 360) - 180, 5));
    }
  }
  return { cells, stepDeg, bounds };
}
