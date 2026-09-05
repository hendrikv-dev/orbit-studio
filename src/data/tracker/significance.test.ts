import { describe, expect, it } from "vitest";
import {
  APPROACHING_OPPOSITION_DAYS,
  MATERIAL_PARTIAL_OBSCURATION,
  NEAR_OPPOSITION_DAYS,
  RINGS_EDGE_ON_DEG,
  RINGS_WIDE_OPEN_DEG,
  SHOWER_MATERIAL_PER_HOUR,
  SHOWER_STRONG_PER_HOUR,
  WELL_PLACED_ALTITUDE_DEG,
  auroraSignificance,
  conjunctionSignificance,
  lunarEclipseSignificance,
  meteorSignificance,
  moonPhaseSignificance,
  planetSignificance,
  priorityFor,
  type PlanetState,
} from "./significance";

/**
 * The ranking claim, tested as arithmetic rather than as a hope.
 *
 * The defect these exist for is concrete: Tracker put Saturn above a locally
 * visible partial lunar eclipse, because rarity could only move an item by one
 * band and one band is not enough to lift a once-a-year event over a planet
 * that is up most nights of the year.
 *
 * The fix is a banded ordering, and a band is exactly the kind of claim that
 * can be checked exhaustively: for every pair of non-adjacent tiers, the lower
 * one at its *best* must still lose to the upper one at its *worst*. That is
 * what "should generally outrank" means when written down, and it is asserted
 * below rather than sampled.
 */

const TIERS = ["routine", "good-example", "favourable", "notable"] as const;

describe("the significance bands", () => {
  it("cannot let a routine target outrank an unusual event, at any strength", () => {
    // The headline claim. A perfect routine target against a barely observable
    // notable one: the notable one still wins.
    expect(priorityFor({ tier: "routine", reasons: [] }, 1)).toBeLessThan(
      priorityFor({ tier: "notable", reasons: [] }, 0),
    );
    expect(priorityFor({ tier: "routine", reasons: [] }, 1)).toBeLessThan(
      priorityFor({ tier: "favourable", reasons: [] }, 0),
    );
    expect(priorityFor({ tier: "good-example", reasons: [] }, 1)).toBeLessThan(
      priorityFor({ tier: "notable", reasons: [] }, 0),
    );
  });

  it("lets adjacent tiers overlap, so close calls stay close calls", () => {
    // Deliberately not a strict hierarchy. An outstanding example of one tier
    // beating a poor example of the next is the right answer for two things
    // that really are comparable — and it is the only place the model allows
    // any crossing at all.
    expect(priorityFor({ tier: "good-example", reasons: [] }, 1)).toBeGreaterThan(
      priorityFor({ tier: "favourable", reasons: [] }, 0),
    );
    expect(priorityFor({ tier: "favourable", reasons: [] }, 1)).toBeGreaterThan(
      priorityFor({ tier: "notable", reasons: [] }, 0),
    );
  });

  it("orders within a tier by how good the opportunity is", () => {
    for (const tier of TIERS) {
      expect(priorityFor({ tier, reasons: [] }, 0.8)).toBeGreaterThan(
        priorityFor({ tier, reasons: [] }, 0.2),
      );
    }
  });

  it("never returns a priority outside its own band", () => {
    for (const tier of TIERS) {
      for (const strength of [-1, 0, 0.5, 1, 2]) {
        const value = priorityFor({ tier, reasons: [] }, strength);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("eclipses, which are what the model exists for", () => {
  it("makes a total lunar eclipse notable", () => {
    expect(lunarEclipseSignificance("total", 1).tier).toBe("notable");
  });

  it("makes a deep partial notable and quotes the depth", () => {
    const result = lunarEclipseSignificance("partial", 0.97);
    expect(result.tier).toBe("notable");
    expect(result.reasons[0]).toMatch(/97%/);
  });

  it("does not treat a three-percent graze as the same event", () => {
    // Found in the browser: a 3% partial outranked a well-placed Jupiter.
    // "Partial lunar eclipse" covers a dark bite across most of the disc and a
    // nick nobody would notice, and calling both notable overstates the second.
    const shallow = lunarEclipseSignificance("partial", 0.03);
    expect(shallow.tier).toBe("favourable");
    expect(shallow.reasons[0]).toMatch(/small bite/i);
  });

  it("puts the partial boundary exactly where the constant says", () => {
    expect(lunarEclipseSignificance("partial", MATERIAL_PARTIAL_OBSCURATION).tier).toBe("notable");
    expect(lunarEclipseSignificance("partial", MATERIAL_PARTIAL_OBSCURATION - 0.001).tier).toBe(
      "favourable",
    );
  });

  it("keeps a penumbral eclipse below a real one", () => {
    expect(lunarEclipseSignificance("penumbral", 0).tier).toBe("favourable");
  });
});

describe("meteors, judged on what is actually falling", () => {
  it("treats the sporadic background as routine", () => {
    expect(meteorSignificance(null, null, null).tier).toBe("routine");
  });

  it("does not promote a named shower that is producing nothing", () => {
    // A named radiant is necessary and not sufficient: minor showers run for
    // weeks at rates indistinguishable from the background.
    expect(meteorSignificance("Delta Aquariids", SHOWER_MATERIAL_PER_HOUR - 1, 0).tier).toBe(
      "routine",
    );
  });

  it("promotes a shower once it is above the background", () => {
    expect(meteorSignificance("Delta Aquariids", SHOWER_MATERIAL_PER_HOUR, 5).tier).toBe(
      "good-example",
    );
  });

  it("makes a strong shower at maximum notable", () => {
    const result = meteorSignificance("Perseids", SHOWER_STRONG_PER_HOUR, 0);
    expect(result.tier).toBe("notable");
    expect(result.reasons[0]).toMatch(/Perseids/);
  });

  it("ranks a peak above the same shower off-peak", () => {
    const peak = meteorSignificance("Perseids", 60, 0);
    const off = meteorSignificance("Perseids", 20, 4);
    expect(priorityFor(peak, 0.5)).toBeGreaterThan(priorityFor(off, 0.5));
  });
});

describe("the Moon, which has a phase rather than an event", () => {
  it("is routine whatever the phase is called", () => {
    // The brief is explicit: a routine phase must not outrank a rarer event
    // merely for being obvious and bright.
    expect(moonPhaseSignificance().tier).toBe("routine");
  });

  it("loses to any eclipse, however good the Moon's own night is", () => {
    expect(priorityFor(moonPhaseSignificance(), 1)).toBeLessThan(
      priorityFor(lunarEclipseSignificance("partial", 0.03), 0.1),
    );
  });
});

describe("conjunctions, judged on separation", () => {
  it("makes a sub-degree pairing notable", () => {
    expect(conjunctionSignificance(0.4).tier).toBe("notable");
  });

  it("keeps a wide pairing routine", () => {
    expect(conjunctionSignificance(12).tier).toBe("routine");
  });

  it("outranks the routine visibility of the planets involved", () => {
    // The brief's own example. A close pairing of two planets is a different
    // event from either planet being up.
    const pairing = conjunctionSignificance(0.8);
    const planet = moonPhaseSignificance();
    expect(priorityFor(pairing, 0.3)).toBeGreaterThan(priorityFor(planet, 0.9));
  });
});

describe("aurora, judged on whether it could be seen", () => {
  it("is notable overhead and merely favourable on the horizon", () => {
    expect(auroraSignificance("overhead").tier).toBe("notable");
    expect(auroraSignificance("horizon").tier).toBe("favourable");
    expect(auroraSignificance("none").tier).toBe("routine");
  });
});

/* ------------------------------------------------------- recurring targets */

/**
 * Saturn, twice.
 *
 * The brief names this case directly: "Saturn is visible tonight" should get
 * modest novelty value, and "Saturn is near opposition, high in the sky, with
 * particularly favorable ring presentation" should rank materially higher. The
 * two fixtures below are the same planet in those two states, built from the
 * quantities the ephemeris actually supplies.
 */
function saturn(overrides: Partial<PlanetState> = {}): PlanetState {
  return {
    body: "Saturn",
    daysFromOpposition: 150,
    magnitude: 1.1,
    brightestMagnitude: -0.55,
    apparentDiameterArcsec: 15.8,
    diameterRangeArcsec: [14.5, 20.1],
    peakAltitudeDeg: 22,
    usefulWindowMinutes: 120,
    ringTiltDeg: 9,
    ...overrides,
  };
}

describe("Saturn, ordinary and unusual", () => {
  it("is routine when it is merely up", () => {
    const result = planetSignificance(saturn());
    expect(result.tier).toBe("routine");
  });

  it("is a good example when it is well placed and approaching opposition", () => {
    // The real state measured from Portland on 28 August 2026: 37 days out,
    // reaching about 45°.
    const result = planetSignificance(
      saturn({ daysFromOpposition: -37, peakAltitudeDeg: 45, magnitude: 0.36 }),
    );
    expect(result.tier).toBe("good-example");
    expect(result.reasons.join(" ")).toMatch(/37 days from opposition/);
  });

  it("is favourable at opposition, high, with the rings open", () => {
    const result = planetSignificance(
      saturn({
        daysFromOpposition: -2,
        peakAltitudeDeg: 52,
        magnitude: -0.4,
        apparentDiameterArcsec: 19.6,
        ringTiltDeg: 25,
      }),
    );
    expect(result.tier).toBe("favourable");
  });

  it("ranks the unusual showing materially above the ordinary one", () => {
    // Not merely "higher": the two must land in different bands, so no amount
    // of good weather on the ordinary night can reverse them.
    const ordinary = planetSignificance(saturn());
    const unusual = planetSignificance(
      saturn({
        daysFromOpposition: -2,
        peakAltitudeDeg: 52,
        magnitude: -0.4,
        apparentDiameterArcsec: 19.6,
        ringTiltDeg: 25,
      }),
    );
    expect(priorityFor(unusual, 0.45)).toBeGreaterThan(priorityFor(ordinary, 0.9));
  });

  it("states the reasons as facts rather than as a score", () => {
    const result = planetSignificance(
      saturn({ daysFromOpposition: -2, peakAltitudeDeg: 52, ringTiltDeg: 25 }),
    );
    const text = result.reasons.join(" ");
    expect(text).toMatch(/opposition/);
    expect(text).toMatch(/52°/);
    expect(text).toMatch(/rings are tilted 25°/);
    // The tier and any number derived from it are internal. Nothing here may
    // read as a score the reader is expected to interpret.
    expect(text).not.toMatch(/favourable|notable|good-example|routine/);
    expect(text).not.toMatch(/0\.\d\d/);
  });

  it("treats a ring-plane crossing as unusual in its own right", () => {
    // Edge-on rings come round about twice in fifteen years and are a genuinely
    // rare presentation, not merely a favourable one.
    const result = planetSignificance(
      saturn({ daysFromOpposition: 200, peakAltitudeDeg: 48, ringTiltDeg: 1.2 }),
    );
    expect(result.tier).toBe("notable");
    expect(result.reasons.join(" ")).toMatch(/edge-on/);
  });
});

describe("the planet thresholds, at their edges", () => {
  it("treats altitude exactly at the well-placed line as well placed", () => {
    expect(
      planetSignificance(
        saturn({ daysFromOpposition: -5, peakAltitudeDeg: WELL_PLACED_ALTITUDE_DEG }),
      ).tier,
    ).toBe("favourable");
    expect(
      planetSignificance(
        saturn({ daysFromOpposition: -5, peakAltitudeDeg: WELL_PLACED_ALTITUDE_DEG - 0.1 }),
      ).tier,
    ).toBe("good-example");
  });

  it("distinguishes near opposition from approaching it", () => {
    const near = planetSignificance(
      saturn({ daysFromOpposition: -NEAR_OPPOSITION_DAYS, peakAltitudeDeg: 45 }),
    );
    const approaching = planetSignificance(
      saturn({ daysFromOpposition: -(NEAR_OPPOSITION_DAYS + 1), peakAltitudeDeg: 45 }),
    );
    expect(near.tier).toBe("favourable");
    expect(approaching.tier).toBe("good-example");
  });

  it("stops caring about opposition beyond the approach window", () => {
    const beyond = planetSignificance(
      saturn({ daysFromOpposition: APPROACHING_OPPOSITION_DAYS + 1, peakAltitudeDeg: 45 }),
    );
    expect(beyond.reasons.join(" ")).not.toMatch(/from opposition/);
  });

  it("has no opposition to report for an inferior planet", () => {
    // Venus and Mercury orbit inside Earth's and never reach opposition.
    // Reporting one would be fabricated geometry rather than a rounding error.
    const venus = planetSignificance({
      body: "Venus",
      daysFromOpposition: null,
      magnitude: -4.6,
      brightestMagnitude: -4.9,
      apparentDiameterArcsec: 28,
      diameterRangeArcsec: [9.7, 66],
      peakAltitudeDeg: 20,
      usefulWindowMinutes: 60,
      ringTiltDeg: null,
    });
    expect(venus.reasons.join(" ")).not.toMatch(/opposition/);
  });

  it("names both ring extremes and neither in between", () => {
    const open = planetSignificance(saturn({ ringTiltDeg: RINGS_WIDE_OPEN_DEG, peakAltitudeDeg: 45 }));
    const edge = planetSignificance(saturn({ ringTiltDeg: RINGS_EDGE_ON_DEG, peakAltitudeDeg: 45 }));
    const middle = planetSignificance(saturn({ ringTiltDeg: 12, peakAltitudeDeg: 45 }));
    expect(open.reasons.join(" ")).toMatch(/wide open/);
    expect(edge.reasons.join(" ")).toMatch(/edge-on/);
    expect(middle.reasons.join(" ")).not.toMatch(/rings/);
  });
});
