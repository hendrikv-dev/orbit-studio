import { EARTH_MU, EARTH_MU_KM3_S2 } from '../constants/earth';
import { clampUnit, degToRad, normalizeDegrees, normalizeRadians, radToDeg } from './angles';
import { cross, dot, magnitude, scale, subtract, vector } from './vector';
import type { CartesianState, KeplerianElements, Vector3 } from './types';

const EPSILON = 1e-9;
const METERS_PER_KM = 1000;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

type MeterKeplerianElements = {
  semiMajorAxis: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argumentOfPeriapsis: number;
  trueAnomaly: number;
  epoch: string;
};

type VectorLike = Vector3 | [number, number, number];

const isMeterKeplerian = (elements: KeplerianElements | MeterKeplerianElements): elements is MeterKeplerianElements =>
  'semiMajorAxis' in elements;

const component = (value: VectorLike, index: 0 | 1 | 2): number => {
  if (Array.isArray(value)) return value[index];
  return index === 0 ? value.x : index === 1 ? value.y : value.z;
};

const vectorToArray = (value: Vector3): [number, number, number] => [value.x, value.y, value.z];

export const calculateOrbitalPeriod = (
  semiMajorAxisMeters: number,
  muM3S2 = EARTH_MU,
): number => {
  if (semiMajorAxisMeters <= 0) {
    return Number.NaN;
  }

  return 2 * Math.PI * Math.sqrt(semiMajorAxisMeters ** 3 / muM3S2);
};

export const orbitalPeriodSeconds = (
  semiMajorAxisKm: number,
  muKm3S2 = EARTH_MU_KM3_S2,
): number => {
  if (semiMajorAxisKm <= 0) {
    return Number.NaN;
  }

  return 2 * Math.PI * Math.sqrt(semiMajorAxisKm ** 3 / muKm3S2);
};

export const trueAnomalyToEccentricAnomaly = (
  trueAnomalyRad: number,
  eccentricity: number,
): number => {
  const sinE =
    (Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(trueAnomalyRad)) /
    (1 + eccentricity * Math.cos(trueAnomalyRad));
  const cosE =
    (eccentricity + Math.cos(trueAnomalyRad)) /
    (1 + eccentricity * Math.cos(trueAnomalyRad));
  return normalizeRadians(Math.atan2(sinE, cosE));
};

export const eccentricAnomalyToTrueAnomaly = (
  eccentricAnomalyRad: number,
  eccentricity: number,
): number => {
  const sinNu =
    (Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomalyRad)) /
    (1 - eccentricity * Math.cos(eccentricAnomalyRad));
  const cosNu =
    (Math.cos(eccentricAnomalyRad) - eccentricity) /
    (1 - eccentricity * Math.cos(eccentricAnomalyRad));
  return normalizeRadians(Math.atan2(sinNu, cosNu));
};

export const solveKeplerEquation = (
  meanAnomalyRad: number,
  eccentricity: number,
  tolerance = 1e-10,
  maxIterations = 30,
): number => {
  const normalizedMeanAnomaly = normalizeRadians(meanAnomalyRad);
  let eccentricAnomaly = eccentricity < 0.8 ? normalizedMeanAnomaly : Math.PI;

  for (let index = 0; index < maxIterations; index += 1) {
    const delta =
      (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - normalizedMeanAnomaly) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;

    if (Math.abs(delta) < tolerance) {
      break;
    }
  }

  return normalizeRadians(eccentricAnomaly);
};

export const keplerianToCartesian = (
  elements: KeplerianElements | MeterKeplerianElements,
  muKm3S2 = EARTH_MU_KM3_S2,
): CartesianState => {
  const sourceIsMeters = isMeterKeplerian(elements);
  const normalizedElements: KeplerianElements = sourceIsMeters
    ? {
        semiMajorAxisKm: elements.semiMajorAxis / METERS_PER_KM,
        eccentricity: elements.eccentricity,
        inclinationDeg: elements.inclination * RAD_TO_DEG,
        raanDeg: elements.raan * RAD_TO_DEG,
        argPeriapsisDeg: elements.argumentOfPeriapsis * RAD_TO_DEG,
        trueAnomalyDeg: elements.trueAnomaly * RAD_TO_DEG,
        epoch: elements.epoch,
      }
    : elements;
  const {
    semiMajorAxisKm,
    eccentricity,
    inclinationDeg,
    raanDeg,
    argPeriapsisDeg,
    trueAnomalyDeg,
    epoch,
  } = normalizedElements;

  if (semiMajorAxisKm <= 0 || eccentricity < 0 || eccentricity >= 1) {
    return {
      positionKm: vector(Number.NaN, Number.NaN, Number.NaN),
      velocityKmS: vector(Number.NaN, Number.NaN, Number.NaN),
      position: [Number.NaN, Number.NaN, Number.NaN],
      velocity: [Number.NaN, Number.NaN, Number.NaN],
      epoch,
    } as unknown as CartesianState;
  }

  const inclination = degToRad(inclinationDeg);
  const raan = degToRad(raanDeg);
  const argPeriapsis = degToRad(argPeriapsisDeg);
  const trueAnomaly = degToRad(trueAnomalyDeg);
  const parameter = semiMajorAxisKm * (1 - eccentricity * eccentricity);
  const radius = parameter / (1 + eccentricity * Math.cos(trueAnomaly));

  const positionPerifocal = vector(radius * Math.cos(trueAnomaly), radius * Math.sin(trueAnomaly), 0);
  const velocityFactor = Math.sqrt(muKm3S2 / parameter);
  const velocityPerifocal = vector(
    -velocityFactor * Math.sin(trueAnomaly),
    velocityFactor * (eccentricity + Math.cos(trueAnomaly)),
    0,
  );

  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  const cosArgPeriapsis = Math.cos(argPeriapsis);
  const sinArgPeriapsis = Math.sin(argPeriapsis);

  const rotate = (source: Vector3): Vector3 =>
    vector(
      (cosRaan * cosArgPeriapsis - sinRaan * sinArgPeriapsis * cosInclination) * source.x +
        (-cosRaan * sinArgPeriapsis - sinRaan * cosArgPeriapsis * cosInclination) * source.y,
      (sinRaan * cosArgPeriapsis + cosRaan * sinArgPeriapsis * cosInclination) * source.x +
        (-sinRaan * sinArgPeriapsis + cosRaan * cosArgPeriapsis * cosInclination) * source.y,
      sinArgPeriapsis * sinInclination * source.x + cosArgPeriapsis * sinInclination * source.y,
    );

  const positionKm = rotate(positionPerifocal);
  const velocityKmS = rotate(velocityPerifocal);

  return {
    positionKm,
    velocityKmS,
    position: sourceIsMeters
      ? vectorToArray(scale(positionKm, METERS_PER_KM))
      : vectorToArray(positionKm),
    velocity: sourceIsMeters
      ? vectorToArray(scale(velocityKmS, METERS_PER_KM))
      : vectorToArray(velocityKmS),
    epoch,
  } as unknown as CartesianState;
};

export const cartesianToKeplerian = (
  state: CartesianState & { position?: VectorLike; velocity?: VectorLike },
  muKm3S2 = EARTH_MU_KM3_S2,
): KeplerianElements => {
  const sourceIsMeters = Boolean(state.position && magnitude(state.position) > 100_000);
  const positionKm = sourceIsMeters
    ? vector(
        component(state.position as VectorLike, 0) / METERS_PER_KM,
        component(state.position as VectorLike, 1) / METERS_PER_KM,
        component(state.position as VectorLike, 2) / METERS_PER_KM,
      )
    : state.positionKm;
  const velocityKmS = sourceIsMeters
    ? vector(
        component(state.velocity as VectorLike, 0) / METERS_PER_KM,
        component(state.velocity as VectorLike, 1) / METERS_PER_KM,
        component(state.velocity as VectorLike, 2) / METERS_PER_KM,
      )
    : state.velocityKmS;
  const { epoch } = state;
  const radiusMagnitude = magnitude(positionKm);
  const velocityMagnitude = magnitude(velocityKmS);
  const angularMomentum = cross(positionKm, velocityKmS);
  const angularMomentumMagnitude = magnitude(angularMomentum);
  const nodeVector = cross(vector(0, 0, 1), angularMomentum);
  const nodeMagnitude = magnitude(nodeVector);
  const eccentricityVector = subtract(
    scale(cross(velocityKmS, angularMomentum), 1 / muKm3S2),
    scale(positionKm, 1 / radiusMagnitude),
  );
  const eccentricity = magnitude(eccentricityVector);
  const specificEnergy = velocityMagnitude ** 2 / 2 - muKm3S2 / radiusMagnitude;
  const semiMajorAxisKm = -muKm3S2 / (2 * specificEnergy);
  const inclination = Math.acos(clampUnit(angularMomentum.z / angularMomentumMagnitude));

  let raan = 0;
  if (nodeMagnitude > EPSILON) {
    raan = Math.acos(clampUnit(nodeVector.x / nodeMagnitude));
    if (nodeVector.y < 0) {
      raan = Math.PI * 2 - raan;
    }
  }

  let argPeriapsis = 0;
  if (nodeMagnitude > EPSILON && eccentricity > EPSILON) {
    argPeriapsis = Math.acos(clampUnit(dot(nodeVector, eccentricityVector) / (nodeMagnitude * eccentricity)));
    if (eccentricityVector.z < 0) {
      argPeriapsis = Math.PI * 2 - argPeriapsis;
    }
  }

  let trueAnomaly = 0;
  if (eccentricity > EPSILON) {
    trueAnomaly = Math.acos(clampUnit(dot(eccentricityVector, positionKm) / (eccentricity * radiusMagnitude)));
    if (dot(positionKm, velocityKmS) < 0) {
      trueAnomaly = Math.PI * 2 - trueAnomaly;
    }
  } else if (nodeMagnitude > EPSILON) {
    trueAnomaly = Math.acos(clampUnit(dot(nodeVector, positionKm) / (nodeMagnitude * radiusMagnitude)));
    if (positionKm.z < 0) {
      trueAnomaly = Math.PI * 2 - trueAnomaly;
    }
  } else {
    trueAnomaly = Math.atan2(positionKm.y, positionKm.x);
  }

  const result = {
    semiMajorAxisKm,
    eccentricity,
    inclinationDeg: normalizeDegrees(radToDeg(inclination)),
    raanDeg: normalizeDegrees(radToDeg(raan)),
    argPeriapsisDeg: normalizeDegrees(radToDeg(argPeriapsis)),
    argumentOfPeriapsisDeg: normalizeDegrees(radToDeg(argPeriapsis)),
    trueAnomalyDeg: normalizeDegrees(radToDeg(trueAnomaly)),
    epoch,
  };

  return (sourceIsMeters
    ? {
        ...result,
        semiMajorAxis: semiMajorAxisKm * METERS_PER_KM,
        inclination,
        raan,
        argumentOfPeriapsis: argPeriapsis,
        trueAnomaly,
      }
    : result) as unknown as KeplerianElements;
};
