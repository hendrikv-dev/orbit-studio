import { Body, Equator, MakeTime, Observer } from "astronomy-engine";
import * as satellite from "satellite.js";

import { extinctionAt, skyLimit, NAKED_EYE_MARGIN, type SkyConditions } from "./nakedEye";

/**
 * Whether a spacecraft passing overhead is something a person could see.
 *
 * ## The one rule this file exists to keep
 *
 * **Brightness is measured, never derived.** A two-line element set says where
 * something is, and nothing whatever about how much light it reflects — an
 * object's size, shape, attitude and surface finish are what decide that, and
 * none of them is in a TLE. So every magnitude here starts from a published
 * observation of that object, and geometry is only ever allowed to *scale* it:
 * further away is fainter by the inverse square, a thinner crescent is fainter
 * by its illuminated fraction, lower in the sky is fainter by the air in the
 * way. An object with no observed brightness is not offered at all.
 *
 * ## And a standard magnitude is only the starting point
 *
 * A catalogue's standard magnitude is the object at one particular geometry:
 * a thousand kilometres away, half lit. A real pass is none of those things.
 * What decides whether the reader sees anything is that baseline carried
 * through the actual slant range, the actual phase angle, whether the thing is
 * even in sunlight at the time, the air it is being seen through, and how dark
 * the sky is where they are standing. All five are applied here, and the last
 * two are `nakedEye`'s — the same limiting-magnitude model the rest of Tracker
 * ranks with, rather than a second one that could disagree with it.
 */

const EARTH_RADIUS_KM = 6378.137;

/**
 * The height of the air that counts as part of the Earth for shadow purposes.
 *
 * Sunlight grazing the limb is reddened and heavily dimmed long before the
 * geometric shadow, so treating the solid Earth as the occulter puts the end of
 * a pass minutes late. Ninety kilometres is the usual allowance and is the
 * conservative direction here: it ends the pass sooner rather than promising
 * light that has already gone.
 */
const ATMOSPHERE_KM = 90;

/** Mean angular radius of the Sun seen from Earth, which is what makes the shadow a cone. */
const SUN_ANGULAR_RADIUS_DEG = 0.2666;

const AU_KM = 149_597_870.7;

export type Illumination = "sunlit" | "penumbra" | "umbra";

export interface SatelliteState {
  /** Above the true horizon, in degrees. Negative when below it. */
  altitudeDeg: number;
  azimuthDeg: number;
  /** Observer to spacecraft, in kilometres. */
  rangeKm: number;
  /** Height above the ellipsoid, in kilometres. */
  heightKm: number;
  /** Sun–spacecraft–observer angle, in degrees. */
  phaseAngleDeg: number;
  illumination: Illumination;
}

/* ------------------------------------------------------------- geometry */

const toRad = Math.PI / 180;

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a: readonly number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * The Sun's direction and distance in the same Earth-fixed frame as the orbit.
 *
 * SGP4 produces TEME, which `eciToEcf` rotates to Earth-fixed with Greenwich
 * sidereal time. Putting the Sun in that same frame — from its right ascension
 * and declination of date, less the same sidereal angle — means the shadow test
 * and the phase angle are computed between two vectors that actually share a
 * frame, which is the part that is easy to get silently wrong.
 */
/**
 * Where the Sun is, cached by the minute — but only the expensive half.
 *
 * A pass is sampled every ten seconds and a night holds four thousand samples,
 * so asking the ephemeris for the Sun at each of them is most of the cost of
 * predicting a night, on a main thread that also has a map on it. Its right
 * ascension and declination move a fortieth of a degree in a minute, which is
 * four orders of magnitude smaller than the shadow boundary this feeds.
 *
 * The rotation into the Earth-fixed frame is *not* cached, because sidereal
 * time moves a quarter of a degree a minute — thirty kilometres at this
 * altitude, which is exactly the scale a shadow entry is decided on. It is a
 * cosine and a sine, and it is computed for every sample.
 */
const sunCache = new Map<number, { raRad: number; decRad: number; distanceKm: number }>();

function sunEquatorial(when: Date): { raRad: number; decRad: number; distanceKm: number } {
  const minute = Math.floor(when.getTime() / 60_000);
  const cached = sunCache.get(minute);
  if (cached) return cached;
  if (sunCache.size > 4096) sunCache.clear();
  const equator = Equator(Body.Sun, MakeTime(new Date(minute * 60_000)), new Observer(0, 0, 0), true, true);
  const computed = {
    raRad: equator.ra * 15 * toRad,
    decRad: equator.dec * toRad,
    distanceKm: equator.dist * AU_KM,
  };
  sunCache.set(minute, computed);
  return computed;
}

export function sunEcef(when: Date): { unit: [number, number, number]; distanceKm: number } {
  const { raRad, decRad, distanceKm } = sunEquatorial(when);
  const hourAngle = raRad - satellite.gstime(when);
  return {
    unit: [
      Math.cos(decRad) * Math.cos(hourAngle),
      Math.cos(decRad) * Math.sin(hourAngle),
      Math.sin(decRad),
    ],
    distanceKm,
  };
}

/**
 * Whether the spacecraft is in sunlight, in the Earth's penumbra, or its umbra.
 *
 * A cone rather than a cylinder, because the Sun is not a point: behind the
 * Earth the full shadow narrows and a partial one widens, and a spacecraft in
 * the penumbra is lit by a fraction of the solar disc. Tracker treats the
 * penumbra as not lit — it is the boundary of a pass, the brightness there is
 * changing by the second, and "uncertain" is not a thing to put in a list of
 * what somebody can go outside and see.
 */
export function illuminationOf(
  positionEcefKm: readonly [number, number, number],
  sun: { unit: readonly [number, number, number]; distanceKm: number },
): Illumination {
  const along = dot(positionEcefKm, sun.unit);
  // On the sunward side of the terminator plane there is nothing in the way.
  if (along >= 0) return "sunlit";

  const behind = -along;
  const perpendicular = Math.sqrt(Math.max(0, dot(positionEcefKm, positionEcefKm) - along * along));
  const occulter = EARTH_RADIUS_KM + ATMOSPHERE_KM;

  // Half-angles of the two cones, from the Sun's angular size at this distance.
  const sunRadiusKm = sun.distanceKm * Math.tan(SUN_ANGULAR_RADIUS_DEG * toRad);
  const umbraSlope = (sunRadiusKm - occulter) / sun.distanceKm;
  const penumbraSlope = (sunRadiusKm + occulter) / sun.distanceKm;

  const umbraRadius = occulter - behind * umbraSlope;
  const penumbraRadius = occulter + behind * penumbraSlope;

  if (perpendicular < umbraRadius) return "umbra";
  if (perpendicular < penumbraRadius) return "penumbra";
  return "sunlit";
}

/* ---------------------------------------------------------- photometry */

/**
 * The observed baseline carried to the geometry of this pass.
 *
 * The convention is the one the amateur satellite catalogues use: a standard
 * magnitude is what the object measures at a range of 1000 km, half lit. The
 * relation below is that definition rearranged, so at 1000 km and a phase angle
 * of 90° it returns the standard magnitude unchanged, and everything else is
 * the inverse-square law and the illuminated fraction of a sphere.
 *
 * The illuminated fraction is the crescent-phase term — the same one that makes
 * a gibbous Moon brighter than a quarter Moon. It is a model of a diffuse
 * sphere, which a solar array is not, so it is right about the shape of the
 * curve and approximate about its depth. That is why nothing is admitted on a
 * thin margin.
 */
const STANDARD_RANGE_KM = 1000;
const STANDARD_FRACTION = 0.5;
/**
 * Written as the definition rather than as the rounded constant it evaluates to.
 *
 * The usual form of this relation carries a literal −15.75, which is this
 * expression to two decimals and leaves the identity three thousandths of a
 * magnitude out. Harmless in a prediction and not harmless in the test that
 * proves the convention is the one being claimed.
 */
const STANDARD_OFFSET =
  -2.5 * Math.log10((STANDARD_RANGE_KM * STANDARD_RANGE_KM) / STANDARD_FRACTION);

/**
 * The two shapes a published brightness comes in, which are not interchangeable.
 *
 * A **standard magnitude** has been normalised to a stated geometry — 1000 km,
 * half lit — so range and phase can both be applied to it, because both were
 * taken out. A **distance-adjusted population mean** has had range taken out and
 * phase left in: applying a phase function to it would count phase twice, and
 * what comes out of it is where the middle of a population sits rather than a
 * prediction for one object on one pass.
 *
 * Keeping them apart in the type is the point. They are both "a magnitude" and
 * they mean different things, and the difference is exactly the kind that
 * disappears into a shared number and is never seen again.
 */
export type Photometry =
  | { kind: "standard"; standardMagnitude: number }
  | { kind: "distance-adjusted"; magnitudeAt1000Km: number };

export function magnitudeFor(
  photometry: Photometry,
  rangeKm: number,
  phaseAngleDeg: number,
): number | null {
  if (photometry.kind === "standard") {
    return apparentMagnitude(photometry.standardMagnitude, rangeKm, phaseAngleDeg);
  }
  if (rangeKm <= 0) return null;
  // Range only. The phase distribution is already inside the published mean.
  return photometry.magnitudeAt1000Km + 5 * Math.log10(rangeKm / STANDARD_RANGE_KM);
}

export function apparentMagnitude(
  standardMagnitude: number,
  rangeKm: number,
  phaseAngleDeg: number,
): number | null {
  const fraction = (1 + Math.cos(phaseAngleDeg * toRad)) / 2;
  // A spacecraft seen exactly against the Sun shows no lit face at all. There
  // is no magnitude to report rather than an arbitrarily large one.
  if (fraction <= 0.0001 || rangeKm <= 0) return null;
  return standardMagnitude + STANDARD_OFFSET + 2.5 * Math.log10((rangeKm * rangeKm) / fraction);
}

/* -------------------------------------------------------------- passes */

export interface ObserverSite {
  latitudeDeg: number;
  longitudeDeg: number;
  /** Metres above the ellipsoid. Zero is a fine default; it moves nothing here. */
  elevationM?: number;
}

/**
 * Where a spacecraft is, and how it is lit, seen from one place at one moment.
 *
 * Returns null when the element set cannot be propagated to that time, which
 * SGP4 reports for orbits it has decayed out of — a real answer, and one that
 * has to travel rather than be replaced with a guess.
 */
export function stateAt(
  satrec: satellite.SatRec,
  site: ObserverSite,
  when: Date,
): SatelliteState | null {
  const propagated = satellite.propagate(satrec, when);
  const position = propagated?.position;
  if (!position || typeof position === "boolean") return null;

  const gmst = satellite.gstime(when);
  const ecef = satellite.eciToEcf(position, gmst);
  const observerGd = {
    longitude: site.longitudeDeg * toRad,
    latitude: site.latitudeDeg * toRad,
    height: (site.elevationM ?? 0) / 1000,
  };
  const look = satellite.ecfToLookAngles(observerGd, ecef);
  const geodetic = satellite.eciToGeodetic(position, gmst);

  const satVector: [number, number, number] = [ecef.x, ecef.y, ecef.z];
  const observerEcef = satellite.geodeticToEcf(observerGd);
  const sun = sunEcef(when);

  // Sun and observer as seen from the spacecraft. The Sun is far enough away
  // that its direction from there and from the Earth are the same to well
  // inside a hundredth of a degree.
  const toObserver: [number, number, number] = [
    observerEcef.x - satVector[0],
    observerEcef.y - satVector[1],
    observerEcef.z - satVector[2],
  ];
  const cosPhase = dot(sun.unit, toObserver) / (norm(toObserver) || 1);
  const phaseAngleDeg = Math.acos(Math.max(-1, Math.min(1, cosPhase))) / toRad;

  return {
    altitudeDeg: look.elevation / toRad,
    azimuthDeg: ((look.azimuth / toRad) % 360 + 360) % 360,
    rangeKm: look.rangeSat,
    heightKm: geodetic.height,
    phaseAngleDeg,
    illumination: illuminationOf(satVector, sun),
  };
}

export interface PassSample {
  atUtc: string;
  altitudeDeg: number;
  azimuthDeg: number;
  rangeKm: number;
  heightKm: number;
  phaseAngleDeg: number;
  illumination: Illumination;
  /** Brightness after range and phase, before the air. Null where unknown. */
  apparentMagnitude: number | null;
  /** Brightness as it arrives, after extinction at this altitude. */
  seenMagnitude: number | null;
  /** How far below the sky's threshold it is here. Positive is visible. */
  headroom: number | null;
}

export interface Pass {
  startUtc: string;
  endUtc: string;
  /** The moment the pass is at its best, which is not always its highest. */
  bestUtc: string;
  peakAltitudeDeg: number;
  /** Compass direction at the best moment. */
  bestAzimuthDeg: number;
  brightestMagnitude: number | null;
  samples: PassSample[];
  /** True where every sample is lit and above the horizon at once. */
  visible: boolean;
  /** Smallest margin the verdict rests on, for the withholding rule. */
  bestHeadroom: number | null;
}

export interface PassOptions {
  startUtc: string;
  endUtc: string;
  /** Seconds between samples. Ten is fine: a pass lasts minutes. */
  stepSeconds?: number;
  /**
   * How high the spacecraft has to climb before a pass counts.
   *
   * Ten degrees, because below that a low pass is a fist above the roofline,
   * behind whatever is there, and through three or more airmasses.
   */
  minimumAltitudeDeg?: number;
  /** What the sky is doing, sampled across the window. */
  skyAt: (when: Date) => SkyConditions;
  /**
   * How much brighter than the threshold a pass has to be before it is offered.
   *
   * Added to `NAKED_EYE_MARGIN`, and this is where a source's own uncertainty
   * goes: a population mean is not a promise about one pass.
   */
  uncertaintyMargin?: number;
}

/**
 * Every pass of one spacecraft over one place in a window.
 *
 * Sampled rather than solved. A closed-form rise/set for a low orbit is a root
 * find against a function that is not monotonic, and the answer is wanted to
 * the nearest minute rather than the nearest second — the reader is going
 * outside, not pointing a telescope.
 */
export function passesFor(
  /**
   * The element set to use for a given moment.
   *
   * A function rather than a single set, because the best available orbit for
   * the ISS is a segmented ephemeris: sixty short-arc fits at six-hour
   * intervals. Propagating the first of them across a fortnight would throw
   * away the other fifty-nine.
   */
  satrecAt: (when: Date) => satellite.SatRec | null,
  photometry: Photometry | null,
  site: ObserverSite,
  options: PassOptions,
): Pass[] {
  const step = (options.stepSeconds ?? 10) * 1000;
  const floor = options.minimumAltitudeDeg ?? 10;
  const margin = NAKED_EYE_MARGIN + (options.uncertaintyMargin ?? 0);
  const start = Date.parse(options.startUtc);
  const end = Date.parse(options.endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const passes: Pass[] = [];
  let current: PassSample[] = [];

  const close = () => {
    if (current.length === 0) return;
    const above = current.filter((sample) => sample.altitudeDeg >= floor);
    if (above.length > 0) {
      /**
       * The best moment is the brightest one, not the highest.
       *
       * They part company often: a pass that climbs to eighty degrees can be at
       * its brightest on the way up, while the phase angle is still small and
       * the spacecraft is showing a fuller face. The reader is being told when
       * to look, so it is the brightest that matters.
       */
      const lit = above.filter((sample) => sample.headroom !== null);
      const best =
        lit.length > 0
          ? lit.reduce((a, b) => ((b.headroom ?? -Infinity) > (a.headroom ?? -Infinity) ? b : a))
          : above.reduce((a, b) => (b.altitudeDeg > a.altitudeDeg ? b : a));
      const peak = above.reduce((a, b) => (b.altitudeDeg > a.altitudeDeg ? b : a));
      const bestHeadroom = lit.length > 0 ? Math.max(...lit.map((s) => s.headroom ?? -Infinity)) : null;
      passes.push({
        startUtc: above[0].atUtc,
        endUtc: above[above.length - 1].atUtc,
        bestUtc: best.atUtc,
        peakAltitudeDeg: peak.altitudeDeg,
        bestAzimuthDeg: best.azimuthDeg,
        brightestMagnitude:
          lit.length > 0 ? Math.min(...lit.map((s) => s.apparentMagnitude ?? Infinity)) : null,
        samples: above,
        visible: bestHeadroom !== null && bestHeadroom >= 0,
        bestHeadroom,
      });
    }
    current = [];
  };

  for (let at = start; at <= end; at += step) {
    const when = new Date(at);
    const satrec = satrecAt(when);
    const state = satrec ? stateAt(satrec, site, when) : null;
    if (!state || state.altitudeDeg < 0) {
      close();
      continue;
    }

    /**
     * Only a lit spacecraft has a magnitude.
     *
     * In shadow it is not faint, it is gone — which is exactly what a reader
     * watching the ISS disappear halfway across the sky sees. Reporting a
     * magnitude there would be reporting reflected sunlight that is not
     * arriving.
     */
    const magnitude =
      photometry !== null && state.illumination === "sunlit"
        ? magnitudeFor(photometry, state.rangeKm, state.phaseAngleDeg)
        : null;
    const extinction = extinctionAt(state.altitudeDeg);
    const seen = magnitude === null ? null : magnitude + extinction;
    const limit = skyLimit(options.skyAt(when));
    const headroom =
      seen === null || !Number.isFinite(seen) ? null : limit.magnitude - margin - seen;

    current.push({
      atUtc: when.toISOString(),
      altitudeDeg: state.altitudeDeg,
      azimuthDeg: state.azimuthDeg,
      rangeKm: state.rangeKm,
      heightKm: state.heightKm,
      phaseAngleDeg: state.phaseAngleDeg,
      illumination: state.illumination,
      apparentMagnitude: magnitude,
      seenMagnitude: seen,
      headroom,
    });
  }
  close();
  return passes;
}
