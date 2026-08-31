import { EARTH_RADIUS_M, destination } from "./geodesy";
import { TERRAIN, groundResolutionM } from "./terrainSource";

/**
 * How high the ground rises, seen from where you are standing.
 *
 * ## The question this answers
 *
 * Not "is this a good site" — hills are not a defect — but "can this particular
 * thing be seen from here". Saturn at 45° does not care about a ridge; a comet
 * at 4° in the west cares about nothing else. So the model computes a terrain
 * horizon *for a bearing*, and the caller compares it against the object's own
 * altitude.
 *
 * ## The geometry
 *
 * For samples along the bearing: the apparent vertical angle of a point at
 * distance `d` and height `h` above the observer, on a sphere, is
 *
 *     tan(α) = (h − d² / 2R) / d
 *
 * The `d² / 2R` term is the drop of the Earth's surface away from the
 * observer's horizontal. Ignoring it — using flat geometry — overstates the
 * height of everything beyond a few kilometres, and by forty kilometres it has
 * invented a hundred and twenty metres of hill that is not there. That is the
 * difference between "blocked" and "clear" for a low target, so it is not
 * optional.
 *
 * ## Refraction
 *
 * Standard atmospheric refraction lifts distant terrain slightly, and is
 * conventionally modelled by inflating the Earth's radius by about a seventh.
 * Tracker applies that, and says so: it is an assumption about a standard
 * atmosphere, not a measurement of tonight's.
 */

/** The conventional refracted radius: 7/6 of the geometric one. */
const REFRACTED_RADIUS_M = EARTH_RADIUS_M * (7 / 6);

/** How far out terrain can still block a low target, in metres. */
export const HORIZON_RANGE_M = 60_000;

/**
 * Where the samples go.
 *
 * Close in, a metre of hill matters and the samples are dense; far out, only
 * mountains matter and dense sampling buys nothing but tile fetches. The steps
 * grow geometrically, which puts most of the effort in the first few kilometres
 * where most obstructions are.
 */
export function sampleDistances(rangeM = HORIZON_RANGE_M): number[] {
  const distances: number[] = [];
  let step = 30;
  let at = step;
  while (at <= rangeM) {
    distances.push(at);
    step = Math.min(step * 1.18, 2000);
    at += step;
  }
  return distances;
}

export interface TerrainSample {
  distanceM: number;
  elevationM: number;
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface HorizonResult {
  /** The highest apparent angle along this bearing, degrees. */
  angleDeg: number;
  /** What produced it, so a caller can say how far away the ridge is. */
  from: TerrainSample | null;
  /** Half-width of the honest uncertainty on `angleDeg`, degrees. */
  uncertaintyDeg: number;
  /** How many samples had elevation. Zero means no usable terrain data. */
  sampled: number;
}

/**
 * The apparent angle of a point `heightM` above the observer at `distanceM`.
 *
 * Negative where the point is below the observer's horizontal, which is the
 * normal case looking down a valley and is not the same as "no obstruction".
 */
export function apparentAngleDeg(heightM: number, distanceM: number): number {
  if (distanceM <= 0) return 0;
  const drop = (distanceM * distanceM) / (2 * REFRACTED_RADIUS_M);
  return (Math.atan((heightM - drop) / distanceM) * 180) / Math.PI;
}

/**
 * The terrain horizon along one bearing.
 *
 * `elevationAt` returns metres above sea level, or null where the DEM has
 * nothing. Null is not zero: a missing sample is skipped, and if every sample
 * is missing the result says so rather than reporting a flat horizon.
 */
export function horizonAlongBearing(
  observer: { latitudeDeg: number; longitudeDeg: number; elevationM: number },
  bearingDeg: number,
  elevationAt: (latitudeDeg: number, longitudeDeg: number) => number | null,
  rangeM = HORIZON_RANGE_M,
): HorizonResult {
  let best = -Infinity;
  let from: TerrainSample | null = null;
  let sampled = 0;

  for (const distance of sampleDistances(rangeM)) {
    const point = destination(
      observer.latitudeDeg,
      observer.longitudeDeg,
      distance,
      bearingDeg,
    );
    const elevation = elevationAt(point.latitudeDeg, point.longitudeDeg);
    if (elevation === null || !Number.isFinite(elevation)) continue;
    sampled += 1;
    const angle = apparentAngleDeg(elevation - observer.elevationM, distance);
    if (angle > best) {
      best = angle;
      from = {
        distanceM: distance,
        elevationM: elevation,
        latitudeDeg: point.latitudeDeg,
        longitudeDeg: point.longitudeDeg,
      };
    }
  }

  if (sampled === 0 || best === -Infinity) {
    return { angleDeg: 0, from: null, uncertaintyDeg: 0, sampled: 0 };
  }

  /**
   * How wrong this could be.
   *
   * Two sources, added rather than combined in quadrature because they are not
   * independent and this should err generous. The first is the vertical error
   * of the DEM itself, taken as a conservative ten metres — Copernicus quotes
   * about four, 3DEP better, and neither holds everywhere. The second is that
   * the ridge might genuinely be half a post-width nearer or further than the
   * sample that found it.
   */
  const distance = from?.distanceM ?? 1;
  const verticalErrorM = 10;
  const post = groundResolutionM(observer.latitudeDeg, TERRAIN.maxZoom);
  const fromHeight = Math.abs(apparentAngleDeg(verticalErrorM, distance));
  const fromPosition = Math.abs(
    apparentAngleDeg((from?.elevationM ?? 0) - observer.elevationM, distance) -
      apparentAngleDeg((from?.elevationM ?? 0) - observer.elevationM, distance + post),
  );

  return {
    angleDeg: best,
    from,
    uncertaintyDeg: Math.max(0.15, fromHeight + fromPosition),
    sampled,
  };
}

export type TerrainVerdict =
  | "clear"
  | "blocked"
  | "marginal"
  | "unknown";

export interface TerrainAssessment {
  verdict: TerrainVerdict;
  /** The terrain horizon in that direction, or null when unknown. */
  horizonDeg: number | null;
  /** How far away the blocking ground is, kilometres. Null when unknown. */
  ridgeDistanceKm: number | null;
  uncertaintyDeg: number;
}

/**
 * Whether terrain blocks a target, given both angles.
 *
 * The margin is the honest uncertainty, not a fudge factor: inside it the
 * answer is "too close to call", which is a real answer and a more useful one
 * than a confident coin-flip. This is the whole reason `marginal` exists.
 */
export function assessTerrain(
  horizon: HorizonResult,
  targetAltitudeDeg: number,
): TerrainAssessment {
  if (horizon.sampled === 0) {
    return { verdict: "unknown", horizonDeg: null, ridgeDistanceKm: null, uncertaintyDeg: 0 };
  }
  const margin = horizon.uncertaintyDeg;
  const difference = targetAltitudeDeg - horizon.angleDeg;
  const verdict: TerrainVerdict =
    Math.abs(difference) <= margin ? "marginal" : difference > 0 ? "clear" : "blocked";
  return {
    verdict,
    horizonDeg: horizon.angleDeg,
    ridgeDistanceKm: horizon.from ? horizon.from.distanceM / 1000 : null,
    uncertaintyDeg: margin,
  };
}

/** Degrees, at the precision the model actually supports. */
export function roundedHorizon(angleDeg: number): number {
  return Math.round(angleDeg * 2) / 2;
}
