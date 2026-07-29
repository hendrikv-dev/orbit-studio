import { useFrame } from "@react-three/fiber";
import type { CartesianState } from "../physics/types";
import type { SatelliteModel } from "../lib/scenario";
import { isRenderableCartesianState, propagateSatellite } from "../lib/propagation";
import { readStudioPlaybackTimeMs } from "../state/studioPlaybackClock";
import { computeCelestialState, type CelestialState } from "../astronomy/celestialFrames";

let activeFrameTimeMs: number | null = null;
const satelliteStateCache = new WeakMap<
  SatelliteModel,
  { timeMs: number; state: CartesianState }
>();
let celestialStateCache: { timeMs: number; state: CelestialState } | null = null;

function beginSceneFrame(): void {
  activeFrameTimeMs = readStudioPlaybackTimeMs();
}

export function readScenePlaybackTimeMs(): number {
  return activeFrameTimeMs ?? readStudioPlaybackTimeMs();
}

export function readSceneCelestialState(): CelestialState {
  const timeMs = readScenePlaybackTimeMs();
  if (celestialStateCache?.timeMs === timeMs) return celestialStateCache.state;

  const state = computeCelestialState(timeMs);
  celestialStateCache = { timeMs, state };
  return state;
}

export function readSceneSatelliteState(satellite: SatelliteModel): CartesianState {
  const timeMs = readScenePlaybackTimeMs();
  const cached = satelliteStateCache.get(satellite);
  if (cached && cached.timeMs === timeMs) {
    return cached.state;
  }

  const state = propagateSatellite(satellite, new Date(timeMs));
  if (!isRenderableCartesianState(state)) {
    throw new Error("Invalid propagated satellite state");
  }
  satelliteStateCache.set(satellite, { timeMs, state });
  return state;
}

export function SceneMotionClock() {
  useFrame(() => beginSceneFrame(), -1000);
  return null;
}
