import { TWO_PI } from '../constants/earth';

export const degToRad = (degrees: number): number => (degrees * Math.PI) / 180;

export const radToDeg = (radians: number): number => (radians * 180) / Math.PI;

export const normalizeRadians = (radians: number): number => {
  const wrapped = radians % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
};

export const normalizeDegrees = (degrees: number): number => {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

export const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));
