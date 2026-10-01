import { describe, expect, it } from "vitest";

import {
  DevicePoseStabilizer,
  devicePoseFromOrientation,
  devicePoseLookingAt,
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
  });
});
