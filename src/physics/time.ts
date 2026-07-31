import { DEG_TO_RAD, EARTH_ROTATION_RATE_RAD_S, RAD_TO_DEG, SECONDS_PER_DAY } from "./constants";

export function secondsBetween(a: string | Date, b: string | Date): number {
  return (new Date(a).getTime() - new Date(b).getTime()) / 1000;
}

export function addSeconds(date: string | Date, seconds: number): Date {
  return new Date(new Date(date).getTime() + seconds * 1000);
}

export function julianDate(date: string | Date): number {
  const time = new Date(date).getTime();
  return time / 86400000 + 2440587.5;
}

export function gmstRadians(date: string | Date): number {
  const jd = julianDate(date);
  const d = jd - 2451545.0;
  const gmstHours = 18.697374558 + 24.06570982441908 * d;
  return normalizeRadians(gmstHours * 15 * DEG_TO_RAD);
}

export function earthRotationAngle(date: string | Date, epoch: string | Date): number {
  const elapsed = secondsBetween(date, epoch);
  return normalizeRadians(elapsed * EARTH_ROTATION_RATE_RAD_S);
}

export function formatUtc(date: string | Date): string {
  return new Date(date).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function normalizeRadians(angle: number): number {
  const wrapped = angle % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}

export function normalizeDegrees(angle: number): number {
  const wrapped = angle % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function localInputValue(date: string | Date): string {
  const d = new Date(date);
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}

export function dayFraction(date: string | Date): number {
  const d = new Date(date);
  return (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) / SECONDS_PER_DAY;
}

export function sunDirectionEci(date: string | Date): [number, number, number] {
  const jd = julianDate(date);
  const daysSinceJ2000 = jd - 2451545.0;
  const meanLongitude = normalizeDegrees(280.460 + 0.98564736 * daysSinceJ2000);
  const meanAnomaly = normalizeDegrees(357.529 + 0.98560028 * daysSinceJ2000);
  const meanAnomalyRad = meanAnomaly * DEG_TO_RAD;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomalyRad) + 0.02 * Math.sin(2 * meanAnomalyRad)) *
    DEG_TO_RAD;
  const obliquity = (23.439291 - 0.00000036 * daysSinceJ2000) * DEG_TO_RAD;
  const x = Math.cos(eclipticLongitude);
  const y = Math.cos(obliquity) * Math.sin(eclipticLongitude);
  const z = Math.sin(obliquity) * Math.sin(eclipticLongitude);
  const length = Math.sqrt(x * x + y * y + z * z);
  return [x / length, y / length, z / length];
}

export function sunDirectionEcef(date: string | Date): [number, number, number] {
  const [x, y, z] = sunDirectionEci(date);
  const theta = gmstRadians(date);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  return [cosTheta * x + sinTheta * y, -sinTheta * x + cosTheta * y, z];
}

export function subsolarPoint(date: string | Date): { latitudeDeg: number; longitudeDeg: number } {
  const [x, y, z] = sunDirectionEcef(date);

  return {
    latitudeDeg: Math.asin(z) * RAD_TO_DEG,
    longitudeDeg: normalizeDegrees(Math.atan2(y, x) * RAD_TO_DEG + 180) - 180,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
