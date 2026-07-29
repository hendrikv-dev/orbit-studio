import {
  EARTH_FLATTENING,
  EARTH_RADIUS_KM,
  normalizeAngleDegrees,
  radiansToDegrees,
  degreesToRadians,
} from "./constants";
import { propagateTwoBody } from "./kepler";
import type {
  CartesianState,
  GeodeticPosition,
  GroundTrackPoint,
  KeplerianElements,
  Vector3Tuple,
} from "./types";

export function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export function greenwichMeanSiderealTimeRad(date: Date): number {
  const jd = julianDate(date);
  const t = (jd - 2451545.0) / 36525;
  const degrees =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000;

  return degreesToRadians(normalizeAngleDegrees(degrees));
}

export function eciToEcef(state: CartesianState | Vector3Tuple, date: Date): Vector3Tuple {
  const vector = Array.isArray(state) ? state : state.positionKm;
  const theta = greenwichMeanSiderealTimeRad(date);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  return [
    cosTheta * vector[0] + sinTheta * vector[1],
    -sinTheta * vector[0] + cosTheta * vector[1],
    vector[2],
  ];
}

export function ecefToEci(ecefKm: Vector3Tuple, date: Date): Vector3Tuple {
  const theta = greenwichMeanSiderealTimeRad(date);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  return [
    cosTheta * ecefKm[0] - sinTheta * ecefKm[1],
    sinTheta * ecefKm[0] + cosTheta * ecefKm[1],
    ecefKm[2],
  ];
}

export function ecefToGeodetic(ecefKm: Vector3Tuple): GeodeticPosition {
  const [x, y, z] = ecefKm;
  const a = EARTH_RADIUS_KM;
  const f = EARTH_FLATTENING;
  const e2 = f * (2 - f);
  const longitudeRad = Math.atan2(y, x);
  const p = Math.sqrt(x * x + y * y);
  let latitudeRad = Math.atan2(z, p * (1 - e2));
  let altitudeKm = 0;

  for (let i = 0; i < 6; i += 1) {
    const sinLat = Math.sin(latitudeRad);
    const primeVerticalRadius = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    altitudeKm = p / Math.cos(latitudeRad) - primeVerticalRadius;
    latitudeRad = Math.atan2(
      z,
      p * (1 - (e2 * primeVerticalRadius) / (primeVerticalRadius + altitudeKm)),
    );
  }

  return {
    latitudeDeg: radiansToDegrees(latitudeRad),
    longitudeDeg: normalizeAngleDegrees(radiansToDegrees(longitudeRad) + 180) - 180,
    altitudeKm,
  };
}

export function geodeticToEcef(position: GeodeticPosition): Vector3Tuple {
  const latitudeRad = degreesToRadians(position.latitudeDeg);
  const longitudeRad = degreesToRadians(position.longitudeDeg);
  const a = EARTH_RADIUS_KM;
  const f = EARTH_FLATTENING;
  const e2 = f * (2 - f);
  const sinLat = Math.sin(latitudeRad);
  const cosLat = Math.cos(latitudeRad);
  const primeVerticalRadius = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const radiusWithAltitude = primeVerticalRadius + position.altitudeKm;

  return [
    radiusWithAltitude * cosLat * Math.cos(longitudeRad),
    radiusWithAltitude * cosLat * Math.sin(longitudeRad),
    (primeVerticalRadius * (1 - e2) + position.altitudeKm) * sinLat,
  ];
}

export function sampleGroundTrack(
  elements: KeplerianElements,
  startDate: Date,
  durationSeconds: number,
  sampleCount: number,
): GroundTrackPoint[] {
  const points: GroundTrackPoint[] = [];
  const count = Math.max(2, sampleCount);

  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1);
    const date = new Date(startDate.getTime() + durationSeconds * ratio * 1000);
    const state = propagateTwoBody(elements, date);
    points.push({
      ...ecefToGeodetic(eciToEcef(state, date)),
      time: date.toISOString(),
    });
  }

  return points;
}
