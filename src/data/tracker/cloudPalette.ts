import type { Suitability } from "./cloudSuitability";

/**
 * How the cloud layer looks, and why it does not look like a weather map.
 *
 * ## Restraint, because this map has other jobs
 *
 * The cloud layer sits over a basemap the reader is also using to find a dark
 * site, judge a horizon and pick a road. A saturated green-to-red wash would
 * take the map over and turn every other layer into a tint of itself. So the
 * palette is two quiet ends of one axis: a cool, barely-there blue-green where
 * the sky is open, and a warm neutral grey where it is closed. Nothing shouts,
 * and the ground stays readable underneath.
 *
 * ## The non-hue cue, and why it is a hatch
 *
 * Roughly one man in twelve cannot separate the two ends of a red-green axis,
 * and a screen outdoors at night in red-light mode flattens hue for everybody.
 * A layer whose entire meaning is carried by colour fails both.
 *
 * So severity is also carried by texture: closed sky is hatched, and the hatch
 * gets denser as it gets worse. It survives greyscale, colour blindness, a
 * dimmed screen and a photograph of a screen. Open sky has no hatch at all,
 * which is the strongest cue of the set — the absence of marking reads as "the
 * map is not warning you about this".
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

export const SUITABILITY_PAINT: Record<Suitability, SuitabilityPaint> = {
  // Open sky is left almost alone. A layer that tints the good case as heavily
  // as the bad one is a layer that has to be turned off to read the map.
  good: { fill: [96, 152, 148, 0.08], hatch: null, spacingPx: 0 },
  fair: { fill: [126, 146, 154, 0.14], hatch: null, spacingPx: 0 },
  // The bad end stays under a third opaque. The reader is choosing a road and a
  // horizon under this layer, and a warning that hides the map it is drawn on
  // gets switched off — after which it warns nobody about anything.
  poor: { fill: [146, 143, 138, 0.2], hatch: [58, 54, 50, 0.2], spacingPx: 9 },
  bad: { fill: [144, 139, 134, 0.3], hatch: [44, 41, 38, 0.3], spacingPx: 5 },
};

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
