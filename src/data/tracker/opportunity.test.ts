import { describe, expect, it } from "vitest";
import {
  applySkyAccess,
  bandFor,
  chooseHero,
  explainRank,
  rankOpportunities,
  verdictFor,
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

describe("once the sky is known", () => {
  it("reorders comparable evenings but does not bury a rare one", () => {
    // Conditions may reorder events whose intrinsic value is reasonably close,
    // and rare events must stay discoverable even when clouds reduce them.
    const ranking = rankOpportunities([
      candidate("eclipse", { spectacle: 1, recognisability: 1, rarity: 1 }),
      candidate("planet", { spectacle: 0.55 }),
      candidate("moon", { spectacle: 0.5 }),
    ]);
    const adjusted = applySkyAccess(
      ranking.ranked,
      new Map([
        ["eclipse", 0.1],
        ["planet", 1],
        ["moon", 1],
      ]),
    );
    // The eclipse is clouded out and still in the list.
    expect(adjusted.map((entry) => entry.opportunity.id)).toContain("eclipse");
    // Two close calls swapped; the eclipse did not fall to last.
    const eclipse = adjusted.find((entry) => entry.opportunity.id === "eclipse")!;
    expect(eclipse.rank).toBeLessThan(3);
  });

  it("swaps two items that were nearly level", () => {
    const ranking = rankOpportunities([
      candidate("a", { spectacle: 0.62 }),
      candidate("b", { spectacle: 0.6 }),
    ]);
    expect(ranking.ranked[0].opportunity.id).toBe("a");
    const adjusted = applySkyAccess(ranking.ranked, new Map([["a", 0], ["b", 1]]));
    expect(adjusted[0].opportunity.id).toBe("b");
  });

  it("leaves the phenomenon's own strength untouched, so both halves survive", () => {
    const ranking = rankOpportunities([candidate("a", { spectacle: 0.9 })]);
    const before = ranking.ranked[0].strength;
    const adjusted = applySkyAccess(ranking.ranked, new Map([["a", 0]]));
    expect(adjusted[0].strength).toBe(before);
    expect(adjusted[0].skyAccess).toBe(0);
  });

  it("changes nothing where no forecast is available", () => {
    const ranking = rankOpportunities([
      candidate("a", { spectacle: 0.8 }),
      candidate("b", { spectacle: 0.4 }),
    ]);
    const adjusted = applySkyAccess(ranking.ranked, new Map());
    expect(adjusted.map((entry) => entry.opportunity.id)).toEqual(["a", "b"]);
    expect(adjusted[0].skyAccess).toBeNull();
  });
});

describe("choosing the hero from what is left", () => {
  it("still refuses to lead with equipment when the eye has a good option", () => {
    // Regression: filtering out what had already set left the interface picking
    // "the first promotable one", which handed the hero to a telescope target
    // while a naked-eye target of the same band sat directly beneath it.
    const ranking = rankOpportunities([
      candidate("rings", { spectacle: 0.85, recognisability: 0.8 }, "telescope"),
      candidate("saturn", { spectacle: 0.6 }),
      candidate("venus", { spectacle: 0.9 }),
    ]);
    const hero = chooseHero(ranking.ranked, new Set(["venus"]));
    expect(hero!.opportunity.id).toBe("saturn");
    expect(hero!.opportunity.guidance.equipment).toBe("eyes");
  });

  it("lets equipment lead once nothing naked-eye is worth going out for", () => {
    const ranking = rankOpportunities([
      candidate("rings", { spectacle: 0.9, recognisability: 0.85 }, "telescope"),
      candidate("faint", { spectacle: 0.15, recognisability: 0.25, ease: 0.3 }),
    ]);
    const hero = chooseHero(ranking.ranked);
    expect(hero!.opportunity.id).toBe("rings");
  });

  it("returns nothing rather than leading with something that has set", () => {
    const ranking = rankOpportunities([candidate("venus", { spectacle: 0.9 })]);
    expect(chooseHero(ranking.ranked, new Set(["venus"]))).toBeNull();
  });
});

describe("geometry survives the sampling pipeline", () => {
  // The interface used to describe the sky in prose — "face south, about 48°
  // up" — because the azimuth was computed and discarded one line later. A
  // drawing cannot be built from that sentence without parsing English back
  // into numbers the computation already had.
  const JOSHUA_TREE = { lat: 34.135, lon: -116.313 };
  const opportunities = tonightsOpportunities(
    JOSHUA_TREE.lat,
    JOSHUA_TREE.lon,
    trackerObservationPeriod(JOSHUA_TREE.lat, JOSHUA_TREE.lon, new Date("2026-08-16T22:00:00Z")),
  );

  it("keeps altitude and azimuth on positional targets", () => {
    const positional = opportunities.filter(
      (entry) => entry.kind === "planet" || entry.kind === "moon",
    );
    expect(positional.length).toBeGreaterThan(0);
    for (const entry of positional) {
      expect(entry.profile.length).toBeGreaterThan(0);
      for (const sample of entry.profile) {
        expect(sample.altitudeDeg).toBeTypeOf("number");
        expect(sample.azimuthDeg).toBeTypeOf("number");
        expect(sample.azimuthDeg).toBeGreaterThanOrEqual(0);
        expect(sample.azimuthDeg).toBeLessThanOrEqual(360);
      }
    }
  });

  it("gives a meteor shower a radiant track and no target position", () => {
    const shower = opportunities.find((entry) => entry.kind === "meteors");
    if (!shower) return; // No stream running on this date; nothing to assert.
    expect(shower.geometry?.kind).toBe("radiant");
    // A shower is not somewhere you point, so it must not look like one.
    for (const sample of shower.profile) {
      expect(sample.altitudeDeg).toBeUndefined();
    }
    if (shower.geometry?.kind === "radiant") {
      expect(shower.geometry.track.length).toBe(shower.profile.length);
    }
  });

  it("marks a culmination only where the target turns over inside the period", () => {
    for (const entry of opportunities) {
      if (entry.geometry?.kind !== "target") continue;
      const { culminationUtc } = entry.geometry;
      if (!culminationUtc) continue;
      const peak = entry.profile.reduce((best, sample) =>
        (sample.altitudeDeg ?? -90) > (best.altitudeDeg ?? -90) ? sample : best,
      );
      expect(culminationUtc).toBe(peak.atUtc);
      expect(culminationUtc).not.toBe(entry.profile[0].atUtc);
      expect(culminationUtc).not.toBe(entry.profile[entry.profile.length - 1].atUtc);
    }
  });
});

describe("the verdict", () => {
  const base = {
    band: "very good" as const,
    unavailable: false,
    skyAccess: 0.9,
    minutesUntilWindow: 200,
    needsDarkSite: false,
  };

  it("leads with conditions when conditions are what decides it", () => {
    // "Exceptional" followed by "under thick cloud" sends people outside for
    // nothing, so the sky is allowed to overrule praise of the phenomenon.
    expect(verdictFor({ ...base, band: "exceptional", skyAccess: 0.2 })).toBe(
      "ONLY IF CONDITIONS IMPROVE",
    );
    expect(verdictFor({ ...base, band: "fair", skyAccess: 0.2 })).toBe(
      "NOT WORTH A SPECIAL TRIP",
    );
  });

  it("says go out now only when the window is actually open", () => {
    expect(verdictFor({ ...base, minutesUntilWindow: -10 })).toBe("GO OUT NOW");
    expect(verdictFor({ ...base, minutesUntilWindow: 45 })).toBe("WORTH STAYING UP FOR");
    expect(verdictFor({ ...base, minutesUntilWindow: 300 })).toBe("BEST LATER TONIGHT");
  });

  it("never recommends an unavailable object", () => {
    expect(verdictFor({ ...base, band: "exceptional", unavailable: true })).toBe(
      "BELOW THE HORIZON",
    );
  });

  it("does not overpromise a merely good target", () => {
    expect(verdictFor({ ...base, band: "good", minutesUntilWindow: -5 })).toBe(
      "EASY IF YOU'RE ALREADY OUTSIDE",
    );
  });
});
