import type { ExplorerCatalogEntry, ExplorerCatalogSnapshotView } from "./explorerCatalog";
import { isExplorerSceneEntry } from "./explorerFilters";
import { explorerPopulationPoints } from "./explorerPopulation";

/**
 * The population totals Explorer shows, and what each one counts.
 *
 * Three surfaces reported three different numbers for the same snapshot —
 * 33,489 in Explore, 33,474 in the population view, 33,468 on the timeline —
 * with nothing to say why. Every one of them was right. They count different
 * sets, and the sets genuinely differ:
 *
 *   - 33,468 GCAT objects carry a reconstructed orbit and can be drawn;
 *   - 21 more are in GCAT without usable orbital parameters, so they are
 *     catalog members that cannot be placed anywhere;
 *   - 6 curated reference orbits are drawable but are not GCAT catalog members.
 *
 * So the catalog total includes 21 objects the population view cannot plot, and
 * the plottable total includes 6 objects the catalog total does not contain.
 * Making the three agree would require throwing away one of those facts. They
 * are derived here instead, from one place, so a label can say which set it
 * means and the arithmetic between them stays checkable.
 */

export interface ExplorerCountBreakdown {
  /** GCAT catalog members in this snapshot, drawable or not. */
  catalogObjects: number;
  /** Catalog members with a reconstructed orbit, so they can be drawn. */
  withReconstructedOrbit: number;
  /** Catalog members with no usable orbital parameters. */
  catalogOnly: number;
  /** Curated reference orbits: drawable, but not GCAT catalog members. */
  curatedReference: number;
  /** Everything the population view can plot. */
  plottable: number;
}

export function explorerCountBreakdown(view: ExplorerCatalogSnapshotView): ExplorerCountBreakdown {
  const coverage = view.dataCoverage;
  const catalogObjects = coverage.catalogObjectCount;
  const withReconstructedOrbit = coverage.renderableOrbitStateCount;
  const catalogOnly = coverage.catalogOnlyObjectCount ?? 0;
  // Derived through the same function the population view uses, so the label
  // and the plot cannot disagree. Counting records with an orbit gave 33,477:
  // three entries carry orbital data but never become points.
  const plottable = explorerPopulationPoints(
    (view.records as readonly ExplorerCatalogEntry[]).filter(isExplorerSceneEntry),
  ).length;
  return {
    catalogObjects,
    withReconstructedOrbit,
    catalogOnly,
    curatedReference: plottable - withReconstructedOrbit,
    plottable,
  };
}

/**
 * One sentence reconciling the totals, shown where they are most likely to be
 * compared. Only mentions a difference that actually exists.
 */
export function explorerCountReconciliation(counts: ExplorerCountBreakdown): string | null {
  const clauses: string[] = [];
  if (counts.catalogOnly > 0) {
    clauses.push(
      `${counts.catalogOnly.toLocaleString()} catalog ${
        counts.catalogOnly === 1 ? "object has" : "objects have"
      } no usable orbital parameters and cannot be drawn`,
    );
  }
  if (counts.curatedReference > 0) {
    clauses.push(
      `${counts.curatedReference.toLocaleString()} curated reference ${
        counts.curatedReference === 1 ? "orbit is" : "orbits are"
      } drawn but are not GCAT catalog members`,
    );
  }
  if (clauses.length === 0) return null;
  return `Totals differ by set: ${clauses.join("; ")}.`;
}
