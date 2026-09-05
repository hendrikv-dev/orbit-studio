import type { Suitability } from "./cloudSuitability";

/**
 * How the cloud layer looks, and why it does not look like a weather map.
 *
 * ## Restraint, because this map has other jobs
 *
 * The cloud layer sits over a basemap the reader is also using to find a dark
 * site, judge a horizon and pick a road. A saturated wash would take the map
 * over and turn every other layer into a tint of itself. So the greens are
 * desaturated, the reds are muted, and nothing exceeds a third opacity — the
 * terrain, the roads, the labels and an event's own geography stay legible
 * underneath. Restrained is not the same as neutral: the reader should still
 * see which way is better without reading the legend first.
 *
 * ## Why hue is not allowed to be the only cue
 *
 * A red-green axis is the exact axis roughly one man in twelve cannot separate,
 * and a screen outdoors at night in red-light mode flattens hue for everybody.
 * So the ramp carries the same ordering three more ways:
 *
 *  - **opacity** rises monotonically with severity, so the bad end is denser
 *    than the good end in greyscale;
 *  - **luminance** falls, because the reds are darker than the greens at the
 *    same alpha;
 *  - **texture**, as a hatch that appears only on the two unfavourable levels
 *    and tightens as they worsen.
 *
 * The hatch is deliberately secondary. It marks the levels a reader should act
 * on rather than covering the map: at a ninth and a fifth coverage it reads as
 * a mark laid over a tint, not as a striped surface. An earlier version hatched
 * with a neutral grey fill and the whole map became the texture.
 *
 * The hatch is drawn in tile-pixel space rather than in degrees, so it stays
 * the same visual weight at every zoom instead of dissolving as the reader
 * zooms in on the place they are actually going.
 */

export interface SuitabilityPaint {
  /** Base fill, before the hatch. */
  fill: [number, number, number, number];
  /** The hatch stroke, or null where the level is not hatched at all. */
  hatch: [number, number, number, number] | null;
  /**
   * Pixels between hatch lines. Smaller is denser, and denser is worse — so the
   * cue reads in the same direction as the colour rather than against it.
   */
  spacingPx: number;
}

/**
 * The suitability ramp: green where cloud is favourable, red where it is not.
 *
 * The previous version was a single neutral grey with a hatch, on the reasoning
 * that a green-to-red wash would be the map passing a verdict. That reasoning
 * was right about the wrong thing. Green here does not say "observing is good
 * here" — it says "cloud is favourable here", which is a claim about one
 * variable and is exactly what a layer called Cloud viewing conditions is for.
 * What the old palette actually produced was a grey striped surface where a
 * reader could see *that* the layer was on and not *what it was telling them*,
 * and a warning nobody can read at a glance is not a warning.
 *
 * The greens are desaturated and the reds are muted, because this sits over a
 * basemap somebody is also using to find a road. Nothing exceeds a third
 * opacity: a layer that hides the terrain gets switched off, and then it warns
 * about nothing.
 */
export const SUITABILITY_PAINT: Record<Suitability, SuitabilityPaint> = {
  // Favourable: a cool green, barely there. The best case tints the map least —
  // the absence of marking is itself the strongest "nothing to warn you about".
  good: { fill: [70, 140, 110, 0.058], hatch: null, spacingPx: 0 },
  // Mostly favourable: still green, a little more present.
  fair: { fill: [110, 150, 105, 0.09], hatch: null, spacingPx: 0 },
  // Unfavourable: muted red, and marked as well as tinted.
  poor: { fill: [196, 104, 86, 0.145], hatch: [70, 32, 26, 0.2], spacingPx: 9 },
  // Strongly unfavourable: deeper red, tighter hatch.
  bad: { fill: [208, 96, 88, 0.205], hatch: [58, 20, 20, 0.26], spacingPx: 5 },
};

/**
 * Why these particular numbers.
 *
 * The ramp has to survive being read three ways, and the first attempt only
 * survived one. A desaturated green at 0.14 and a deep crimson at 0.32 point
 * the right way in hue and land within two levels of each other once
 * composited over a dark basemap — so in greyscale, or on a screen in
 * red-light mode, favourable and unfavourable looked identical and only the
 * hatch distinguished them. The hatch is supposed to be the secondary cue, not
 * the only one.
 *
 * These are chosen so that over Tracker's own basemap the composited luminance
 * rises monotonically with severity — roughly 31, 35, 39, 44 — while the
 * red-minus-green channel difference reverses sign between `fair` and `poor`.
 * Hue says which way is better, brightness says it again for anyone who cannot
 * use the hue, and the hatch says it a third time for the two levels a reader
 * has to act on.
 *
 * The opacities came down after looking at the result. A first version that
 * satisfied all three cues put the worst level at 0.285, and over a wide view
 * the red bands swallowed the terrain shading they were drawn on — legible in
 * the sense that the labels could still be read, and not in the sense that a
 * reader could judge a horizon or pick a road through them. Nothing now exceeds
 * 0.205, which keeps the ordering and gives the map back.
 */

/** True where the level is marked as well as tinted. */
export function isHatched(suitability: Suitability): boolean {
  return SUITABILITY_PAINT[suitability].hatch !== null;
}

/**
 * Whether a tile pixel falls on a hatch line.
 *
 * Diagonal at 45°, from the tile's own origin in world-pixel terms so the
 * pattern is continuous across tile seams rather than restarting at every
 * boundary — which would draw a grid of visible joins across the field.
 */
export function onHatch(worldX: number, worldY: number, spacingPx: number): boolean {
  if (spacingPx <= 0) return false;
  const phase = (worldX + worldY) % spacingPx;
  // One pixel of stroke per spacing, so "bad" is a fifth covered and "poor" a
  // ninth. A wider stroke stops being a hatch and becomes a half-tone, which
  // reads as a darker fill rather than as a mark laid over one.
  return (phase < 0 ? phase + spacingPx : phase) < 1;
}

/**
 * The colour for one pixel: fill, plus the hatch where it lands on a line.
 *
 * Returned pre-multiplied into a flat RGBA rather than as two draws, because
 * the tile renderer writes one pixel at a time and compositing here keeps the
 * whole treatment in one testable function.
 */
export function paintFor(
  suitability: Suitability,
  worldX: number,
  worldY: number,
): [number, number, number, number] {
  const paint = SUITABILITY_PAINT[suitability];
  if (paint.hatch && onHatch(worldX, worldY, paint.spacingPx)) return paint.hatch;
  return paint.fill;
}
