import { describe, expect, it } from "vitest";

import type { Opportunity } from "./opportunity";
import {
  alignmentFor,
  angularSeparation,
  applyCalibration,
  calibrationFromAlignment,
  detectSkyFinderCapabilities,
  pointingFromDeviceOrientation,
  positionForSkyFinderTarget,
  signedAngleDifference,
  skyFinderTargetFor,
  type SkyFinderTarget,
} from "./skyFinder";

describe("Sky Finder pointing math", () => {
  it("converts portrait device orientation into the rear-camera pointing vector", () => {
    const north = pointingFromDeviceOrientation(0, 90, 0, 0);
    const east = pointingFromDeviceOrientation(90, 90, 0, 0);
    const down = pointingFromDeviceOrientation(0, 0, 0, 0);

    expect(north.azimuthDeg).toBeCloseTo(0, 6);
    expect(north.altitudeDeg).toBeCloseTo(0, 6);
    expect(east.azimuthDeg).toBeCloseTo(90, 6);
    expect(east.altitudeDeg).toBeCloseTo(0, 6);
    expect(down.altitudeDeg).toBeCloseTo(-90, 6);
  });

  it("compensates the screen coordinate frame without moving the optical axis", () => {
    const portrait = pointingFromDeviceOrientation(42, 90, 0, 0);
    const landscapeCoordinates = pointingFromDeviceOrientation(42, 90, 0, 90);
    expect(landscapeCoordinates.azimuthDeg).toBeCloseTo(portrait.azimuthDeg, 6);
    expect(landscapeCoordinates.altitudeDeg).toBeCloseTo(portrait.altitudeDeg, 6);
  });

  it("measures real spherical separation and applies a strict quality gate", () => {
    const target = { altitudeDeg: 40, azimuthDeg: 180, atUtc: "2026-09-26T04:00:00Z" };
    expect(angularSeparation({ altitudeDeg: 40, azimuthDeg: 180 }, target)).toBeCloseTo(0, 8);
    expect(angularSeparation({ altitudeDeg: 40, azimuthDeg: 190 }, target)).toBeCloseTo(7.65, 1);
    expect(alignmentFor({ altitudeDeg: 40, azimuthDeg: 181 }, target, 3, "good").aligned).toBe(true);
    expect(alignmentFor({ altitudeDeg: 40, azimuthDeg: 181 }, target, 3, "poor").aligned).toBe(false);
    expect(
      alignmentFor(
        { altitudeDeg: -20, azimuthDeg: 180 },
        { ...target, altitudeDeg: -20 },
        3,
        "good",
      ).aligned,
    ).toBe(false);
  });

  it("derives, applies, and resets a wrap-safe two-axis calibration", () => {
    const calibration = calibrationFromAlignment(
      { altitudeDeg: 28, azimuthDeg: 358 },
      { altitudeDeg: 31, azimuthDeg: 2, atUtc: "2026-09-26T04:00:00Z" },
      "planet-jupiter",
      "2026-09-26T04:00:00Z",
    );
    expect(calibration.azimuthOffsetDeg).toBe(4);
    expect(calibration.altitudeOffsetDeg).toBe(3);
    expect(applyCalibration({ altitudeDeg: 28, azimuthDeg: 358 }, calibration)).toEqual({
      altitudeDeg: 31,
      azimuthDeg: 2,
    });
    expect(applyCalibration({ altitudeDeg: 28, azimuthDeg: 358 }, null)).toEqual({
      altitudeDeg: 28,
      azimuthDeg: 358,
    });
    expect(signedAngleDifference(359, 1)).toBe(2);
  });
});

describe("Sky Finder astronomical target integration", () => {
  const planetOpportunity: Opportunity = {
    id: "planet-jupiter",
    kind: "planet",
    title: "Jupiter",
    persistence: "routine",
    summary: "A bright steady point.",
    qualities: { observability: 1, spectacle: 1, recognisability: 1, ease: 1, confidence: 1, rarity: 0 },
    guidance: {
      appearance: "A bright steady point.",
      whenUtc: "2026-09-26T04:00:00Z",
      durationMinutes: 60,
      direction: "east",
      elevation: "high",
      howLong: "Look now.",
      equipment: "eyes",
      technique: null,
      safety: null,
    },
    phenomenon: "Jupiter is a planet.",
    tonight: "It is up.",
    missingInputs: [],
    limitations: [],
    science: { kind: "planet", body: "Jupiter", event: null },
    profile: [],
    transparency: "low",
  };

  it("recomputes a body when observer location changes", () => {
    const target = skyFinderTargetFor(planetOpportunity, null);
    expect(target).not.toBeNull();
    const at = new Date("2026-09-26T04:00:00Z");
    const portland = positionForSkyFinderTarget(target!, { latitudeDeg: 45.52, longitudeDeg: -122.68 }, at);
    const sydney = positionForSkyFinderTarget(target!, { latitudeDeg: -33.87, longitudeDeg: 151.21 }, at);
    expect(portland).not.toBeNull();
    expect(sydney).not.toBeNull();
    expect(Math.abs(portland!.altitudeDeg - sydney!.altitudeDeg)).toBeGreaterThan(20);
  });

  it("recomputes a body as time advances instead of retaining stale guidance", () => {
    const target = skyFinderTargetFor(planetOpportunity, null)!;
    const observer = { latitudeDeg: 45.52, longitudeDeg: -122.68 };
    const first = positionForSkyFinderTarget(target, observer, new Date("2026-09-26T04:00:00Z"))!;
    const later = positionForSkyFinderTarget(target, observer, new Date("2026-09-26T05:00:00Z"))!;
    expect(Math.abs(signedAngleDifference(first.azimuthDeg, later.azimuthDeg))).toBeGreaterThan(5);
  });

  it("converts a fixed equatorial coordinate to the independently calculated local horizon", () => {
    const target: SkyFinderTarget = {
      id: "reference-star",
      title: "Reference star",
      shape: "point",
      angularRadiusDeg: 0.1,
      alignmentToleranceDeg: 3,
      source: { kind: "equatorial", rightAscensionHours: 22, declinationDeg: 20 },
      recommendedAtUtc: "2026-09-26T04:00:00Z",
      equipment: "eyes",
      appearance: "A reference point.",
      observableTonight: true,
      visualVerification: "not-attempted",
    };
    const position = positionForSkyFinderTarget(
      target,
      { latitudeDeg: 40, longitudeDeg: -75 },
      new Date("2026-09-26T04:00:00Z"),
    );

    // Independent reference: Julian date + the standard GMST polynomial,
    // followed by the spherical hour-angle/declination transform. The values
    // are unrefracted; Astronomy Engine's normal refraction changes this
    // high-altitude result by only 0.007 degrees.
    expect(position?.altitudeDeg).toBeCloseTo(63.685253, 1);
    expect(position?.azimuthDeg).toBeCloseTo(226.407055, 1);
  });

  it("withdraws a sampled moving-target solution outside its propagated interval", () => {
    const target: SkyFinderTarget = {
      id: "moving-target",
      title: "Moving target",
      shape: "point",
      angularRadiusDeg: 0.1,
      alignmentToleranceDeg: 3,
      source: {
        kind: "sampled",
        path: {
          kind: "target",
          points: [
            { atUtc: "2026-09-26T04:00:00Z", altitudeDeg: 20, azimuthDeg: 350, relative: 1 },
            { atUtc: "2026-09-26T04:10:00Z", altitudeDeg: 30, azimuthDeg: 10, relative: 1 },
          ],
          riseUtc: null,
          culminationUtc: null,
          setUtc: null,
          windowStartUtc: null,
          windowEndUtc: null,
        },
      },
      recommendedAtUtc: "2026-09-26T04:05:00Z",
      equipment: "eyes",
      appearance: "A moving point.",
      observableTonight: true,
      visualVerification: "not-attempted",
    };
    const observer = { latitudeDeg: 40, longitudeDeg: -75 };
    expect(positionForSkyFinderTarget(target, observer, new Date("2026-09-26T03:59:59Z"))).toBeNull();
    expect(positionForSkyFinderTarget(target, observer, new Date("2026-09-26T04:10:01Z"))).toBeNull();
    expect(
      positionForSkyFinderTarget(target, observer, new Date("2026-09-26T04:05:00Z"))?.azimuthDeg,
    ).toBeCloseTo(0, 6);
  });

  it("represents Pleiades-like catalogue objects as regions rather than fake points", () => {
    const deepSky: Opportunity = {
      ...planetOpportunity,
      id: "deep-sky-M45",
      kind: "deep-sky",
      title: "Pleiades",
      science: undefined,
      finder: {
        shape: "cluster",
        rightAscensionHours: 3.79,
        declinationDeg: 24.1,
        angularRadiusDeg: 0.9,
      },
    };
    const target = skyFinderTargetFor(deepSky, null)!;
    expect(target.shape).toBe("cluster");
    expect(target.angularRadiusDeg).toBe(0.9);
    expect(target.alignmentToleranceDeg).toBe(6);
  });
});

describe("Sky Finder capability detection", () => {
  it("detects a full secure mobile capability set", () => {
    function Orientation() {}
    Object.assign(Orientation, { requestPermission: () => Promise.resolve("granted") });
    const capabilities = detectSkyFinderCapabilities({
      secureContext: true,
      navigator: { geolocation: {}, mediaDevices: { getUserMedia() {} } },
      window: {
        DeviceOrientationEvent: Orientation,
        DeviceMotionEvent: function Motion() {},
        ondeviceorientationabsolute: null,
        Gyroscope: function Gyroscope() {},
      },
      screen: { orientation: {} },
    });
    expect(capabilities).toMatchObject({
      camera: true,
      geolocation: true,
      orientation: true,
      absoluteOrientation: true,
      motion: true,
      gyroscope: true,
      screenOrientation: true,
      orientationPermissionRequest: true,
    });
  });

  it("keeps a useful sensor fallback when camera is denied or unavailable", () => {
    const capabilities = detectSkyFinderCapabilities({
      secureContext: true,
      navigator: { geolocation: {} },
      window: { DeviceOrientationEvent: function Orientation() {}, ondeviceorientation: null },
      screen: {},
    });
    expect(capabilities.camera).toBe(false);
    expect(capabilities.orientation).toBe(true);
    expect(capabilities.geolocation).toBe(true);
  });

  it("does not advertise protected APIs on an insecure page", () => {
    const capabilities = detectSkyFinderCapabilities({
      secureContext: false,
      navigator: { geolocation: {}, mediaDevices: { getUserMedia() {} } },
      window: {},
      screen: {},
    });
    expect(capabilities.camera).toBe(false);
    expect(capabilities.geolocation).toBe(false);
  });
});
