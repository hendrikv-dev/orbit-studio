import { describe, expect, it } from "vitest";
import {
  AURORA_MINIMUM_USEFUL_ELEVATION_DEG,
  AURORA_MINIMUM_USEFUL_PERCENT,
  BEST_TONIGHT_FLOOR,
  METEOR_MATERIAL_PER_HOUR,
  auroraEligibility,
  generalEligibility,
  meteorEligibility,
  moonEligibility,
} from "./bestTonightEligibility";
import { rankTonight, visibleRanked } from "./tonightRanking";
import type { AuroraVisibility } from "./aurora";
import type { Opportunity } from "./opportunity";

/**
 * Regression cover for the eligibility architecture, at its actual boundaries.
 *
 * Written against the thresholds as implemented rather than as intended: the
 * point of a regression pass is to prove what the code does, so every number
 * here is derived from the exported constant instead of retyped. A change to a
 * threshold moves these tests with it; a change to the *rule* breaks them.
 */

const visibility = (over: Partial<AuroraVisibility>): AuroraVisibility => ({
  kind: "unlikely",
  source: null,
  apparentElevationDeg: null,
  lookDirection: null,
  emissionHeightKm: null,
  statement: "",
  derived: true,
  ...over,
});

const horizonAurora = (elevationDeg: number, percent: number) =>
  visibility({
    kind: "horizon",
    apparentElevationDeg: elevationDeg,
    source: {
      latitudeDeg: 60,
      longitudeDeg: -120,
      probabilityPercent: percent,
      distanceKm: 1400,
      bearingDeg: 0,
    },
  });

const opportunity = (over: Partial<Opportunity>): Opportunity =>
  ({ id: "x", kind: "planet", title: "t", summary: "s", ...over }) as Opportunity;

const showerOpportunity = opportunity({
  kind: "meteors",
  geometry: { kind: "radiant", track: [] },
} as Partial<Opportunity>);

const phase = (name: string) =>
  opportunity({
    kind: "moon",
    science: { kind: "lunar-phase", phase: { name } },
  } as unknown as Partial<Opportunity>);

describe("aurora eligibility at its implemented boundaries", () => {
  it("excludes a quiet, locally invisible aurora", () => {
    expect(auroraEligibility(visibility({ kind: "unlikely" }), true).eligible).toBe(false);
  });

  it("excludes unavailable and expired data", () => {
    expect(auroraEligibility(visibility({ kind: "unavailable" }), true).eligible).toBe(false);
    expect(auroraEligibility(visibility({ kind: "expired" }), true).eligible).toBe(false);
    expect(auroraEligibility(null, true).eligible).toBe(false);
  });

  it("excludes an aurora with no darkness to see it in", () => {
    // Even overhead: an oval over a place where the Sun does not set is not an
    // opportunity tonight.
    expect(auroraEligibility(visibility({ kind: "overhead" }), false).eligible).toBe(false);
  });

  describe("the 5 degree elevation gate", () => {
    const strong = AURORA_MINIMUM_USEFUL_PERCENT + 20;

    it("excludes immediately below the threshold", () => {
      const verdict = auroraEligibility(
        horizonAurora(AURORA_MINIMUM_USEFUL_ELEVATION_DEG - 0.1, strong),
        true,
      );
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason).toMatch(/too low/i);
    });

    it("admits exactly at the threshold", () => {
      expect(
        auroraEligibility(horizonAurora(AURORA_MINIMUM_USEFUL_ELEVATION_DEG, strong), true)
          .eligible,
      ).toBe(true);
    });

    it("excludes a display grazing the horizon however strong it is", () => {
      expect(auroraEligibility(horizonAurora(1, 95), true).eligible).toBe(false);
    });
  });

  describe("the 30 percent activity gate", () => {
    const high = AURORA_MINIMUM_USEFUL_ELEVATION_DEG + 5;

    it("excludes immediately below the threshold", () => {
      const verdict = auroraEligibility(
        horizonAurora(high, AURORA_MINIMUM_USEFUL_PERCENT - 1),
        true,
      );
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason).toMatch(/too weak/i);
    });

    it("admits exactly at the threshold", () => {
      expect(
        auroraEligibility(horizonAurora(high, AURORA_MINIMUM_USEFUL_PERCENT), true).eligible,
      ).toBe(true);
    });
  });

  it("admits an overhead aurora, which needs no distance gate", () => {
    // Overhead means NOAA puts meaningful probability on the observer, which
    // `assessAurora` only reports at or above its own meaningful floor, so
    // there is no weak-source edge case left to gate here.
    expect(auroraEligibility(visibility({ kind: "overhead" }), true).eligible).toBe(true);
  });

  it("cannot be reached by weather, because weather cannot be passed", () => {
    // The structural guarantee rather than a behavioural one: the signature has
    // two parameters and neither is a forecast.
    expect(auroraEligibility.length).toBe(2);
  });
});

describe("meteor eligibility at its implemented boundary", () => {
  it("excludes the sporadic background regardless of rate", () => {
    // No radiant means no shower, even on a night with a high total rate: the
    // total includes the sporadics this gate exists to exclude.
    const verdict = meteorEligibility(opportunity({ kind: "meteors" }), 40);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/no meteor shower is active/i);
  });

  it("excludes a named shower immediately below the threshold", () => {
    const verdict = meteorEligibility(showerOpportunity, METEOR_MATERIAL_PER_HOUR - 0.1);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/background rate/i);
  });

  it("admits exactly at the threshold", () => {
    expect(meteorEligibility(showerOpportunity, METEOR_MATERIAL_PER_HOUR).eligible).toBe(true);
  });

  it("admits a materially stronger shower", () => {
    expect(meteorEligibility(showerOpportunity, 60).eligible).toBe(true);
  });

  it("excludes a shower with no usable rate rather than guessing", () => {
    expect(meteorEligibility(showerOpportunity, null).eligible).toBe(false);
  });
});

describe("moon eligibility", () => {
  it("excludes every routine phase, including the named ones", () => {
    for (const name of [
      "Full Moon",
      "First Quarter",
      "Last Quarter",
      "Waxing Gibbous",
      "Waning Crescent",
    ]) {
      expect(moonEligibility(phase(name)).eligible).toBe(false);
    }
  });

  it("does not present New Moon as a visible lunar target", () => {
    const verdict = moonEligibility(phase("New Moon"));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/faint objects/i);
    expect(verdict.reason).not.toMatch(/see the New Moon|worth looking at/i);
  });

  it("lets a distinct lunar event through its own path", () => {
    // Anything arriving under the Moon's kind that is not a routine phase is a
    // real event and is judged on strength like everything else.
    expect(moonEligibility(opportunity({ kind: "moon" })).eligible).toBe(true);
  });
});

describe("the general threshold", () => {
  it("admits a clearly strong object", () => {
    expect(generalEligibility(0.54).eligible).toBe(true);
  });

  it("admits a moderate but useful object", () => {
    // Mars on a real Portland night measured 0.32: a naked-eye planet somebody
    // could go and find, and not a special trip.
    expect(generalEligibility(0.32).eligible).toBe(true);
  });

  it("excludes immediately below and admits exactly at the boundary", () => {
    expect(generalEligibility(BEST_TONIGHT_FLOOR - 0.001).eligible).toBe(false);
    expect(generalEligibility(BEST_TONIGHT_FLOOR).eligible).toBe(true);
  });

  it("excludes a merely-above-horizon object", () => {
    // Jupiter measured 0.14 on the same night: thirty minutes low before dawn.
    expect(generalEligibility(0.144).eligible).toBe(false);
  });

  it("is not a travel threshold", () => {
    // HERO_FLOOR is 0.35 and means "worth a special trip". This list uses a
    // lower bar on purpose, and a regression that raised it would silently
    // empty the list on ordinary nights.
    expect(BEST_TONIGHT_FLOOR).toBeLessThan(0.35);
    expect(BEST_TONIGHT_FLOOR).toBe(0.22);
  });
});

describe("a variable-length Best tonight", () => {
  const night = [
    { id: "saturn", priority: 0.54 },
    { id: "mars", priority: 0.32 },
    { id: "jupiter", priority: 0.144 },
    { id: "moon", priority: 0.41 },
    { id: "meteors", priority: 0.48 },
  ];

  it("produces contiguous ranks for any number of eligible items", () => {
    for (let count = 0; count <= night.length; count += 1) {
      const ranked = rankTonight(night.slice(0, count));
      expect(ranked.map((event) => event.rank)).toEqual(
        Array.from({ length: count }, (_, index) => index + 1),
      );
    }
  });

  it("renders no filler rows for a short list", () => {
    for (const count of [0, 1, 2, 3]) {
      const ranked = rankTonight(night.slice(0, count));
      expect(visibleRanked(ranked, null, 6)).toHaveLength(count);
    }
  });

  it("has no six-row assumption anywhere in the pipeline", () => {
    const one = rankTonight(night.slice(0, 1));
    expect(visibleRanked(one, "saturn", 6)).toHaveLength(1);
    const none = rankTonight([]);
    expect(visibleRanked(none, "saturn", 6)).toHaveLength(0);
  });
});

describe("selection cannot change eligibility or rank", () => {
  const eligible = [
    { id: "saturn", priority: 0.54 },
    { id: "mars", priority: 0.32 },
  ];
  const ranked = rankTonight(eligible);

  it("keeps every rank whichever event is open, including an ineligible one", () => {
    const canonical = new Map(ranked.map((event) => [event.id, event.rank]));
    // "jupiter" is ineligible and therefore not in `ranked` at all. Opening it
    // directly must not insert it or disturb what is there.
    for (const selected of [null, "saturn", "mars", "jupiter", "aurora", "moon"]) {
      const rows = visibleRanked(ranked, selected, 6);
      expect(rows.map((row) => row.id)).toEqual(["saturn", "mars"]);
      for (const row of rows) expect(row.rank).toBe(canonical.get(row.id));
    }
  });

  it("never promotes the selected event", () => {
    for (const selected of ["mars", "jupiter"]) {
      expect(visibleRanked(ranked, selected, 6)[0].id).toBe("saturn");
    }
  });

  it("cannot make an ineligible phenomenon eligible by opening it", () => {
    // `visibleRanked` can only append something already in the ranked set, and
    // the ranked set is the eligible subset.
    expect(visibleRanked(ranked, "jupiter", 6).some((row) => row.id === "jupiter")).toBe(false);
  });
});
