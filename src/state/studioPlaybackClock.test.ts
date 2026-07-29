import { describe, expect, it } from "vitest";
import {
  configureStudioPlaybackClock,
  readStudioPlaybackTimeMs,
  resetStudioPlaybackClock,
} from "./studioPlaybackClock";

describe("studio playback clock", () => {
  it("advances high-speed playback without React simulation ticks", () => {
    resetStudioPlaybackClock({
      simulationTimeUtc: "2026-01-01T00:00:00.000Z",
      isPlaying: true,
      timeScale: 10000,
      isReverse: false,
    });

    const start = readStudioPlaybackTimeMs();
    const oneFrameLater = readStudioPlaybackTimeMs(performance.now() + 16);

    expect(oneFrameLater - start).toBeGreaterThan(150_000);
    expect(oneFrameLater - start).toBeLessThan(240_000);
  });

  it("preserves the current instant when changing speed or pausing", () => {
    resetStudioPlaybackClock({
      simulationTimeUtc: "2026-01-01T00:00:00.000Z",
      isPlaying: true,
      timeScale: 1000,
      isReverse: false,
    });

    const beforeChange = readStudioPlaybackTimeMs();
    const speedChangeTime = Date.parse(configureStudioPlaybackClock({ timeScale: 10000 }));
    const pauseTime = Date.parse(configureStudioPlaybackClock({ isPlaying: false }));

    expect(speedChangeTime).toBeGreaterThanOrEqual(beforeChange);
    expect(pauseTime).toBeGreaterThanOrEqual(speedChangeTime);
    expect(readStudioPlaybackTimeMs()).toBe(pauseTime);
  });

  it("rejects invalid timestamps instead of substituting the system clock", () => {
    expect(() => resetStudioPlaybackClock({
      simulationTimeUtc: "not-a-timestamp",
      isPlaying: true,
      timeScale: 1,
      isReverse: false,
    })).toThrow(RangeError);
  });
});
