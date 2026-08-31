import { describe, expect, it } from "vitest";

import { cardMediaFor, type CardMedia } from "./cardMedia";
import type { Opportunity, OpportunityKind } from "./opportunity";

/**
 * Every phenomenon Tracker can put on a card must resolve to something drawable.
 *
 * The list is written out rather than derived, so adding a kind to the union
 * without deciding what its card looks like fails here — which is the whole
 * point. The empty grey square on the Moon-and-Saturn card, and the star field
 * on the annular eclipse, both existed because nobody had made that decision.
 */
const ALL_KINDS: OpportunityKind[] = [
  "meteors",
  "moon",
  "planet",
  "conjunction",
  "lunar-eclipse",
  "solar-eclipse",
  "deep-sky",
];

function opportunity(kind: OpportunityKind, id = kind, science?: unknown): Opportunity {
  return { kind, id, sceneHints: {}, ...(science ? { science } : {}) } as unknown as Opportunity;
}

describe("cardMediaFor", () => {
  it("returns drawable media for every supported kind", () => {
    for (const kind of ALL_KINDS) {
      const media = cardMediaFor(opportunity(kind));
      expect(media, `${kind} has no media`).toBeTruthy();
      expect(media.kind).toMatch(/^(photo|moon|pair|eclipse|mark)$/);
      // Nothing may resolve to a photograph with no file behind it.
      if (media.kind === "photo") expect(media.src).toMatch(/^\/sky\/.+\.webp$/);
    }
  });

  it("draws a conjunction from its own bodies rather than a photograph", () => {
    const media = cardMediaFor(
      opportunity("conjunction", "conjunction-the-moon-saturn", {
        kind: "conjunction",
        bodies: ["Moon", "Saturn"],
        separationDeg: 2.4,
        moon: { illuminatedFraction: 0.82, waning: true },
      }),
    ) as Extract<CardMedia, { kind: "pair" }>;

    expect(media.kind).toBe("pair");
    expect(media.bodies).toEqual(["Moon", "Saturn"]);
    // Both halves of the pairing are available to the drawing, which is what
    // lets the card show the Moon *and* Saturn rather than a generic sky.
    expect(media.moon).not.toBeNull();
    expect(media.separationDeg).toBeCloseTo(2.4);
  });

  it("draws a solar eclipse at its own obscuration, by variant", () => {
    for (const [eclipseKind, variant] of [
      ["total", "total"],
      ["annular", "annular"],
      ["partial", "partial"],
    ] as const) {
      const media = cardMediaFor(
        opportunity("solar-eclipse", "solar-eclipse", {
          kind: "solar-eclipse",
          eclipseKind,
          obscuration: 0.87,
        }),
      ) as Extract<CardMedia, { kind: "eclipse" }>;
      expect(media.kind).toBe("eclipse");
      expect(media.variant).toBe(variant);
      expect(media.obscuration).toBeCloseTo(0.87);
    }
  });

  it("never gives a solar eclipse the generic night-sky photograph", () => {
    const media = cardMediaFor(opportunity("solar-eclipse"));
    expect(media.kind).toBe("eclipse");
    expect(JSON.stringify(media)).not.toContain("night-sky");
  });

  it("photographs a planet only where a real image of it ships", () => {
    for (const body of ["saturn", "jupiter", "mars"]) {
      const media = cardMediaFor(opportunity("planet", `planet-${body}`));
      expect(media.kind).toBe("photo");
      expect((media as { src: string }).src).toContain(body);
    }
    // Venus has no cleared image; a mark is honest, a star field is not.
    const venus = cardMediaFor(opportunity("planet", "planet-venus"));
    expect(venus.kind).toBe("mark");
  });

  it("carries the Moon's real phase rather than a fixed one", () => {
    const media = cardMediaFor({
      kind: "moon",
      id: "moon",
      sceneHints: { illuminatedFraction: 0.23, waning: true },
    } as unknown as Opportunity) as Extract<CardMedia, { kind: "moon" }>;
    expect(media.illuminatedFraction).toBeCloseTo(0.23);
    expect(media.waning).toBe(true);
  });
});
