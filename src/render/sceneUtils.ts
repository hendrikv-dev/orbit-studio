import { EARTH_RADIUS } from '../physics/constants/earth';
import type { GeodeticPosition, Vector3Tuple } from '../physics/orbits/types';

export const EARTH_SCENE_RADIUS = 1;

export function eciToScene(position: Vector3Tuple): [number, number, number] {
  return [
    position[0] / EARTH_RADIUS,
    position[2] / EARTH_RADIUS,
    -position[1] / EARTH_RADIUS
  ];
}

export function geodeticToScene(
  geodetic: Pick<GeodeticPosition, 'latitude' | 'longitude'>,
  altitudeScale = 1.004
): [number, number, number] {
  const cosLat = Math.cos(geodetic.latitude);
  return [
    altitudeScale * cosLat * Math.cos(geodetic.longitude),
    altitudeScale * Math.sin(geodetic.latitude),
    -altitudeScale * cosLat * Math.sin(geodetic.longitude)
  ];
}
