import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  PointsMaterial,
  ShaderMaterial,
} from "three";
import type { ExplorerMarkerStyle } from "../data/explorerVisuals";
import type { SatelliteModel } from "../lib/scenario";
import { isRenderableCartesianState, propagateSatellite } from "../lib/propagation";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { readScenePlaybackTimeMs } from "./sceneMotion";
import type { CatalogPropagationResultMessage } from "./catalogPropagationMessages";
import { writeInterpolatedThreePositions } from "./catalogMotion";
import { cachePopulationScenePosition } from "./populationMotion";
import {
  CATALOG_INITIAL_WORKER_LATENCY_MS,
  catalogPropagationHorizonDisposition,
  catalogPropagationHorizonCovers,
  catalogPropagationHorizonNeedsRefresh,
  catalogPropagationHorizonTimestamps,
  catalogPropagationInputsEqual,
} from "./catalogPropagation";
import {
  countScreenVisiblePointInstances,
  explorerCameraState,
  pointPositionDigest,
  publishExplorerRendererBatch,
  publishExplorerRendererBatchTiming,
  removeExplorerRendererBatch,
  renderedProvenanceCounts,
} from "./explorerRendererDiagnostics";

interface ExplorerSatellitePointsProps {
  diagnosticsBatchId?: string;
  satellites: SatelliteModel[];
  markerStyles?: ReadonlyMap<string, ExplorerMarkerStyle>;
  animate: boolean;
  simulationTime: string;
  playbackTimeScale: number;
  hiddenSatelliteIds?: ReadonlySet<string>;
  cacheSatelliteIds?: ReadonlySet<string>;
  size?: number;
  sizeAttenuation?: boolean;
  opacity?: number;
  colorMultiplier?: number;
  desaturate?: number;
  updateIntervalMs?: number;
  onSelect: (satelliteId: string) => void;
  onHover: (satelliteId: string | null) => void;
}

const DEFAULT_UPDATE_INTERVAL_MS = 80;
const WORKER_SATELLITE_THRESHOLD = 512;
// Reserve CPU capacity for React, Three.js, and GPU uploads. Saturating every logical core with
// propagation workers creates visible main-thread stalls even though aggregate propagation
// throughput increases.
const MAX_WORKER_COUNT = 8;
const MIN_WORKER_INTERVAL_MS = 16;
// Full-population projection and digest checks are intentionally slower than the lightweight
// per-frame UTC bridge. Four checks per second measurably contend with propagation workers at
// 2,500×; two still provide multiple independent observations in the review window.
const DIAGNOSTICS_INTERVAL_MS = 500;
const FAR_ZOOM_RATIO = 6.8;
const MID_ZOOM_RATIO = 3.5;
const FIXED_POINT_VERTEX_SHADER = `
  attribute vec3 color;
  attribute float pointScale;
  uniform float pointSize;
  uniform float earthRadiusKm;
  varying vec3 vColor;
  varying float vAlphaScale;

  void main() {
    vColor = color;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float cameraDistanceRatio = distance(cameraPosition, worldPosition.xyz) / earthRadiusKm;
    float closeSupport = 1.0 - smoothstep(3.2, 6.4, cameraDistanceRatio);
    float farSupport = smoothstep(7.0, 14.0, cameraDistanceRatio);
    float mediumControl =
      smoothstep(5.8, 8.8, cameraDistanceRatio) *
      (1.0 - smoothstep(11.8, 15.0, cameraDistanceRatio));
    float distanceScale = 0.96 + closeSupport * 0.24 + farSupport * 0.12 - mediumControl * 0.08;
    vAlphaScale = clamp(0.9 + closeSupport * 0.16 + farSupport * 0.08 - mediumControl * 0.06, 0.82, 1.12);
    gl_PointSize = clamp(pointSize * pointScale * distanceScale, 1.65, 6.2);
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const FIXED_POINT_FRAGMENT_SHADER = `
  uniform float pointOpacity;
  varying vec3 vColor;
  varying float vAlphaScale;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    if (radius > 0.5) discard;

    float core = 1.0 - smoothstep(0.0, 0.34, radius);
    float edge = (1.0 - smoothstep(0.34, 0.5, radius)) * 0.32;
    float alpha = pointOpacity * vAlphaScale * min(1.0, core + edge);
    vec3 color = vColor * (0.9 + core * 0.28);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;
interface PropagationWorkerShard {
  worker: Worker;
  workerIndex: number;
  satelliteOffset: number;
  sampleTimestampsMs: Float64Array | null;
  positions: Float32Array | null;
  velocities: Float32Array | null;
  valid: Uint8Array | null;
  pendingSampleTimestampsMs: Float64Array | null;
  pendingPositions: Float32Array | null;
  pendingVelocities: Float32Array | null;
  pendingValid: Uint8Array | null;
  requestId: number;
  requestStartedAt: number;
  requestedHorizonStartMs: number;
  requestedHorizonEndMs: number;
  estimatedLatencyMs: number;
  timer: number | null;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function adaptivePointStyle({
  baseOpacity,
  baseSize,
  cameraDistanceRatio,
  satelliteCount,
  sizeAttenuation,
}: {
  baseOpacity: number;
  baseSize: number;
  cameraDistanceRatio: number;
  satelliteCount: number;
  sizeAttenuation: boolean;
}) {
  const far = smoothstep(FAR_ZOOM_RATIO, 14, cameraDistanceRatio);
  const close = 1 - smoothstep(MID_ZOOM_RATIO, 8.2, cameraDistanceRatio);
  const midCrowding =
    smoothstep(6.2, 8.8, cameraDistanceRatio) *
    (1 - smoothstep(11.2, 14.2, cameraDistanceRatio));
  const densityScale =
    satelliteCount > 14_000
      ? 0.76
      : satelliteCount > 8_000
        ? 0.84
        : satelliteCount > 3_000
          ? 0.92
          : 1;
  const effectiveDensityScale = Math.min(1, densityScale + close * 0.16);

  const sizeMultiplier = sizeAttenuation
    ? (0.86 + close * 0.22 + far * 0.08 - midCrowding * 0.08) * effectiveDensityScale
    : (0.88 + close * 0.24 + far * 0.12 - midCrowding * 0.1) * effectiveDensityScale;
  const opacityMultiplier = (0.88 + close * 0.16 + far * 0.08 - midCrowding * 0.1) *
    (0.88 + effectiveDensityScale * 0.12);

  return {
    depthTest: true,
    opacity: Math.min(0.92, Math.max(0.1, baseOpacity * opacityMultiplier)),
    size: Math.max(sizeAttenuation ? 18 : 1.5, baseSize * sizeMultiplier),
  };
}

function satellitePointInputsEqual(
  left: SatelliteModel,
  right: SatelliteModel,
): boolean {
  const leftMetadata = left.catalogMetadata;
  const rightMetadata = right.catalogMetadata;
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.constellationId === right.constellationId &&
    catalogPropagationInputsEqual(left, right) &&
    left.keplerian.semiMajorAxisKm === right.keplerian.semiMajorAxisKm &&
    left.keplerian.eccentricity === right.keplerian.eccentricity &&
    left.keplerian.inclinationDeg === right.keplerian.inclinationDeg &&
    left.keplerian.raanDeg === right.keplerian.raanDeg &&
    left.keplerian.argumentOfPeriapsisDeg ===
      right.keplerian.argumentOfPeriapsisDeg &&
    left.keplerian.trueAnomalyDeg === right.keplerian.trueAnomalyDeg &&
    left.keplerian.epoch === right.keplerian.epoch &&
    left.visualization.color === right.visualization.color &&
    left.visualization.visible === right.visualization.visible &&
    leftMetadata?.categoryId === rightMetadata?.categoryId &&
    leftMetadata?.objectType === rightMetadata?.objectType &&
    leftMetadata?.catalogNumber === rightMetadata?.catalogNumber &&
    leftMetadata?.operator === rightMetadata?.operator &&
    leftMetadata?.country === rightMetadata?.country &&
    leftMetadata?.sourceId === rightMetadata?.sourceId &&
    leftMetadata?.orbitStateProvenance === rightMetadata?.orbitStateProvenance
  );
}

function useStableSatelliteList(satellites: SatelliteModel[]): SatelliteModel[] {
  const stableRef = useRef(satellites);
  const previous = stableRef.current;
  const unchanged =
    previous.length === satellites.length &&
    previous.every((satellite, index) =>
      satellitePointInputsEqual(satellite, satellites[index]),
    );

  if (!unchanged) stableRef.current = satellites;
  return stableRef.current;
}

function writePosition(
  target: Float32Array,
  index: number,
  satellite: SatelliteModel,
  date: Date,
): boolean {
  try {
    const state = propagateSatellite(satellite, date);
    if (!isRenderableCartesianState(state)) {
      throw new Error("Invalid propagated state");
    }
    const position = state.positionKm;
    target[index * 3] = position[0];
    target[index * 3 + 1] = position[2];
    target[index * 3 + 2] = -position[1];
    cachePopulationScenePosition(
      satellite,
      date.getTime(),
      target[index * 3],
      target[index * 3 + 1],
      target[index * 3 + 2],
    );
    return true;
  } catch {
    return false;
  }
}

function writeExactPositionRange(
  target: Float32Array,
  satellites: SatelliteModel[],
  date: Date,
  pointScales: Float32Array,
  basePointScales: Float32Array,
  startIndex = 0,
  endIndex = satellites.length,
): number {
  let written = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    const valid = writePosition(target, index, satellites[index], date);
    pointScales[index] = valid ? basePointScales[index] : 0;
    if (valid) written += 1;
  }
  return written;
}

function writeColors(
  target: Float32Array,
  satellites: SatelliteModel[],
  markerStyles: ReadonlyMap<string, ExplorerMarkerStyle> | undefined,
  desaturate: number,
  colorMultiplier: number,
): void {
  const mutedColor = new Color("#91a0b4");
  const color = new Color();
  satellites.forEach((satellite, index) => {
    const style = markerStyles?.get(satellite.id);
    color
      .set(style?.color ?? satellite.visualization.color)
      .lerp(mutedColor, desaturate)
      .multiplyScalar(colorMultiplier * (style?.emphasis ?? 1));
    target[index * 3] = color.r;
    target[index * 3 + 1] = color.g;
    target[index * 3 + 2] = color.b;
  });
}

function writePointScales(
  target: Float32Array,
  satellites: SatelliteModel[],
  hiddenSatelliteIds?: ReadonlySet<string>,
): void {
  satellites.forEach((satellite, index) => {
    const apogeeRadiusKm =
      satellite.keplerian.semiMajorAxisKm * (1 + satellite.keplerian.eccentricity);
    const altitudeKm = apogeeRadiusKm - EARTH_RADIUS_KM;
    const category = satellite.catalogMetadata?.categoryId;
    const regimeScale =
      altitudeKm < 2_000
        ? 0.82
        : altitudeKm < 12_000
          ? 0.94
          : altitudeKm > 30_000
            ? 1.1
            : 1.02;
    const categoryScale = category === "debris" ? 0.72 : category === "rocket-bodies" ? 0.84 : 1;

    target[index] = hiddenSatelliteIds?.has(satellite.id) ? 0 : regimeScale * categoryScale;
  });
}

export function ExplorerSatellitePoints({
  diagnosticsBatchId,
  satellites,
  markerStyles,
  animate,
  simulationTime,
  playbackTimeScale,
  hiddenSatelliteIds,
  cacheSatelliteIds,
  size = 112,
  sizeAttenuation = true,
  opacity = 0.9,
  colorMultiplier = 1,
  desaturate = 0,
  updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS,
  onSelect,
  onHover,
}: ExplorerSatellitePointsProps) {
  const { camera, invalidate } = useThree();
  const stableSatellites = useStableSatelliteList(satellites);
  const pointsRef = useRef<Points | null>(null);
  const materialRef = useRef<PointsMaterial | ShaderMaterial | null>(null);
  const lastDepthTestRef = useRef<boolean | null>(null);
  const workerShardsRef = useRef<PropagationWorkerShard[]>([]);
  const profiledFrameCountRef = useRef(0);
  const renderedPlaybackTimeRef = useRef(Date.parse(simulationTime));
  const lastDiagnosticsPublishedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const playbackTimeScaleRef = useRef(playbackTimeScale);
  const animateRef = useRef(animate);
  playbackTimeScaleRef.current = playbackTimeScale;
  animateRef.current = animate;
  const profileMotion = useMemo(
    () => new URLSearchParams(window.location.search).has("profileFrames"),
    [],
  );
  const reviewDiagnosticsEnabled = useMemo(
    () =>
      Boolean(diagnosticsBatchId) &&
      new URLSearchParams(window.location.search).get("review") === "1",
    [diagnosticsBatchId],
  );
  const workerPopulation = stableSatellites.length >= WORKER_SATELLITE_THRESHOLD;
  const staticGeometrySimulationTime = workerPopulation ? null : simulationTime;
  const fixedPointUniforms = useMemo(
    () => ({
      pointSize: { value: size },
      pointOpacity: { value: opacity },
      earthRadiusKm: { value: EARTH_RADIUS_KM },
    }),
    [],
  );
  const basePointScales = useMemo(() => {
    const scales = new Float32Array(stableSatellites.length);
    writePointScales(scales, stableSatellites, hiddenSatelliteIds);
    return scales;
  }, [hiddenSatelliteIds, stableSatellites]);
  const geometry = useMemo(() => {
    const nextGeometry = new BufferGeometry();
    const positions = new Float32Array(stableSatellites.length * 3);
    const colors = new Float32Array(stableSatellites.length * 3);
    const pointScales = workerPopulation
      ? new Float32Array(stableSatellites.length)
      : basePointScales.slice();

    if (!workerPopulation) {
      writeExactPositionRange(
        positions,
        stableSatellites,
        new Date(staticGeometrySimulationTime!),
        pointScales,
        basePointScales,
      );
    }
    writeColors(colors, stableSatellites, markerStyles, desaturate, colorMultiplier);

    const positionAttribute = new BufferAttribute(positions, 3);
    const pointScaleAttribute = new BufferAttribute(pointScales, 1);
    positionAttribute.setUsage(DynamicDrawUsage);
    pointScaleAttribute.setUsage(DynamicDrawUsage);
    nextGeometry.setAttribute("position", positionAttribute);
    nextGeometry.setAttribute("color", new BufferAttribute(colors, 3));
    nextGeometry.setAttribute("pointScale", pointScaleAttribute);
    nextGeometry.computeBoundingSphere();
    return nextGeometry;
  }, [basePointScales, stableSatellites, staticGeometrySimulationTime, workerPopulation]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const attribute = geometry.getAttribute("color") as BufferAttribute;
    writeColors(
      attribute.array as Float32Array,
      stableSatellites,
      markerStyles,
      desaturate,
      colorMultiplier,
    );
    attribute.needsUpdate = true;
    invalidate();
  }, [colorMultiplier, desaturate, geometry, invalidate, markerStyles, stableSatellites]);

  useEffect(() => {
    fixedPointUniforms.pointSize.value = size;
    fixedPointUniforms.pointOpacity.value = opacity;
    invalidate();
  }, [fixedPointUniforms, invalidate, opacity, size]);

  useEffect(() => {
    if (animate && stableSatellites.length >= WORKER_SATELLITE_THRESHOLD) return;
    const positionAttribute = geometry.getAttribute("position") as BufferAttribute;
    const scaleAttribute = geometry.getAttribute("pointScale") as BufferAttribute;
    writeExactPositionRange(
      positionAttribute.array as Float32Array,
      stableSatellites,
      new Date(simulationTime),
      scaleAttribute.array as Float32Array,
      basePointScales,
    );
    positionAttribute.needsUpdate = true;
    scaleAttribute.needsUpdate = true;
    renderedPlaybackTimeRef.current = Date.parse(simulationTime);
    lastDiagnosticsPublishedAtRef.current = Number.NEGATIVE_INFINITY;
    invalidate();
  }, [
    animate,
    basePointScales,
    geometry,
    invalidate,
    playbackTimeScale,
    simulationTime,
    stableSatellites,
  ]);

  const publishDiagnostics = useCallback((authoritativePlaybackTimeMs: number) => {
    if (!diagnosticsBatchId || !reviewDiagnosticsEnabled) return;
    const nowMs = performance.now();
    if (nowMs - lastDiagnosticsPublishedAtRef.current < DIAGNOSTICS_INTERVAL_MS) return;
    lastDiagnosticsPublishedAtRef.current = nowMs;
    const positionAttribute = geometry.getAttribute("position") as BufferAttribute;
    const scaleAttribute = geometry.getAttribute("pointScale") as BufferAttribute;
    const positions = positionAttribute.array as Float32Array;
    const pointScales = scaleAttribute.array as Float32Array;
    let renderedInstanceCount = 0;
    pointScales.forEach((pointScale) => {
      if (pointScale > 0) renderedInstanceCount += 1;
    });

    publishExplorerRendererBatch({
      batchId: diagnosticsBatchId,
      simulationTime: new Date(renderedPlaybackTimeRef.current).toISOString(),
      authoritativeSimulationTime: new Date(authoritativePlaybackTimeMs).toISOString(),
      bufferLagMs: authoritativePlaybackTimeMs - renderedPlaybackTimeRef.current,
      renderQueueSize: stableSatellites.length,
      gpuInstanceCount: positionAttribute.count,
      renderedInstanceCount,
      visibleInstanceCount: countScreenVisiblePointInstances(positions, pointScales, camera),
      ...renderedProvenanceCounts(stableSatellites, pointScales),
      positionDigest: pointPositionDigest(positions, pointScales),
      camera: explorerCameraState(camera),
    });
  }, [
    camera,
    diagnosticsBatchId,
    geometry,
    reviewDiagnosticsEnabled,
    stableSatellites,
  ]);

  const publishBufferTiming = useCallback((authoritativePlaybackTimeMs: number) => {
    if (!diagnosticsBatchId || !reviewDiagnosticsEnabled) return;
    publishExplorerRendererBatchTiming(
      diagnosticsBatchId,
      new Date(renderedPlaybackTimeRef.current).toISOString(),
      new Date(authoritativePlaybackTimeMs).toISOString(),
    );
  }, [diagnosticsBatchId, reviewDiagnosticsEnabled]);

  useEffect(() => {
    if (!diagnosticsBatchId || !reviewDiagnosticsEnabled) return undefined;
    return () => removeExplorerRendererBatch(diagnosticsBatchId);
  }, [diagnosticsBatchId, reviewDiagnosticsEnabled]);

  useEffect(() => {
    if (!workerPopulation) {
      workerShardsRef.current = [];
      return;
    }

    const effectiveUpdateIntervalMs = Math.max(
      MIN_WORKER_INTERVAL_MS,
      Math.min(updateIntervalMs, 1_000),
    );
    const hardwareConcurrency = navigator.hardwareConcurrency || 4;
    const workerCount = Math.min(
      MAX_WORKER_COUNT,
      Math.max(1, hardwareConcurrency),
      Math.ceil(stableSatellites.length / WORKER_SATELLITE_THRESHOLD),
    );
    const shardSize = Math.ceil(stableSatellites.length / workerCount);
    const shards: PropagationWorkerShard[] = [];
    let disposed = false;

    if (profileMotion) {
      console.info(
        `ORBIT_WORKER_POOL ${JSON.stringify({
          satellites: stableSatellites.length,
          workers: workerCount,
          shardSize,
          updateIntervalMs: effectiveUpdateIntervalMs,
          predictiveHorizon: true,
        })}`,
      );
    }

    const requestNextSample = (shard: PropagationWorkerShard) => {
      if (disposed) return;
      const playbackTimeMs = readScenePlaybackTimeMs();
      if (
        shard.pendingSampleTimestampsMs &&
        catalogPropagationHorizonCovers(
          shard.pendingSampleTimestampsMs,
          playbackTimeMs,
        )
      ) {
        shard.sampleTimestampsMs = shard.pendingSampleTimestampsMs;
        shard.positions = shard.pendingPositions;
        shard.velocities = shard.pendingVelocities;
        shard.valid = shard.pendingValid;
        shard.pendingSampleTimestampsMs = null;
        shard.pendingPositions = null;
        shard.pendingVelocities = null;
        shard.pendingValid = null;
      } else if (
        shard.pendingSampleTimestampsMs &&
        playbackTimeMs < shard.pendingSampleTimestampsMs[0]
      ) {
        shard.timer = window.setTimeout(
          () => requestNextSample(shard),
          effectiveUpdateIntervalMs,
        );
        return;
      } else if (shard.pendingSampleTimestampsMs) {
        shard.pendingSampleTimestampsMs = null;
        shard.pendingPositions = null;
        shard.pendingVelocities = null;
        shard.pendingValid = null;
      }
      const currentTimeScale = animateRef.current
        ? playbackTimeScaleRef.current
        : 1;
      if (
        !catalogPropagationHorizonNeedsRefresh(
          shard.sampleTimestampsMs,
          playbackTimeMs,
          currentTimeScale,
          shard.estimatedLatencyMs,
        )
      ) {
        shard.timer = window.setTimeout(
          () => requestNextSample(shard),
          effectiveUpdateIntervalMs,
        );
        return;
      }
      const sampleTimestampsMs = catalogPropagationHorizonTimestamps(
        playbackTimeMs,
        currentTimeScale,
        shard.estimatedLatencyMs,
      );
      const horizonStartMs = sampleTimestampsMs[0];
      const horizonEndMs = sampleTimestampsMs[sampleTimestampsMs.length - 1];
      if (
        shard.positions &&
        shard.requestedHorizonStartMs === horizonStartMs &&
        shard.requestedHorizonEndMs === horizonEndMs &&
        shard.sampleTimestampsMs?.[0] === horizonStartMs &&
        shard.sampleTimestampsMs[shard.sampleTimestampsMs.length - 1] ===
          horizonEndMs
      ) {
        shard.timer = window.setTimeout(
          () => requestNextSample(shard),
          effectiveUpdateIntervalMs,
        );
        return;
      }
      shard.requestId += 1;
      shard.requestStartedAt = performance.now();
      shard.requestedHorizonStartMs = horizonStartMs;
      shard.requestedHorizonEndMs = horizonEndMs;
      shard.worker.postMessage({
        type: "propagate",
        requestId: shard.requestId,
        sampleTimestampsMs,
      }, [sampleTimestampsMs.buffer]);
    };

    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
      const satelliteOffset = workerIndex * shardSize;
      const workerSatellites = stableSatellites.slice(
        satelliteOffset,
        satelliteOffset + shardSize,
      );
      if (workerSatellites.length === 0) break;

      const worker = new Worker(new URL("../workers/catalogPropagation.worker.ts", import.meta.url), {
        type: "module",
      });
      const shard: PropagationWorkerShard = {
        worker,
        workerIndex,
        satelliteOffset,
        sampleTimestampsMs: null,
        positions: null,
        velocities: null,
        valid: null,
        pendingSampleTimestampsMs: null,
        pendingPositions: null,
        pendingVelocities: null,
        pendingValid: null,
        requestId: 0,
        requestStartedAt: 0,
        requestedHorizonStartMs: Number.NaN,
        requestedHorizonEndMs: Number.NaN,
        estimatedLatencyMs: CATALOG_INITIAL_WORKER_LATENCY_MS,
        timer: null,
      };
      worker.onmessage = (event: MessageEvent<CatalogPropagationResultMessage>) => {
        if (disposed || event.data.type !== "result" || event.data.requestId !== shard.requestId) {
          return;
        }

        const nextSampleTimestampsMs = new Float64Array(event.data.sampleTimestampsMs);
        const nextPositions = new Float32Array(event.data.positions);
        const nextVelocities = new Float32Array(event.data.velocities);
        const nextValid = new Uint8Array(event.data.valid);
        const playbackTimeMs = readScenePlaybackTimeMs();
        const horizonDisposition = catalogPropagationHorizonDisposition(
          shard.sampleTimestampsMs,
          nextSampleTimestampsMs,
          playbackTimeMs,
        );
        if (horizonDisposition === "stage") {
          // Do not replace a usable GPU horizon with a future-only result. Stage it until
          // playback reaches the overlap, otherwise high-speed worker latency becomes a visible
          // freeze even though both horizons are scientifically valid.
          shard.pendingSampleTimestampsMs = nextSampleTimestampsMs;
          shard.pendingPositions = nextPositions;
          shard.pendingVelocities = nextVelocities;
          shard.pendingValid = nextValid;
        } else if (horizonDisposition === "activate") {
          shard.sampleTimestampsMs = nextSampleTimestampsMs;
          shard.positions = nextPositions;
          shard.velocities = nextVelocities;
          shard.valid = nextValid;
          shard.pendingSampleTimestampsMs = null;
          shard.pendingPositions = null;
          shard.pendingVelocities = null;
          shard.pendingValid = null;
        }
        const endToEndLatencyMs = performance.now() - shard.requestStartedAt;
        shard.estimatedLatencyMs = Math.max(
          MIN_WORKER_INTERVAL_MS,
          endToEndLatencyMs + MIN_WORKER_INTERVAL_MS,
        );
        if (profileMotion && (shard.requestId <= 2 || shard.requestId % 10 === 0)) {
          console.info(
            `ORBIT_WORKER_PROFILE ${JSON.stringify({
              worker: shard.workerIndex,
              request: shard.requestId,
              satellites: nextValid.length,
              durationMs: event.data.durationMs,
              endToEndLatencyMs,
            })}`,
          );
        }
        const remainingDelay = Math.max(
          0,
          effectiveUpdateIntervalMs - (performance.now() - shard.requestStartedAt),
        );
        shard.timer = window.setTimeout(() => requestNextSample(shard), remainingDelay);
      };
      worker.onerror = (event) => {
        if (profileMotion) {
          console.error(
            `ORBIT_WORKER_ERROR ${JSON.stringify({
              worker: shard.workerIndex,
              message: event.message,
              filename: event.filename,
              line: event.lineno,
            })}`,
          );
        }
      };
      worker.postMessage({
        type: "init",
        satellites: workerSatellites.map((satellite) => ({
          propagationMode: satellite.propagationMode,
          keplerian: satellite.keplerian,
          tle: satellite.tle,
        })),
      });
      shards.push(shard);
      requestNextSample(shard);
    }

    workerShardsRef.current = shards;
    return () => {
      disposed = true;
      shards.forEach((shard) => {
        if (shard.timer !== null) window.clearTimeout(shard.timer);
        shard.worker.terminate();
      });
      workerShardsRef.current = [];
    };
  }, [
    profileMotion,
    stableSatellites,
    updateIntervalMs,
    workerPopulation,
  ]);

  useFrame(({ camera }) => {
    const material = materialRef.current;

    if (material) {
      const style = adaptivePointStyle({
        baseOpacity: opacity,
        baseSize: size,
        cameraDistanceRatio: camera.position.length() / EARTH_RADIUS_KM,
        satelliteCount: stableSatellites.length,
        sizeAttenuation,
      });

      if (material instanceof ShaderMaterial) {
        material.uniforms.pointSize.value = style.size;
        material.uniforms.pointOpacity.value = style.opacity;
      } else {
        material.size = style.size;
        material.opacity = style.opacity;
      }

      if (lastDepthTestRef.current !== style.depthTest) {
        material.depthTest = style.depthTest;
        material.needsUpdate = true;
        lastDepthTestRef.current = style.depthTest;
      }
    }

    const playbackTimeMs = readScenePlaybackTimeMs();
    if (!animate || !pointsRef.current) {
      publishDiagnostics(playbackTimeMs);
      return;
    }
    const workerShards = workerShardsRef.current;
    if (workerShards.length > 0) {
      const profileStartedAt = profileMotion ? performance.now() : 0;
      const attribute = geometry.getAttribute("position") as BufferAttribute;
      const scaleAttribute = geometry.getAttribute("pointScale") as BufferAttribute;
      const positions = attribute.array as Float32Array;
      const pointScales = scaleAttribute.array as Float32Array;
      let wrotePositions = false;
      let validPositionCount = 0;

      const allShardsCoverPlaybackTime = workerShards.every((shard) =>
        Boolean(
          shard.positions &&
          shard.velocities &&
          shard.valid &&
          catalogPropagationHorizonCovers(shard.sampleTimestampsMs, playbackTimeMs),
        ),
      );
      if (!allShardsCoverPlaybackTime) {
        publishBufferTiming(playbackTimeMs);
        publishDiagnostics(playbackTimeMs);
        return;
      }

      workerShards.forEach((shard) => {
        const shardSatelliteCount = shard.valid?.length
          ? shard.valid.length
          : Math.min(
              Math.ceil(stableSatellites.length / workerShards.length),
              stableSatellites.length - shard.satelliteOffset,
            );
        const sampleTimestampsMs = shard.sampleTimestampsMs!;
        const shardPositions = shard.positions!;
        const shardVelocities = shard.velocities!;
        const shardValidity = shard.valid!;
        let segmentIndex = sampleTimestampsMs.length - 2;
        for (let index = 0; index < sampleTimestampsMs.length - 1; index += 1) {
          if (playbackTimeMs <= sampleTimestampsMs[index + 1]) {
            segmentIndex = index;
            break;
          }
        }
        const sampleStride = shardSatelliteCount * 3;
        const startOffset = segmentIndex * sampleStride;
        const endOffset = startOffset + sampleStride;
        validPositionCount += writeInterpolatedThreePositions(
          positions,
          shard.satelliteOffset,
          shardPositions.subarray(startOffset, startOffset + sampleStride),
          shardVelocities.subarray(startOffset, startOffset + sampleStride),
          shardPositions.subarray(endOffset, endOffset + sampleStride),
          shardVelocities.subarray(endOffset, endOffset + sampleStride),
          shardValidity,
          sampleTimestampsMs[segmentIndex],
          sampleTimestampsMs[segmentIndex + 1],
          playbackTimeMs,
          pointScales,
          basePointScales,
        );
        if (cacheSatelliteIds?.size) {
          for (let localIndex = 0; localIndex < shardSatelliteCount; localIndex += 1) {
            if (!shardValidity[localIndex]) continue;
            const satelliteIndex = shard.satelliteOffset + localIndex;
            const satellite = stableSatellites[satelliteIndex];
            if (!cacheSatelliteIds.has(satellite.id)) continue;
            cachePopulationScenePosition(
              satellite,
              playbackTimeMs,
              positions[satelliteIndex * 3],
              positions[satelliteIndex * 3 + 1],
              positions[satelliteIndex * 3 + 2],
            );
          }
        }
        wrotePositions = true;
      });

      if (wrotePositions) {
        renderedPlaybackTimeRef.current = playbackTimeMs;
        attribute.needsUpdate = true;
        scaleAttribute.needsUpdate = true;
      }
      publishBufferTiming(playbackTimeMs);
      if (profileMotion && wrotePositions) {
        profiledFrameCountRef.current += 1;
        if (profiledFrameCountRef.current % 60 === 0) {
          const updateDurationMs = performance.now() - profileStartedAt;
          if (stableSatellites.length >= WORKER_SATELLITE_THRESHOLD) {
            const sampleStep = Math.max(1, Math.floor(stableSatellites.length / 12));
            window.__ORBIT_STUDIO_POPULATION_DIAGNOSTICS__ = {
              playbackTimeMs,
              satelliteCount: stableSatellites.length,
              validPositionCount,
              updateDurationMs,
              samples: Array.from({ length: Math.min(12, stableSatellites.length) }, (_, index) => {
                const satelliteIndex = Math.min(
                  stableSatellites.length - 1,
                  index * sampleStep,
                );
                const satellite = stableSatellites[satelliteIndex];
                return {
                  id: satellite.id,
                  catalogNumber: satellite.catalogMetadata?.catalogNumber,
                  categoryId: satellite.catalogMetadata?.categoryId,
                  position: [
                    positions[satelliteIndex * 3],
                    positions[satelliteIndex * 3 + 1],
                    positions[satelliteIndex * 3 + 2],
                  ],
                };
              }),
            };
          }
          console.info(
            `ORBIT_MOTION_PROFILE ${JSON.stringify({
              satellites: stableSatellites.length,
              validPositionCount,
              playbackTimeMs,
              durationMs: updateDurationMs,
            })}`,
          );
        }
      }
      publishDiagnostics(playbackTimeMs);
      return;
    }

    const attribute = geometry.getAttribute("position") as BufferAttribute;
    const scaleAttribute = geometry.getAttribute("pointScale") as BufferAttribute;
    const positions = attribute.array as Float32Array;
    writeExactPositionRange(
      positions,
      stableSatellites,
      new Date(readScenePlaybackTimeMs()),
      scaleAttribute.array as Float32Array,
      basePointScales,
    );
    attribute.needsUpdate = true;
    scaleAttribute.needsUpdate = true;
    renderedPlaybackTimeRef.current = playbackTimeMs;
    publishBufferTiming(playbackTimeMs);
    publishDiagnostics(playbackTimeMs);
  }, -100);

  const satelliteForEvent = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (typeof event.index !== "number") return undefined;
    const pointScales = geometry.getAttribute("pointScale") as BufferAttribute;
    if ((pointScales.array as Float32Array)[event.index] <= 0) return undefined;
    return stableSatellites[event.index];
  };

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      frustumCulled={false}
      onClick={(event) => {
        event.stopPropagation();
        const satellite = satelliteForEvent(event);
        if (satellite) onSelect(satellite.id);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        onHover(satelliteForEvent(event)?.id ?? null);
      }}
      onPointerOut={() => onHover(null)}
    >
      {sizeAttenuation ? (
        <pointsMaterial
          ref={(material) => {
            materialRef.current = material;
          }}
          vertexColors
          toneMapped={false}
          size={size}
          sizeAttenuation
          transparent
          opacity={opacity}
          depthWrite={false}
        />
      ) : (
        <shaderMaterial
          ref={(material) => {
            materialRef.current = material;
          }}
          uniforms={fixedPointUniforms}
          vertexShader={FIXED_POINT_VERTEX_SHADER}
          fragmentShader={FIXED_POINT_FRAGMENT_SHADER}
          transparent
          depthTest
          depthWrite={false}
          toneMapped={false}
        />
      )}
    </points>
  );
}
