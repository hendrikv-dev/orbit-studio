import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  recoveryWeatherForecast,
  trackerRecoveryReviewScenario,
} from "./tracker-recovery.mjs";

const source = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "tracker-recovery.mjs"),
  "utf8",
);
const sharedTrackerSource = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "tracker.mjs"),
  "utf8",
);

function cloudAt(forecast, atUtc) {
  return forecast.properties.timeseries.find((entry) => entry.time === atUtc)
    ?.data.instant.details.cloud_area_fraction;
}

describe("Tracker recovery review forecast fixtures", () => {
  it("keeps the current observing window closed in every recovery case", () => {
    for (const caseId of [
      "following-night",
      "later-tonight",
      "tomorrow",
      "no-near-term-window",
      "location",
    ]) {
      expect(cloudAt(recoveryWeatherForecast(caseId), "2026-09-03T05:00:00.000Z"))
        .toBe(96);
    }
  });

  it("places each deterministic clearing edge on the intended night", () => {
    expect(cloudAt(recoveryWeatherForecast("later-tonight"), "2026-09-03T06:00:00.000Z"))
      .toBe(4);
    expect(cloudAt(recoveryWeatherForecast("tomorrow"), "2026-09-04T03:00:00.000Z"))
      .toBe(4);
    expect(cloudAt(recoveryWeatherForecast("following-night"), "2026-09-05T03:00:00.000Z"))
      .toBe(4);
  });

  it("never invents a good near-term hour in the no-window case", () => {
    const cloud = recoveryWeatherForecast("no-near-term-window").properties.timeseries
      .slice(0, 7 * 24)
      .map((entry) => entry.data.instant.details.cloud_area_fraction);
    expect(new Set(cloud)).toEqual(new Set([96]));
  });
});

describe("Tracker recovery review scenario contract", () => {
  it("runs through the production review surface under an explicit fixture flag", () => {
    expect(trackerRecoveryReviewScenario.requiresReviewBridge).toBe(false);
    expect(trackerRecoveryReviewScenario.catalogAuthority).toBe("none");
    expect(trackerRecoveryReviewScenario.reviewUrl).toContain("review=1");
    expect(trackerRecoveryReviewScenario.reviewUrl).toContain(
      "tracker-recovery-review=target-obscured",
    );
  });

  it.each([
    "tracker-recovery-fully-clouded-current-night",
    "tracker-recovery-next-opportunity-later-tonight",
    "tracker-recovery-next-opportunity-tomorrow",
    "tracker-recovery-strong-upcoming-fallback",
    "tracker-recovery-location-before-change",
    "tracker-recovery-location-old-result-withdrawn",
    "tracker-recovery-location-new-result",
    "tracker-recovery-forecast-update-strong-upcoming",
  ])("declares the dedicated screenshot %s", (id) => {
    expect(source).toContain(`"${id}"`);
  });

  it.each([
    "recoveryReason",
    "recoveryKind",
    "recoveryDate",
    "recoveryTarget",
    "recoveryText",
    "observer",
    "recoveryPlanningKey",
    "railCardIdentities",
  ])("captures %s in review state", (field) => {
    // Most fields come from the shared state reader and are spread into every
    // capture. The scenario names the transition-specific values it compares.
    expect(`${source}\n${sharedTrackerSource}`).toContain(field);
  });
});
