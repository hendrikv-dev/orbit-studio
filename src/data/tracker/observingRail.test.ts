import { describe, expect, it } from "vitest";

import { buildRail, RAIL_SOFT_LIMIT, type RailCandidate } from "./observingRail";
import type { Significance } from "./significance";

/**
 * The rail's job is editorial, so these tests are about what gets left out.
 *
 * Anything can be made to fit five slots. What matters is that a quiet night
 * produces a short rail, that the Moon is present exactly once, and that a
 * lunar eclipse takes the Moon's place instead of standing beside it.
 */

function candidate(
  id: string,
  rank: number,
  kind: string,
  significance?: Significance["tier"],
  science?: unknown,
): RailCandidate {
  return {
    id,
    rank,
    presentation: { title: id, summary: "", reminder: { title: id } } as never,
    opportunity: { kind, ...(science ? { science } : {}) } as never,
    significance: significance ? ({ tier: significance } as Significance) : undefined,
    window: null,
  };
}

/** A conjunction, optionally with the Moon as one of the pair. */
function pairing(
  id: string,
  rank: number,
  bodies: [string, string],
  tier: Significance["tier"] = "favourable",
): RailCandidate {
  const hasMoon = bodies.some((body) => body.toLowerCase() === "moon");
  return candidate(id, rank, "conjunction", tier, {
    kind: "conjunction",
    bodies,
    moon: hasMoon ? { illuminatedFraction: 0.8, waning: true } : null,
  });
}

describe("buildRail", () => {
  it("keeps the ranking's order", () => {
    const rail = buildRail([
      candidate("saturn", 1, "planet", "favourable"),
      candidate("mars", 2, "planet", "good-example"),
      candidate("moon", 3, "moon"),
    ]);
    expect(rail.map((card) => card.id)).toEqual(["saturn", "mars", "moon"]);
  });

  it("always carries the Moon, even when nothing else clears the floor", () => {
    const rail = buildRail([candidate("moon", 1, "moon")]);
    expect(rail.map((card) => card.id)).toEqual(["moon"]);
  });

  it("lets a lunar eclipse replace the Moon rather than join it", () => {
    const rail = buildRail([
      candidate("lunar-eclipse", 1, "lunar-eclipse", "notable"),
      candidate("moon", 2, "moon"),
      candidate("mars", 3, "planet", "good-example"),
    ]);
    expect(rail.map((card) => card.id)).toEqual(["lunar-eclipse", "mars"]);
    expect(rail.filter((card) => card.opportunity.kind === "moon")).toHaveLength(0);
  });

  it("stops adding routine entries once the rail has enough", () => {
    const rail = buildRail([
      candidate("a", 1, "planet"),
      candidate("b", 2, "planet"),
      candidate("c", 3, "planet"),
      candidate("d", 4, "planet"),
      candidate("e", 5, "planet"),
    ]);
    // Three routine entries earn a place; the rest are the same statement again.
    expect(rail).toHaveLength(3);
  });

  it("never exceeds the soft limit even when everything is remarkable", () => {
    const rail = buildRail(
      Array.from({ length: 9 }, (_, index) =>
        candidate(`e${index}`, index + 1, "solar-eclipse", "notable"),
      ),
    );
    expect(rail.length).toBeLessThanOrEqual(RAIL_SOFT_LIMIT);
  });

  it("lets a notable Moon conjunction displace the routine Moon card", () => {
    const rail = buildRail([
      pairing("moon-saturn", 1, ["Moon", "Saturn"]),
      candidate("moon", 2, "moon"),
      candidate("mars", 3, "planet", "good-example"),
    ]);
    expect(rail.map((card) => card.id)).toEqual(["moon-saturn", "mars"]);
    expect(rail.some((card) => card.opportunity.kind === "moon")).toBe(false);
  });

  it("keeps the Moon when the conjunction does not involve it", () => {
    const rail = buildRail([
      pairing("venus-saturn", 1, ["Venus", "Saturn"]),
      candidate("moon", 2, "moon"),
    ]);
    expect(rail.map((card) => card.id)).toEqual(["venus-saturn", "moon"]);
  });

  it("keeps the Moon when the only Moon event is routine", () => {
    const rail = buildRail([
      pairing("moon-saturn", 1, ["Moon", "Saturn"], "routine"),
      candidate("moon", 2, "moon"),
    ]);
    expect(rail.map((card) => card.id)).toEqual(["moon-saturn", "moon"]);
  });

  it("keeps the Moon when a Moon event exists but never surfaces", () => {
    // Five stronger events fill the rail, so the conjunction is not shown and
    // therefore cannot stand in for anything.
    const rail = buildRail([
      ...Array.from({ length: 5 }, (_, i) =>
        candidate(`e${i}`, i + 1, "solar-eclipse", "notable"),
      ),
      pairing("moon-saturn", 6, ["Moon", "Saturn"]),
      candidate("moon", 7, "moon"),
    ]);
    expect(rail.some((card) => card.id === "moon-saturn")).toBe(false);
    expect(rail.some((card) => card.id === "moon")).toBe(true);
  });

  it("never shows two Moon subjects side by side", () => {
    const rails = [
      buildRail([pairing("moon-saturn", 1, ["Moon", "Saturn"]), candidate("moon", 2, "moon")]),
      buildRail([
        candidate("lunar-eclipse", 1, "lunar-eclipse", "notable"),
        candidate("moon", 2, "moon"),
      ]),
    ];
    for (const rail of rails) {
      const moonSubjects = rail.filter(
        (card) =>
          card.opportunity.kind === "moon" ||
          card.opportunity.kind === "lunar-eclipse" ||
          (card.opportunity as { science?: { moon?: unknown } }).science?.moon,
      );
      expect(moonSubjects).toHaveLength(1);
    }
  });

  it("puts the Moon back in rank order after the limit has been applied", () => {
    const rail = buildRail([
      candidate("eclipse", 1, "solar-eclipse", "notable"),
      candidate("moon", 2, "moon"),
      candidate("meteors", 3, "meteors", "favourable"),
    ]);
    expect(rail.map((card) => card.id)).toEqual(["eclipse", "moon", "meteors"]);
  });
});
