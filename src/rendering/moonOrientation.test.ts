import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import {
  MOON_NEAR_SIDE_MODEL_DIRECTION,
  writeTidallyLockedMoonQuaternion,
} from "./moonOrientation";

describe("tidally locked Moon orientation", () => {
  it("keeps the texture near-side direction facing Earth throughout the orbit", () => {
    [
      new Vector3(1, 0, 0),
      new Vector3(0, 0.4, 1),
      new Vector3(-0.8, -0.2, 0.5),
      new Vector3(0.2, 0.1, -1),
    ].forEach((moonPosition) => {
      const quaternion = writeTidallyLockedMoonQuaternion(new Quaternion(), moonPosition);
      const nearSideWorld = MOON_NEAR_SIDE_MODEL_DIRECTION.clone().applyQuaternion(quaternion);
      const moonToEarth = moonPosition.clone().negate().normalize();
      expect(nearSideWorld.dot(moonToEarth)).toBeGreaterThan(0.999999);
    });
  });

  it("leaves lunar phase to Sun incidence instead of changing orientation", () => {
    const moonPosition = new Vector3(1, 0, 0);
    const quaternion = writeTidallyLockedMoonQuaternion(new Quaternion(), moonPosition);
    const nearSideWorld = MOON_NEAR_SIDE_MODEL_DIRECTION.clone().applyQuaternion(quaternion);

    expect(nearSideWorld.dot(new Vector3(-1, 0, 0))).toBeCloseTo(1, 8);
    expect(nearSideWorld.dot(new Vector3(1, 0, 0))).toBeCloseTo(-1, 8);
  });
});
