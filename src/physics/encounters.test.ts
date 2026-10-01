import { describe, expect, it } from "vitest";
import {
  CATASTROPHIC_EMR_J_PER_G,
  alongTrackDriftKm,
  assessEncounter,
  avoidanceDeltaVMetersPerSecond,
  breakupFragmentCount,
  circularSpeedKmS,
  collisionSeverity,
  energyToMassRatioJPerG,
  relativeSpeedKmS,
} from "./encounters";

describe("closing speed", () => {
  it("is zero for two objects going the same way at the same speed", () => {
    expect(relativeSpeedKmS(7.5, 7.5, 0)).toBeCloseTo(0, 9);
  });

  it("is twice the speed head-on", () => {
    expect(relativeSpeedKmS(7.5, 7.5, 180)).toBeCloseTo(15, 9);
  });

  it("equals the orbital speed at a 60 degree crossing", () => {
    // 2 v sin(30 deg) = v exactly — the same identity as a plane change.
    expect(relativeSpeedKmS(7.5, 7.5, 60)).toBeCloseTo(7.5, 9);
  });

  it("is set by the angle, not by the altitude", () => {
    // The point of the section: same shell, wildly different encounters.
    const low = circularSpeedKmS(6378.137 + 800);
    expect(relativeSpeedKmS(low, low, 10)).toBeLessThan(1.5);
    expect(relativeSpeedKmS(low, low, 100)).toBeGreaterThan(11);
  });
});

describe("collision energy", () => {
  it("reproduces the 2009 collision as far above the catastrophic threshold", () => {
    // Iridium 33 (~560 kg) and Kosmos-2251 (~900 kg) closed at about 11.7 km/s.
    const emr = energyToMassRatioJPerG(11.7, 900, 560);
    expect(emr).toBeGreaterThan(50_000);
    expect(collisionSeverity(emr)).toBe("catastrophic");
  });

  it("puts a 1 cm fleck above the threshold against a small satellite", () => {
    // 1 gram at 10 km/s carries 50 kJ; against a 10 kg cubesat that is 5 J/g.
    expect(energyToMassRatioJPerG(10, 0.001, 10)).toBeCloseTo(5, 6);
    // Against a 100 gram target the same fleck is catastrophic.
    expect(collisionSeverity(energyToMassRatioJPerG(10, 0.001, 0.1))).toBe("catastrophic");
  });

  it("scales with the square of closing speed", () => {
    const slow = energyToMassRatioJPerG(5, 100, 1000);
    const fast = energyToMassRatioJPerG(10, 100, 1000);
    expect(fast / slow).toBeCloseTo(4, 6);
  });

  it("treats a grazing encounter as survivable", () => {
    const emr = energyToMassRatioJPerG(0.05, 100, 2000);
    expect(emr).toBeLessThan(CATASTROPHIC_EMR_J_PER_G);
    expect(collisionSeverity(emr)).toBe("non-catastrophic");
  });
});

describe("breakup model", () => {
  it("lands within a factor of two of the 2009 event", () => {
    // About 2,300 fragments larger than 10 cm were eventually catalogued from
    // both parents combined. The model claims order of magnitude, not accuracy.
    const count = breakupFragmentCount("catastrophic", 11.7, 900, 560, 0.1);
    expect(count).toBeGreaterThan(1000);
    expect(count).toBeLessThan(2600);
  });

  it("produces far more small fragments than large ones", () => {
    const large = breakupFragmentCount("catastrophic", 11.7, 900, 560, 0.1);
    const small = breakupFragmentCount("catastrophic", 11.7, 900, 560, 0.01);
    // Lc^-1.71 over a decade of size is a factor of about 51.
    expect(small / large).toBeCloseTo(10 ** 1.71, 1);
  });

  it("produces fewer fragments when the collision is not catastrophic", () => {
    const catastrophic = breakupFragmentCount("catastrophic", 2, 5, 2000, 0.1);
    const cratering = breakupFragmentCount("non-catastrophic", 2, 5, 2000, 0.1);
    expect(cratering).toBeLessThan(catastrophic);
  });

  it("returns nothing for a zero-mass impactor", () => {
    expect(breakupFragmentCount("non-catastrophic", 10, 0, 1000)).toBe(0);
  });
});

describe("avoidance", () => {
  it("displaces three times the naive distance", () => {
    // 1 cm/s for one day: naive 0.864 km, actual 2.592 km.
    expect(alongTrackDriftKm(0.01, 86400)).toBeCloseTo(2.592, 6);
  });

  it("grows linearly with lead time", () => {
    expect(alongTrackDriftKm(0.05, 86400 * 2)).toBeCloseTo(
      alongTrackDriftKm(0.05, 86400) * 2,
      9,
    );
  });

  it("inverts consistently", () => {
    const lead = 86400 * 3;
    const burn = avoidanceDeltaVMetersPerSecond(10, lead);
    expect(alongTrackDriftKm(burn, lead)).toBeCloseTo(10, 6);
  });

  it("makes a late warning enormously more expensive", () => {
    const early = avoidanceDeltaVMetersPerSecond(5, 86400 * 3);
    const late = avoidanceDeltaVMetersPerSecond(5, 600);
    expect(late / early).toBeCloseTo((86400 * 3) / 600, 6);
    expect(late).toBeGreaterThan(2);
  });

  it("cannot avoid anything with no time left", () => {
    expect(avoidanceDeltaVMetersPerSecond(5, 0)).toBe(Infinity);
  });
});

describe("encounter assessment", () => {
  it("calls a near head-on encounter in LEO catastrophic", () => {
    const result = assessEncounter(800, 100, 900, 560);
    expect(result.relativeSpeedKmS).toBeGreaterThan(11);
    expect(result.severity).toBe("catastrophic");
    expect(result.fragmentsOver1cm).toBeGreaterThan(result.fragmentsOver10cm);
  });

  it("calls a shallow crossing survivable for a heavy target", () => {
    const result = assessEncounter(800, 0.05, 5, 3000);
    expect(result.relativeSpeedKmS).toBeLessThan(0.02);
    expect(result.severity).toBe("non-catastrophic");
  });
});
