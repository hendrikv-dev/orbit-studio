import { degreesToRadians, radiansToDegrees } from "../physics/constants";

export type AuroraHemisphere = "north" | "south";
export type VectorTuple = [number, number, number];

export interface AuroraModelInputs {
  kpIndex: number;
  intensity?: number;
  hemisphericPowerGw?: number;
  solarWindSpeedKmS?: number;
}

export interface AuroraOvalParameters {
  kpIndex: number;
  centerMagneticLatitudeDeg: number;
  widthDeg: number;
  altitudeKm: number;
  curtainTopAltitudeKm: number;
  intensity: number;
  curtainSpeed: number;
}

export interface MagneticPoleDefinition {
  hemisphere: AuroraHemisphere;
  latitudeDeg: number;
  longitudeDeg: number;
}

export const REPRESENTATIVE_AURORA_INPUTS: AuroraModelInputs = {
  kpIndex: 3,
  intensity: 1,
};

// Centered-dipole geomagnetic pole approximation. The renderer uses these as
// magnetic-axis anchors so a future AACGM/OVATION data source can swap inputs
// without changing rendering code.
export const MAGNETIC_POLES: Record<AuroraHemisphere, MagneticPoleDefinition> = {
  north: {
    hemisphere: "north",
    latitudeDeg: 80.65,
    longitudeDeg: -72.68,
  },
  south: {
    hemisphere: "south",
    latitudeDeg: -80.65,
    longitudeDeg: 107.32,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(vector: VectorTuple): VectorTuple {
  const length = Math.hypot(vector[0], vector[1], vector[2]);

  if (length === 0) return [0, 1, 0];

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(a: VectorTuple, b: VectorTuple): VectorTuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(vector: VectorTuple, scalar: number): VectorTuple {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function add(a: VectorTuple, b: VectorTuple): VectorTuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function dot(a: VectorTuple, b: VectorTuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function magneticPoleForHemisphere(
  hemisphere: AuroraHemisphere,
): MagneticPoleDefinition {
  return MAGNETIC_POLES[hemisphere];
}

export function earthFixedUnitVectorFromLatLon(
  latitudeDeg: number,
  longitudeDeg: number,
): VectorTuple {
  const latitude = degreesToRadians(latitudeDeg);
  const longitude = degreesToRadians(longitudeDeg);
  const cosLatitude = Math.cos(latitude);
  const textureLongitude = -longitude;

  return normalize([
    cosLatitude * Math.cos(textureLongitude),
    Math.sin(latitude),
    cosLatitude * Math.sin(textureLongitude),
  ]);
}

export function magneticPoleUnitVector(hemisphere: AuroraHemisphere): VectorTuple {
  const pole = magneticPoleForHemisphere(hemisphere);

  return earthFixedUnitVectorFromLatLon(pole.latitudeDeg, pole.longitudeDeg);
}

export function auroraOvalParametersForKp(
  inputs: AuroraModelInputs = REPRESENTATIVE_AURORA_INPUTS,
): AuroraOvalParameters {
  const kpIndex = clamp(inputs.kpIndex, 0, 9);
  const normalizedKp = kpIndex / 9;
  const powerBoost = inputs.hemisphericPowerGw
    ? clamp((inputs.hemisphericPowerGw - 18) / 90, 0, 0.42)
    : 0;
  const windBoost = inputs.solarWindSpeedKmS
    ? clamp((inputs.solarWindSpeedKmS - 360) / 520, 0, 0.24)
    : 0;
  const requestedIntensity = clamp(inputs.intensity ?? 1, 0, 2);

  return {
    kpIndex,
    centerMagneticLatitudeDeg: 68 - kpIndex * 1.18,
    widthDeg: 4.8 + kpIndex * 0.64,
    altitudeKm: 112 + kpIndex * 6.5,
    curtainTopAltitudeKm: 760 + kpIndex * 105,
    intensity:
      requestedIntensity *
      (0.28 + Math.pow(normalizedKp, 1.35) * 0.72 + powerBoost + windBoost),
    curtainSpeed: 0.42 + normalizedKp * 0.95 + windBoost,
  };
}

export function sampleAuroraOvalDirection(
  hemisphere: AuroraHemisphere,
  azimuthRad: number,
  magneticLatitudeDeg: number,
): VectorTuple {
  const pole = magneticPoleUnitVector(hemisphere);
  const reference: VectorTuple = Math.abs(dot(pole, [0, 1, 0])) > 0.92 ? [1, 0, 0] : [0, 1, 0];
  const tangentA = normalize(cross(reference, pole));
  const tangentB = normalize(cross(pole, tangentA));
  const colatitudeRad = degreesToRadians(90 - magneticLatitudeDeg);
  const polarComponent = scale(pole, Math.cos(colatitudeRad));
  const azimuthComponent = add(
    scale(tangentA, Math.cos(azimuthRad) * Math.sin(colatitudeRad)),
    scale(tangentB, Math.sin(azimuthRad) * Math.sin(colatitudeRad)),
  );

  return normalize(add(polarComponent, azimuthComponent));
}

export function magneticLatitudeForDirection(
  hemisphere: AuroraHemisphere,
  direction: VectorTuple,
): number {
  const normalizedDirection = normalize(direction);
  const pole = magneticPoleUnitVector(hemisphere);

  return 90 - radiansToDegrees(Math.acos(clamp(dot(normalizedDirection, pole), -1, 1)));
}
