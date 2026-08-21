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

const scenarioOptionIndex = process.argv.indexOf("--scenario");
const requestedScenarioIds =
  scenarioOptionIndex >= 0
    ? (process.argv[scenarioOptionIndex + 1] ?? "").split(",").filter(Boolean)
    : [];
const activeReviewScenarios =
  requestedScenarioIds.length === 0
    ? reviewScenarios
    : reviewScenarios.filter((scenario) => requestedScenarioIds.includes(scenario.id));
if (activeReviewScenarios.length !== (requestedScenarioIds.length || reviewScenarios.length)) {
  throw new Error(`Unknown review scenario in: ${requestedScenarioIds.join(", ")}`);
}

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
const populationValidations = [];
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
  const screenshotBuffer = Buffer.from(data, "base64");
  await writeFile(outputPath, screenshotBuffer);
  return screenshotBuffer;
}

async function readScreenshotPopulationEvidence(page, screenshotBuffer) {
  return page.evaluate(async (screenshotDataUrl) => {
    const image = new Image();
    image.src = screenshotDataUrl;
    await image.decode();
    const readback = document.createElement("canvas");
    readback.width = image.naturalWidth;
    readback.height = image.naturalHeight;
    const context = readback.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Screenshot population evidence could not create a 2D context.");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, readback.width, readback.height).data;
    const mask = new Uint8Array(readback.width * readback.height);
    const palettes = [
      [159, 199, 223],
      [185, 169, 142],
      [194, 143, 129],
    ];
    const centerX = readback.width / 2;
    const centerY = readback.height / 2;
    const earthExclusionRadius = Math.min(readback.width, readback.height) * 0.24;
    const orbitalEvidenceRadius = Math.min(readback.width, readback.height) * 0.48;
    let candidatePixelCount = 0;

    for (let y = 0; y < readback.height; y += 1) {
      for (let x = 0; x < readback.width; x += 1) {
        const distanceFromEarth = Math.hypot(x - centerX, y - centerY);
        if (
          distanceFromEarth <= earthExclusionRadius ||
          distanceFromEarth >= orbitalEvidenceRadius
        ) {
          continue;
        }
        const pixelIndex = y * readback.width + x;
        const offset = pixelIndex * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const alpha = pixels[offset + 3];
        const maximum = Math.max(red, green, blue);
        if (alpha < 220 || maximum < 48) continue;

        const matchesPalette = palettes.some(([paletteRed, paletteGreen, paletteBlue]) => {
          const paletteMaximum = Math.max(paletteRed, paletteGreen, paletteBlue);
          const chromaDistance = Math.hypot(
            red / maximum - paletteRed / paletteMaximum,
            green / maximum - paletteGreen / paletteMaximum,
            blue / maximum - paletteBlue / paletteMaximum,
          );
          return chromaDistance <= 0.16;
        });
        if (!matchesPalette) continue;
        mask[pixelIndex] = 1;
        candidatePixelCount += 1;
      }
    }

    const queue = new Int32Array(mask.length);
    let markerPixelCount = 0;
    let markerComponentCount = 0;
    for (let start = 0; start < mask.length; start += 1) {
      if (mask[start] !== 1) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      mask[start] = 2;
      while (head < tail) {
        const current = queue[head++];
        const x = current % readback.width;
        const y = Math.floor(current / readback.width);
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const nextX = x + offsetX;
            const nextY = y + offsetY;
            if (
              nextX < 0 ||
              nextX >= readback.width ||
              nextY < 0 ||
              nextY >= readback.height
            ) continue;
            const next = nextY * readback.width + nextX;
            if (mask[next] !== 1) continue;
            mask[next] = 2;
            queue[tail++] = next;
          }
        }
      }
      if (tail >= 3 && tail <= 160) {
        markerComponentCount += 1;
        markerPixelCount += tail;
      }
    }

    return {
      canvasWidth: readback.width,
      canvasHeight: readback.height,
      earthExclusionRadius,
      orbitalEvidenceRadius,
      candidatePixelCount,
      markerComponentCount,
      markerPixelCount,
      method: "captured-screenshot-orbital-annulus-category-chroma-components-v2",
    };
  }, `data:image/webp;base64,${screenshotBuffer.toString("base64")}`);
}

function createScenarioTools(page, scenarioId, extras = {}) {
  const captureSurface = async (id, state = {}) => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.waitForTimeout(250);
    const screenshot = `screenshots/${id}.webp`;
    await captureWebp(page, path.join(outputRoot, screenshot));
    const captured = { id, scenario: scenarioId, ...state, screenshot };
    artifactStates.push(captured);
    return captured;
  };
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
    const screenshotBuffer = await captureWebp(page, path.join(outputRoot, screenshot));
    const visualEvidence = await readScreenshotPopulationEvidence(page, screenshotBuffer);
    const capturedState = { ...state, visualEvidence };
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
      visualEvidence,
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
        markerPixelCount: visualEvidence.markerPixelCount,
        markerComponentCount: visualEvidence.markerComponentCount,
        warningState: state.warningState,
      })}`,
    );
    return capturedState;
  };

  const clearReviewContext = async () => {
    await page.evaluate(() => window.__ORBIT_STUDIO_REVIEW__?.clearReviewContext());
    await waitForState((state) => state.query === "" && state.selectedObject === null);
  };

  return {
    capture,
    captureSurface,
    clearReviewContext,
    page,
    readReviewState: () => readReviewState(page),
    recordMilestoneValidation: (validation) => milestoneValidations.push(validation),
    recordPlaybackDeterminism: (validation) =>
      playbackDeterminismValidations.push(validation),
    recordPopulationValidation: (validation) =>
      populationValidations.push(validation),
    samplePlaybackMotion,
    setRegimeFilter,
    setPlaybackSpeed,
    setTimelineSnapshot,
    setTimelineYear,
    waitForState,
    ...extras,
  };
}

async function openReviewPage(browser, scenarioOrId, options = {}) {
  const scenario = typeof scenarioOrId === "string" ? null : scenarioOrId;
  const scenarioId = scenario?.id ?? scenarioOrId;
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
  await page.goto(scenario?.reviewUrl ?? reviewUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (scenario?.requiresReviewBridge === false) {
    await page.locator(scenario.readySelector ?? "main").waitFor({ state: "visible", timeout: 45_000 });
  } else {
    await waitForReviewBridge(page);
  }
  await page.addStyleTag({ content: "html, body, input, textarea { caret-color: transparent !important; }" });
  if (scenario?.requiresReviewBridge === false) {
    await page.waitForTimeout(800);
  } else {
    await settleApplication(page, 800);
  }
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
    ...new Set(activeReviewScenarios.flatMap((scenario) => scenario.notes[key])),
  ];
  const section = (title, entries) => `## ${title}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}`;

  return `${[
    section("Features implemented", merge("featuresImplemented")),
    section("Known limitations", merge("knownLimitations")),
    section("Expected review focus", merge("expectedReviewFocus")),
  ].join("\n\n")}\n`;
}

async function main() {
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

      for (const scenario of activeReviewScenarios) {
        console.log(`[review] Capturing ${scenario.title}...`);
        const { context, page } = await openReviewPage(browser, scenario);
        await scenario.run(createScenarioTools(page, scenario.id));
        await context.close();
      }

      const timelineScenario = activeReviewScenarios.find((scenario) => scenario.recordTimeline);
      if (timelineScenario) {
        console.log("[review] Recording the deterministic timeline clip...");
        await recordTimeline(browser, timelineScenario);
      }

      const source = await readSourceIdentity(projectRoot);
      const reviewDocument = {
        schemaVersion: 6,
        build: `${packageJson.name}@${packageJson.version}`,
        gitCommit: source.gitCommit,
        gitDirty: source.gitDirty,
        source,
        generatedAt: new Date().toISOString(),
        catalogVersion: datasetVersions?.catalogVersion ?? "unavailable",
        currentCatalogMode: datasetVersions?.currentCatalogMode ?? "unavailable",
        currentCatalogRecordCount:
          datasetVersions?.currentCatalogRecordCount ?? "unavailable",
        latestPublicCatalogMembershipCount:
          datasetVersions?.latestPublicCatalogMembershipCount ?? "unavailable",
        historicalDatasetVersion:
          datasetVersions?.historicalDatasetVersion ?? "unavailable",
        viewport,
        scenarios: activeReviewScenarios.map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          stateIds: artifactStates
            .filter((state) => state.scenario === scenario.id)
            .map((state) => state.id),
        })),
        states: artifactStates,
        milestoneValidations,
        playbackDeterminismValidations,
        populationValidations,
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
