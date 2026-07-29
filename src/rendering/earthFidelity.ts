import { Quaternion, Vector3 } from "three";
import { computeCelestialState } from "../astronomy/celestialFrames";

export const EARTH_DAYLIGHT_START_SOLAR_DOT = -0.065;
export const EARTH_FULL_DAYLIGHT_SOLAR_DOT = 0.075;
export const EARTH_NIGHT_LIGHTS_END_SOLAR_DOT = -0.035;
export const EARTH_NIGHT_LIGHTS_START_SOLAR_DOT = -0.19;
export const EARTH_AMBIENT_NIGHT_SURFACE_SCALE = 0.105;
export const EARTH_DAY_SURFACE_MIN_SCALE = 1.15;
export const EARTH_DAY_SURFACE_MAX_SCALE = 1.65;
export const EARTH_TWILIGHT_WARMTH_SCALE = 0.26;

export function writeWorldDirectionInLocalFrame(
  target: Vector3,
  worldDirection: Vector3,
  worldRotation: Quaternion,
): Vector3 {
  return target.copy(worldDirection).applyQuaternion(worldRotation.clone().invert()).normalize();
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function isFiniteVector3(vector: Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

export function writeSunDirectionThree(
  target: Vector3,
  date: string | Date | number,
): Vector3 {
  return target.copy(computeCelestialState(date).sunSceneDirection);
}

export function safeSunDirectionThree(date: string | Date | number): Vector3 {
  return writeSunDirectionThree(new Vector3(), date);
}

export function writeEarthSurfaceSunDirectionThree(
  target: Vector3,
  date: string | Date | number,
): Vector3 {
  return target.copy(computeCelestialState(date).sunEarthLocalDirection);
}

export function renderedSubsolarPoint(
  date: string | Date | number,
): { latitudeDeg: number; longitudeDeg: number } {
  const state = computeCelestialState(date);

  return {
    latitudeDeg: state.subsolarLatitudeDeg,
    longitudeDeg: state.subsolarLongitudeDeg,
  };
}

export function earthLightingWeightsForSolarDot(solarDot: number): {
  daylight: number;
  night: number;
  twilight: number;
} {
  const clampedDot = Number.isFinite(solarDot) ? Math.min(1, Math.max(-1, solarDot)) : 0;
  const daylight = smoothstep(
    EARTH_DAYLIGHT_START_SOLAR_DOT,
    EARTH_FULL_DAYLIGHT_SOLAR_DOT,
    clampedDot,
  );
  const night = 1 - smoothstep(
    EARTH_NIGHT_LIGHTS_START_SOLAR_DOT,
    EARTH_NIGHT_LIGHTS_END_SOLAR_DOT,
    clampedDot,
  );
  const twilight = Math.max(0, 1 - Math.abs(daylight - night));

  return { daylight, night, twilight };
}

export function earthReadableSurfaceScaleForSolarDot(solarDot: number): number {
  const { daylight, twilight } = earthLightingWeightsForSolarDot(solarDot);
  const directDaylight = Math.max(0, Math.min(1, solarDot));
  const dayIllumination =
    EARTH_DAY_SURFACE_MIN_SCALE +
    (EARTH_DAY_SURFACE_MAX_SCALE - EARTH_DAY_SURFACE_MIN_SCALE) * directDaylight;

  return EARTH_AMBIENT_NIGHT_SURFACE_SCALE +
    daylight * dayIllumination +
    twilight * EARTH_TWILIGHT_WARMTH_SCALE * 0.32;
}

export function oceanSpecularMaskFromRgb(red: number, green: number, blue: number): number {
  if (![red, green, blue].every(Number.isFinite)) return 0;

  const blueDominance = blue - Math.max(red, green) * 0.62;
  const whiteCloudRejection = 1 - smoothstep(0.58, 0.82, Math.min(red, green, blue));
  return smoothstep(0.04, 0.28, blueDominance) *
    smoothstep(0.08, 0.22, blue) *
    whiteCloudRejection;
}
