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

function rotateVector(
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
  const alpha = radians(alphaDeg);
  const beta = radians(betaDeg);
  const gamma = radians(-gammaDeg);
  const c1 = Math.cos(beta / 2);
  const c2 = Math.cos(alpha / 2);
  const c3 = Math.cos(gamma / 2);
  const s1 = Math.sin(beta / 2);
  const s2 = Math.sin(alpha / 2);
  const s3 = Math.sin(gamma / 2);
  const device = normalizeQuaternion({
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  });
  const rearCamera = axisAnglePose(1, 0, 0, -90);
  const screen = axisAnglePose(0, 0, 1, -screenOrientationDeg);
  return multiplyPoses(multiplyPoses(device, rearCamera), screen);
}

export function pointingFromDevicePose(pose: DevicePose): HorizontalCoordinate {
  const forward = rotateVector({ x: 0, y: 0, z: -1 }, pose);
  return enuToHorizontal({ east: -forward.x, north: -forward.z, up: forward.y });
}

/** Deterministic no-roll pose used by fixtures and direction-only fallback views. */
export function devicePoseLookingAt(pointing: HorizontalCoordinate): DevicePose {
  const yaw = axisAnglePose(0, 1, 0, pointing.azimuthDeg);
  const pitch = axisAnglePose(1, 0, 0, pointing.altitudeDeg);
  return multiplyPoses(yaw, pitch);
}

/** Correct Safari's compass heading by rotating the entire camera pose. */
export function poseWithAbsoluteHeading(pose: DevicePose, headingDeg: number): DevicePose {
  const current = pointingFromDevicePose(pose);
  const correction = signedAngleDifference(current.azimuthDeg, headingDeg);
  return multiplyPoses(axisAnglePose(0, 1, 0, correction), pose);
}

/** Apply user calibration to the whole view, never to an individual target. */
export function calibratedDevicePose(
  pose: DevicePose,
  calibration: { azimuthOffsetDeg: number; altitudeOffsetDeg: number } | null,
): DevicePose {
  if (!calibration) return pose;
  const yaw = axisAnglePose(0, 1, 0, calibration.azimuthOffsetDeg);
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
  horizontalFovDeg = SKY_HORIZONTAL_FOV_DEG,
  verticalFovDeg = SKY_VERTICAL_FOV_DEG,
): SkyProjection {
  const world = { x: -direction.east, y: direction.up, z: -direction.north };
  const inverse = { x: -pose.x, y: -pose.y, z: -pose.z, w: pose.w };
  const camera = rotateVector(world, inverse);
  const inFront = camera.z < -1e-6;
  const denominator = Math.max(1e-6, Math.abs(camera.z));
  // The W3C rear-camera correction leaves camera-local -X on screen-right.
  let xNdc = -camera.x / (denominator * Math.tan(radians(horizontalFovDeg) / 2));
  let yNdc = camera.y / (denominator * Math.tan(radians(verticalFovDeg) / 2));
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
    inField: inFront && Math.abs(xNdc) <= 1 && Math.abs(yNdc) <= 1,
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
