interface StudioPlaybackClockState {
  anchorSimulationMs: number;
  anchorWallMs: number;
  isPlaying: boolean;
  timeScale: number;
  isReverse: boolean;
}

export interface StudioPlaybackClockConfig {
  simulationTimeUtc: string;
  isPlaying: boolean;
  timeScale: number;
  isReverse: boolean;
}

const monotonicNow = () => {
  if (typeof performance === "undefined") {
    throw new Error("Orbit Studio requires a monotonic playback clock.");
  }
  return performance.now();
};

let clockState: StudioPlaybackClockState | null = null;

function parseSimulationMs(simulationTimeUtc: string): number {
  const parsed = Date.parse(simulationTimeUtc);
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`Invalid simulationTimeUtc: ${simulationTimeUtc}`);
  }
  return parsed;
}

function currentClockState(): StudioPlaybackClockState {
  if (!clockState) throw new Error("Studio playback clock has not been initialized.");
  return clockState;
}

export function readStudioPlaybackTimeMs(wallTimeMs = monotonicNow()): number {
  const state = currentClockState();
  if (!state.isPlaying) {
    return state.anchorSimulationMs;
  }

  const direction = state.isReverse ? -1 : 1;
  return (
    state.anchorSimulationMs +
    (wallTimeMs - state.anchorWallMs) * state.timeScale * direction
  );
}

export function readStudioPlaybackTimeIso(wallTimeMs = monotonicNow()): string {
  return new Date(readStudioPlaybackTimeMs(wallTimeMs)).toISOString();
}

export function resetStudioPlaybackClock(config: StudioPlaybackClockConfig): void {
  clockState = {
    anchorSimulationMs: parseSimulationMs(config.simulationTimeUtc),
    anchorWallMs: monotonicNow(),
    isPlaying: config.isPlaying,
    timeScale: Math.max(1, Math.abs(config.timeScale)),
    isReverse: config.isReverse,
  };
}

export function configureStudioPlaybackClock(
  patch: Partial<Omit<StudioPlaybackClockConfig, "simulationTimeUtc">> & {
    simulationTimeUtc?: string;
  },
): string {
  const state = currentClockState();
  const wallTimeMs = monotonicNow();
  const currentSimulationMs = Math.round(
    patch.simulationTimeUtc !== undefined
      ? parseSimulationMs(patch.simulationTimeUtc)
      : readStudioPlaybackTimeMs(wallTimeMs),
  );

  clockState = {
    anchorSimulationMs: currentSimulationMs,
    anchorWallMs: wallTimeMs,
    isPlaying: patch.isPlaying ?? state.isPlaying,
    timeScale:
      patch.timeScale !== undefined
        ? Math.max(1, Math.abs(patch.timeScale))
        : state.timeScale,
    isReverse: patch.isReverse ?? state.isReverse,
  };

  return new Date(currentSimulationMs).toISOString();
}
