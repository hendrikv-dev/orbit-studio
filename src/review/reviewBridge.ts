import type { ExplorerCategoryId } from "../data/explorerCatalog";
import type { ExplorerRegimeFilter } from "../data/explorerFilters";
import type { ExplorerDiscoveryCollectionId } from "../data/explorerDiscovery";
import type { ExplorerRendererStats } from "../rendering/explorerRendererDiagnostics";

export const ORBIT_STUDIO_REVIEW_SCHEMA_VERSION = 4 as const;

export interface ExplorerReviewSelectedObject {
  id: string;
  name: string;
  selectionKind: "satellite" | "ground-station" | "constellation" | "catalog-object";
  catalogNumber: string | null;
  categoryId: ExplorerCategoryId;
}

export interface ExplorerReviewState {
  schemaVersion: typeof ORBIT_STUDIO_REVIEW_SCHEMA_VERSION;
  ready: boolean;
  workspace: "explorer";
  snapshotId: string;
  selectedYear: string;
  selectedTimelineTime: string;
  simulationTime: string;
  timelineAndSimulationAligned: boolean;
  visibleObjectCount: number;
  catalogObjectCount: number;
  catalogResultCount: number;
  renderableOrbitStateCount: number;
  exactHistoricalOrbitStateCount: number;
  reconstructedHistoricalOrbitStateCount: number;
  catalogOnlyObjectCount: number;
  resolvedExactOrbitStateCount: number;
  resolvedReconstructedOrbitStateCount: number;
  categoryCounts: Record<ExplorerCategoryId, number>;
  selectedObject: ExplorerReviewSelectedObject | null;
  query: string;
  discoveryCollectionId: ExplorerDiscoveryCollectionId;
  activeFilter: string;
  regimeFilter: ExplorerRegimeFilter;
  objectTypeFilters: ExplorerCategoryId[];
  playback: {
    isPlaying: boolean;
    speed: string;
    timeScale: number;
  };
  dataCoverage: {
    status:
      | "current-loaded"
      | "current-reference-only"
      | "historical-loaded"
      | "historical-not-loaded";
    label: string;
    sourceLabels: string[];
  };
  warningState:
    | "none"
    | "current-reference-only"
    | "historical-catalog-only"
    | "historical-not-loaded";
  renderer: ExplorerRendererStats & {
    settled: boolean;
    expectedRenderedInstanceCount: number;
  };
  datasets: {
    catalogVersion: string;
    currentCatalogMode: "local-acquired" | "release-reference-only";
    currentCatalogRecordCount: number;
    historicalDatasetVersion: string;
    historicalGeneratedAt: string | null;
    historicalSourceFingerprint: string | null;
  };
}

export function explorerHistoricalWarningState(
  state: Pick<
    ExplorerReviewState,
    "catalogObjectCount" | "renderableOrbitStateCount" | "dataCoverage"
  >,
): ExplorerReviewState["warningState"] {
  if (state.dataCoverage.status === "current-reference-only") {
    return "current-reference-only";
  }
  if (state.dataCoverage.status === "historical-not-loaded") {
    return "historical-not-loaded";
  }
  if (
    state.dataCoverage.status === "historical-loaded" &&
    state.catalogObjectCount > 0 &&
    state.renderableOrbitStateCount === 0
  ) {
    return "historical-catalog-only";
  }
  return "none";
}

export function mergeExplorerRendererState(
  baseState: ExplorerReviewState,
  simulationTime: string,
  renderer: ExplorerRendererStats,
): ExplorerReviewState {
  const timelineAndSimulationAligned = baseState.selectedTimelineTime === simulationTime;
  const simulationMs = Date.parse(simulationTime);
  const rendererSimulationMs = Date.parse(renderer.simulationTime ?? "");
  const currentBufferLagMs =
    Number.isFinite(simulationMs) && Number.isFinite(rendererSimulationMs)
      ? simulationMs - rendererSimulationMs
      : Number.POSITIVE_INFINITY;
  const selectedSatelliteAdjustment =
    baseState.selectedObject?.selectionKind === "satellite" ? 1 : 0;
  const expectedRenderedInstanceCount = Math.max(
    0,
    baseState.visibleObjectCount - selectedSatelliteAdjustment,
  );
  const rendererSettled =
    renderer.batchCount > 0 &&
    renderer.simulationTime === simulationTime &&
    renderer.authoritativeSimulationTime === simulationTime &&
    currentBufferLagMs === 0 &&
    renderer.renderQueueSize === baseState.visibleObjectCount &&
    renderer.gpuInstanceCount === baseState.visibleObjectCount &&
    renderer.renderedInstanceCount === expectedRenderedInstanceCount;
  const nextState = {
    ...baseState,
    ready: timelineAndSimulationAligned && rendererSettled,
    simulationTime,
    timelineAndSimulationAligned,
    renderer: {
      ...renderer,
      bufferLagMs: currentBufferLagMs,
      settled: rendererSettled,
      expectedRenderedInstanceCount,
    },
  };
  return {
    ...nextState,
    warningState: explorerHistoricalWarningState(nextState),
  };
}

export interface OrbitStudioReviewBridge {
  schemaVersion: typeof ORBIT_STUDIO_REVIEW_SCHEMA_VERSION;
  getState: () => ExplorerReviewState;
  setTimelineYear: (year: number | "current") => void;
  setTimelineSnapshot: (snapshotId: string) => void;
  setRegimeFilter: (filter: ExplorerRegimeFilter) => void;
  clearReviewContext: () => void;
  setPlayback: (playing: boolean) => void;
  setPlaybackSpeed: (speed: "1x" | "10x" | "100x" | "1000x" | "max") => void;
}

export function isOrbitStudioReviewMode(search?: string): boolean {
  const query = search ?? (
    typeof window === "undefined" ? "" : window.location.search
  );

  return new URLSearchParams(query).get("review") === "1";
}
