import { describe, expect, it } from "vitest";
import {
  bandFor,
  explainRank,
  rankOpportunities,
  type Equipment,
  type Opportunity,
  type Qualities,
} from "./opportunity";
import { trackerObservationPeriod } from "./observationPeriod";
import { tonightsOpportunities } from "./phenomena";

const NEUTRAL: Qualities = {
  observability: 0.9,
  spectacle: 0.5,
  recognisability: 0.7,
  ease: 0.7,
  confidence: 1,
  rarity: 0.05,
};

function candidate(
  id: string,
  qualities: Partial<Qualities>,
  equipment: Equipment = "eyes",
): Opportunity {
  return {
    id,
    kind: "planet",
    title: id,
    summary: id,
    qualities: { ...NEUTRAL, ...qualities },
    guidance: {
      appearance: "a point of light",
      whenUtc: "2026-08-12T23:00:00.000Z",
      durationMinutes: 60,
      direction: "south",
      elevation: "40° up",
      howLong: "a few minutes",
      equipment,
      technique: null,
      safety: null,
    },
    phenomenon: "why it happens",
    tonight: "why it is visible",
    missingInputs: [],
    limitations: [],
  };
}

describe("the gates", () => {
  it("removes what cannot be seen from here tonight, however remarkable", () => {
    const ranking = rankOpportunities([
      candidate("below the horizon", { observability: 0.05, spectacle: 1, rarity: 1 }),
      candidate("ordinary", {}),
    ]);
    expect(ranking.ranked.map((entry) => entry.opportunity.id)).toEqual(["ordinary"]);
    expect(ranking.notTonight.map((entry) => entry.id)).toEqual(["below the horizon"]);
  });

  it("leaves the hero empty rather than promoting a weak night", () => {
    // V1 A7: it must not invent spectacle to fill the interface.
    const ranking = rankOpportunities([
      candidate("faint", { observability: 0.3, spectacle: 0.15, recognisability: 0.2, ease: 0.3 }),
    ]);
    expect(ranking.ranked).toHaveLength(1);
    expect(ranking.hero).toBeNull();
    expect(ranking.ranked[0].appliedRules.join(" ")).toMatch(/not strong enough/i);
  });
});

describe("rarity does not dominate", () => {
  it("cannot lift a poorly placed rarity above a well placed ordinary target", () => {
    // R5.4: a once-a-decade event low in twilight is not worth going outside for.
    const ranking = rankOpportunities([
      candidate("once a decade, badly placed", {
        observability: 0.25,
        spectacle: 0.4,
        ease: 0.3,
        rarity: 1,
      }),
      candidate("bright and overhead", { observability: 1, spectacle: 0.7, rarity: 0 }),
    ]);
    expect(ranking.ranked[0].opportunity.id).toBe("bright and overhead");
  });

  it("still lets rarity break a tie, and says that it did", () => {
    const common = candidate("common", {});
    const rare = candidate("rare", { rarity: 1 });
    const ranking = rankOpportunities([common, rare]);
    expect(ranking.ranked[0].opportunity.id).toBe("rare");
    expect(ranking.ranked[0].rarityContribution).toBeGreaterThan(0);
    expect(ranking.ranked[0].appliedRules.join(" ")).toMatch(/rarity only moves it so far/i);
  });
});

describe("equipment", () => {
  it("never leads with a telescope target when the eye has a good option", () => {
    // V1 §4: the default ranking favours what needs no equipment.
    const ranking = rankOpportunities([
      candidate("telescope showpiece", { spectacle: 1, recognisability: 1 }, "telescope"),
      candidate("naked eye, good", { spectacle: 0.7, recognisability: 0.9 }),
    ]);
    expect(ranking.hero!.opportunity.id).toBe("naked eye, good");
    expect(ranking.hero!.opportunity.guidance.equipment).toBe("eyes");
  });

  it("still lets an outstanding telescope target rank high", () => {
    // V1 §4 also says an equipment-dependent event "may still be prominent".
    const ranking = rankOpportunities([
      candidate("telescope showpiece", { spectacle: 1, recognisability: 1 }, "telescope"),
      candidate("naked eye, good", { spectacle: 0.7, recognisability: 0.9 }),
      candidate("naked eye, dull", { spectacle: 0.2, recognisability: 0.4, ease: 0.4 }),
    ]);
    const telescope = ranking.ranked.find((entry) => entry.opportunity.id === "telescope showpiece")!;
    expect(telescope.rank).toBeLessThan(3);
  });

  it("marks the requirement unmistakably before the user commits", () => {
    const ranking = rankOpportunities([
      candidate("rings", { spectacle: 0.9 }, "telescope"),
    ]);
    expect(ranking.ranked[0].appliedRules).toContain("Telescope required.");
  });

  it("orders the list and the band label from the same number", () => {
    // Regression: the equipment rule used to reorder the list without touching
    // the band, producing a list where an "exceptional" item sat below a "very
    // good" one. Whatever the rules do, rank and band must agree.
    const ranking = rankOpportunities([
      candidate("a", { spectacle: 0.95 }, "telescope"),
      candidate("b", { spectacle: 0.6 }),
      candidate("c", { spectacle: 0.9 }, "binoculars"),
      candidate("d", { spectacle: 0.3 }),
    ]);
    for (let i = 1; i < ranking.ranked.length; i += 1) {
      expect(ranking.ranked[i].strength).toBeLessThanOrEqual(ranking.ranked[i - 1].strength);
      expect(bandFor(ranking.ranked[i].strength)).toBe(ranking.ranked[i].band);
    }
  });
});

describe("the explanation", () => {
  it("is generated from the values the rank actually used", () => {
    // R5.2: an explanation written separately from the rank will drift from it.
    const ranking = rankOpportunities([
      candidate("marginal and uncertain", {
        observability: 0.3,
        spectacle: 0.2,
        recognisability: 0.3,
        ease: 0.3,
        confidence: 0.4,
      }),
    ]);
    const lines = explainRank(ranking.ranked[0]).join(" ");
    expect(lines).toMatch(/marginally observable/i);
    expect(lines).toMatch(/quiet rather than spectacular/i);
    expect(lines).toMatch(/easy to miss/i);
    expect(lines).toMatch(/forecast/i);
  });

  it("says the timing is certain where it is pure geometry", () => {
    const ranking = rankOpportunities([candidate("eclipse", { confidence: 1 })]);
    expect(explainRank(ranking.ranked[0]).join(" ")).toMatch(/geometry/i);
  });
});

describe("against real nights", () => {
  const rank = (lat: number, lon: number, when: string) =>
    rankOpportunities(
      tonightsOpportunities(lat, lon, trackerObservationPeriod(lat, lon, new Date(when))),
    );

  it("leads Perseid maximum with the Perseids", () => {
    const ranking = rank(51.4779, -0.0015, "2026-08-12T22:00:00Z");
    expect(ranking.hero!.opportunity.kind).toBe("meteors");
    expect(ranking.hero!.band).toBe("exceptional");
  });

  it("leads an ordinary March night with something honest instead of nothing", () => {
    // V1 A7: recommend the easiest genuinely worthwhile target, without
    // exaggerating it.
    const ranking = rank(51.4779, -0.0015, "2026-03-05T22:00:00Z");
    expect(ranking.hero).not.toBeNull();
    expect(ranking.hero!.opportunity.guidance.equipment).toBe("eyes");
    expect(ranking.hero!.band).not.toBe("exceptional");
  });

  it("offers nothing at all under a midnight sun, and does not pretend otherwise", () => {
    const ranking = rank(69.6496, 18.956, "2026-06-21T22:00:00Z");
    expect(ranking.hero).toBeNull();
  });

  it("always answers both explanation questions separately", () => {
    // R5.7: why this happens at all, and why it is visible from here tonight.
    const ranking = rank(51.4779, -0.0015, "2026-12-13T22:00:00Z");
    expect(ranking.ranked.length).toBeGreaterThan(3);
    for (const entry of ranking.ranked) {
      expect(entry.opportunity.phenomenon.length).toBeGreaterThan(40);
      expect(entry.opportunity.tonight.length).toBeGreaterThan(20);
      expect(entry.opportunity.phenomenon).not.toBe(entry.opportunity.tonight);
    }
  });

  it("gives every promoted opportunity the guidance to act on it", () => {
    const ranking = rank(51.4779, -0.0015, "2026-12-13T22:00:00Z");
    for (const entry of ranking.ranked) {
      const { guidance } = entry.opportunity;
      expect(guidance.appearance.length).toBeGreaterThan(10);
      expect(guidance.whenUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(guidance.elevation.length).toBeGreaterThan(3);
      expect(guidance.howLong.length).toBeGreaterThan(3);
    }
  });

  it("never describes what a photograph would show as what the eye will see", () => {
    const ranking = rank(51.4779, -0.0015, "2026-08-12T22:00:00Z");
    const appearances = ranking.ranked.map((entry) => entry.opportunity.guidance.appearance);
    expect(appearances.join(" ")).not.toMatch(/vivid|blazing|dazzling/i);
  });
});
