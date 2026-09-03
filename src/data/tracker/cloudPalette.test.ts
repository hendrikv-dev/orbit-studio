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
      expect(SUITABILITY_PAINT[level].fill[3]).toBeLessThanOrEqual(0.34);
    }
  });

  it("leaves open sky almost untouched", () => {
    expect(SUITABILITY_PAINT.good.fill[3]).toBeLessThan(0.1);
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
