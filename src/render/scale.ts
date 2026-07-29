import { Vector3 as ThreeVector3 } from 'three';
import { EARTH_RADIUS_KM } from '../physics/constants/earth';
import type { Vector3 } from '../physics/orbits/types';

export const EARTH_SCENE_RADIUS = 1;
export const KM_TO_SCENE = EARTH_SCENE_RADIUS / EARTH_RADIUS_KM;

export const eciToSceneVector = (positionKm: Vector3): ThreeVector3 =>
  new ThreeVector3(positionKm.x * KM_TO_SCENE, positionKm.z * KM_TO_SCENE, -positionKm.y * KM_TO_SCENE);

export const latLonToSceneVector = (latitudeDeg: number, longitudeDeg: number, radius = EARTH_SCENE_RADIUS): ThreeVector3 => {
  const latitude = (latitudeDeg * Math.PI) / 180;
  const longitude = (longitudeDeg * Math.PI) / 180;
  const cosLatitude = Math.cos(latitude);

  return new ThreeVector3(
    radius * cosLatitude * Math.cos(longitude),
    radius * Math.sin(latitude),
    -radius * cosLatitude * Math.sin(longitude),
  );
};
