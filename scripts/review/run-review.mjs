import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import { readSourceIdentity } from "../release/source-identity.mjs";
import { acquireReviewLock } from "./review-lock.mjs";
import { reviewScenarios } from "./scenarios/index.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");
const outputRoot = path.join(projectRoot, "review");
const screenshotsRoot = path.join(outputRoot, "screenshots");
const temporaryVideoRoot = path.join(outputRoot, ".video");
const timelineFramesRoot = path.join(temporaryVideoRoot, "frames");
const reviewLockPath = path.join(projectRoot, ".orbit-review.lock");
const reviewUrl = "http://127.0.0.1:4179/?review=1";
const viewport = { width: 1920, height: 1080 };
const artifactStates = [];
const browserDiagnostics = [];
const timelineSamples = [];
const milestoneValidations = [];
const playbackDeterminismValidations = [];
let datasetVersions = null;

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed${
            signal ? ` with signal ${signal}` : ` with exit code ${code}`
          }.`,
        ),
      );
    });
  });
}

function attachBrowserDiagnostics(page, scenarioId) {
  page.on("console", (message) => {
    if (message.type() !== "warning" && message.type() !== "error") return;
    if (
      message.type() === "warning" &&
      message.text().includes("GL Driver Message") &&
      message.text().includes("ReadPixels")
    ) return;
    browserDiagnostics.push({
      scenarioId,
      kind: `console-${message.type()}`,
      text: message.text(),
    });
  });
  page.on("pageerror", (error) => {
    browserDiagnostics.push({
      scenarioId,
      kind: "page-error",
      text: error instanceof Error ? error.message : String(error),
    });
  });
}

async function readReviewState(page) {
  return page.evaluate(() => {
    const bridge = window.__ORBIT_STUDIO_REVIEW__;
    if (!bridge) throw new Error("Orbit Studio review bridge is unavailable.");
    return bridge.getState();
  });
}

async function waitForReviewBridge(page) {
  await page.waitForFunction(
    () => Boolean(window.__ORBIT_STUDIO_REVIEW__?.getState().ready),
    undefined,
    { timeout: 45_000 },
  );
  await page.locator("canvas").waitFor({ state: "visible", timeout: 45_000 });
}

async function settleApplication(page, settleMs = 450) {
  await page.waitForFunction(
    () => Boolean(window.__ORBIT_STUDIO_REVIEW__?.getState().ready),
    undefined,
    { timeout: 45_000 },
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForTimeout(settleMs);
}

async function captureWebp(page, outputPath) {
  const session = await page.context().newCDPSession(page);
  const { data } = await session.send("Page.captureScreenshot", {
    format: "webp",
    quality: 90,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await session.detach();
  await writeFile(outputPath, Buffer.from(data, "base64"));
}

function createScenarioTools(page, scenarioId, extras = {}) {
  const waitForState = async (predicate, options = {}) => {
    const timeoutMs = options.timeoutMs ?? 45_000;
    const deadline = Date.now() + timeoutMs;
    let lastState = null;

    while (Date.now() < deadline) {
      const state = await readReviewState(page);
      lastState = state;
      if (predicate(state)) {
        await settleApplication(page, options.settleMs ?? 450);
        const settledState = await readReviewState(page);
        lastState = settledState;
        if (predicate(settledState)) return settledState;
      }
      await page.waitForTimeout(50);
    }

    throw new Error(
      `Timed out waiting for ${scenarioId} review state; ` +
      `lastState=${JSON.stringify(lastState)}.`,
    );
  };

  const setTimelineYear = async (year, options = {}) => {
    await page.evaluate((value) => {
      window.__ORBIT_STUDIO_REVIEW__?.setTimelineYear(value);
    }, year);
    await waitForState((state) => {
      if (!state.ready) return false;
      if (year === "current") return state.snapshotId === "snapshot-2026";
      return Math.abs(Number(state.selectedYear) - year) < 0.051;
    }, { settleMs: options.settleMs });
  };

  const setTimelineSnapshot = async (snapshotId, options = {}) => {
    await page.evaluate((value) => {
      window.__ORBIT_STUDIO_REVIEW__?.setTimelineSnapshot(value);
    }, snapshotId);
    return waitForState(
      (state) => state.ready && state.snapshotId === snapshotId,
      { settleMs: options.settleMs },
    );
  };

  const speedLabels = {
    "1x": "1×",
    "10x": "10×",
    "100x": "100×",
    "1000x": "1000×",
    max: "2,500×",
  };
  const setPlaybackSpeed = async (speed) => {
    await page.evaluate((value) => {
      window.__ORBIT_STUDIO_REVIEW__?.setPlaybackSpeed(value);
    }, speed);
    return waitForState(
      (state) => !state.playback.isPlaying && state.playback.speed === speedLabels[speed],
    );
  };

  // The production main thread can spend several hundred milliseconds committing a full
  // catalog buffer, while full-population position digests are intentionally published only
  // twice per second. Keep the observation window long enough to collect three independent
  // rendered digests even when timer callbacks are delayed under constrained conditions.
  const samplePlaybackMotion = async ({ durationMs = 4_000, sampleIntervalMs = 100 } = {}) =>
    page.evaluate(async ({ durationMs: duration, sampleIntervalMs: interval }) => {
      const bridge = window.__ORBIT_STUDIO_REVIEW__;
      if (!bridge) throw new Error("Orbit Studio review bridge is unavailable.");
      bridge.setPlayback(true);
      const samples = [];
      const startedAt = performance.now();
      while (performance.now() - startedAt <= duration) {
        const state = bridge.getState();
        samples.push({
          wallTimeMs: performance.now(),
          simulationTime: state.simulationTime,
          rendererSimulationTime: state.renderer.simulationTime,
          bufferLagMs: state.renderer.bufferLagMs,
          positionDigest: state.renderer.positionDigest,
          renderedInstanceCount: state.renderer.renderedInstanceCount,
          expectedRenderedInstanceCount: state.renderer.expectedRenderedInstanceCount,
        });
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
      bridge.setPlayback(false);
      return samples;
    }, { durationMs, sampleIntervalMs });

  const setRegimeFilter = async (filter) => {
    await page.evaluate((value) => {
      window.__ORBIT_STUDIO_REVIEW__?.setRegimeFilter(value);
    }, filter);
    await waitForState((state) => state.regimeFilter === filter);
  };

  const capture = async (id) => {
    await settleApplication(page);
    const state = await readReviewState(page);
    datasetVersions ??= state.datasets;
    const screenshot = `screenshots/${id}.webp`;
    await captureWebp(page, path.join(outputRoot, screenshot));
    artifactStates.push({
      id,
      scenario: scenarioId,
      snapshotId: state.snapshotId,
      simulationTime: state.simulationTime,
      selectedTimelineTime: state.selectedTimelineTime,
      selectedYear: state.selectedYear,
      timelineAndSimulationAligned: state.timelineAndSimulationAligned,
      visibleObjectCount: state.visibleObjectCount,
      catalogObjectCount: state.catalogObjectCount,
      catalogResultCount: state.catalogResultCount,
      renderableOrbitStateCount: state.renderableOrbitStateCount,
      exactHistoricalOrbitStateCount: state.exactHistoricalOrbitStateCount,
      reconstructedHistoricalOrbitStateCount:
        state.reconstructedHistoricalOrbitStateCount,
      catalogOnlyObjectCount: state.catalogOnlyObjectCount,
      resolvedExactOrbitStateCount: state.resolvedExactOrbitStateCount,
      resolvedReconstructedOrbitStateCount: state.resolvedReconstructedOrbitStateCount,
      categoryCounts: state.categoryCounts,
      selectedObject: state.selectedObject,
      query: state.query,
      discoveryCollectionId: state.discoveryCollectionId,
      activeFilter: state.activeFilter,
      regimeFilter: state.regimeFilter,
      objectTypeFilters: state.objectTypeFilters,
      playback: state.playback,
      dataCoverage: state.dataCoverage,
      datasets: state.datasets,
      warningState: state.warningState,
      renderer: state.renderer,
      screenshot,
    });
    console.log(
      `[review:runtime] ${JSON.stringify({
        id,
        simulationTime: state.simulationTime,
        catalogCount: state.catalogObjectCount,
        resolvedExactObjects: state.resolvedExactOrbitStateCount,
        resolvedReconstructedObjects: state.resolvedReconstructedOrbitStateCount,
        catalogOnlyObjects: state.catalogOnlyObjectCount,
        renderQueueSize: state.renderer.renderQueueSize,
        gpuInstanceCount: state.renderer.gpuInstanceCount,
        renderedInstanceCount: state.renderer.renderedInstanceCount,
        visibleInstanceCount: state.renderer.visibleInstanceCount,
        warningState: state.warningState,
      })}`,
    );
    return state;
  };

  const clearReviewContext = async () => {
    await page.evaluate(() => window.__ORBIT_STUDIO_REVIEW__?.clearReviewContext());
    await waitForState((state) => state.query === "" && state.selectedObject === null);
  };

  return {
    capture,
    clearReviewContext,
    page,
    readReviewState: () => readReviewState(page),
    recordMilestoneValidation: (validation) => milestoneValidations.push(validation),
    recordPlaybackDeterminism: (validation) =>
      playbackDeterminismValidations.push(validation),
    samplePlaybackMotion,
    setRegimeFilter,
    setPlaybackSpeed,
    setTimelineSnapshot,
    setTimelineYear,
    waitForState,
    ...extras,
  };
}

async function openReviewPage(browser, scenarioId, options = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    ...(options.recordVideo
      ? { recordVideo: { dir: temporaryVideoRoot, size: viewport } }
      : {}),
  });
  const page = await context.newPage();
  attachBrowserDiagnostics(page, scenarioId);
  await page.goto(reviewUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForReviewBridge(page);
  await page.addStyleTag({ content: "html, body, input, textarea { caret-color: transparent !important; }" });
  await settleApplication(page, 800);
  return { context, page };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeTimelineCsv() {
  const fields = [
    "videoTimeSeconds",
    "simulationTime",
    "selectedYear",
    "catalogObjectCount",
    "visibleObjectCount",
    "exactOrbitStateCount",
    "reconstructedOrbitStateCount",
    "catalogOnlyObjectCount",
    "renderQueueSize",
    "gpuInstanceCount",
    "renderedInstanceCount",
    "visibleInstanceCount",
    "warningState",
    "positionDigest",
  ];
  const rows = timelineSamples.map((sample) => fields.map((field) => csvCell(sample[field])).join(","));
  await writeFile(path.join(outputRoot, "timeline.csv"), `${fields.join(",")}\n${rows.join("\n")}\n`);
}

async function recordTimeline(browser, scenario) {
  const { context, page } = await openReviewPage(browser, `${scenario.id}-timeline`);
  await mkdir(timelineFramesRoot, { recursive: true });
  const captureTimelineFrame = async (index, videoTimeSeconds) => {
    const state = await readReviewState(page);
    const frameName = `frame-${String(index).padStart(4, "0")}.webp`;
    await captureWebp(page, path.join(timelineFramesRoot, frameName));
    timelineSamples.push({
      videoTimeSeconds: videoTimeSeconds.toFixed(2),
      simulationTime: state.simulationTime,
      selectedYear: state.selectedYear,
      catalogObjectCount: state.catalogObjectCount,
      visibleObjectCount: state.visibleObjectCount,
      exactOrbitStateCount: state.exactHistoricalOrbitStateCount,
      reconstructedOrbitStateCount: state.reconstructedHistoricalOrbitStateCount,
      catalogOnlyObjectCount: state.catalogOnlyObjectCount,
      renderQueueSize: state.renderer.renderQueueSize,
      gpuInstanceCount: state.renderer.gpuInstanceCount,
      renderedInstanceCount: state.renderer.renderedInstanceCount,
      visibleInstanceCount: state.renderer.visibleInstanceCount,
      warningState: state.warningState,
      positionDigest: state.renderer.positionDigest,
    });
  };

  await scenario.recordTimeline(
    createScenarioTools(page, scenario.id, { captureTimelineFrame }),
  );
  await context.close();
  const outputVideoPath = path.join(outputRoot, "timeline.mp4");
  const concatPath = path.join(temporaryVideoRoot, "timeline.ffconcat");
  const frameNames = timelineSamples.map((_, index) =>
    `frame-${String(index).padStart(4, "0")}.webp`);
  const concatLines = ["ffconcat version 1.0"];
  frameNames.forEach((frameName, index) => {
    concatLines.push(`file 'frames/${frameName}'`);
    concatLines.push(`duration ${index === frameNames.length - 1 ? "0.01" : "0.25"}`);
  });
  concatLines.push(`file 'frames/${frameNames[frameNames.length - 1]}'`);
  await writeFile(concatPath, `${concatLines.join("\n")}\n`);

  await runCommand(process.env.FFMPEG_PATH ?? "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputVideoPath,
  ]);
  await writeTimelineCsv();
}

function reviewNotesMarkdown() {
  const merge = (key) => [
    ...new Set(reviewScenarios.flatMap((scenario) => scenario.notes[key])),
  ];
  const section = (title, entries) => `## ${title}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}`;

  return `${[
    section("Features implemented", merge("featuresImplemented")),
    section("Known limitations", merge("knownLimitations")),
    section("Expected review focus", merge("expectedReviewFocus")),
  ].join("\n\n")}\n`;
}

async function main() {
  const currentCatalogBuildMode =
    process.env.ORBIT_CURRENT_CATALOG_MODE ?? "release";
  if (currentCatalogBuildMode !== "release") {
    throw new Error(
      "Deterministic release review requires ORBIT_CURRENT_CATALOG_MODE=release. " +
        "Locally acquired current records are private inputs and cannot enter release evidence.",
    );
  }
  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8"),
  );
  const releaseReviewLock = await acquireReviewLock(reviewLockPath);

  try {
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(screenshotsRoot, { recursive: true });
    await mkdir(temporaryVideoRoot, { recursive: true });

    console.log("[review] Building Orbit Studio...");
    await runCommand("npm", ["run", "build"]);

    let previewServer = null;
    let browser = null;

    try {
      console.log("[review] Starting the production preview...");
      previewServer = await preview({
        root: projectRoot,
        preview: {
          host: "127.0.0.1",
          port: 4179,
          strictPort: true,
        },
      });
      browser = await chromium.launch({ headless: true });

      for (const scenario of reviewScenarios) {
        console.log(`[review] Capturing ${scenario.title}...`);
        const { context, page } = await openReviewPage(browser, scenario.id);
        await scenario.run(createScenarioTools(page, scenario.id));
        await context.close();
      }

      const timelineScenario = reviewScenarios.find((scenario) => scenario.recordTimeline);
      if (!timelineScenario) throw new Error("No review scenario defines a timeline recording.");

      console.log("[review] Recording the deterministic timeline clip...");
      await recordTimeline(browser, timelineScenario);

      const source = await readSourceIdentity(projectRoot);
      const reviewDocument = {
        schemaVersion: 5,
        build: `${packageJson.name}@${packageJson.version}`,
        gitCommit: source.gitCommit,
        gitDirty: source.gitDirty,
        source,
        generatedAt: new Date().toISOString(),
        catalogVersion: datasetVersions?.catalogVersion ?? "unavailable",
        currentCatalogMode: datasetVersions?.currentCatalogMode ?? "unavailable",
        currentCatalogRecordCount:
          datasetVersions?.currentCatalogRecordCount ?? "unavailable",
        historicalDatasetVersion:
          datasetVersions?.historicalDatasetVersion ?? "unavailable",
        viewport,
        scenarios: reviewScenarios.map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          stateIds: artifactStates
            .filter((state) => state.scenario === scenario.id)
            .map((state) => state.id),
        })),
        states: artifactStates,
        milestoneValidations,
        playbackDeterminismValidations,
        browserDiagnostics,
      };

      await writeFile(
        path.join(outputRoot, "review.json"),
        `${JSON.stringify(reviewDocument, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(outputRoot, "REVIEW_NOTES.md"),
        reviewNotesMarkdown(),
        "utf8",
      );
      await mkdir(path.join(outputRoot, "provenance"), { recursive: true });
      await Promise.all([
        copyFile(
          path.join(projectRoot, "dist/ATTRIBUTION.md"),
          path.join(outputRoot, "ATTRIBUTION.md"),
        ),
        copyFile(
          path.join(projectRoot, "dist/THIRD_PARTY_NOTICES.md"),
          path.join(outputRoot, "THIRD_PARTY_NOTICES.md"),
        ),
        copyFile(
          path.join(projectRoot, "dist/provenance/inventory.json"),
          path.join(outputRoot, "provenance/inventory.json"),
        ),
      ]);
    } finally {
      await browser?.close();
      if (previewServer) {
        await new Promise((resolve) => previewServer.httpServer.close(resolve));
      }
      await rm(temporaryVideoRoot, { recursive: true, force: true });
    }

    console.log(`[review] Review package generated at ${outputRoot}`);
  } finally {
    await releaseReviewLock();
  }
}

main().catch((error) => {
  console.error("[review] Failed to generate review package.");
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
