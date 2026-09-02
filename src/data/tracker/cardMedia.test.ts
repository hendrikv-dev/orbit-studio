import { describe, expect, it } from "vitest";

import showpieces from "../deep-sky/showpieces.json";
import { cardMediaFor, type CardMedia } from "./cardMedia";
import { hasCataloguedImagery } from "./imagery";
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
  "satellite",
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

  it("shows the spacecraft on a pass, and the train on a train", () => {
    const station = cardMediaFor(opportunity("satellite", "satellite-iss"));
    expect(station.kind).toBe("photo");
    if (station.kind === "photo") expect(station.src).toContain("iss");

    // Every deployment gets its own id, and all of them the one photograph of
    // a train that Tracker has cleared.
    const train = cardMediaFor(opportunity("satellite", "satellite-train-starlink-g15-23"));
    expect(train.kind).toBe("photo");
    if (train.kind === "photo") expect(train.src).toContain("noirlab");
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
    for (const body of ["saturn", "jupiter", "mars", "venus"]) {
      const media = cardMediaFor(opportunity("planet", `planet-${body}`));
      expect(media.kind).toBe("photo");
      expect((media as { src: string }).src).toContain(body);
    }
    // Mercury, Uranus and anything else added later still get the mark, which
    // is honest about being a symbol where a star field would not be.
    const unphotographed = cardMediaFor(opportunity("planet", "planet-mercury"));
    expect(unphotographed.kind).toBe("mark");
  });

  /**
   * The defect: every deep-sky card carried the same drawn oval-and-dot, so
   * eight different objects in one rail were eight identical marks. The mark
   * was right while Tracker had no picture of any of them; it has one of each
   * now, verified against the archive's own record of what the picture shows.
   */
  it("shows the object itself on a deep-sky card, not a symbol for its class", () => {
    const objects = showpieces.objects.filter((object) => hasCataloguedImagery(object.id));
    const sources = new Set<string>();
    for (const object of objects) {
      const media = cardMediaFor(opportunity("deep-sky", `deep-sky-${object.id}`));
      expect(media.kind, object.id).toBe("photo");
      if (media.kind === "photo") sources.add(media.src);
    }
    // The Double Cluster is one photograph of both halves; everything else has
    // its own, so the rail cannot show the same picture twice under two names.
    expect(sources.size).toBe(objects.length - 1);
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
