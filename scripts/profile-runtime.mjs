import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:3014/";

async function frameProfile(page, durationMs) {
  return page.evaluate((duration) =>
    new Promise((resolve) => {
      const intervals = [];
      const longTasks = [];
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
        // Long-task observation is not available in every browser build.
      }
      mutationObserver.observe(document.body, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });

      const frame = (now) => {
        intervals.push(now - previous);
        previous = now;
        if (now - started < duration) {
          requestAnimationFrame(frame);
          return;
        }

        longTaskObserver.disconnect();
        mutationObserver.disconnect();
        const sorted = intervals.slice(1).sort((left, right) => left - right);
        const percentile = (value) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
        resolve({
          durationMs: now - started,
          frames: sorted.length,
          meanFrameMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
          p50FrameMs: percentile(0.5),
          p95FrameMs: percentile(0.95),
          p99FrameMs: percentile(0.99),
          maxFrameMs: sorted[sorted.length - 1] ?? 0,
          over20ms: sorted.filter((value) => value > 20).length,
          over33ms: sorted.filter((value) => value > 33).length,
          over50ms: sorted.filter((value) => value > 50).length,
          longTaskCount: longTasks.length,
          longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
          longTaskMaxMs: Math.max(0, ...longTasks),
          mutations,
        });
      };
      requestAnimationFrame(frame);
    }),
  durationMs);
}

const browser = await chromium.launch();
const profilePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await profilePage.goto(url, { waitUntil: "networkidle" });
await profilePage.waitForTimeout(5000);

const explorerIdle = await frameProfile(profilePage, 4000);
await profilePage.getByRole("button", { name: "Animate" }).click({ noWaitAfter: true });
await profilePage.waitForTimeout(3000);
const explorerAnimated = await frameProfile(profilePage, 6000);
await profilePage.getByRole("button", { name: "Playground" }).click({ noWaitAfter: true });
await profilePage.waitForTimeout(5000);
const playgroundAnimated = await frameProfile(profilePage, 6000);
await profilePage.close();

const benchmarkPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await benchmarkPage.goto(url, { waitUntil: "networkidle" });

const subsystem = await benchmarkPage.evaluate(async () => {
  const catalog = await import("/src/data/explorerCatalog.ts");
  const propagation = await import("/src/lib/propagation.ts");
  const kepler = await import("/src/physics/kepler.ts");
  const snapshot = catalog.explorerSnapshots[catalog.explorerSnapshots.length - 1];
  const createTimes = [];
  let scenario;

  for (let run = 0; run < 1; run += 1) {
    const started = performance.now();
    scenario = catalog.createExplorerScenario(snapshot);
    createTimes.push(performance.now() - started);
  }

  const date = new Date(snapshot.timestampIso);
  const sgp4 = scenario.satellites.filter((item) => item.propagationMode === "sgp4");
  const twoBody = scenario.satellites.filter((item) => item.propagationMode !== "sgp4");
  const measureBatch = (satellites, repeats) => {
    const times = [];
    let checksum = 0;
    let failures = 0;
    for (let run = 0; run < repeats; run += 1) {
      const targetDate = new Date(date.getTime() + run * 250);
      const started = performance.now();
      for (const satellite of satellites) {
        try {
          checksum += propagation.propagateSatellite(satellite, targetDate).positionKm[0];
        } catch {
          failures += 1;
        }
      }
      times.push(performance.now() - started);
    }
    return { times, checksum, failures };
  };

  measureBatch(scenario.satellites.slice(0, 100), 1);
  const allBatch = measureBatch(scenario.satellites, 1);
  const sgp4Batch = measureBatch(sgp4.slice(0, 2000), 3);
  const twoBodyBatch = measureBatch(twoBody, 2);
  const sampleSatellite = scenario.satellites.find(
    (item) => item.id === "explorer-iss",
  ) ?? scenario.satellites[0];
  const orbitTimes = [];

  for (let run = 0; run < 8; run += 1) {
    const started = performance.now();
    for (let index = 0; index <= 640; index += 1) {
      kepler.keplerianToCartesian({
        ...sampleSatellite.keplerian,
        trueAnomalyDeg: sampleSatellite.keplerian.trueAnomalyDeg + (360 * index) / 640,
      });
    }
    orbitTimes.push(performance.now() - started);
  }

  return {
    counts: { total: scenario.satellites.length, sgp4: sgp4.length, twoBody: twoBody.length },
    createTimes,
    allPropagationTimes: allBatch.times,
    allPropagationFailures: allBatch.failures,
    sgp4SampleCount: Math.min(2000, sgp4.length),
    sgp4PropagationTimes: sgp4Batch.times,
    twoBodyPropagationTimes: twoBodyBatch.times,
    orbit640SampleTimes: orbitTimes,
  };
});

console.log(JSON.stringify({ subsystem, explorerIdle, explorerAnimated, playgroundAnimated }, null, 2));

await benchmarkPage.close();
await browser.close();
