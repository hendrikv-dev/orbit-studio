import type { ExplorerCatalogEntry, ExplorerCategoryId } from "./explorerCatalog";
import { explorerConstellationArchitectureFor } from "./explorerConstellationArchitecture";

export type ExplorerRegimeFilter = "all" | "leo" | "meo" | "geo" | "heo";

type ExplorerOrbitalRegime = Exclude<ExplorerRegimeFilter, "all">;

export interface ExplorerFilterConflict {
  objectType: boolean;
  regime: boolean;
}

function explorerRegimeForOrbit(
  altitudeKm: number,
  eccentricity: number,
): ExplorerOrbitalRegime {
  if (Math.abs(altitudeKm - 35_786) < 3_000 && eccentricity < 0.18) return "geo";
  if (eccentricity >= 0.18 || altitudeKm >= 30_000) return "heo";
  if (altitudeKm <= 2_000) return "leo";
  return "meo";
}

export function explorerRegimesForEntry(
  entry: ExplorerCatalogEntry,
): ReadonlySet<ExplorerOrbitalRegime> {
  if (entry.orbit) {
    return new Set([
      explorerRegimeForOrbit(entry.orbit.altitudeKm, entry.orbit.eccentricity),
    ]);
  }

  if (entry.selectionKind === "constellation") {
    const architecture = explorerConstellationArchitectureFor(entry.id);
    if (architecture) {
      return new Set(
        architecture.shells.map((shell) => explorerRegimeForOrbit(shell.altitudeKm, 0)),
      );
    }
  }

  return new Set();
}

export function explorerRegimeForEntry(
  entry: ExplorerCatalogEntry,
): ExplorerOrbitalRegime | null {
  const regimes = [...explorerRegimesForEntry(entry)];
  return regimes.length === 1 ? regimes[0] : null;
}

export function explorerEntryMatchesFilters(
  entry: ExplorerCatalogEntry,
  regimeFilter: ExplorerRegimeFilter,
  typeFilters: ReadonlySet<ExplorerCategoryId>,
): boolean {
  const typeMatches = typeFilters.size === 0 || typeFilters.has(entry.categoryId);
  const regimeMatches =
    regimeFilter === "all" || explorerRegimesForEntry(entry).has(regimeFilter);

  return typeMatches && regimeMatches;
}

export function explorerFilterConflict(
  entry: ExplorerCatalogEntry,
  regimeFilter: ExplorerRegimeFilter,
  typeFilters: ReadonlySet<ExplorerCategoryId>,
): ExplorerFilterConflict | null {
  const objectType = typeFilters.size > 0 && !typeFilters.has(entry.categoryId);
  const regime =
    regimeFilter !== "all" && !explorerRegimesForEntry(entry).has(regimeFilter);

  return objectType || regime ? { objectType, regime } : null;
}

export function explorerFilterChangeShouldReframe(selectedObjectId: string | null): boolean {
  return selectedObjectId === null;
}

/**
 * Entries the Explorer scene and the population view draw.
 *
 * Lives here rather than in the view because the population totals are derived
 * from it too: when the count used one definition and the plot another, the
 * label read 33,477 against 33,474 points.
 */
export function isExplorerSceneEntry(entry: ExplorerCatalogEntry): boolean {
  return (
    entry.selectionKind === "satellite" ||
    entry.selectionKind === "ground-station" ||
    entry.selectionKind === "constellation"
  );
}
