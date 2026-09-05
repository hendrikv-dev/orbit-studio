import { Body, Equator, Horizon, Illumination, MakeTime, Observer } from "astronomy-engine";
import { DETECTION_FLOOR } from "./lightPollution";
import { limitingMagnitude } from "./meteorActivity";

/**
 * Whether a person could reasonably see this, with their eyes, from here.
 *
 * ## The rule this exists to enforce
 *
 * Being above the horizon is not being visible. Tracker's default rail is a
 * list of things somebody can go outside and actually see, and "geometrically
 * up" admits a great deal that nobody can: Uranus at magnitude 5.8 from a
 * suburb, Neptune from anywhere, a deep-sky object that needs a telescope, a
 * planet four degrees above the treeline in the last of the twilight. Each of
 * those is genuinely in the sky and none of them belongs in an answer to "what
 * can I see tonight".
 *
 * ## How it decides
 *
 * By comparing what the target is doing against what the sky will allow:
 *
 *   apparent magnitude + extinction at that altitude  ≤  limiting magnitude − margin
 *
 * The limiting magnitude starts from `limitingMagnitude` in `meteorActivity`,
 * which is already calibrated against twilight and moonlight anchors and used
 * for meteor rates — one model, not a second one that could disagree with it —
 * and then loses more to artificial light and to the air the target is being
 * seen through.
 *
 * ## What it deliberately does not consider
 *
 * Cloud. It is the difference between a good night and a bad one, not between
 * an opportunity and none: a clouded-out Saturn is still the thing worth
 * looking for tonight, and the conditions row says the sky may be closed. Making
 * admission depend on a forecast would also make a night's list change every
 * time the forecast refreshed, and would quietly claim a confidence that a
 * cloud forecast four days out cannot support. Weather changes how good an
 * opportunity is; it does not create or destroy one. That is the same rule the
 * eligibility stage already follows.
 */

/** What the sky is doing at the moment being judged. */
export interface SkyConditions {
  sunAltitudeDeg: number;
  moonAltitudeDeg: number;
  moonIlluminatedFraction: number;
  /**
   * Upward artificial radiance at the observer, in nW/cm²/sr, or null.
   *
   * Null is a real answer — the archive may not have loaded, or the reader may
   * be somewhere it does not cover — and null means "no penalty", which is the
   * conservative direction: it admits an opportunity rather than removing one
   * on the strength of a number Tracker does not have.
   */
  artificialLightRadiance: number | null;
}

/**
 * Magnitudes lost to artificial light on the ground.
 *
 * ## Why this is a calibration and not a sky-brightness model
 *
 * Turning upward radiance into sky brightness properly needs the scattering of
 * that light through the air above the observer, which depends on aerosol load,
 * humidity, altitude and spectrum. Tracker does not have that model and says so
 * everywhere it reports light pollution: no Bortle class, no SQM figure, no
 * limiting magnitude on screen.
 *
 * This is used to *admit or withhold*, never to display. It is anchored at two
 * ends that are not in dispute — a site at the detection floor loses nothing,
 * and a city core at the top of the archive's useful range loses about three
 * magnitudes, which is the difference between a sky showing six and a half and
 * a sky showing three and a half — and interpolated logarithmically because
 * radiance spans four orders of magnitude. Between the anchors it is an
 * estimate, so the margin below is generous and the penalty is capped.
 */
const ARTIFICIAL_LIGHT_CEILING = 64;
const ARTIFICIAL_LIGHT_MAX_LOSS = 3;

export function artificialLightLoss(radiance: number | null): number {
  if (radiance === null || radiance < DETECTION_FLOOR) return 0;
  const span = Math.log10(ARTIFICIAL_LIGHT_CEILING / DETECTION_FLOOR);
  const into = Math.log10(radiance / DETECTION_FLOOR) / span;
  return Math.min(ARTIFICIAL_LIGHT_MAX_LOSS, ARTIFICIAL_LIGHT_MAX_LOSS * Math.max(0, into));
}

/**
 * Magnitudes lost to the air between the observer and the target.
 *
 * A star at the zenith is seen through one airmass; one at 10° is seen through
 * about five and a half. At a typical extinction coefficient of 0.28 magnitudes
 * per airmass that is 0.28 at the top of the sky and about 1.5 at 10°, rising
 * steeply below that — which is why "it is up" and "you can see it" part company
 * near the horizon. Airmass uses Kasten and Young's 1989 formula rather than
 * `1/sin(h)`, which diverges exactly where the answer matters.
 */
const EXTINCTION_PER_AIRMASS = 0.28;

export function extinctionAt(altitudeDeg: number): number {
  if (altitudeDeg <= 0) return Number.POSITIVE_INFINITY;
  const h = Math.max(altitudeDeg, 0.5);
  const airmass = 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
  return EXTINCTION_PER_AIRMASS * airmass;
}

/**
 * The faintest thing the unaided eye can reasonably pick out here, tonight.
 *
 * "Reasonably" is the whole point and is why the margin exists. A target
 * exactly at the limiting magnitude is a target an experienced observer can
 * hold with averted vision from a known position after twenty minutes of dark
 * adaptation. It is not something to put in a list headed "what you can see
 * tonight". A magnitude of headroom is the difference between a detection and a
 * sight.
 */
export const NAKED_EYE_MARGIN = 1;

export interface SkyLimit {
  /** Faintest magnitude visible at the zenith, after twilight, Moon and light. */
  magnitude: number;
  /** The dark-sky value before artificial light, for explanation. */
  darkSky: number;
  artificialLoss: number;
}

export function skyLimit(sky: SkyConditions): SkyLimit {
  const darkSky = limitingMagnitude(
    sky.sunAltitudeDeg,
    sky.moonAltitudeDeg,
    sky.moonIlluminatedFraction,
  );
  const artificialLoss = artificialLightLoss(sky.artificialLightRadiance);
  return { magnitude: darkSky - artificialLoss, darkSky, artificialLoss };
}

export interface NakedEyeTarget {
  /** Apparent magnitude at the moment being judged. Null where unknown. */
  apparentMagnitude: number | null;
  /** Altitude above the true horizon, in degrees. */
  altitudeDeg: number;
  /**
   * Degrees of terrain standing in that direction, where it has been measured.
   *
   * A ridge does not make a target fainter, it makes it absent, so this is a
   * separate test rather than another term in the sum.
   */
  terrainHorizonDeg?: number | null;
}

export interface NakedEyeVerdict {
  visible: boolean;
  /** Tracker's own words for why, used where the absence has to be explained. */
  reason: string;
  /**
   * How much brighter than the threshold it is, in magnitudes.
   *
   * Positive is visible with room to spare; negative is how far short it falls.
   * Null where the target has no magnitude and the verdict rests on geometry.
   */
  headroom: number | null;
}

/**
 * Can a person reasonably see this, with their eyes, from here, tonight?
 *
 * The order of the tests is the order the reasons should be given in: below the
 * horizon is not a brightness problem, and behind a ridge is not one either.
 */
export function nakedEyeVerdict(target: NakedEyeTarget, sky: SkyConditions): NakedEyeVerdict {
  if (target.altitudeDeg <= 0) {
    return { visible: false, reason: "It is below the horizon at the time this is about.", headroom: null };
  }
  if (
    target.terrainHorizonDeg !== null &&
    target.terrainHorizonDeg !== undefined &&
    target.altitudeDeg <= target.terrainHorizonDeg
  ) {
    return {
      visible: false,
      reason: `The ground stands ${target.terrainHorizonDeg.toFixed(1)}° high in that direction, and it does not clear it.`,
      headroom: null,
    };
  }

  /**
   * No magnitude is not a failure.
   *
   * A meteor shower has a rate rather than a brightness, and an eclipse is an
   * event rather than an object. Those are admitted on their own terms by the
   * rules that understand them; this one has nothing to say about them and says
   * nothing rather than excluding them for lacking a number they never had.
   */
  if (target.apparentMagnitude === null) {
    return { visible: true, reason: "Judged on its own terms rather than on brightness.", headroom: null };
  }

  const limit = skyLimit(sky);
  const seen = target.apparentMagnitude + extinctionAt(target.altitudeDeg);
  const headroom = limit.magnitude - NAKED_EYE_MARGIN - seen;

  if (headroom >= 0) {
    return { visible: true, reason: "Bright enough to see with your eyes from here tonight.", headroom };
  }
  if (target.altitudeDeg < 15 && target.apparentMagnitude + NAKED_EYE_MARGIN <= limit.magnitude) {
    return {
      visible: false,
      reason: `Too low to see with the naked eye tonight: at ${Math.round(target.altitudeDeg)}° it is dimmed by the air near the horizon.`,
      headroom,
    };
  }
  if (limit.artificialLoss >= 1) {
    return {
      visible: false,
      reason: "Too faint to pick out with your eyes under this much artificial light.",
      headroom,
    };
  }
  return {
    visible: false,
    reason: "Too faint to see with your eyes alone tonight.",
    headroom,
  };
}

/**
 * The sky's own state at one place and one instant.
 *
 * Computed here rather than threaded through the ranking, because the three
 * numbers it needs — where the Sun is, where the Moon is, how lit the Moon is —
 * are cheap and are exactly the inputs the limiting magnitude already takes.
 * Artificial light is passed in because it comes from an archive that may not
 * have loaded, and "not known" has to stay distinguishable from "none".
 */
export function skyConditionsAt(
  latitudeDeg: number,
  longitudeDeg: number,
  atUtc: string,
  artificialLightRadiance: number | null,
): SkyConditions {
  const time = MakeTime(new Date(atUtc));
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const altitudeOf = (body: Body) => {
    const equator = Equator(body, time, observer, true, true);
    return Horizon(time, observer, equator.ra, equator.dec, "normal").altitude;
  };
  return {
    sunAltitudeDeg: altitudeOf(Body.Sun),
    moonAltitudeDeg: altitudeOf(Body.Moon),
    moonIlluminatedFraction: Illumination(Body.Moon, time).phase_fraction,
    artificialLightRadiance,
  };
}
