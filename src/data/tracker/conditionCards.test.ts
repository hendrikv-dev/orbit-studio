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
  /**
   * ## The row is four, and the same four, whatever the night does
   *
   * These assertions have been round the loop once. They started as a fixed
   * four, were rewritten to a dynamic three-plus-conditional row on the ground
   * that a permanently empty smoke slot wastes a quarter of the most valuable
   * strip on the page, and are now fixed again.
   *
   * The argument that settled it is not about smoke: it is that the row is the
   * one piece of geometry a returning reader learns. A reader who knows the
   * second card is smoke can check smoke without reading; a reader whose second
   * card is sometimes smoke and sometimes moonlight has to read all four, every
   * time, on every page. The permanently-empty-slot cost is real and smaller.
   *
   * So the contract asserted here is stronger than the original fixed row was:
   * exactly four, in a fixed order, on every input state — including the states
   * that previously produced three, five, or a differently ordered row.
   */
  const FOUR = ["cloud", "smoke", "moonlight", "temperature"];

  it("is always the same four cards, in the same order", () => {
    const cases = [
      // An ordinary night with a full forecast.
      { atUtc: "2026-08-22T06:00:00Z", snapshots: [snapshot()], pending: false },
      // Still fetching.
      { atUtc: "2026-08-22T06:00:00Z", snapshots: [], pending: true },
      // Beyond the forecast horizon.
      { atUtc: "2029-01-14T16:30:00Z", snapshots: [], pending: false },
      // Everything at once: rain, heavy smoke, fog and a soaking dew point.
      {
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
        pending: false,
      },
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
      expect(cards.map((card) => card.id)).toEqual(FOUR);
    }
  });

  it("folds rain into cloud rather than growing a fifth card", () => {
    // Rain is the most decisive thing on the page and has nowhere of its own to
    // go. It takes over the cloud card's headline, which is where a reader
    // looking for "is there a sky tonight" is already looking.
    const cards = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot({ precipitating: true })],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    expect(cards.cloud.value).toMatch(/rain|snow/i);
    expect(cards.cloud.tone).toBe("poor");
  });

  it("folds dew into temperature rather than growing a fifth card", () => {
    // Dew is what the night's air does to a lens, which is temperature's
    // department. The number stays the headline because that is what the card
    // is for.
    const cards = byId(
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot({ relativeHumidityPercent: 97 })],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }),
    );
    expect(cards.temperature.interpretation).toMatch(/dew at 97% humidity/i);
  });

  describe("smoke is not the same claim as haze", () => {
    /**
     * The two claims now share one slot, so the distinction has to live in the
     * card's own words instead of in which card appeared. That is a weaker
     * signal than a different label was, which is why these assertions are on
     * the value and the provenance rather than on the label alone.
     */
    const smokeCardFor = (overrides: Partial<ConditionSnapshot>) =>
      conditionCards({
        ...PORTLAND,
        atUtc: "2026-08-22T06:00:00Z",
        snapshots: [snapshot(overrides)],
        evidenceStatus: "available",
        now: NOW,
        pending: false,
      }).find((entry) => entry.id === "smoke");

    it("says wildfire smoke only when the smoke model says so", () => {
      const card = smokeCardFor({ smokeColumnMgM2: 60, aerosolOpticalDepth: 0.5 });
      expect(card?.value).toMatch(/moderate|heavy/i);
      expect(card?.interpretation).toMatch(/Dims the sky by \d\.\d mag/);
      expect(card?.provenance?.detail).toMatch(/smoke model/i);
    });

    it("calls thick aerosol haze, because optical depth cannot identify smoke", () => {
      // Optical depth measures dust, sea salt, pollution and smoke together.
      // Calling a hazy summer evening "Smoky" on that basis is a small
      // confident wrongness in front of the readers most likely to notice.
      const card = smokeCardFor({ smokeColumnMgM2: 0, aerosolOpticalDepth: 0.5 });
      expect(card?.value).toBe("Thick");
      // The reader-facing text, not the provenance note — which mentions smoke
      // precisely in order to disclaim it.
      expect(`${card?.value} ${card?.interpretation}`).not.toMatch(/smok/i);
      expect(card?.provenance?.detail).toMatch(/cannot identify smoke/i);
    });

    it("says the air was measured and is clean, which absence could not", () => {
      const card = smokeCardFor({ smokeColumnMgM2: 0, aerosolOpticalDepth: 0.04 });
      expect(card?.value).toBe("Clear");
      expect(card?.tone).toBe("good");
      // Distinguishable from the unmeasured state, which is the whole reason
      // the slot is permanent rather than conditional.
      expect(card?.value).not.toBe("Not reported");
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
    // Smoke keeps its slot and says the same thing the others do. The point of
    // the permanent row is that a reader planning an eclipse three years out
    // can see at a glance that three of the four are simply not knowable yet,
    // which an absent card cannot tell them.
    expect(cards.smoke.value).toBe("Forecast closer to date");
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
    // "Not recorded", not "forecast closer to date": the date has been and
    // gone, and Tracker keeps no weather history to answer it from.
    expect(cards.smoke.value).toBe("Not recorded");
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

  it("says nobody measured the air rather than implying it is clean", () => {
    // Previously this asserted a card reading "Not reported", on the reasoning
    // that an unmeasured layer should say so rather than imply clean air. That
    // holds for every slot, smoke included: with no aerosol model and no
    // surface reading the honest answer is that nobody measured it, and that
    // is a different statement from "the air is clean".
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
    expect(cards.smoke.interpretation).toMatch(/no model covers this location/i);
    // And every other slot is still there.
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

  const moonlightFor = (subject: Parameters<typeof conditionCards>[0]["subject"]) =>
    conditionCards({ ...base, subject }).find((card) => card.id === "moonlight");

  /**
   * The card stays; what it *says* changes.
   *
   * These previously asserted the card was dropped where the Moon was the
   * subject or barely mattered. Dropping it is what made the row change shape
   * between phenomena, and the phase is a fact worth its slot on any night.
   * The assertion is now stronger: the card is always present *and* it must
   * never describe the Moon as an obstacle when the Moon is the thing being
   * looked at, which is the defect the omission was working around.
   */
  it("never describes the Moon as interference when it is the subject", () => {
    // The defect: a lunar eclipse page carried "Moonlight · Full Moon · 100% ·
    // Some glare" — the event described as its own obstacle.
    const card = moonlightFor({
      categoryId: "eclipses",
      moonIsTheTarget: true,
      moonlightSensitivity: "low",
    });
    expect(card).toBeDefined();
    expect(card?.interpretation).toBe("The Moon is what you are looking at");
    expect(card?.tone).toBe("good");
    expect(card?.interpretation).not.toMatch(/glare|washes out/i);
  });

  it("says the same for a pairing the Moon is half of", () => {
    // "Moonlight washes out faint objects" is not guidance when the Moon is one
    // of the two things you are looking at.
    const card = moonlightFor({
      categoryId: "pairings",
      moonIsTheTarget: true,
      moonlightSensitivity: "low",
    });
    expect(card?.interpretation).toBe("The Moon is what you are looking at");
    expect(card?.interpretation).not.toMatch(/glare|washes out/i);
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

  it("does not warn about moonlight for a bright planet it barely troubles", () => {
    // Saturn is not meaningfully affected by moonlight in any way the reader
    // can act on. The card reports the phase, because that is a fact, and
    // refuses to dress it up as a problem.
    const card = moonlightFor({
      categoryId: "planets",
      moonIsTheTarget: false,
      moonlightSensitivity: "low",
    });
    expect(card).toBeDefined();
    expect(card?.tone).toBe("good");
    expect(card?.interpretation).not.toMatch(/washes out/i);
  });

  it("still always answers cloud and temperature", () => {
    for (const subject of [
      { categoryId: "eclipses" as const, moonIsTheTarget: true, moonlightSensitivity: "low" as const },
      { categoryId: "meteors" as const, moonIsTheTarget: false, moonlightSensitivity: "high" as const },
      { categoryId: "planets" as const, moonIsTheTarget: false, moonlightSensitivity: "low" as const },
    ]) {
      const ids = idsFor(subject);
      // The universal four, whatever the subject is.
      expect(ids).toEqual(["cloud", "smoke", "moonlight", "temperature"]);
      expect(ids.length).toBeLessThanOrEqual(5);
    }
  });

  it("falls back to showing moonlight when the caller says nothing", () => {
    // Existing callers that have not been taught about subjects keep the old
    // behaviour rather than silently losing a card.
    expect(conditionCards(base).map((card) => card.id)).toContain("moonlight");
  });
});
