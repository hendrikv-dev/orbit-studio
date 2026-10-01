import {
  devicePoseLookingAt,
  horizontalToEnu,
  projectEnuDirection,
  SKY_HORIZONTAL_FOV_DEG,
  SKY_VERTICAL_FOV_DEG,
} from "../../astronomy/topocentricSky";
import type { PhonePointing } from "./skyFinder";

/** Approximate rear-camera field used for orientation context, not calibration. */
export const SKY_FIELD_HORIZONTAL_DEG = SKY_HORIZONTAL_FOV_DEG;
export const SKY_FIELD_VERTICAL_DEG = SKY_VERTICAL_FOV_DEG;

export interface SkyFieldPoint {
  xPercent: number;
  yPercent: number;
  inField: boolean;
}

/**
 * Compatibility adapter for non-rolling fixtures. Production Sky projects the
 * fixed ENU direction directly through its stabilized quaternion pose.
 */
export function projectSkyField(
  centre: PhonePointing,
  position: { azimuthDeg: number; altitudeDeg: number },
): SkyFieldPoint {
  const projected = projectEnuDirection(
    horizontalToEnu(position),
    devicePoseLookingAt(centre),
  );
  return {
    xPercent: projected.xPercent,
    yPercent: projected.yPercent,
    inField: projected.inField,
  };
}
