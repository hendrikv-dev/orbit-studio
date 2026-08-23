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
import type { AuroraVisibility } from "./aurora";
import type { Opportunity } from "./opportunity";

/**
 * Best tonight is a recommendation list, not a celestial inventory.
 *
 * Aurora, Meteors and the Moon used to appear every night from every location
 * because Tracker supports those categories — and anything in a ranked list
 * gets a position and a quality label, which is how "Aurora · Excellent" came
 * to sit above a page explaining the oval was too far north to see.
 */

const auroraVisibility = (over: Partial<AuroraVisibility>): AuroraVisibility => ({
  kind: "unlikely",
  source: null,
  apparentElevationDeg: null,
  lookDirection: null,
  emissionHeightKm: null,
  statement: "",
  derived: true,
  ...over,
});

const opportunity = (over: Partial<Opportunity>): Opportunity =>
  ({ id: "x", kind: "moon", title: "t", summary: "s", ...over }) as Opportunity;

describe("aurora eligibility", () => {
  it("admits aurora NOAA puts overhead", () => {
    expect(auroraEligibility(auroraVisibility({ kind: "overhead" }), true).eligible).toBe(true);
  });

  it("excludes a quiet field", () => {
    expect(auroraEligibility(auroraVisibility({ kind: "unlikely" }), true).eligible).toBe(false);
  });

  it("excludes expired and unavailable data", () => {
    // Not knowing is not a reason to go outside.
    expect(auroraEligibility(auroraVisibility({ kind: "expired" }), true).eligible).toBe(false);
    expect(auroraEligibility(auroraVisibility({ kind: "unavailable" }), true).eligible).toBe(false);
    expect(auroraEligibility(null, true).eligible).toBe(false);
  });

  it("excludes aurora with no darkness to see it in", () => {
    expect(auroraEligibility(auroraVisibility({ kind: "overhead" }), false).eligible).toBe(false);
  });

  describe("geometry above the horizon is not a viewing opportunity", () => {
    const distant = (elevation: number, percent: number) =>
      auroraVisibility({
        kind: "horizon",
        apparentElevationDeg: elevation,
        source: {
          latitudeDeg: 60,
          longitudeDeg: -120,
          probabilityPercent: percent,
          distanceKm: 1400,
          bearingDeg: 0,
        },
      });

    it("excludes a display that would sit a degree above the horizon", () => {
      // `AuroraVisibility` answers whether emission clears the Earth's curve. A
      // faint oval two thousand kilometres away technically does, at one degree
      // — below the haze, behind the treeline, and dim to begin with.
      const verdict = auroraEligibility(distant(1, 60), true);
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason).toMatch(/too low/i);
    });

    it("excludes a weak oval even when it stands high enough", () => {
      const verdict = auroraEligibility(
        distant(AURORA_MINIMUM_USEFUL_ELEVATION_DEG + 4, 12),
        true,
      );
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason).toMatch(/too weak/i);
    });

    it("admits a strong display standing well clear of the horizon", () => {
      expect(
        auroraEligibility(
          distant(AURORA_MINIMUM_USEFUL_ELEVATION_DEG + 4, AURORA_MINIMUM_USEFUL_PERCENT + 20),
          true,
        ).eligible,
      ).toBe(true);
    });
  });

  it("cannot be made eligible by the weather", () => {
    // The signature takes no forecast, so a clear sky has nowhere to enter.
    expect(auroraEligibility.length).toBe(2);
  });
});

describe("meteor eligibility", () => {
  const shower = opportunity({
    kind: "meteors",
    geometry: { kind: "radiant", track: [] },
  } as Partial<Opportunity>);
  const sporadic = opportunity({ kind: "meteors" });

  it("excludes the sporadic background", () => {
    const verdict = meteorEligibility(sporadic, 40);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/no meteor shower is active/i);
  });

  it("excludes a weak minor shower despite a named radiant", () => {
    // A radiant is necessary and not sufficient. Minor showers run for weeks at
    // rates indistinguishable from the background.
    const verdict = meteorEligibility(shower, METEOR_MATERIAL_PER_HOUR - 8);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/background rate/i);
  });

  it("admits a shower that is actually producing", () => {
    expect(meteorEligibility(shower, METEOR_MATERIAL_PER_HOUR + 25).eligible).toBe(true);
  });

  it("excludes a shower with no usable rate", () => {
    expect(meteorEligibility(shower, null).eligible).toBe(false);
  });
});

describe("moon eligibility", () => {
  const phase = (name: string) =>
    opportunity({
      kind: "moon",
      science: { kind: "lunar-phase", phase: { name } },
    } as unknown as Partial<Opportunity>);

  it("excludes an ordinary Full Moon", () => {
    // Naming a phase is a calendar fact, not an opportunity signal: it recurs
    // every month and looks the same for days either side.
    const verdict = moonEligibility(phase("Full Moon"));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/no particular lunar event/i);
  });

  it("excludes the quarters", () => {
    expect(moonEligibility(phase("First Quarter")).eligible).toBe(false);
    expect(moonEligibility(phase("Last Quarter")).eligible).toBe(false);
  });

  it("excludes an ordinary gibbous", () => {
    expect(moonEligibility(phase("Waxing Gibbous")).eligible).toBe(false);
  });

  it("says New Moon is a dark-sky condition rather than a target", () => {
    const verdict = moonEligibility(phase("New Moon"));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/faint objects/i);
  });

  it("admits a lunar opportunity that is not a routine phase", () => {
    // An eclipse or occultation arriving under the Moon's own kind is a real
    // event and is judged on strength like anything else.
    expect(moonEligibility(opportunity({ kind: "moon" })).eligible).toBe(true);
  });
});

describe("everything else, on its own merit", () => {
  it("admits what clears the worth-going-out-for floor", () => {
    expect(generalEligibility(BEST_TONIGHT_FLOOR).eligible).toBe(true);
    expect(generalEligibility(0.9).eligible).toBe(true);
  });

  it("excludes what does not", () => {
    const verdict = generalEligibility(BEST_TONIGHT_FLOOR - 0.01);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/too marginal/i);
  });

  it("is a lower bar than the hero floor, deliberately", () => {
    // "Worth a special trip" is a stronger standard than this list needs. A
    // well-placed planet belongs in Best tonight even though nobody should
    // drive an hour for it, so the gate sits at the marginal/fair boundary
    // rather than at HERO_FLOOR.
    expect(BEST_TONIGHT_FLOOR).toBeLessThan(0.35);
    // A real night from Portland: Mars at 0.32 is worth finding; Jupiter at
    // 0.14, thirty minutes low before dawn, is not.
    expect(generalEligibility(0.32).eligible).toBe(true);
    expect(generalEligibility(0.144).eligible).toBe(false);
  });

  it("gives every exclusion a reason worth showing a reader", () => {
    // Direct lookup still works for an excluded phenomenon, and it has to be
    // able to say why it is not being recommended.
    const verdicts = [
      auroraEligibility(auroraVisibility({ kind: "unlikely" }), true),
      meteorEligibility(opportunity({ kind: "meteors" }), 4),
      moonEligibility(
        opportunity({
          kind: "moon",
          science: { kind: "lunar-phase", phase: { name: "Waxing Gibbous" } },
        } as unknown as Partial<Opportunity>),
      ),
      generalEligibility(0.1),
    ];
    for (const verdict of verdicts) {
      expect(verdict.eligible).toBe(false);
      expect(verdict.reason.length).toBeGreaterThan(20);
      expect(verdict.reason).toMatch(/\.$/);
    }
  });
});
