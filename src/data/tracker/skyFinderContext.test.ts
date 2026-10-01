import { describe, expect, it } from "vitest";

import { positionForSkyFinderTarget, type SkyFinderTarget } from "./skyFinder";
import { expectedSkyContext } from "./skyFinderContext";
import { devicePoseLookingAt, projectEnuDirection } from "../../astronomy/topocentricSky";

const ORION_NEBULA: SkyFinderTarget = {
  id: "deep-sky-orion-nebula",
  title: "Orion Nebula",
  shape: "region",
  angularRadiusDeg: 0.55,
  alignmentToleranceDeg: 5,
  source: { kind: "equatorial", rightAscensionHours: 5.588, declinationDeg: -5.391 },
  recommendedAtUtc: "2026-01-15T05:00:00.000Z",
  equipment: "binoculars",
  appearance: "A pale mist around Orion's sword under a dark sky.",
  observableTonight: true,
  visualVerification: "not-attempted",
};

describe("expected Sky Finder context", () => {
  it("identifies the target's real IAU constellation and projects catalog stars", () => {
    const observer = { latitudeDeg: 34.0522, longitudeDeg: -118.2437 };
    const at = new Date(ORION_NEBULA.recommendedAtUtc);
    const centre = positionForSkyFinderTarget(ORION_NEBULA, observer, at);
    expect(centre).not.toBeNull();

    const nearbyJupiter: SkyFinderTarget = {
      ...ORION_NEBULA,
      id: "jupiter",
      title: "Jupiter",
      shape: "point",
      source: { kind: "equatorial", rightAscensionHours: 5.68, declinationDeg: -4.8 },
    };
    const context = expectedSkyContext(ORION_NEBULA, observer, at, centre!, [nearbyJupiter]);
    expect(context.constellation).toEqual({ symbol: "Ori", name: "Orion" });
    expect(context.stars.length).toBeGreaterThan(5);
    expect(context.stars.some((star) => star.inTargetConstellation)).toBe(true);
    expect(context.lines.some((line) => line.constellation === "Ori" && line.primary)).toBe(true);
    expect(context.labels).toContainEqual(expect.objectContaining({ symbol: "Ori", name: "Orion" }));
    expect(context.objects).toContainEqual(expect.objectContaining({ id: "jupiter", marker: "jupiter" }));
    const pose = devicePoseLookingAt(centre!);
    expect(context.stars.some((star) => projectEnuDirection(star.direction, pose).inField)).toBe(true);
    expect(context.lines.every((line) => line.startStarId > 0 && line.endStarId > 0)).toBe(true);
  });

  it("keeps sampled moving targets honest by omitting an invented constellation", () => {
    const target: SkyFinderTarget = {
      ...ORION_NEBULA,
      id: "iss",
      title: "ISS",
      shape: "point",
      source: {
        kind: "sampled",
        path: {
          kind: "target",
          points: [
            { atUtc: "2026-01-15T05:00:00.000Z", altitudeDeg: 35, azimuthDeg: 120, relative: 0.8 },
            { atUtc: "2026-01-15T05:05:00.000Z", altitudeDeg: 50, azimuthDeg: 180, relative: 1 },
          ],
          riseUtc: null,
          culminationUtc: null,
          setUtc: null,
          windowStartUtc: null,
          windowEndUtc: null,
        },
      },
    };
    const context = expectedSkyContext(
      target,
      { latitudeDeg: 34.0522, longitudeDeg: -118.2437 },
      new Date("2026-01-15T05:02:00.000Z"),
      { altitudeDeg: 44, azimuthDeg: 156 },
    );
    expect(context.constellation).toBeNull();
    expect(context.stars.length).toBeGreaterThan(0);
    expect(context.lines.length).toBeGreaterThan(0);
  });
});
