import {
  Body,
  Equator,
  EquatorFromVector,
  GeoMoon,
  Horizon,
  MakeTime,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  SiderealTime,
  type LunarEclipseInfo,
} from "astronomy-engine";
import {
  minutes,
  minutesToMilliseconds,
  offsetUtc,
  subtractUtc,
  utcInstant,
  type Minutes,
  type UtcInstant,
} from "./scientificUnits";

export interface EclipseContactPair {
  startUtc: UtcInstant;
  endUtc: UtcInstant;
  durationMinutes: Minutes;
}

export interface LunarEclipseTiming {
  /** Astronomy Engine computes eclipse circumstances in UTC/UT. */
  timeScale: "UTC";
  maximumUtc: UtcInstant;
  penumbral: EclipseContactPair;
  partial: EclipseContactPair | null;
  totality: EclipseContactPair | null;
  /** The phase a user can reasonably be asked to watch for this eclipse kind. */
  observablePhase: EclipseContactPair;
}

function contacts(maximumUtc: UtcInstant, semiDurationMinutes: number): EclipseContactPair {
  const semi = minutes(semiDurationMinutes);
  const offset = minutesToMilliseconds(semi);
  return {
    startUtc: subtractUtc(maximumUtc, offset),
    endUtc: offsetUtc(maximumUtc, offset),
    durationMinutes: minutes(Number(semi) * 2),
  };
}

/**
 * Normalizes Astronomy Engine's semi-duration fields at the dependency edge.
 * Every `sd_*` field is minutes, not hours, and is half the corresponding phase.
 */
export function lunarEclipseTiming(eclipse: LunarEclipseInfo): LunarEclipseTiming {
  const maximumUtc = utcInstant(eclipse.peak.date);
  const penumbral = contacts(maximumUtc, eclipse.sd_penum);
  const partial = eclipse.sd_partial > 0 ? contacts(maximumUtc, eclipse.sd_partial) : null;
  const totality = eclipse.sd_total > 0 ? contacts(maximumUtc, eclipse.sd_total) : null;
  return {
    timeScale: "UTC",
    maximumUtc,
    penumbral,
    partial,
    totality,
    observablePhase: partial ?? penumbral,
  };
}

/* ------------------------------------------------------------ horizon helpers */

function moonAltitudeDeg(at: Date, latitudeDeg: number, longitudeDeg: number): number {
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const time = MakeTime(at);
  const equator = Equator(Body.Moon, time, observer, true, true);
  return Horizon(time, observer, equator.ra, equator.dec, "normal").altitude;
}

/* ------------------------------------------------- horizon geometry, properly */

/**
 * Where the Moon stands overhead, and how far from there it can still be seen.
 *
 * ## Why the previous map was wrong
 *
 * The first version sampled `visibleFraction` on a five-degree grid and filled
 * each cell. That is a defensible way to *measure* visibility and a bad way to
 * draw it: the boundary between "you see all of it" and "you see none of it" is
 * a smooth curve on the Earth, and a five-degree raster renders it as a
 * staircase of blocks whose edges are artefacts of the sampling rather than
 * facts about the eclipse. It looked like a decorative gradient, which is
 * exactly what it must not look like.
 *
 * ## What replaces it
 *
 * The real structure. A lunar eclipse is visible wherever the Moon is above the
 * horizon, and at any instant that is a *cap* on the sphere centred on the
 * sub-lunar point — the place with the Moon at the zenith. Its edge is a circle
 * slightly wider than 90°, because the Moon's horizontal parallax puts it a
 * little lower than geometry alone would say and refraction lifts it a little
 * higher than that.
 *
 * So instead of sampling altitudes over a grid, this computes the sub-lunar
 * point and the limiting radius at each contact, and everything else follows
 * from great-circle distance. Boundaries become curves, classification becomes
 * exact, and the whole field costs trigonometry rather than tens of thousands
 * of ephemeris evaluations.
 */
export interface SublunarCap {
  atUtc: string;
  latitudeDeg: number;
  longitudeDeg: number;
  /** Angular radius at which the Moon's computed altitude reaches zero. */
  radiusDeg: number;
}

const DEG = Math.PI / 180;

/** The point with the Moon at the zenith, from the geocentric position. */
export function sublunarPoint(at: Date): { latitudeDeg: number; longitudeDeg: number } {
  const time = MakeTime(at);
  const moon = GeoMoon(time);
  // GeoMoon is in EQJ; the sub-lunar point is defined against the equator and
  // meridian of date, so the vector has to be rotated before it is read as one.
  const ofDate = RotateVector(Rotation_EQJ_EQD(time), moon);
  const equatorial = EquatorFromVector(ofDate);
  const longitudeDeg = ((equatorial.ra - SiderealTime(time)) * 15 + 540) % 360 - 180;
  return { latitudeDeg: equatorial.dec, longitudeDeg };
}

/** Great-circle separation in degrees. */
export function angularSeparationDeg(
  aLatDeg: number,
  aLonDeg: number,
  bLatDeg: number,
  bLonDeg: number,
): number {
  const φ1 = aLatDeg * DEG;
  const φ2 = bLatDeg * DEG;
  const Δλ = (bLonDeg - aLonDeg) * DEG;
  const cosine =
    Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return Math.acos(Math.min(1, Math.max(-1, cosine))) / DEG;
}

/**
 * The cap of the Earth that can see the Moon at an instant.
 *
 * The radius is found rather than assumed. Bisecting the same `moonAltitudeDeg`
 * the local circumstances use means the map's boundary and the reader's own
 * answer come from one function: a place drawn just inside the edge is a place
 * the altitude calculation also calls visible.
 */
export function sublunarCap(at: Date): SublunarCap {
  const centre = sublunarPoint(at);
  // Walk south from the sub-lunar point along its own meridian. Altitude falls
  // monotonically with angular distance, so one bisection settles the edge.
  const altitudeAt = (distanceDeg: number) => {
    const latitudeDeg = centre.latitudeDeg - distanceDeg;
    // Past the pole the meridian continues on the far side.
    const wrapped =
      latitudeDeg < -90
        ? { lat: -180 - latitudeDeg, lon: centre.longitudeDeg + 180 }
        : { lat: latitudeDeg, lon: centre.longitudeDeg };
    return moonAltitudeDeg(at, wrapped.lat, ((wrapped.lon + 540) % 360) - 180);
  };

  let low = 80;
  let high = 100;
  for (let index = 0; index < 24; index += 1) {
    const mid = (low + high) / 2;
    if (altitudeAt(mid) > 0) low = mid;
    else high = mid;
  }
  return {
    atUtc: new Date(at).toISOString(),
    latitudeDeg: centre.latitudeDeg,
    longitudeDeg: centre.longitudeDeg,
    radiusDeg: (low + high) / 2,
  };
}

/** Points along a cap's edge, for drawing it as a curve rather than a staircase. */
export function capOutline(cap: SublunarCap, steps = 180): { latitudeDeg: number; longitudeDeg: number }[] {
  const φ1 = cap.latitudeDeg * DEG;
  const λ1 = cap.longitudeDeg * DEG;
  const δ = cap.radiusDeg * DEG;
  const points: { latitudeDeg: number; longitudeDeg: number }[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const θ = (index / steps) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
      );
    points.push({
      latitudeDeg: φ2 / DEG,
      longitudeDeg: (((λ2 / DEG) + 540) % 360) - 180,
    });
  }
  return points;
}

/**
 * What a place actually sees, in the terms a reader needs.
 *
 * The three cases are different observing situations, not three points on a
 * gradient: seeing all of it, watching the Moon rise or set part-way through,
 * and not seeing it at all. Which of the two partial cases applies is decided
 * by whether the Moon is up at the start or at the end, so the answer says
 * "moonrise" or "moonset" rather than a fraction the reader has to interpret.
 */
export type LunarVisibilityBand = "all" | "moonrise" | "moonset" | "none";

export interface LunarLocalVisibility {
  band: LunarVisibilityBand;
  /** Fraction of the observable phase with the Moon above the horizon. */
  visibleFraction: number;
  altitudeAtMaximumDeg: number;
  /** When the Moon crosses the horizon mid-eclipse, where it does. */
  horizonCrossingUtc: string | null;
}

/**
 * Local circumstances from the eclipse's own contact times.
 *
 * Uses the exact altitude — topocentric, refracted — rather than the cap
 * approximation, because this is the answer shown to the reader about their own
 * location and it costs a handful of evaluations rather than thousands.
 */
export function lunarLocalVisibility(
  timing: LunarEclipseTiming,
  latitudeDeg: number,
  longitudeDeg: number,
  samples = 33,
): LunarLocalVisibility {
  const start = Date.parse(timing.observablePhase.startUtc);
  const end = Date.parse(timing.observablePhase.endUtc);
  const upAt = (fraction: number) =>
    moonAltitudeDeg(new Date(start + (end - start) * fraction), latitudeDeg, longitudeDeg) > 0;

  let up = 0;
  for (let index = 0; index < samples; index += 1) up += upAt(index / (samples - 1)) ? 1 : 0;

  const atStart = upAt(0);
  const atEnd = upAt(1);
  const band: LunarVisibilityBand =
    atStart && atEnd ? (up === samples ? "all" : "moonrise") : atStart ? "moonset" : atEnd ? "moonrise" : up > 0 ? "moonrise" : "none";

  // The crossing itself, where there is one, bisected on the same predicate so
  // the time reported is the time the classification used.
  let horizonCrossingUtc: string | null = null;
  if (atStart !== atEnd) {
    let low = 0;
    let high = 1;
    for (let index = 0; index < 30; index += 1) {
      const mid = (low + high) / 2;
      if (upAt(mid) === atStart) low = mid;
      else high = mid;
    }
    horizonCrossingUtc = new Date(start + (end - start) * ((low + high) / 2)).toISOString();
  }

  return {
    band,
    visibleFraction: up / samples,
    altitudeAtMaximumDeg: moonAltitudeDeg(
      new Date(timing.maximumUtc),
      latitudeDeg,
      longitudeDeg,
    ),
    horizonCrossingUtc,
  };
}

/**
 * The whole geographic picture: three regions and the curves that bound them.
 *
 * Classification is by great-circle distance to each cap, which is why this can
 * afford a fine grid — the cost is trigonometry per cell rather than an
 * ephemeris evaluation. The caps themselves are the expensive part and there
 * are only as many of them as there are samples.
 */
export interface LunarGeographicVisibility {
  /** One cap per sampled instant across the observable phase. */
  caps: SublunarCap[];
  /** Start, maximum and end, the three a reader can reason about. */
  keyCaps: { start: SublunarCap; maximum: SublunarCap; end: SublunarCap };
  cells: { latitudeDeg: number; longitudeDeg: number; band: LunarVisibilityBand }[];
  stepDeg: number;
  bounds: { south: number; north: number; west: number; east: number };
}

export function lunarGeographicVisibility(
  timing: LunarEclipseTiming,
  bounds: { south: number; north: number; west: number; east: number },
  stepDeg = 2,
  capSamples = 9,
): LunarGeographicVisibility {
  const start = Date.parse(timing.observablePhase.startUtc);
  const end = Date.parse(timing.observablePhase.endUtc);
  const caps: SublunarCap[] = [];
  for (let index = 0; index < capSamples; index += 1) {
    caps.push(sublunarCap(new Date(start + ((end - start) * index) / (capSamples - 1))));
  }

  const cells: { latitudeDeg: number; longitudeDeg: number; band: LunarVisibilityBand }[] = [];
  for (let lat = bounds.south; lat <= bounds.north + 1e-9; lat += stepDeg) {
    for (let lon = bounds.west; lon <= bounds.east + 1e-9; lon += stepDeg) {
      const wrapped = ((lon + 540) % 360) - 180;
      let up = 0;
      for (const cap of caps) {
        if (angularSeparationDeg(lat, wrapped, cap.latitudeDeg, cap.longitudeDeg) <= cap.radiusDeg) {
          up += 1;
        }
      }
      const first =
        angularSeparationDeg(lat, wrapped, caps[0].latitudeDeg, caps[0].longitudeDeg) <=
        caps[0].radiusDeg;
      const last =
        angularSeparationDeg(
          lat,
          wrapped,
          caps[caps.length - 1].latitudeDeg,
          caps[caps.length - 1].longitudeDeg,
        ) <= caps[caps.length - 1].radiusDeg;
      const band: LunarVisibilityBand =
        up === caps.length ? "all" : up === 0 ? "none" : first && !last ? "moonset" : "moonrise";
      cells.push({ latitudeDeg: lat, longitudeDeg: lon, band });
    }
  }

  return {
    caps,
    keyCaps: {
      start: caps[0],
      maximum: sublunarCap(new Date(timing.maximumUtc)),
      end: caps[caps.length - 1],
    },
    cells,
    stepDeg,
    bounds,
  };
}
