import { describe, expect, it } from "vitest";
import { admissible, admits, altitudeAt, apparentMagnitudeOf } from "./observingRules";
import type { Opportunity } from "./opportunity";

/** A Portland night, well after astronomical dark, with a new Moon. */
const CONTEXT = {
  latitudeDeg: 45.54,
  longitudeDeg: -122.4,
  atUtc: "2026-11-18T10:00:00Z",
  artificialLightRadiance: null,
};

function opportunity(over: Partial<Opportunity> & { equipment?: "eyes" | "binoculars" | "telescope"; magnitude?: number; altitudeDeg?: number }): Opportunity {
  const { equipment = "eyes", magnitude, altitudeDeg = 55 } = over;
  return {
    id: "test",
    kind: "planet",
    title: "Test",
    summary: "",
    qualities: { observability: 0.8, striking: 0.5, ease: 0.8, rarity: 0.2 },
    guidance: {
      whenUtc: CONTEXT.atUtc,
      elevation: "high",
      direction: "south",
      equipment,
      appearance: "",
      safety: null,
    },
    profile: [{ atUtc: CONTEXT.atUtc, relative: 1, altitudeDeg }],
    science:
      magnitude === undefined
        ? undefined
        : {
            kind: "planet",
            body: "Test",
            event: null,
            state: {
              body: "Test",
              daysFromOpposition: null,
              magnitude,
              brightestMagnitude: magnitude,
              apparentDiameterArcsec: 10,
              diameterRangeArcsec: [8, 12],
              peakAltitudeDeg: altitudeDeg,
              usefulWindowMinutes: 200,
            },
          },
    ...over,
  } as unknown as Opportunity;
}

describe("what a rule admits", () => {
  it("is a tier, and each tier includes the ones before it", () => {
    expect(admits("eyes", "eyes")).toBe(true);
    expect(admits("eyes", "binoculars")).toBe(false);
    expect(admits("eyes", "telescope")).toBe(false);
    expect(admits("binoculars", "binoculars")).toBe(true);
    expect(admits("binoculars", "telescope")).toBe(false);
    expect(admits("telescope", "telescope")).toBe(true);
    expect(admits("telescope", "eyes")).toBe(true);
  });
});

describe("reading a target's own numbers", () => {
  it("takes a planet's magnitude from its measured state", () => {
    expect(apparentMagnitudeOf(opportunity({ magnitude: 0.6 }))).toBe(0.6);
  });

  it("has no magnitude for a phenomenon that does not have one", () => {
    expect(apparentMagnitudeOf(opportunity({}))).toBeNull();
  });

  it("reads altitude from the sample nearest the moment in question", () => {
    const target = opportunity({ altitudeDeg: 33 });
    expect(altitudeAt(target, CONTEXT.atUtc)).toBe(33);
  });
});

describe("admission under the reader's rule", () => {
  /**
   * The rule this whole file exists for.
   *
   * A galaxy is above the horizon on plenty of nights and is not something
   * anybody sees without a telescope, so it must not be in a list headed "what
   * you can see tonight" — and the reason must say it needs equipment rather
   * than that it is faint tonight, which would imply another night would do.
   */
  it("keeps a telescope target out of the naked-eye rail", () => {
    const galaxy = opportunity({ equipment: "telescope", magnitude: 8.4 });
    const eyes = admissible("eyes", galaxy, CONTEXT);
    expect(eyes.admitted).toBe(false);
    expect(eyes.reason).toMatch(/needs a telescope/i);
  });

  it("and lets it in under the telescope rule, unchanged in every other way", () => {
    const galaxy = opportunity({ equipment: "telescope", magnitude: 8.4 });
    expect(admissible("telescope", galaxy, CONTEXT).admitted).toBe(true);
    // Binoculars are not enough for a telescope target.
    expect(admissible("binoculars", galaxy, CONTEXT).admitted).toBe(false);
  });

  it("admits a bright, well-placed naked-eye planet", () => {
    expect(admissible("eyes", opportunity({ magnitude: 0.6 }), CONTEXT).admitted).toBe(true);
  });

  /**
   * Above the horizon is not enough, which is the point.
   *
   * This object claims to be a naked-eye target and is sixty degrees up on a
   * moonless night, and at magnitude 5.9 nobody is going to see it.
   */
  it("withholds a nominally naked-eye object that is too faint to be one", () => {
    const verdict = admissible("eyes", opportunity({ magnitude: 5.9 }), CONTEXT);
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toMatch(/faint/i);
  });

  it("withholds the same object when the city, not the sky, is the problem", () => {
    const marginal = opportunity({ magnitude: 4.6 });
    expect(admissible("eyes", marginal, CONTEXT).admitted).toBe(true);
    expect(
      admissible("eyes", marginal, { ...CONTEXT, artificialLightRadiance: 40 }).admitted,
    ).toBe(false);
  });

  it("withholds what the ground is standing in front of", () => {
    const low = opportunity({ magnitude: -1, altitudeDeg: 4 });
    expect(admissible("eyes", low, { ...CONTEXT, terrainHorizonDeg: 8 }).admitted).toBe(false);
  });

  /**
   * An aided rule does not re-judge brightness.
   *
   * Binoculars and a telescope each change the limiting magnitude by several
   * magnitudes, and Tracker has no calibrated model of by how much for a given
   * instrument. Admitting what the tier admits and leaving the rest to the
   * ranking is honest; inventing an instrument model would not be.
   */
  it("does not apply a naked-eye brightness test to an aided rule", () => {
    const faint = opportunity({ equipment: "binoculars", magnitude: 9.2 });
    expect(admissible("binoculars", faint, CONTEXT).admitted).toBe(true);
  });
});
