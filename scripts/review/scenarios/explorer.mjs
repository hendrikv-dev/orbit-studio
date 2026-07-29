const timelineCaptures = [1957, 1965, 1980, 1990, 2000, 2015];
const historicalMilestones = [
  { id: "snapshot-1957", year: "1957" },
  { id: "snapshot-1961", year: "1961" },
  { id: "snapshot-1969", year: "1969" },
  { id: "snapshot-1978", year: "1978" },
  { id: "snapshot-1990", year: "1990" },
  { id: "snapshot-1998", year: "1998" },
  { id: "snapshot-2015", year: "2015" },
  { id: "snapshot-2019", year: "2019" },
];
const playbackSpeeds = ["1x", "10x", "100x", "1000x", "max"];
const playbackTimeScales = {
  "1x": 1,
  "10x": 10,
  "100x": 100,
  "1000x": 1_000,
  max: 2_500,
};
const timelineVideoSampleRate = 4;
const timelineVideoDurationSeconds = 12;

export function historicalMilestoneValidation(state) {
  const expectedRendered =
    state.resolvedExactOrbitStateCount + state.resolvedReconstructedOrbitStateCount;
  const failures = [];
  if (state.simulationTime !== state.selectedTimelineTime) failures.push("timestamp-mismatch");
  if (state.renderer.renderQueueSize !== expectedRendered) failures.push("render-queue-mismatch");
  if (state.renderer.gpuInstanceCount !== expectedRendered) failures.push("gpu-count-mismatch");
  if (state.renderer.renderedInstanceCount !== expectedRendered) failures.push("rendered-count-mismatch");
  if (
    state.renderer.exactHistoricalRenderedCount +
      state.renderer.nearestHistoricalRenderedCount !==
    state.resolvedExactOrbitStateCount
  ) failures.push("exact-provenance-mismatch");
  if (
    state.renderer.reconstructedHistoricalRenderedCount !==
    state.resolvedReconstructedOrbitStateCount
  ) failures.push("reconstructed-provenance-mismatch");
  if (expectedRendered > 0 && state.renderer.visibleInstanceCount === 0) {
    failures.push("no-screen-visible-instances");
  }
  if (expectedRendered > 0 && state.warningState !== "none") failures.push("warning-mismatch");
  return {
    snapshotId: state.snapshotId,
    simulationTime: state.simulationTime,
    catalogObjectCount: state.catalogObjectCount,
    resolvedExactOrbitStateCount: state.resolvedExactOrbitStateCount,
    resolvedReconstructedOrbitStateCount: state.resolvedReconstructedOrbitStateCount,
    catalogOnlyObjectCount: state.catalogOnlyObjectCount,
    renderer: state.renderer,
    warningState: state.warningState,
    pass: failures.length === 0,
    failures,
  };
}

export function playbackDeterminismSignature(state) {
  return JSON.stringify({
    simulationTime: state.simulationTime,
    catalogObjectCount: state.catalogObjectCount,
    resolvedExactOrbitStateCount: state.resolvedExactOrbitStateCount,
    resolvedReconstructedOrbitStateCount: state.resolvedReconstructedOrbitStateCount,
    catalogOnlyObjectCount: state.catalogOnlyObjectCount,
    renderQueueSize: state.renderer.renderQueueSize,
    gpuInstanceCount: state.renderer.gpuInstanceCount,
    renderedInstanceCount: state.renderer.renderedInstanceCount,
    visibleInstanceCount: state.renderer.visibleInstanceCount,
    exactHistoricalRenderedCount: state.renderer.exactHistoricalRenderedCount,
    nearestHistoricalRenderedCount: state.renderer.nearestHistoricalRenderedCount,
    reconstructedHistoricalRenderedCount: state.renderer.reconstructedHistoricalRenderedCount,
    positionDigest: state.renderer.positionDigest,
    camera: state.renderer.camera,
    warningState: state.warningState,
  });
}

export function playbackMotionValidation(speed, timeScale, samples) {
  const failures = [];
  const usable = samples.filter(
    (sample) => sample.positionDigest && Number.isFinite(Date.parse(sample.simulationTime)),
  );
  if (usable.length < 4) failures.push("insufficient-motion-samples");
  const uniqueDigests = new Set(usable.map((sample) => sample.positionDigest));
  const requiredDistinctDigests = Math.min(3, usable.length);
  if (uniqueDigests.size < requiredDistinctDigests) failures.push("frozen-position-buffer");
  if (usable.some(
    (sample) => sample.renderedInstanceCount !== sample.expectedRenderedInstanceCount,
  )) failures.push("rendered-population-mismatch");

  const first = usable[0];
  const last = usable[usable.length - 1];
  const wallDeltaMs = last ? last.wallTimeMs - first.wallTimeMs : 0;
  const simulationDeltaMs = last
    ? Date.parse(last.simulationTime) - Date.parse(first.simulationTime)
    : 0;
  const observedTimeScale = wallDeltaMs > 0 ? simulationDeltaMs / wallDeltaMs : 0;
  if (!(observedTimeScale >= timeScale * 0.8 && observedTimeScale <= timeScale * 1.2)) {
    failures.push("clock-rate-mismatch");
  }
  const maximumBufferLagMs = Math.max(
    0,
    ...usable.map((sample) => Math.abs(sample.bufferLagMs)),
  );
  const allowedBufferLagMs = Math.max(350, timeScale * 350);
  if (maximumBufferLagMs > allowedBufferLagMs) failures.push("stale-render-buffer");

  return {
    speed,
    timeScale,
    sampleCount: usable.length,
    uniquePositionDigestCount: uniqueDigests.size,
    requiredDistinctDigestCount: requiredDistinctDigests,
    observedTimeScale,
    maximumBufferLagMs,
    allowedBufferLagMs,
    pass: failures.length === 0,
    failures,
    samples: usable,
  };
}

export const explorerReviewScenario = {
  id: "explorer",
  title: "Explorer",
  notes: {
    featuresImplemented: [
      "Release-safe representative Current view and explicit optional local catalog mode",
      "Educational discovery collections with first-class constellation exploration",
      "Progressive-disclosure object details and reorganized display controls",
      "Historical catalog reconstruction across the spaceflight timeline",
      "Timeline, selection, and orbit-regime filtering workflows",
    ],
    knownLimitations: [
      "Historical positions are educational reconstructions when exact source states are unavailable; provenance counts identify that distinction.",
      "The public Current review state is pinned to the documented Orbit Studio reference date; it explicitly reports that live current records are not bundled.",
    ],
    expectedReviewFocus: [
      "Verify catalog growth and coverage metadata across historical years.",
      "Verify the selected year, simulation timestamp, and rendered scene remain consistent.",
      "Review Featured Objects, constellation selection, Display settings, JWST search, and detail disclosure.",
    ],
  },

  async run({
    capture,
    clearReviewContext,
    page,
    readReviewState,
    recordMilestoneValidation,
    recordPlaybackDeterminism,
    samplePlaybackMotion,
    setPlaybackSpeed,
    setRegimeFilter,
    setTimelineSnapshot,
    setTimelineYear,
    waitForState,
  }) {
    await capture("startup");

    await page.locator(".explorer-catalog-launcher").click();
    await page.getByRole("combobox", { name: "Explore collection" }).waitFor();
    await capture("explore-featured");

    await page
      .getByRole("combobox", { name: "Explore collection" })
      .selectOption("constellations");
    await page.getByRole("button", { name: /Starlink Constellation/i }).waitFor();
    await capture("explore-constellations");

    await page.getByRole("button", { name: /Starlink Constellation/i }).click();
    await waitForState(
      (state) => state.selectedObject?.name === "Starlink Constellation",
    );
    await page.locator(".explorer-selection-card").waitFor();
    await capture("selected-starlink-overview");
    await page.getByRole("tab", { name: "Orbit & data" }).click();
    await capture("selected-starlink-data");

    await clearReviewContext();
    const displaySettingsButton = page.getByRole("button", { name: "Display Settings" });
    await displaySettingsButton.click();
    await page.getByRole("heading", { name: "Display" }).waitFor();
    await capture("display-settings");
    await page.getByRole("button", { name: "Close display settings" }).click();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Display Settings",
    );

    const search = page.getByRole("combobox", {
      name: "Search satellites, missions, and systems",
    });
    await search.fill("JWST");
    await waitForState((state) => state.query === "JWST");
    await page.getByRole("option", { name: /James Webb Space Telescope/i }).waitFor();
    await capture("search-jwst");

    await page.getByRole("option", { name: /James Webb Space Telescope/i }).click();
    await waitForState(
      (state) => state.selectedObject?.name === "James Webb Space Telescope",
    );
    await page.locator(".explorer-selection-card").waitFor();
    await capture("selected-jwst-overview");
    await page.getByRole("tab", { name: "Orbit & data" }).click();
    await capture("selected-jwst-data");

    await clearReviewContext();
    await waitForState((state) => state.query === "" && state.selectedObject === null);

    for (const year of timelineCaptures) {
      await setTimelineYear(year);
      await capture(String(year));
    }

    await setTimelineYear("current");
    await capture("current");

    const motionResults = [];
    for (const speed of playbackSpeeds) {
      await setTimelineYear("current");
      await setPlaybackSpeed(speed);
      const samples = await samplePlaybackMotion();
      const result = playbackMotionValidation(
        speed,
        playbackTimeScales[speed],
        samples,
      );
      motionResults.push(result);
      if (!result.pass) {
        throw new Error(
          `Moving playback failed at ${speed}: ${result.failures.join(", ")}; ` +
          `evidence=${JSON.stringify(result)}`,
        );
      }
      console.info(`[review:motion] ${JSON.stringify(result)}`);
    }
    recordPlaybackDeterminism({
      kind: "moving-playback",
      snapshotId: "snapshot-2026",
      pass: true,
      speeds: motionResults,
    });

    await setTimelineYear("current");
    await setRegimeFilter("leo");
    await capture("leo");

    await setRegimeFilter("geo");
    await capture("geo");

    await clearReviewContext();
    await setRegimeFilter("all");
    for (const milestone of historicalMilestones) {
      await setPlaybackSpeed("1x");
      await setTimelineSnapshot(milestone.id, { settleMs: 800 });
      const milestoneState = await capture(`milestone-${milestone.year}`);
      const milestoneResult = historicalMilestoneValidation(milestoneState);
      recordMilestoneValidation(milestoneResult);
      if (!milestoneResult.pass) {
        throw new Error(
          `Historical milestone ${milestone.id} failed: ${milestoneResult.failures.join(", ")}`,
        );
      }

      const alternateSnapshotId =
        milestone.id === historicalMilestones[0].id
          ? historicalMilestones[1].id
          : historicalMilestones[0].id;
      const speedStates = [];
      let referenceSignature = null;
      for (const speed of playbackSpeeds) {
        await setTimelineSnapshot(alternateSnapshotId, { settleMs: 250 });
        await setPlaybackSpeed(speed);
        await setTimelineSnapshot(milestone.id, { settleMs: 800 });
        const state = await readReviewState();
        const signature = playbackDeterminismSignature(state);
        referenceSignature ??= signature;
        speedStates.push({
          speed,
          simulationTime: state.simulationTime,
          signature,
          renderer: state.renderer,
        });
        if (signature !== referenceSignature) {
          throw new Error(
            `Playback speed changed the rendered population at ${milestone.id} (${speed}).`,
          );
        }
      }
      recordPlaybackDeterminism({
        snapshotId: milestone.id,
        simulationTime: milestoneState.simulationTime,
        pass: true,
        speeds: speedStates,
      });
    }
  },

  async recordTimeline({ captureTimelineFrame, clearReviewContext, setRegimeFilter, setTimelineYear }) {
    await clearReviewContext();
    await setRegimeFilter("all");

    const frameCount = timelineVideoDurationSeconds * timelineVideoSampleRate + 1;
    for (let index = 0; index < frameCount; index += 1) {
      const ratio = index / (frameCount - 1);
      const year = 1957 + (2026 - 1957) * ratio;
      await setTimelineYear(index === frameCount - 1 ? "current" : year, { settleMs: 70 });
      await captureTimelineFrame(index, index / timelineVideoSampleRate);
    }
  },
};
