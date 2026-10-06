import { describe, expect, it } from "vitest";

import type { Opportunity } from "./opportunity";
import {
  DEFAULT_SATELLITE_ALERT_PREFERENCES,
  loadSatelliteAlertPreferences,
  satelliteAlertCandidates,
  saveSatelliteAlertPreferences,
} from "./satelliteAlerts";

function opportunity(id: string, observability = 0.9, confidence = 0.9): Opportunity {
  return {
    id,
    kind: "satellite",
    title: id.includes("train") ? "A Starlink train" : id.includes("iss") ? "The Space Station" : "Routine satellite",
    persistence: "routine",
    summary: "Moving point.",
    qualities: { observability, spectacle: 0.7, recognisability: 0.8, ease: 0.7, confidence, rarity: 0.1 },
    guidance: { appearance: "Moving point.", whenUtc: "2026-10-05T05:00:00Z", durationMinutes: 5, direction: "southwest", elevation: "high", howLong: "Five minutes.", equipment: "eyes", technique: null, safety: null },
    phenomenon: "An orbital event.",
    tonight: "Visible tonight.",
    missingInputs: [],
    limitations: [],
    profile: [],
    transparency: "low",
  };
}

describe("high-interest satellite alert architecture", () => {
  it("stays opt-in and filters low-value routine traffic", () => {
    expect(satelliteAlertCandidates([opportunity("satellite-iss")], DEFAULT_SATELLITE_ALERT_PREFERENCES)).toEqual([]);
    const preferences = { ...DEFAULT_SATELLITE_ALERT_PREFERENCES, enabled: true };
    expect(satelliteAlertCandidates([opportunity("satellite-routine", 0.4, 0.6)], preferences)).toEqual([]);
    expect(satelliteAlertCandidates([opportunity("satellite-iss")], preferences)).toHaveLength(1);
    expect(satelliteAlertCandidates([opportunity("satellite-train-g1")], preferences)[0]?.category).toBe("starlink-trains");
  });

  it("persists only user preferences and degrades safely on malformed storage", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const preferences = { ...DEFAULT_SATELLITE_ALERT_PREFERENCES, enabled: true, leadMinutes: 10 as const };
    expect(saveSatelliteAlertPreferences(storage, preferences)).toBe(true);
    expect(loadSatelliteAlertPreferences(storage)).toEqual(preferences);
    values.clear(); values.set("orbit-studio:tracker:satellite-alerts:v1", "not json");
    expect(loadSatelliteAlertPreferences(storage)).toEqual(DEFAULT_SATELLITE_ALERT_PREFERENCES);
  });
});
