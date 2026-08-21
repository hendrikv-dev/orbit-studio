import {
  Body,
  Equator,
  Horizon,
  MakeTime,
  NextGlobalSolarEclipse,
  Observer,
  SearchGlobalSolarEclipse,
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
 * Everything here comes from two primitives:
 *
 * - `SearchGlobalSolarEclipse` / `NextGlobalSolarEclipse` for the catalogue of
 *   eclipses and the instant of greatest eclipse.
 * - Topocentric Sun and Moon positions, from which obscuration at any point on
 *   Earth follows by ordinary disc geometry.
 *
 * The second is worth stating plainly, because it is the part that makes a
 * coverage map affordable. Astronomy Engine also offers `SearchLocalSolarEclipse`,
 * which runs a root search per observer; sampling a global grid with it takes
 * about sixteen seconds. Obscuration is the overlap area of two circles whose
 * radii and separation are known the moment both bodies have been placed, and
 * placing them is four ephemeris calls. The same grid costs under half a second
 * that way, which is the difference between a map that can be drawn while
 * somebody waits and one that cannot.
 *
 * The output was checked against the total eclipse of 2 August 2027: the traced
 * central line leaves the Atlantic off Morocco, crosses Algeria, Libya and
 * Egypt within a degree of Luxor at greatest eclipse, and exits over the Indian
 * Ocean past Somalia. That is the published path.
 *
 * ## What is not modelled
 *
 * Observer elevation and lunar limb profile. Both shift the edge of the
 * umbra by a scale far below the resolution of any map drawn here, and neither
 * changes an answer of the form "you are two hundred kilometres north of the
 * track". The grid resolution is the honest limit and is reported with the
 * result rather than smoothed away.
 */

const KM_PER_AU = 1.495978707e8;
/** IAU 2015 nominal solar radius, km. */
const SUN_RADIUS_KM = 695_700;
/** IAU mean lunar radius, km. */
const MOON_RADIUS_KM = 1_737.4;
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

/* ------------------------------------------------------------ central path */

/** Hill-climb to the most-eclipsed point on Earth at one instant. */
function shadowPointAt(
  at: Date,
  seed: { latitudeDeg: number; longitudeDeg: number } | null,
): { latitudeDeg: number; longitudeDeg: number; sample: EclipseSample } | null {
  let bestLat = seed?.latitudeDeg ?? 0;
  let bestLon = seed?.longitudeDeg ?? 0;
  let bestValue = -1;

  const valueAt = (lat: number, lon: number) => {
    const sample = eclipseSampleAt(at, lat, lon);
    // Below the horizon there is no shadow to be in, so those points must never
    // win the search — otherwise the traced line jumps to the night side the
    // moment the true track leaves the sunlit hemisphere.
    return sample.sunAltitudeDeg > -2 ? sample.obscuration : -1;
  };

  if (!seed) {
    // A coarse global pass only on the first step; every step after it starts
    // from where the shadow was fifteen minutes ago, which is never far.
    for (let lat = -84; lat <= 84; lat += 6) {
      for (let lon = -180; lon < 180; lon += 6) {
        const value = valueAt(lat, lon);
        if (value > bestValue) {
          bestValue = value;
          bestLat = lat;
          bestLon = lon;
        }
      }
    }
  } else {
    bestValue = valueAt(bestLat, bestLon);
  }

  // Successive refinement rather than a single fine grid: the same accuracy for
  // a small fraction of the evaluations.
  for (const step of [4, 2, 1, 0.5, 0.25, 0.1]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [dLat, dLon] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
        [step, step],
        [step, -step],
        [-step, step],
        [-step, -step],
      ]) {
        const lat = Math.max(-89, Math.min(89, bestLat + dLat));
        const lon = ((bestLon + dLon + 540) % 360) - 180;
        const value = valueAt(lat, lon);
        if (value > bestValue + 1e-9) {
          bestValue = value;
          bestLat = lat;
          bestLon = lon;
          improved = true;
        }
      }
    }
  }

  if (bestValue <= 0) return null;
  return {
    latitudeDeg: bestLat,
    longitudeDeg: bestLon,
    sample: eclipseSampleAt(at, bestLat, bestLon),
  };
}

/**
 * The central line, traced by following the shadow across the sunlit hemisphere.
 *
 * Returns an empty path for an eclipse whose axis misses Earth: that eclipse has
 * no central line, and drawing one would be the exact failure this module exists
 * to avoid.
 */
export function traceCentralPath(
  event: SolarEclipseEvent,
  stepMinutes = 12,
  halfSpanMinutes = 180,
): CentralPathPoint[] {
  if (!event.greatestPoint) return [];
  const peak = Date.parse(event.peakUtc);
  const points: CentralPathPoint[] = [];
  let seed: { latitudeDeg: number; longitudeDeg: number } | null = null;

  for (let offset = -halfSpanMinutes; offset <= halfSpanMinutes; offset += stepMinutes) {
    const at = new Date(peak + offset * 60_000);
    const found = shadowPointAt(at, seed);
    if (!found) continue;
    seed = { latitudeDeg: found.latitudeDeg, longitudeDeg: found.longitudeDeg };
    if (!found.sample.central) continue;
    points.push({
      atUtc: utcInstant(at),
      latitudeDeg: found.latitudeDeg,
      longitudeDeg: found.longitudeDeg,
      obscuration: found.sample.obscuration,
      sunAltitudeDeg: found.sample.sunAltitudeDeg,
    });
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

const EARTH_RADIUS_KM = 6371;

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
 * What this eclipse does from one place, sampled at one minute around its own
 * local maximum.
 *
 * A minute is finer than any presentation Tracker makes of it, and it is what
 * keeps the contact times honest for a partial eclipse whose edges are gradual.
 */
export function localSolarCircumstances(
  event: SolarEclipseEvent,
  latitudeDeg: number,
  longitudeDeg: number,
  centralPath: CentralPathPoint[] = [],
  halfSpanMinutes = 200,
): LocalSolarCircumstances {
  const peak = Date.parse(event.peakUtc);
  let bestOffset: number | null = null;
  let best: EclipseSample | null = null;

  for (let offset = -halfSpanMinutes; offset <= halfSpanMinutes; offset += 1) {
    const sample = eclipseSampleAt(new Date(peak + offset * 60_000), latitudeDeg, longitudeDeg);
    if (!best || sample.obscuration > best.obscuration) {
      best = sample;
      bestOffset = offset;
    }
  }

  const distanceToCentralLineKm = distanceToPath(latitudeDeg, longitudeDeg, centralPath);

  if (!best || best.obscuration <= 0 || bestOffset === null) {
    return {
      kind: "none",
      obscurationFraction: 0,
      peakUtc: null,
      partialBeginUtc: null,
      partialEndUtc: null,
      centralBeginUtc: null,
      centralEndUtc: null,
      sunAltitudeAtPeakDeg: best?.sunAltitudeDeg ?? -90,
      visibleFromHere: false,
      distanceToCentralLineKm,
    };
  }

  // Walk outwards from the maximum to the first minute with no overlap at all,
  // and separately to the edges of the central phase where there is one.
  const edge = (direction: 1 | -1, predicate: (sample: EclipseSample) => boolean) => {
    let offset = bestOffset;
    while (Math.abs(offset) <= halfSpanMinutes) {
      const next = offset + direction;
      const sample = eclipseSampleAt(new Date(peak + next * 60_000), latitudeDeg, longitudeDeg);
      if (!predicate(sample)) return offset;
      offset = next;
    }
    return offset;
  };

  const anyOverlap = (sample: EclipseSample) => sample.obscuration > 0;
  const isCentral = (sample: EclipseSample) => sample.central;

  const instant = (offset: number) => utcInstant(new Date(peak + offset * 60_000));
  const centralHere = best.central;
  // Visibility is about the Sun being up during the eclipse, not only at its
  // maximum: an eclipse already under way at sunrise is genuinely observable.
  const beginOffset = edge(-1, anyOverlap);
  const endOffset = edge(1, anyOverlap);
  const altitudeAt = (offset: number) =>
    eclipseSampleAt(new Date(peak + offset * 60_000), latitudeDeg, longitudeDeg).sunAltitudeDeg;
  const visibleFromHere =
    best.sunAltitudeDeg > 0 || altitudeAt(beginOffset) > 0 || altitudeAt(endOffset) > 0;

  return {
    kind: centralHere ? (best.totality ? "total" : "annular") : "partial",
    obscurationFraction: best.obscuration,
    peakUtc: instant(bestOffset),
    partialBeginUtc: instant(beginOffset),
    partialEndUtc: instant(endOffset),
    centralBeginUtc: centralHere ? instant(edge(-1, isCentral)) : null,
    centralEndUtc: centralHere ? instant(edge(1, isCentral)) : null,
    sunAltitudeAtPeakDeg: best.sunAltitudeDeg,
    visibleFromHere,
    distanceToCentralLineKm,
  };
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
