import { propagateTwoBody } from "../physics/kepler";
import { tleToCartesian } from "../physics/tle";
import { isRenderableCartesianState } from "../lib/propagation";
import type { CatalogPropagationSatellite } from "./catalogPropagationMessages";

export interface CatalogPropagationWindow {
  startPositions: Float32Array;
  startVelocities: Float32Array;
  endPositions: Float32Array;
  endVelocities: Float32Array;
  valid: Uint8Array;
}

export const CATALOG_PROPAGATION_WINDOW_MS = 40_000;
export const CATALOG_INTERPOLATION_SEGMENT_MS = 240_000;
export const CATALOG_PREDICTION_BEHIND_SEGMENTS = 1;
export const CATALOG_PREDICTION_AHEAD_SEGMENTS = 3;
export const CATALOG_REQUEST_LEAD_SEGMENTS = 1;
// Cold worker startup includes module initialization, catalog deserialization, and contention
// with the first GPU upload. The predictive horizon must budget for that path rather than using
// the much lower steady-state propagation duration.
export const CATALOG_INITIAL_WORKER_LATENCY_MS = 2_000;

export interface CatalogPropagationHorizon {
  sampleTimestampsMs: Float64Array;
  positions: Float32Array;
  velocities: Float32Array;
  valid: Uint8Array;
}

export type CatalogPropagationHorizonDisposition =
  | "activate"
  | "stage"
  | "discard";

export function catalogPropagationHorizonCovers(
  sampleTimestampsMs: ArrayLike<number> | null,
  timestampMs: number,
): boolean {
  return Boolean(
    sampleTimestampsMs &&
    sampleTimestampsMs.length >= 2 &&
    timestampMs >= sampleTimestampsMs[0] &&
    timestampMs <= sampleTimestampsMs[sampleTimestampsMs.length - 1],
  );
}

export function catalogPropagationHorizonDisposition(
  currentSampleTimestampsMs: ArrayLike<number> | null,
  nextSampleTimestampsMs: ArrayLike<number> | null,
  timestampMs: number,
): CatalogPropagationHorizonDisposition {
  if (catalogPropagationHorizonCovers(nextSampleTimestampsMs, timestampMs)) {
    return "activate";
  }
  if (
    nextSampleTimestampsMs &&
    nextSampleTimestampsMs.length >= 2 &&
    timestampMs < nextSampleTimestampsMs[0] &&
    catalogPropagationHorizonCovers(currentSampleTimestampsMs, timestampMs)
  ) {
    return "stage";
  }
  // An expired or malformed result must never replace a horizon that still renders the
  // authoritative time. When no current horizon exists, discarding also keeps the renderer in
  // its explicit stale-buffer state until a covering result arrives.
  return "discard";
}

export function catalogPropagationHorizonNeedsRefresh(
  sampleTimestampsMs: ArrayLike<number> | null,
  playbackTimestampMs: number,
  playbackTimeScale: number,
  estimatedWorkerLatencyMs: number,
): boolean {
  if (!catalogPropagationHorizonCovers(sampleTimestampsMs, playbackTimestampMs)) {
    return true;
  }
  const requiredCoverageEndMs =
    playbackTimestampMs +
    Math.max(1, Math.abs(playbackTimeScale)) *
      Math.max(0, estimatedWorkerLatencyMs) +
    CATALOG_REQUEST_LEAD_SEGMENTS * CATALOG_INTERPOLATION_SEGMENT_MS;
  return (
    sampleTimestampsMs![sampleTimestampsMs!.length - 1] <
    requiredCoverageEndMs
  );
}

export function catalogPropagationInputsEqual(
  left: Pick<CatalogPropagationSatellite, "propagationMode" | "keplerian" | "tle">,
  right: Pick<CatalogPropagationSatellite, "propagationMode" | "keplerian" | "tle">,
): boolean {
  if (left.propagationMode !== right.propagationMode) return false;
  if (left.propagationMode === "sgp4" && left.tle && right.tle) {
    return left.tle.line1 === right.tle.line1 && left.tle.line2 === right.tle.line2;
  }
  if (Boolean(left.tle) !== Boolean(right.tle) && left.propagationMode === "sgp4") {
    return false;
  }
  const leftElements = left.keplerian;
  const rightElements = right.keplerian;
  return (
    leftElements.semiMajorAxisKm === rightElements.semiMajorAxisKm &&
    leftElements.eccentricity === rightElements.eccentricity &&
    leftElements.inclinationDeg === rightElements.inclinationDeg &&
    leftElements.raanDeg === rightElements.raanDeg &&
    leftElements.argumentOfPeriapsisDeg === rightElements.argumentOfPeriapsisDeg &&
    leftElements.trueAnomalyDeg === rightElements.trueAnomalyDeg &&
    leftElements.epoch === rightElements.epoch
  );
}

export function catalogPropagationWindowBounds(timestampMs: number): {
  startTimestampMs: number;
  endTimestampMs: number;
} {
  if (!Number.isFinite(timestampMs)) {
    throw new RangeError("Catalog propagation timestamp must be finite.");
  }
  const startTimestampMs =
    Math.floor(timestampMs / CATALOG_PROPAGATION_WINDOW_MS) *
    CATALOG_PROPAGATION_WINDOW_MS;
  return {
    startTimestampMs,
    endTimestampMs: startTimestampMs + CATALOG_PROPAGATION_WINDOW_MS,
  };
}

export function catalogPropagationHorizonTimestamps(
  playbackTimestampMs: number,
  playbackTimeScale: number,
  estimatedWorkerLatencyMs: number,
): Float64Array {
  if (
    !Number.isFinite(playbackTimestampMs) ||
    !Number.isFinite(playbackTimeScale) ||
    !Number.isFinite(estimatedWorkerLatencyMs)
  ) {
    throw new RangeError("Catalog propagation horizon inputs must be finite.");
  }
  const predictedCompletionMs =
    playbackTimestampMs +
    Math.max(1, Math.abs(playbackTimeScale)) * Math.max(0, estimatedWorkerLatencyMs);
  const playbackSegmentStartMs =
    Math.floor(playbackTimestampMs / CATALOG_INTERPOLATION_SEGMENT_MS) *
    CATALOG_INTERPOLATION_SEGMENT_MS;
  const startTimestampMs =
    playbackSegmentStartMs -
    CATALOG_PREDICTION_BEHIND_SEGMENTS * CATALOG_INTERPOLATION_SEGMENT_MS;
  const requiredEndTimestampMs =
    predictedCompletionMs +
    CATALOG_PREDICTION_AHEAD_SEGMENTS * CATALOG_INTERPOLATION_SEGMENT_MS;
  const segmentCount = Math.max(
    CATALOG_PREDICTION_BEHIND_SEGMENTS + CATALOG_PREDICTION_AHEAD_SEGMENTS,
    Math.ceil(
      (requiredEndTimestampMs - startTimestampMs) /
        CATALOG_INTERPOLATION_SEGMENT_MS,
    ),
  );
  return Float64Array.from(
    { length: segmentCount + 1 },
    (_, index) => startTimestampMs + index * CATALOG_INTERPOLATION_SEGMENT_MS,
  );
}

function propagateCatalogSatellite(
  satellite: CatalogPropagationSatellite,
  targetDate: Date,
) {
  return satellite.propagationMode === "sgp4" && satellite.tle
    ? tleToCartesian(satellite.tle, targetDate)
    : propagateTwoBody(satellite.keplerian, targetDate);
}

export function propagateCatalogWindow(
  satellites: readonly CatalogPropagationSatellite[],
  startTimestampMs: number,
  endTimestampMs: number,
): CatalogPropagationWindow {
  const startPositions = new Float32Array(satellites.length * 3);
  const startVelocities = new Float32Array(satellites.length * 3);
  const endPositions = new Float32Array(satellites.length * 3);
  const endVelocities = new Float32Array(satellites.length * 3);
  const valid = new Uint8Array(satellites.length);
  const startDate = new Date(startTimestampMs);
  const endDate = new Date(endTimestampMs);

  satellites.forEach((satellite, index) => {
    try {
      const startState = propagateCatalogSatellite(satellite, startDate);
      const endState = propagateCatalogSatellite(satellite, endDate);
      if (!isRenderableCartesianState(startState) || !isRenderableCartesianState(endState)) {
        return;
      }

      const offset = index * 3;
      startPositions.set(startState.positionKm, offset);
      startVelocities.set(startState.velocityKmS, offset);
      endPositions.set(endState.positionKm, offset);
      endVelocities.set(endState.velocityKmS, offset);
      valid[index] = 1;
    } catch {
      // A zero validity flag tells the renderer to omit unsupported physical states.
    }
  });

  return {
    startPositions,
    startVelocities,
    endPositions,
    endVelocities,
    valid,
  };
}

export function propagateCatalogHorizon(
  satellites: readonly CatalogPropagationSatellite[],
  sampleTimestampsMs: Float64Array,
): CatalogPropagationHorizon {
  if (sampleTimestampsMs.length < 2) {
    throw new RangeError("Catalog propagation requires at least two horizon samples.");
  }
  const sampleStride = satellites.length * 3;
  const positions = new Float32Array(sampleTimestampsMs.length * sampleStride);
  const velocities = new Float32Array(sampleTimestampsMs.length * sampleStride);
  const valid = new Uint8Array(satellites.length);

  satellites.forEach((satellite, satelliteIndex) => {
    let satelliteValid = true;
    for (let sampleIndex = 0; sampleIndex < sampleTimestampsMs.length; sampleIndex += 1) {
      try {
        const state = propagateCatalogSatellite(
          satellite,
          new Date(sampleTimestampsMs[sampleIndex]),
        );
        if (!isRenderableCartesianState(state)) {
          satelliteValid = false;
          break;
        }
        const offset = sampleIndex * sampleStride + satelliteIndex * 3;
        positions.set(state.positionKm, offset);
        velocities.set(state.velocityKmS, offset);
      } catch {
        satelliteValid = false;
        break;
      }
    }
    valid[satelliteIndex] = satelliteValid ? 1 : 0;
  });

  return { sampleTimestampsMs, positions, velocities, valid };
}
