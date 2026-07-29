import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import reference from "../astronomy/reference/jplHorizonsUsnoReference.json";
import { computeCelestialState } from "../astronomy/celestialFrames";
import { latLonToThreeVector } from "./coordinates";
import {
  earthLightingWeightsForSolarDot,
  earthReadableSurfaceScaleForSolarDot,
  oceanSpecularMaskFromRgb,
} from "./earthFidelity";

const SUN_DIRECTION_TOLERANCE_ARCMIN = 1;
const SUBSOLAR_TOLERANCE_DEG = 0.02;
const GAST_TOLERANCE_SECONDS = 0.02;

function angleArcminutes(left: Vector3, right: Vector3): number {
  return left.angleTo(right) * 180 / Math.PI * 60;
}

function longitudeErrorDegrees(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180);
}

describe("independently referenced Earth/Sun fidelity", () => {
  it.each(reference.earthSun)(
    "matches JPL DE441 and USNO at $timestampUtc",
    (expected) => {
      const actual = computeCelestialState(expected.timestampUtc);
      const jplDirection = new Vector3(...expected.jplIcrfApparentVectorKm).normalize();
      const gastErrorSeconds =
        Math.abs(actual.greenwichApparentSiderealTimeDeg - expected.usno.gastDeg) * 240;

      expect(angleArcminutes(actual.sunEqjDirection, jplDirection)).toBeLessThan(
        SUN_DIRECTION_TOLERANCE_ARCMIN,
      );
      expect(Math.abs(actual.subsolarLatitudeDeg - expected.subsolarLatitudeDeg)).toBeLessThan(
        SUBSOLAR_TOLERANCE_DEG,
      );
      expect(
        longitudeErrorDegrees(actual.subsolarLongitudeDeg, expected.subsolarLongitudeDeg),
      ).toBeLessThan(SUBSOLAR_TOLERANCE_DEG);
      expect(gastErrorSeconds).toBeLessThan(GAST_TOLERANCE_SECONDS);

      const referenceSubsolarNormal = latLonToThreeVector(
        {
          latitudeDeg: expected.subsolarLatitudeDeg,
          longitudeDeg: expected.subsolarLongitudeDeg,
        },
        1,
      ).applyQuaternion(actual.earthFixedToSceneQuaternion);
      expect(referenceSubsolarNormal.dot(actual.sunSceneDirection)).toBeGreaterThan(0.999_999);
    },
  );

  it("moves the terminator westward as UTC advances", () => {
    const longitudes = [0, 6, 12, 18, 24].map((hours) =>
      computeCelestialState(
        Date.parse("2026-03-20T00:00:00.000Z") + hours * 3_600_000,
      ).subsolarLongitudeDeg,
    );

    for (let index = 1; index < longitudes.length; index += 1) {
      const westwardDelta = ((longitudes[index] - longitudes[index - 1] + 540) % 360) - 180;
      expect(westwardDelta).toBeLessThan(-80);
      expect(westwardDelta).toBeGreaterThan(-100);
    }
  });

  it("rejects invalid and out-of-range physical timestamps", () => {
    expect(() => computeCelestialState("not-a-date")).toThrow(RangeError);
    expect(() => computeCelestialState("1500-01-01T00:00:00.000Z")).toThrow(RangeError);
  });
});

describe("Earth lighting presentation helpers", () => {
  it("separates day, twilight, and night from solar incidence", () => {
    const day = earthLightingWeightsForSolarDot(1);
    const terminator = earthLightingWeightsForSolarDot(0);
    const night = earthLightingWeightsForSolarDot(-1);

    expect(day.daylight).toBeGreaterThan(0.99);
    expect(day.night).toBeLessThan(0.01);
    expect(terminator.twilight).toBeGreaterThan(0.3);
    expect(night.night).toBeGreaterThan(0.99);
    expect(night.daylight).toBeLessThan(0.01);
  });

  it("keeps Earth surface lighting finite and readable", () => {
    const dayScale = earthReadableSurfaceScaleForSolarDot(1);
    const terminatorScale = earthReadableSurfaceScaleForSolarDot(0);
    const nightScale = earthReadableSurfaceScaleForSolarDot(-1);

    expect(dayScale).toBeGreaterThan(1);
    expect(terminatorScale).toBeGreaterThan(nightScale);
    expect(nightScale).toBeGreaterThan(0.06);
    expect(nightScale).toBeLessThan(0.12);
  });

  it("limits ocean specular response to blue-dominant surfaces", () => {
    expect(oceanSpecularMaskFromRgb(0.05, 0.16, 0.42)).toBeGreaterThan(0.7);
    expect(oceanSpecularMaskFromRgb(0.38, 0.31, 0.18)).toBeLessThan(0.05);
    expect(oceanSpecularMaskFromRgb(0.9, 0.9, 0.88)).toBeLessThan(0.05);
  });
});
