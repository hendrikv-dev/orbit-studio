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
  it("always leads with cloud, moonlight and temperature, in that order", () => {
    // The row was a fixed four, the fourth being smoke. Smoke is negligible on
    // most nights almost everywhere, so that slot spent every night saying
    // "Not reported" to be useful on the few nights it was not. These three
    // always bear on the decision and so are always present; anything else
    // appears only when it would change what somebody does.
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
      expect(cards.slice(0, 3).map((card) => card.id)).toEqual([
        "cloud",
        "moonlight",
        "temperature",
      ]);
    }
  });

  it("adds nothing on an ordinary night", () => {
    const cards = conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-22T06:00:00Z",
      snapshots: [snapshot()],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    });
    expect(cards).toHaveLength(3);
    expect(cards.some((card) => card.id === "smoke" || card.id === "haze")).toBe(false);
  });

  it("never exceeds five cards, however bad the night is", () => {
    // Everything at once: rain, heavy smoke, fog and a soaking dew point.
    const cards = conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-22T06:00:00Z",
      snapshots: [
        snapshot({
          precipitating: true,
          smokeColumnMgM2: 140,
          aerosolOpticalDepth: 0.9,
          visibilityM: 300,
          relativeHumidityPercent: 97,
        }),
      ],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    });
    expect(cards.length).toBeLessThanOrEqual(5);
    expect(cards.length).toBeGreaterThan(3);
    // The two that matter most survive the cap, in priority order.
    expect(cards[3].id).toBe("precipitation");
    expect(cards[4].id).toBe("smoke");
  });

  describe("smoke is not the same claim as haze", () => {
    it("says wildfire smoke only when the smoke model says so", () => {
      const cards = conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot({ smokeColumnMgM2: 60, aerosolOpticalDepth: 0.5 })],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      });
      const card = cards.find((entry) => entry.id === "smoke");
      expect(card?.label).toBe("Wildfire smoke");
      expect(card?.interpretation).toMatch(/Dims the sky by \d\.\d mag/);
    });

    it("calls thick aerosol haze, because optical depth cannot identify smoke", () => {
      // Optical depth measures dust, sea salt, pollution and smoke together.
      // Calling a hazy summer evening "Smoky" on that basis is a small
      // confident wrongness in front of the readers most likely to notice.
      const cards = conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot({ smokeColumnMgM2: 0, aerosolOpticalDepth: 0.5 })],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      });
      const card = cards.find((entry) => entry.id === "haze");
      expect(card).toBeDefined();
      expect(card?.label).toBe("Haze");
      // The reader-facing text, not the provenance note — which mentions smoke
      // precisely in order to disclaim it.
      expect(`${card?.label} ${card?.value} ${card?.interpretation}`).not.toMatch(/smok/i);
      expect(cards.some((entry) => entry.id === "smoke")).toBe(false);
    });

    it("omits both when the air is clean", () => {
      const cards = conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot({ smokeColumnMgM2: 0, aerosolOpticalDepth: 0.04 })],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      });
      expect(cards.some((entry) => entry.id === "smoke" || entry.id === "haze")).toBe(false);
    });
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
    expect(cards.temperature.value).toBe("Forecast closer to date");
    // No smoke or haze card at all beyond the horizon: there is no reading to
    // be uncertain about, and an empty slot saying so was the old defect.
    expect(cards.smoke).toBeUndefined();
    expect(cards.haze).toBeUndefined();
    for (const id of ["cloud", "temperature"] as const) {
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
    for (const id of ["cloud", "temperature"] as const) {
      expect(cards[id].tone).toBe("unknown");
      expect(cards[id].value).not.toMatch(/\d/);
    }
    expect(cards.smoke).toBeUndefined();
    expect(cards.haze).toBeUndefined();
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

  it("omits the smoke card rather than reporting an absence of smoke", () => {
    // Previously this asserted a card reading "Not reported", on the reasoning
    // that an unmeasured layer should say so rather than imply clean air. That
    // holds for cloud, which is always relevant; it does not hold for smoke,
    // which is irrelevant on most nights in most places — and a permanent slot
    // saying nothing is worse than no slot.
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
    expect(cards.smoke).toBeUndefined();
    expect(cards.haze).toBeUndefined();
    // And the cards that are always relevant are all still there.
    expect(cards.cloud).toBeDefined();
    expect(cards.moonlight).toBeDefined();
    expect(cards.temperature).toBeDefined();
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

describe("conditions that bear on this event, not every event", () => {
  const base = {
    ...PORTLAND,
    atUtc: "2026-08-22T06:00:00Z",
    snapshots: [snapshot()],
    evidenceStatus: "available" as const,
    now: NOW,
    pending: false,
  };

  const idsFor = (subject: Parameters<typeof conditionCards>[0]["subject"]) =>
    conditionCards({ ...base, subject }).map((card) => card.id);

  it("omits moonlight when the Moon is the thing being watched", () => {
    // The defect: a lunar eclipse page carried "Moonlight · Full Moon · 100% ·
    // Some glare" — the event described as its own obstacle. The Moon's
    // brightness during a lunar eclipse is the subject, not interference.
    expect(
      idsFor({ categoryId: "eclipses", moonIsTheTarget: true, moonlightSensitivity: "low" }),
    ).not.toContain("moonlight");
  });

  it("omits moonlight for a pairing the Moon is half of", () => {
    // "Moonlight washes out faint objects" is not guidance when the Moon is one
    // of the two things you are looking at.
    expect(
      idsFor({ categoryId: "pairings", moonIsTheTarget: true, moonlightSensitivity: "low" }),
    ).not.toContain("moonlight");
  });

  it("shows moonlight for meteors, where it decides whether you see anything", () => {
    expect(
      idsFor({ categoryId: "meteors", moonIsTheTarget: false, moonlightSensitivity: "high" }),
    ).toContain("moonlight");
  });

  it("shows moonlight for aurora, which is faint and wide-field", () => {
    expect(
      idsFor({ categoryId: "auroras", moonIsTheTarget: false, moonlightSensitivity: "high" }),
    ).toContain("moonlight");
  });

  it("omits moonlight for a bright planet, which it barely troubles", () => {
    // Saturn is not meaningfully affected by moonlight in any way the reader
    // can act on, so the slot goes to something that is.
    expect(
      idsFor({ categoryId: "planets", moonIsTheTarget: false, moonlightSensitivity: "low" }),
    ).not.toContain("moonlight");
  });

  it("still always answers cloud and temperature", () => {
    for (const subject of [
      { categoryId: "eclipses" as const, moonIsTheTarget: true, moonlightSensitivity: "low" as const },
      { categoryId: "meteors" as const, moonIsTheTarget: false, moonlightSensitivity: "high" as const },
      { categoryId: "planets" as const, moonIsTheTarget: false, moonlightSensitivity: "low" as const },
    ]) {
      const ids = idsFor(subject);
      expect(ids).toContain("cloud");
      expect(ids).toContain("temperature");
      // And never an empty slot.
      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(ids.length).toBeLessThanOrEqual(5);
    }
  });

  it("falls back to showing moonlight when the caller says nothing", () => {
    // Existing callers that have not been taught about subjects keep the old
    // behaviour rather than silently losing a card.
    expect(conditionCards(base).map((card) => card.id)).toContain("moonlight");
  });
});
