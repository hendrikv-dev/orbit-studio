import { EARTH_RADIUS_KM } from "../physics/constants";
import type { ExplorerCatalogEntry, ExplorerCategoryId } from "./explorerCatalog";

/**
 * Orbital population view: the catalog plotted in orbital parameter space
 * rather than physical space.
 *
 * Every value here derives from GCAT's sourced orbit shape — perigee, apogee and
 * inclination — reached through `entry.orbit`, where `altitudeKm` is already the
 * semi-major-axis altitude (`explorerCatalog.ts` builds `semiMajorAxisKm` as
 * `EARTH_RADIUS_KM + altitudeKm`). Nothing in this module reads RAAN, argument of
 * perigee, mean anomaly or object phase: those fields are a deterministic
 * educational reconstruction, and a population view built on them would show
 * structure that does not exist.
 */
export interface ExplorerPopulationPoint {
  id: string;
  name: string;
  categoryId: ExplorerCategoryId;
  /** X axis. Sourced. */
  inclinationDeg: number;
  /** Y axis: a − R⊕. Sourced shape. */
  semiMajorAltitudeKm: number;
  /** Sourced. */
  eccentricity: number;
  /** a(1 − e) − R⊕. Revealed on selection, never drawn for the whole catalog. */
  perigeeAltitudeKm: number;
  /** a(1 + e) − R⊕. */
  apogeeAltitudeKm: number;
}

/**
 * Below this the object is on its way down and a log axis stops being useful.
 * Kept as an explicit floor rather than clamping silently at render time.
 */
export const POPULATION_ALTITUDE_FLOOR_KM = 80;
export const POPULATION_INCLINATION_MAX_DEG = 180;

export function explorerPopulationPoint(
  entry: ExplorerCatalogEntry,
): ExplorerPopulationPoint | null {
  const orbit = entry.orbit;
  if (!orbit) return null;

  const semiMajorAltitudeKm = orbit.altitudeKm;
  const eccentricity = orbit.eccentricity;
  const inclinationDeg = orbit.inclinationDeg;
  if (
    !Number.isFinite(semiMajorAltitudeKm) ||
    !Number.isFinite(eccentricity) ||
    !Number.isFinite(inclinationDeg) ||
    semiMajorAltitudeKm <= POPULATION_ALTITUDE_FLOOR_KM
  ) {
    return null;
  }

  const semiMajorAxisKm = EARTH_RADIUS_KM + semiMajorAltitudeKm;
  return {
    id: entry.id,
    name: entry.name,
    categoryId: entry.categoryId,
    inclinationDeg,
    semiMajorAltitudeKm,
    eccentricity,
    perigeeAltitudeKm: semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM,
    apogeeAltitudeKm: semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM,
  };
}

export function explorerPopulationPoints(
  entries: readonly ExplorerCatalogEntry[],
): ExplorerPopulationPoint[] {
  const points: ExplorerPopulationPoint[] = [];
  for (const entry of entries) {
    const point = explorerPopulationPoint(entry);
    if (point) points.push(point);
  }
  return points;
}

export interface ExplorerPopulationBounds {
  minAltitudeKm: number;
  maxAltitudeKm: number;
}

export function explorerPopulationBounds(
  points: readonly ExplorerPopulationPoint[],
): ExplorerPopulationBounds {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.semiMajorAltitudeKm < min) min = point.semiMajorAltitudeKm;
    if (point.semiMajorAltitudeKm > max) max = point.semiMajorAltitudeKm;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { minAltitudeKm: 150, maxAltitudeKm: 40000 };
  }
  // Pad so the densest shells never sit on the frame edge.
  return {
    minAltitudeKm: Math.max(POPULATION_ALTITUDE_FLOOR_KM, min * 0.85),
    maxAltitudeKm: max * 1.15,
  };
}

/**
 * Altitude spans roughly three orders of magnitude — a linear axis collapses
 * every LEO shell into a single line, so the axis is logarithmic.
 */
export function altitudeToUnit(altitudeKm: number, bounds: ExplorerPopulationBounds): number {
  const low = Math.log10(bounds.minAltitudeKm);
  const high = Math.log10(bounds.maxAltitudeKm);
  if (high <= low) return 0;
  return (Math.log10(Math.max(altitudeKm, POPULATION_ALTITUDE_FLOOR_KM)) - low) / (high - low);
}

export function unitToAltitude(unit: number, bounds: ExplorerPopulationBounds): number {
  const low = Math.log10(bounds.minAltitudeKm);
  const high = Math.log10(bounds.maxAltitudeKm);
  return 10 ** (low + unit * (high - low));
}

export function inclinationToUnit(inclinationDeg: number): number {
  return Math.min(Math.max(inclinationDeg, 0), POPULATION_INCLINATION_MAX_DEG) /
    POPULATION_INCLINATION_MAX_DEG;
}

/**
 * Eccentricity is encoded as a short capped whisker, not as the object's true
 * perigee→apogee extent. Drawing the real extent for every object puts ~91
 * million km of vertical marks on the plot: 12% of the catalog spans more than
 * 1000 km and the p99 span is ~39000 km, which smears the shell structure the
 * view exists to show. The whisker says "this orbit has extent, select it to see
 * the real numbers" without asserting a magnitude in data units.
 */
export const POPULATION_ECCENTRICITY_MARK_THRESHOLD = 0.05;
export const POPULATION_ECCENTRICITY_MARK_MAX_PX = 7;

export function eccentricityMarkPixels(eccentricity: number): number {
  if (eccentricity < POPULATION_ECCENTRICITY_MARK_THRESHOLD) return 0;
  const scaled = (eccentricity - POPULATION_ECCENTRICITY_MARK_THRESHOLD) /
    (1 - POPULATION_ECCENTRICITY_MARK_THRESHOLD);
  return Math.min(POPULATION_ECCENTRICITY_MARK_MAX_PX, 2 + scaled * POPULATION_ECCENTRICITY_MARK_MAX_PX);
}

export interface ExplorerPopulationViewport {
  /** Fraction of the inclination axis at the left edge. */
  offsetX: number;
  /** Fraction of the altitude axis at the bottom edge. */
  offsetY: number;
  /** 1 = whole axis visible. */
  zoom: number;
}

export const defaultPopulationViewport: ExplorerPopulationViewport = {
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
};

export function clampPopulationViewport(
  viewport: ExplorerPopulationViewport,
): ExplorerPopulationViewport {
  const zoom = Math.min(Math.max(viewport.zoom, 1), 220);
  const span = 1 / zoom;
  const limit = 1 - span;
  return {
    zoom,
    offsetX: Math.min(Math.max(viewport.offsetX, 0), Math.max(limit, 0)),
    offsetY: Math.min(Math.max(viewport.offsetY, 0), Math.max(limit, 0)),
  };
}

/** Points per bin, so density stays readable when marks would overlap. */
export function binPopulation(
  points: readonly ExplorerPopulationPoint[],
  bounds: ExplorerPopulationBounds,
  viewport: ExplorerPopulationViewport,
  columns: number,
  rows: number,
): { counts: Uint32Array; peak: number } {
  const counts = new Uint32Array(columns * rows);
  const span = 1 / viewport.zoom;
  let peak = 0;
  for (const point of points) {
    const ux = (inclinationToUnit(point.inclinationDeg) - viewport.offsetX) / span;
    const uy = (altitudeToUnit(point.semiMajorAltitudeKm, bounds) - viewport.offsetY) / span;
    if (ux < 0 || ux >= 1 || uy < 0 || uy >= 1) continue;
    const column = Math.min(columns - 1, (ux * columns) | 0);
    const row = Math.min(rows - 1, (uy * rows) | 0);
    const index = row * columns + column;
    const next = counts[index] + 1;
    counts[index] = next;
    if (next > peak) peak = next;
  }
  return { counts, peak };
}
