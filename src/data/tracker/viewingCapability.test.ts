import { describe, expect, it } from "vitest";

import type { Opportunity } from "./opportunity";
import {
  activeTelescopeSetup,
  loadTelescopeSetups,
  saveTelescopeSetups,
  telescopeGuidanceFor,
  telescopeSetupStorageKey,
  type StoredTelescopeSetups,
} from "./viewingCapability";

const SATURN = {
  id: "planet-saturn",
  kind: "planet",
  title: "Saturn",
  guidance: { equipment: "eyes", whenUtc: "2026-09-26T04:00:00Z" },
  science: { kind: "planet", body: "Saturn", event: null },
} as unknown as Opportunity;

const VALUE: StoredTelescopeSetups = {
  version: 1,
  activeId: "dob-8",
  setups: [{
    id: "dob-8",
    name: "8-inch Dobsonian",
    type: "reflector",
    apertureMm: 203,
    focalLengthMm: 1_200,
    eyepiecesMm: [25, 10],
    mount: "alt-az",
    tracking: false,
    goto: false,
  }],
};

describe("device-local telescope setups", () => {
  it("handles cold and malformed storage without forcing configuration", () => {
    expect(loadTelescopeSetups({ getItem: () => null })).toEqual({ version: 1, activeId: null, setups: [] });
    expect(loadTelescopeSetups({ getItem: () => "not-json" })).toEqual({ version: 1, activeId: null, setups: [] });
  });

  it("round-trips a valid saved setup and makes it immediately active", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveTelescopeSetups(storage, VALUE);
    expect(values.has(telescopeSetupStorageKey())).toBe(true);
    expect(activeTelescopeSetup(loadTelescopeSetups(storage))).toEqual(VALUE.setups[0]);
  });

  it("adds conservative Saturn help only when the active telescope is supplied", () => {
    expect(telescopeGuidanceFor(SATURN, null)).toBeNull();
    expect(telescopeGuidanceFor(SATURN, VALUE.setups[0])).toEqual({
      heading: "Recommended view with 8-inch Dobsonian",
      eyepiece: "10 mm eyepiece",
      magnification: "120×",
      expectation: "The rings should be distinct; Titan may appear as a nearby point in steady, transparent conditions.",
    });
  });
});
