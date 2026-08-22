import type { ConditionSnapshot, WeatherSourceInfo } from "./conditions";

/**
 * Aerosol, which is what "smoke" actually means for an observer.
 *
 * The condition row has always had a smoke card and has almost always had
 * nothing to put in it: neither shipping forecast provider carries an aerosol
 * layer, so the slot read "Not reported" everywhere, permanently, while
 * occupying a quarter of the most valuable row on the page.
 *
 * ## Why aerosol optical depth rather than a smoke concentration
 *
 * Because it is the quantity that answers the question. Optical depth is
 * defined by what a column of atmosphere does to light passing through it:
 * transmission is `e^(-τ)`, so τ converts directly into magnitudes of
 * extinction — the unit astronomy already thinks in. A surface concentration
 * of PM2.5 is a health measurement taken at head height and can be high while
 * the sky is fine, or low while smoke aloft is ruining it.
 *
 * Both are fetched. Optical depth drives the judgement; PM2.5 is kept because
 * it is what somebody with asthma standing outside for an hour actually needs,
 * and because it is the fallback where the aerosol model has no value.
 *
 * ## The source
 *
 * Open-Meteo's air-quality API, which serves the Copernicus Atmosphere
 * Monitoring Service reanalysis and forecast. Free for non-commercial use, no
 * key, `access-control-allow-origin: *`, CC BY 4.0. CAMS is already a
 * documented upstream in this repository's provenance inventory.
 */

export const OPEN_METEO_AIR_QUALITY_SOURCE: WeatherSourceInfo = {
  id: "open-meteo-air-quality",
  name: "Open-Meteo Air Quality (CAMS)",
  attribution:
    "Aerosol and particulate data from Open-Meteo, derived from the Copernicus Atmosphere Monitoring Service, licensed CC BY 4.0.",
  cost: "public-no-fee",
  coverage: "global",
};

const ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";

export interface AerosolSample {
  atUtc: string;
  /**
   * Aerosol optical depth at 550 nm, dimensionless.
   *
   * Roughly: 0.05 is a clean sky, 0.2 is noticeable haze, 0.5 is obvious
   * smoke, above 1 the sky is visibly brown by day.
   */
  aerosolOpticalDepth: number | null;
  /** Near-surface PM2.5, µg/m³. A health signal, not a sky one. */
  surfacePm25: number | null;
}

/**
 * Extinction added by aerosol, in magnitudes at the zenith.
 *
 * `2.5 · log10(e) · τ` is the definition rather than a fit: transmission
 * through optical depth τ is `e^(-τ)`, and a magnitude is `-2.5 log10` of a
 * flux ratio. Quoting it this way is what lets the interface say how much of
 * the sky is being taken away instead of printing a bare index nobody can act
 * on.
 */
export function aerosolExtinctionMagnitudes(opticalDepth: number): number {
  return 1.0857362 * opticalDepth;
}

export type AerosolReading = "clean" | "slight" | "hazy" | "smoky" | "heavy";

/**
 * How much the aerosol matters, in five steps.
 *
 * The boundaries are the conventional descriptive ranges for 550 nm optical
 * depth, chosen so each step is about a third of a magnitude of extinction —
 * the point at which the difference is visible to somebody looking for faint
 * things.
 */
export function readAerosol(opticalDepth: number): AerosolReading {
  if (opticalDepth < 0.08) return "clean";
  if (opticalDepth < 0.2) return "slight";
  if (opticalDepth < 0.4) return "hazy";
  if (opticalDepth < 0.8) return "smoky";
  return "heavy";
}

interface AirQualityBody {
  hourly?: {
    time?: string[];
    pm2_5?: (number | null)[];
    aerosol_optical_depth?: (number | null)[];
  };
}

export function parseAerosolSamples(body: unknown): AerosolSample[] {
  const hourly = (body as AirQualityBody)?.hourly;
  const times = hourly?.time;
  if (!Array.isArray(times) || times.length === 0) return [];
  const depths = hourly?.aerosol_optical_depth ?? [];
  const particulates = hourly?.pm2_5 ?? [];
  return times.map((time, index) => ({
    // Requested in UTC, and returned without a zone suffix.
    atUtc: new Date(`${time}Z`).toISOString(),
    aerosolOpticalDepth: typeof depths[index] === "number" ? (depths[index] as number) : null,
    surfacePm25: typeof particulates[index] === "number" ? (particulates[index] as number) : null,
  }));
}

/**
 * Aerosol for a location, over the coming days.
 *
 * Coordinates are rounded for the same reason the weather adapters round them:
 * two observers in the same model cell should share one cache entry, and a
 * precise location should never be used as a cache key.
 */
export async function fetchAerosol(
  latitudeDeg: number,
  longitudeDeg: number,
  signal?: AbortSignal,
): Promise<AerosolSample[]> {
  const url =
    `${ENDPOINT}?latitude=${latitudeDeg.toFixed(2)}&longitude=${longitudeDeg.toFixed(2)}` +
    `&hourly=pm2_5,aerosol_optical_depth&forecast_days=3&timezone=UTC`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Open-Meteo air quality responded ${response.status}`);
  return parseAerosolSamples(await response.json());
}

/** Half an hour either side, which is the resolution the model is published at. */
const MATCH_TOLERANCE_MS = 45 * 60_000;

/**
 * Fold aerosol into the forecast snapshots the rest of Tracker already uses.
 *
 * Matched by time with a tolerance rather than by index: the two providers are
 * on different grids and different cadences, and lining them up by position
 * would silently attach one hour's smoke to another hour's cloud. A snapshot
 * with no aerosol within tolerance keeps its nulls, which the interface renders
 * as "not reported" rather than as clean air.
 */
export function withAerosol(
  snapshots: ConditionSnapshot[],
  aerosol: AerosolSample[],
): ConditionSnapshot[] {
  if (aerosol.length === 0) return snapshots;
  return snapshots.map((snapshot) => {
    const target = Date.parse(snapshot.atUtc);
    let best: AerosolSample | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const sample of aerosol) {
      const gap = Math.abs(Date.parse(sample.atUtc) - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = sample;
      }
    }
    if (!best || bestGap > MATCH_TOLERANCE_MS) return snapshot;
    return {
      ...snapshot,
      aerosolOpticalDepth: best.aerosolOpticalDepth,
      surfacePm25: best.surfacePm25 ?? snapshot.surfacePm25,
    };
  });
}
