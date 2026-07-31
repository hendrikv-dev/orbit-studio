import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "./constants";
import {
  altitudeKm,
  cartesianToKeplerian,
  keplerianToCartesian,
  orbitalPeriodSeconds,
  propagateTwoBody,
} from "./kepler";
import type { KeplerianElements } from "./types";

const baseElements: KeplerianElements = {
  semiMajorAxisKm: EARTH_RADIUS_KM + 500,
  eccentricity: 0.002,
  inclinationDeg: 53,
  raanDeg: 27,
  argumentOfPeriapsisDeg: 71,
  trueAnomalyDeg: 144,
  epoch: "2026-06-01T12:00:00.000Z",
};

describe("Keplerian propagation", () => {
  it("round-trips classical elements through Cartesian state", () => {
    const state = keplerianToCartesian(baseElements);
    const reconstructed = cartesianToKeplerian(state);

    expect(reconstructed.semiMajorAxisKm).toBeCloseTo(baseElements.semiMajorAxisKm, 6);
    expect(reconstructed.eccentricity).toBeCloseTo(baseElements.eccentricity, 8);
    expect(reconstructed.inclinationDeg).toBeCloseTo(baseElements.inclinationDeg, 6);
    expect(reconstructed.raanDeg).toBeCloseTo(baseElements.raanDeg, 6);
    expect(reconstructed.argumentOfPeriapsisDeg).toBeCloseTo(
      baseElements.argumentOfPeriapsisDeg,
      6,
    );
  });

  it("keeps a near circular LEO altitude positive after propagation", () => {
    const propagated = propagateTwoBody(baseElements, new Date("2026-06-01T13:00:00.000Z"));

    expect(altitudeKm(propagated)).toBeGreaterThan(470);
    expect(altitudeKm(propagated)).toBeLessThan(530);
  });

  it("computes an orbital period in the expected LEO range", () => {
    const periodMinutes = orbitalPeriodSeconds(baseElements.semiMajorAxisKm) / 60;

    expect(periodMinutes).toBeGreaterThan(90);
    expect(periodMinutes).toBeLessThan(100);
  });
});
