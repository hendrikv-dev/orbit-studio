import { afterEach, describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  createExplorerScenario,
  explorerTimelineSnapshots,
} from "../data/explorerCatalog";
import { propagateSatellite } from "../lib/propagation";
import { explorerHistoricalWarningState } from "../review/reviewBridge";
import { eciToThreeVector } from "./coordinates";
import { reframeEarthForViewport } from "./CameraRig";
import {
  countScreenVisiblePointInstances,
  explorerCameraState,
  pointPositionDigest,
  publishExplorerRendererBatch,
  publishExplorerRendererBatchTiming,
  readExplorerRendererStats,
  renderedProvenanceCounts,
  resetExplorerRendererDiagnostics,
} from "./explorerRendererDiagnostics";

function milestoneBuffers(snapshot: (typeof explorerTimelineSnapshots)[number]) {
  const scenario = createExplorerScenario(snapshot);
  const positions = new Float32Array(scenario.satellites.length * 3);
  const scales = new Float32Array(scenario.satellites.length).fill(1);
  const date = new Date(snapshot.timestampIso);
  scenario.satellites.forEach((satellite, index) => {
    const position = eciToThreeVector(propagateSatellite(satellite, date).positionKm);
    positions.set(position.toArray(), index * 3);
  });
  return { positions, scales, scenario };
}

function explorerCamera() {
  const frame = reframeEarthForViewport("normal");
  const camera = new PerspectiveCamera(frame.fov, 16 / 9, 20, 300_000);
  camera.position.copy(frame.position);
  camera.lookAt(new Vector3());
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

afterEach(() => resetExplorerRendererDiagnostics());

describe("Explorer renderer diagnostics", () => {
  it("proves every historical milestone submits its resolved reconstructed population", () => {
    const camera = explorerCamera();
    for (const snapshot of explorerTimelineSnapshots.slice(0, -1)) {
      const { positions, scales, scenario } = milestoneBuffers(snapshot);
      const provenance = renderedProvenanceCounts(scenario.satellites, scales);
      expect(provenance.reconstructedHistoricalRenderedCount, snapshot.id)
        .toBe(scenario.satellites.length);
      expect(countScreenVisiblePointInstances(positions, scales, camera), snapshot.id)
        .toBeGreaterThan(0);
    }
  });

  it("produces the same position buffer for a timestamp at every playback speed", () => {
    const snapshot = explorerTimelineSnapshots[4];
    const digests = [1, 10, 100, 1_000, 2_500].map(() => {
      const { positions, scales } = milestoneBuffers(snapshot);
      return pointPositionDigest(positions, scales);
    });
    expect(new Set(digests).size).toBe(1);
  });

  it("aggregates the GPU-facing batches rather than resolver metadata", () => {
    const camera = explorerCamera();
    publishExplorerRendererBatch({
      batchId: "background",
      simulationTime: "1969-07-16T13:32:00.000Z",
      authoritativeSimulationTime: "1969-07-16T13:32:00.000Z",
      bufferLagMs: 0,
      renderQueueSize: 10,
      gpuInstanceCount: 10,
      renderedInstanceCount: 9,
      visibleInstanceCount: 4,
      currentSourceRenderedCount: 0,
      exactHistoricalRenderedCount: 0,
      nearestHistoricalRenderedCount: 0,
      reconstructedHistoricalRenderedCount: 9,
      positionDigest: "first",
      camera: explorerCameraState(camera),
    });
    publishExplorerRendererBatchTiming(
      "background",
      "1969-07-16T13:32:00.250Z",
      "1969-07-16T13:32:00.300Z",
    );
    publishExplorerRendererBatch({
      batchId: "priority",
      simulationTime: "1969-07-16T13:32:00.000Z",
      authoritativeSimulationTime: "1969-07-16T13:32:00.000Z",
      bufferLagMs: 0,
      renderQueueSize: 2,
      gpuInstanceCount: 2,
      renderedInstanceCount: 2,
      visibleInstanceCount: 1,
      currentSourceRenderedCount: 0,
      exactHistoricalRenderedCount: 0,
      nearestHistoricalRenderedCount: 0,
      reconstructedHistoricalRenderedCount: 2,
      positionDigest: "second",
      camera: explorerCameraState(camera),
    });
    expect(readExplorerRendererStats()).toMatchObject({
      batchCount: 2,
      authoritativeSimulationTime: null,
      bufferLagMs: 50,
      renderQueueSize: 12,
      gpuInstanceCount: 12,
      renderedInstanceCount: 11,
      visibleInstanceCount: 5,
      reconstructedHistoricalRenderedCount: 11,
    });
  });

  it("only reports the catalog-only warning when no physical states resolve", () => {
    expect(explorerHistoricalWarningState({
      catalogObjectCount: 25,
      renderableOrbitStateCount: 20,
      dataCoverage: {
        status: "historical-loaded",
        label: "Historical catalog loaded",
        sourceLabels: [],
      },
    })).toBe("none");
    expect(explorerHistoricalWarningState({
      catalogObjectCount: 25,
      renderableOrbitStateCount: 0,
      dataCoverage: {
        status: "historical-loaded",
        label: "Historical catalog loaded",
        sourceLabels: [],
      },
    })).toBe("historical-catalog-only");
  });
});
