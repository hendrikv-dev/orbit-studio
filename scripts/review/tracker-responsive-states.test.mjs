import { describe, expect, it } from "vitest";

import {
  navigationCapabilityProof,
  ordinaryDetailProof,
} from "./tracker-responsive-states.mjs";

const base = {
  nav: ["Map", "Tonight"],
  finderEntries: [],
  permissionAttempts: [],
  mapState: "detail",
  detailMoreOpen: false,
  genericShowOnMap: false,
};

describe("Tracker responsive review preconditions", () => {
  it("accepts the supported and unsupported capability contracts", () => {
    expect(
      navigationCapabilityProof(
        { ...base, nav: ["Map", "Tonight", "Sky"], finderEntries: ["Find in Sky"] },
        true,
      ),
    ).toContain("Find in Sky present");
    expect(navigationCapabilityProof(base, false)).toContain("no Find in Sky");
    expect(ordinaryDetailProof(base, false)).toContain("collapsed detail");
  });

  it("rejects the former desktop preview and universal object-map action", () => {
    expect(
      navigationCapabilityProof(
        { ...base, nav: ["Map", "Tonight", "Sky"], finderEntries: ["Preview in sky"] },
        false,
      ),
    ).toBe("");
    expect(ordinaryDetailProof({ ...base, genericShowOnMap: true }, false)).toBe("");
    expect(ordinaryDetailProof({ ...base, finderEntries: ["Find in Sky"] }, false)).toBe("");
  });
});
