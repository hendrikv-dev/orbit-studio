import { MU_EARTH_KM3_S2 } from "./constants";

/**
 * Impulsive two-body manoeuvres: what it costs to move between orbits.
 *
 * Unlike everything in Explorer, none of this consumes the catalog. These are
 * closed-form results a student derives on paper, and Playground's job is to
 * let them be felt rather than read — the interesting numbers are the ones that
 * are counter-intuitive until you see them move:
 *
 *   - a plane change is ruinously expensive low down and cheap at apogee, so
 *     the same inclination change costs several km/s or a few hundred m/s
 *     depending only on where you do it;
 *   - combining a plane change with an altitude burn costs less than doing both,
 *     because vector addition is not scalar addition;
 *   - above a radius ratio of about 11.94 a three-burn bi-elliptic transfer
 *     beats the Hohmann transfer that is supposed to be optimal.
 *
 * Every function is impulsive and two-body: no finite burn duration, no drag,
 * no third body, no J2. That is the standard first-order mission budget and it
 * is what the numbers here mean.
 */

export interface Burn {
  id: string;
  label: string;
  deltaVKmS: number;
  /** Where the burn happens, as orbit radius from Earth's centre. */
  radiusKm: number;
}

export interface TransferPlan {
  kind: "hohmann" | "bi-elliptic";
  burns: Burn[];
  totalDeltaVKmS: number;
  transferTimeSeconds: number;
}

/** Speed of a circular orbit at the given radius. */
export function circularSpeedKmS(radiusKm: number): number {
  return Math.sqrt(MU_EARTH_KM3_S2 / radiusKm);
}

/** Vis-viva: speed at radius r on an orbit of semi-major axis a. */
export function visVivaSpeedKmS(radiusKm: number, semiMajorAxisKm: number): number {
  return Math.sqrt(MU_EARTH_KM3_S2 * (2 / radiusKm - 1 / semiMajorAxisKm));
}

function halfPeriodSeconds(semiMajorAxisKm: number): number {
  return Math.PI * Math.sqrt(semiMajorAxisKm ** 3 / MU_EARTH_KM3_S2);
}

/**
 * Two-burn transfer between circular orbits. The classic result, and the
 * baseline every other plan is measured against.
 */
export function hohmannTransfer(fromRadiusKm: number, toRadiusKm: number): TransferPlan {
  const transferSemiMajorAxis = (fromRadiusKm + toRadiusKm) / 2;
  const departureSpeed = circularSpeedKmS(fromRadiusKm);
  const arrivalSpeed = circularSpeedKmS(toRadiusKm);
  const transferAtDeparture = visVivaSpeedKmS(fromRadiusKm, transferSemiMajorAxis);
  const transferAtArrival = visVivaSpeedKmS(toRadiusKm, transferSemiMajorAxis);

  const first = Math.abs(transferAtDeparture - departureSpeed);
  const second = Math.abs(arrivalSpeed - transferAtArrival);
  return {
    kind: "hohmann",
    burns: [
      { id: "depart", label: "Perigee burn", deltaVKmS: first, radiusKm: fromRadiusKm },
      { id: "arrive", label: "Apogee burn", deltaVKmS: second, radiusKm: toRadiusKm },
    ],
    totalDeltaVKmS: first + second,
    transferTimeSeconds: halfPeriodSeconds(transferSemiMajorAxis),
  };
}

/**
 * Three-burn transfer by way of a high intermediate apoapsis. Costs more time
 * and an extra burn, and for large radius ratios it still wins, because raising
 * apoapsis far out makes the plane-independent circularisation almost free.
 */
export function biellipticTransfer(
  fromRadiusKm: number,
  toRadiusKm: number,
  intermediateRadiusKm: number,
): TransferPlan {
  const firstEllipse = (fromRadiusKm + intermediateRadiusKm) / 2;
  const secondEllipse = (intermediateRadiusKm + toRadiusKm) / 2;

  const first = Math.abs(visVivaSpeedKmS(fromRadiusKm, firstEllipse) - circularSpeedKmS(fromRadiusKm));
  const second = Math.abs(
    visVivaSpeedKmS(intermediateRadiusKm, secondEllipse) -
      visVivaSpeedKmS(intermediateRadiusKm, firstEllipse),
  );
  const third = Math.abs(
    circularSpeedKmS(toRadiusKm) - visVivaSpeedKmS(toRadiusKm, secondEllipse),
  );

  return {
    kind: "bi-elliptic",
    burns: [
      { id: "raise", label: "Raise apoapsis", deltaVKmS: first, radiusKm: fromRadiusKm },
      { id: "adjust", label: "Adjust periapsis", deltaVKmS: second, radiusKm: intermediateRadiusKm },
      { id: "circularise", label: "Circularise", deltaVKmS: third, radiusKm: toRadiusKm },
    ],
    totalDeltaVKmS: first + second + third,
    transferTimeSeconds: halfPeriodSeconds(firstEllipse) + halfPeriodSeconds(secondEllipse),
  };
}

/**
 * The radius ratio above which a bi-elliptic transfer can beat a Hohmann one.
 * Below about 11.94 the Hohmann transfer is always cheaper; between 11.94 and
 * 15.58 it depends on the intermediate radius chosen.
 */
export const BIELLIPTIC_ALWAYS_WORSE_RATIO = 11.93876;
export const BIELLIPTIC_ALWAYS_BETTER_RATIO = 15.58172;

/** Simple plane change at a fixed speed: the isoceles-triangle result. */
export function planeChangeDeltaVKmS(speedKmS: number, deltaInclinationDeg: number): number {
  const half = (deltaInclinationDeg * Math.PI) / 360;
  return 2 * speedKmS * Math.abs(Math.sin(half));
}

/**
 * One burn doing both jobs at once. Turning and accelerating share a single
 * vector, so the cost is the triangle's third side rather than the sum of two
 * sides — which is why plane changes are folded into an altitude burn whenever
 * the mission allows it.
 */
export function combinedBurnDeltaVKmS(
  speedBeforeKmS: number,
  speedAfterKmS: number,
  deltaInclinationDeg: number,
): number {
  const angle = (deltaInclinationDeg * Math.PI) / 180;
  return Math.sqrt(
    speedBeforeKmS ** 2 + speedAfterKmS ** 2 - 2 * speedBeforeKmS * speedAfterKmS * Math.cos(angle),
  );
}

export interface MissionPlan {
  transfer: TransferPlan;
  /** Inclination change folded into the transfer's burns. */
  planeChangeDeg: number;
  /** Total including the plane change, done the cheapest way found. */
  totalDeltaVKmS: number;
  /** Fraction of the plane change performed at the higher (slower) burn. */
  planeChangeAtArrivalFraction: number;
  /** What the same plane change would cost done alone in the departure orbit. */
  naiveDeltaVKmS: number;
}

/**
 * Plan an altitude change with an inclination change, splitting the turn
 * between the two burns wherever it is cheapest.
 *
 * The split is searched rather than solved: the optimum has no useful closed
 * form, and a scan over the single free parameter is both exact enough and
 * inspectable, which matters more here than elegance.
 */
export function planMission(
  fromRadiusKm: number,
  toRadiusKm: number,
  planeChangeDeg: number,
  samples = 201,
): MissionPlan {
  const transfer = hohmannTransfer(fromRadiusKm, toRadiusKm);
  const transferSemiMajorAxis = (fromRadiusKm + toRadiusKm) / 2;

  const departureCircular = circularSpeedKmS(fromRadiusKm);
  const departureTransfer = visVivaSpeedKmS(fromRadiusKm, transferSemiMajorAxis);
  const arrivalTransfer = visVivaSpeedKmS(toRadiusKm, transferSemiMajorAxis);
  const arrivalCircular = circularSpeedKmS(toRadiusKm);

  let best = { total: Infinity, fraction: 0 };
  for (let index = 0; index < samples; index += 1) {
    const fraction = index / (samples - 1);
    const atDeparture = planeChangeDeg * (1 - fraction);
    const atArrival = planeChangeDeg * fraction;
    const total =
      combinedBurnDeltaVKmS(departureCircular, departureTransfer, atDeparture) +
      combinedBurnDeltaVKmS(arrivalTransfer, arrivalCircular, atArrival);
    if (total < best.total) best = { total, fraction };
  }

  return {
    transfer,
    planeChangeDeg,
    totalDeltaVKmS: best.total,
    planeChangeAtArrivalFraction: best.fraction,
    naiveDeltaVKmS:
      transfer.totalDeltaVKmS + planeChangeDeltaVKmS(departureCircular, planeChangeDeg),
  };
}

/** Rocket equation: propellant mass fraction for a given budget. */
export function propellantMassFraction(deltaVKmS: number, exhaustVelocityKmS: number): number {
  return 1 - Math.exp(-deltaVKmS / exhaustVelocityKmS);
}

/** Specific impulse in seconds to exhaust velocity in km/s. */
export function exhaustVelocityKmS(specificImpulseSeconds: number): number {
  return (specificImpulseSeconds * 9.80665) / 1000;
}
