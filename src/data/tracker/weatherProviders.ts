import type { ConditionSnapshot, WeatherSourceInfo } from "./conditions";

/**
 * Weather adapters, behind one interface.
 *
 * The follow-on specification asks for a provider-neutral adapter so that
 * scoring and interface never see a vendor's schema, and for every adapter to
 * declare whether it costs the operator money so the free-path rule is
 * checkable rather than remembered. Both are types here, not conventions.
 *
 * ## The identification problem, verified rather than assumed
 *
 * Both preferred no-fee sources require a `User-Agent` that identifies the
 * calling application. **A browser cannot send one.** `User-Agent` is a
 * forbidden header name in the Fetch standard, so the browser silently discards
 * whatever is set and sends its own. Probed against an echo service from this
 * app's own page:
 *
 *     fetch(url, { headers: { "User-Agent": "orbit-studio-tracker/0.2" } })
 *     → received: "Mozilla/5.0 (Linux; Android 14; Pixel 8) … Chrome/148"
 *
 * The requests themselves succeed — both APIs send permissive CORS headers and
 * returned 200 — so this is a terms question, not a technical one, and it is
 * the operator's to answer. It is recorded in `identification` on each source
 * and surfaced in the interface's source detail rather than being decided here.
 *
 * The clean resolution is a caching proxy, which also satisfies the caching
 * both providers ask for. A proxy is a backend, a backend costs money, and the
 * cost rule then applies — which is the same collision the satellite and aurora
 * requirements run into. See `docs/TRACKER_V1_STATUS.md`.
 */

export interface WeatherAdapter {
  source: WeatherSourceInfo;
  /**
   * True where this adapter can serve the location at all. NWS covers the
   * United States and answers 404 elsewhere, which is a routing fact rather
   * than a failure to report.
   */
  covers(latitudeDeg: number, longitudeDeg: number): boolean;
  /** Hourly snapshots spanning at least the coming night, or throws. */
  fetchConditions(
    latitudeDeg: number,
    longitudeDeg: number,
    signal?: AbortSignal,
  ): Promise<ConditionSnapshot[]>;
}

/**
 * How the application identifies itself, where it is able to.
 *
 * Sent as `User-Agent` from any non-browser caller. Kept as a constant so that
 * a proxy, a test harness or a future native client all identify the same way,
 * and so the string is one edit away from being right rather than scattered.
 */
export const CLIENT_IDENTIFICATION = "orbit-studio-tracker/0.2 (github.com/hendrikv-dev/orbit-studio)";

/**
 * Coordinates rounded for caching.
 *
 * Both providers ask callers to cache and neither wants a request per user.
 * Two observers four kilometres apart get the same forecast grid cell, so they
 * should share a cache entry — and rounding also stops a precise location being
 * used as a cache key, which is a privacy property worth having for free.
 */
export function locationBucket(latitudeDeg: number, longitudeDeg: number): string {
  return `${latitudeDeg.toFixed(2)},${longitudeDeg.toFixed(2)}`;
}

interface CacheEntry {
  snapshots: ConditionSnapshot[];
  storedAt: number;
}

const CACHE_TTL_MS = 60 * 60_000;
const cache = new Map<string, CacheEntry>();

/** Cached by grid cell and provider, never by user. */
export async function conditionsFor(
  adapter: WeatherAdapter,
  latitudeDeg: number,
  longitudeDeg: number,
  signal?: AbortSignal,
): Promise<ConditionSnapshot[]> {
  const key = `${adapter.source.id}:${locationBucket(latitudeDeg, longitudeDeg)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return hit.snapshots;

  const snapshots = await adapter.fetchConditions(latitudeDeg, longitudeDeg, signal);
  cache.set(key, { snapshots, storedAt: Date.now() });
  return snapshots;
}

/** Exposed for tests; the cache is otherwise process-lifetime. */
export function clearConditionCache(): void {
  cache.clear();
}

/* --------------------------------------------------------------- helpers */

function emptyOptionalFields() {
  return {
    visibilityM: null,
    lowCloudPercent: null,
    midCloudPercent: null,
    highCloudPercent: null,
    relativeHumidityPercent: null,
    // No smoke adapter ships yet. Null rather than zero, so the model runs
    // without it instead of being told the air is clean.
    smokeColumnMgM2: null,
    surfacePm25: null,
  };
}

/* ----------------------------------------------------------- MET Norway */

interface MetNoTimeseriesEntry {
  time: string;
  data: {
    instant: {
      details: {
        air_temperature?: number;
        cloud_area_fraction?: number;
        cloud_area_fraction_low?: number;
        cloud_area_fraction_medium?: number;
        cloud_area_fraction_high?: number;
        relative_humidity?: number;
        fog_area_fraction?: number;
      };
    };
    next_1_hours?: { details?: { precipitation_amount?: number } };
  };
}

/**
 * MET Norway Locationforecast: global point forecasts, CC BY 4.0, no fee.
 *
 * Their model reports cloud as an area fraction in percent and precipitation as
 * an amount over the following hour, so "is it raining" is derived rather than
 * given. Fog arrives as an area fraction rather than a visibility, so it is
 * converted to a nominal visibility the shared model can read — the model asks
 * for metres and the provider has fog cover, and translating here is what the
 * adapter is for.
 */
export const metNorwayAdapter: WeatherAdapter = {
  source: {
    id: "met-norway",
    name: "MET Norway Locationforecast",
    attribution: "Weather data from MET Norway, licensed CC BY 4.0.",
    cost: "public-no-fee",
    coverage: "global",
  },
  covers: () => true,
  async fetchConditions(latitudeDeg, longitudeDeg, signal) {
    // Their terms ask for coordinates truncated to four decimals; more than
    // that is spurious precision and fragments their cache.
    const url =
      `https://api.met.no/weatherapi/locationforecast/2.0/compact` +
      `?lat=${latitudeDeg.toFixed(4)}&lon=${longitudeDeg.toFixed(4)}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`MET Norway responded ${response.status}`);
    const body = await response.json();

    const issuedUtc: string = body?.properties?.meta?.updated_at ?? new Date().toISOString();
    const series: MetNoTimeseriesEntry[] = body?.properties?.timeseries ?? [];

    return series
      .filter((entry) => entry.data?.instant?.details?.cloud_area_fraction !== undefined)
      .map((entry) => {
        const details = entry.data.instant.details;
        const fog = details.fog_area_fraction ?? null;
        return {
          atUtc: new Date(entry.time).toISOString(),
          cloudCoverPercent: details.cloud_area_fraction ?? 0,
          temperatureC: details.air_temperature ?? 0,
          issuedUtc: new Date(issuedUtc).toISOString(),
          precipitating: (entry.data.next_1_hours?.details?.precipitation_amount ?? 0) > 0.05,
          ...emptyOptionalFields(),
          visibilityM: fog === null ? null : fog > 50 ? 400 : fog > 15 ? 2000 : null,
          lowCloudPercent: details.cloud_area_fraction_low ?? null,
          midCloudPercent: details.cloud_area_fraction_medium ?? null,
          highCloudPercent: details.cloud_area_fraction_high ?? null,
          relativeHumidityPercent: details.relative_humidity ?? null,
          source: "met-norway",
        };
      });
  },
};

/* ------------------------------------------------------------------ NWS */

/**
 * US National Weather Service: open data, free for any purpose, ~2.5 km grids.
 *
 * Two requests: `/points` resolves coordinates to a forecast grid, then the
 * gridpoint endpoint carries the raw layers. Values arrive as ISO 8601
 * intervals rather than instants, which is why each layer is expanded across
 * its own validity period before the layers are joined.
 */
export const nationalWeatherServiceAdapter: WeatherAdapter = {
  source: {
    id: "nws",
    name: "US National Weather Service",
    attribution: "Forecast data from the US National Weather Service (public domain).",
    cost: "public-no-fee",
    coverage: "united-states",
  },
  covers(latitudeDeg, longitudeDeg) {
    // A generous bounding box for the contiguous states, Alaska and Hawaii. The
    // API is authoritative and answers 404 outside its area; this only avoids
    // making a request that is certain to fail.
    const inContiguous =
      latitudeDeg >= 24 && latitudeDeg <= 50 && longitudeDeg >= -125 && longitudeDeg <= -66;
    const inAlaska =
      latitudeDeg >= 51 && latitudeDeg <= 72 && longitudeDeg >= -170 && longitudeDeg <= -129;
    const inHawaii =
      latitudeDeg >= 18 && latitudeDeg <= 23 && longitudeDeg >= -161 && longitudeDeg <= -154;
    return inContiguous || inAlaska || inHawaii;
  },
  async fetchConditions(latitudeDeg, longitudeDeg, signal) {
    const points = await fetch(
      `https://api.weather.gov/points/${latitudeDeg.toFixed(4)},${longitudeDeg.toFixed(4)}`,
      { signal },
    );
    if (!points.ok) throw new Error(`NWS points responded ${points.status}`);
    const gridUrl: string | undefined = (await points.json())?.properties?.forecastGridData;
    if (!gridUrl) throw new Error("NWS returned no gridpoint URL");

    const grid = await fetch(gridUrl, { signal });
    if (!grid.ok) throw new Error(`NWS gridpoint responded ${grid.status}`);
    const properties = (await grid.json())?.properties ?? {};

    const issuedUtc = new Date(properties.updateTime ?? Date.now()).toISOString();
    const sky = expandIntervals(properties.skyCover?.values ?? []);
    const temperature = expandIntervals(properties.temperature?.values ?? []);
    const visibility = expandIntervals(properties.visibility?.values ?? []);
    const precipitation = expandIntervals(properties.probabilityOfPrecipitation?.values ?? []);
    const humidity = expandIntervals(properties.relativeHumidity?.values ?? []);

    return [...sky.keys()]
      .sort()
      .map((atUtc) => ({
        atUtc,
        cloudCoverPercent: sky.get(atUtc) ?? 0,
        temperatureC: temperature.get(atUtc) ?? 0,
        issuedUtc,
        // A probability, not an occurrence. Above half is treated as expected;
        // below it the cloud figure already carries the pessimism.
        precipitating: (precipitation.get(atUtc) ?? 0) >= 50,
        ...emptyOptionalFields(),
        visibilityM: visibility.get(atUtc) ?? null,
        relativeHumidityPercent: humidity.get(atUtc) ?? null,
        source: "nws",
      }));
  },
};

/**
 * NWS gives each value an ISO 8601 interval such as
 * `2026-08-16T21:00:00+00:00/PT3H`, meaning it holds for three hours. Expanded
 * to hourly keys so layers with different interval lengths can be joined.
 */
export function expandIntervals(
  values: { validTime: string; value: number | null }[],
): Map<string, number> {
  const expanded = new Map<string, number>();
  for (const entry of values) {
    if (entry.value === null || entry.value === undefined) continue;
    const [startText, duration] = entry.validTime.split("/");
    const start = Date.parse(startText);
    if (Number.isNaN(start)) continue;
    const hours = parseIsoDurationHours(duration ?? "PT1H");
    for (let step = 0; step < hours; step += 1) {
      expanded.set(new Date(start + step * 3_600_000).toISOString(), entry.value);
    }
  }
  return expanded;
}

/** Only days and hours appear in gridpoint durations. */
export function parseIsoDurationHours(duration: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/.exec(duration);
  if (!match) return 1;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  return Math.max(1, days * 24 + hours);
}

/* -------------------------------------------------------------- routing */

export const WEATHER_ADAPTERS: WeatherAdapter[] = [
  nationalWeatherServiceAdapter,
  metNorwayAdapter,
];

/**
 * The adapter to use for a location, preferring the finest-grained free source
 * that covers it.
 *
 * `allowCostBearing` defaults to false and is the enforcement point for §9 of
 * the follow-on specification: a free user's request can never reach a metered
 * provider, because the router will not return one.
 */
export function adapterFor(
  latitudeDeg: number,
  longitudeDeg: number,
  allowCostBearing = false,
): WeatherAdapter | null {
  return (
    WEATHER_ADAPTERS.find(
      (adapter) =>
        adapter.covers(latitudeDeg, longitudeDeg) &&
        (allowCostBearing || adapter.source.cost === "public-no-fee"),
    ) ?? null
  );
}
