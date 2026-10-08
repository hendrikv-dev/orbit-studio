import { describe, expect, it } from "vitest";

import type { FinderCapabilities } from "./skyFinder";
import {
  initialSkyNavigationMode,
  selectNonCollidingSkyLabels,
  skyDensityForView,
} from "./skyPresentation";

const handheld: FinderCapabilities = {
  deviceClass: "handheld",
  handheldEligible: true,
  secureContext: true,
  camera: true,
  geolocation: true,
  orientation: true,
  absoluteOrientation: true,
  motion: true,
  gyroscope: true,
  magneticHeading: true,
  screenOrientation: true,
  orientationPermissionRequest: true,
  motionPermissionRequest: true,
};

describe("Sky navigation presentation", () => {
  it("defaults a live orientation-capable handheld to Point independently of camera", () => {
    expect(initialSkyNavigationMode(handheld, true)).toBe("point");
    expect(initialSkyNavigationMode({ ...handheld, camera: false }, true)).toBe("point");
  });

  it("uses Explore when orientation cannot represent a live physical direction", () => {
    expect(initialSkyNavigationMode({ ...handheld, orientation: false }, true)).toBe("explore");
    expect(initialSkyNavigationMode(handheld, false)).toBe("explore");
    expect(initialSkyNavigationMode({ ...handheld, deviceClass: "desktop", handheldEligible: false }, true)).toBe("explore");
  });
});

describe("automatic Sky density", () => {
  it("adds real catalogue depth as the field narrows without category toggles", () => {
    const wide = skyDensityForView({ horizontalFovDeg: 114, selectedConstellation: false });
    const normal = skyDensityForView({ horizontalFovDeg: 82, selectedConstellation: false });
    const close = skyDensityForView({ horizontalFovDeg: 32, selectedConstellation: false });
    expect([wide.tier, normal.tier, close.tier]).toEqual(["wide", "normal", "close"]);
    expect(wide.magnitudeLimit).toBeLessThan(normal.magnitudeLimit);
    expect(normal.magnitudeLimit).toBeLessThan(close.magnitudeLimit);
    expect(wide.maxLabels).toBeLessThan(normal.maxLabels);
    expect(normal.maxLabels).toBeLessThan(close.maxLabels);
  });

  it("shows anchored figure art only when its constellation is selected and legible", () => {
    expect(skyDensityForView({ horizontalFovDeg: 82, selectedConstellation: true }).showSelectedFigure).toBe(true);
    expect(skyDensityForView({ horizontalFovDeg: 82, selectedConstellation: false }).showSelectedFigure).toBe(false);
    expect(skyDensityForView({ horizontalFovDeg: 114, selectedConstellation: true }).showSelectedFigure).toBe(false);
  });

  it("suppresses obvious label collisions while keeping the selected context first", () => {
    const selected = selectNonCollidingSkyLabels([
      { key: "orion", xPercent: 50, yPercent: 50, priority: 100 },
      { key: "rigel", xPercent: 53, yPercent: 52, priority: 20 },
      { key: "sirius", xPercent: 74, yPercent: 62, priority: 30 },
    ], 3);
    expect([...selected]).toEqual(["orion", "sirius"]);
  });
});
