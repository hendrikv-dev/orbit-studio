import { describe, expect, it } from "vitest";
import {
  explorerHistoricalWarningState,
  isOrbitStudioReviewMode,
  reviewInstantsEqual,
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

  it("preserves the reconstructed latest-public disclosure in review evidence", () => {
    expect(explorerHistoricalWarningState({
      catalogObjectCount: 33_489,
      renderableOrbitStateCount: 33_468,
      dataCoverage: {
        status: "latest-public-catalog",
        label: "GCAT membership · reconstructed positions",
        sourceLabels: ["GCAT public catalog snapshot"],
      },
    })).toBe("latest-public-catalog");
  });

  it("treats equivalent ISO serializations as the same review instant", () => {
    expect(
      reviewInstantsEqual(
        "2026-06-27T22:13:02Z",
        "2026-06-27T22:13:02.000Z",
      ),
    ).toBe(true);
    expect(
      reviewInstantsEqual(
        "2026-06-27T22:13:02.001Z",
        "2026-06-27T22:13:02.000Z",
      ),
    ).toBe(false);
    expect(reviewInstantsEqual("not-a-time", "not-a-time")).toBe(false);
  });
});
