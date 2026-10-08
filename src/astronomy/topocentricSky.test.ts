import { describe, expect, it } from "vitest";

import {
  calibratedDevicePose,
  DevicePoseStabilizer,
  devicePoseFromOrientation,
  devicePoseFromOrientationWithHeading,
  devicePoseLookingAt,
  effectiveCameraProjection,
  horizontalToEnu,
  pointingFromDevicePose,
  projectEnuDirection,
} from "./topocentricSky";

describe("authoritative topocentric Sky projection", () => {
  it("keeps a celestial target stationary while stationary pose noise stays inside the deadband", () => {
    const target = horizontalToEnu({ azimuthDeg: 125, altitudeDeg: 38 });
    const stabilizer = new DevicePoseStabilizer(85, 0.18);
    const firstPose = stabilizer.update(devicePoseLookingAt({ azimuthDeg: 125, altitudeDeg: 38 }), 0);
    const first = projectEnuDirection(target, firstPose);
    let latest = first;
    for (let index = 1; index <= 20; index += 1) {
      const jitter = index % 2 === 0 ? 0.06 : -0.06;
      const pose = stabilizer.update(
        devicePoseLookingAt({ azimuthDeg: 125 + jitter, altitudeDeg: 38 - jitter }),
        index * 16,
      );
      latest = projectEnuDirection(target, pose);
    }
    expect(Math.abs(latest.xPercent - first.xPercent)).toBeLessThan(0.08);
    expect(Math.abs(latest.yPercent - first.yPercent)).toBeLessThan(0.08);
  });

  it("moves a target and neighboring star coherently when the camera rotates", () => {
    const target = horizontalToEnu({ azimuthDeg: 100, altitudeDeg: 30 });
    const neighbor = horizontalToEnu({ azimuthDeg: 103, altitudeDeg: 31 });
    const firstPose = devicePoseLookingAt({ azimuthDeg: 100, altitudeDeg: 30 });
    const secondPose = devicePoseLookingAt({ azimuthDeg: 94, altitudeDeg: 30 });
    const firstTarget = projectEnuDirection(target, firstPose);
    const firstNeighbor = projectEnuDirection(neighbor, firstPose);
    const secondTarget = projectEnuDirection(target, secondPose);
    const secondNeighbor = projectEnuDirection(neighbor, secondPose);
    const targetMove = secondTarget.xPercent - firstTarget.xPercent;
    const neighborMove = secondNeighbor.xPercent - firstNeighbor.xPercent;
    expect(targetMove).toBeGreaterThan(5);
    expect(Math.abs(targetMove - neighborMove)).toBeLessThan(0.8);
  });

  it("applies portrait/landscape screen orientation exactly once to the camera frame", () => {
    const portrait = devicePoseFromOrientation(42, 90, 0, 0);
    const landscape = devicePoseFromOrientation(42, 90, 0, 90);
    const portraitPointing = pointingFromDevicePose(portrait);
    const landscapePointing = pointingFromDevicePose(landscape);
    expect(landscapePointing.azimuthDeg).toBeCloseTo(portraitPointing.azimuthDeg, 8);
    expect(landscapePointing.altitudeDeg).toBeCloseTo(portraitPointing.altitudeDeg, 8);
    const offAxis = horizontalToEnu({ azimuthDeg: 47, altitudeDeg: 4 });
    const portraitProjection = projectEnuDirection(offAxis, portrait);
    const landscapeProjection = projectEnuDirection(offAxis, landscape);
    expect(portraitProjection.xPercent).not.toBeCloseTo(landscapeProjection.xPercent, 2);
    expect(portraitProjection.yPercent).not.toBeCloseTo(landscapeProjection.yPercent, 2);

    // Screen Orientation defines +90° counter-clockwise from the natural
    // portrait frame. A direction toward the device's natural top therefore
    // moves from screen-up in portrait to screen-right in landscape-primary.
    const portraitDown = devicePoseFromOrientation(0, 0, 0, 0);
    const landscapeDown = devicePoseFromOrientation(0, 0, 0, 90);
    const naturalTop = horizontalToEnu({ azimuthDeg: 0, altitudeDeg: -80 });
    const portraitTop = projectEnuDirection(naturalTop, portraitDown);
    const landscapeRight = projectEnuDirection(naturalTop, landscapeDown);
    expect(portraitTop.xPercent).toBeCloseTo(50, 8);
    expect(portraitTop.yPercent).toBeLessThan(50);
    expect(landscapeRight.xPercent).toBeGreaterThan(50);
    expect(landscapeRight.yPercent).toBeCloseTo(50, 8);
  });

  it("follows the W3C alpha sense and anchors Safari's magnetic heading before quaternion construction", () => {
    // W3C's worked example gives heading = -alpha for beta=90, gamma=0.
    const absoluteWest = pointingFromDevicePose(devicePoseFromOrientation(90, 90, 0, 0));
    expect(absoluteWest.azimuthDeg).toBeCloseTo(270, 8);
    expect(absoluteWest.altitudeDeg).toBeCloseTo(0, 8);

    // Safari alpha is arbitrary. A 90° magnetic heading is alpha=270° in the
    // W3C earth frame, and must point the rear camera east rather than forcing
    // an already tilted optical axis to a second heading.
    const safariEast = pointingFromDevicePose(
      devicePoseFromOrientationWithHeading(17, 90, 0, 0, 90),
    );
    expect(safariEast.azimuthDeg).toBeCloseTo(90, 8);
    expect(safariEast.altitudeDeg).toBeCloseTo(0, 8);
  });

  it("applies a reference calibration to the complete camera pose", () => {
    const reported = devicePoseLookingAt({ azimuthDeg: 118, altitudeDeg: 27 });
    const calibrated = calibratedDevicePose(reported, {
      azimuthOffsetDeg: 5,
      altitudeOffsetDeg: 4,
    });
    const pointing = pointingFromDevicePose(calibrated);
    expect(pointing.azimuthDeg).toBeCloseTo(123, 8);
    expect(pointing.altitudeDeg).toBeCloseTo(31, 8);
  });

  it("projects camera center and off-axis vectors into the expected screen quadrants", () => {
    const pose = devicePoseLookingAt({ azimuthDeg: 180, altitudeDeg: 30 });
    const center = projectEnuDirection(horizontalToEnu({ azimuthDeg: 180, altitudeDeg: 30 }), pose);
    const right = projectEnuDirection(horizontalToEnu({ azimuthDeg: 190, altitudeDeg: 30 }), pose);
    const up = projectEnuDirection(horizontalToEnu({ azimuthDeg: 180, altitudeDeg: 38 }), pose);
    expect(center.inField).toBe(true);
    expect(center.xPercent).toBeCloseTo(50, 10);
    expect(center.yPercent).toBeCloseTo(50, 10);
    expect(right.xPercent).toBeGreaterThan(50);
    expect(up.yPercent).toBeLessThan(50);
  });

  it("matches a center-cropped camera preview instead of projecting against hidden video pixels", () => {
    const effective = effectiveCameraProjection({
      horizontalFovDeg: 82,
      verticalFovDeg: 66,
      sourceWidthPx: 1920,
      sourceHeightPx: 1080,
      viewportWidthPx: 390,
      viewportHeightPx: 700,
      fit: "cover",
    });
    expect(effective.cropAxis).toBe("horizontal");
    expect(effective.visibleFraction).toBeCloseTo((390 / 700) / (1920 / 1080), 8);
    expect(effective.horizontalFovDeg).toBeLessThan(35);
    expect(effective.verticalFovDeg).toBe(66);
  });
});
