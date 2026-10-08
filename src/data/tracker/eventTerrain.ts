import { readElevations, type ElevationReader } from "./demService";
import { destination } from "./geodesy";
import {
  HORIZON_RANGE_M,
  assessTerrain,
  horizonAlongBearing,
  roundedHorizon,
  sampleDistances,
  type TerrainAssessment,
} from "./terrainHorizon";
import { TERRAIN } from "./terrainSource";

/**
 * What terrain does to one event, from one place.
 *
 * ## Why this is per-event and not a site score
 *
 * Hills are not a defect. A ridge to the south-east is irrelevant to a meteor
 * shower overhead, fatal to a comet low in the same direction, and the whole
 * question for a moonrise eclipse. A single "this place has hills" verdict
 * would be wrong in all three cases, so terrain is evaluated against the
 * object's own bearing and altitude and nothing else.
 *
 * ## What it deliberately does not claim
 *
 * A DEM is bare earth. It does not know about the trees at the end of the
 * garden, the neighbour's roof, or the hedge — all of which block more sky than
 * most hills. So every result says **terrain**, never "your view", and the
 * product carries a one-time note saying so.
 */

export interface EventTerrain extends TerrainAssessment {
  bearingDeg: number;
  targetAltitudeDeg: number;
  /** How many of the DEM tiles the sightline needed actually arrived. */
  coverage: { loaded: number; requested: number };
  /**
   * When the target clears or is lost behind terrain, where that happens
   * within the window asked about.
   */
  clearsAtUtc: string | null;
  dropsAtUtc: string | null;
}

/** A position of the object through its window, for the crossing search. */
export interface TrackPoint {
  atUtc: string;
  azimuthDeg: number;
  altitudeDeg: number;
}

/**
 * Everything the sightline will sample, so the tiles can be fetched at once.
 *
 * Built for every bearing the track visits, not only the one at maximum: an
 * object that rises through two hours moves tens of degrees in azimuth, and a
 * horizon computed only at its best moment says nothing about when it cleared.
 */
function pointsFor(
  observer: { latitudeDeg: number; longitudeDeg: number },
  bearings: number[],
  rangeM: number,
): { latitudeDeg: number; longitudeDeg: number }[] {
  const points: { latitudeDeg: number; longitudeDeg: number }[] = [
    { latitudeDeg: observer.latitudeDeg, longitudeDeg: observer.longitudeDeg },
  ];
  for (const bearing of bearings) {
    for (const distance of sampleDistances(rangeM)) {
      points.push(
        destination(observer.latitudeDeg, observer.longitudeDeg, distance, bearing),
      );
    }
  }
  return points;
}

/**
 * Distinct bearings worth computing a horizon for.
 *
 * Rounded to whole degrees and de-duplicated: two track points a minute apart
 * are on the same bearing to within far less than the DEM's own resolution, and
 * computing both would double the tile fetches for no new information.
 */
function bearingsOf(track: TrackPoint[]): number[] {
  return [...new Set(track.map((point) => Math.round(point.azimuthDeg)))];
}

export interface EventTerrainRequest {
  observer: { latitudeDeg: number; longitudeDeg: number };
  /** The moment the guidance is about, and its azimuth and altitude. */
  best: TrackPoint;
  /** The object's path through its observing window, for crossing times. */
  track?: TrackPoint[];
  signal?: AbortSignal;
}

/**
 * When the object crosses its own terrain horizon.
 *
 * Walked along the track rather than solved: the horizon is a different angle
 * at every bearing, so the crossing is not a single altitude to invert. Only
 * the first change of state in each direction is reported — "clears around
 * 11:48 PM" is useful; a list of every crossing is not.
 *
 * Separated from the fetching so it can be tested against a known track and a
 * known horizon, which is the part that has the arithmetic in it.
 */
export function crossings(
  track: TrackPoint[],
  horizonAt: (bearingDeg: number) => number | null,
): { clearsAtUtc: string | null; dropsAtUtc: string | null } {
  let clearsAtUtc: string | null = null;
  let dropsAtUtc: string | null = null;
  let previousClear: boolean | null = null;
  for (const point of track) {
    const horizon = horizonAt(point.azimuthDeg);
    if (horizon === null) continue;
    const clear = point.altitudeDeg > horizon;
    if (previousClear !== null && clear !== previousClear) {
      if (clear && !clearsAtUtc) clearsAtUtc = point.atUtc;
      if (!clear && !dropsAtUtc) dropsAtUtc = point.atUtc;
    }
    previousClear = clear;
  }
  return { clearsAtUtc, dropsAtUtc };
}

export async function assessEventTerrain({
  observer,
  best,
  track = [],
  signal,
}: EventTerrainRequest): Promise<EventTerrain> {
  /**
   * Two resolutions, for two different questions.
   *
   * The answer the card leads with — is this blocked right now — is computed
   * along one bearing at the full range and the finest zoom worth reading. The
   * crossing times are a walk across every bearing the object visits, which at
   * the same settings meant thousands of points and hundreds of DEM tiles: the
   * first version took longer than the reader was willing to wait, and most of
   * that work bought minutes of precision on a time already rounded.
   *
   * So the walk runs coarser and shorter. A ridge that decides when something
   * clears is a near one; the distant skyline that sets the horizon angle is
   * already accounted for by the primary bearing.
   */
  const TRACK_RANGE_M = 18_000;
  const TRACK_ZOOM = TERRAIN.maxZoom - 5;
  /**
   * Zoom 11, and the reason is measured rather than assumed.
   *
   * The tiles are a quarter-megabyte each and the public service throttles
   * hard: twenty-one concurrent requests returned eleven in twenty seconds, so
   * a sightline that wants twenty tiles does not get them and the card reports
   * no data for ground that exists. Each zoom level down quarters the tile
   * count along a bearing.
   *
   * Nothing much is lost. Zoom 11 is about seventy-five metre posts at these
   * latitudes, and Mapterhorn is a composite whose floor over much of the world
   * is thirty-metre Copernicus — finer sampling would be interpolating the same
   * data. Portland's west horizon reads 4.2° at zoom 12 and 4.2° at zoom 11,
   * which is inside the uncertainty the answer is quoted with either way.
   */
  const PRIMARY_ZOOM = TERRAIN.maxZoom - 4;
  /** Forty kilometres. Past that a ridge has to be a mountain to matter. */
  const PRIMARY_RANGE_M = 40_000;
  const primaryBearing = Math.round(best.azimuthDeg);
  const trackBearings = bearingsOf(track).filter((bearing) => bearing !== primaryBearing);

  const [primaryReader, trackReader] = await Promise.all([
    readElevations(
      pointsFor(observer, [primaryBearing], PRIMARY_RANGE_M),
      PRIMARY_ZOOM,
      signal,
    ),
    trackBearings.length > 0
      ? readElevations(pointsFor(observer, trackBearings, TRACK_RANGE_M), TRACK_ZOOM, signal)
      : Promise.resolve(null),
  ]);
  const reader = primaryReader;

  const ownElevation = reader.at(observer.latitudeDeg, observer.longitudeDeg);
  if (ownElevation === null || reader.loaded === 0) {
    return {
      verdict: "unknown",
      horizonDeg: null,
      ridgeDistanceKm: null,
      uncertaintyDeg: 0,
      bearingDeg: best.azimuthDeg,
      targetAltitudeDeg: best.altitudeDeg,
      coverage: { loaded: reader.loaded, requested: reader.requested },
      clearsAtUtc: null,
      dropsAtUtc: null,
    };
  }

  const at = { ...observer, elevationM: ownElevation };
  const primary = horizonAlongBearing(at, primaryBearing, reader.at, PRIMARY_RANGE_M);
  const assessment = assessTerrain(primary, best.altitudeDeg);

  const { clearsAtUtc, dropsAtUtc } = crossings(track, (bearingDeg) => {
    if (Math.round(bearingDeg) === primaryBearing) {
      return primary.sampled === 0 ? null : primary.angleDeg;
    }
    if (!trackReader) return null;
    const horizon = horizonAlongBearing(at, bearingDeg, trackReader.at, TRACK_RANGE_M);
    return horizon.sampled === 0 ? null : horizon.angleDeg;
  });

  return {
    ...assessment,
    bearingDeg: best.azimuthDeg,
    targetAltitudeDeg: best.altitudeDeg,
    coverage: { loaded: reader.loaded, requested: reader.requested },
    clearsAtUtc,
    dropsAtUtc,
  };
}

/**
 * The sentence a card shows.
 *
 * Always says *terrain*. "Your view is clear" is a claim about a garden nobody
 * has surveyed; "the terrain horizon is clear" is a claim about ground that has
 * been measured, and it is the one Tracker can make.
 */
export function describeTerrain(
  terrain: EventTerrain,
  compass: string,
  formatTime: (utc: string) => string,
): { headline: string; detail: string | null } {
  if (terrain.verdict === "unknown") {
    return {
      headline: "Terrain obstruction unknown",
      detail:
        terrain.coverage.requested === 0
          ? null
          : "Elevation data did not load for this sightline.",
    };
  }

  const horizon = `${roundedHorizon(terrain.horizonDeg ?? 0)}° ${compass}`;
  const ridge =
    terrain.ridgeDistanceKm !== null && terrain.ridgeDistanceKm >= 1
      ? `about ${Math.round(terrain.ridgeDistanceKm)} km away`
      : null;

  if (terrain.verdict === "blocked") {
    return {
      headline: `Blocked by terrain · horizon ${horizon}`,
      detail: terrain.clearsAtUtc
        ? `Clears terrain around ${formatTime(terrain.clearsAtUtc)}.`
        : ridge
          ? `The ground rises to that angle ${ridge}.`
          : null,
    };
  }

  if (terrain.verdict === "marginal") {
    return {
      headline: `Marginal · terrain horizon ${horizon}`,
      detail: "Too close to the modelled horizon to call either way.",
    };
  }

  return {
    headline: `Terrain clear · horizon ${horizon}`,
    detail: terrain.dropsAtUtc
      ? `Drops behind terrain around ${formatTime(terrain.dropsAtUtc)}.`
      : null,
  };
}

export type { ElevationReader };
