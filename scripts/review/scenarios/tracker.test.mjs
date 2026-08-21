import { describe, expect, it } from "vitest";
import { trackerStateValidation } from "./tracker.mjs";

/**
 * The review scenario's own judgement, tested without a browser.
 *
 * The validation function is the part of the review harness that can be wrong
 * silently: a browser run that captures a screenshot and asserts nothing is a
 * screenshot, not a review. These are the two things it exists to catch — a
 * page that has stopped being the universal layout, and an unknown sky wearing
 * a confident recommendation.
 */

describe("Tracker review scenario validation", () => {
  const valid = {
    locationAuthority: "confirmed",
    planIdentity: "phase1|45.515200|-122.678400|UTC|2026-08-19T00:00:00Z",
    category: "meteors",
    environmentStatus: "request-failed",
    recommendationLevel: "Astronomically promising — conditions unknown",
    recommendation: "A quiet sky. Conditions unknown — no forecast reached here.",
    metricCount: 3,
    conditionCardCount: 4,
    cloudValue: "Forecast unavailable",
    regions: {
      heading: true,
      hero: true,
      visualization: true,
      conditions: true,
      list: true,
    },
  };

  it("accepts an honestly degraded production state", () => {
    expect(trackerStateValidation(valid)).toMatchObject({ pass: true, failures: [] });
  });

  it("detects the former false-confidence state", () => {
    expect(
      trackerStateValidation({ ...valid, recommendationLevel: "Worth going out for" }),
    ).toMatchObject({
      pass: false,
      failures: [
        "unknown-environment-presented-as-confident",
        "unknown-environment-disclosure-missing",
      ],
    });
  });

  it("detects a page that has lost one of the four regions", () => {
    const result = trackerStateValidation({
      ...valid,
      regions: { ...valid.regions, visualization: false },
    });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("region-missing:visualization");
  });

  it("detects a phenomenon that has grown a fourth metric", () => {
    const result = trackerStateValidation({ ...valid, metricCount: 4 });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("metrics-not-three:4");
  });

  it("detects a conditions row that has gained or lost a card", () => {
    expect(trackerStateValidation({ ...valid, conditionCardCount: 5 }).failures).toContain(
      "condition-cards-not-four:5",
    );
  });

  it("detects a cloud figure invented with no forecast behind it", () => {
    const result = trackerStateValidation({ ...valid, cloudValue: "20% · Good" });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("cloud-cover-fabricated-without-evidence");
  });

  it("allows a real cloud figure once a forecast is actually available", () => {
    expect(
      trackerStateValidation({
        ...valid,
        environmentStatus: "available",
        recommendationLevel: "Worth going out for",
        cloudValue: "20% · Good",
      }),
    ).toMatchObject({ pass: true, failures: [] });
  });
});
