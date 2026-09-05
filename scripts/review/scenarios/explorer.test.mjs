import { describe, expect, it } from "vitest";
import { reviewPlaybackTimeScales } from "../playback-speeds.mjs";
import {
  explorerReviewScenario,
  historicalMilestoneValidation,
  latestPublicCatalogValidation,
  playbackDeterminismSignature,
  playbackMotionValidation,
} from "./explorer.mjs";

describe("Explorer review scenario", () => {
  it("records the timeline from discrete annual snapshots", async () => {
    const requestedYears = [];
    const capturedFrames = [];
    await explorerReviewScenario.recordTimeline({
      clearReviewContext: async () => {},
      setRegimeFilter: async () => {},
      setTimelineYear: async (year) => requestedYears.push(year),
      captureTimelineFrame: async (index, timeSeconds) => {
        capturedFrames.push({ index, timeSeconds });
      },
    });

    expect(requestedYears).toHaveLength(49);
    expect(requestedYears[0]).toBe(1957);
    expect(requestedYears.at(-1)).toBe("current");
    expect(
      requestedYears
        .slice(0, -1)
        .every((year) => Number.isInteger(year) && year >= 1957 && year <= 2025),
    ).toBe(true);
    expect(capturedFrames).toHaveLength(49);
    expect(capturedFrames.at(-1)).toEqual({ index: 48, timeSeconds: 12 });
  });

  it("clears search and selection before every historical capture", async () => {
    let query = "";
    let selectedObject = null;
    let historicalContextWasClear = true;
    let displayFocusRestored = true;
    let snapshotId = "snapshot-2026";
    let speed = "1x";
    const events = [];
    const milestoneValidations = [];
    const speedValidations = [];
    const populationValidations = [];
    const times = {
      "snapshot-1957": "1957-12-31T12:00:00.000Z",
      "snapshot-1961": "1961-12-31T12:00:00.000Z",
      "snapshot-1969": "1969-12-31T12:00:00.000Z",
      "snapshot-1978": "1978-12-31T12:00:00.000Z",
      "snapshot-1990": "1990-12-31T12:00:00.000Z",
      "snapshot-1998": "1998-12-31T12:00:00.000Z",
      "snapshot-2015": "2015-12-31T12:00:00.000Z",
      "snapshot-2019": "2019-12-31T12:00:00.000Z",
      "snapshot-2026": "2026-06-27T22:13:02Z",
    };
    const state = () => {
      const historical = snapshotId !== "snapshot-2026";
      const simulationTime = times[snapshotId];
      return {
        ready: true,
        snapshotId,
        selectedYear: snapshotId.replace("snapshot-", ""),
        selectedTimelineTime: simulationTime,
        simulationTime,
        query,
        selectedObject,
        playback: {
          isPlaying: false,
          speed,
          timeScale: reviewPlaybackTimeScales[speed],
        },
        visibleObjectCount: historical ? 2 : 33_474,
        catalogObjectCount: historical ? 2 : 33_489,
        renderableOrbitStateCount: historical ? 2 : 33_468,
        resolvedExactOrbitStateCount: 0,
        resolvedReconstructedOrbitStateCount: historical ? 2 : 33_468,
        catalogOnlyObjectCount: historical ? 0 : 21,
        categoryCounts: {
          payloads: historical ? 2 : 18_842,
          "rocket-bodies": historical ? 0 : 2_025,
          components: historical ? 0 : 1_345,
          debris: historical ? 0 : 11_277,
        },
        dataCoverage: {
          status: historical ? "historical-loaded" : "latest-public-catalog",
        },
        datasets: {
          currentCatalogRecordCount: 0,
          latestPublicCatalogMembershipCount: historical ? 0 : 33_489,
        },
        visualEvidence: {
          markerPixelCount: historical ? 12 : 4_000,
          markerComponentCount: historical ? 4 : 700,
        },
        warningState: historical ? "none" : "latest-public-catalog",
        renderer: {
          renderQueueSize: historical ? 2 : 33_474,
          gpuInstanceCount: historical ? 2 : 33_474,
          renderedInstanceCount: historical ? 2 : 33_474,
          visibleInstanceCount: historical ? 1 : 1_500,
          exactHistoricalRenderedCount: 0,
          nearestHistoricalRenderedCount: 0,
          reconstructedHistoricalRenderedCount: historical ? 2 : 33_468,
          curatedReferenceRenderedCount: historical ? 0 : 6,
          positionDigest: historical ? `digest-${snapshotId}` : "digest-current",
          camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], fov: 45 },
        },
      };
    };
    const search = {
      fill: async (value) => {
        if (!displayFocusRestored) {
          throw new Error("Search began before Display Settings restored focus.");
        }
        query = value;
        events.push(`query:${value}`);
      },
    };
    const option = {
      waitFor: async () => {},
      click: async () => {
        selectedObject = { name: "James Webb Space Telescope" };
        events.push("select:jwst");
      },
    };
    const starlink = {
      waitFor: async () => {},
      click: async () => {
        selectedObject = { name: "Starlink Constellation" };
        events.push("select:starlink");
      },
    };
    const collection = {
      waitFor: async () => {},
      selectOption: async (value) => {
        events.push(`collection:${value}`);
      },
    };
    const displaySettings = {
      click: async () => events.push("display:open"),
    };
    const closeDisplaySettings = {
      click: async () => {
        displayFocusRestored = false;
        events.push("display:close");
      },
    };
    const dataTab = {
      click: async () => events.push("details:data"),
    };
    const heading = {
      waitFor: async () => {},
    };
    const launcher = {
      click: async () => events.push("explore:open"),
      waitFor: async () => {},
    };
    const page = {
      getByLabel: () => collection,
      getByRole: (role, options = {}) => {
        if (role === "combobox" && options.name === "Explore collection") return collection;
        if (role === "combobox") return search;
        if (role === "option") return option;
        if (role === "tab") return dataTab;
        if (role === "heading") return heading;
        if (role === "button" && /Starlink/.test(String(options.name))) return starlink;
        if (role === "button" && options.name === "Display Settings") return displaySettings;
        if (role === "button" && options.name === "Close display settings") {
          return closeDisplaySettings;
        }
        return launcher;
      },
      locator: () => launcher,
      waitForFunction: async () => {
        displayFocusRestored = true;
        events.push("display:focus-restored");
      },
    };

    await explorerReviewScenario.run({
      page,
      capture: async (id) => {
        events.push(`capture:${id}`);
        return state();
      },
      clearReviewContext: async () => {
        query = "";
        selectedObject = null;
        events.push("clear-context");
      },
      setRegimeFilter: async () => {},
      setTimelineYear: async (year) => {
        if (year !== "current" && (query !== "" || selectedObject !== null)) {
          historicalContextWasClear = false;
        }
        snapshotId = year === "current" ? "snapshot-2026" : `snapshot-${Math.round(year)}`;
        events.push(`year:${year}`);
      },
      setTimelineSnapshot: async (nextSnapshotId) => {
        snapshotId = nextSnapshotId;
      },
      setPlaybackSpeed: async (nextSpeed) => {
        speed = nextSpeed;
      },
      readReviewState: async () => state(),
      recordMilestoneValidation: (value) => milestoneValidations.push(value),
      recordPlaybackDeterminism: (value) => speedValidations.push(value),
      recordPopulationValidation: (value) => populationValidations.push(value),
      samplePlaybackMotion: async () => {
        const timeScale = state().playback.timeScale;
        return Array.from({ length: 6 }, (_, index) => ({
          wallTimeMs: index * 100,
          simulationTime: new Date(index * 100 * timeScale).toISOString(),
          rendererSimulationTime: new Date(index * 100 * timeScale).toISOString(),
          bufferLagMs: 0,
          positionDigest: `${speed}-${index}`,
          renderedInstanceCount: 10,
          expectedRenderedInstanceCount: 10,
        }));
      },
      waitForState: async (predicate) => {
        predicate(state());
      },
    });

    expect(historicalContextWasClear).toBe(true);
    expect(events.indexOf("clear-context")).toBeLessThan(events.indexOf("year:1957"));
    expect(events).toContain("capture:explore-featured");
    expect(events).toContain("capture:explore-constellations");
    expect(events).toContain("capture:selected-starlink-overview");
    expect(events).toContain("capture:selected-starlink-data");
    expect(events).toContain("capture:display-settings");
    expect(events.indexOf("display:close")).toBeLessThan(
      events.indexOf("display:focus-restored"),
    );
    expect(events.indexOf("display:focus-restored")).toBeLessThan(
      events.indexOf("query:JWST"),
    );
    expect(events).toContain("capture:search-jwst");
    expect(events).toContain("capture:selected-jwst-overview");
    expect(events).toContain("capture:selected-jwst-data");
    expect(milestoneValidations).toHaveLength(8);
    expect(milestoneValidations.every((validation) => validation.pass)).toBe(true);
    expect(speedValidations).toHaveLength(9);
    expect(populationValidations).toHaveLength(2);
    expect(populationValidations.every((validation) => validation.pass)).toBe(true);
  });

  it("fails a milestone when resolver and renderer counts disagree", () => {
    const validation = historicalMilestoneValidation({
      simulationTime: "1957-10-04T19:28:34.000Z",
      selectedTimelineTime: "1957-10-04T19:28:34.000Z",
      snapshotId: "snapshot-1957",
      catalogObjectCount: 2,
      resolvedExactOrbitStateCount: 0,
      resolvedReconstructedOrbitStateCount: 2,
      catalogOnlyObjectCount: 0,
      warningState: "none",
      renderer: {
        renderQueueSize: 2,
        gpuInstanceCount: 2,
        renderedInstanceCount: 0,
        visibleInstanceCount: 0,
        exactHistoricalRenderedCount: 0,
        nearestHistoricalRenderedCount: 0,
        reconstructedHistoricalRenderedCount: 0,
      },
    });
    expect(validation.pass).toBe(false);
    expect(validation.failures).toContain("rendered-count-mismatch");
  });

  it("excludes playback speed from the deterministic scene signature", () => {
    const base = {
      simulationTime: "1961-04-12T06:07:00.000Z",
      catalogObjectCount: 100,
      resolvedExactOrbitStateCount: 0,
      resolvedReconstructedOrbitStateCount: 96,
      catalogOnlyObjectCount: 4,
      warningState: "none",
      renderer: {
        renderQueueSize: 96,
        gpuInstanceCount: 96,
        renderedInstanceCount: 96,
        visibleInstanceCount: 45,
        exactHistoricalRenderedCount: 0,
        nearestHistoricalRenderedCount: 0,
        reconstructedHistoricalRenderedCount: 96,
        positionDigest: "abc123",
        camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], fov: 45 },
      },
    };
    expect(playbackDeterminismSignature({ ...base, playback: { speed: "1×" } }))
      .toBe(playbackDeterminismSignature({ ...base, playback: { speed: "2500×" } }));
  });
});

describe("latest public catalog population validation", () => {
  it("rejects the former six-object visually empty release state", () => {
    const validation = latestPublicCatalogValidation({
      snapshotId: "snapshot-2026",
      visibleObjectCount: 6,
      catalogObjectCount: 29,
      renderableOrbitStateCount: 6,
      resolvedExactOrbitStateCount: 0,
      resolvedReconstructedOrbitStateCount: 0,
      catalogOnlyObjectCount: 23,
      categoryCounts: {
        payloads: 6,
        "rocket-bodies": 0,
        debris: 0,
      },
      dataCoverage: { status: "latest-public-catalog" },
      datasets: {
        currentCatalogRecordCount: 0,
        latestPublicCatalogMembershipCount: 29,
      },
      renderer: {
        renderQueueSize: 6,
        gpuInstanceCount: 6,
        renderedInstanceCount: 6,
        visibleInstanceCount: 1,
        reconstructedHistoricalRenderedCount: 0,
      },
      visualEvidence: {
        markerPixelCount: 12,
        markerComponentCount: 1,
      },
      warningState: "latest-public-catalog",
    });

    expect(validation.pass).toBe(false);
    expect(validation.failures).toContain("catalog-population-too-small");
    expect(validation.failures).toContain("rocket-bodies-missing");
    expect(validation.failures).toContain("debris-missing");
    expect(validation.failures).toContain("screen-visible-population-too-small");
    expect(validation.failures).toContain("screenshot-population-not-legible");
    expect(validation.failures).toContain("screenshot-marker-components-too-small");
  });
});

describe("moving playback validation", () => {
  const samples = Array.from({ length: 6 }, (_, index) => ({
    wallTimeMs: index * 100,
    simulationTime: new Date(index * 100_000).toISOString(),
    rendererSimulationTime: new Date(index * 100_000).toISOString(),
    bufferLagMs: 0,
    positionDigest: `digest-${index}`,
    renderedInstanceCount: 100,
    expectedRenderedInstanceCount: 100,
  }));

  it("passes motion whose clock, renderer, and GPU population advance together", () => {
    expect(playbackMotionValidation("1000x", 1_000, samples)).toMatchObject({
      pass: true,
      uniquePositionDigestCount: 6,
      requiredDistinctDigestCount: 3,
    });
  });

  it("detects the former stale-buffer failure that fixed-time review missed", () => {
    const frozen = samples.map((sample, index) => ({
      ...sample,
      rendererSimulationTime: samples[0].rendererSimulationTime,
      bufferLagMs: (index + 1) * 100_000,
      positionDigest: samples[0].positionDigest,
    }));
    const result = playbackMotionValidation("1000x", 1_000, frozen);
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("frozen-position-buffer");
    expect(result.failures).toContain("stale-render-buffer");
  });

  it("uses the renderer diagnostics observation interval without accepting a frozen buffer", () => {
    const oneIntervalLag = samples.map((sample) => ({
      ...sample,
      bufferLagMs: 500_000,
    }));
    expect(playbackMotionValidation("1000x", 1_000, oneIntervalLag)).toMatchObject({
      pass: true,
      allowedBufferLagMs: 500_000,
    });

    const stale = oneIntervalLag.map((sample) => ({
      ...sample,
      bufferLagMs: 500_001,
    }));
    expect(playbackMotionValidation("1000x", 1_000, stale)).toMatchObject({
      pass: false,
      failures: ["stale-render-buffer"],
    });
  });
});
