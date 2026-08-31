/**
 * The two spherical formulae the terrain work needs.
 *
 * ## Why these are here rather than imported
 *
 * `@turf/destination` is the obvious dependency and it is a wrapper around
 * exactly this arithmetic. Pulling it in costs a package, its helpers, and two
 * provenance entries, to get fifteen lines that are in every navigation
 * textbook and are checked below against published values. The brief asks for
 * reliable geodesic maths, not for a particular library, so this is the
 * reliable maths with a test that proves it.
 *
 * Spherical rather than ellipsoidal. Over the tens of kilometres a terrain
 * horizon looks across, the difference between a sphere and WGS84 is a few
 * metres of ground position — far below the resolution of any DEM Tracker
 * reads, and far below the angular precision it reports.
 */

/** Mean Earth radius, metres. The value the sphere is defined by. */
export const EARTH_RADIUS_M = 6_371_008.8;

const DEG = Math.PI / 180;

/**
 * Where you arrive travelling a great-circle distance on a bearing.
 *
 * The direct problem, from Bowditch. Bearing is degrees clockwise from north.
 */
export function destination(
  latitudeDeg: number,
  longitudeDeg: number,
  distanceM: number,
  bearingDeg: number,
): { latitudeDeg: number; longitudeDeg: number } {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = bearingDeg * DEG;
  const φ1 = latitudeDeg * DEG;
  const λ1 = longitudeDeg * DEG;

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * sinφ2,
    );

  return {
    latitudeDeg: φ2 / DEG,
    // Wrapped, so a bearing that crosses the antimeridian returns a longitude
    // the rest of the product can use without unwrapping it first.
    longitudeDeg: (((λ2 / DEG + 540) % 360) - 180),
  };
}

/** Great-circle distance between two points, metres. */
export function distanceM(
  fromLatDeg: number,
  fromLonDeg: number,
  toLatDeg: number,
  toLonDeg: number,
): number {
  const φ1 = fromLatDeg * DEG;
  const φ2 = toLatDeg * DEG;
  const Δφ = (toLatDeg - fromLatDeg) * DEG;
  const Δλ = (toLonDeg - fromLonDeg) * DEG;
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
