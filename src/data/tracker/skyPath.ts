import type { BestWindow, OpportunitySample } from "./conditions";
import type { Opportunity } from "./opportunity";

/**
 * The drawable form of an opportunity's geometry.
 *
 * This exists so the drawing never has to know about phenomena and the
 * phenomena never have to know about drawing. It is also the seam where the old
 * approximation died: the sky graphic used to be handed a rise bearing, a peak
 * bearing and a set bearing, and it interpolated a plausible-looking arc
 * between them. Plausible is the problem — the curve was smooth, symmetrical
 * and wrong, while the real horizontal coordinates existed in the profile the
 * whole time.
 *
 * A path is built from the samples themselves. If the object does something the
 * interpolation would not have predicted, the drawing shows it doing that.
 */

export interface SkyPoint {
  atUtc: string;
  altitudeDeg: number;
  azimuthDeg: number;
  /** The phenomenon's own quality at this instant, 0–1. */
  relative: number;
}

export interface SkyPath {
  /**
   * What the path is of.
   *
   * A target is a thing you point at, and its path is where to point over the
   * night. A radiant is where meteors appear to come from — you deliberately do
   * not stare at it — so the same line means something different and has to be
   * drawn and labelled differently.
   */
  kind: "target" | "radiant";
  points: SkyPoint[];
  riseUtc: string | null;
  culminationUtc: string | null;
  setUtc: string | null;
  /** The recommended observing interval, where one was computed. */
  windowStartUtc: string | null;
  windowEndUtc: string | null;
}

/**
 * Build a path, or nothing where the phenomenon has no geometry to draw.
 *
 * Returning null is a real answer: a total lunar eclipse has a position, but a
 * night with nothing above the horizon has no path, and inventing one would be
 * worse than leaving the space empty.
 */
export function skyPathFor(
  opportunity: Opportunity,
  window: BestWindow | null,
): SkyPath | null {
  const windowStartUtc = window?.startUtc ?? null;
  const windowEndUtc = window?.endUtc ?? null;

  if (opportunity.geometry?.kind === "radiant") {
    const { track } = opportunity.geometry;
    if (track.length === 0) return null;
    // The rate curve and the radiant track are sampled together, so the quality
    // at a point on the track is the profile's value at the same index. Matched
    // by timestamp rather than position in case that ever stops being true.
    const byTime = new Map(opportunity.profile.map((sample) => [sample.atUtc, sample.relative]));
    return {
      kind: "radiant",
      points: track.map((entry) => ({
        atUtc: entry.atUtc,
        altitudeDeg: entry.altitudeDeg,
        azimuthDeg: entry.azimuthDeg,
        relative: byTime.get(entry.atUtc) ?? 0,
      })),
      // A radiant does not rise and set in a way worth marking — what matters
      // is how high it has climbed, which the path itself shows.
      riseUtc: null,
      culminationUtc: null,
      setUtc: null,
      windowStartUtc,
      windowEndUtc,
    };
  }

  const points = opportunity.profile
    .filter(
      (sample): sample is OpportunitySample & { altitudeDeg: number; azimuthDeg: number } =>
        sample.altitudeDeg !== undefined && sample.azimuthDeg !== undefined,
    )
    .map((sample) => ({
      atUtc: sample.atUtc,
      altitudeDeg: sample.altitudeDeg,
      azimuthDeg: sample.azimuthDeg,
      relative: sample.relative,
    }));
  if (points.length === 0) return null;

  const marks =
    opportunity.geometry?.kind === "target"
      ? opportunity.geometry
      : { riseUtc: null, culminationUtc: null, setUtc: null };

  return {
    kind: "target",
    points,
    riseUtc: marks.riseUtc,
    culminationUtc: marks.culminationUtc,
    setUtc: marks.setUtc,
    windowStartUtc,
    windowEndUtc,
  };
}

/** The highest point of a path, which is what the callout labels. */
export function highestPoint(path: SkyPath): SkyPoint {
  return path.points.reduce((best, point) =>
    point.altitudeDeg > best.altitudeDeg ? point : best,
  );
}
