import {
  EARTH_FLATTENING,
  EARTH_POLAR_RADIUS,
  EARTH_RADIUS
} from '../constants/earth';
import type { GeodeticPosition, Vector3Tuple } from '../orbits/types';
import { eciToEcef } from './frames';

const WGS84_E2 = EARTH_FLATTENING * (2 - EARTH_FLATTENING);
const WGS84_EP2 =
  (EARTH_RADIUS * EARTH_RADIUS - EARTH_POLAR_RADIUS * EARTH_POLAR_RADIUS) /
  (EARTH_POLAR_RADIUS * EARTH_POLAR_RADIUS);

export function ecefToGeodetic(ecef: Vector3Tuple): GeodeticPosition {
  const [x, y, z] = ecef;
  const p = Math.hypot(x, y);
  const theta = Math.atan2(z * EARTH_RADIUS, p * EARTH_POLAR_RADIUS);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const latitude = Math.atan2(
    z + WGS84_EP2 * EARTH_POLAR_RADIUS * Math.pow(sinTheta, 3),
    p - WGS84_E2 * EARTH_RADIUS * Math.pow(cosTheta, 3)
  );
  const longitude = Math.atan2(y, x);
  const sinLatitude = Math.sin(latitude);
  const n = EARTH_RADIUS / Math.sqrt(1 - WGS84_E2 * sinLatitude * sinLatitude);
  const altitude = p / Math.cos(latitude) - n;

  return { latitude, longitude, altitude };
}

export function eciToGeodetic(eci: Vector3Tuple, date: Date): GeodeticPosition {
  return ecefToGeodetic(eciToEcef(eci, date));
}

export function geodeticToSurfacePoint(
  latitude: number,
  longitude: number,
  radius = EARTH_RADIUS
): Vector3Tuple {
  const cosLat = Math.cos(latitude);
  return [
    radius * cosLat * Math.cos(longitude),
    radius * cosLat * Math.sin(longitude),
    radius * Math.sin(latitude)
  ];
}
