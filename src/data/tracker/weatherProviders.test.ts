import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adapterFor,
  clearConditionCache,
  conditionsFor,
  conditionsForLocation,
  expandIntervals,
  locationBucket,
  metNorwayAdapter,
  nationalWeatherServiceAdapter,
  parseIsoDurationHours,
  WEATHER_ADAPTERS,
  type WeatherAdapter,
} from "./weatherProviders";

afterEach(() => {
  clearConditionCache();
  vi.unstubAllGlobals();
});

describe("the cost boundary", () => {
  it("never routes a free request to a cost-bearing provider", () => {
    // §9: the free-user path must not call a paid or metered provider. Enforced
    // by the router rather than by remembering not to.
    const costly: WeatherAdapter = {
      source: {
        id: "metered",
        name: "Metered",
        attribution: "",
        cost: "cost-bearing",
        coverage: "global",
      },
      covers: () => true,
      fetchConditions: async () => [],
    };
    WEATHER_ADAPTERS.push(costly);
    try {
      expect(adapterFor(51.5, 0)?.source.cost).toBe("public-no-fee");
      expect(adapterFor(51.5, 0, true)).not.toBeNull();
    } finally {
      WEATHER_ADAPTERS.pop();
    }
  });

  it("declares a cost for every shipped adapter", () => {
    for (const adapter of WEATHER_ADAPTERS) {
      expect(["public-no-fee", "cost-bearing"]).toContain(adapter.source.cost);
      expect(adapter.source.attribution.length).toBeGreaterThan(0);
    }
  });
});

describe("routing", () => {
  it("prefers the finer US grid inside the United States", () => {
    expect(adapterFor(40.7128, -74.006)?.source.id).toBe("nws");
    expect(adapterFor(61.2, -149.9)?.source.id).toBe("nws");
  });

  it("falls back to the global source everywhere else", () => {
    expect(adapterFor(51.5, -0.1)?.source.id).toBe("met-norway");
    expect(adapterFor(-33.9, 151.2)?.source.id).toBe("met-norway");
    expect(adapterFor(-1.3, 36.8)?.source.id).toBe("met-norway");
  });

  it("falls back after a covered provider fails and records the attempt", async () => {
    const failed: WeatherAdapter = {
      source: { id: "fine", name: "Fine", attribution: "test", cost: "public-no-fee", coverage: "global" },
      covers: () => true,
      fetchConditions: async () => { throw new Error("503"); },
    };
    const fallback: WeatherAdapter = {
      source: { id: "fallback", name: "Fallback", attribution: "test", cost: "public-no-fee", coverage: "global" },
      covers: () => true,
      fetchConditions: async () => [{
        atUtc: "2026-08-16T22:00:00.000Z",
        issuedUtc: "2026-08-16T17:00:00.000Z",
        cloudCoverPercent: 10,
        temperatureC: null,
        precipitating: null,
        visibilityM: null,
        lowCloudPercent: null,
        midCloudPercent: null,
        highCloudPercent: null,
        relativeHumidityPercent: null,
        smokeColumnMgM2: null,
        surfacePm25: null,
        source: "fallback",
      }],
    };
    const result = await conditionsForLocation(40, -74, undefined, [failed, fallback]);
    expect(result.adapter?.source.id).toBe("fallback");
    expect(result.snapshots).toHaveLength(1);
    expect(result.attempts).toEqual([
      { sourceId: "fine", outcome: "failed", message: "503" },
    ]);
  });
});

describe("caching", () => {
  it("caches by grid cell rather than by user", () => {
    // Two observers four kilometres apart share a forecast cell, so they must
    // share a cache entry — and a rounded key cannot carry a precise location.
    expect(locationBucket(51.4779, -0.0015)).toBe(locationBucket(51.4812, -0.0043));
    expect(locationBucket(51.4779, -0.0015)).not.toBe(locationBucket(52.0, -0.0015));
  });

  it("asks a provider once for the same cell", async () => {
    const fetchConditions = vi.fn().mockResolvedValue([]);
    const adapter: WeatherAdapter = {
      source: { id: "t", name: "t", attribution: "t", cost: "public-no-fee", coverage: "global" },
      covers: () => true,
      fetchConditions,
    };
    await conditionsFor(adapter, 51.4779, -0.0015);
    await conditionsFor(adapter, 51.4801, -0.0032);
    expect(fetchConditions).toHaveBeenCalledTimes(1);
  });
});

describe("MET Norway", () => {
  const body = {
    properties: {
      meta: { updated_at: "2026-08-16T17:34:00Z" },
      timeseries: [
        {
          time: "2026-08-16T22:00:00Z",
          data: {
            instant: {
              details: {
                air_temperature: 13.4,
                cloud_area_fraction: 12.5,
                cloud_area_fraction_low: 3,
                cloud_area_fraction_high: 9,
                relative_humidity: 78,
                fog_area_fraction: 0,
              },
            },
            next_1_hours: { details: { precipitation_amount: 0 } },
          },
        },
        {
          time: "2026-08-16T23:00:00Z",
          data: {
            instant: { details: { air_temperature: 12.1, cloud_area_fraction: 90 } },
            next_1_hours: { details: { precipitation_amount: 1.2 } },
          },
        },
      ],
    },
  };

  it("normalises the provider's schema away", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    const snapshots = await metNorwayAdapter.fetchConditions(51.4779, -0.0015);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].cloudCoverPercent).toBe(12.5);
    expect(snapshots[0].temperatureC).toBe(13.4);
    expect(snapshots[0].issuedUtc).toBe("2026-08-16T17:34:00.000Z");
    expect(snapshots[0].source).toBe("met-norway");
  });

  it("derives whether it is raining from an amount, which is what they give", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    const snapshots = await metNorwayAdapter.fetchConditions(51.4779, -0.0015);
    expect(snapshots[0].precipitating).toBe(false);
    expect(snapshots[1].precipitating).toBe(true);
  });

  it("leaves smoke null rather than reporting clean air it does not measure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    const snapshots = await metNorwayAdapter.fetchConditions(51.4779, -0.0015);
    expect(snapshots[0].smokeColumnMgM2).toBeNull();
    expect(snapshots[0].surfacePm25).toBeNull();
  });

  it("throws rather than inventing a forecast when the provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(metNorwayAdapter.fetchConditions(51.4779, -0.0015)).rejects.toThrow(/503/);
  });
});

describe("the National Weather Service grid", () => {
  it("expands an interval across every hour it covers", () => {
    // Their layers carry different interval lengths, so they cannot be joined
    // until each is expanded onto the same hourly keys.
    const expanded = expandIntervals([
      { validTime: "2026-08-16T21:00:00+00:00/PT3H", value: 40 },
      { validTime: "2026-08-17T00:00:00+00:00/PT1H", value: 5 },
    ]);
    expect(expanded.get("2026-08-16T21:00:00.000Z")).toBe(40);
    expect(expanded.get("2026-08-16T23:00:00.000Z")).toBe(40);
    expect(expanded.get("2026-08-17T00:00:00.000Z")).toBe(5);
    expect(expanded.size).toBe(4);
  });

  it("reads the durations their gridpoints actually use", () => {
    expect(parseIsoDurationHours("PT1H")).toBe(1);
    expect(parseIsoDurationHours("PT6H")).toBe(6);
    expect(parseIsoDurationHours("P1DT2H")).toBe(26);
    expect(parseIsoDurationHours("nonsense")).toBe(1);
  });

  it("drops null values rather than treating them as zero cloud", () => {
    const expanded = expandIntervals([
      { validTime: "2026-08-16T21:00:00+00:00/PT1H", value: null },
    ]);
    expect(expanded.size).toBe(0);
  });

  it("joins the layers into one snapshot per hour", async () => {
    const points = { properties: { forecastGridData: "https://api.weather.gov/gridpoints/OKX/33,35" } };
    const grid = {
      properties: {
        updateTime: "2026-08-16T17:00:00+00:00",
        skyCover: { values: [{ validTime: "2026-08-16T22:00:00+00:00/PT2H", value: 30 }] },
        temperature: { values: [{ validTime: "2026-08-16T22:00:00+00:00/PT2H", value: 21 }] },
        probabilityOfPrecipitation: {
          values: [{ validTime: "2026-08-16T22:00:00+00:00/PT2H", value: 10 }],
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => points })
        .mockResolvedValueOnce({ ok: true, json: async () => grid }),
    );
    const snapshots = await nationalWeatherServiceAdapter.fetchConditions(40.7128, -74.006);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].cloudCoverPercent).toBe(30);
    expect(snapshots[0].temperatureC).toBe(21);
    expect(snapshots[0].precipitating).toBe(false);
  });
});
