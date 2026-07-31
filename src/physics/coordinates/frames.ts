import {
  EARTH_FLATTENING,
  EARTH_POLAR_RADIUS_KM,
  EARTH_RADIUS_KM,
} from '../constants/earth';
import type { GeodeticPosition, Vector3 } from '../orbits/types';
import { vector } from '../orbits/vector';
import { gmstRadians } from './time';

type Vector3Tuple = [number, number, number];
type VectorLike = Vector3 | Vector3Tuple;

const component = (value: VectorLike, index: 0 | 1 | 2): number => {
  if (Array.isArray(value)) return value[index];
  return index === 0 ? value.x : index === 1 ? value.y : value.z;
};

const fromVector = <T extends VectorLike>(source: T, value: Vector3): T extends Vector3Tuple ? Vector3Tuple : Vector3 =>
  (Array.isArray(source) ? [value.x, value.y, value.z] : value) as T extends Vector3Tuple ? Vector3Tuple : Vector3;

export const eciToEcef = <T extends VectorLike>(positionEciKm: T, date: Date): T extends Vector3Tuple ? Vector3Tuple : Vector3 => {
  const theta = gmstRadians(date);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  return fromVector(
    positionEciKm,
    vector(
      cosTheta * component(positionEciKm, 0) + sinTheta * component(positionEciKm, 1),
      -sinTheta * component(positionEciKm, 0) + cosTheta * component(positionEciKm, 1),
      component(positionEciKm, 2),
    ),
  );
};

export const ecefToGeodetic = (positionEcefKm: Vector3): GeodeticPosition => {
  const { x, y, z } = positionEcefKm;
  const semiMajor = EARTH_RADIUS_KM;
  const semiMinor = EARTH_POLAR_RADIUS_KM;
  const firstEccentricitySquared = 2 * EARTH_FLATTENING - EARTH_FLATTENING ** 2;
  const secondEccentricitySquared = (semiMajor ** 2 - semiMinor ** 2) / semiMinor ** 2;
  const p = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(z * semiMajor, p * semiMinor);
  const longitude = Math.atan2(y, x);
  const latitude = Math.atan2(
    z + secondEccentricitySquared * semiMinor * Math.sin(theta) ** 3,
    p - firstEccentricitySquared * semiMajor * Math.cos(theta) ** 3,
  );
  const primeVerticalRadius =
    semiMajor / Math.sqrt(1 - firstEccentricitySquared * Math.sin(latitude) ** 2);
  const altitudeKm = p / Math.cos(latitude) - primeVerticalRadius;

  return {
    latitudeDeg: (latitude * 180) / Math.PI,
    longitudeDeg: ((longitude * 180) / Math.PI + 540) % 360 - 180,
    altitudeKm,
  };
};

export const eciToGeodetic = (positionEciKm: Vector3, date: Date): GeodeticPosition =>
  ecefToGeodetic(eciToEcef(positionEciKm, date));
