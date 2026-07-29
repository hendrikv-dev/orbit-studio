interface FrameProfile {
  mode: "explorer" | "playground";
  sample: number;
  durationMs: number;
  frames: number;
  meanFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  over20ms: number;
  over33ms: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  mutations: number;
}

const SAMPLE_DURATION_MS = 4000;
const SAMPLE_GAP_MS = 1000;
const INITIAL_SETTLE_MS = 5000;

function percentile(sorted: number[], value: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
}

function collectFrameProfile(sample: number): Promise<FrameProfile> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    const longTasks: number[] = [];
    let mutations = 0;
    let previous = performance.now();
    const started = previous;
    const longTaskObserver = new PerformanceObserver((list) => {
      longTasks.push(...list.getEntries().map((entry) => entry.duration));
    });
    const mutationObserver = new MutationObserver((records) => {
      mutations += records.length;
    });

    try {
      longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long-task entries are optional across browser engines.
    }
    mutationObserver.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    const frame = (now: number) => {
      intervals.push(now - previous);
      previous = now;
      if (now - started < SAMPLE_DURATION_MS) {
        requestAnimationFrame(frame);
        return;
      }

      longTaskObserver.disconnect();
      mutationObserver.disconnect();
      const sorted = intervals.slice(1).sort((left, right) => left - right);
      resolve({
        mode: document.querySelector(".orbit-controls-panel") ? "playground" : "explorer",
        sample,
        durationMs: now - started,
        frames: sorted.length,
        meanFrameMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
        p50FrameMs: percentile(sorted, 0.5),
        p95FrameMs: percentile(sorted, 0.95),
        p99FrameMs: percentile(sorted, 0.99),
        maxFrameMs: sorted[sorted.length - 1] ?? 0,
        over20ms: sorted.filter((value) => value > 20).length,
        over33ms: sorted.filter((value) => value > 33).length,
        longTaskCount: longTasks.length,
        longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
        longTaskMaxMs: Math.max(0, ...longTasks),
        mutations,
      });
    };
    requestAnimationFrame(frame);
  });
}

export function startFrameProfiler(): void {
  let sample = 0;
  const collect = async () => {
    sample += 1;
    const profile = await collectFrameProfile(sample);
    console.info(`ORBIT_FRAME_PROFILE ${JSON.stringify(profile)}`);
    window.setTimeout(collect, SAMPLE_GAP_MS);
  };

  window.setTimeout(collect, INITIAL_SETTLE_MS);
}
