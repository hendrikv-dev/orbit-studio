import { describe, expect, it } from "vitest";

import {
  mobileMapToolbarProof,
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

  it("requires one compact phone Map row with Location, Date, and 2D/3D in order", () => {
    const toolbar = [
      { text: "Portland", top: 52, height: 40, width: 142 },
      { text: "Tonight · Oct 4", top: 52, height: 40, width: 112 },
      { text: "2D 3D", top: 52, height: 40, width: 77 },
    ];
    expect(mobileMapToolbarProof({ mapToolbar: toolbar })).toContain("one 40px row");
    expect(mobileMapToolbarProof({ mapToolbar: [...toolbar].reverse() })).toBe("");
    expect(mobileMapToolbarProof({ mapToolbar: toolbar.map((item, index) => ({ ...item, top: item.top + index * 45 })) })).toBe("");
  });
});
