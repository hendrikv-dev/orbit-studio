import type { BestWindow } from "./conditions";
import type { Opportunity } from "./opportunity";
import { describeAltitude, type SkyPath, type SkyPoint } from "./skyPath";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";

/**
 * Which way to face, how high to look, and when.
 *
 * ## The failure this fixes
 *
 * A reader used Tracker during a real lunar eclipse. Tracker surfaced the
 * event, named it correctly, timed it correctly, and then left them standing
 * outside working out for themselves which part of the sky to search. Every
 * number needed to answer that was already computed — the Moon's altitude and
 * azimuth at every contact were sitting in `localContactAltitudesDeg` and in
 * the opportunity's own profile — and none of it was said in a sentence anybody
 * could act on.
 *
 * That is not a copy problem. A product that answers "there is an eclipse
 * tonight" but not "look south-east, about a third of the way up, from 8:33"
 * has not finished the job it exists to do.
 *
 * ## Why it is a module rather than a string in the hero
 *
 * The same instruction has to appear in three places that must never disagree:
 * the hero metric, the drill-in, and the calendar reminder the reader takes
 * outside with them. Computing it once from the path means the reminder cannot
 * say south-east while the page says south.
 *
 * ## Meteors
 *
 * A radiant is where the meteors come *from*, which is the one place not to
 * stare: trails near it are foreshortened to nothing. The instruction for a
 * shower is therefore deliberately different in kind — it names the radiant so
 * the reader can orient, and then tells them to look forty-odd degrees away
 * from it. That distinction is preserved in the type, not just in the wording.
 */

export type TargetMotion = "rising" | "setting" | "near-culmination" | "steady";

export interface ObservingInstruction {
  /** How to face, in words: "south-east". Null where there is no direction. */
  compass: string | null;
  /** The same bearing abbreviated for a dense metric: "SE". */
  cardinal: string | null;
  /** Bearing in degrees clockwise from north, where there is one. */
  azimuthDeg: number | null;
  /** Height above the horizon at the recommended moment. */
  altitudeDeg: number | null;
  /** The same height as a body movement: "about a third of the way up". */
  altitudeWords: string | null;
  /** What it is doing while the reader is outside. */
  motion: TargetMotion | null;
  /** The instant the direction and altitude describe. */
  atUtc: string;
  /**
   * The whole instruction, ready to render.
   *
   * One or two sentences, always concrete: a direction, a height, a time. Never
   * a judgement about whether the reader should bother — that decision belongs
   * to the reader, and Tracker's job is to make it possible.
   */
  sentence: string;
  /** How the position changes across the window, where it changes usefully. */
  change: string | null;
  /** A dense form for the hero metric: "SE · 25°". */
  metric: string;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

function octant(azimuthDeg: number): number {
  return Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8;
}

export function compassWords(azimuthDeg: number): string {
  return COMPASS[octant(azimuthDeg)];
}

export function cardinalAbbreviation(azimuthDeg: number): string {
  return CARDINALS[octant(azimuthDeg)];
}

/** The sample nearest an instant, so the instruction describes the right moment. */
function nearest(points: readonly SkyPoint[], targetUtc: string): SkyPoint | null {
  if (points.length === 0) return null;
  const target = Date.parse(targetUtc);
  return points.reduce((closest, point) =>
    Math.abs(Date.parse(point.atUtc) - target) < Math.abs(Date.parse(closest.atUtc) - target)
      ? point
      : closest,
  );
}

/**
 * Rising, setting, or as high as it is going to get.
 *
 * Measured from the path either side of the moment rather than from rise and
 * set times, because what the reader needs to know is what it will do in the
 * next hour while they are standing there.
 */
function motionAt(points: readonly SkyPoint[], atUtc: string): TargetMotion | null {
  if (points.length < 2) return null;
  const target = Date.parse(atUtc);
  const before = [...points]
    .filter((point) => Date.parse(point.atUtc) <= target)
    .slice(-1)[0];
  const after = points.find((point) => Date.parse(point.atUtc) > target);
  if (!before || !after) return null;
  const change = after.altitudeDeg - before.altitudeDeg;
  const minutes = (Date.parse(after.atUtc) - Date.parse(before.atUtc)) / 60_000;
  if (minutes <= 0) return null;
  const perHour = (change / minutes) * 60;
  if (Math.abs(perHour) < 2) return "near-culmination";
  if (perHour > 0) return "rising";
  return "setting";
}

function motionWords(motion: TargetMotion | null): string | null {
  switch (motion) {
    case "rising":
      return "climbing";
    case "setting":
      return "dropping towards the horizon";
    case "near-culmination":
      return "as high as it gets tonight";
    default:
      return null;
  }
}

/**
 * The instruction for a thing you point at.
 *
 * Direction and height are read at the recommended moment rather than at the
 * night's best, because those differ on any night whose peak hour is clouded
 * out — and the whole point of moving the window is that the reader will not be
 * outside at the peak.
 */
function targetInstruction(
  path: SkyPath,
  atUtc: string,
  clock: PlaceClock,
  windowEndUtc: string | null,
): ObservingInstruction | null {
  const point = nearest(path.points, atUtc);
  if (!point || point.altitudeDeg <= 0) return null;

  const compass = compassWords(point.azimuthDeg);
  const cardinal = cardinalAbbreviation(point.azimuthDeg);
  const altitude = Math.round(point.altitudeDeg);
  const words = describeAltitude(point.altitudeDeg);
  const motion = motionAt(path.points, atUtc);
  const time = formatClockTime(atUtc, clock);

  const facing =
    point.altitudeDeg >= 70
      ? `Look almost straight up at ${time}`
      : point.altitudeDeg < 15
        ? `Look low in the ${compass} at ${time}`
        : `Look ${compass} at ${time}`;
  const sentence = `${facing} — about ${altitude}° up, ${words}.`;

  // How it moves, but only where the movement is large enough to matter to
  // somebody standing outside for an hour. A target that shifts four degrees
  // is a target that has not moved.
  let change: string | null = null;
  const end = windowEndUtc ? nearest(path.points, windowEndUtc) : null;
  if (end && Math.abs(end.altitudeDeg - point.altitudeDeg) >= 8) {
    const endCompass = compassWords(end.azimuthDeg);
    const climbing = end.altitudeDeg > point.altitudeDeg;
    change =
      endCompass === compass
        ? `It ${climbing ? "climbs" : "drops"} to about ${Math.round(end.altitudeDeg)}° by ${formatClockTime(end.atUtc, clock)}, staying in the ${compass}.`
        : `By ${formatClockTime(end.atUtc, clock)} it has moved to the ${endCompass}, about ${Math.round(end.altitudeDeg)}° up.`;
  }

  return {
    compass,
    cardinal,
    azimuthDeg: point.azimuthDeg,
    altitudeDeg: point.altitudeDeg,
    altitudeWords: words,
    motion,
    atUtc,
    sentence,
    change,
    metric: `${cardinal} · ${altitude}°`,
  };
}

/**
 * The instruction for a shower, which is not an instruction to face anything.
 *
 * The radiant is named because it orients the reader and because the trails
 * really do point back to it, and then they are told to look away from it. Both
 * halves matter: "look north-east" would be wrong, and "look anywhere" throws
 * away the one piece of geometry a shower has.
 */
function radiantInstruction(
  path: SkyPath,
  atUtc: string,
  clock: PlaceClock,
): ObservingInstruction | null {
  const point = nearest(path.points, atUtc);
  if (!point) return null;
  const time = formatClockTime(atUtc, clock);
  if (point.altitudeDeg <= 0) {
    return {
      compass: null,
      cardinal: null,
      azimuthDeg: null,
      altitudeDeg: null,
      altitudeWords: null,
      motion: null,
      atUtc,
      sentence: `The radiant is below the horizon at ${time}. Take in as much of the sky as you can and wait — trails appear anywhere.`,
      change: null,
      metric: "Whole sky",
    };
  }
  const compass = compassWords(point.azimuthDeg);
  const altitude = Math.round(point.altitudeDeg);
  return {
    compass,
    cardinal: cardinalAbbreviation(point.azimuthDeg),
    azimuthDeg: point.azimuthDeg,
    altitudeDeg: point.altitudeDeg,
    altitudeWords: describeAltitude(point.altitudeDeg),
    motion: motionAt(path.points, atUtc),
    atUtc,
    // Deliberately two instructions, in this order: where the radiant is, and
    // then where to actually point your eyes. Staring at the radiant is the
    // commonest mistake in meteor watching — trails there are head-on and
    // almost pointlike — and a product that says "look north-east" causes it.
    sentence: `From ${time} the radiant stands about ${altitude}° up in the ${compass}. Do not stare at it: look roughly half the sky away, high up, and keep as much of the sky in view as you can.`,
    change: null,
    metric: "Whole sky",
  };
}

/**
 * The reader's instruction for one opportunity, or null where there is none.
 *
 * Null is a real answer — on a night with no shower running there is no radiant
 * and no target, and inventing a direction would be the same class of error as
 * plotting a flat line along the horizon and labelling it 0°.
 */
export function observingInstruction(
  opportunity: Opportunity,
  path: SkyPath | null,
  window: BestWindow | null,
  clock: PlaceClock,
): ObservingInstruction | null {
  const atUtc = window?.peakUtc ?? opportunity.guidance.whenUtc;
  if (!path || path.kind === "rate") {
    // The sporadic background has no position and no peak. What it has is a
    // time and a technique, and saying so is more use than silence.
    if (opportunity.kind === "meteors") {
      return {
        compass: null,
        cardinal: null,
        azimuthDeg: null,
        altitudeDeg: null,
        altitudeWords: null,
        motion: null,
        atUtc,
        sentence: `No shower is running, so there is no direction to face. Take in as much sky as you can from ${formatClockTime(atUtc, clock)}, and give your eyes twenty minutes to adapt.`,
        change: null,
        metric: "Whole sky",
      };
    }
    return null;
  }
  return path.kind === "radiant"
    ? radiantInstruction(path, atUtc, clock)
    : targetInstruction(path, atUtc, clock, window?.endUtc ?? null);
}
