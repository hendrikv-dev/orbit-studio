import { describe, expect, it } from "vitest";

import type { SkyFinderTarget } from "./skyFinder";
import { skyMarkerKindForTarget } from "./skyMarker";

function bodyTarget(title: string): SkyFinderTarget {
  return {
    id: `body-${title.toLowerCase()}`,
    title,
    shape: "point",
    angularRadiusDeg: 0.2,
    alignmentToleranceDeg: 3,
    source: { kind: "body", body: title },
    recommendedAtUtc: "2026-10-04T04:00:00Z",
    equipment: "eyes",
    appearance: "Reference target.",
    observableTonight: true,
    visualVerification: "not-attempted",
  };
}

describe("Sky noteworthy-object marker classification", () => {
  it.each([
    ["Sun", "sun"],
    ["Moon", "moon"],
    ["Mercury", "mercury"],
    ["Venus", "venus"],
    ["Mars", "mars"],
    ["Jupiter", "jupiter"],
    ["Saturn", "saturn"],
  ] as const)("gives %s a specific recognizable marker", (body, marker) => {
    expect(skyMarkerKindForTarget(bodyTarget(body))).toBe(marker);
  });

  it("keeps ordinary stars out of the planet icon system", () => {
    expect(skyMarkerKindForTarget({
      ...bodyTarget("Saturn"),
      id: "star-sirius",
      title: "Sirius",
      source: { kind: "equatorial", rightAscensionHours: 6.7525, declinationDeg: -16.7161 },
    })).toBe("deep-sky");
  });

  it("does not turn a deep-sky name containing a planet into that planet", () => {
    expect(skyMarkerKindForTarget({
      ...bodyTarget("Saturn"),
      id: "deep-sky-ngc-7009",
      title: "Saturn Nebula",
      shape: "region",
      source: { kind: "equatorial", rightAscensionHours: 21.0679, declinationDeg: -11.3633 },
    })).toBe("deep-sky");
  });
});
