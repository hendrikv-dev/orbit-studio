import { Body, Illumination, MakeTime, MoonPhase } from "astronomy-engine";
import {
  illuminationFraction,
  phaseCycleDegrees,
  type IlluminationFraction,
  type PhaseCycleDegrees,
  type UtcInstant,
  utcInstant,
} from "./scientificUnits";

export const SYNODIC_MONTH_DAYS = 29.530588;

export type LunarPhaseName =
  | "New Moon"
  | "Waxing Crescent"
  | "First Quarter"
  | "Waxing Gibbous"
  | "Full Moon"
  | "Waning Gibbous"
  | "Last Quarter"
  | "Waning Crescent";

export type LunarPhaseDirection = "new" | "waxing" | "full" | "waning";

export interface LunarPhase {
  /** UTC instant at which every field in this structure is valid. */
  atUtc: UtcInstant;
  /** Geocentric Moon-minus-Sun ecliptic longitude, [0, 360). */
  cycleAngleDeg: PhaseCycleDegrees;
  /** Fraction of the apparent lunar disc illuminated, [0, 1]. */
  illuminatedFraction: IlluminationFraction;
  /** Approximate age since New Moon, derived from the cycle angle. */
  lunarAgeDays: number;
  direction: LunarPhaseDirection;
  name: LunarPhaseName;
  waxing: boolean;
  waning: boolean;
}

/** About six hours of lunar motion, used only to name the exact principal phases. */
const PRINCIPAL_PHASE_TOLERANCE_DEG = 3;

function angularDistance(left: number, right: number): number {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

/**
 * One authoritative classification from the Moon's 0..360° ecliptic cycle.
 * New/quarter/full names describe a boundary event, not a multi-day bin. On
 * either side, the waxing/waning crescent/gibbous name follows the direction
 * of the 0..360° cycle. This is why a Moon ten hours after Last Quarter is a
 * waning crescent instead of remaining mislabeled Last Quarter.
 */
export function classifyLunarPhase(
  cycleAngle: PhaseCycleDegrees,
  fraction: IlluminationFraction,
  atUtc: UtcInstant,
): LunarPhase {
  const angle = Number(cycleAngle);
  const atNew = angularDistance(angle, 0) <= PRINCIPAL_PHASE_TOLERANCE_DEG;
  const atFirstQuarter = angularDistance(angle, 90) <= PRINCIPAL_PHASE_TOLERANCE_DEG;
  const atFull = angularDistance(angle, 180) <= PRINCIPAL_PHASE_TOLERANCE_DEG;
  const atLastQuarter = angularDistance(angle, 270) <= PRINCIPAL_PHASE_TOLERANCE_DEG;
  const name: LunarPhaseName = atNew
    ? "New Moon"
    : atFirstQuarter
      ? "First Quarter"
      : atFull
        ? "Full Moon"
        : atLastQuarter
          ? "Last Quarter"
          : angle < 90
            ? "Waxing Crescent"
            : angle < 180
              ? "Waxing Gibbous"
              : angle < 270
                ? "Waning Gibbous"
                : "Waning Crescent";
  const direction: LunarPhaseDirection = atNew ? "new" : atFull ? "full" : angle < 180 ? "waxing" : "waning";

  return {
    atUtc,
    cycleAngleDeg: cycleAngle,
    illuminatedFraction: fraction,
    lunarAgeDays: (angle / 360) * SYNODIC_MONTH_DAYS,
    direction,
    name,
    waxing: direction === "waxing",
    waning: direction === "waning",
  };
}

/**
 * Astronomy Engine owns the ephemeris. `MoonPhase` supplies the directional
 * 0..360° cycle; `Illumination.phase_fraction` supplies apparent illumination.
 * `Illumination.phase_angle` is intentionally not used for direction because
 * it is a symmetric 0..180° Sun-body-observer angle.
 */
export function lunarPhaseAt(at: Date): LunarPhase {
  const time = MakeTime(at);
  return classifyLunarPhase(
    phaseCycleDegrees(MoonPhase(time)),
    illuminationFraction(Illumination(Body.Moon, time).phase_fraction),
    utcInstant(at),
  );
}
