import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  cartesianToKeplerian,
  ecefToGeodetic,
  eciToEcef,
  keplerianToCartesian,
  orbitalPeriodSeconds,
  sampleGroundTrack,
  validateKeplerian
} from "../physics/orbit";
import { createSampleSatellite } from "../scenario/defaultScenario";

describe("orbit physics", () => {
  it("round-trips keplerian and cartesian state vectors", () => {
    const elements = {
      semiMajorAxis: 7200,
      eccentricity: 0.01,
      inclination: 53,
      raan: 120,
      argumentOfPeriapsis: 87,
      trueAnomaly: 44,
      epoch: "2026-01-01T00:00:00.000Z"
    };

    const state = keplerianToCartesian(elements);
    const roundTrip = cartesianToKeplerian(state);

    expect(roundTrip.semiMajorAxis).toBeCloseTo(elements.semiMajorAxis, 5);
    expect(roundTrip.eccentricity).toBeCloseTo(elements.eccentricity, 5);
    expect(roundTrip.inclination).toBeCloseTo(elements.inclination, 5);
  });

  it("computes orbital period for an elliptical Earth orbit", () => {
    const period = orbitalPeriodSeconds({
      semiMajorAxis: 7000,
      eccentricity: 0.001,
      inclination: 28.5,
      raan: 0,
      argumentOfPeriapsis: 0,
      trueAnomaly: 0,
      epoch: "2026-01-01T00:00:00.000Z"
    });

    expect(period).toBeGreaterThan(5800);
    expect(period).toBeLessThan(5900);
  });

  it("converts ECI to geodetic coordinates with finite altitude", () => {
    const geodetic = ecefToGeodetic(eciToEcef([EARTH_RADIUS_KM + 500, 0, 0], "2026-01-01T00:00:00.000Z"));

    expect(Number.isFinite(geodetic.latitude)).toBe(true);
    expect(Number.isFinite(geodetic.longitude)).toBe(true);
    expect(geodetic.altitude).toBeCloseTo(500, 6);
  });

  it("samples finite ground-track points", () => {
    const satellite = createSampleSatellite("test-sat");
    const samples = sampleGroundTrack(satellite, "2026-01-01T00:00:00.000Z", 8);

    expect(samples).toHaveLength(9);
    expect(samples.every((sample) => Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude))).toBe(true);
  });

  it("validates unsupported hyperbolic input in the MVP", () => {
    const errors = validateKeplerian({
      semiMajorAxis: 8000,
      eccentricity: 1.2,
      inclination: 25,
      raan: 0,
      argumentOfPeriapsis: 0,
      trueAnomaly: 0,
      epoch: "2026-01-01T00:00:00.000Z"
    });

    expect(errors).toContain("Eccentricity must be from 0 to less than 1 for the two-body MVP.");
  });
});
