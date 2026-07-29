import type { CartesianState, GroundTrackPoint, KeplerianElements, Satellite } from "../types/orbit";
import { DEG_TO_RAD, EARTH_RADIUS_KM, MU_EARTH_KM3_S2, RAD_TO_DEG } from "./constants";
import { clamp, gmstRadians, normalizeDegrees, normalizeRadians, secondsBetween } from "./time";
import { cross, dot, magnitude, scale, sub } from "./vector";
import { propagateTleToCartesian } from "./tle";

const EPSILON = 1e-9;

export function keplerianToCartesian(elements: KeplerianElements): CartesianState {
  const a = elements.semiMajorAxis;
  const e = elements.eccentricity;
  const i = elements.inclination * DEG_TO_RAD;
  const raan = elements.raan * DEG_TO_RAD;
  const argPeriapsis = elements.argumentOfPeriapsis * DEG_TO_RAD;
  const trueAnomaly = elements.trueAnomaly * DEG_TO_RAD;
  const p = a * (1 - e * e);
  const radius = p / (1 + e * Math.cos(trueAnomaly));
  const rootMuOverP = Math.sqrt(MU_EARTH_KM3_S2 / p);

  const rPqw: [number, number, number] = [
    radius * Math.cos(trueAnomaly),
    radius * Math.sin(trueAnomaly),
    0
  ];
  const vPqw: [number, number, number] = [
    -rootMuOverP * Math.sin(trueAnomaly),
    rootMuOverP * (e + Math.cos(trueAnomaly)),
    0
  ];

  return {
    position: rotatePerifocalToEci(rPqw, raan, i, argPeriapsis),
    velocity: rotatePerifocalToEci(vPqw, raan, i, argPeriapsis),
    epoch: elements.epoch
  };
}

export function cartesianToKeplerian(state: CartesianState): KeplerianElements {
  const r = state.position;
  const v = state.velocity;
  const rMag = magnitude(r);
  const vMag = magnitude(v);
  const h = cross(r, v);
  const hMag = magnitude(h);
  const n = cross([0, 0, 1], h);
  const nMag = magnitude(n);
  const eVector = sub(scale(cross(v, h), 1 / MU_EARTH_KM3_S2), scale(r, 1 / rMag));
  const e = magnitude(eVector);
  const energy = (vMag * vMag) / 2 - MU_EARTH_KM3_S2 / rMag;
  const a = Math.abs(energy) < EPSILON ? Infinity : -MU_EARTH_KM3_S2 / (2 * energy);
  const inclination = Math.acos(clamp(h[2] / hMag, -1, 1));
  const raan = nMag > EPSILON ? Math.atan2(n[1], n[0]) : 0;

  let argumentOfPeriapsis = 0;
  if (nMag > EPSILON && e > EPSILON) {
    argumentOfPeriapsis = Math.acos(clamp(dot(n, eVector) / (nMag * e), -1, 1));
    if (eVector[2] < 0) {
      argumentOfPeriapsis = Math.PI * 2 - argumentOfPeriapsis;
    }
  }

  let trueAnomaly = 0;
  if (e > EPSILON) {
    trueAnomaly = Math.acos(clamp(dot(eVector, r) / (e * rMag), -1, 1));
    if (dot(r, v) < 0) {
      trueAnomaly = Math.PI * 2 - trueAnomaly;
    }
  } else if (nMag > EPSILON) {
    trueAnomaly = Math.acos(clamp(dot(n, r) / (nMag * rMag), -1, 1));
    if (r[2] < 0) {
      trueAnomaly = Math.PI * 2 - trueAnomaly;
    }
  }

  return {
    semiMajorAxis: a,
    eccentricity: e,
    inclination: normalizeDegrees(inclination * RAD_TO_DEG),
    raan: normalizeDegrees(raan * RAD_TO_DEG),
    argumentOfPeriapsis: normalizeDegrees(argumentOfPeriapsis * RAD_TO_DEG),
    trueAnomaly: normalizeDegrees(trueAnomaly * RAD_TO_DEG),
    epoch: state.epoch
  };
}

export function propagateKeplerian(elements: KeplerianElements, date: string | Date): KeplerianElements {
  const elapsedSeconds = secondsBetween(date, elements.epoch);
  const e = elements.eccentricity;
  const meanMotion = Math.sqrt(MU_EARTH_KM3_S2 / Math.pow(elements.semiMajorAxis, 3));
  const initialEccentricAnomaly = trueToEccentricAnomaly(elements.trueAnomaly * DEG_TO_RAD, e);
  const initialMeanAnomaly = initialEccentricAnomaly - e * Math.sin(initialEccentricAnomaly);
  const meanAnomaly = normalizeRadians(initialMeanAnomaly + meanMotion * elapsedSeconds);
  const eccentricAnomaly = solveKepler(meanAnomaly, e);
  const trueAnomaly = eccentricToTrueAnomaly(eccentricAnomaly, e);

  return {
    ...elements,
    trueAnomaly: normalizeDegrees(trueAnomaly * RAD_TO_DEG)
  };
}

export function stateAtTime(satellite: Satellite, date: string | Date): CartesianState {
  if (satellite.propagationMode === "sgp4" && satellite.tle) {
    const tleState = propagateTleToCartesian(satellite.tle, date);
    if (tleState) {
      return tleState;
    }
  }

  return keplerianToCartesian(propagateKeplerian(satellite.keplerian, date));
}

export function orbitalPeriodSeconds(elements: KeplerianElements): number | null {
  if (!Number.isFinite(elements.semiMajorAxis) || elements.semiMajorAxis <= 0 || elements.eccentricity >= 1) {
    return null;
  }

  return 2 * Math.PI * Math.sqrt(Math.pow(elements.semiMajorAxis, 3) / MU_EARTH_KM3_S2);
}

export function altitudeKm(state: CartesianState): number {
  return magnitude(state.position) - EARTH_RADIUS_KM;
}

export function eciToEcef(position: [number, number, number], date: string | Date): [number, number, number] {
  const theta = gmstRadians(date);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  return [
    cosTheta * position[0] + sinTheta * position[1],
    -sinTheta * position[0] + cosTheta * position[1],
    position[2]
  ];
}

export function ecefToGeodetic(position: [number, number, number]): {
  latitude: number;
  longitude: number;
  altitude: number;
} {
  const [x, y, z] = position;
  const longitude = Math.atan2(y, x);
  const horizontal = Math.sqrt(x * x + y * y);
  const latitude = Math.atan2(z, horizontal);
  const altitude = Math.sqrt(x * x + y * y + z * z) - EARTH_RADIUS_KM;

  return {
    latitude: latitude * RAD_TO_DEG,
    longitude: normalizeLongitude(longitude * RAD_TO_DEG),
    altitude
  };
}

export function sampleOrbitPath(satellite: Satellite, startDate: string | Date, samples = 180): [number, number, number][] {
  const period = orbitalPeriodSeconds(satellite.keplerian) ?? 5400;
  const stepSeconds = period / samples;

  return Array.from({ length: samples + 1 }, (_, index) => {
    const date = new Date(new Date(startDate).getTime() + index * stepSeconds * 1000);
    return stateAtTime(satellite, date).position;
  });
}

export function sampleGroundTrack(satellite: Satellite, startDate: string | Date, samples = 220): GroundTrackPoint[] {
  const period = orbitalPeriodSeconds(satellite.keplerian) ?? 5400;
  const stepSeconds = (period * 1.25) / samples;

  return Array.from({ length: samples + 1 }, (_, index) => {
    const date = new Date(new Date(startDate).getTime() + index * stepSeconds * 1000);
    const state = stateAtTime(satellite, date);
    const geodetic = ecefToGeodetic(eciToEcef(state.position, date));
    return {
      ...geodetic,
      time: date.toISOString()
    };
  });
}

export function satelliteReadouts(satellite: Satellite, date: string | Date) {
  const state = stateAtTime(satellite, date);
  const geodetic = ecefToGeodetic(eciToEcef(state.position, date));
  return {
    altitude: geodetic.altitude,
    velocity: magnitude(state.velocity),
    period: orbitalPeriodSeconds(satellite.keplerian),
    inclination: satellite.keplerian.inclination,
    eccentricity: satellite.keplerian.eccentricity,
    latitude: geodetic.latitude,
    longitude: geodetic.longitude,
    propagationMode: satellite.propagationMode
  };
}

export function validateKeplerian(elements: KeplerianElements): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(elements.semiMajorAxis) || elements.semiMajorAxis <= EARTH_RADIUS_KM) {
    errors.push("Semi-major axis must be greater than Earth radius.");
  }
  if (!Number.isFinite(elements.eccentricity) || elements.eccentricity < 0 || elements.eccentricity >= 1) {
    errors.push("Eccentricity must be from 0 to less than 1 for the two-body MVP.");
  }
  if (!Number.isFinite(elements.inclination) || elements.inclination < 0 || elements.inclination > 180) {
    errors.push("Inclination must be between 0 and 180 degrees.");
  }
  if (!Number.isFinite(new Date(elements.epoch).getTime())) {
    errors.push("Epoch must be a valid date.");
  }
  return errors;
}

export function validateCartesian(state: CartesianState): string[] {
  const errors: string[] = [];
  if (!state.position.every(Number.isFinite)) {
    errors.push("Position values must be finite ECI coordinates.");
  }
  if (!state.velocity.every(Number.isFinite)) {
    errors.push("Velocity values must be finite ECI components.");
  }
  if (magnitude(state.position) <= EARTH_RADIUS_KM) {
    errors.push("Position must be above Earth radius.");
  }
  if (magnitude(state.velocity) <= 0) {
    errors.push("Velocity magnitude must be greater than zero.");
  }
  if (!Number.isFinite(new Date(state.epoch).getTime())) {
    errors.push("Epoch must be a valid date.");
  }
  return errors;
}

function rotatePerifocalToEci(
  vector: [number, number, number],
  raan: number,
  inclination: number,
  argPeriapsis: number
): [number, number, number] {
  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  const cosArg = Math.cos(argPeriapsis);
  const sinArg = Math.sin(argPeriapsis);
  const [x, y] = vector;

  return [
    (cosRaan * cosArg - sinRaan * sinArg * cosInclination) * x +
      (-cosRaan * sinArg - sinRaan * cosArg * cosInclination) * y,
    (sinRaan * cosArg + cosRaan * sinArg * cosInclination) * x +
      (-sinRaan * sinArg + cosRaan * cosArg * cosInclination) * y,
    sinArg * sinInclination * x + cosArg * sinInclination * y
  ];
}

function trueToEccentricAnomaly(trueAnomaly: number, eccentricity: number): number {
  return normalizeRadians(
    Math.atan2(
      Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(trueAnomaly),
      eccentricity + Math.cos(trueAnomaly)
    )
  );
}

function eccentricToTrueAnomaly(eccentricAnomaly: number, eccentricity: number): number {
  return normalizeRadians(
    Math.atan2(
      Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomaly),
      Math.cos(eccentricAnomaly) - eccentricity
    )
  );
}

function solveKepler(meanAnomaly: number, eccentricity: number): number {
  let eccentricAnomaly = eccentricity < 0.8 ? meanAnomaly : Math.PI;
  for (let index = 0; index < 16; index += 1) {
    const delta =
      (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;
    if (Math.abs(delta) < 1e-10) {
      break;
    }
  }
  return eccentricAnomaly;
}

function normalizeLongitude(longitude: number): number {
  const wrapped = ((longitude + 180) % 360) - 180;
  return wrapped < -180 ? wrapped + 360 : wrapped;
}
