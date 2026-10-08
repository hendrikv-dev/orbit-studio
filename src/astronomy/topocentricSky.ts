import { Horizon, MakeTime, Observer } from "astronomy-engine";

export interface ObserverLocation {
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface EquatorialCatalogPosition {
  raHours: number;
  decDeg: number;
  properMotionRaArcsecPerYear?: number | null;
  properMotionDecArcsecPerYear?: number | null;
}

export interface HorizontalCoordinate {
  azimuthDeg: number;
  altitudeDeg: number;
}

/** East, north, up unit vector in the observer's local tangent frame. */
export interface EnuDirection {
  east: number;
  north: number;
  up: number;
}

/** Unit quaternion mapping rear-camera local coordinates into the local sky world. */
export interface DevicePose {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SkyProjection {
  xPercent: number;
  yPercent: number;
  inField: boolean;
  inFront: boolean;
}

export interface CameraProjectionModel {
  /** Calibrated field of view for the full camera frame. */
  horizontalFovDeg: number;
  verticalFovDeg: number;
  /** Intrinsic media-frame dimensions reported by the active video track. */
  sourceWidthPx: number;
  sourceHeightPx: number;
  /** CSS content-box dimensions occupied by the center-cropped preview. */
  viewportWidthPx: number;
  viewportHeightPx: number;
  fit: "cover" | "contain";
}

export interface EffectiveCameraProjection {
  horizontalFovDeg: number;
  verticalFovDeg: number;
  sourceAspectRatio: number;
  viewportAspectRatio: number;
  cropAxis: "horizontal" | "vertical" | "none";
  visibleFraction: number;
}

export const SKY_HORIZONTAL_FOV_DEG = 82;
export const SKY_VERTICAL_FOV_DEG = 66;
const J2000_UTC_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function degrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function signedAngleDifference(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function normalizeVector(direction: EnuDirection): EnuDirection {
  const length = Math.hypot(direction.east, direction.north, direction.up) || 1;
  return {
    east: direction.east / length,
    north: direction.north / length,
    up: direction.up / length,
  };
}

export function horizontalToEnu(position: HorizontalCoordinate): EnuDirection {
  const altitude = radians(position.altitudeDeg);
  const azimuth = radians(position.azimuthDeg);
  return normalizeVector({
    east: Math.cos(altitude) * Math.sin(azimuth),
    north: Math.cos(altitude) * Math.cos(azimuth),
    up: Math.sin(altitude),
  });
}

export function enuToHorizontal(direction: EnuDirection): HorizontalCoordinate {
  const normalized = normalizeVector(direction);
  return {
    azimuthDeg: normalizeDegrees(degrees(Math.atan2(normalized.east, normalized.north))),
    altitudeDeg: degrees(Math.asin(Math.max(-1, Math.min(1, normalized.up)))),
  };
}

/**
 * Advance a BSC5P J2000 catalogue coordinate with its proper motion.
 *
 * HEASARC reports pmRA as mu-alpha-star (arcsec/year, including cos(dec)), so
 * the coordinate change divides by cos(dec). This remains a catalogue model,
 * not a claim of sub-arcsecond apparent-place accuracy.
 */
export function equatorialAtDate(
  position: EquatorialCatalogPosition,
  at: Date,
): { raHours: number; decDeg: number } {
  const years = (at.getTime() - J2000_UTC_MS) / (365.25 * 86_400_000);
  const decMotion = position.properMotionDecArcsecPerYear ?? 0;
  const decDeg = position.decDeg + (decMotion * years) / 3600;
  const cosineDeclination = Math.max(1e-6, Math.abs(Math.cos(radians(position.decDeg))));
  const raMotion = position.properMotionRaArcsecPerYear ?? 0;
  const raDeg = normalizeDegrees(
    position.raHours * 15 + (raMotion * years) / (3600 * cosineDeclination),
  );
  return { raHours: raDeg / 15, decDeg };
}

/** The one catalog-to-observer transformation used by Sky and its figures. */
export function catalogDirectionForObserver(
  position: EquatorialCatalogPosition,
  observer: ObserverLocation,
  at: Date,
): { equatorial: { raHours: number; decDeg: number }; horizontal: HorizontalCoordinate; enu: EnuDirection } {
  const equatorial = equatorialAtDate(position, at);
  const horizon = Horizon(
    MakeTime(at),
    new Observer(observer.latitudeDeg, observer.longitudeDeg, 0),
    equatorial.raHours,
    equatorial.decDeg,
    "normal",
  );
  const horizontal = { azimuthDeg: horizon.azimuth, altitudeDeg: horizon.altitude };
  return { equatorial, horizontal, enu: horizontalToEnu(horizontal) };
}

function normalizeQuaternion(pose: DevicePose): DevicePose {
  const length = Math.hypot(pose.x, pose.y, pose.z, pose.w) || 1;
  return { x: pose.x / length, y: pose.y / length, z: pose.z / length, w: pose.w / length };
}

export function multiplyPoses(left: DevicePose, right: DevicePose): DevicePose {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

function axisAnglePose(x: number, y: number, z: number, angleDeg: number): DevicePose {
  const half = radians(angleDeg) / 2;
  const sine = Math.sin(half);
  return { x: x * sine, y: y * sine, z: z * sine, w: Math.cos(half) };
}

export function rotateVectorByPose(
  vector: { x: number; y: number; z: number },
  pose: DevicePose,
): { x: number; y: number; z: number } {
  const { x, y, z, w } = pose;
  const ix = w * vector.x + y * vector.z - z * vector.y;
  const iy = w * vector.y + z * vector.x - x * vector.z;
  const iz = w * vector.z + x * vector.y - y * vector.x;
  const iw = -x * vector.x - y * vector.y - z * vector.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

function quaternionFromW3cOrientation(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): DevicePose {
  // Device Orientation defines an intrinsic Z-X'-Y'' sequence. These terms
  // are the quaternion published in the W3C specification, with the world
  // axes interpreted directly as ENU: X=east, Y=north, Z=up.
  const halfAlpha = radians(alphaDeg) / 2;
  const halfBeta = radians(betaDeg) / 2;
  const halfGamma = radians(gammaDeg) / 2;
  const cA = Math.cos(halfAlpha);
  const cB = Math.cos(halfBeta);
  const cG = Math.cos(halfGamma);
  const sA = Math.sin(halfAlpha);
  const sB = Math.sin(halfBeta);
  const sG = Math.sin(halfGamma);
  return normalizeQuaternion({
    w: cB * cG * cA - sB * sG * sA,
    x: sB * cG * cA - cB * sG * sA,
    y: cB * sG * cA + sB * cG * sA,
    z: cB * cG * sA + sB * sG * cA,
  });
}

/**
 * Convert W3C alpha/beta/gamma to a rear-camera pose.
 * Screen orientation is composed exactly once in this function.
 */
export function devicePoseFromOrientation(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenOrientationDeg = 0,
): DevicePose {
  const device = quaternionFromW3cOrientation(alphaDeg, betaDeg, gammaDeg);
  // The physical Device Orientation frame remains portrait-relative when the
  // display rotates. Compose the display rotation once so camera-local X/Y
  // remain screen-right/screen-up. Camera-local -Z is the rear optical axis.
  const screen = axisAnglePose(0, 0, 1, screenOrientationDeg);
  return multiplyPoses(device, screen);
}

/**
 * Safari reports alpha relative to an arbitrary startup direction, while
 * `webkitCompassHeading` supplies the earth reference in the opposite sense.
 * Replace that one yaw input before constructing the W3C quaternion; never
 * force the tilted camera optical axis to equal a compass heading.
 */
export function devicePoseFromOrientationWithHeading(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenOrientationDeg: number,
  magneticHeadingDeg: number | null,
): DevicePose {
  const absoluteAlpha = magneticHeadingDeg === null
    ? alphaDeg
    : normalizeDegrees(360 - magneticHeadingDeg);
  return devicePoseFromOrientation(
    absoluteAlpha,
    betaDeg,
    gammaDeg,
    screenOrientationDeg,
  );
}

export function pointingFromDevicePose(pose: DevicePose): HorizontalCoordinate {
  const forward = rotateVectorByPose({ x: 0, y: 0, z: -1 }, pose);
  return enuToHorizontal({ east: forward.x, north: forward.y, up: forward.z });
}

function poseFromBasis(
  right: EnuDirection,
  up: EnuDirection,
  backward: EnuDirection,
): DevicePose {
  // Rotation matrix columns are the world directions of local X/Y/Z.
  const m00 = right.east;
  const m01 = up.east;
  const m02 = backward.east;
  const m10 = right.north;
  const m11 = up.north;
  const m12 = backward.north;
  const m20 = right.up;
  const m21 = up.up;
  const m22 = backward.up;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return normalizeQuaternion({
      w: s / 4,
      x: (m21 - m12) / s,
      y: (m02 - m20) / s,
      z: (m10 - m01) / s,
    });
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return normalizeQuaternion({
      w: (m21 - m12) / s,
      x: s / 4,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s,
    });
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return normalizeQuaternion({
      w: (m02 - m20) / s,
      x: (m01 + m10) / s,
      y: s / 4,
      z: (m12 + m21) / s,
    });
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return normalizeQuaternion({
    w: (m10 - m01) / s,
    x: (m02 + m20) / s,
    y: (m12 + m21) / s,
    z: s / 4,
  });
}

/** Deterministic no-roll pose used by fixtures and direction-only fallback views. */
export function devicePoseLookingAt(pointing: HorizontalCoordinate): DevicePose {
  const forward = horizontalToEnu(pointing);
  const horizontalLength = Math.hypot(forward.east, forward.north);
  const right = horizontalLength > 1e-6
    ? normalizeVector({ east: forward.north, north: -forward.east, up: 0 })
    : { east: 1, north: 0, up: 0 };
  const up = normalizeVector({
    east: right.north * forward.up,
    north: -right.east * forward.up,
    up: right.east * forward.north - right.north * forward.east,
  });
  return poseFromBasis(
    right,
    up,
    { east: -forward.east, north: -forward.north, up: -forward.up },
  );
}

/** Apply user calibration to the whole view, never to an individual target. */
export function calibratedDevicePose(
  pose: DevicePose,
  calibration: { azimuthOffsetDeg: number; altitudeOffsetDeg: number } | null,
): DevicePose {
  if (!calibration) return pose;
  const yaw = axisAnglePose(0, 0, 1, -calibration.azimuthOffsetDeg);
  const pitch = axisAnglePose(1, 0, 0, calibration.altitudeOffsetDeg);
  return multiplyPoses(multiplyPoses(yaw, pose), pitch);
}

function slerp(left: DevicePose, rightInput: DevicePose, amount: number): DevicePose {
  let right = rightInput;
  let cosine = left.x * right.x + left.y * right.y + left.z * right.z + left.w * right.w;
  if (cosine < 0) {
    cosine = -cosine;
    right = { x: -right.x, y: -right.y, z: -right.z, w: -right.w };
  }
  if (cosine > 0.9995) {
    return normalizeQuaternion({
      x: left.x + amount * (right.x - left.x),
      y: left.y + amount * (right.y - left.y),
      z: left.z + amount * (right.z - left.z),
      w: left.w + amount * (right.w - left.w),
    });
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
  const sine = Math.sin(angle);
  const a = Math.sin((1 - amount) * angle) / sine;
  const b = Math.sin(amount * angle) / sine;
  return normalizeQuaternion({
    x: left.x * a + right.x * b,
    y: left.y * a + right.y * b,
    z: left.z * a + right.z * b,
    w: left.w * a + right.w * b,
  });
}

export function poseAngularDistanceDeg(left: DevicePose, right: DevicePose): number {
  const dot = Math.abs(left.x * right.x + left.y * right.y + left.z * right.z + left.w * right.w);
  return degrees(2 * Math.acos(Math.max(-1, Math.min(1, dot))));
}

/**
 * Low-latency pose filter. A small deadband suppresses stationary compass noise;
 * time-based quaternion slerp makes all celestial geometry move as one scene.
 */
export class DevicePoseStabilizer {
  private pose: DevicePose | null = null;
  private atMs: number | null = null;

  constructor(
    private readonly responseMs = 85,
    private readonly deadbandDeg = 0.18,
  ) {}

  update(next: DevicePose, atMs: number): DevicePose {
    if (!this.pose || this.atMs === null) {
      this.pose = normalizeQuaternion(next);
      this.atMs = atMs;
      return this.pose;
    }
    const elapsed = Math.max(1, Math.min(250, atMs - this.atMs));
    this.atMs = atMs;
    const distance = poseAngularDistanceDeg(this.pose, next);
    if (distance <= this.deadbandDeg) return this.pose;
    const response = distance > 24 ? 48 : this.responseMs;
    const amount = Math.max(0.08, Math.min(0.82, 1 - Math.exp(-elapsed / response)));
    this.pose = slerp(this.pose, next, amount);
    return this.pose;
  }

  reset(): void {
    this.pose = null;
    this.atMs = null;
  }
}

/** Project one fixed celestial ENU vector through the stabilized camera pose. */
export function projectEnuDirection(
  direction: EnuDirection,
  pose: DevicePose,
  projection: Partial<CameraProjectionModel> = {},
): SkyProjection {
  const effective = effectiveCameraProjection(projection);
  const world = { x: direction.east, y: direction.north, z: direction.up };
  const inverse = { x: -pose.x, y: -pose.y, z: -pose.z, w: pose.w };
  const camera = rotateVectorByPose(world, inverse);
  const inFront = camera.z < -1e-6;
  const denominator = Math.max(1e-6, Math.abs(camera.z));
  let xNdc = camera.x / (denominator * Math.tan(radians(effective.horizontalFovDeg) / 2));
  let yNdc = camera.y / (denominator * Math.tan(radians(effective.verticalFovDeg) / 2));
  if (!inFront) {
    xNdc *= -1;
    yNdc *= -1;
  }
  const xPercent = 50 + xNdc * 50;
  const yPercent = 50 - yNdc * 50;
  return {
    xPercent,
    yPercent,
    inFront,
    inField: inFront && Math.abs(xNdc) <= 1 + 1e-12 && Math.abs(yNdc) <= 1 + 1e-12,
  };
}

/**
 * Match the projection to the visible portion of a centered `object-fit`
 * camera preview. Browser media APIs do not expose optical intrinsics, so the
 * base FOV remains an explicitly documented estimate; crop math is exact for
 * the reported media and viewport aspect ratios.
 */
export function effectiveCameraProjection(
  projection: Partial<CameraProjectionModel> = {},
): EffectiveCameraProjection {
  const horizontalFovDeg = projection.horizontalFovDeg ?? SKY_HORIZONTAL_FOV_DEG;
  const verticalFovDeg = projection.verticalFovDeg ?? SKY_VERTICAL_FOV_DEG;
  const sourceWidth = projection.sourceWidthPx ?? 0;
  const sourceHeight = projection.sourceHeightPx ?? 0;
  const viewportWidth = projection.viewportWidthPx ?? 0;
  const viewportHeight = projection.viewportHeightPx ?? 0;
  const sourceAspectRatio = sourceWidth > 0 && sourceHeight > 0
    ? sourceWidth / sourceHeight
    : Math.tan(radians(horizontalFovDeg) / 2) / Math.tan(radians(verticalFovDeg) / 2);
  const viewportAspectRatio = viewportWidth > 0 && viewportHeight > 0
    ? viewportWidth / viewportHeight
    : sourceAspectRatio;
  if (projection.fit === "contain" || Math.abs(sourceAspectRatio - viewportAspectRatio) < 1e-6) {
    return {
      horizontalFovDeg,
      verticalFovDeg,
      sourceAspectRatio,
      viewportAspectRatio,
      cropAxis: "none",
      visibleFraction: 1,
    };
  }
  if (sourceAspectRatio > viewportAspectRatio) {
    const visibleFraction = viewportAspectRatio / sourceAspectRatio;
    return {
      horizontalFovDeg: degrees(2 * Math.atan(Math.tan(radians(horizontalFovDeg) / 2) * visibleFraction)),
      verticalFovDeg,
      sourceAspectRatio,
      viewportAspectRatio,
      cropAxis: "horizontal",
      visibleFraction,
    };
  }
  const visibleFraction = sourceAspectRatio / viewportAspectRatio;
  return {
    horizontalFovDeg,
    verticalFovDeg: degrees(2 * Math.atan(Math.tan(radians(verticalFovDeg) / 2) * visibleFraction)),
    sourceAspectRatio,
    viewportAspectRatio,
    cropAxis: "vertical",
    visibleFraction,
  };
}

/** Honest off-screen cue at the field edge; the celestial marker itself is never clamped. */
export function edgeCueForProjection(projection: SkyProjection, insetPercent = 7): SkyProjection {
  const dx = projection.xPercent - 50;
  const dy = projection.yPercent - 50;
  const half = 50 - insetPercent;
  const scale = Math.max(Math.abs(dx) / half, Math.abs(dy) / half, 1);
  return {
    ...projection,
    xPercent: 50 + dx / scale,
    yPercent: 50 + dy / scale,
    inField: false,
  };
}
