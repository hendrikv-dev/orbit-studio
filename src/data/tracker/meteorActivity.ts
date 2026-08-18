import {
  Body,
  Ecliptic,
  Equator,
  EquatorFromVector,
  GeoVector,
  Horizon,
  Illumination,
  MakeTime,
  Observer,
  RotateVector,
  Rotation_ECL_EQJ,
  Rotation_EQJ_EQD,
  SearchSunLongitude,
  SunPosition,
  VectorFromSphere,
} from "astronomy-engine";
import type { ObservationPeriod } from "./observationPeriod";
import {
  METEOR_SHOWERS,
  SPORADIC_BACKGROUND,
  angularDifferenceDeg,
  isShowerActiveAt,
  type MeteorShower,
} from "./meteorShowers";

/**
 * What a person standing outside tonight can expect to see, rather than what a
 * shower's headline number says.
 *
 * V1 §7.2 is explicit that the zenithal hourly rate must not be presented as the
 * user's expected count, and V1 A5 requires the combined sky — every active
 * shower plus the sporadic background — with a realistic rate and help choosing
 * the best part of the night. ZHR is defined for a radiant at the zenith under a
 * 6.5-magnitude sky with the observer seeing the whole hemisphere. Nobody
 * observes under those conditions, and for a shower whose radiant barely clears
 * the horizon the difference is a factor of ten.
 *
 * ## What is modelled, and how well
 *
 * Three of the four corrections are ordinary astronomy and are as good as the
 * ephemeris:
 *
 * - **Radiant altitude.** The standard IMO reduction, `HR = ZHR · sin(h)`,
 *   inverted. It is known to overestimate below about 20°, and that is stated
 *   rather than silently patched.
 * - **Radiant drift.** A stream's radiant keeps a nearly fixed ecliptic
 *   longitude *relative to the Sun* across its activity period, so the radiant
 *   away from the peak is reconstructed by advancing it with the Sun. This is
 *   the standard `λ − λ☉` invariant, not an approximation invented here.
 * - **Activity profile.** The conventional exponential `ZHR · 10^(−B·Δλ☉)`, with
 *   B derived from the catalogue's peak width. The profile shape is standard;
 *   the width feeding it is editorial, and `meteorShowers.ts` says so.
 *
 * The fourth is a judgement calibration and is labelled as one everywhere it
 * surfaces:
 *
 * - **Limiting magnitude.** Twilight and moonlight both raise the sky
 *   background. The two curves here are fitted to stated anchors, not taken
 *   from a published photometric model, and their constants are visible below.
 *
 * ## What is not modelled
 *
 * Light pollution and cloud. Both are the difference between a good estimate and
 * a right one, and neither can be had without a dataset or a feed Tracker does
 * not have. They are reported as missing inputs (TRACKER_PRD R5.3 — rank without
 * it and say so) rather than assumed average, because assuming average would
 * quietly promise a suburban observer a dark-sky rate.
 */

/** The sky the zenithal hourly rate is defined against. */
const REFERENCE_LIMITING_MAGNITUDE = 6.5;

/** Below this Sun altitude meteor watching is not worthwhile at all. */
const USABLE_SUN_ALTITUDE_DEG = -6;

/** Mean motion of the Sun in ecliptic longitude, degrees per day. */
const SOLAR_LONGITUDE_RATE_DEG_PER_DAY = 0.9856;

const MS_PER_MINUTE = 60_000;
const SAMPLE_INTERVAL_MINUTES = 15;

/**
 * How far below the modelled rate the low end of the reported band sits.
 *
 * The band is deliberately one-sided. Everything this model leaves out — light
 * pollution, cloud, an obstructed horizon, an observer who blinks — can only
 * reduce what is seen; none of it can produce more meteors. So the modelled
 * number is a **ceiling** under a genuinely dark sky, and the band runs
 * downwards from it.
 *
 * A symmetric band was worse than wrong, it was flattering: it advertised up to
 * 233 Geminids an hour, a rate nobody has ever counted. The factor is a
 * judgement, not a confidence interval from a measurement, and nothing should
 * present it as one.
 */
const RATE_BAND_FACTOR = 2.5;

export interface ShowerContribution {
  code: string;
  name: string;
  /** Where its radiant is at this instant, from the observer. */
  radiantAltitudeDeg: number;
  radiantAzimuthDeg: number;
  /**
   * Where the radiant is across the whole period, one entry per sample.
   *
   * The single pair above is the radiant at the best moment, which is what the
   * rate estimate is built on. It is not enough to draw with: a radiant climbs
   * through the night, and that climb is most of why the rate changes. Drawing
   * one fixed point would state the opposite of what the activity curve beside
   * it is showing.
   */
  radiantTrack: { atUtc: string; altitudeDeg: number; azimuthDeg: number }[];
  /** Zenithal rate after the activity profile, before local correction. */
  zhrTonight: number;
  /** What the observer can actually expect from this stream, per hour. */
  perHour: number;
  /** Days from the shower's maximum. Negative before it. */
  daysFromPeak: number;
  speedKmS: number;
  populationIndex: number;
  /** How this stream reads to the eye, from its population index. */
  character: MeteorCharacter;
}

/**
 * What a stream looks like, rather than how many of it there are.
 *
 * V1 §7.2 asks the estimate to distinguish bright and faint populations. It is
 * expressed as a character rather than a count of meteors brighter than some
 * magnitude, because that count does not survive contact with reality: the
 * population index describes the faint end well and understates the bright tail,
 * so a magnitude-zero rate derived from it would be confidently wrong. The
 * index does reliably rank streams against each other, and that is what is
 * used.
 */
export type MeteorCharacter = "bright" | "mixed" | "faint";

export function meteorCharacter(populationIndex: number): MeteorCharacter {
  if (populationIndex <= 2.3) return "bright";
  if (populationIndex <= 2.7) return "mixed";
  return "faint";
}

export function describeCharacter(character: MeteorCharacter, speedKmS: number): string {
  const speed = speedKmS >= 55 ? "fast" : speedKmS <= 30 ? "slow" : "moderate";
  if (character === "bright") return `${speed}, and rich in bright ones`;
  if (character === "faint") return `${speed}, and mostly faint`;
  return `${speed}, a mix of bright and faint`;
}

export interface MeteorSample {
  atUtc: string;
  sunAltitudeDeg: number;
  moonAltitudeDeg: number;
  moonIlluminatedFraction: number;
  /** Naked-eye limiting magnitude after twilight and moonlight. */
  limitingMagnitude: number;
  sporadicPerHour: number;
  showerPerHour: number;
  totalPerHour: number;
}

export interface MeteorNight {
  /** Every quarter hour of the period dark enough to be worth sampling. */
  samples: MeteorSample[];
  /** The sample with the highest total rate, or null where none is usable. */
  best: MeteorSample | null;
  /** Streams above the reporting floor at `best`, strongest first. */
  contributions: ShowerContribution[];
  /**
   * Rate band at `best`, from a realistic low to the dark-sky ceiling. The top
   * of the band is the best case, not the expected case. See `RATE_BAND_FACTOR`.
   */
  ratePerHourRange: [number, number] | null;
  /** Every shower inside its activity interval tonight, including weak ones. */
  activeShowerCodes: string[];
  /** The dominant stream tonight, where one stands out. */
  headline: ShowerContribution | null;
  /** Inputs that were unavailable, in the user's terms. */
  missingInputs: string[];
  /** Caveats that apply to the numbers actually produced. */
  limitations: string[];
}

/** Apparent ecliptic longitude of the Sun — solar longitude, equinox of date. */
export function solarLongitudeDeg(at: Date): number {
  return SunPosition(MakeTime(at)).elon;
}

/**
 * The instant of a shower's maximum nearest to `near`.
 *
 * Peaks are defined by solar longitude, not by a calendar date, which is why the
 * Perseid maximum drifts by most of a day across a leap-year cycle.
 *
 * The maximum wanted is the one that governs tonight, which may be behind as
 * easily as ahead — in late December the Geminid maximum is a week past and the
 * Ursid maximum is days away, and both matter. So the time is estimated first
 * from the current solar longitude and the Sun's mean motion, and the search is
 * then narrowed to a fortnight either side of that estimate.
 *
 * Searching a wide window instead does not work: `SearchSunLongitude` returns
 * nothing at all for a span longer than a year, since the target longitude
 * occurs twice and the bracket is ambiguous. That failure is silent, and it took
 * a probe to see it — the Geminids simply vanished from December.
 */
export function showerPeakTime(shower: MeteorShower, near: Date): Date | null {
  const offset = angularDifferenceDeg(shower.peakSolarLongitudeDeg, solarLongitudeDeg(near));
  const estimate = new Date(
    near.getTime() + (offset / SOLAR_LONGITUDE_RATE_DEG_PER_DAY) * 24 * 60 * MS_PER_MINUTE,
  );
  const searchFrom = new Date(estimate.getTime() - 14 * 24 * 60 * MS_PER_MINUTE);
  const found = SearchSunLongitude(shower.peakSolarLongitudeDeg, MakeTime(searchFrom), 28);
  return found ? found.date : null;
}

/**
 * Where the radiant is on the sky at `at`, equinox of date.
 *
 * The stored radiant is its position at maximum. Away from maximum it is
 * advanced by the change in solar longitude, holding ecliptic latitude fixed:
 * a stream's radiant keeps a nearly constant `λ − λ☉`, because the drift is
 * dominated by Earth's own motion around the Sun.
 */
function radiantEquatorialOfDate(
  shower: MeteorShower,
  peak: Date,
  at: Date,
): { raHours: number; decDeg: number } {
  const time = MakeTime(at);

  // Everything below is done in the J2000 ecliptic so the two solar longitudes
  // are differenced in one frame. Their *difference* over a few weeks is the
  // same in J2000 as it is in the equinox of date; precession does not
  // accumulate meaningfully across a shower's activity period.
  const radiantVectorJ2000 = VectorFromSphere(
    { lat: shower.radiantDecDeg, lon: shower.radiantRaDeg, dist: 1 },
    MakeTime(peak),
  );
  const radiantEcliptic = Ecliptic(radiantVectorJ2000);

  const sunAtPeak = Ecliptic(GeoVector(Body.Sun, MakeTime(peak), false)).elon;
  const sunNow = Ecliptic(GeoVector(Body.Sun, time, false)).elon;
  const drift = angularDifferenceDeg(sunNow, sunAtPeak);

  const drifted = VectorFromSphere(
    { lat: radiantEcliptic.elat, lon: radiantEcliptic.elon + drift, dist: 1 },
    time,
  );
  const equatorialJ2000 = RotateVector(Rotation_ECL_EQJ(), drifted);
  const equatorialOfDate = RotateVector(Rotation_EQJ_EQD(time), equatorialJ2000);
  const spherical = EquatorFromVector(equatorialOfDate);
  return { raHours: spherical.ra, decDeg: spherical.dec };
}

function altitudeAzimuth(
  observer: Observer,
  at: Date,
  raHours: number,
  decDeg: number,
): { altitudeDeg: number; azimuthDeg: number } {
  // "normal" refraction, because the question is where a person looking with
  // their eyes sees it, not where it is geometrically.
  const horizontal = Horizon(MakeTime(at), observer, raHours, decDeg, "normal");
  return { altitudeDeg: horizontal.altitude, azimuthDeg: horizontal.azimuth };
}

function bodyAltitudeDeg(observer: Observer, body: Body, at: Date): number {
  const time = MakeTime(at);
  const equator = Equator(body, time, observer, true, true);
  return Horizon(time, observer, equator.ra, equator.dec, "normal").altitude;
}

/**
 * Naked-eye limiting magnitude, starting from the dark-sky reference and
 * subtracting twilight and moonlight.
 *
 * Both curves are calibrated to anchors rather than derived:
 *
 * - twilight: about 0.75 magnitudes lost at the nautical boundary (−12°) and
 *   about 3 at the civil boundary (−6°), which is where meteor watching stops.
 * - moonlight: about 2 magnitudes lost under a full Moon 60° up, about 0.8 under
 *   a half Moon 40° up, and nothing at all with the Moon below the horizon.
 *
 * Light pollution is absent from this, which is why the result is the limiting
 * magnitude of a *dark* site and the caller reports it as such.
 */
export function limitingMagnitude(
  sunAltitudeDeg: number,
  moonAltitudeDeg: number,
  moonIlluminatedFraction: number,
): number {
  let magnitude = REFERENCE_LIMITING_MAGNITUDE;

  if (sunAltitudeDeg > -18) {
    const intoTwilight = Math.min(1, (sunAltitudeDeg + 18) / 12);
    magnitude -= 3 * intoTwilight * intoTwilight;
  }

  if (moonAltitudeDeg > 0) {
    const height = Math.sqrt(Math.sin((moonAltitudeDeg * Math.PI) / 180));
    magnitude -= 2.2 * Math.pow(moonIlluminatedFraction, 1.2) * height;
  }

  return magnitude;
}

/**
 * Share of the peak rate carried by the narrow core rather than the broad base.
 *
 * A stream is not one curve. There is a narrow core — recent material still
 * concentrated near the centre of the stream — sitting on a broad base of
 * material spread across the whole activity period. A single exponential fitted
 * to the peak width describes the core well and then falls off far too fast:
 * fitted to the Perseids it gives 3 an hour on 7 August, when observers reliably
 * report around 15. That is the difference between telling someone to stay in
 * and telling them to go out, on a night that is genuinely good.
 *
 * Two exponentials in this proportion reproduce the published Perseid profile
 * across its whole range — about 55 an hour one day out, 10 at five days, 3 at
 * ten — and hold up on the Quadrantids and Geminids, whose peaks are much
 * narrower and much broader respectively. The split itself is a calibration, and
 * those are the curves it was checked against.
 */
const CORE_SHARE = 0.85;

/** ZHR at the edge of the published activity interval: barely detectable. */
const ACTIVITY_EDGE_ZHR = 1;

/**
 * Zenithal rate at a given distance from maximum.
 *
 * `ZHR_max · 10^(−B·|Δλ☉|)` is the conventional shape. The core slope comes
 * from the catalogue's peak width, the base slope from the distance to the edge
 * of the published activity interval — measured on the side the observer is
 * actually on, which gives the asymmetry real showers have without the
 * catalogue having to record it. The Perseids run for 26° of solar longitude
 * before maximum and 11° after, and so decay more slowly before it, which is
 * what observers see.
 */
export function zhrAtSolarLongitude(shower: MeteorShower, solarLongitude: number): number {
  if (!isShowerActiveAt(shower, solarLongitude)) return 0;

  const signedOffset = angularDifferenceDeg(solarLongitude, shower.peakSolarLongitudeDeg);
  const offset = Math.abs(signedOffset);
  const edge =
    signedOffset < 0
      ? Math.abs(
          angularDifferenceDeg(
            shower.activityStartSolarLongitudeDeg,
            shower.peakSolarLongitudeDeg,
          ),
        )
      : Math.abs(
          angularDifferenceDeg(
            shower.activityEndSolarLongitudeDeg,
            shower.peakSolarLongitudeDeg,
          ),
        );

  const coreHalfWidthDeg = (shower.peakWidthDays / 2) * SOLAR_LONGITUDE_RATE_DEG_PER_DAY;
  const coreSlope = Math.log10(2) / coreHalfWidthDeg;
  const baseSlope =
    edge > 0 ? Math.log10(shower.nominalZhr / ACTIVITY_EDGE_ZHR) / edge : coreSlope;

  const core = CORE_SHARE * Math.pow(10, -coreSlope * offset);
  const base = (1 - CORE_SHARE) * Math.pow(10, -baseSlope * offset);
  return shower.nominalZhr * (core + base);
}

/**
 * Observed hourly rate for one stream: the IMO reduction, inverted.
 *
 * `sin(h)` is the radiant-altitude term and `r^(6.5 − LM)` the sky term. Below
 * about 20° altitude the sine term is known to be optimistic; the caller states
 * that rather than this function quietly flooring it.
 */
export function observedHourlyRate(
  zhr: number,
  radiantAltitudeDeg: number,
  populationIndex: number,
  skyLimitingMagnitude: number,
): number {
  if (radiantAltitudeDeg <= 0) return 0;
  const altitudeTerm = Math.sin((radiantAltitudeDeg * Math.PI) / 180);
  const skyTerm = Math.pow(populationIndex, REFERENCE_LIMITING_MAGNITUDE - skyLimitingMagnitude);
  return (zhr * altitudeTerm) / skyTerm;
}

/**
 * The sporadic background at an instant.
 *
 * Sporadics have no radiant, so the `sin(h)` correction does not apply to them.
 * What varies instead is Earth's apex — the direction of its orbital motion,
 * 90° behind the Sun in ecliptic longitude — which rises through the night and
 * is highest before dawn. That is why an ordinary night gets busier towards
 * morning, and it is geometry rather than a calibration.
 *
 * The amplitude of the modulation is a calibration: dusk-to-dawn is set to a
 * factor of roughly four at mid-latitudes, the ratio observers report.
 */
export function sporadicHourlyRate(
  observer: Observer,
  at: Date,
  skyLimitingMagnitude: number,
): number {
  const time = MakeTime(at);
  const sunEclipticLongitude = Ecliptic(GeoVector(Body.Sun, time, false)).elon;
  const apex = VectorFromSphere({ lat: 0, lon: sunEclipticLongitude - 90, dist: 1 }, time);
  const apexEquatorialOfDate = RotateVector(
    Rotation_EQJ_EQD(time),
    RotateVector(Rotation_ECL_EQJ(), apex),
  );
  const apexCoordinates = EquatorFromVector(apexEquatorialOfDate);
  const { altitudeDeg } = altitudeAzimuth(
    observer,
    at,
    apexCoordinates.ra,
    apexCoordinates.dec,
  );

  const apexTerm = 0.3 + 1.2 * Math.max(0, Math.sin((altitudeDeg * Math.PI) / 180));
  const skyTerm = Math.pow(
    SPORADIC_BACKGROUND.populationIndex,
    REFERENCE_LIMITING_MAGNITUDE - skyLimitingMagnitude,
  );
  return (SPORADIC_BACKGROUND.nominalZhr * apexTerm) / skyTerm;
}

/** Streams below this are counted in the total but not named. */
const CONTRIBUTION_FLOOR_PER_HOUR = 0.5;

/**
 * Everything above, evaluated across an observing period.
 *
 * Sampling every quarter hour rather than solving for the maximum, because the
 * rate is the product of four curves that peak at different times — the radiant
 * climbing, the Moon setting, twilight ending, the apex rising — and the best
 * moment is often none of their individual maxima.
 */
export function meteorNight(
  latitudeDeg: number,
  longitudeDeg: number,
  period: ObservationPeriod,
): MeteorNight {
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const start = Date.parse(period.startUtc);
  const end = Date.parse(period.endUtc);

  // What the *rate* leaves out, which is not the same as what the product
  // leaves out: cloud is handled separately as sky access, and the number here
  // stays a clear-sky ceiling either way. Listing cloud as unaccounted-for on a
  // page that visibly accounts for it was simply false.
  const missingInputs = [
    "Light pollution at your location, which usually matters more than anything else here.",
  ];

  if (period.kind === "polar-day") {
    return {
      samples: [],
      best: null,
      contributions: [],
      ratePerHourRange: null,
      activeShowerCodes: [],
      headline: null,
      missingInputs,
      limitations: ["The sky never gets dark enough here today to see meteors."],
    };
  }

  const midPeriod = new Date((start + end) / 2);
  const peaks = new Map<string, Date>();
  const activeShowerCodes: string[] = [];
  for (const shower of METEOR_SHOWERS) {
    const peak = showerPeakTime(shower, midPeriod);
    if (!peak) continue;
    peaks.set(shower.code, peak);
    if (isShowerActiveAt(shower, solarLongitudeDeg(midPeriod))) {
      activeShowerCodes.push(shower.code);
    }
  }

  const samples: MeteorSample[] = [];
  let best: MeteorSample | null = null;
  let bestAt: Date | null = null;

  for (
    let stamp = start;
    stamp <= end;
    stamp += SAMPLE_INTERVAL_MINUTES * MS_PER_MINUTE
  ) {
    const at = new Date(stamp);
    const sunAltitude = bodyAltitudeDeg(observer, Body.Sun, at);
    if (sunAltitude > USABLE_SUN_ALTITUDE_DEG) continue;

    const moonAltitude = bodyAltitudeDeg(observer, Body.Moon, at);
    const moonFraction = Illumination(Body.Moon, MakeTime(at)).phase_fraction;
    const sky = limitingMagnitude(sunAltitude, moonAltitude, moonFraction);
    const solarLongitude = solarLongitudeDeg(at);

    let showerPerHour = 0;
    for (const shower of METEOR_SHOWERS) {
      const peak = peaks.get(shower.code);
      if (!peak) continue;
      const zhr = zhrAtSolarLongitude(shower, solarLongitude);
      if (zhr <= 0) continue;
      const radiant = radiantEquatorialOfDate(shower, peak, at);
      const { altitudeDeg } = altitudeAzimuth(observer, at, radiant.raHours, radiant.decDeg);
      showerPerHour += observedHourlyRate(zhr, altitudeDeg, shower.populationIndex, sky);
    }

    const sporadicPerHour = sporadicHourlyRate(observer, at, sky);

    const sample: MeteorSample = {
      atUtc: at.toISOString(),
      sunAltitudeDeg: sunAltitude,
      moonAltitudeDeg: moonAltitude,
      moonIlluminatedFraction: moonFraction,
      limitingMagnitude: sky,
      sporadicPerHour,
      showerPerHour,
      totalPerHour: showerPerHour + sporadicPerHour,
    };
    samples.push(sample);
    if (!best || sample.totalPerHour > best.totalPerHour) {
      best = sample;
      bestAt = at;
    }
  }

  const limitations: string[] = [];
  const contributions: ShowerContribution[] = [];

  if (best && bestAt) {
    const solarLongitude = solarLongitudeDeg(bestAt);
    for (const shower of METEOR_SHOWERS) {
      const peak = peaks.get(shower.code);
      if (!peak) continue;
      const zhr = zhrAtSolarLongitude(shower, solarLongitude);
      if (zhr <= 0) continue;
      const radiant = radiantEquatorialOfDate(shower, peak, bestAt);
      const { altitudeDeg, azimuthDeg } = altitudeAzimuth(
        observer,
        bestAt,
        radiant.raHours,
        radiant.decDeg,
      );
      const perHour = observedHourlyRate(zhr, altitudeDeg, shower.populationIndex, best.limitingMagnitude);
      if (perHour < CONTRIBUTION_FLOOR_PER_HOUR) continue;
      contributions.push({
        code: shower.code,
        name: shower.name,
        radiantAltitudeDeg: altitudeDeg,
        radiantAzimuthDeg: azimuthDeg,
        radiantTrack: samples.map((sample) => {
          const at = altitudeAzimuth(
            observer,
            new Date(sample.atUtc),
            radiant.raHours,
            radiant.decDeg,
          );
          return {
            atUtc: sample.atUtc,
            altitudeDeg: at.altitudeDeg,
            azimuthDeg: at.azimuthDeg,
          };
        }),
        zhrTonight: zhr,
        perHour,
        daysFromPeak: (bestAt.getTime() - peak.getTime()) / (24 * 60 * MS_PER_MINUTE),
        speedKmS: shower.speedKmS,
        populationIndex: shower.populationIndex,
        character: meteorCharacter(shower.populationIndex),
      });
    }
    contributions.sort((a, b) => b.perHour - a.perHour);

    if (contributions.some((entry) => entry.radiantAltitudeDeg < 20)) {
      limitations.push(
        "A radiant this low makes the standard rate estimate optimistic — expect fewer than the number says.",
      );
    }
    if (best.moonAltitudeDeg > 0 && best.moonIlluminatedFraction > 0.4) {
      limitations.push(
        `The Moon is up and ${Math.round(best.moonIlluminatedFraction * 100)}% lit at the best time, which is already taken off the estimate.`,
      );
    }
    if (best.limitingMagnitude < 5.5) {
      limitations.push("Even at its best the sky stays bright tonight, so only the brighter meteors will show.");
    }
  } else {
    limitations.push("The sky does not get dark enough tonight for meteor watching.");
  }

  return {
    samples,
    best,
    contributions,
    ratePerHourRange: best
      ? [best.totalPerHour / RATE_BAND_FACTOR, best.totalPerHour]
      : null,
    activeShowerCodes,
    headline: contributions.length > 0 && contributions[0].perHour >= 2 ? contributions[0] : null,
    missingInputs,
    limitations,
  };
}

/** Compass point for a bearing, for guidance that reads like a person wrote it. */
export function compassPoint(azimuthDeg: number): string {
  const points = [
    "north", "north-northeast", "northeast", "east-northeast",
    "east", "east-southeast", "southeast", "south-southeast",
    "south", "south-southwest", "southwest", "west-southwest",
    "west", "west-northwest", "northwest", "north-northwest",
  ];
  const index = Math.round((((azimuthDeg % 360) + 360) % 360) / 22.5) % 16;
  return points[index];
}

/**
 * A rate as a waiting time, which is how it actually feels outside.
 *
 * Twenty an hour is one every three minutes; three an hour is a twenty-minute
 * wait between them. The second is a different evening from the first, and the
 * bare number hides that.
 */
/**
 * A rate *range* as a waiting time.
 *
 * "Around 6-16 meteors an hour at best - one every 10 minutes or so" quoted the
 * ceiling as a range and then described the felt rhythm from the floor of it.
 * Ten minutes is 6/hr; 16/hr is closer to four. The sentence characterised the
 * whole range with the arithmetic of one end of it.
 *
 * The intent behind quoting the slow end was right — promising a meteor every
 * four minutes and delivering one every ten is exactly the overstatement the
 * product rules out. So the fix is not to switch ends but to quote both, which
 * is honest about the spread and consistent with the numbers beside it.
 */
export function cadenceRangeDescription(lowPerHour: number, highPerHour: number): string {
  if (lowPerHour <= 0) return cadenceDescription(highPerHour);
  const slow = 60 / lowPerHour;
  const fast = 60 / highPerHour;
  // Close enough that a range would be false precision.
  if (Math.round(slow) === Math.round(fast)) return cadenceDescription(lowPerHour);
  if (slow < 1.5) return "roughly one a minute";
  return `one every ${Math.round(fast)}\u2013${Math.round(slow)} minutes`;
}

export function cadenceDescription(perHour: number): string {
  if (perHour <= 0) return "nothing worth waiting for";
  const minutes = 60 / perHour;
  if (minutes < 0.5) return "more than two a minute";
  if (minutes < 1.5) return "roughly one a minute";
  if (minutes < 4) return `about one every ${Math.round(minutes)} minutes`;
  if (minutes < 60) return `one every ${Math.round(minutes / 5) * 5} minutes or so`;
  return "roughly one an hour";
}
