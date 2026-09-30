import { signedAngleDifference, type PhonePointing } from "./skyFinder";

/** Approximate rear-camera field used for orientation context, not calibration. */
export const SKY_FIELD_HORIZONTAL_DEG = 82;
export const SKY_FIELD_VERTICAL_DEG = 66;

export interface SkyFieldPoint {
  xPercent: number;
  yPercent: number;
  inField: boolean;
}

/** Project a local horizontal coordinate into Sky's shared display field. */
export function projectSkyField(
  centre: PhonePointing,
  position: { azimuthDeg: number; altitudeDeg: number },
): SkyFieldPoint {
  // Longitude contracts toward the zenith on the local celestial sphere. This
  // remains an approximate camera field because browsers do not disclose the
  // rear-lens FOV, but it preserves local angular relationships better than
  // treating azimuth degrees as a flat Cartesian axis.
  const averageAltitude = ((centre.altitudeDeg + position.altitudeDeg) / 2) * (Math.PI / 180);
  const horizontalError =
    signedAngleDifference(centre.azimuthDeg, position.azimuthDeg) *
    Math.max(0.22, Math.cos(averageAltitude));
  const verticalError = position.altitudeDeg - centre.altitudeDeg;
  const xPercent = 50 + (horizontalError / SKY_FIELD_HORIZONTAL_DEG) * 100;
  const yPercent = 50 - (verticalError / SKY_FIELD_VERTICAL_DEG) * 100;
  return {
    xPercent,
    yPercent,
    inField: xPercent >= 0 && xPercent <= 100 && yPercent >= 0 && yPercent <= 100,
  };
}
