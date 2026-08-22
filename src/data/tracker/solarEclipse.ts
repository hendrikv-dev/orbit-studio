import {
  Body,
  Equator,
  GeoMoon,
  GeoVector,
  Vector,
  Horizon,
  MakeTime,
  NextGlobalSolarEclipse,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  SearchGlobalSolarEclipse,
  SiderealTime,
  type AstroTime,
} from "astronomy-engine";
import { utcInstant, type UtcInstant } from "./scientificUnits";

/**
 * Solar eclipse geometry, computed rather than tabulated.
 *
 * An eclipse map is the one visualization in Tracker where the drawing *is* the
 * answer: "will I see it from here" is a question about where you are standing
 * relative to a shadow, and no amount of prose substitutes for the picture. So
 * the picture has to be the real shadow, not a plausible band drawn across a
 * continent.
 *
 * Three primitives, and it matters which answers which question:
 *
 * - **The shadow axis.** The line through the centre of the Sun and the centre
 *   of the Moon, intersected with the Earth ellipsoid. This — and only this —
 *   is the centre line.
 * - **Disc geometry.** Topocentric Sun and Moon positions, from which the
 *   angular separation of the two centres, and hence obscuration, follows at
 *   any point on Earth. This gives coverage and local circumstances.
 * - **`SearchGlobalSolarEclipse`** for the catalogue and the instant of
 *   greatest eclipse.
 *
 * ## Why the centre line is not a maximum of obscuration
 *
 * The first version of this file traced the central path by hill-climbing on
 * obscuration, and that is invalid for exactly the eclipses the line matters
 * for. Inside the umbra of a total eclipse obscuration is 1 *everywhere* — a
 * flat optimum two hundred kilometres wide — so the optimiser stops at whatever
 * point it happened to reach first. The result was a line somewhere in the
 * band, labelled as the axis, with a distance quoted from it.
 *
 * The axis is a geometric object and is computed as one. `shadowAxisPoint`
 * reproduces Astronomy Engine's own greatest-eclipse coordinates to better than
 * a metre at the instant the engine reports them (asserted in the tests), which
 * is the strongest available check: the engine's figure is validated against
 * published circumstances, and this walks the same construction at arbitrary
 * times so the whole line can be drawn rather than one point of it.
 *
 * ## What is not modelled
 *
 * Observer elevation and the lunar limb profile. Both move the *edge* of the
 * umbra — by up to a few kilometres in rough terrain — and neither moves the
 * axis. Path limits are therefore reported as the smooth-limb approximation
 * they are. The coverage field states its own sampling resolution rather than
 * smoothing it away.
 */

const KM_PER_AU = 1.495978707e8;
/** IAU 2015 nominal solar radius, km. */
const SUN_RADIUS_KM = 695_700;
/** IAU mean lunar radius, km. */
const MOON_RADIUS_KM = 1_737.4;
/** Mean Earth radius, for the great-circle work that does not need the figure. */
const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

export type SolarEclipseKind = "partial" | "annular" | "total";

export interface SolarEclipseEvent {
  /** Stable identity across recomputation: the UTC date of greatest eclipse. */
  id: string;
  kind: SolarEclipseKind;
  /** Instant of greatest eclipse. */
  peakUtc: UtcInstant;
  /**
   * Where the shadow axis meets Earth at greatest eclipse. Null for an eclipse
   * whose axis misses Earth entirely, which is what makes it partial everywhere.
   */
  greatestPoint: { latitudeDeg: number; longitudeDeg: number } | null;
  /** Obscuration at that point, 0–1. Null where there is no such point. */
  greatestObscuration: number | null;
}

/** One point on the central line, and the moment the shadow is there. */
export interface CentralPathPoint {
  atUtc: UtcInstant;
  latitudeDeg: number;
  longitudeDeg: number;
  /** Obscuration on the axis: 1 for a total eclipse, less for an annular one. */
  obscuration: number;
  /** Sun altitude on the central line, which falls to zero at both ends. */
  sunAltitudeDeg: number;
  /**
   * Which central phase this point is in.
   *
   * A single eclipse can be both: a hybrid starts annular, becomes total as the
   * Earth's curvature brings the surface closer to the umbra's tip, and returns
   * to annular. Carrying it per point rather than per eclipse is what lets the
   * map label the band correctly along its length.
   */
  central: "total" | "annular";
  /**
   * The edges of the central phase, perpendicular to the track. Null where the
   * limits were not requested, or where the umbra is leaving Earth and the
   * band has no measurable width.
   */
  limits: {
    northLatitudeDeg: number;
    northLongitudeDeg: number;
    southLatitudeDeg: number;
    southLongitudeDeg: number;
    /** Full width of the central band here, km. */
    widthKm: number;
  } | null;
}

/** Greatest obscuration reached at one place, across the whole eclipse. */
export interface CoverageCell {
  latitudeDeg: number;
  longitudeDeg: number;
  /** 0–1. Zero where the eclipse never touches this place in daylight. */
  obscuration: number;
  /** True where the Sun is above the horizon at that place's own maximum. */
  sunUp: boolean;
}

export interface CoverageField {
  cells: CoverageCell[];
  /** Grid spacing in degrees, so the caller can state its own resolution. */
  stepDeg: number;
  bounds: { south: number; north: number; west: number; east: number };
}

/**
 * What one observer sees, from the same disc geometry as the map.
 *
 * Deliberately not `SearchLocalSolarEclipse`. Two models for the same number
 * would eventually disagree, and the one the reader can check is the one the
 * map is drawn from — an interface that says "88% here" beside a map whose
 * bands put you at 80% has a bug whichever number is right.
 */
export interface LocalSolarCircumstances {
  /** `none` where this eclipse does not reach the observer at all. */
  kind: SolarEclipseKind | "none";
  /** Greatest fraction of the Sun's disc covered from here, 0–1. */
  obscurationFraction: number;
  peakUtc: UtcInstant | null;
  partialBeginUtc: UtcInstant | null;
  partialEndUtc: UtcInstant | null;
  centralBeginUtc: UtcInstant | null;
  centralEndUtc: UtcInstant | null;
  /**
   * How long totality or annularity lasts here, in seconds.
   *
   * Reported rather than left for the caller to subtract, because the two
   * contacts are found independently and a caller differencing them would be
   * reproducing an assumption — that both exist — which is false for an
   * observer on the very edge of the band.
   */
  centralDurationSeconds: number | null;
  /** Sun altitude at local maximum. Negative means it happens below the horizon. */
  sunAltitudeAtPeakDeg: number;
  /**
   * True only where the Sun is actually above the horizon during the eclipse.
   * An eclipse that peaks at local midnight is a real event that this observer
   * cannot see, and the two must never be conflated.
   */
  visibleFromHere: boolean;
  /** How far the observer is from the central line, km. Null with no central line. */
  distanceToCentralLineKm: number | null;
}

/* ------------------------------------------------------------- primitives */

interface DiscGeometry {
  /** Angular separation of the two centres, degrees. */
  separationDeg: number;
  sunRadiusDeg: number;
  moonRadiusDeg: number;
  sunAltitudeDeg: number;
}

function discGeometry(time: AstroTime, latitudeDeg: number, longitudeDeg: number): DiscGeometry {
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  // Topocentric and of-date, with aberration: the question is where the two
  // discs appear from this patch of ground, not where they are geocentrically.
  // The difference is a lunar parallax of up to a degree, which is the entire
  // width of the phenomenon being drawn.
  const sun = Equator(Body.Sun, time, observer, true, true);
  const moon = Equator(Body.Moon, time, observer, true, true);

  const sunRadiusDeg = Math.asin(SUN_RADIUS_KM / (sun.dist * KM_PER_AU)) / DEG;
  const moonRadiusDeg = Math.asin(MOON_RADIUS_KM / (moon.dist * KM_PER_AU)) / DEG;

  const cosine =
    Math.sin(sun.dec * DEG) * Math.sin(moon.dec * DEG) +
    Math.cos(sun.dec * DEG) *
      Math.cos(moon.dec * DEG) *
      Math.cos((sun.ra - moon.ra) * 15 * DEG);

  return {
    separationDeg: Math.acos(Math.min(1, Math.max(-1, cosine))) / DEG,
    sunRadiusDeg,
    moonRadiusDeg,
    sunAltitudeDeg: Horizon(time, observer, sun.ra, sun.dec, "normal").altitude,
  };
}

/**
 * Fraction of the Sun's disc area hidden by the Moon's.
 *
 * The lens-shaped intersection of two circles, divided by the Sun's area. The
 * three cases are separate because the general formula is undefined at both
 * ends: discs that do not touch, and discs where one contains the other.
 */
export function discObscuration(
  separationDeg: number,
  sunRadiusDeg: number,
  moonRadiusDeg: number,
): number {
  if (separationDeg >= sunRadiusDeg + moonRadiusDeg) return 0;
  if (separationDeg <= Math.abs(moonRadiusDeg - sunRadiusDeg)) {
    // The Moon covers the Sun completely, or sits entirely inside it. The second
    // case is an annular eclipse, and the ring of Sun left over is exactly the
    // area ratio.
    return moonRadiusDeg >= sunRadiusDeg
      ? 1
      : (moonRadiusDeg * moonRadiusDeg) / (sunRadiusDeg * sunRadiusDeg);
  }
  const sunAngle = Math.acos(
    (separationDeg * separationDeg + sunRadiusDeg * sunRadiusDeg - moonRadiusDeg * moonRadiusDeg) /
      (2 * separationDeg * sunRadiusDeg),
  );
  const moonAngle = Math.acos(
    (separationDeg * separationDeg + moonRadiusDeg * moonRadiusDeg - sunRadiusDeg * sunRadiusDeg) /
      (2 * separationDeg * moonRadiusDeg),
  );
  const overlapArea =
    sunRadiusDeg * sunRadiusDeg * (sunAngle - Math.sin(2 * sunAngle) / 2) +
    moonRadiusDeg * moonRadiusDeg * (moonAngle - Math.sin(2 * moonAngle) / 2);
  return overlapArea / (Math.PI * sunRadiusDeg * sunRadiusDeg);
}

export interface EclipseSample {
  obscuration: number;
  sunAltitudeDeg: number;
  /** True on the central line: the Moon's disc is entirely within the Sun's, or vice versa. */
  central: boolean;
  /** True where the Moon's disc is the larger one, which is what makes it total. */
  totality: boolean;
}

/** Everything one observer sees at one instant. */
export function eclipseSampleAt(
  at: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): EclipseSample {
  const geometry = discGeometry(MakeTime(at), latitudeDeg, longitudeDeg);
  const { separationDeg, sunRadiusDeg, moonRadiusDeg, sunAltitudeDeg } = geometry;
  return {
    obscuration: discObscuration(separationDeg, sunRadiusDeg, moonRadiusDeg),
    sunAltitudeDeg,
    central: separationDeg <= Math.abs(moonRadiusDeg - sunRadiusDeg),
    totality: moonRadiusDeg >= sunRadiusDeg && separationDeg <= moonRadiusDeg - sunRadiusDeg,
  };
}

/* --------------------------------------------------------------- catalogue */

function classify(kind: string): SolarEclipseKind {
  if (kind === "total") return "total";
  if (kind === "annular") return "annular";
  return "partial";
}

/**
 * The next solar eclipses anywhere on Earth, in order.
 *
 * Global rather than local, because "is there an eclipse near me" is a question
 * the map answers and the list must not pre-judge: an eclipse that is 40%
 * partial from here is worth knowing about, and a local search that only
 * reported eclipses reaching some threshold would silently drop it.
 */
export function nextSolarEclipses(from: Date, count = 4): SolarEclipseEvent[] {
  const events: SolarEclipseEvent[] = [];
  let found = SearchGlobalSolarEclipse(from);
  for (let index = 0; index < count; index += 1) {
    const hasAxis = found.latitude !== undefined && found.longitude !== undefined;
    events.push({
      id: `solar-eclipse-${found.peak.date.toISOString().slice(0, 10)}`,
      kind: classify(String(found.kind)),
      peakUtc: utcInstant(found.peak.date),
      greatestPoint: hasAxis
        ? { latitudeDeg: found.latitude as number, longitudeDeg: found.longitude as number }
        : null,
      greatestObscuration: found.obscuration ?? null,
    });
    found = NextGlobalSolarEclipse(found.peak);
  }
  return events;
}

/* -------------------------------------------------------------- the axis */

/**
 * Astronomy Engine's own Earth figure, so the intersection below lands where
 * the engine's validated greatest-eclipse coordinates land.
 */
const EARTH_FLATTENING = 0.996647180302104;
const EARTH_FLATTENING_SQUARED = EARTH_FLATTENING * EARTH_FLATTENING;
const EARTH_EQUATORIAL_RADIUS_KM = 6378.1366;
const RAD2DEG = 180 / Math.PI;

/**
 * Where the shadow axis meets the Earth ellipsoid, at any instant.
 *
 * The axis is the line through the centre of the Sun and the centre of the
 * Moon. This is the only construction in the file that produces a *centre*
 * line; everything derived from obscuration produces a band.
 *
 * The construction deliberately mirrors Astronomy Engine's internal
 * `GeoidIntersect`, down to the choice of an aberration-corrected Sun and a
 * geometric `GeoMoon`, the dilation of z by the flattening so the ellipsoid
 * becomes a sphere, and the use of Greenwich apparent sidereal time for the
 * longitude. That is not imitation for its own sake: the engine exposes the
 * result of that calculation only at greatest eclipse, and reproducing it
 * exactly is what lets the tests assert agreement to under a metre and then
 * trust the same code at every other instant along the track.
 *
 * Returns null when the axis misses Earth entirely, which is what makes an
 * eclipse partial everywhere — that null is the honest end of the central path
 * rather than a reason to keep drawing.
 */
export function shadowAxisPoint(at: Date): { latitudeDeg: number; longitudeDeg: number } | null {
  const time = MakeTime(at);
  const sun = GeoVector(Body.Sun, time, true);
  const moon = GeoMoon(time);

  // Lunacentric Earth, and the heliocentric Moon which lies along the axis.
  const target = new Vector(-moon.x, -moon.y, -moon.z, time);
  const direction = new Vector(moon.x - sun.x, moon.y - sun.y, moon.z - sun.z, time);

  const rotation = Rotation_EQJ_EQD(time);
  const v = RotateVector(rotation, direction);
  const e = RotateVector(rotation, target);

  const vx = v.x * KM_PER_AU;
  const vy = v.y * KM_PER_AU;
  const vz = (v.z * KM_PER_AU) / EARTH_FLATTENING;
  const ex = e.x * KM_PER_AU;
  const ey = e.y * KM_PER_AU;
  const ez = (e.z * KM_PER_AU) / EARTH_FLATTENING;

  const a = vx * vx + vy * vy + vz * vz;
  const b = -2 * (vx * ex + vy * ey + vz * ez);
  const c = ex * ex + ey * ey + ez * ez - EARTH_EQUATORIAL_RADIUS_KM * EARTH_EQUATORIAL_RADIUS_KM;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return null;

  // The nearer of the two roots, which is the day side.
  const u = (-b - Math.sqrt(discriminant)) / (2 * a);
  const px = u * vx - ex;
  const py = u * vy - ey;
  const pz = (u * vz - ez) * EARTH_FLATTENING;

  const projected = Math.hypot(px, py) * EARTH_FLATTENING_SQUARED;
  const latitudeDeg =
    projected === 0 ? (pz > 0 ? 90 : -90) : RAD2DEG * Math.atan(pz / projected);

  let longitudeDeg = RAD2DEG * Math.atan2(py, px) - 15 * SiderealTime(time);
  longitudeDeg = ((longitudeDeg % 360) + 540) % 360 - 180;

  return { latitudeDeg, longitudeDeg };
}

/* ------------------------------------------------------------ central path */

/** Bearing from one point to another, degrees clockwise from north. */
function bearingBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLon = (bLon - aLon) * DEG;
  const y = Math.sin(dLon) * Math.cos(bLat * DEG);
  const x =
    Math.cos(aLat * DEG) * Math.sin(bLat * DEG) -
    Math.sin(aLat * DEG) * Math.cos(bLat * DEG) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Move a given distance along a bearing, on a sphere. */
function offsetPoint(
  latitudeDeg: number,
  longitudeDeg: number,
  bearingDeg: number,
  distanceKm: number,
): { latitudeDeg: number; longitudeDeg: number } {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const bearing = bearingDeg * DEG;
  const sinLat =
    Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing);
  const newLat = Math.asin(Math.min(1, Math.max(-1, sinLat)));
  const newLon =
    lon +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * sinLat,
    );
  return {
    latitudeDeg: newLat / DEG,
    longitudeDeg: ((newLon / DEG + 540) % 360) - 180,
  };
}

/**
 * How far the central phase extends either side of the axis, at one instant.
 *
 * Walked outwards perpendicular to the track until the Moon's disc stops
 * covering the Sun's, then bisected. This is the umbral limit under a smooth
 * lunar limb — the real edge is serrated by mountains on the Moon's profile by
 * a kilometre or two, which is below the resolution of anything drawn here and
 * is stated as a limitation rather than modelled.
 *
 * Returns null where the axis point is not itself in central eclipse, which
 * happens at the very ends of the track where the umbra is leaving Earth.
 */
function centralHalfWidthKm(
  at: Date,
  latitudeDeg: number,
  longitudeDeg: number,
  bearingDeg: number,
  maximumKm = 400,
): number | null {
  const isCentral = (distance: number) => {
    const point = offsetPoint(latitudeDeg, longitudeDeg, bearingDeg, distance);
    return eclipseSampleAt(at, point.latitudeDeg, point.longitudeDeg).central;
  };
  if (!isCentral(0)) return null;
  let inside = 0;
  let outside = maximumKm;
  if (isCentral(outside)) return outside;
  for (let step = 0; step < 18; step += 1) {
    const middle = (inside + outside) / 2;
    if (isCentral(middle)) inside = middle;
    else outside = middle;
  }
  return inside;
}

/**
 * The central line, traced along the shadow axis.
 *
 * Every point is an axis intersection, not a search result. Where the axis
 * misses Earth the point is simply absent, which is the true beginning and end
 * of the track.
 *
 * `withLimits` adds the northern and southern edges of the central phase. It is
 * off by default because the caller that needs a distance to the line does not
 * need the band, and the band costs a bisection per side per point.
 */
export function traceCentralPath(
  event: SolarEclipseEvent,
  stepMinutes = 6,
  halfSpanMinutes = 240,
  withLimits = false,
): CentralPathPoint[] {
  if (!event.greatestPoint) return [];
  const peak = Date.parse(event.peakUtc);
  const points: CentralPathPoint[] = [];

  for (let offset = -halfSpanMinutes; offset <= halfSpanMinutes; offset += stepMinutes) {
    const at = new Date(peak + offset * 60_000);
    const axis = shadowAxisPoint(at);
    if (!axis) continue;
    const sample = eclipseSampleAt(at, axis.latitudeDeg, axis.longitudeDeg);
    // The axis can meet Earth while the umbra has not yet arrived, at the very
    // edge of the penumbral season. Only central points belong on a centre line.
    if (!sample.central) continue;
    points.push({
      atUtc: utcInstant(at),
      latitudeDeg: axis.latitudeDeg,
      longitudeDeg: axis.longitudeDeg,
      obscuration: sample.obscuration,
      sunAltitudeDeg: sample.sunAltitudeDeg,
      central: sample.totality ? "total" : "annular",
      limits: null,
    });
  }

  if (withLimits) {
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const neighbour = points[index + 1] ?? points[index - 1];
      if (!neighbour) continue;
      const along = bearingBetween(
        point.latitudeDeg,
        point.longitudeDeg,
        neighbour.latitudeDeg,
        neighbour.longitudeDeg,
      );
      // Perpendicular to the direction of travel, both ways.
      const left = (along + 270) % 360;
      const right = (along + 90) % 360;
      const at = new Date(point.atUtc);
      const leftKm = centralHalfWidthKm(at, point.latitudeDeg, point.longitudeDeg, left);
      const rightKm = centralHalfWidthKm(at, point.latitudeDeg, point.longitudeDeg, right);
      if (leftKm === null || rightKm === null) continue;
      const leftEdge = offsetPoint(point.latitudeDeg, point.longitudeDeg, left, leftKm);
      const rightEdge = offsetPoint(point.latitudeDeg, point.longitudeDeg, right, rightKm);
      const northern = leftEdge.latitudeDeg >= rightEdge.latitudeDeg ? leftEdge : rightEdge;
      const southern = leftEdge.latitudeDeg >= rightEdge.latitudeDeg ? rightEdge : leftEdge;
      point.limits = {
        northLatitudeDeg: northern.latitudeDeg,
        northLongitudeDeg: northern.longitudeDeg,
        southLatitudeDeg: southern.latitudeDeg,
        southLongitudeDeg: southern.longitudeDeg,
        widthKm: leftKm + rightKm,
      };
    }
  }

  return points;
}

/* ---------------------------------------------------------- coverage field */

/**
 * Greatest obscuration reached at each grid point, over the whole eclipse.
 *
 * This is what a coverage map means, and it is not the obscuration at greatest
 * eclipse: a place two thousand kilometres along the track reaches its own
 * maximum an hour later, and a snapshot at one instant would draw it as
 * untouched. Each cell is scanned in time, coarsely and then finely around its
 * own best sample.
 */
export function coverageField(
  event: SolarEclipseEvent,
  bounds: { south: number; north: number; west: number; east: number },
  stepDeg = 2,
  halfSpanMinutes = 180,
): CoverageField {
  const peak = Date.parse(event.peakUtc);
  const cells: CoverageCell[] = [];

  for (let lat = bounds.south; lat <= bounds.north + 1e-9; lat += stepDeg) {
    for (let lon = bounds.west; lon <= bounds.east + 1e-9; lon += stepDeg) {
      const wrapped = ((lon + 540) % 360) - 180;
      let bestOffset = 0;
      let best: EclipseSample | null = null;

      for (let offset = -halfSpanMinutes; offset <= halfSpanMinutes; offset += 20) {
        const sample = eclipseSampleAt(new Date(peak + offset * 60_000), lat, wrapped);
        if (!best || sample.obscuration > best.obscuration) {
          best = sample;
          bestOffset = offset;
        }
      }
      // Refine around the coarse maximum, so a narrow track is not missed by a
      // twenty-minute stride. Totality lasts minutes; the coarse scan finds the
      // right neighbourhood and this finds the moment inside it.
      for (let offset = bestOffset - 20; offset <= bestOffset + 20; offset += 4) {
        const sample = eclipseSampleAt(new Date(peak + offset * 60_000), lat, wrapped);
        if (!best || sample.obscuration > best.obscuration) best = sample;
      }

      cells.push({
        latitudeDeg: lat,
        longitudeDeg: wrapped,
        obscuration: best ? best.obscuration : 0,
        sunUp: best ? best.sunAltitudeDeg > 0 : false,
      });
    }
  }

  return { cells, stepDeg, bounds };
}

/* -------------------------------------------------------------- one place */

function greatCircleKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = (bLat - aLat) * DEG;
  const dLon = (bLon - aLon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}


/**
 * Distance from a place to the central line, measured to the line rather than
 * to the samples on it.
 *
 * The shadow travels roughly a kilometre a second, so a path sampled every ten
 * or fifteen minutes has points several hundred kilometres apart. Taking the
 * nearest *point* therefore overstates the distance by up to half that spacing
 * — which for a sentence reading "the centre line passes about 700 km away" is
 * an error of the same order as the answer. Each pair of samples is treated as
 * a segment and the perpendicular distance to it is used.
 *
 * The projection is planar and local: over the few hundred kilometres this is
 * ever asked about, the error from ignoring curvature is far below the
 * precision the result is quoted at.
 */
function distanceToPath(
  latitudeDeg: number,
  longitudeDeg: number,
  path: CentralPathPoint[],
): number | null {
  if (path.length === 0) return null;
  if (path.length === 1) {
    return greatCircleKm(latitudeDeg, longitudeDeg, path[0].latitudeDeg, path[0].longitudeDeg);
  }

  const kmPerLat = 111.32;
  const kmPerLon = 111.32 * Math.cos(latitudeDeg * DEG);
  const toLocal = (lat: number, lon: number) => ({
    x: (((lon - longitudeDeg + 540) % 360) - 180) * kmPerLon,
    y: (lat - latitudeDeg) * kmPerLat,
  });

  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    const a = toLocal(path[index - 1].latitudeDeg, path[index - 1].longitudeDeg);
    const b = toLocal(path[index].latitudeDeg, path[index].longitudeDeg);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, (-a.x * dx - a.y * dy) / lengthSquared));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    closest = Math.min(closest, Math.hypot(px, py));
  }
  return closest;
}

/**
 * What this eclipse does from one place.
 *
 * ## Why maximum eclipse is not the first moment of totality
 *
 * The first version of this function scanned obscuration at one-minute steps
 * and kept the first sample that reached the maximum. For a partial eclipse
 * that is very nearly right. For a total eclipse it is wrong by the whole of
 * totality: obscuration reaches exactly 1 at second contact and stays there
 * until third, so "the first sample at the maximum value" is the *beginning* of
 * totality, and Tracker was labelling it "maximum here" — an error of up to
 * three minutes, in the one direction that matters, on the one event where
 * people set an alarm.
 *
 * Maximum eclipse is defined by geometry rather than by a plateau: it is the
 * instant of least angular separation between the two disc centres. That
 * function is smooth and has a single minimum across an eclipse, so it is
 * bracketed by a coarse scan and refined by golden section to under a second.
 *
 * Contacts come from the same separation curve by bisection: first and fourth
 * where the discs touch externally, second and third where the Moon's disc
 * fits inside the Sun's or the reverse. Walking a one-minute grid, as before,
 * quantised every contact to the nearest minute.
 */
export function localSolarCircumstances(
  event: SolarEclipseEvent,
  latitudeDeg: number,
  longitudeDeg: number,
  centralPath: CentralPathPoint[] = [],
  halfSpanMinutes = 240,
): LocalSolarCircumstances {
  const peak = Date.parse(event.peakUtc);
  const at = (offsetMinutes: number) => new Date(peak + offsetMinutes * 60_000);
  const geometryAt = (offsetMinutes: number) =>
    discGeometry(MakeTime(at(offsetMinutes)), latitudeDeg, longitudeDeg);

  /** Separation of the two centres, in degrees. The function being minimised. */
  const separation = (offsetMinutes: number) => geometryAt(offsetMinutes).separationDeg;

  const distanceToCentralLineKm = distanceToPath(latitudeDeg, longitudeDeg, centralPath);
  const none: LocalSolarCircumstances = {
    kind: "none",
    obscurationFraction: 0,
    peakUtc: null,
    partialBeginUtc: null,
    partialEndUtc: null,
    centralBeginUtc: null,
    centralEndUtc: null,
    centralDurationSeconds: null,
    sunAltitudeAtPeakDeg: -90,
    visibleFromHere: false,
    distanceToCentralLineKm,
  };

  // Bracket the minimum with a coarse scan, then refine.
  let bracketOffset = -halfSpanMinutes;
  let bracketValue = Number.POSITIVE_INFINITY;
  for (let offset = -halfSpanMinutes; offset <= halfSpanMinutes; offset += 2) {
    const value = separation(offset);
    if (value < bracketValue) {
      bracketValue = value;
      bracketOffset = offset;
    }
  }

  const maximumOffset = goldenSectionMinimum(
    separation,
    bracketOffset - 2,
    bracketOffset + 2,
    1 / 120, // half a second, expressed in minutes
  );

  const atMaximum = geometryAt(maximumOffset);
  const obscurationFraction = discObscuration(
    atMaximum.separationDeg,
    atMaximum.sunRadiusDeg,
    atMaximum.moonRadiusDeg,
  );
  if (obscurationFraction <= 0) {
    return { ...none, sunAltitudeAtPeakDeg: atMaximum.sunAltitudeDeg };
  }

  const partialThreshold = (offset: number) => {
    const g = geometryAt(offset);
    return g.separationDeg - (g.sunRadiusDeg + g.moonRadiusDeg);
  };
  const centralThreshold = (offset: number) => {
    const g = geometryAt(offset);
    return g.separationDeg - Math.abs(g.moonRadiusDeg - g.sunRadiusDeg);
  };

  const partialBegin = bisectCrossing(partialThreshold, maximumOffset, -1, halfSpanMinutes);
  const partialEnd = bisectCrossing(partialThreshold, maximumOffset, +1, halfSpanMinutes);

  const centralHere = atMaximum.separationDeg <= Math.abs(atMaximum.moonRadiusDeg - atMaximum.sunRadiusDeg);
  const centralBegin = centralHere
    ? bisectCrossing(centralThreshold, maximumOffset, -1, halfSpanMinutes)
    : null;
  const centralEnd = centralHere
    ? bisectCrossing(centralThreshold, maximumOffset, +1, halfSpanMinutes)
    : null;

  // Visibility is about the Sun being up during the eclipse, not only at its
  // maximum: an eclipse already under way at sunrise is genuinely observable.
  const altitudeAt = (offset: number | null) =>
    offset === null ? -90 : geometryAt(offset).sunAltitudeDeg;
  const visibleFromHere =
    atMaximum.sunAltitudeDeg > 0 ||
    altitudeAt(partialBegin) > 0 ||
    altitudeAt(partialEnd) > 0;

  const instant = (offset: number | null) => (offset === null ? null : utcInstant(at(offset)));

  return {
    kind: centralHere
      ? atMaximum.moonRadiusDeg >= atMaximum.sunRadiusDeg
        ? "total"
        : "annular"
      : "partial",
    obscurationFraction,
    peakUtc: instant(maximumOffset),
    partialBeginUtc: instant(partialBegin),
    partialEndUtc: instant(partialEnd),
    centralBeginUtc: instant(centralBegin),
    centralEndUtc: instant(centralEnd),
    centralDurationSeconds:
      centralBegin !== null && centralEnd !== null
        ? Math.round((centralEnd - centralBegin) * 60)
        : null,
    sunAltitudeAtPeakDeg: atMaximum.sunAltitudeDeg,
    visibleFromHere,
    distanceToCentralLineKm,
  };
}

/**
 * Golden-section minimisation on a unimodal function.
 *
 * Chosen over a finer grid because the quantity being found is a *time*, and a
 * grid fine enough to place totality's midpoint to the second would cost two
 * hundred times the ephemeris calls that eleven golden-section steps do.
 */
function goldenSectionMinimum(
  f: (x: number) => number,
  low: number,
  high: number,
  tolerance: number,
): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = low;
  let b = high;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = f(c);
  let fd = f(d);
  while (b - a > tolerance) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/**
 * The first sign change of `f` walking away from `from`, refined by bisection.
 *
 * `f` is negative during the phase and positive outside it, so the crossing is
 * the contact. Returns null when the phase never ends inside the search window,
 * which the caller must treat as "not established" rather than as an edge.
 */
function bisectCrossing(
  f: (x: number) => number,
  from: number,
  direction: 1 | -1,
  limitMinutes: number,
  coarseStep = 1,
): number | null {
  let inside = from;
  if (f(inside) > 0) return null;
  let outside: number | null = null;
  for (
    let offset = from + direction * coarseStep;
    Math.abs(offset) <= limitMinutes;
    offset += direction * coarseStep
  ) {
    if (f(offset) > 0) {
      outside = offset;
      break;
    }
    inside = offset;
  }
  if (outside === null) return null;
  let bracket = outside;
  for (let step = 0; step < 24; step += 1) {
    const middle = (inside + bracket) / 2;
    if (f(middle) > 0) bracket = middle;
    else inside = middle;
  }
  return (inside + bracket) / 2;
}

/**
 * A map extent that contains the observer and the part of the track that
 * concerns them.
 *
 * Deliberately not the whole path. A total eclipse crosses half the planet, and
 * a world map drawn to fit it puts the reader's own position inside a pixel —
 * which answers the geometry question and none of the observing one. The box
 * is grown around the observer to include the nearest stretch of track, then
 * clamped to a width where a coastline is still recognisable.
 */
export function mapExtentFor(
  latitudeDeg: number,
  longitudeDeg: number,
  centralPath: CentralPathPoint[],
  minimumHalfWidthDeg = 26,
  maximumHalfWidthDeg = 72,
): { south: number; north: number; west: number; east: number } {
  let halfWidth = minimumHalfWidthDeg;
  let halfHeight = minimumHalfWidthDeg * 0.62;

  if (centralPath.length > 0) {
    const nearest = centralPath.reduce((closest, point) => {
      const distance = greatCircleKm(
        latitudeDeg,
        longitudeDeg,
        point.latitudeDeg,
        point.longitudeDeg,
      );
      return distance < closest.distance ? { point, distance } : closest;
    }, { point: centralPath[0], distance: Number.POSITIVE_INFINITY });

    const lonGap = Math.abs(
      ((nearest.point.longitudeDeg - longitudeDeg + 540) % 360) - 180,
    );
    const latGap = Math.abs(nearest.point.latitudeDeg - latitudeDeg);
    halfWidth = Math.min(maximumHalfWidthDeg, Math.max(minimumHalfWidthDeg, lonGap * 1.5 + 12));
    halfHeight = Math.min(
      maximumHalfWidthDeg * 0.62,
      Math.max(minimumHalfWidthDeg * 0.62, latGap * 1.5 + 10),
    );
  }

  return {
    south: Math.max(-85, latitudeDeg - halfHeight),
    north: Math.min(85, latitudeDeg + halfHeight),
    west: longitudeDeg - halfWidth,
    east: longitudeDeg + halfWidth,
  };
}
