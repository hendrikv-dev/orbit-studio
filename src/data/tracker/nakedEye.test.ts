import { describe, expect, it } from "vitest";
import {
  artificialLightLoss,
  extinctionAt,
  nakedEyeVerdict,
  skyLimit,
  type SkyConditions,
} from "./nakedEye";

/** A moonless, fully astronomical night at a site with no detected light. */
const DARK: SkyConditions = {
  sunAltitudeDeg: -30,
  moonAltitudeDeg: -20,
  moonIlluminatedFraction: 0,
  artificialLightRadiance: null,
};

describe("what the sky will allow", () => {
  it("starts from a dark-sky limit and takes the Moon and twilight off it", () => {
    const dark = skyLimit(DARK);
    expect(dark.magnitude).toBeCloseTo(6.5, 1);

    const fullMoonUp = skyLimit({ ...DARK, moonAltitudeDeg: 60, moonIlluminatedFraction: 1 });
    expect(fullMoonUp.magnitude).toBeLessThan(dark.magnitude - 1.5);

    const twilight = skyLimit({ ...DARK, sunAltitudeDeg: -8 });
    expect(twilight.magnitude).toBeLessThan(dark.magnitude - 1.5);
  });

  /**
   * Anchored at both ends, and capped.
   *
   * This is a calibration used to admit or withhold, never a sky-brightness
   * figure to display — Tracker still quotes radiance and refuses Bortle, SQM
   * and limiting magnitude on screen.
   */
  it("loses nothing at the detection floor and about three magnitudes in a city", () => {
    expect(artificialLightLoss(null)).toBe(0);
    expect(artificialLightLoss(0.1)).toBe(0);
    expect(artificialLightLoss(0.25)).toBeCloseTo(0, 3);
    expect(artificialLightLoss(64)).toBeCloseTo(3, 3);
    // Beyond the top of the archive's useful range it stops rather than running away.
    expect(artificialLightLoss(6000)).toBe(3);
    // Downtown Portland measures 12.3, which is most of the way there.
    expect(artificialLightLoss(12.3)).toBeGreaterThan(2);
    expect(artificialLightLoss(12.3)).toBeLessThan(3);
  });

  /**
   * The daylight arm, which the curve did not used to have.
   *
   * It stopped at the civil boundary, where meteor watching stops, and above it
   * the loss stayed pinned at three magnitudes — so a dark site at noon came
   * back as showing magnitude 3.5. Nothing noticed while every caller was gated
   * on darkness for its own reasons; a spacecraft, which genuinely is magnitude
   * −3 at midday and genuinely is not something to send anybody out to see,
   * asked the question directly.
   */
  it("keeps losing magnitudes above the civil boundary rather than stopping there", () => {
    const civil = skyLimit({ ...DARK, sunAltitudeDeg: -6 });
    const sunrise = skyLimit({ ...DARK, sunAltitudeDeg: 0 });
    const midday = skyLimit({ ...DARK, sunAltitudeDeg: 40 });

    expect(sunrise.magnitude).toBeLessThan(civil.magnitude - 2);
    expect(midday.magnitude).toBeLessThan(sunrise.magnitude);
    // Venus at −4.3 is the one thing the unaided eye can find in a blue sky,
    // and only knowing where to look. Nothing fainter belongs in a list.
    expect(midday.magnitude).toBeGreaterThan(-5);
    expect(midday.magnitude).toBeLessThan(-3.5);
  });

  it("is continuous across the civil boundary rather than stepping at it", () => {
    const before = skyLimit({ ...DARK, sunAltitudeDeg: -6.01 }).magnitude;
    const after = skyLimit({ ...DARK, sunAltitudeDeg: -5.99 }).magnitude;
    expect(Math.abs(before - after)).toBeLessThan(0.1);
  });

  it("costs more near the horizon than overhead", () => {
    expect(extinctionAt(90)).toBeCloseTo(0.28, 2);
    expect(extinctionAt(30)).toBeGreaterThan(0.5);
    expect(extinctionAt(10)).toBeGreaterThan(1.3);
    expect(extinctionAt(5)).toBeGreaterThan(2.4);
    expect(extinctionAt(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("whether a person could reasonably see it", () => {
  it("admits a bright planet high in a dark sky", () => {
    const verdict = nakedEyeVerdict({ apparentMagnitude: 0.6, altitudeDeg: 53 }, DARK);
    expect(verdict.visible).toBe(true);
    expect(verdict.headroom).toBeGreaterThan(0);
  });

  /**
   * The case this rule exists for.
   *
   * Uranus at 5.8 is above the horizon most clear nights and is not something
   * anybody sees without help. Under a dark sky it is a hard averted-vision
   * target; from anywhere with streetlights it is nothing at all.
   */
  it("withholds a target that is up, and not visible", () => {
    const dark = nakedEyeVerdict({ apparentMagnitude: 5.8, altitudeDeg: 60 }, DARK);
    expect(dark.visible).toBe(false);
    expect(dark.reason).toMatch(/too faint/i);

    const suburb = nakedEyeVerdict(
      { apparentMagnitude: 5.8, altitudeDeg: 60 },
      { ...DARK, artificialLightRadiance: 12.3 },
    );
    expect(suburb.visible).toBe(false);
    expect(suburb.reason).toMatch(/artificial light/i);
  });

  it("withholds a naked-eye object that is too low to be one", () => {
    const high = nakedEyeVerdict({ apparentMagnitude: 3.4, altitudeDeg: 55 }, DARK);
    const low = nakedEyeVerdict({ apparentMagnitude: 3.4, altitudeDeg: 4 }, DARK);
    expect(high.visible).toBe(true);
    expect(low.visible).toBe(false);
    expect(low.reason).toMatch(/too low/i);
  });

  it("takes the Moon's own light into account", () => {
    const target = { apparentMagnitude: 4.4, altitudeDeg: 60 };
    expect(nakedEyeVerdict(target, DARK).visible).toBe(true);
    expect(
      nakedEyeVerdict(target, { ...DARK, moonAltitudeDeg: 65, moonIlluminatedFraction: 1 }).visible,
    ).toBe(false);
  });

  it("refuses what the ground is standing in front of", () => {
    const verdict = nakedEyeVerdict(
      { apparentMagnitude: -1, altitudeDeg: 4, terrainHorizonDeg: 7.5 },
      DARK,
    );
    expect(verdict.visible).toBe(false);
    expect(verdict.reason).toMatch(/ground stands/i);
  });

  it("says below the horizon before it says anything about brightness", () => {
    const verdict = nakedEyeVerdict({ apparentMagnitude: -4, altitudeDeg: -3 }, DARK);
    expect(verdict.visible).toBe(false);
    expect(verdict.reason).toMatch(/below the horizon/i);
  });

  /**
   * A shower has a rate and an eclipse is an event; neither has a magnitude.
   *
   * Excluding them for lacking a number they never had would remove the two
   * things Tracker is best at from its own default list.
   */
  it("has nothing to say about a target with no magnitude, and says nothing", () => {
    const verdict = nakedEyeVerdict({ apparentMagnitude: null, altitudeDeg: 40 }, DARK);
    expect(verdict.visible).toBe(true);
    expect(verdict.headroom).toBeNull();
  });
});
