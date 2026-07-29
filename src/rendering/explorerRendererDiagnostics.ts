import { Camera, Frustum, Matrix4, Vector3 } from "three";
import type { SatelliteModel } from "../lib/scenario";
import { EARTH_RADIUS_KM } from "../physics/constants";

export type ExplorerRenderedProvenance =
  | "current-source"
  | "exact-historical"
  | "nearest-historical"
  | "reconstructed-historical";

export interface ExplorerCameraState {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  fov: number | null;
}

export interface ExplorerRendererBatchStats {
  batchId: string;
  simulationTime: string;
  authoritativeSimulationTime: string;
  bufferLagMs: number;
  renderQueueSize: number;
  gpuInstanceCount: number;
  renderedInstanceCount: number;
  visibleInstanceCount: number;
  currentSourceRenderedCount: number;
  exactHistoricalRenderedCount: number;
  nearestHistoricalRenderedCount: number;
  reconstructedHistoricalRenderedCount: number;
  positionDigest: string;
  camera: ExplorerCameraState;
}

export interface ExplorerRendererStats {
  batchCount: number;
  simulationTime: string | null;
  authoritativeSimulationTime: string | null;
  bufferLagMs: number;
  renderQueueSize: number;
  gpuInstanceCount: number;
  renderedInstanceCount: number;
  visibleInstanceCount: number;
  currentSourceRenderedCount: number;
  exactHistoricalRenderedCount: number;
  nearestHistoricalRenderedCount: number;
  reconstructedHistoricalRenderedCount: number;
  positionDigest: string;
  camera: ExplorerCameraState | null;
}

const batches = new Map<string, ExplorerRendererBatchStats>();
const projectionMatrix = new Matrix4();
const frustum = new Frustum();
const point = new Vector3();
const cameraToPoint = new Vector3();

function rounded(value: number, precision = 1_000): number {
  return Math.round(value * precision) / precision;
}

export function explorerCameraState(camera: Camera): ExplorerCameraState {
  const perspective = camera as Camera & { fov?: number };
  return {
    position: [
      rounded(camera.position.x),
      rounded(camera.position.y),
      rounded(camera.position.z),
    ],
    quaternion: [
      rounded(camera.quaternion.x, 100_000),
      rounded(camera.quaternion.y, 100_000),
      rounded(camera.quaternion.z, 100_000),
      rounded(camera.quaternion.w, 100_000),
    ],
    fov: typeof perspective.fov === "number" ? rounded(perspective.fov) : null,
  };
}

function isOccludedByEarth(camera: Camera, position: Vector3): boolean {
  cameraToPoint.copy(position).sub(camera.position);
  const lengthSquared = cameraToPoint.lengthSq();
  if (lengthSquared === 0) return false;
  const closest = Math.max(
    0,
    Math.min(1, -camera.position.dot(cameraToPoint) / lengthSquared),
  );
  if (closest <= 0 || closest >= 1) return false;
  point.copy(cameraToPoint).multiplyScalar(closest).add(camera.position);
  return point.lengthSq() < EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

export function countScreenVisiblePointInstances(
  positions: Float32Array,
  pointScales: Float32Array,
  camera: Camera,
): number {
  camera.updateMatrixWorld();
  projectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projectionMatrix);
  let visible = 0;

  for (let index = 0; index < pointScales.length; index += 1) {
    if (!(pointScales[index] > 0)) continue;
    point.set(
      positions[index * 3],
      positions[index * 3 + 1],
      positions[index * 3 + 2],
    );
    if (frustum.containsPoint(point) && !isOccludedByEarth(camera, point)) visible += 1;
  }

  return visible;
}

export function pointPositionDigest(
  positions: Float32Array,
  pointScales: Float32Array,
): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < pointScales.length; index += 1) {
    if (!(pointScales[index] > 0)) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      const quantized = Math.round(positions[index * 3 + axis] * 10);
      hash ^= quantized;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function renderedProvenanceCounts(
  satellites: readonly SatelliteModel[],
  pointScales: Float32Array,
): Pick<
  ExplorerRendererBatchStats,
  | "currentSourceRenderedCount"
  | "exactHistoricalRenderedCount"
  | "nearestHistoricalRenderedCount"
  | "reconstructedHistoricalRenderedCount"
> {
  let currentSourceRenderedCount = 0;
  let exactHistoricalRenderedCount = 0;
  let nearestHistoricalRenderedCount = 0;
  let reconstructedHistoricalRenderedCount = 0;

  satellites.forEach((satellite, index) => {
    if (!(pointScales[index] > 0)) return;
    switch (satellite.catalogMetadata?.orbitStateProvenance) {
      case "exact-historical":
        exactHistoricalRenderedCount += 1;
        break;
      case "nearest-historical":
        nearestHistoricalRenderedCount += 1;
        break;
      case "reconstructed-historical":
        reconstructedHistoricalRenderedCount += 1;
        break;
      default:
        currentSourceRenderedCount += 1;
    }
  });

  return {
    currentSourceRenderedCount,
    exactHistoricalRenderedCount,
    nearestHistoricalRenderedCount,
    reconstructedHistoricalRenderedCount,
  };
}

export function publishExplorerRendererBatch(stats: ExplorerRendererBatchStats): void {
  batches.set(stats.batchId, stats);
}

export function publishExplorerRendererBatchTiming(
  batchId: string,
  simulationTime: string,
  authoritativeSimulationTime: string,
): void {
  const batch = batches.get(batchId);
  if (!batch) return;
  batches.set(batchId, {
    ...batch,
    simulationTime,
    authoritativeSimulationTime,
    bufferLagMs: Date.parse(authoritativeSimulationTime) - Date.parse(simulationTime),
  });
}

export function removeExplorerRendererBatch(batchId: string): void {
  batches.delete(batchId);
}

export function resetExplorerRendererDiagnostics(): void {
  batches.clear();
}

export function readExplorerRendererStats(): ExplorerRendererStats {
  const ordered = [...batches.values()].sort((left, right) =>
    left.batchId.localeCompare(right.batchId),
  );
  const timestamps = new Set(ordered.map((batch) => batch.simulationTime));
  const authoritativeTimestamps = new Set(
    ordered.map((batch) => batch.authoritativeSimulationTime),
  );
  const positionDigest = ordered
    .map((batch) => `${batch.batchId}:${batch.positionDigest}`)
    .join("|");

  return ordered.reduce<ExplorerRendererStats>(
    (aggregate, batch) => ({
      batchCount: aggregate.batchCount + 1,
      simulationTime: timestamps.size === 1 ? batch.simulationTime : null,
      authoritativeSimulationTime:
        authoritativeTimestamps.size === 1 ? batch.authoritativeSimulationTime : null,
      bufferLagMs: Math.max(aggregate.bufferLagMs, Math.abs(batch.bufferLagMs)),
      renderQueueSize: aggregate.renderQueueSize + batch.renderQueueSize,
      gpuInstanceCount: aggregate.gpuInstanceCount + batch.gpuInstanceCount,
      renderedInstanceCount: aggregate.renderedInstanceCount + batch.renderedInstanceCount,
      visibleInstanceCount: aggregate.visibleInstanceCount + batch.visibleInstanceCount,
      currentSourceRenderedCount:
        aggregate.currentSourceRenderedCount + batch.currentSourceRenderedCount,
      exactHistoricalRenderedCount:
        aggregate.exactHistoricalRenderedCount + batch.exactHistoricalRenderedCount,
      nearestHistoricalRenderedCount:
        aggregate.nearestHistoricalRenderedCount + batch.nearestHistoricalRenderedCount,
      reconstructedHistoricalRenderedCount:
        aggregate.reconstructedHistoricalRenderedCount +
        batch.reconstructedHistoricalRenderedCount,
      positionDigest,
      camera: aggregate.camera ?? batch.camera,
    }),
    {
      batchCount: 0,
      simulationTime: null,
      authoritativeSimulationTime: null,
      bufferLagMs: 0,
      renderQueueSize: 0,
      gpuInstanceCount: 0,
      renderedInstanceCount: 0,
      visibleInstanceCount: 0,
      currentSourceRenderedCount: 0,
      exactHistoricalRenderedCount: 0,
      nearestHistoricalRenderedCount: 0,
      reconstructedHistoricalRenderedCount: 0,
      positionDigest,
      camera: null,
    },
  );
}
