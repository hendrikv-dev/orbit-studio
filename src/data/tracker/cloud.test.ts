import { describe, expect, it, vi } from "vitest";

import {
  cloudAt,
  fetchCloudForecastSeries,
  forecastHour,
  latticeFor,
  withinHrrr,
  type CloudForecast,
} from "./cloud";

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

describe("the point forecast series", () => {
  const answer = (body: unknown, ok = true) =>
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

  it("asks one point for a range of hours, and names the model", async () => {
    const fetcher = answer({
      hourly: {
        time: ["2026-09-03T02:00", "2026-09-03T03:00", "2026-09-03T04:00"],
        cloud_cover: [10, 40, 90],
      },
    });
    vi.stubGlobal("fetch", fetcher);
    const series = await fetchCloudForecastSeries(45.5, -122.7, "2026-09-03T02:10Z", "2026-09-03T04:50Z");
    expect(series?.model).toBe("NOAA HRRR");
    expect(series?.hours).toEqual([
      { validUtc: "2026-09-03T02:00Z", percent: 10 },
      { validUtc: "2026-09-03T03:00Z", percent: 40 },
      { validUtc: "2026-09-03T04:00Z", percent: 90 },
    ]);
    const url = String(fetcher.mock.calls[0][0]);
    expect(url).toContain("start_hour=2026-09-03T02%3A00");
    expect(url).toContain("end_hour=2026-09-03T04%3A00");
    // One point, not a lattice: the series answers "when", not "where".
    expect(url).toContain("latitude=45.500&longitude=-122.700");
    vi.unstubAllGlobals();
  });

  it("names the global model outside HRRR's domain", async () => {
    vi.stubGlobal(
      "fetch",
      answer({ hourly: { time: ["2026-09-03T21:00"], cloud_cover: [30] } }),
    );
    const series = await fetchCloudForecastSeries(51.5, -0.1, "2026-09-03T21:00Z", "2026-09-03T21:00Z");
    expect(series?.model).toBe("Open-Meteo best available");
    vi.unstubAllGlobals();
  });

  it("drops hours the model left empty rather than reading them as clear", async () => {
    vi.stubGlobal(
      "fetch",
      answer({
        hourly: {
          time: ["2026-09-03T02:00", "2026-09-03T03:00"],
          cloud_cover: [null, 40],
        },
      }),
    );
    const series = await fetchCloudForecastSeries(45.5, -122.7, "2026-09-03T02:00Z", "2026-09-03T03:00Z");
    expect(series?.hours).toEqual([{ validUtc: "2026-09-03T03:00Z", percent: 40 }]);
    vi.unstubAllGlobals();
  });

  it("is nothing at all when the service says nothing", async () => {
    vi.stubGlobal("fetch", answer({ hourly: { time: [], cloud_cover: [] } }));
    expect(
      await fetchCloudForecastSeries(45.5, -122.7, "2026-09-03T02:00Z", "2026-09-03T03:00Z"),
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it("and when it refuses", async () => {
    vi.stubGlobal("fetch", answer({}, false));
    expect(
      await fetchCloudForecastSeries(45.5, -122.7, "2026-09-03T02:00Z", "2026-09-03T03:00Z"),
    ).toBeNull();
    vi.unstubAllGlobals();
  });
});
