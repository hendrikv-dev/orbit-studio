import { describe, expect, it } from "vitest";
import {
  aerosolExtinctionMagnitudes,
  parseAerosolSamples,
  readAerosol,
  withAerosol,
} from "./airQuality";
import { skyAccess, type ConditionSnapshot } from "./conditions";
import { conditionCards } from "./conditionCards";

/**
 * The smoke card was a permanently empty slot in the most valuable row on the
 * page. These tests are about the two ways backing it could go wrong: reporting
 * a clean sky on no evidence, and letting a health measurement stand in for a
 * transparency one.
 */

const NOW = new Date("2026-08-21T08:00:00Z");
const PORTLAND = { latitudeDeg: 45.5152, longitudeDeg: -122.6784 };

function snapshot(overrides: Partial<ConditionSnapshot> = {}): ConditionSnapshot {
  return {
    atUtc: "2026-08-21T09:00:00Z",
    cloudCoverPercent: 10,
    temperatureC: 14,
    issuedUtc: "2026-08-21T06:00:00Z",
    precipitating: false,
    visibilityM: null,
    lowCloudPercent: null,
    midCloudPercent: null,
    highCloudPercent: null,
    relativeHumidityPercent: null,
    smokeColumnMgM2: null,
    surfacePm25: null,
    source: "test",
    ...overrides,
  };
}

describe("reading the aerosol model", () => {
  it("parses Open-Meteo's hourly arrays into instants", () => {
    const samples = parseAerosolSamples({
      hourly: {
        time: ["2026-08-21T08:00", "2026-08-21T09:00"],
        pm2_5: [6, null],
        aerosol_optical_depth: [0.14, 0.31],
      },
    });
    expect(samples).toHaveLength(2);
    expect(samples[0].atUtc).toBe("2026-08-21T08:00:00.000Z");
    expect(samples[0].aerosolOpticalDepth).toBeCloseTo(0.14);
    expect(samples[1].surfacePm25).toBeNull();
  });

  it("returns nothing rather than guessing from an unusable body", () => {
    expect(parseAerosolSamples({})).toHaveLength(0);
    expect(parseAerosolSamples({ hourly: { time: [] } })).toHaveLength(0);
  });

  it("converts optical depth into the magnitudes an observer loses", () => {
    // Transmission is e^-tau, and a magnitude is -2.5 log10 of a flux ratio.
    expect(aerosolExtinctionMagnitudes(0)).toBeCloseTo(0, 6);
    expect(aerosolExtinctionMagnitudes(1)).toBeCloseTo(1.0857, 3);
    expect(aerosolExtinctionMagnitudes(0.4)).toBeCloseTo(0.434, 3);
  });

  it("names the ranges in ascending order", () => {
    expect(readAerosol(0.03)).toBe("clean");
    expect(readAerosol(0.14)).toBe("slight");
    expect(readAerosol(0.3)).toBe("hazy");
    expect(readAerosol(0.6)).toBe("smoky");
    expect(readAerosol(1.4)).toBe("heavy");
  });
});

describe("folding aerosol into the forecast", () => {
  it("matches by time rather than by position", () => {
    const merged = withAerosol(
      [snapshot({ atUtc: "2026-08-21T09:00:00Z" })],
      [
        { atUtc: "2026-08-21T03:00:00Z", aerosolOpticalDepth: 0.9, surfacePm25: 60 },
        { atUtc: "2026-08-21T09:00:00Z", aerosolOpticalDepth: 0.12, surfacePm25: 5 },
      ],
    );
    expect(merged[0].aerosolOpticalDepth).toBeCloseTo(0.12);
  });

  it("leaves a snapshot untouched when nothing is near it in time", () => {
    const merged = withAerosol(
      [snapshot({ atUtc: "2026-08-21T09:00:00Z" })],
      [{ atUtc: "2026-08-19T09:00:00Z", aerosolOpticalDepth: 0.9, surfacePm25: 60 }],
    );
    // Not "clean" — unmeasured. The distinction is the whole point.
    expect(merged[0].aerosolOpticalDepth).toBeUndefined();
  });

  it("returns the snapshots unchanged when the model returned nothing", () => {
    const base = [snapshot()];
    expect(withAerosol(base, [])).toBe(base);
  });
});

describe("what the card says", () => {
  const cardFor = (overrides: Partial<ConditionSnapshot>) =>
    conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-21T09:00:00Z",
      snapshots: [snapshot(overrides)],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    }).find((card) => card.id === "smoke")!;

  it("quotes the cost in magnitudes rather than an index", () => {
    const card = cardFor({ aerosolOpticalDepth: 0.45 });
    expect(card.value).toBe("Smoky");
    expect(card.interpretation).toMatch(/0\.5 mag/);
    expect(card.tone).toBe("poor");
  });

  it("calls a transparent sky transparent", () => {
    const card = cardFor({ aerosolOpticalDepth: 0.05 });
    expect(card.value).toBe("Clean");
    expect(card.tone).toBe("good");
  });

  it("still refuses to report anything with no model behind it", () => {
    const card = cardFor({});
    expect(card.value).toBe("Not reported");
    expect(card.tone).toBe("unknown");
  });

  it("labels a surface particulate reading as a ground measurement", () => {
    // PM2.5 is a health measure and must not masquerade as sky transparency.
    const card = cardFor({ surfacePm25: 70 });
    expect(card.value).toMatch(/at ground/);
    expect(card.interpretation).toMatch(/air to stand in/i);
  });
});

describe("aerosol reaching the viewing model", () => {
  it("costs a demanding target more than a bright one", () => {
    const smoky = snapshot({ aerosolOpticalDepth: 1.2 });
    expect(skyAccess(smoky, "high")).toBeLessThan(skyAccess(smoky, "low"));
  });

  it("reduces sky access relative to the same sky without aerosol", () => {
    const clear = snapshot();
    const smoky = snapshot({ aerosolOpticalDepth: 1.2 });
    expect(skyAccess(smoky, "high")).toBeLessThan(skyAccess(clear, "high"));
  });

  it("treats an absent measurement as no penalty rather than as heavy smoke", () => {
    expect(skyAccess(snapshot(), "high")).toBeCloseTo(
      skyAccess(snapshot({ aerosolOpticalDepth: 0 }), "high"),
      6,
    );
  });
});
