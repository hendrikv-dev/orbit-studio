import { Body, Equator, Horizon, MakeTime, Observer } from "astronomy-engine";

import {
  devicePoseFromOrientation,
  pointingFromDevicePose,
} from "../../astronomy/topocentricSky";

import type { BestWindow } from "./conditions";
import type { Opportunity } from "./opportunity";
import { skyPathFor, type SkyPath, type SkyPoint } from "./skyPath";

/**
 * The Finder's target model is a projection of an existing opportunity.
 *
 * It deliberately does not own a catalogue, observer, or clock. A target keeps
 * the opportunity identity and the production geometry that already powers the
 * rail and detail chart; the observer and instant are supplied when a pointing
 * solution is requested. This prevents Finder from becoming a second answer to
 * which objects exist or where the reader is standing.
 */
export type SkyFinderShape = "point" | "cluster" | "region" | "radiant";

export type SkyFinderSource =
  | { kind: "body"; body: string }
  | { kind: "body-region"; bodies: readonly string[] }
  | { kind: "equatorial"; rightAscensionHours: number; declinationDeg: number }
  | { kind: "sampled"; path: SkyPath };

export interface SkyFinderTarget {
  id: string;
  title: string;
  shape: SkyFinderShape;
  /** Angular radius of the target region, not an alignment allowance. */
  angularRadiusDeg: number;
  /** Sensor alignment tolerance chosen for the target's physical extent. */
  alignmentToleranceDeg: number;
  source: SkyFinderSource;
  recommendedAtUtc: string;
  equipment: Opportunity["guidance"]["equipment"];
  appearance: string;
  observableTonight: boolean;
  visualVerification: "not-attempted";
}

export interface HorizontalPosition {
  altitudeDeg: number;
  azimuthDeg: number;
  atUtc: string;
}

export interface PhonePointing {
  altitudeDeg: number;
  azimuthDeg: number;
}

export interface FinderCalibration {
  azimuthOffsetDeg: number;
  altitudeOffsetDeg: number;
  referenceId: string;
  createdAtUtc: string;
}

export type PointingQuality = "good" | "fair" | "poor" | "unavailable";
export type SkyFinderDeviceClass = "handheld" | "desktop" | "unknown";
export type SkyFinderExperience = "live" | "direction-only" | "preview";

export interface FinderCapabilities {
  deviceClass: SkyFinderDeviceClass;
  handheldEligible: boolean;
  secureContext: boolean;
  camera: boolean;
  geolocation: boolean;
  orientation: boolean;
  absoluteOrientation: boolean;
  motion: boolean;
  gyroscope: boolean;
  magneticHeading: boolean;
  screenOrientation: boolean;
  orientationPermissionRequest: boolean;
  motionPermissionRequest: boolean;
}

/**
 * Platform-neutral seam for Phase 3 visual sky locking.
 *
 * Phase 1/2 never constructs a successful result. A future implementation must
 * detect points in an on-device frame, match them to a cited star catalogue,
 * and return a solved camera attitude with its evidence. Keeping this contract
 * separate prevents sensor alignment from being relabelled as visual proof.
 */
export interface VisualStarDetection {
  xPx: number;
  yPx: number;
  brightness: number;
}

export interface VisualSkySolveRequest {
  capturedAtUtc: string;
  frameWidthPx: number;
  frameHeightPx: number;
  approximatePointing: PhonePointing;
  observer: { latitudeDeg: number; longitudeDeg: number };
  detections: VisualStarDetection[];
}

export interface VisualSkySolveResult {
  status: "locked" | "low-confidence" | "no-match";
  pointing: PhonePointing | null;
  matchedStars: number;
  confidence: number;
  residualDeg: number | null;
}

export interface VisualSkySolver {
  solve(request: VisualSkySolveRequest): Promise<VisualSkySolveResult>;
}

interface CapabilityEnvironment {
  secureContext?: boolean;
  navigator?: {
    geolocation?: unknown;
    mediaDevices?: { getUserMedia?: unknown };
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    userAgentData?: { mobile?: boolean; platform?: string };
  };
  window?: Record<string, unknown>;
  screen?: { orientation?: unknown };
  matchMedia?: (query: string) => { matches: boolean };
}

function constructorRequestsPermission(value: unknown): boolean {
  return (
    typeof value === "function" &&
    typeof (value as { requestPermission?: unknown }).requestPermission === "function"
  );
}

/**
 * Classify physical pointing devices without treating viewport width as device
 * identity. A phone/tablet hint is never enough on its own: it must agree with
 * an actual touch or coarse-pointer capability. This keeps a spoofed mobile
 * user agent, a narrow desktop window and a webcam-equipped laptop out of the
 * live-pointing path while retaining iPadOS's desktop-style Mac identity.
 */
export function classifySkyFinderDevice(
  environment: Pick<CapabilityEnvironment, "navigator" | "matchMedia">,
): SkyFinderDeviceClass {
  const navigatorLike = environment.navigator ?? {};
  const userAgent = navigatorLike.userAgent ?? "";
  const platform = navigatorLike.userAgentData?.platform ?? navigatorLike.platform ?? "";
  const touchPoints = navigatorLike.maxTouchPoints ?? 0;
  const mobileHint = navigatorLike.userAgentData?.mobile === true;
  const explicitHandheld = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(userAgent);
  const ipadDesktopIdentity = /Mac/i.test(platform) && touchPoints > 1;
  const coarsePointer = environment.matchMedia?.("(pointer: coarse)").matches === true;
  const fineHoverPointer =
    environment.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true;
  const touchCapable = touchPoints > 0 || coarsePointer;
  const touchFirstTablet = touchPoints > 1 && coarsePointer && !fineHoverPointer;

  if (
    touchCapable &&
    (mobileHint || explicitHandheld || ipadDesktopIdentity || touchFirstTablet)
  ) {
    return "handheld";
  }

  const explicitDesktop = /Windows NT|Macintosh|X11|CrOS|Linux x86_64/i.test(userAgent);
  if (explicitDesktop || fineHoverPointer) return "desktop";
  return "unknown";
}

/**
 * Whether this device may expose the Sky destination before any permission is
 * requested.
 *
 * Sky is not a responsive layout or a preview. It is a live pointing
 * capability, so all three parts must already be present: handheld form
 * factor, a secure camera API, and the orientation stream the guidance loop
 * actually consumes. Permission denial is handled after entry without
 * withdrawing the screen the reader is already using.
 */
export function supportsLiveSkyFinder(capabilities: FinderCapabilities): boolean {
  return (
    capabilities.handheldEligible &&
    capabilities.secureContext &&
    capabilities.camera &&
    capabilities.orientation
  );
}

/** Runtime feature detection only; permission is a separate user decision. */
export function detectSkyFinderCapabilities(
  environment: CapabilityEnvironment = {
    secureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    window: typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : undefined,
    screen: typeof screen !== "undefined" ? screen : undefined,
    matchMedia:
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia.bind(window)
        : undefined,
  },
): FinderCapabilities {
  const view = environment.window ?? {};
  const orientation = view.DeviceOrientationEvent;
  const motion = view.DeviceMotionEvent;
  const deviceClass = classifySkyFinderDevice(environment);
  return {
    deviceClass,
    handheldEligible: deviceClass === "handheld",
    secureContext: environment.secureContext === true,
    camera:
      environment.secureContext === true &&
      typeof environment.navigator?.mediaDevices?.getUserMedia === "function",
    geolocation: environment.secureContext === true && Boolean(environment.navigator?.geolocation),
    orientation: typeof orientation === "function" || "ondeviceorientation" in view,
    absoluteOrientation:
      "ondeviceorientationabsolute" in view || typeof view.AbsoluteOrientationSensor === "function",
    motion: typeof motion === "function" || "ondevicemotion" in view,
    gyroscope: typeof view.Gyroscope === "function",
    // Safari exposes magnetic heading on DeviceOrientationEvent instances. It
    // cannot be known with certainty before the first event, so this says the
    // browser family can supply it rather than promising a reading.
    magneticHeading:
      typeof orientation === "function" &&
      ("ondeviceorientationabsolute" in view || constructorRequestsPermission(orientation)),
    screenOrientation: Boolean(environment.screen?.orientation),
    orientationPermissionRequest: constructorRequestsPermission(orientation),
    motionPermissionRequest: constructorRequestsPermission(motion),
  };
}

export function skyFinderExperience(
  capabilities: FinderCapabilities,
  orientationAccess: "unknown" | "granted" | "denied" | "unavailable" = "unknown",
): SkyFinderExperience {
  if (!capabilities.handheldEligible) return "preview";
  return capabilities.orientation && orientationAccess !== "denied" && orientationAccess !== "unavailable"
    ? "live"
    : "direction-only";
}

export type SkyFinderPermissionKind = "camera" | "orientation" | "motion";

/** The single policy gate used before any protected Finder API is requested. */
export function canRequestSkyFinderPermission(
  capabilities: FinderCapabilities,
  kind: SkyFinderPermissionKind,
  context: { liveDate: boolean; userInitiated: boolean },
): boolean {
  if (!capabilities.handheldEligible || !context.liveDate || !context.userInitiated) return false;
  if (kind === "camera") return capabilities.camera;
  if (kind === "motion") return capabilities.motion;
  return capabilities.orientation;
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** Signed shortest turn from `from` to `to`, in [-180, 180). */
export function signedAngleDifference(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue: number): number {
  return (radiansValue * 180) / Math.PI;
}

/** Great-circle separation on the local celestial sphere. */
export function angularSeparation(a: PhonePointing, b: HorizontalPosition): number {
  const altitudeA = radians(a.altitudeDeg);
  const altitudeB = radians(b.altitudeDeg);
  const deltaAzimuth = radians(signedAngleDifference(a.azimuthDeg, b.azimuthDeg));
  const cosine =
    Math.sin(altitudeA) * Math.sin(altitudeB) +
    Math.cos(altitudeA) * Math.cos(altitudeB) * Math.cos(deltaAzimuth);
  if (cosine > 1 - 1e-12) return 0;
  if (cosine < -1 + 1e-12) return 180;
  return degrees(Math.acos(Math.max(-1, Math.min(1, cosine))));
}

export function alignmentFor(
  pointing: PhonePointing | null,
  target: HorizontalPosition | null,
  toleranceDeg: number,
  quality: PointingQuality,
): { separationDeg: number | null; aligned: boolean } {
  if (!pointing || !target) return { separationDeg: null, aligned: false };
  const separationDeg = angularSeparation(pointing, target);
  // Poor or relative-only orientation can guide, but cannot honestly assert a
  // lock. Calibration or an absolute heading upgrades the evidence first.
  const aligned =
    target.altitudeDeg > 0 &&
    quality !== "poor" &&
    quality !== "unavailable" &&
    separationDeg <= toleranceDeg;
  return { separationDeg, aligned };
}

export type SkyGuidanceKind = "unavailable" | "below-horizon" | "direction" | "almost" | "aligned";

export function describeTargetAltitude(altitudeDeg: number): string {
  return altitudeDeg < 0
    ? `${Math.round(Math.abs(altitudeDeg))}° below horizon`
    : `${Math.round(altitudeDeg)}° high`;
}

/** Pure guidance policy: below-horizon targets never receive pointing instructions. */
export function guidanceForSkyTarget(
  title: string,
  pointing: PhonePointing | null,
  target: HorizontalPosition | null,
  toleranceDeg: number,
  quality: PointingQuality,
): { kind: SkyGuidanceKind; instruction: string; separationDeg: number | null } {
  if (!target) return { kind: "unavailable", instruction: "Preparing live guidance", separationDeg: null };
  if (target.altitudeDeg < 0) {
    return {
      kind: "below-horizon",
      instruction: `${title} is below the horizon`,
      separationDeg: null,
    };
  }
  if (!pointing) return { kind: "direction", instruction: "Direction only", separationDeg: null };
  const alignment = alignmentFor(pointing, target, toleranceDeg, quality);
  if (alignment.aligned) {
    return { kind: "aligned", instruction: `${title} is here`, separationDeg: alignment.separationDeg };
  }
  const horizontalDeg = signedAngleDifference(pointing.azimuthDeg, target.azimuthDeg);
  const verticalDeg = target.altitudeDeg - pointing.altitudeDeg;
  const horizontalMagnitude = Math.abs(horizontalDeg);
  const verticalMagnitude = Math.abs(verticalDeg);
  if (horizontalMagnitude < 3 && verticalMagnitude < 3) {
    return { kind: "almost", instruction: "Almost there", separationDeg: alignment.separationDeg };
  }
  if (horizontalMagnitude >= verticalMagnitude) {
    return {
      kind: "direction",
      instruction: `Move${horizontalMagnitude < 15 ? " slightly" : ""} ${horizontalDeg < 0 ? "left" : "right"}`,
      separationDeg: alignment.separationDeg,
    };
  }
  return {
    kind: "direction",
    instruction: verticalDeg < 0
      ? `Lower phone${verticalMagnitude < 15 ? " slightly" : ""}`
      : `Raise phone${verticalMagnitude < 15 ? " slightly" : ""}`,
    separationDeg: alignment.separationDeg,
  };
}

/**
 * Convert W3C alpha/beta/gamma into the rear-camera optical axis.
 *
 * This follows the same YXZ quaternion order used by DeviceOrientationControls.
 * The returned azimuth is clockwise from true/device north and altitude is
 * positive above the horizon. `screenOrientationDeg` compensates portrait and
 * landscape coordinates before the optical axis is read.
 */
export function pointingFromDeviceOrientation(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenOrientationDeg = 0,
): PhonePointing {
  return pointingFromDevicePose(
    devicePoseFromOrientation(alphaDeg, betaDeg, gammaDeg, screenOrientationDeg),
  );
}

export function calibrationFromAlignment(
  reported: PhonePointing,
  expected: HorizontalPosition,
  referenceId: string,
  createdAtUtc: string,
): FinderCalibration {
  return {
    azimuthOffsetDeg: signedAngleDifference(reported.azimuthDeg, expected.azimuthDeg),
    altitudeOffsetDeg: expected.altitudeDeg - reported.altitudeDeg,
    referenceId,
    createdAtUtc,
  };
}

export function applyCalibration(
  pointing: PhonePointing,
  calibration: FinderCalibration | null,
): PhonePointing {
  if (!calibration) return pointing;
  return {
    azimuthDeg: normalizeDegrees(pointing.azimuthDeg + calibration.azimuthOffsetDeg),
    altitudeDeg: Math.max(-90, Math.min(90, pointing.altitudeDeg + calibration.altitudeOffsetDeg)),
  };
}

function interpolatePath(path: SkyPath, at: Date): HorizontalPosition | null {
  const points = path.points;
  if (points.length === 0) return null;
  const stamp = at.getTime();
  const first = Date.parse(points[0].atUtc);
  const last = Date.parse(points[points.length - 1].atUtc);
  // A satellite pass or shower track is valid only for the interval it was
  // propagated. Clamping would display an old solution under a new time.
  if (stamp < first || stamp > last) return null;
  const afterIndex = points.findIndex((point) => Date.parse(point.atUtc) >= stamp);
  if (afterIndex <= 0) {
    const point = points[0];
    return { altitudeDeg: point.altitudeDeg, azimuthDeg: point.azimuthDeg, atUtc: at.toISOString() };
  }
  const before = points[afterIndex - 1];
  const after = points[afterIndex];
  const beforeStamp = Date.parse(before.atUtc);
  const afterStamp = Date.parse(after.atUtc);
  const fraction = afterStamp === beforeStamp ? 0 : (stamp - beforeStamp) / (afterStamp - beforeStamp);
  return {
    altitudeDeg: before.altitudeDeg + (after.altitudeDeg - before.altitudeDeg) * fraction,
    azimuthDeg: normalizeDegrees(
      before.azimuthDeg + signedAngleDifference(before.azimuthDeg, after.azimuthDeg) * fraction,
    ),
    atUtc: at.toISOString(),
  };
}

function bodyPosition(
  body: string,
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
): HorizontalPosition | null {
  try {
    const astronomyObserver = new Observer(observer.latitudeDeg, observer.longitudeDeg, 0);
    const time = MakeTime(at);
    const equator = Equator(body as Body, time, astronomyObserver, true, true);
    const horizon = Horizon(time, astronomyObserver, equator.ra, equator.dec, "normal");
    return { altitudeDeg: horizon.altitude, azimuthDeg: horizon.azimuth, atUtc: at.toISOString() };
  } catch {
    return null;
  }
}

function centroid(positions: HorizontalPosition[], at: Date): HorizontalPosition | null {
  if (positions.length === 0) return null;
  let east = 0;
  let north = 0;
  let up = 0;
  for (const position of positions) {
    const altitude = radians(position.altitudeDeg);
    const azimuth = radians(position.azimuthDeg);
    east += Math.cos(altitude) * Math.sin(azimuth);
    north += Math.cos(altitude) * Math.cos(azimuth);
    up += Math.sin(altitude);
  }
  const horizontal = Math.hypot(east, north);
  return {
    altitudeDeg: degrees(Math.atan2(up, horizontal)),
    azimuthDeg: normalizeDegrees(degrees(Math.atan2(east, north))),
    atUtc: at.toISOString(),
  };
}

export function positionForSkyFinderTarget(
  target: SkyFinderTarget,
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
): HorizontalPosition | null {
  switch (target.source.kind) {
    case "body":
      return bodyPosition(target.source.body, observer, at);
    case "body-region":
      return centroid(
        target.source.bodies
          .map((body) => bodyPosition(body, observer, at))
          .filter((position): position is HorizontalPosition => position !== null),
        at,
      );
    case "equatorial": {
      const astronomyObserver = new Observer(observer.latitudeDeg, observer.longitudeDeg, 0);
      const time = MakeTime(at);
      const horizon = Horizon(
        time,
        astronomyObserver,
        target.source.rightAscensionHours,
        target.source.declinationDeg,
        "normal",
      );
      return { altitudeDeg: horizon.altitude, azimuthDeg: horizon.azimuth, atUtc: at.toISOString() };
    }
    case "sampled":
      return interpolatePath(target.source.path, at);
  }
}

/** Find the next upward horizon crossing using the same production target position path. */
export function nextRiseForSkyFinderTarget(
  target: SkyFinderTarget,
  observer: { latitudeDeg: number; longitudeDeg: number },
  after: Date,
  limitHours = 72,
): string | null {
  const stepMs = 10 * 60_000;
  const end = after.getTime() + limitHours * 3_600_000;
  let previousAt = after.getTime();
  let previous = positionForSkyFinderTarget(target, observer, after);
  for (let stamp = previousAt + stepMs; stamp <= end; stamp += stepMs) {
    const next = positionForSkyFinderTarget(target, observer, new Date(stamp));
    if (previous && next && previous.altitudeDeg <= 0 && next.altitudeDeg > 0) {
      let low = previousAt;
      let high = stamp;
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const middle = (low + high) / 2;
        const position = positionForSkyFinderTarget(target, observer, new Date(middle));
        if (position && position.altitudeDeg > 0) high = middle;
        else low = middle;
      }
      return new Date(high).toISOString();
    }
    if (next) {
      previous = next;
      previousAt = stamp;
    }
  }
  return null;
}

function deepSkyFinderSource(opportunity: Opportunity): SkyFinderSource | null {
  const finder = opportunity.finder;
  if (finder?.rightAscensionHours === undefined || finder.declinationDeg === undefined) return null;
  return {
    kind: "equatorial",
    rightAscensionHours: finder.rightAscensionHours,
    declinationDeg: finder.declinationDeg,
  };
}

/** Build a Finder target only for opportunities that have meaningful geometry. */
export function skyFinderTargetFor(
  opportunity: Opportunity,
  window: BestWindow | null,
  observableTonight = true,
): SkyFinderTarget | null {
  if (opportunity.kind === "solar-eclipse") return null;
  const path = skyPathFor(opportunity, window);
  let source: SkyFinderSource | null = null;
  let shape: SkyFinderShape = "point";
  let angularRadiusDeg = 0.2;
  let alignmentToleranceDeg = 3;

  if (opportunity.kind === "moon" || opportunity.kind === "lunar-eclipse") {
    source = { kind: "body", body: Body.Moon };
    angularRadiusDeg = 0.25;
  } else if (opportunity.science?.kind === "planet") {
    source = { kind: "body", body: opportunity.science.body };
  } else if (opportunity.science?.kind === "conjunction") {
    source = {
      kind: "body-region",
      bodies: opportunity.science.bodies.map((body) => body.replace(/^the\s+/i, "")),
    };
    shape = "region";
    angularRadiusDeg = Math.max(1.5, Number(opportunity.science.separationDeg) / 2);
    alignmentToleranceDeg = Math.max(5, Math.min(9, angularRadiusDeg + 3));
  } else if (opportunity.kind === "deep-sky") {
    source = deepSkyFinderSource(opportunity) ?? (path ? { kind: "sampled", path } : null);
    shape = opportunity.finder?.shape ?? "region";
    angularRadiusDeg = opportunity.finder?.angularRadiusDeg ?? 1;
    alignmentToleranceDeg = shape === "cluster" ? 6 : Math.max(5, Math.min(10, angularRadiusDeg + 4));
  } else if (path?.kind === "radiant") {
    source = { kind: "sampled", path };
    shape = "radiant";
    angularRadiusDeg = 4;
    alignmentToleranceDeg = 9;
  } else if (path?.kind === "target") {
    source = { kind: "sampled", path };
  }

  if (!source) return null;
  return {
    id: opportunity.id,
    title:
      opportunity.kind === "moon" || opportunity.kind === "lunar-eclipse"
        ? "Moon"
        : (opportunity.shortTitle ?? opportunity.title),
    shape,
    angularRadiusDeg,
    alignmentToleranceDeg,
    source,
    recommendedAtUtc: opportunity.guidance.whenUtc,
    equipment: opportunity.guidance.equipment,
    appearance: opportunity.guidance.appearance,
    observableTonight,
    visualVerification: "not-attempted",
  };
}

/** Nearest sample, used only for an explicitly labelled selected-time preview. */
export function previewPositionForTarget(
  target: SkyFinderTarget,
  observer: { latitudeDeg: number; longitudeDeg: number },
): HorizontalPosition | null {
  return positionForSkyFinderTarget(target, observer, new Date(target.recommendedAtUtc));
}

export function nearestSkyPoint(points: readonly SkyPoint[], at: Date): SkyPoint | null {
  if (points.length === 0) return null;
  return points.reduce((nearest, point) =>
    Math.abs(Date.parse(point.atUtc) - at.getTime()) <
    Math.abs(Date.parse(nearest.atUtc) - at.getTime())
      ? point
      : nearest,
  );
}
