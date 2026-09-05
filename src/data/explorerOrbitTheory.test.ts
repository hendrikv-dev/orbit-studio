import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { currentExplorerSnapshot, explorerSnapshotView } from "./explorerCatalog";
import type { ExplorerCatalogEntry } from "./explorerCatalog";
import { explorerPopulationPoints } from "./explorerPopulation";
import {
  altitudeForPeriodKm,
  CRITICAL_INCLINATION_DEG,
  explorerOrbitTheoryCurves,
  geostationaryAltitudeKm,
  nodalPrecessionDegPerDay,
  semiSynchronousAltitudeKm,
  sunSynchronousInclinationDeg,
  SIDEREAL_DAY_SECONDS,
} from "./explorerOrbitTheory";

const catalogPoints = () => {
  const view = explorerSnapshotView(currentExplorerSnapshot);
  return explorerPopulationPoints(
    view.records.filter((record): record is ExplorerCatalogEntry =>
      Boolean((record as ExplorerCatalogEntry).orbit)),
  );
};

describe("analytic orbit relationships", () => {
  it("reproduces the published sun-synchronous inclinations", () => {
    // Standard textbook values for circular sun-synchronous orbits.
    expect(sunSynchronousInclinationDeg(EARTH_RADIUS_KM + 400)).toBeCloseTo(97.03, 1);
    expect(sunSynchronousInclinationDeg(EARTH_RADIUS_KM + 800)).toBeCloseTo(98.60, 1);
    expect(sunSynchronousInclinationDeg(EARTH_RADIUS_KM + 1200)).toBeCloseTo(100.42, 1);
  });

  it("returns null where no inclination can precess fast enough", () => {
    expect(sunSynchronousInclinationDeg(EARTH_RADIUS_KM + 20000)).toBeNull();
    expect(sunSynchronousInclinationDeg(EARTH_RADIUS_KM - 100)).toBeNull();
    expect(sunSynchronousInclinationDeg(EARTH_RADIUS_KM + 700, 1.4)).toBeNull();
  });

  it("precesses a sun-synchronous plane one full turn per year", () => {
    const altitude = 800;
    const inclination = sunSynchronousInclinationDeg(EARTH_RADIUS_KM + altitude)!;
    const rate = nodalPrecessionDegPerDay(EARTH_RADIUS_KM + altitude, 0, inclination);
    // 360 degrees over a tropical year.
    expect(rate).toBeCloseTo(360 / 365.2422, 3);
  });

  it("puts the synchronous altitudes where the period condition requires", () => {
    expect(geostationaryAltitudeKm()).toBeCloseTo(35786, 0);
    expect(semiSynchronousAltitudeKm()).toBeCloseTo(20184, 0);
    expect(altitudeForPeriodKm(SIDEREAL_DAY_SECONDS)).toBeCloseTo(geostationaryAltitudeKm(), 6);
  });

  it("describes every curve it exposes", () => {
    for (const curve of explorerOrbitTheoryCurves) {
      expect(curve.label.length).toBeGreaterThan(0);
      expect(curve.explanation.length).toBeGreaterThan(20);
      if (curve.kind === "inclination-of-altitude") expect(curve.inclinationAt).toBeTypeOf("function");
      if (curve.kind === "constant-inclination") expect(curve.inclinationDeg).toBeGreaterThan(0);
      if (curve.kind === "constant-altitude") expect(curve.altitudeKm).toBeGreaterThan(0);
    }
  });

  // The point of the overlay: the closed-form curve and the measured population
  // agree. If a catalog rebuild ever breaks that, the overlay is misleading and
  // this test should fail rather than the claim quietly becoming false.
  it("matches the real sun-synchronous population within a fraction of a degree", () => {
    const band = catalogPoints().filter(
      (point) =>
        point.semiMajorAltitudeKm >= 600 &&
        point.semiMajorAltitudeKm <= 1400 &&
        point.inclinationDeg >= 95 &&
        point.inclinationDeg <= 104,
    );
    expect(band.length).toBeGreaterThan(1000);

    const onCurve = band.filter((point) => {
      const predicted = sunSynchronousInclinationDeg(
        EARTH_RADIUS_KM + point.semiMajorAltitudeKm,
        point.eccentricity,
      );
      return predicted !== null && Math.abs(predicted - point.inclinationDeg) < 0.6;
    });

    expect(onCurve.length / band.length).toBeGreaterThan(0.7);
  });

  it("finds the Molniya family sitting on the critical inclination", () => {
    const eccentric = catalogPoints().filter((point) => point.eccentricity > 0.5);
    expect(eccentric.length).toBeGreaterThan(500);
    const frozen = eccentric.filter(
      (point) => Math.abs(point.inclinationDeg - CRITICAL_INCLINATION_DEG) < 2,
    );
    // A fifth of all highly eccentric objects cluster on a single inclination.
    expect(frozen.length / eccentric.length).toBeGreaterThan(0.12);
  });

  it("finds the geostationary belt on the synchronous altitude", () => {
    const belt = catalogPoints().filter(
      (point) => Math.abs(point.semiMajorAltitudeKm - geostationaryAltitudeKm()) < 120,
    );
    expect(belt.length).toBeGreaterThan(500);
    const equatorial = belt.filter((point) => point.inclinationDeg < 1);
    expect(equatorial.length / belt.length).toBeGreaterThan(0.4);
  });
});
