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

/* ------------------------------------------------------- where to actually look */

/**
 * A region of sky to face, which is not the same thing as an object's position.
 *
 * For a planet the two coincide: the thing is at a bearing and an altitude, and
 * that is where you point. For a meteor shower they must not. The radiant sets
 * the rate — a shower with its radiant near the horizon produces few meteors
 * however clear the sky — but staring at the radiant is the worst thing you can
 * do with your eyes, because meteors near it are travelling almost straight at
 * you and appear as motionless dots rather than streaks.
 *
 * So this is a separate value with a separate meaning, and the separation is in
 * the model rather than in a component's head. A native compass on a phone
 * would consume exactly this: a bearing to face, how much slop is acceptable,
 * and how high to tilt. It must never be handed a radiant and told it is a
 * heading.
 */
export interface GazeRegion {
  /** Bearing to face, degrees clockwise from north. */
  centerAzimuthDeg: number;
  /**
   * How wide the useful region is, in degrees either side of centre.
   *
   * Broad for meteors — the advice is genuinely "keep this part of the sky in
   * view", not "point here" — and narrow for a target you are trying to find.
   */
  azimuthSpreadDeg: number;
  /** How high to look, and how forgiving that is. */
  centerAltitudeDeg: number;
  altitudeSpreadDeg: number;
  /** Why this is the answer, in the words the interface can use. */
  reason: string;
}

/**
 * How far from the radiant to look.
 *
 * Meteors are longest and most visible some way from the radiant, and the usual
 * observing advice is roughly 40 degrees off it. Kept as a named constant
 * because it is a judgement about human vision rather than a derived quantity.
 */
const RADIANT_STANDOFF_DEG = 40;

/**
 * Comfortable observing altitude.
 *
 * High enough to be clear of horizon murk and local obstructions, low enough
 * that a person is not staring at the zenith with their neck bent — which is
 * what actually ends meteor watches.
 */
const COMFORTABLE_ALTITUDE_DEG = 60;

/**
 * Where to face, for an opportunity, at the moment that matters.
 *
 * Returns null where the question does not apply — a total lunar eclipse is
 * wherever the Moon is and the reader will find it without help.
 */
export function gazeRegionFor(opportunity: Opportunity, path: SkyPath | null): GazeRegion | null {
  if (!path || path.points.length === 0) return null;

  if (path.kind === "radiant") {
    // Judged at the best moment rather than averaged: that is when the reader
    // will be outside, and a radiant moves enough across a night that the mean
    // bearing can point somewhere the radiant never was.
    const best = path.points.reduce((top, point) =>
      point.relative > top.relative ? point : top,
    );
    // Offset away from the radiant, along the horizon, towards the darker sky.
    // Which side barely matters — what matters is not being aimed at it.
    const center = (best.azimuthDeg + RADIANT_STANDOFF_DEG + 360) % 360;
    return {
      centerAzimuthDeg: center,
      // Deliberately wide. Narrow guidance here would be false precision and
      // would also be bad advice: peripheral vision catches most meteors.
      azimuthSpreadDeg: 55,
      centerAltitudeDeg: COMFORTABLE_ALTITUDE_DEG,
      altitudeSpreadDeg: 25,
      reason:
        "Meteors near the radiant come almost straight at you and show as dots. Keep it in view, but look off to one side of it.",
    };
  }

  const best = path.points.reduce((top, point) =>
    point.relative > top.relative ? point : top,
  );
  return {
    centerAzimuthDeg: best.azimuthDeg,
    // Tight: this is a thing to find, and being 40 degrees out means not
    // finding it.
    azimuthSpreadDeg: 8,
    centerAltitudeDeg: Math.max(0, best.altitudeDeg),
    altitudeSpreadDeg: 5,
    reason: `${opportunity.title} is there at its best.`,
  };
}
