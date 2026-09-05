import { EARTH_RADIUS_KM } from "../physics/constants";

/**
 * Mission coverage geometry for a single selected object.
 *
 * The split that governs this whole module: GCAT sources perigee, apogee and
 * inclination, but RAAN, argument of perigee and mean anomaly are a
 * deterministic educational reconstruction. So anything derived from orbit
 * *shape* is sourced and may be stated plainly, while anything that depends on
 * where the object is *along* its orbit is not, and must be labelled.
 *
 *   sourced          coverage band, footprint radius, revolutions per day,
 *                    longitude drift per revolution, station reachability
 *   reconstructed    the longitude the ground track happens to sit at, and
 *                    therefore any specific pass or contact time
 *
 * `SubSatellitePoint` is the seam for that. Today it is filled from the
 * reconstructed phase; swapping in real TLE-derived positions later replaces the
 * provider without changing the geometry below or the view above.
 */
export interface SubSatellitePoint {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  timeMs: number;
}

export interface CoverageStation {
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  minimumElevationDeg: number;
}

export interface OrbitShape {
  /** a - R⊕, sourced. */
  semiMajorAltitudeKm: number;
  /** Sourced. */
  eccentricity: number;
  /** Sourced. */
  inclinationDeg: number;
}

/**
 * Angular radius of the region that can see a satellite above `minElevationDeg`.
 * Standard spherical-geometry result; depends only on altitude and the mask, so
 * it is sourced for any object with GCAT orbit shape.
 */
export function visibilityAngularRadiusDeg(
  altitudeKm: number,
  minElevationDeg: number,
): number {
  if (!Number.isFinite(altitudeKm) || altitudeKm <= 0) return 0;
  const elevation = (Math.max(minElevationDeg, 0) * Math.PI) / 180;
  const ratio = (EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm)) * Math.cos(elevation);
  if (ratio >= 1) return 0;
  const central = Math.acos(ratio) - elevation;
  return Math.max(0, (central * 180) / Math.PI);
}

/** Sub-satellite latitude never exceeds this. Retrograde orbits mirror about 90°. */
export function groundTrackLatitudeLimitDeg(inclinationDeg: number): number {
  const inclination = Math.abs(inclinationDeg) % 360;
  const folded = inclination > 180 ? 360 - inclination : inclination;
  return folded > 90 ? 180 - folded : folded;
}

export interface CoverageEnvelope {
  /** Latitudes the sub-satellite point itself reaches. */
  trackLimitDeg: number;
  /** Latitudes that fall inside the footprint at some point. */
  coveredLimitDeg: number;
  /** Fraction of Earth's surface inside the covered band. */
  surfaceFraction: number;
}

export function coverageEnvelope(
  shape: OrbitShape,
  minElevationDeg: number,
): CoverageEnvelope {
  const trackLimitDeg = groundTrackLatitudeLimitDeg(shape.inclinationDeg);
  const footprint = visibilityAngularRadiusDeg(shape.semiMajorAltitudeKm, minElevationDeg);
  const coveredLimitDeg = Math.min(90, trackLimitDeg + footprint);
  // Spherical zone area between +/- limit is proportional to sin(limit).
  return {
    trackLimitDeg,
    coveredLimitDeg,
    surfaceFraction: Math.sin((coveredLimitDeg * Math.PI) / 180),
  };
}

/** Keplerian period from the sourced semi-major axis. */
export function orbitalPeriodMinutes(semiMajorAltitudeKm: number): number {
  const a = EARTH_RADIUS_KM + semiMajorAltitudeKm;
  const mu = 398600.4418;
  return (2 * Math.PI * Math.sqrt((a * a * a) / mu)) / 60;
}

export function revolutionsPerDay(semiMajorAltitudeKm: number): number {
  const period = orbitalPeriodMinutes(semiMajorAltitudeKm);
  return period > 0 ? 1440 / period : 0;
}

/**
 * Longitude the Earth turns beneath the orbit in one revolution. Negative means
 * each successive track lies west of the last.
 */
export function longitudeDriftPerRevolutionDeg(semiMajorAltitudeKm: number): number {
  return -(orbitalPeriodMinutes(semiMajorAltitudeKm) / 1436.07) * 360;
}

/**
 * Whether this orbit can ever bring the object above the station's mask. Depends
 * only on inclination, altitude and station latitude, so it holds regardless of
 * where along the orbit the object actually is.
 */
export function stationIsReachable(
  station: CoverageStation,
  shape: OrbitShape,
): boolean {
  const footprint = visibilityAngularRadiusDeg(
    shape.semiMajorAltitudeKm,
    station.minimumElevationDeg,
  );
  return Math.abs(station.latitudeDeg) <= groundTrackLatitudeLimitDeg(shape.inclinationDeg) + footprint;
}

/**
 * Great-circle separation in degrees, by haversine.
 *
 * The spherical law of cosines loses precision exactly where this function is
 * used most — small separations, when a station is close to the sub-satellite
 * point — because acos flattens near 1. Haversine stays conditioned there.
 */
export function angularSeparationDeg(
  aLatDeg: number, aLonDeg: number,
  bLatDeg: number, bLonDeg: number,
): number {
  const toRad = Math.PI / 180;
  const lat1 = aLatDeg * toRad;
  const lat2 = bLatDeg * toRad;
  const halfDLat = (lat2 - lat1) / 2;
  const halfDLon = ((bLonDeg - aLonDeg) * toRad) / 2;
  const h =
    Math.sin(halfDLat) * Math.sin(halfDLat) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(halfDLon) * Math.sin(halfDLon);
  return (2 * Math.asin(Math.min(1, Math.sqrt(h))) * 180) / Math.PI;
}

export interface StationAccessEstimate {
  stationId: string;
  reachable: boolean;
  /** Revolutions per day that bring the object inside the station's mask. */
  accessesPerDay: number;
  /** Share of the day the object is above the mask. */
  visibleFraction: number;
}

/**
 * Access statistics averaged over a full day of revolutions.
 *
 * Individual pass times depend on the reconstructed phase and are not
 * trustworthy, but the *rate* is not: over ~15 revolutions the Earth turns
 * beneath the orbit and samples longitude near-uniformly, so the daily count is
 * a property of the geometry. `explorerCoverage.test.ts` measures the spread
 * across starting phases to keep that claim honest.
 */
export function estimateStationAccess(
  station: CoverageStation,
  shape: OrbitShape,
  track: readonly SubSatellitePoint[],
): StationAccessEstimate {
  if (!stationIsReachable(station, shape) || track.length === 0) {
    return { stationId: station.id, reachable: false, accessesPerDay: 0, visibleFraction: 0 };
  }

  let insideSamples = 0;
  let passes = 0;
  let wasInside = false;
  for (const point of track) {
    const radius = visibilityAngularRadiusDeg(point.altitudeKm, station.minimumElevationDeg);
    const inside =
      angularSeparationDeg(point.latitudeDeg, point.longitudeDeg, station.latitudeDeg, station.longitudeDeg) <=
      radius;
    if (inside && !wasInside) passes += 1;
    if (inside) insideSamples += 1;
    wasInside = inside;
  }

  const spanMs = track[track.length - 1].timeMs - track[0].timeMs;
  const days = spanMs > 0 ? spanMs / 86_400_000 : 1;
  return {
    stationId: station.id,
    reachable: true,
    accessesPerDay: days > 0 ? passes / days : passes,
    visibleFraction: insideSamples / track.length,
  };
}

/**
 * Splits a sub-satellite path into polylines that never wrap the antimeridian,
 * so an equirectangular projection does not draw a line straight across the map.
 */
export function splitTrackAtDateline(
  track: readonly SubSatellitePoint[],
): SubSatellitePoint[][] {
  const segments: SubSatellitePoint[][] = [];
  let current: SubSatellitePoint[] = [];
  for (let index = 0; index < track.length; index += 1) {
    const point = track[index];
    if (index > 0 && Math.abs(point.longitudeDeg - track[index - 1].longitudeDeg) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

export function normalizeLongitudeDeg(longitudeDeg: number): number {
  let value = longitudeDeg;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}
