import { describe, expect, it } from "vitest";

import { milkyWayCelestialCoordinate } from "./CelestialMilkyWay";

describe("NASA SVS Milky Way celestial texture coordinates", () => {
  it("maps the plate centre to 0h RA and preserves north-up declination", () => {
    const centre = milkyWayCelestialCoordinate(35.5, 17.5, 72, 36);
    expect(centre.raHours).toBeCloseTo(0, 8);
    expect(centre.decDeg).toBeCloseTo(0, 8);
  });

  it("increases right ascension to the left as documented by NASA SVS", () => {
    const left = milkyWayCelestialCoordinate(17.5, 17.5, 72, 36);
    const right = milkyWayCelestialCoordinate(53.5, 17.5, 72, 36);
    expect(left.raHours).toBeCloseTo(6, 8);
    expect(right.raHours).toBeCloseTo(18, 8);
  });
});
