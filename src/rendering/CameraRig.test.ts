import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { shouldFrameSelectedOrbit } from "./CameraRig";
import type { SelectedOrbitFrame } from "./selectedOrbitFrame";

const state = {
  cameraPosition: new Vector3(10000, 5000, 10000),
  controlsTarget: new Vector3(),
  preserveCameraOnOrbitEdit: true,
  initialized: true,
  orbitDistance: 100000,
  orbitFrame: { satelliteId: "edited", target: new Vector3(20000, 0, 0), framingRadiusKm: 40000 } as SelectedOrbitFrame,
  previousSatelliteId: "edited",
  previousViewportMode: "normal" as const,
  previousViewportSizeKey: "desktop",
  viewportMode: "normal" as const,
  viewportSizeKey: "desktop",
};

describe("Playground edit framing", () => {
  it("preserves the camera through changed orbital bounds and target drift", () => {
    expect(shouldFrameSelectedOrbit(state)).toBe(false);
    expect(shouldFrameSelectedOrbit({ ...state, preserveCameraOnOrbitEdit: false })).toBe(true);
  });
  it("still frames initial selection, a new object and changed viewport", () => {
    expect(shouldFrameSelectedOrbit({ ...state, initialized: false })).toBe(true);
    expect(shouldFrameSelectedOrbit({ ...state, previousSatelliteId: "other" })).toBe(true);
    expect(shouldFrameSelectedOrbit({ ...state, viewportMode: "focus" })).toBe(true);
    expect(shouldFrameSelectedOrbit({ ...state, viewportSizeKey: "390x844" })).toBe(true);
  });
});
