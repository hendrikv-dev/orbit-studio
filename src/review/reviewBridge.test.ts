import { describe, expect, it } from "vitest";
import {
  explorerHistoricalWarningState,
  isOrbitStudioReviewMode,
} from "./reviewBridge";

describe("Orbit Studio review mode", () => {
  it("is explicitly enabled by the review query parameter", () => {
    expect(isOrbitStudioReviewMode("?review=1")).toBe(true);
    expect(isOrbitStudioReviewMode("?workspace=explorer&review=1")).toBe(true);
  });

  it("does not alter ordinary application sessions", () => {
    expect(isOrbitStudioReviewMode("")).toBe(false);
    expect(isOrbitStudioReviewMode("?review=0")).toBe(false);
    expect(isOrbitStudioReviewMode("?review=true")).toBe(false);
  });

  it("preserves the release-reference disclosure in review evidence", () => {
    expect(explorerHistoricalWarningState({
      catalogObjectCount: 20,
      renderableOrbitStateCount: 6,
      dataCoverage: {
        status: "current-reference-only",
        label: "Current records are not bundled",
        sourceLabels: ["Orbit Studio representative reference orbits"],
      },
    })).toBe("current-reference-only");
  });
});
