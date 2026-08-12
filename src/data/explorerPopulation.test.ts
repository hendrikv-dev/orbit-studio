import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  altitudeToUnit,
  binPopulation,
  clampPopulationViewport,
  eccentricityMarkPixels,
  explorerPopulationBounds,
  explorerPopulationPoint,
  explorerPopulationPoints,
  inclinationToUnit,
  POPULATION_ECCENTRICITY_MARK_MAX_PX,
  unitToAltitude,
} from "./explorerPopulation";
import { explorerSnapshotView, currentExplorerSnapshot } from "./explorerCatalog";
import type { ExplorerCatalogEntry } from "./explorerCatalog";

const entry = (overrides: Partial<ExplorerCatalogEntry> = {}): ExplorerCatalogEntry =>
  ({
    id: "test",
    name: "Test",
    categoryId: "payloads",
    orbit: { altitudeKm: 550, eccentricity: 0.001, inclinationDeg: 53, raanDeg: 0,
      argumentOfPeriapsisDeg: 0, trueAnomalyDeg: 0, color: "#fff" },
    ...overrides,
  }) as unknown as ExplorerCatalogEntry;

describe("explorer population parameter space", () => {
  it("derives perigee and apogee from the sourced semi-major-axis altitude", () => {
    const point = explorerPopulationPoint(
      entry({ orbit: { altitudeKm: 1000, eccentricity: 0.1, inclinationDeg: 45 } as never }),
    );

    const a = EARTH_RADIUS_KM + 1000;
    expect(point?.perigeeAltitudeKm).toBeCloseTo(a * 0.9 - EARTH_RADIUS_KM, 6);
    expect(point?.apogeeAltitudeKm).toBeCloseTo(a * 1.1 - EARTH_RADIUS_KM, 6);
    expect(point?.semiMajorAltitudeKm).toBe(1000);
  });

  it("rejects entries without usable sourced orbit shape", () => {
    expect(explorerPopulationPoint(entry({ orbit: undefined as never }))).toBeNull();
    expect(
      explorerPopulationPoint(entry({ orbit: { altitudeKm: 10, eccentricity: 0, inclinationDeg: 0 } as never })),
    ).toBeNull();
    expect(
      explorerPopulationPoint(
        entry({ orbit: { altitudeKm: Number.NaN, eccentricity: 0, inclinationDeg: 0 } as never }),
      ),
    ).toBeNull();
  });

  it("maps altitude logarithmically so LEO shells do not collapse", () => {
    const bounds = { minAltitudeKm: 150, maxAltitudeKm: 40000 };
    const leoSpread = altitudeToUnit(1200, bounds) - altitudeToUnit(300, bounds);
    const highSpread = altitudeToUnit(36000, bounds) - altitudeToUnit(35100, bounds);

    // A 900 km separation low down must read larger than a 900 km separation at GEO.
    expect(leoSpread).toBeGreaterThan(highSpread * 8);
    expect(altitudeToUnit(150, bounds)).toBeCloseTo(0, 6);
    expect(altitudeToUnit(40000, bounds)).toBeCloseTo(1, 6);
  });

  it("round-trips altitude through the axis mapping", () => {
    const bounds = { minAltitudeKm: 150, maxAltitudeKm: 40000 };
    for (const altitude of [200, 550, 1200, 20200, 35786]) {
      expect(unitToAltitude(altitudeToUnit(altitude, bounds), bounds)).toBeCloseTo(altitude, 3);
    }
  });

  it("keeps the eccentricity mark capped instead of drawing the true extent", () => {
    expect(eccentricityMarkPixels(0.001)).toBe(0);
    expect(eccentricityMarkPixels(0.04)).toBe(0);
    expect(eccentricityMarkPixels(0.2)).toBeGreaterThan(0);
    // A Molniya-class orbit spans tens of thousands of km; the mark must not.
    expect(eccentricityMarkPixels(0.74)).toBeLessThanOrEqual(POPULATION_ECCENTRICITY_MARK_MAX_PX);
    expect(eccentricityMarkPixels(1)).toBeLessThanOrEqual(POPULATION_ECCENTRICITY_MARK_MAX_PX);
  });

  it("clamps the viewport so panning cannot leave the parameter space", () => {
    expect(clampPopulationViewport({ offsetX: -5, offsetY: 9, zoom: 0.1 })).toEqual({
      offsetX: 0, offsetY: 0, zoom: 1,
    });
    const zoomed = clampPopulationViewport({ offsetX: 0.99, offsetY: 0.99, zoom: 4 });
    expect(zoomed.offsetX).toBeCloseTo(0.75, 6);
    expect(zoomed.offsetY).toBeCloseTo(0.75, 6);
  });

  it("maps inclination across the full retrograde range", () => {
    expect(inclinationToUnit(0)).toBe(0);
    expect(inclinationToUnit(90)).toBeCloseTo(0.5, 6);
    expect(inclinationToUnit(180)).toBe(1);
  });

  it("bins only what the viewport contains", () => {
    const points = explorerPopulationPoints([
      entry({ id: "a", orbit: { altitudeKm: 550, eccentricity: 0, inclinationDeg: 53 } as never }),
      entry({ id: "b", orbit: { altitudeKm: 35786, eccentricity: 0, inclinationDeg: 0 } as never }),
    ]);
    const bounds = explorerPopulationBounds(points);
    const all = binPopulation(points, bounds, { offsetX: 0, offsetY: 0, zoom: 1 }, 8, 8);
    expect(all.counts.reduce((sum, value) => sum + value, 0)).toBe(2);

    // Zoom into the low-inclination, high-altitude corner: only the GEO point remains.
    const corner = binPopulation(points, bounds, { offsetX: 0, offsetY: 0.7, zoom: 3 }, 8, 8);
    expect(corner.counts.reduce((sum, value) => sum + value, 0)).toBe(1);
  });

  it("places the real catalog's known populations where physics says they belong", () => {
    const view = explorerSnapshotView(currentExplorerSnapshot);
    const points = explorerPopulationPoints(
      view.records.filter((record): record is ExplorerCatalogEntry => Boolean((record as ExplorerCatalogEntry).orbit)),
    );
    expect(points.length).toBeGreaterThan(1000);

    const geo = points.filter((point) => Math.abs(point.semiMajorAltitudeKm - 35786) < 250);
    expect(geo.length).toBeGreaterThan(0);
    // The GEO belt is defined by being equatorial: most of the band sits at low inclination.
    const equatorial = geo.filter((point) => point.inclinationDeg < 5).length;
    expect(equatorial / geo.length).toBeGreaterThan(0.4);

    // Nothing in the population view may depend on reconstructed angles.
    for (const point of points.slice(0, 50)) {
      expect(Number.isFinite(point.inclinationDeg)).toBe(true);
      expect(Number.isFinite(point.semiMajorAltitudeKm)).toBe(true);
    }
  });
});
