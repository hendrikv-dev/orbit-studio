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
    ["Uranus", "uranus"],
    ["Neptune", "neptune"],
    ["Pluto", "pluto"],
  ] as const)("gives %s a specific recognizable marker", (body, marker) => {
    expect(skyMarkerKindForTarget(bodyTarget(body))).toBe(marker);
  });

  it("keeps ordinary stars out of the planet icon system", () => {
    expect(skyMarkerKindForTarget({
      ...bodyTarget("Saturn"),
      id: "star-sirius",
      title: "Sirius",
      source: { kind: "equatorial", rightAscensionHours: 6.7525, declinationDeg: -16.7161 },
    })).toBe("star");
  });

  it("does not turn a deep-sky name containing a planet into that planet", () => {
    expect(skyMarkerKindForTarget({
      ...bodyTarget("Saturn"),
      id: "deep-sky-ngc-7009",
      title: "Saturn Nebula",
      shape: "region",
      source: { kind: "equatorial", rightAscensionHours: 21.0679, declinationDeg: -11.3633 },
    })).toBe("nebula");
  });

  it.each([
    ["ISS", "space-station"],
    ["Tiangong", "tiangong"],
    ["Starlink train", "starlink-train"],
  ] as const)("distinguishes %s from an ordinary satellite", (title, marker) => {
    expect(skyMarkerKindForTarget({
      ...bodyTarget("Saturn"),
      id: title.toLowerCase().replaceAll(" ", "-"),
      title,
      source: {
        kind: "sampled",
        path: { kind: "target", points: [], riseUtc: null, culminationUtc: null, setUtc: null, windowStartUtc: null, windowEndUtc: null },
      },
    })).toBe(marker);
  });

  it("uses a quiet region marker for a selected constellation", () => {
    expect(skyMarkerKindForTarget({
      ...bodyTarget("Saturn"),
      id: "constellation-ori",
      title: "Orion",
      shape: "region",
      source: { kind: "equatorial", rightAscensionHours: 5.58, declinationDeg: 4.5 },
    })).toBe("constellation");
  });
});
