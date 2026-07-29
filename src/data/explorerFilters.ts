import type { ExplorerCatalogEntry, ExplorerCategoryId } from "./explorerCatalog";

export type ExplorerRegimeFilter = "all" | "leo" | "meo" | "geo" | "heo";

export interface ExplorerFilterConflict {
  objectType: boolean;
  regime: boolean;
}

export function explorerRegimeForEntry(
  entry: ExplorerCatalogEntry,
): Exclude<ExplorerRegimeFilter, "all"> | null {
  if (!entry.orbit) return null;

  const altitudeKm = entry.orbit.altitudeKm;
  const eccentricity = entry.orbit.eccentricity;

  if (Math.abs(altitudeKm - 35_786) < 3_000 && eccentricity < 0.18) return "geo";
  if (eccentricity >= 0.18 || altitudeKm >= 30_000) return "heo";
  if (altitudeKm <= 2_000) return "leo";
  return "meo";
}

export function explorerEntryMatchesFilters(
  entry: ExplorerCatalogEntry,
  regimeFilter: ExplorerRegimeFilter,
  typeFilters: ReadonlySet<ExplorerCategoryId>,
): boolean {
  const typeMatches = typeFilters.size === 0 || typeFilters.has(entry.categoryId);
  const regimeMatches = regimeFilter === "all" || explorerRegimeForEntry(entry) === regimeFilter;

  return typeMatches && regimeMatches;
}

export function explorerFilterConflict(
  entry: ExplorerCatalogEntry,
  regimeFilter: ExplorerRegimeFilter,
  typeFilters: ReadonlySet<ExplorerCategoryId>,
): ExplorerFilterConflict | null {
  const objectType = typeFilters.size > 0 && !typeFilters.has(entry.categoryId);
  const regime = regimeFilter !== "all" && explorerRegimeForEntry(entry) !== regimeFilter;

  return objectType || regime ? { objectType, regime } : null;
}

export function explorerFilterChangeShouldReframe(selectedObjectId: string | null): boolean {
  return selectedObjectId === null;
}
