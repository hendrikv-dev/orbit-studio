import { describe, expect, it } from "vitest";
import {
  ORBIT_ELEMENT_SLIDERS,
  cameraPositionToleranceKm,
  cameraQuaternionTolerance,
  orbitEditCameraValidation,
  playgroundReviewScenario,
} from "./playground.mjs";

/** A settled rig, published by the product's own review observer. */
function rigState(overrides = {}) {
  return {
    position: [12_345.6, -8_901.2, 4_567.8],
    quaternion: [0.1, 0.2, 0.3, 0.9],
    target: [0, 0, 0],
    mode: "free",
    follow: false,
    satelliteId: "satellite-1",
    elements: { altitudeKm: 500, raanDeg: 90 },
    ...overrides,
  };
}

describe("Playground orbit-edit camera validation", () => {
  it("accepts an edit that changed the orbit and left the camera where it was", () => {
    const before = rigState();
    const after = rigState({ elements: { altitudeKm: 500, raanDeg: 205 } });
    expect(orbitEditCameraValidation(before, after, "RAAN")).toMatchObject({
      pass: true,
      failures: [],
    });
  });

  it("detects a re-framing move of the camera during an edit", () => {
    const before = rigState();
    // Thousands of kilometres: a re-frame, not floating-point noise.
    const after = rigState({
      position: [before.position[0] + 4_200, before.position[1], before.position[2]],
      elements: { altitudeKm: 500, raanDeg: 205 },
    });
    const result = orbitEditCameraValidation(before, after, "RAAN");
    expect(result.failures).toContain("RAAN:camera-position-moved");
    expect(result.pass).toBe(false);
  });

  it("detects a camera that rotated or retargeted during an edit", () => {
    const before = rigState();
    const rotated = rigState({
      quaternion: [0.2, 0.2, 0.3, 0.9],
      elements: { altitudeKm: 500, raanDeg: 205 },
    });
    const retargeted = rigState({
      target: [100, 0, 0],
      elements: { altitudeKm: 500, raanDeg: 205 },
    });
    expect(orbitEditCameraValidation(before, rotated, "Inclination").failures)
      .toContain("Inclination:camera-orientation-moved");
    expect(orbitEditCameraValidation(before, retargeted, "Inclination").failures)
      .toContain("Inclination:camera-target-moved");
  });

  it("detects an edit that did not reach the orbit", () => {
    const state = rigState();
    expect(orbitEditCameraValidation(state, state, "Eccentricity").failures)
      .toContain("Eccentricity:element-did-not-change");
  });

  it("tolerates settled-rig noise far below a real re-framing move", () => {
    const before = rigState();
    const after = rigState({
      position: before.position.map((value) => value + cameraPositionToleranceKm * 0.1),
      elements: { altitudeKm: 500, raanDeg: 205 },
    });
    expect(orbitEditCameraValidation(before, after, "RAAN").pass).toBe(true);
    expect(cameraPositionToleranceKm).toBeLessThan(1);
    expect(cameraQuaternionTolerance).toBeLessThan(1e-4);
  });

  it("demands camera state before an edit can be judged", () => {
    expect(orbitEditCameraValidation(null, rigState(), "RAAN").failures)
      .toContain("RAAN:camera-state-missing-before");
    expect(orbitEditCameraValidation(rigState(), null, "RAAN").failures)
      .toContain("RAAN:camera-state-missing");
  });
});

describe("Playground review scenario", () => {
  it("edits every orbital-element slider the product offers", () => {
    // The reported fault was RAAN; the regression follows it with the rest.
    expect(ORBIT_ELEMENT_SLIDERS).toEqual(
      expect.arrayContaining(["RAAN", "Inclination", "Altitude", "Eccentricity"]),
    );
  });

  it("observes the renderer's own published rig state", () => {
    expect(playgroundReviewScenario.reviewUrl).toContain("review=1");
    expect(playgroundReviewScenario.requiresReviewBridge).toBe(false);
  });

  it("declares that its states certify no current-catalog identity", () => {
    expect(playgroundReviewScenario.catalogAuthority).toBe("none");
  });
});
