import { describe, expect, it } from "vitest";
import { SUITABILITY_PAINT, isHatched, onHatch, paintFor } from "./cloudPalette";
import { SUITABILITY_ORDER, type Suitability } from "./cloudSuitability";

const LEVELS: Suitability[] = ["good", "fair", "poor", "bad"];

describe("the cloud palette", () => {
  it("carries severity without hue, so the layer survives colour blindness", () => {
    // The two levels a reader has to act on are marked as well as tinted.
    expect(isHatched("good")).toBe(false);
    expect(isHatched("fair")).toBe(false);
    expect(isHatched("poor")).toBe(true);
    expect(isHatched("bad")).toBe(true);
  });

  it("tightens the hatch as the sky gets worse, so texture reads the same way colour does", () => {
    expect(SUITABILITY_PAINT.bad.spacingPx).toBeLessThan(SUITABILITY_PAINT.poor.spacingPx);
  });

  it("gets more opaque as the sky gets worse", () => {
    const alphas = LEVELS.map((level) => SUITABILITY_PAINT[level].fill[3]);
    for (let index = 1; index < alphas.length; index += 1) {
      expect(alphas[index]).toBeGreaterThan(alphas[index - 1]);
    }
  });

  it("stays restrained enough to read the map underneath", () => {
    // The worst case is under a third opaque. A warning that hides the roads
    // gets switched off, and then it warns nobody about anything.
    for (const level of LEVELS) {
      expect(SUITABILITY_PAINT[level].fill[3]).toBeLessThanOrEqual(0.3);
    }
  });

  it("leaves the favourable end the lightest touch on the map", () => {
    // This used to demand under 0.1, which made "favourable" almost invisible
    // and left the map reading as grey hatching with nothing to compare it to.
    // The requirement is restraint, not absence: a reader must be able to see
    // that an area is favourable, not merely that it is unmarked.
    expect(SUITABILITY_PAINT.good.fill[3]).toBeLessThanOrEqual(0.12);
    expect(SUITABILITY_PAINT.good.fill[3]).toBeGreaterThan(0.05);
  });

  /**
   * Hue must carry meaning, and must not be the only thing that does.
   *
   * A red-green axis is the exact axis roughly one man in twelve cannot
   * separate, and a screen in red-light mode at night flattens hue for
   * everybody. So the ramp is checked in both directions: the colours do point
   * the right way, and the ordering survives losing them.
   */
  it("points green at favourable and red at unfavourable", () => {
    const greener = ([r, g]: number[]) => g - r;
    expect(greener(SUITABILITY_PAINT.good.fill)).toBeGreaterThan(0);
    expect(greener(SUITABILITY_PAINT.fair.fill)).toBeGreaterThan(0);
    expect(greener(SUITABILITY_PAINT.poor.fill)).toBeLessThan(0);
    expect(greener(SUITABILITY_PAINT.bad.fill)).toBeLessThan(0);
  });

  /**
   * The greyscale check has to be done on the *composited* result, not on the
   * raw colour.
   *
   * The first version of this compared the fills' own luminance, which said the
   * ramp was fine while the map showed four shades within two levels of each
   * other: a light green at low alpha and a dark red at high alpha land in the
   * same place once blended over a dark basemap. A reader without hue got
   * nothing from the fill at all.
   */
  it("keeps the ordering when hue is thrown away", () => {
    /** Tracker's own basemap is dark; this is representative of it. */
    const BASEMAP = 26;
    /** The raster layer's own opacity, applied on top of each fill's alpha. */
    const LAYER = 0.92;
    const composited = (level: Suitability) => {
      const [r, g, b, alpha] = SUITABILITY_PAINT[level].fill;
      const a = alpha * LAYER;
      return BASEMAP * (1 - a) + (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
    };
    const values = LEVELS.map(composited);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1]);
    }
    // And the two ends are far enough apart to tell apart at a glance.
    expect(composited("bad") - composited("good")).toBeGreaterThan(12);
  });

  it("marks only the levels a reader has to act on", () => {
    // The hatch is a secondary cue. Hatching all four would put texture over
    // the whole map and take the basemap with it.
    const hatched = LEVELS.filter((level) => isHatched(level));
    expect(hatched).toEqual(["poor", "bad"]);
  });

  it("draws a continuous diagonal, so tiles do not show their seams", () => {
    // A point on a line stays on the line one tile to the right: the pattern is
    // a function of world position, not of position within a tile.
    const spacing = SUITABILITY_PAINT.bad.spacingPx;
    for (let offset = 0; offset < spacing; offset += 1) {
      expect(onHatch(100 + offset, 40, spacing)).toBe(onHatch(100 + offset + 256, 40 - 256, spacing));
    }
  });

  it("never hatches a level that has no hatch", () => {
    expect(onHatch(3, 5, SUITABILITY_PAINT.good.spacingPx)).toBe(false);
  });

  it("paints the hatch stroke only on the line, and the fill everywhere else", () => {
    const spacing = SUITABILITY_PAINT.bad.spacingPx;
    let on = 0;
    let off = 0;
    for (let x = 0; x < 200; x += 1) {
      const colour = paintFor("bad", x, 0);
      if (colour === SUITABILITY_PAINT.bad.hatch) on += 1;
      if (colour === SUITABILITY_PAINT.bad.fill) off += 1;
    }
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(on);
    // One pixel of stroke every `spacing` pixels along a row: a mark laid over
    // the fill, not a half-tone that just darkens it.
    expect(on / 200).toBeCloseTo(1 / spacing, 2);
  });

  it("orders the levels the same way the scale does", () => {
    const alphas = LEVELS.map((level) => SUITABILITY_PAINT[level].fill[3]);
    const order = LEVELS.map((level) => SUITABILITY_ORDER[level]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
  });
});
