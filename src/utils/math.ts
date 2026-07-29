export const TWO_PI = Math.PI * 2;

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function normalizeAngle(radians: number): number {
  const value = radians % TWO_PI;
  return value < 0 ? value + TWO_PI : value;
}

export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '---';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}
