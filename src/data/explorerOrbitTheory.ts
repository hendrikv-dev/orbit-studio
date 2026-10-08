import { EARTH_RADIUS_KM } from "../physics/constants";

/**
 * Closed-form orbital relationships, drawn over the real population so the
 * textbook result and the catalog can be read together.
 *
 * Nothing here consumes catalog data. These are the analytic curves a student
 * derives on paper; the population view supplies the measured population, and
 * the interesting part is that the two agree. Every curve is a function of
 * geometry and Earth's gravity field alone, so overlaying them introduces no
 * data-provenance claim of any kind.
 */

/** Earth's second zonal harmonic — the oblateness term that drives nodal drift. */
export const J2 = 1.08262668e-3;
export const EARTH_MU_KM3_S2 = 398600.4418;
/** One rotation relative to the stars, not to the Sun. */
export const SIDEREAL_DAY_SECONDS = 86164.0905;
/** Mean solar year; the rate a sun-synchronous plane must precess to keep up. */
export const TROPICAL_YEAR_SECONDS = 365.2422 * 86400;

/**
 * Inclination whose J2-driven nodal regression exactly matches Earth's mean
 * motion about the Sun, holding the orbit plane at a fixed angle to sunlight.
 *
 *   Ω̇ = -(3/2) J2 (Re/p)² n cos i      and we require Ω̇ = 2π / tropical year
 *
 * Returns null where no inclination satisfies it — above roughly 6000 km of
 * altitude the required precession is simply unreachable.
 */
export function sunSynchronousInclinationDeg(
  semiMajorAxisKm: number,
  eccentricity = 0,
): number | null {
  if (!(semiMajorAxisKm > EARTH_RADIUS_KM) || eccentricity < 0 || eccentricity >= 1) return null;
  const meanMotion = Math.sqrt(EARTH_MU_KM3_S2 / semiMajorAxisKm ** 3);
  const semiLatusRectum = semiMajorAxisKm * (1 - eccentricity ** 2);
  const sunRate = (2 * Math.PI) / TROPICAL_YEAR_SECONDS;
  const cosine =
    (-2 * sunRate) / (3 * J2 * (EARTH_RADIUS_KM / semiLatusRectum) ** 2 * meanMotion);
  if (cosine < -1 || cosine > 1) return null;
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * Nodal precession in degrees per day. Exposed because the number itself is the
 * explanation: at the sun-synchronous inclination it reads ~0.9856°/day, which
 * is 360° over a year.
 */
export function nodalPrecessionDegPerDay(
  semiMajorAxisKm: number,
  eccentricity: number,
  inclinationDeg: number,
): number {
  const meanMotion = Math.sqrt(EARTH_MU_KM3_S2 / semiMajorAxisKm ** 3);
  const semiLatusRectum = semiMajorAxisKm * (1 - eccentricity ** 2);
  const rate =
    -1.5 * J2 * (EARTH_RADIUS_KM / semiLatusRectum) ** 2 * meanMotion *
    Math.cos((inclinationDeg * Math.PI) / 180);
  return (rate * 86400 * 180) / Math.PI;
}

/**
 * The inclination at which J2 stops rotating the line of apsides, so a highly
 * eccentric orbit keeps its apogee over the same latitude. Molniya and Tundra
 * orbits are built on it.
 */
export const CRITICAL_INCLINATION_DEG = 63.4349;
export const RETROGRADE_CRITICAL_INCLINATION_DEG = 180 - CRITICAL_INCLINATION_DEG;

/** Semi-major-axis altitude of a circular orbit with the given period. */
export function altitudeForPeriodKm(periodSeconds: number): number {
  const semiMajorAxisKm = Math.cbrt(
    (EARTH_MU_KM3_S2 * (periodSeconds / (2 * Math.PI)) ** 2),
  );
  return semiMajorAxisKm - EARTH_RADIUS_KM;
}

/** ~35,786 km: one revolution per sidereal day. */
export function geostationaryAltitudeKm(): number {
  return altitudeForPeriodKm(SIDEREAL_DAY_SECONDS);
}

/** ~20,184 km: two revolutions per sidereal day, where the navigation shells sit. */
export function semiSynchronousAltitudeKm(): number {
  return altitudeForPeriodKm(SIDEREAL_DAY_SECONDS / 2);
}

export interface OrbitTheoryCurve {
  id: string;
  label: string;
  /** One line of physics, shown when the curve is highlighted. */
  explanation: string;
  kind: "inclination-of-altitude" | "constant-inclination" | "constant-altitude";
  /** For `inclination-of-altitude`: inclination at a given semi-major-axis altitude. */
  inclinationAt?: (altitudeKm: number) => number | null;
  inclinationDeg?: number;
  altitudeKm?: number;
}

export const explorerOrbitTheoryCurves: OrbitTheoryCurve[] = [
  {
    id: "sun-synchronous",
    label: "Sun-synchronous",
    explanation:
      "Inclination where J2 precesses the orbit plane 360° per year, so the plane holds a fixed angle to sunlight and every pass sees the same local solar time.",
    kind: "inclination-of-altitude",
    inclinationAt: (altitudeKm) =>
      sunSynchronousInclinationDeg(EARTH_RADIUS_KM + altitudeKm, 0),
  },
  {
    id: "critical-inclination",
    label: "Critical inclination 63.4°",
    explanation:
      "J2 stops rotating the line of apsides here, so an eccentric orbit keeps apogee over the same latitude. The basis of Molniya and Tundra orbits.",
    kind: "constant-inclination",
    inclinationDeg: CRITICAL_INCLINATION_DEG,
  },
  {
    id: "critical-inclination-retrograde",
    label: "116.6°",
    explanation: "The retrograde solution of the same frozen-apsides condition.",
    kind: "constant-inclination",
    inclinationDeg: RETROGRADE_CRITICAL_INCLINATION_DEG,
  },
  {
    id: "semi-synchronous",
    label: "Semi-synchronous (12 h)",
    explanation:
      "Two revolutions per sidereal day. The ground track repeats daily, which is why the navigation constellations live here.",
    kind: "constant-altitude",
    altitudeKm: semiSynchronousAltitudeKm(),
  },
  {
    id: "geosynchronous",
    label: "Geosynchronous (24 h)",
    explanation:
      "One revolution per sidereal day. Add zero inclination and zero eccentricity and the spacecraft holds a fixed longitude.",
    kind: "constant-altitude",
    altitudeKm: geostationaryAltitudeKm(),
  },
];
