import { Quaternion, Vector3 } from "three";

export const MOON_NEAR_SIDE_MODEL_DIRECTION = new Vector3(1, 0, 0);

export function writeTidallyLockedMoonQuaternion(
  target: Quaternion,
  moonWorldPosition: Vector3,
): Quaternion {
  const moonToEarthWorld = moonWorldPosition.clone().negate().normalize();
  return target.setFromUnitVectors(MOON_NEAR_SIDE_MODEL_DIRECTION, moonToEarthWorld);
}
