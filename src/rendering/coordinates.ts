import { Vector3 } from "three";
import { degreesToRadians } from "../physics/constants";
import type { GeodeticPosition, Vector3Tuple } from "../physics/types";
import { eqjVectorToScene } from "../astronomy/celestialFrames";

export function eciToThreeVector(vector: Vector3Tuple): Vector3 {
  return eqjVectorToScene(new Vector3(...vector));
}

export function latLonToThreeVector(
  position: Pick<GeodeticPosition, "latitudeDeg" | "longitudeDeg">,
  radiusKm: number,
): Vector3 {
  const latitude = degreesToRadians(position.latitudeDeg);
  const longitude = degreesToRadians(position.longitudeDeg);
  const cosLatitude = Math.cos(latitude);
  const textureLongitude = -longitude;

  return new Vector3(
    radiusKm * cosLatitude * Math.cos(textureLongitude),
    radiusKm * Math.sin(latitude),
    radiusKm * cosLatitude * Math.sin(textureLongitude),
  );
}

export function ecefToEarthFixedThreeVector(
  vector: Vector3Tuple,
  radiusKm: number,
): Vector3 {
  return eqjVectorToScene(new Vector3(...vector))
    .normalize()
    .multiplyScalar(radiusKm);
}
