import { describe, expect, it } from "vitest";

import { cloudAt, forecastHour, latticeFor, withinHrrr, type CloudForecast } from "./cloud";

describe("which model can answer", () => {
  it("uses HRRR over the United States", () => {
    expect(withinHrrr({ south: 40, north: 48, west: -125, east: -118 })).toBe(true);
    expect(withinHrrr({ south: 30, north: 36, west: -100, east: -92 })).toBe(true);
  });

  /**
   * HRRR is a continental model. A view that reaches past its domain gets the
   * global one, named as such, rather than a request that comes back empty for
   * half the map.
   */
  it("and not outside it", () => {
    expect(withinHrrr({ south: 48, north: 60, west: -10, east: 5 })).toBe(false);
    expect(withinHrrr({ south: -40, north: -30, west: 140, east: 155 })).toBe(false);
    // A view that straddles the border is outside it: half a field is not one.
    expect(withinHrrr({ south: 40, north: 60, west: -125, east: -118 })).toBe(false);
  });
});

describe("the lattice", () => {
  const bounds = { south: 40, north: 48, west: -125, east: -117 };

  it("covers the view without sampling its edges", () => {
    const { latitudes, longitudes } = latticeFor(bounds);
    expect(latitudes).toHaveLength(8);
    expect(longitudes).toHaveLength(12);
    // Cell centres, so no sample sits exactly on a boundary the view may not own.
    expect(latitudes[0]).toBeGreaterThan(bounds.south);
    expect(latitudes[latitudes.length - 1]).toBeLessThan(bounds.north);
    expect(longitudes[0]).toBeGreaterThan(bounds.west);
    expect(longitudes[longitudes.length - 1]).toBeLessThan(bounds.east);
  });

  it("is evenly spaced, which is what the interpolation assumes", () => {
    const { latitudes } = latticeFor(bounds);
    const steps = latitudes.slice(1).map((value, index) => value - latitudes[index]);
    for (const step of steps) expect(step).toBeCloseTo(steps[0], 9);
  });
});

describe("reading the field at a point", () => {
  const forecast = (values: (number | null)[]): CloudForecast => ({
    model: "test",
    validUtc: "2026-09-03T04:00Z",
    latitudes: [40, 41, 42],
    longitudes: [-125, -124, -123],
    values,
  });

  it("returns the corner value at a corner", () => {
    const grid = forecast([0, 0, 0, 0, 0, 0, 0, 0, 90]);
    expect(cloudAt(grid, 42, -123)).toBeCloseTo(90, 6);
    expect(cloudAt(grid, 40, -125)).toBeCloseTo(0, 6);
  });

  it("interpolates between them rather than stepping", () => {
    const grid = forecast([0, 100, 100, 0, 100, 100, 0, 100, 100]);
    expect(cloudAt(grid, 40.5, -124.5)).toBeGreaterThan(0);
    expect(cloudAt(grid, 40.5, -124.5)).toBeLessThan(100);
  });

  /**
   * A hole in the grid is not a clear sky.
   *
   * Models have gaps — a point outside the domain, an hour the run does not
   * cover — and treating a missing value as zero cloud is the most dangerous
   * possible direction for this particular number to fail in.
   */
  it("reports nothing where the model said nothing", () => {
    const grid = forecast([0, 0, 0, 0, null, 0, 0, 0, 0]);
    expect(cloudAt(grid, 40.5, -124.5)).toBeNull();
  });
});

describe("the hour a forecast is for", () => {
  it("is the hour, because the models are hourly", () => {
    expect(forecastHour("2026-09-03T04:37:12Z")).toBe("2026-09-03T04:00");
    expect(forecastHour("2026-09-03T04:00:00Z")).toBe("2026-09-03T04:00");
  });
});
