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
  /**
   * ## Two rewrites of this block, and why it is back where it started
   *
   * Originally these asserted a permanent smoke card. They were then rewritten
   * to assert the opposite — that the card is omitted when there is nothing to
   * report — because a slot reading "No smoke" every night spends a quarter of
   * the row saying nothing.
   *
   * The row is fixed at four again, on the ground that a row whose shape
   * changes with the phenomenon has to be re-read every time. So the assertions
   * are back to a permanent card, and they are deliberately *stronger* than the
   * originals rather than a revert: it is not enough that a card exists, it has
   * to distinguish the three states that were previously collapsed into
   * absence — measured and clean, unmeasured overhead but clean at ground, and
   * not covered by any model at all. Absence could not tell those apart, and
   * they are three different things to know before driving somewhere dark.
   */
  const cardFor = (overrides: Partial<ConditionSnapshot>) =>
    conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-21T09:00:00Z",
      snapshots: [snapshot(overrides)],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    }).find((card) => card.id === "smoke");

  it("quotes the cost in magnitudes rather than an index", () => {
    const card = cardFor({ aerosolOpticalDepth: 0.45 });
    expect(card?.interpretation).toMatch(/0\.5 mag/);
    expect(card?.tone).toBe("poor");
  });

  it("does not call thick aerosol smoke, because it cannot tell", () => {
    // Optical depth measures dust, sea salt, pollution and smoke together. The
    // slot is shared with the smoke model, so the *value* carries the
    // distinction the label no longer can.
    const card = cardFor({ aerosolOpticalDepth: 0.45 });
    expect(card?.value).toBe("Thick");
    expect(`${card?.value} ${card?.interpretation}`).not.toMatch(/smok/i);
    expect(card?.provenance?.detail).toMatch(/cannot identify smoke/i);
  });

  it("says the sky was measured and is clean, rather than going quiet", () => {
    // Stronger than the omission it replaces: "measured, nothing there" is a
    // claim a reader can act on, and an absent card is not.
    const card = cardFor({ aerosolOpticalDepth: 0.05 });
    expect(card?.value).toBe("Clear");
    expect(card?.tone).toBe("good");
    expect(card?.provenance?.kind).toBe("model");
  });

  it("distinguishes an unmeasured sky from a clean one", () => {
    // The state absence could never express. No aerosol model and no surface
    // reading is not the same as a transparent sky, and the card must not let
    // a reader take one for the other.
    const card = cardFor({});
    expect(card?.value).toBe("Not reported");
    expect(card?.tone).toBe("unknown");
    expect(card?.interpretation).toMatch(/no model covers this location/i);
  });

  it("labels a surface particulate reading as a ground measurement", () => {
    // PM2.5 is a health measure and must not masquerade as sky transparency.
    // Still the fallback where no aerosol model covers the location, and still
    // only shown when the air is genuinely bad.
    const card = cardFor({ surfacePm25: 70 });
    expect(card?.value).toMatch(/at ground/);
    expect(card?.interpretation).toMatch(/air to stand in/i);
    expect(card?.provenance?.detail).toMatch(/does not describe how transparent/i);
  });

  it("never promotes a ground reading into a claim about the sky", () => {
    // PM2.5 at eight is fine air to stand in and says nothing whatever about
    // transparency overhead. The card is allowed to report the first and is
    // required not to imply the second.
    const card = cardFor({ surfacePm25: 8 });
    expect(card?.value).toBe("Clear at ground");
    expect(card?.interpretation).toMatch(/nothing measured overhead/i);
    expect(card?.provenance?.detail).toMatch(/no aerosol model covers the sky/i);
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
