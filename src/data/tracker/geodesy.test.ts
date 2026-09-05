import { describe, expect, it } from "vitest";
import { destination, distanceM } from "./geodesy";

describe("geodesy", () => {
  /**
   * Checked against published worked examples rather than against itself.
   *
   * The figures are from Chris Veness's standard implementations of the direct
   * and inverse spherical problems, which are the reference every navigation
   * text agrees with to the precision quoted.
   */
  it("solves the direct problem", () => {
    // 53.3206°N 1.7297°W, 124.8 km on a bearing of 96.02° → 53.1883°N 0.1333°E
    const there = destination(53.3206, -1.7297, 124_800, 96.021_9);
    expect(there.latitudeDeg).toBeCloseTo(53.1883, 3);
    expect(there.longitudeDeg).toBeCloseTo(0.1333, 3);
  });

  it("solves the inverse problem", () => {
    // 50.0663°N 5.7147°W to 58.6440°N 3.0700°W is 968.9 km.
    expect(distanceM(50.066_39, -5.714_72, 58.644_0, -3.070_0) / 1000).toBeCloseTo(968.9, 0);
  });

  it("agrees with itself in both directions", () => {
    for (const bearing of [0, 45, 137, 250, 359]) {
      for (const metres of [500, 25_000, 180_000]) {
        const there = destination(45.5, -122.7, metres, bearing);
        expect(distanceM(45.5, -122.7, there.latitudeDeg, there.longitudeDeg)).toBeCloseTo(
          metres,
          -1,
        );
      }
    }
  });

  it("wraps a bearing that crosses the antimeridian", () => {
    const there = destination(0, 179.9, 40_000, 90);
    expect(there.longitudeDeg).toBeLessThan(0);
    expect(there.longitudeDeg).toBeGreaterThan(-180);
    // And the distance is still 40 km, not most of the way round the world.
    expect(distanceM(0, 179.9, there.latitudeDeg, there.longitudeDeg)).toBeCloseTo(40_000, -1);
  });

  it("goes over the pole without producing nonsense", () => {
    const there = destination(89, 0, 300_000, 0);
    expect(there.latitudeDeg).toBeLessThanOrEqual(90);
    expect(Math.abs(there.longitudeDeg)).toBeLessThanOrEqual(180);
  });
});
