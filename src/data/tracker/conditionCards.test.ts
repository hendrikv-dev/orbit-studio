import { describe, expect, it } from "vitest";
import {
  conditionCards,
  isPastEvent,
  moonlightCard,
  withinForecastHorizon,
  type ConditionCard,
} from "./conditionCards";
import { nearestSnapshot } from "./conditions";
import type { ConditionSnapshot } from "./conditions";

/**
 * The condition row's contract is mostly negative: it must never manufacture a
 * value, and it must never change shape.
 *
 * Both are load-bearing. The first is the product's whole argument; the second
 * is what makes an eclipse eighteen months out comparable with tonight, and it
 * is the thing a well-meaning change would break first by dropping cards that
 * "have nothing to say".
 */

const NOW = new Date("2026-08-21T08:00:00Z");
const PORTLAND = { latitudeDeg: 45.5152, longitudeDeg: -122.6784 };

function snapshot(overrides: Partial<ConditionSnapshot> = {}): ConditionSnapshot {
  return {
    atUtc: "2026-08-22T06:00:00Z",
    cloudCoverPercent: 20,
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

function byId(cards: ConditionCard[]) {
  return Object.fromEntries(cards.map((card) => [card.id, card]));
}

describe("the shape of the row", () => {
  it("is always the same four cards, in the same order", () => {
    const expected = ["cloud", "smoke", "moonlight", "temperature"];
    const cases = [
      { atUtc: "2026-08-22T06:00:00Z", snapshots: [snapshot()], pending: false },
      { atUtc: "2026-08-22T06:00:00Z", snapshots: [], pending: true },
      { atUtc: "2029-01-14T16:30:00Z", snapshots: [], pending: false },
    ];
    for (const item of cases) {
      const cards = conditionCards({
        ...PORTLAND,
        atUtc: item.atUtc,
        snapshots: item.snapshots,
        evidenceStatus: "available",
        now: NOW,
        pending: item.pending,
      });
      expect(cards.map((card) => card.id)).toEqual(expected);
    }
  });
});

describe("beyond the forecast horizon", () => {
  const cards = byId(
    conditionCards({
      ...PORTLAND,
      atUtc: "2029-01-14T16:30:00Z",
      snapshots: [snapshot()],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    }),
  );

  it("says the forecast does not exist yet rather than inventing one", () => {
    expect(cards.cloud.value).toBe("Forecast closer to date");
    expect(cards.smoke.value).toBe("Forecast closer to date");
    expect(cards.temperature.value).toBe("Forecast closer to date");
    for (const id of ["cloud", "smoke", "temperature"] as const) {
      expect(cards[id].tone).toBe("unknown");
      expect(cards[id].value).not.toMatch(/\d+%/);
      expect(cards[id].value).not.toMatch(/°/);
    }
  });

  it("still answers the Moon, because the Moon is geometry", () => {
    expect(cards.moonlight.value).not.toBe("Forecast closer to date");
    expect(cards.moonlight.value).toMatch(/%/);
  });

  it("draws the horizon at a week", () => {
    expect(withinForecastHorizon("2026-08-25T00:00:00Z", NOW)).toBe(true);
    expect(withinForecastHorizon("2026-09-05T00:00:00Z", NOW)).toBe(false);
  });
});

/**
 * The forecast horizon has two ends.
 *
 * The bound used to be `daysAhead <= 7`, which every negative number satisfies,
 * so a date in the past entered the branch that looks for a forecast. These
 * cases are the ones the brief names, written out one by one because "the
 * arithmetic is symmetric" is exactly the assumption that produced the defect.
 */
describe("the forecast horizon, at both ends", () => {
  const cases: [string, string, boolean][] = [
    ["yesterday", "2026-08-20T08:00:00Z", false],
    ["a week ago", "2026-08-14T08:00:00Z", false],
    ["four hours in the past", "2026-08-21T04:00:00Z", false],
    ["one hour in the past — an event still under way", "2026-08-21T07:00:00Z", true],
    ["now", "2026-08-21T08:00:00Z", true],
    ["later today", "2026-08-21T22:00:00Z", true],
    ["the horizon boundary", "2026-08-28T07:00:00Z", true],
    ["just beyond the horizon", "2026-08-28T09:00:00Z", false],
  ];

  for (const [label, atUtc, expected] of cases) {
    it(`${expected ? "accepts" : "refuses"} ${label}`, () => {
      expect(withinForecastHorizon(atUtc, NOW)).toBe(expected);
    });
  }

  it("separates the past from the not-yet-forecastable", () => {
    expect(isPastEvent("2026-08-20T08:00:00Z", NOW)).toBe(true);
    expect(isPastEvent("2026-09-30T08:00:00Z", NOW)).toBe(false);
    const past = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-08T08:00:00Z",
        snapshots: [snapshot()],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    const future = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2029-01-14T16:30:00Z",
        snapshots: [snapshot()],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    expect(past.cloud.value).toBe("Not recorded");
    expect(future.cloud.value).toBe("Forecast closer to date");
  });

  it("never attaches a live forecast to a historical event", () => {
    // The specific failure: a provider's samples are all around now, and a
    // "nearest" match with no distance cap would hand one of them to an event
    // from a fortnight ago.
    const samples = [
      snapshot({ atUtc: "2026-08-21T06:00:00Z", cloudCoverPercent: 5 }),
      snapshot({ atUtc: "2026-08-21T09:00:00Z", cloudCoverPercent: 9 }),
    ];
    expect(nearestSnapshot(samples, "2026-08-08T08:00:00Z")).toBeNull();
    expect(nearestSnapshot(samples, "2026-08-21T08:30:00Z")).not.toBeNull();

    const cards = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-08T08:00:00Z",
        snapshots: samples,
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    for (const id of ["cloud", "smoke", "temperature"] as const) {
      expect(cards[id].tone).toBe("unknown");
      expect(cards[id].value).not.toMatch(/\d/);
    }
  });

  it("still answers the Moon for a past date, because that is geometry", () => {
    const cards = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-08T08:00:00Z",
        snapshots: [snapshot()],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    expect(cards.moonlight.value).toMatch(/%/);
  });
});

describe("provider states", () => {
  it("distinguishes a request in flight from one that failed", () => {
    const pending = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [],
        evidenceStatus: "unavailable",
        now: NOW,
        pending: true,
      }),
    );
    const failed = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [],
        evidenceStatus: "request-failed",
        now: NOW,
        pending: false,
      }),
    );
    expect(pending.cloud.value).toBe("Checking…");
    expect(failed.cloud.value).toBe("Forecast unavailable");
  });

  it("says nobody measures smoke rather than reporting none of it", () => {
    const cards = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot()],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    expect(cards.smoke.value).toBe("Not reported");
    expect(cards.smoke.tone).toBe("unknown");
  });

  it("reports smoke where a provider actually supplies it", () => {
    const cards = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot({ smokeColumnMgM2: 140 })],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    expect(cards.smoke.value).toBe("Heavy");
    expect(cards.smoke.tone).toBe("poor");
  });

  it("closes the sky for rain rather than reporting a cloud percentage", () => {
    const cards = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot({ precipitating: true, cloudCoverPercent: 95 })],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    expect(cards.cloud.value).toBe("Rain or snow");
    expect(cards.cloud.tone).toBe("poor");
  });
});

describe("moonlight", () => {
  it("treats a Moon below the horizon as a dark sky whatever its phase", () => {
    // Full Moon at a time it is below Portland's horizon.
    const card = moonlightCard("2026-08-28T20:00:00Z", PORTLAND.latitudeDeg, PORTLAND.longitudeDeg);
    expect(card.value).toMatch(/below horizon/);
    expect(card.tone).toBe("good");
  });

  it("penalises a bright Moon that is actually up", () => {
    const card = moonlightCard("2026-08-28T08:00:00Z", PORTLAND.latitudeDeg, PORTLAND.longitudeDeg);
    if (!card.value.includes("below horizon")) {
      expect(["fair", "poor"]).toContain(card.tone);
    }
  });
});
