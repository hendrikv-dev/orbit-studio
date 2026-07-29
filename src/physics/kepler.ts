import {
  EARTH_MU_KM3_S2,
  EARTH_RADIUS_KM,
  TWO_PI,
  degreesToRadians,
  normalizeAngleDegrees,
  normalizeAngleRadians,
  radiansToDegrees,
} from "./constants";
import type { CartesianState, KeplerianElements } from "./types";
import { cross, dot, magnitude, scale, subtract } from "./vector";

const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function trueToEccentricAnomaly(trueAnomalyRad: number, eccentricity: number): number {
  const sinNu = Math.sin(trueAnomalyRad);
  const cosNu = Math.cos(trueAnomalyRad);
  return Math.atan2(
    Math.sqrt(1 - eccentricity * eccentricity) * sinNu,
    eccentricity + cosNu,
  );
}

function eccentricToTrueAnomaly(eccentricAnomalyRad: number, eccentricity: number): number {
  const sinE = Math.sin(eccentricAnomalyRad);
  const cosE = Math.cos(eccentricAnomalyRad);
  return Math.atan2(
    Math.sqrt(1 - eccentricity * eccentricity) * sinE,
    cosE - eccentricity,
  );
}

export function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  const mean = normalizeAngleRadians(meanAnomalyRad);
  let eccentricAnomaly = eccentricity < 0.8 ? mean : Math.PI;

  for (let i = 0; i < 20; i += 1) {
    const delta =
      (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - mean) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;

    if (Math.abs(delta) < 1e-10) {
      break;
    }
  }

  return eccentricAnomaly;
}

export function isValidKeplerian(elements: KeplerianElements): boolean {
  return (
    Number.isFinite(elements.semiMajorAxisKm) &&
    elements.semiMajorAxisKm > EARTH_RADIUS_KM &&
    Number.isFinite(elements.eccentricity) &&
    elements.eccentricity >= 0 &&
    elements.eccentricity < 1 &&
    Number.isFinite(elements.inclinationDeg) &&
    elements.inclinationDeg >= 0 &&
    elements.inclinationDeg <= 180 &&
    Number.isFinite(Date.parse(elements.epoch))
  );
}

export function isValidCartesian(state: CartesianState): boolean {
  return (
    state.positionKm.every(Number.isFinite) &&
    state.velocityKmS.every(Number.isFinite) &&
    magnitude(state.positionKm) > EARTH_RADIUS_KM &&
    magnitude(state.velocityKmS) > 0 &&
    Number.isFinite(Date.parse(state.epoch))
  );
}

export function keplerianToCartesian(
  elements: KeplerianElements,
  mu = EARTH_MU_KM3_S2,
): CartesianState {
  if (!isValidKeplerian(elements)) {
    throw new Error("Invalid Keplerian elements");
  }

  const a = elements.semiMajorAxisKm;
  const e = elements.eccentricity;
  const i = degreesToRadians(elements.inclinationDeg);
  const raan = degreesToRadians(elements.raanDeg);
  const argPeriapsis = degreesToRadians(elements.argumentOfPeriapsisDeg);
  const trueAnomaly = degreesToRadians(elements.trueAnomalyDeg);
  const p = a * (1 - e * e);
  const radius = p / (1 + e * Math.cos(trueAnomaly));

  const xPerifocal = radius * Math.cos(trueAnomaly);
  const yPerifocal = radius * Math.sin(trueAnomaly);
  const velocityScale = Math.sqrt(mu / p);
  const vxPerifocal = -velocityScale * Math.sin(trueAnomaly);
  const vyPerifocal = velocityScale * (e + Math.cos(trueAnomaly));

  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);
  const cosArg = Math.cos(argPeriapsis);
  const sinArg = Math.sin(argPeriapsis);
  const cosInc = Math.cos(i);
  const sinInc = Math.sin(i);

  const m11 = cosRaan * cosArg - sinRaan * sinArg * cosInc;
  const m12 = -cosRaan * sinArg - sinRaan * cosArg * cosInc;
  const m21 = sinRaan * cosArg + cosRaan * sinArg * cosInc;
  const m22 = -sinRaan * sinArg + cosRaan * cosArg * cosInc;
  const m31 = sinArg * sinInc;
  const m32 = cosArg * sinInc;

  return {
    positionKm: [
      m11 * xPerifocal + m12 * yPerifocal,
      m21 * xPerifocal + m22 * yPerifocal,
      m31 * xPerifocal + m32 * yPerifocal,
    ],
    velocityKmS: [
      m11 * vxPerifocal + m12 * vyPerifocal,
      m21 * vxPerifocal + m22 * vyPerifocal,
      m31 * vxPerifocal + m32 * vyPerifocal,
    ],
    epoch: elements.epoch,
  };
}

export function cartesianToKeplerian(
  state: CartesianState,
  mu = EARTH_MU_KM3_S2,
): KeplerianElements {
  if (!isValidCartesian(state)) {
    throw new Error("Invalid Cartesian state vector");
  }

  const r = state.positionKm;
  const v = state.velocityKmS;
  const radius = magnitude(r);
  const speed = magnitude(v);
  const h = cross(r, v);
  const hMag = magnitude(h);
  const n = cross([0, 0, 1], h);
  const nMag = magnitude(n);
  const eVector = subtract(scale(cross(v, h), 1 / mu), scale(r, 1 / radius));
  const eccentricity = magnitude(eVector);
  const specificEnergy = (speed * speed) / 2 - mu / radius;
  const semiMajorAxisKm = -mu / (2 * specificEnergy);
  const inclinationDeg = radiansToDegrees(Math.acos(clamp(h[2] / hMag, -1, 1)));

  let raanDeg = 0;
  if (nMag > EPSILON) {
    raanDeg = radiansToDegrees(Math.atan2(n[1], n[0]));
  }

  let argumentOfPeriapsisDeg = 0;
  if (nMag > EPSILON && eccentricity > EPSILON) {
    const y = dot(cross(n, eVector), h) / (nMag * eccentricity * hMag);
    const x = dot(n, eVector) / (nMag * eccentricity);
    argumentOfPeriapsisDeg = radiansToDegrees(Math.atan2(y, x));
  } else if (eccentricity > EPSILON) {
    argumentOfPeriapsisDeg = radiansToDegrees(Math.atan2(eVector[1], eVector[0]));
  }

  let trueAnomalyDeg = 0;
  if (eccentricity > EPSILON) {
    const y = dot(cross(eVector, r), h) / (eccentricity * radius * hMag);
    const x = dot(eVector, r) / (eccentricity * radius);
    trueAnomalyDeg = radiansToDegrees(Math.atan2(y, x));
  } else if (nMag > EPSILON) {
    const y = dot(cross(n, r), h) / (nMag * radius * hMag);
    const x = dot(n, r) / (nMag * radius);
    trueAnomalyDeg = radiansToDegrees(Math.atan2(y, x));
  } else {
    trueAnomalyDeg = radiansToDegrees(Math.atan2(r[1], r[0]));
  }

  return {
    semiMajorAxisKm,
    eccentricity,
    inclinationDeg,
    raanDeg: normalizeAngleDegrees(raanDeg),
    argumentOfPeriapsisDeg: normalizeAngleDegrees(argumentOfPeriapsisDeg),
    trueAnomalyDeg: normalizeAngleDegrees(trueAnomalyDeg),
    epoch: state.epoch,
  };
}

export function propagateKeplerian(
  elements: KeplerianElements,
  targetDate: Date,
  mu = EARTH_MU_KM3_S2,
): KeplerianElements {
  if (!isValidKeplerian(elements)) {
    throw new Error("Invalid Keplerian elements");
  }

  const epochMs = Date.parse(elements.epoch);
  const elapsedSeconds = (targetDate.getTime() - epochMs) / 1000;
  const meanMotionRadS = Math.sqrt(mu / Math.pow(elements.semiMajorAxisKm, 3));
  const trueAnomaly0 = degreesToRadians(elements.trueAnomalyDeg);
  const eccentricAnomaly0 = trueToEccentricAnomaly(trueAnomaly0, elements.eccentricity);
  const meanAnomaly0 =
    eccentricAnomaly0 - elements.eccentricity * Math.sin(eccentricAnomaly0);
  const meanAnomaly = meanAnomaly0 + meanMotionRadS * elapsedSeconds;
  const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, elements.eccentricity);
  const trueAnomaly = normalizeAngleRadians(
    eccentricToTrueAnomaly(eccentricAnomaly, elements.eccentricity),
  );

  return {
    ...elements,
    trueAnomalyDeg: normalizeAngleDegrees(radiansToDegrees(trueAnomaly)),
    epoch: targetDate.toISOString(),
  };
}

export function propagateTwoBody(
  elements: KeplerianElements,
  targetDate: Date,
  mu = EARTH_MU_KM3_S2,
): CartesianState {
  return keplerianToCartesian(propagateKeplerian(elements, targetDate, mu), mu);
}

export function orbitalPeriodSeconds(
  semiMajorAxisKm: number,
  mu = EARTH_MU_KM3_S2,
): number {
  return TWO_PI * Math.sqrt(Math.pow(semiMajorAxisKm, 3) / mu);
}

export function altitudeKm(state: CartesianState): number {
  return magnitude(state.positionKm) - EARTH_RADIUS_KM;
}

export function speedKmS(state: CartesianState): number {
  return magnitude(state.velocityKmS);
}
