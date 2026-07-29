import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "./constants";
import { computeGroundContact } from "./coverage";
import type { CartesianState } from "./types";

describe("ground station coverage", () => {
  it("detects overhead line-of-sight contact", () => {
    const date = new Date("2026-06-01T00:00:00.000Z");
    const state: CartesianState = {
      positionKm: [EARTH_RADIUS_KM + 500, 0, 0],
      velocityKmS: [0, 7.6, 0],
      epoch: date.toISOString(),
    };

    const contact = computeGroundContact(
      state,
      {
        latitudeDeg: 0,
        longitudeDeg: 110.506388282869,
        altitudeMeters: 0,
        minimumElevationDeg: 5,
      },
      date,
    );

    expect(contact.elevationDeg).toBeGreaterThan(80);
    expect(contact.rangeKm).toBeGreaterThan(490);
    expect(contact.inContact).toBe(true);
  });

  it("rejects contact below minimum elevation", () => {
    const date = new Date("2026-06-01T00:00:00.000Z");
    const state: CartesianState = {
      positionKm: [0, EARTH_RADIUS_KM + 500, 0],
      velocityKmS: [-7.6, 0, 0],
      epoch: date.toISOString(),
    };

    const contact = computeGroundContact(
      state,
      {
        latitudeDeg: 0,
        longitudeDeg: 110.506388282869,
        altitudeMeters: 0,
        minimumElevationDeg: 10,
      },
      date,
    );

    expect(contact.elevationDeg).toBeLessThan(10);
    expect(contact.inContact).toBe(false);
  });
});
