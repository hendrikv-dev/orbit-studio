import { describe, expect, it } from "vitest";
import {
  AQI_ADVISORY_FLOOR,
  aerosolExtinctionMagnitudes,
  airQualityIndex,
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

describe("what the atmospheric slot says", () => {
  /**
   * ## Three rewrites, and where this settled
   *
   * A permanent smoke card, then no card when there was nothing to report,
   * then a permanent card again, and now this. The reason it kept moving is
   * that one slot was being asked to answer two questions: how transparent the
   * sky is, and whether the air is safe to stand in for an hour. They are
   * measured by different instruments, they disagree in both directions, and a
   * single label could not honestly cover both.
   *
   * So the slot below is only ever about the sky. The health question has its
   * own card and its own tests, and the pair of them is what the assertions
   * here are really protecting: neither may quietly answer for the other.
   */
  const transparencyFor = (overrides: Partial<ConditionSnapshot>) =>
    conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-21T09:00:00Z",
      snapshots: [snapshot(overrides)],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    }).find((card) => card.id === "smoke");

  it("quotes the cost in magnitudes rather than an index", () => {
    const card = transparencyFor({ aerosolOpticalDepth: 0.45 });
    expect(card?.interpretation).toMatch(/0\.5 mag/);
    expect(card?.tone).toBe("poor");
  });

  it("does not call thick aerosol smoke, because it cannot tell", () => {
    // Optical depth measures dust, sea salt, pollution and smoke together.
    const card = transparencyFor({ aerosolOpticalDepth: 0.45 });
    expect(card?.label).toBe("Transparency");
    expect(`${card?.value} ${card?.interpretation}`).not.toMatch(/smok/i);
    expect(card?.provenance?.detail).toMatch(/cannot identify smoke/i);
  });

  it("says smoke only when a smoke model says smoke", () => {
    const card = transparencyFor({ smokeColumnMgM2: 60, aerosolOpticalDepth: 0.5 });
    expect(card?.label).toBe("Smoke");
    expect(card?.provenance?.detail).toMatch(/smoke model/i);
  });

  it("says the sky was measured and is clean, rather than going quiet", () => {
    const card = transparencyFor({ aerosolOpticalDepth: 0.05 });
    expect(card?.value).toBe("Clear");
    expect(card?.tone).toBe("good");
  });

  it("has no slot at all where nothing measures the sky", () => {
    // The state that used to read "Not reported · No model covers this
    // location" on every page in the region. An absent measurement is not a
    // fact about tonight, and printing it on every page is the clutter the
    // brief asks to remove.
    expect(transparencyFor({})).toBeUndefined();
  });

  it("never lets a ground reading become a claim about the sky", () => {
    // PM2.5 says what the air is like to stand in and nothing whatever about
    // transparency overhead. With no aerosol model there is no transparency
    // card, however much particulate is being reported at head height.
    expect(transparencyFor({ surfacePm25: 8 })).toBeUndefined();
    expect(transparencyFor({ surfacePm25: 90 })).toBeUndefined();
  });
});

describe("air quality, which is a health question", () => {
  const alertFor = (overrides: Partial<ConditionSnapshot>) =>
    conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-21T09:00:00Z",
      snapshots: [snapshot(overrides)],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    }).find((card) => card.id === "air-quality");

  it("says nothing at all when the air is normal", () => {
    // The whole point. "AQI 23 · Good" is a dashboard reading: it tells a
    // reader nothing they can act on and it is on the page every single night.
    expect(alertFor({ surfacePm25: 5 })).toBeUndefined();
    expect(alertFor({ surfacePm25: 8.9 })).toBeUndefined();
  });

  it("stays quiet through the whole moderate band", () => {
    // Moderate mentions only unusually sensitive people, and firing there would
    // put a health warning on ordinary summer afternoons in most cities.
    expect(alertFor({ surfacePm25: 12 })).toBeUndefined();
    expect(alertFor({ surfacePm25: 35.4 })).toBeUndefined();
  });

  it("appears at the first category that carries outdoor advice", () => {
    const card = alertFor({ surfacePm25: 35.5 });
    expect(card).toBeDefined();
    expect(card?.value).toMatch(/^AQI 101 · Unhealthy for sensitive groups$/);
    expect(card?.interpretation).toMatch(/heart or lung conditions/i);
    expect(card?.tone).toBe("fair");
  });

  it("gets stronger as the category does", () => {
    const unhealthy = alertFor({ surfacePm25: 80 });
    expect(unhealthy?.value).toMatch(/· Unhealthy$/);
    expect(unhealthy?.tone).toBe("poor");
    const veryUnhealthy = alertFor({ surfacePm25: 200 });
    expect(veryUnhealthy?.value).toMatch(/· Very unhealthy$/);
    expect(veryUnhealthy?.interpretation).toMatch(/everyone should avoid/i);
  });

  it("says where its number came from, including what is wrong with it", () => {
    // The breakpoints are defined on a 24-hour average and this is an hourly
    // value, so the figure runs high on a short plume. Saying so is the
    // difference between a measurement and a claim.
    const card = alertFor({ surfacePm25: 60 });
    expect(card?.provenance?.detail).toMatch(/24-hour breakpoints/i);
    expect(card?.provenance?.detail).toMatch(/NowCast/i);
    expect(card?.provenance?.detail).toMatch(/does not describe how transparent/i);
  });

  it("says nothing when no particulate reading exists", () => {
    // Absence of a health measurement is not a clean bill of health, and it is
    // also not worth a card. Silence is the only honest option that is not
    // clutter.
    expect(alertFor({})).toBeUndefined();
  });

  it("is independent of the sky: clean air can sit under a ruined sky", () => {
    // The two genuinely disagree. A thin smoke layer aloft wrecks transparency
    // while the air at head height is fine, and the interface must be able to
    // say both.
    const cards = conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-21T09:00:00Z",
      snapshots: [snapshot({ aerosolOpticalDepth: 0.9, surfacePm25: 4 })],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    });
    const transparency = cards.find((card) => card.id === "smoke");
    expect(transparency?.value).toBe("Poor");
    expect(cards.find((card) => card.id === "air-quality")).toBeUndefined();
  });

  it("and a fine sky can sit under air worth warning about", () => {
    const cards = conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-21T09:00:00Z",
      snapshots: [snapshot({ aerosolOpticalDepth: 0.04, surfacePm25: 70 })],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    });
    expect(cards.find((card) => card.id === "smoke")?.value).toBe("Clear");
    expect(cards.find((card) => card.id === "air-quality")?.value).toMatch(/Unhealthy/);
  });
});

describe("the index itself", () => {
  it("puts the published category boundaries where the EPA puts them", () => {
    expect(airQualityIndex(0).aqi).toBe(0);
    expect(airQualityIndex(9).aqi).toBe(50);
    expect(airQualityIndex(9.1).aqi).toBe(51);
    expect(airQualityIndex(35.4).aqi).toBe(100);
    expect(airQualityIndex(35.5).aqi).toBe(101);
    expect(airQualityIndex(55.5).aqi).toBe(151);
    expect(airQualityIndex(125.5).aqi).toBe(201);
  });

  it("only claims an advisory from the first category that has one", () => {
    expect(airQualityIndex(9).advisory).toBe(false);
    expect(airQualityIndex(35.4).advisory).toBe(false);
    expect(airQualityIndex(35.5).advisory).toBe(true);
    expect(AQI_ADVISORY_FLOOR).toBe(101);
  });

  it("carries the category's own guidance rather than inventing any", () => {
    expect(airQualityIndex(5).guidance).toBeNull();
    expect(airQualityIndex(40).guidance).toMatch(/sensitive|heart or lung/i);
    expect(airQualityIndex(300).guidance).toMatch(/indoors|avoid/i);
  });

  it("does not run off the end of the scale", () => {
    expect(airQualityIndex(5000).aqi).toBeLessThanOrEqual(500);
    expect(airQualityIndex(-5).aqi).toBe(0);
  });
});
