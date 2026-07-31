import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import reference from "./reference/jplHorizonsUsnoReference.json";
import { computeCelestialState } from "./celestialFrames";

const MOON_DIRECTION_TOLERANCE_ARCMIN = 0.15;
const MOON_DISTANCE_TOLERANCE_KM = 60;
const MOON_ILLUMINATION_TOLERANCE = 0.001;
const MOON_PHASE_TOLERANCE_DEG = 0.02;

describe("independently referenced Moon state", () => {
  it.each(reference.moon)("matches JPL DE441 at $timestampUtc", (expected) => {
    const actual = computeCelestialState(expected.timestampUtc);
    const jplDirection = new Vector3(...expected.jplIcrfApparentVectorKm).normalize();
    const directionErrorArcmin =
      actual.moonEqjDirection.angleTo(jplDirection) * 180 / Math.PI * 60;

    expect(directionErrorArcmin).toBeLessThan(MOON_DIRECTION_TOLERANCE_ARCMIN);
    expect(Math.abs(actual.moonDistanceKm - expected.jplDistanceKm)).toBeLessThan(
      MOON_DISTANCE_TOLERANCE_KM,
    );
    expect(
      Math.abs(actual.moonIlluminatedFraction - expected.jplIlluminatedFraction),
    ).toBeLessThan(MOON_ILLUMINATION_TOLERANCE);
    expect(Math.abs(actual.moonPhaseAngleDeg - expected.jplSunTargetObserverAngleDeg)).toBeLessThan(
      MOON_PHASE_TOLERANCE_DEG,
    );
  });

  it("keeps physical distance distinct from display scaling", () => {
    const near = computeCelestialState("2026-07-14T09:43:00.000Z");
    const far = computeCelestialState("2026-07-29T14:36:00.000Z");
    expect(near.moonDistanceKm).toBeLessThan(far.moonDistanceKm);
    expect(near.moonEqjDirection.length()).toBeCloseTo(1, 10);
    expect(far.moonEqjDirection.length()).toBeCloseTo(1, 10);
  });
});
