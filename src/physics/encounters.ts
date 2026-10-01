import { MU_EARTH_KM3_S2 } from "./constants";

/**
 * Hypothetical close approaches, and what it takes to avoid one.
 *
 * This is deliberately not conjunction assessment. Real screening needs current
 * ephemerides and covariance, and Orbit Studio has neither — so nothing here
 * produces a probability of collision, and none of it describes any real pair
 * of objects. What it does give is the geometry and the energy, which are the
 * parts a student can reason about and which do not require knowing where
 * anything actually is.
 *
 * Two results carry the section:
 *
 *   - closing speed is set by the crossing angle, not by how fast either object
 *     is going, so two objects in the same shell can meet at 15 km/s or at
 *     walking pace depending only on the angle between their planes;
 *   - an along-track burn displaces you three times further than the naive
 *     product of burn and time, because changing speed changes the period and
 *     the error accumulates every orbit.
 */

/** Closing speed from two speeds and the angle between the velocity vectors. */
export function relativeSpeedKmS(
  speedAKmS: number,
  speedBKmS: number,
  crossingAngleDeg: number,
): number {
  const angle = (crossingAngleDeg * Math.PI) / 180;
  return Math.sqrt(
    speedAKmS ** 2 + speedBKmS ** 2 - 2 * speedAKmS * speedBKmS * Math.cos(angle),
  );
}

/** Circular orbital speed, repeated here so the module stands alone. */
export function circularSpeedKmS(radiusKm: number): number {
  return Math.sqrt(MU_EARTH_KM3_S2 / radiusKm);
}

/**
 * Energy-to-mass ratio in joules per gram — the quantity that decides whether a
 * collision shatters the target or merely damages it. Defined against the
 * target's mass, which is why a small object can destroy a large one.
 */
export function energyToMassRatioJPerG(
  relativeSpeedKmS: number,
  projectileMassKg: number,
  targetMassKg: number,
): number {
  if (targetMassKg <= 0) return 0;
  const speedMS = relativeSpeedKmS * 1000;
  const energyJoules = 0.5 * projectileMassKg * speedMS ** 2;
  return energyJoules / (targetMassKg * 1000);
}

/**
 * The conventional threshold above which a collision is catastrophic — the
 * target is fragmented rather than cratered. 40 J/g is the value used
 * throughout the debris-modelling literature.
 */
export const CATASTROPHIC_EMR_J_PER_G = 40;

export type CollisionSeverity = "catastrophic" | "non-catastrophic";

export function collisionSeverity(energyToMassRatio: number): CollisionSeverity {
  return energyToMassRatio >= CATASTROPHIC_EMR_J_PER_G ? "catastrophic" : "non-catastrophic";
}

/**
 * NASA Standard Breakup Model, collision branch: the number of fragments larger
 * than a given size.
 *
 *   N(Lc) = 0.1 · M^0.75 · Lc^-1.71
 *
 * For a catastrophic collision M is the combined mass of both objects; for a
 * non-catastrophic one only the kinetic energy of the projectile participates,
 * so M is replaced by the projectile mass scaled by relative speed.
 *
 * This is an order-of-magnitude estimate by design. Against the 2009
 * Iridium 33 / Kosmos-2251 collision it predicts roughly 1,200 fragments above
 * 10 cm where about 2,300 were eventually catalogued — the right size, not the
 * right number, which is what the model claims for itself.
 */
export function breakupFragmentCount(
  severity: CollisionSeverity,
  relativeSpeedKmS: number,
  projectileMassKg: number,
  targetMassKg: number,
  characteristicLengthM = 0.1,
): number {
  const effectiveMass =
    severity === "catastrophic"
      ? projectileMassKg + targetMassKg
      : projectileMassKg * relativeSpeedKmS;
  if (effectiveMass <= 0 || characteristicLengthM <= 0) return 0;
  return 0.1 * effectiveMass ** 0.75 * characteristicLengthM ** -1.71;
}

/**
 * Along-track displacement from a prograde or retrograde burn, after a given
 * lead time.
 *
 * A burn changes the semi-major axis, which changes the period, so the along-
 * track error grows every orbit rather than once. Working it through gives a
 * factor of three that surprises people:
 *
 *   Δa/a = 2Δv/v,  ΔT/T = (3/2)(Δa/a) = 3Δv/v,  Δs = v·ΔT per orbit = 3·T·Δv
 *
 * and summing over t/T orbits leaves Δs = 3·Δv·t, independent of the orbit.
 */
export function alongTrackDriftKm(deltaVMetersPerSecond: number, leadTimeSeconds: number): number {
  return (3 * (deltaVMetersPerSecond / 1000) * leadTimeSeconds);
}

/** The burn needed to open a given miss distance, given the time available. */
export function avoidanceDeltaVMetersPerSecond(
  requiredMissKm: number,
  leadTimeSeconds: number,
): number {
  if (leadTimeSeconds <= 0) return Infinity;
  return (requiredMissKm / (3 * leadTimeSeconds)) * 1000;
}

export interface EncounterAssessment {
  relativeSpeedKmS: number;
  energyToMassRatioJPerG: number;
  severity: CollisionSeverity;
  /** Fragments larger than 10 cm, on the NASA standard model. */
  fragmentsOver10cm: number;
  /** Fragments larger than 1 cm — the population that is lethal but untracked. */
  fragmentsOver1cm: number;
}

export function assessEncounter(
  altitudeKm: number,
  crossingAngleDeg: number,
  projectileMassKg: number,
  targetMassKg: number,
  earthRadiusKm = 6378.137,
): EncounterAssessment {
  const speed = circularSpeedKmS(earthRadiusKm + altitudeKm);
  const relative = relativeSpeedKmS(speed, speed, crossingAngleDeg);
  const emr = energyToMassRatioJPerG(relative, projectileMassKg, targetMassKg);
  const severity = collisionSeverity(emr);
  return {
    relativeSpeedKmS: relative,
    energyToMassRatioJPerG: emr,
    severity,
    fragmentsOver10cm: breakupFragmentCount(severity, relative, projectileMassKg, targetMassKg, 0.1),
    fragmentsOver1cm: breakupFragmentCount(severity, relative, projectileMassKg, targetMassKg, 0.01),
  };
}
