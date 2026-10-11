// Self-contained because Playwright serializes this function into the browser.
// Passive observations only: no alternate clock or renderer implementation.
export async function collectPlaybackSamples({ durationMs = 4_000, sampleIntervalMs = 100 } = {}) {
  const bridge = window.__ORBIT_STUDIO_REVIEW__;
  if (!bridge) throw new Error("Orbit Studio review bridge is unavailable.");
  const samples = [];
  const longTasks = [];
  const observer = typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask")
    ? new PerformanceObserver((list) => longTasks.push(...list.getEntries()
      .map(({ startTime, duration }) => ({ startTime, duration })))) : null;
  observer?.observe({ type: "longtask" });
  let frameCount = 0;
  let lastFrameAt = performance.now();
  let maximumFrameGapMs = 0;
  let frameRequest;
  const frame = () => {
    const now = performance.now();
    maximumFrameGapMs = Math.max(maximumFrameGapMs, now - lastFrameAt);
    lastFrameAt = now;
    frameCount += 1;
    frameRequest = requestAnimationFrame(frame);
  };
  frameRequest = requestAnimationFrame(frame);
  bridge.setPlayback(true);
  const startedAt = performance.now();
  let previousAt = startedAt;
  try {
    while (performance.now() - startedAt <= durationMs) {
      const readStartedAt = performance.now();
      const state = bridge.getState();
      const now = performance.now();
      samples.push({
        wallTimeMs: now,
        sampleIntervalMs,
        samplingGapMs: now - previousAt,
        timerDelayMs: Math.max(0, now - previousAt - sampleIntervalMs),
        stateReadDurationMs: now - readStartedAt,
        animationFrameCount: frameCount,
        maximumFrameGapMs: Math.max(maximumFrameGapMs, now - lastFrameAt),
        simulationTime: state.simulationTime,
        rendererSimulationTime: state.renderer.simulationTime,
        bufferLagMs: state.renderer.bufferLagMs,
        positionDigest: state.renderer.positionDigest,
        renderedInstanceCount: state.renderer.renderedInstanceCount,
        expectedRenderedInstanceCount: state.renderer.expectedRenderedInstanceCount,
      });
      // A delayed timer may run before the first resumed renderer callback. Preserve
      // that raw observation, then acquire exactly once after two frame callbacks
      // (one complete render opportunity). This is not a retry-until-settled loop.
      if (now - previousAt > 500 &&
          Math.max(maximumFrameGapMs, now - lastFrameAt) > 500) {
        const recoveryStartedAt = performance.now();
        const framesBefore = frameCount;
        let recoveryFrame;
        let recoveryTimer;
        const timedOut = await Promise.race([
          new Promise((resolve) => {
            recoveryFrame = requestAnimationFrame(() => {
              recoveryFrame = requestAnimationFrame(() => resolve(false));
            });
          }),
          new Promise((resolve) => { recoveryTimer = setTimeout(() => resolve(true), 500); }),
        ]);
        clearTimeout(recoveryTimer);
        cancelAnimationFrame(recoveryFrame);
        const recovered = bridge.getState();
        samples.at(-1).resumption = {
          timedOut,
          elapsedMs: performance.now() - recoveryStartedAt,
          frameAdvance: frameCount - framesBefore,
          simulationTime: recovered.simulationTime,
          rendererSimulationTime: recovered.renderer.simulationTime,
          bufferLagMs: recovered.renderer.bufferLagMs,
          renderedInstanceCount: recovered.renderer.renderedInstanceCount,
          expectedRenderedInstanceCount: recovered.renderer.expectedRenderedInstanceCount,
        };
      }
      previousAt = now;
      maximumFrameGapMs = 0;
      await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
    }
  } finally {
    bridge.setPlayback(false);
    cancelAnimationFrame(frameRequest);
    longTasks.push(...(observer?.takeRecords() ?? [])
      .map(({ startTime, duration }) => ({ startTime, duration })));
    observer?.disconnect();
  }
  return samples.map((sample, index) => ({
    ...sample,
    longTasks: longTasks.filter((task) => task.startTime < sample.wallTimeMs &&
      task.startTime + task.duration > (samples[index - 1]?.wallTimeMs ?? startedAt)),
    simulationAdvanceMs: index ? Date.parse(sample.simulationTime) -
      Date.parse(samples[index - 1].simulationTime) : 0,
    rendererAdvanceMs: index ? Date.parse(sample.rendererSimulationTime) -
      Date.parse(samples[index - 1].rendererSimulationTime) : 0,
  }));
}
