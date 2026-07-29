export const MU_EARTH_KM3_S2 = 398600.4418;
export const EARTH_MU_KM3_S2 = MU_EARTH_KM3_S2;
export const EARTH_RADIUS_KM = 6378.137;
export const EARTH_FLATTENING = 1 / 298.257223563;
export const EARTH_ROTATION_RATE_RAD_S = 7.2921159e-5;
export const SECONDS_PER_DAY = 86400;
export const TWO_PI = Math.PI * 2;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function degreesToRadians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

export function radiansToDegrees(radians: number): number {
  return radians * RAD_TO_DEG;
}

export function normalizeAngleRadians(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

export function normalizeAngleDegrees(angle: number): number {
  const wrapped = angle % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
