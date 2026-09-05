import { Body, Equator, Illumination, MakeTime, Observer, SiderealTime } from "astronomy-engine";
import { subsolarPoint, sunAltitudeAt } from "./daylight";
import { solarLongitudeDeg, zhrAtSolarLongitude } from "./meteorActivity";
import type { MeteorShower } from "./meteorShowers";

/**
 * Where a meteor shower is intrinsically worth observing from, on one night.
 *
 * ## Why this is not a visibility map
 *
 * A shower has no ground track. Nothing about it lands anywhere: the Earth
 * passes through a stream and the meteors arrive over the whole night side.
 * Drawing an eclipse-style path would be inventing geography the phenomenon
 * does not have, and calling the result "visibility" would claim a precision
 * that does not exist either.
 *
 * What *does* vary with place is how good the opportunity is, and that is a
 * real, computable, purely astronomical quantity:
 *
 *   - how long it is astronomically dark
 *   - how high the radiant climbs while it is dark
 *   - how close the night is to the shower's maximum
 *   - how much the Moon is up and lit during those hours
 *
 * All four are geometry and ephemeris. None of them is weather, light
 * pollution or air quality — those are the environment layers, and they are
 * deliberately kept out of this so the reader can see which of the two is
 * making a place good or bad. This answers "is the *event* favourable here",
 * and the environment layers modify that answer separately.
 *
 * ## What the number is
 *
 * A 0–1 opportunity, and it is Tracker's synthesis rather than a published
 * quantity — which is why the layer is called observing *potential* and never
 * "visibility". The inputs stay inspectable: every cell carries the hours of
 * darkness, the radiant altitude and the Moon term it was built from, and the
 * panel quotes those rather than only the score.
 */

export interface MeteorPotentialCell {
  latitudeDeg: number;
  longitudeDeg: number;
  /** 0–1, Tracker's synthesis of the four terms below. */
  potential: number;
  /** Hours of astronomical darkness on this night, at this place. */
  darkHours: number;
  /** Mean sine of the radiant's altitude while dark; 0 when it never rises. */
  radiantTerm: number;
  /** 1 with no Moon up, falling towards 0 with a bright Moon high in the dark. */
  moonTerm: number;
  /** Rate at this longitude's local peak, relative to the shower's maximum. */
  activityTerm: number;
}

export interface MeteorPotentialField {
  showerCode: string;
  showerName: string;
  /** The night this describes, as the UTC instant its samples are centred on. */
  atUtc: string;
  stepDeg: number;
  cells: MeteorPotentialCell[];
  /** The best potential anywhere, so a ramp can be scaled to the night. */
  peak: number;
}

const DEG = Math.PI / 180;

/** Astronomical darkness. Above this the sky is not usable for faint meteors. */
const DARK_SUN_ALTITUDE_DEG = -18;

/** Below this the radiant is too low for its meteors to reach the observer. */
const RADIANT_FLOOR_DEG = 5;

/**
 * The night, sampled.
 *
 * Half-hourly across a full day, which is enough to resolve the length of
 * darkness to about the precision the rest of the model deserves and cheap
 * enough to run for the whole world in one pass.
 */
const SAMPLE_MINUTES = 30;

/**
 * One sample's sky, computed once for the whole world.
 *
 * The expensive calls — the Sun's position, the Moon's, the sidereal time —
 * depend only on the instant, not on where the reader is. Hoisting them out of
 * the per-cell loop is the difference between a field that draws in a frame and
 * one that locks the tab: at 5° there are 2,592 cells and 48 samples, and doing
 * ephemeris per cell would be 124,000 engine calls instead of 48.
 */
interface SampleSky {
  subsolar: { latitudeDeg: number; longitudeDeg: number };
  sublunar: { latitudeDeg: number; longitudeDeg: number };
  moonIlluminated: number;
  /** Greenwich sidereal time, degrees. */
  gstDeg: number;
  radiantRaDeg: number;
  radiantDecDeg: number;
  zhrFraction: number;
}

function skyAt(at: Date, shower: MeteorShower): SampleSky {
  const time = MakeTime(at);
  const gstHours = SiderealTime(time);
  const moon = Equator(Body.Moon, time, new Observer(0, 0, 0), true, true);
  const sublunarLon = (((moon.ra - gstHours) * 15 + 540) % 360) - 180;
  const solarLongitude = solarLongitudeDeg(at);
  return {
    subsolar: subsolarPoint(at),
    sublunar: { latitudeDeg: moon.dec, longitudeDeg: sublunarLon },
    moonIlluminated: Illumination(Body.Moon, time).phase_fraction,
    gstDeg: gstHours * 15,
    // The radiant is the published one at maximum. Its nightly drift is small
    // against the resolution of everything else here and is not modelled.
    radiantRaDeg: shower.radiantRaDeg,
    radiantDecDeg: shower.radiantDecDeg,
    zhrFraction: Math.max(
      0,
      zhrAtSolarLongitude(shower, solarLongitude) / Math.max(1, shower.nominalZhr),
    ),
  };
}

/** Altitude of a fixed equatorial position, from sidereal time and latitude. */
function altitudeOf(
  raDeg: number,
  decDeg: number,
  gstDeg: number,
  latitudeDeg: number,
  longitudeDeg: number,
): number {
  const hourAngle = (gstDeg + longitudeDeg - raDeg) * DEG;
  const dec = decDeg * DEG;
  const lat = latitudeDeg * DEG;
  const sinAlt =
    Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
}

/** Angular distance from a sub-body point, which gives that body's altitude. */
function altitudeFromSubpoint(
  subpoint: { latitudeDeg: number; longitudeDeg: number },
  latitudeDeg: number,
  longitudeDeg: number,
): number {
  const φ1 = subpoint.latitudeDeg * DEG;
  const φ2 = latitudeDeg * DEG;
  const Δλ = (longitudeDeg - subpoint.longitudeDeg) * DEG;
  const cosine =
    Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosine))) / DEG;
}

/**
 * The model at one point, given the night already sampled.
 *
 * Shared by the field and by the single-point reading, so the number the panel
 * quotes and the colour the map draws can never come from different arithmetic.
 */
function accumulate(
  samples: SampleSky[],
  latitudeDeg: number,
  longitudeDeg: number,
): MeteorPotentialCell {
  const hoursPerSample = SAMPLE_MINUTES / 60;
  let darkHours = 0;
  let radiantWeighted = 0;
  let moonWeighted = 0;
  let activityWeighted = 0;

  for (const sky of samples) {
    if (sunAltitudeAt(sky.subsolar, latitudeDeg, longitudeDeg) >= DARK_SUN_ALTITUDE_DEG) continue;
    darkHours += hoursPerSample;

    const radiantAltitude = altitudeOf(
      sky.radiantRaDeg,
      sky.radiantDecDeg,
      sky.gstDeg,
      latitudeDeg,
      longitudeDeg,
    );
    // Below the floor the radiant contributes nothing: its meteors are below
    // the horizon or grazing it, not overhead.
    radiantWeighted +=
      (radiantAltitude <= RADIANT_FLOOR_DEG ? 0 : Math.sin(radiantAltitude * DEG)) * hoursPerSample;

    // The Moon only costs anything while it is up, and costs in proportion to
    // how lit it is and how high it has climbed.
    const moonAltitude = altitudeFromSubpoint(sky.sublunar, latitudeDeg, longitudeDeg);
    const moonLoad = moonAltitude <= 0 ? 0 : sky.moonIlluminated * Math.sin(moonAltitude * DEG);
    moonWeighted += (1 - Math.min(1, moonLoad)) * hoursPerSample;

    activityWeighted += sky.zhrFraction * hoursPerSample;
  }

  const radiantTerm = darkHours > 0 ? radiantWeighted / darkHours : 0;
  const moonTerm = darkHours > 0 ? moonWeighted / darkHours : 0;
  const activityTerm = darkHours > 0 ? activityWeighted / darkHours : 0;
  /**
   * The synthesis.
   *
   * Multiplicative, because these are gates rather than contributions: no
   * darkness means no shower whatever the radiant is doing, and a radiant that
   * never rises means no shower however long the night. The darkness term
   * saturates at six hours — past that, more night stops improving a shower
   * whose radiant is already up.
   */
  const darknessTerm = Math.min(1, darkHours / 6);
  return {
    latitudeDeg,
    longitudeDeg,
    potential: darknessTerm * radiantTerm * moonTerm * activityTerm,
    darkHours,
    radiantTerm,
    moonTerm,
    activityTerm,
  };
}

/** The night, sampled once, for reuse across every point asked about. */
function sampleNight(shower: MeteorShower, nightCentreUtc: Date): SampleSky[] {
  const samples: SampleSky[] = [];
  const halfDayMs = 12 * 3_600_000;
  for (let offset = -halfDayMs; offset <= halfDayMs; offset += SAMPLE_MINUTES * 60_000) {
    samples.push(skyAt(new Date(nightCentreUtc.getTime() + offset), shower));
  }
  return samples;
}

export function meteorPotentialField(
  shower: MeteorShower,
  nightCentreUtc: Date,
  stepDeg = 5,
): MeteorPotentialField {
  // Centred on the shower's own peak instant, a full day wide, so every
  // longitude gets its own night rather than only the one under the peak.
  const samples = sampleNight(shower, nightCentreUtc);

  const cells: MeteorPotentialCell[] = [];
  let peak = 0;
  /**
   * The rows sit on multiples of the step, because that is where every reader
   * of this field looks for them.
   *
   * Latitude used to start at −85, so at a four-degree step the rows were −85,
   * −81, −77 … while the map's sampler and the shared bilinear interpolation
   * both snap a coordinate to `round(value / step) * step` — a lattice this
   * grid had no cells on. Every lookup missed, the `?? 0` behind each miss
   * turned it into a plausible-looking zero, and the observing-potential
   * overlay drew nothing at all: for every shower, at every zoom, with no error
   * raised anywhere and a rendered map that simply had no field on it.
   *
   * Aligning the grid is the fix rather than teaching each consumer a second
   * lattice, because the other fields — aurora, eclipse coverage, light
   * pollution — are already aligned this way, and this one was the exception.
   * ±85 becomes ±84 at a four-degree step, which costs a degree of Antarctica
   * and Greenland's north coast and no observers at all.
   */
  const limit = Math.floor(85 / stepDeg) * stepDeg;
  for (let lat = -limit; lat <= limit + 1e-9; lat += stepDeg) {
    for (let lon = -180; lon < 180; lon += stepDeg) {
      const cell = accumulate(samples, lat, lon);
      if (cell.potential > peak) peak = cell.potential;
      cells.push(cell);
    }
  }

  return {
    showerCode: shower.code,
    showerName: shower.name,
    atUtc: nightCentreUtc.toISOString(),
    stepDeg,
    cells,
    peak,
  };
}

/**
 * The same computation for one place, at full precision.
 *
 * The field is sampled on a grid for drawing; the panel must not quote a
 * neighbouring cell's number as if it were this point's. This runs the identical
 * model at the exact coordinate, which is what the selected-location reading
 * uses.
 */
export function meteorPotentialAt(
  shower: MeteorShower,
  nightCentreUtc: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): MeteorPotentialCell {
  return accumulate(sampleNight(shower, nightCentreUtc), latitudeDeg, longitudeDeg);
}

/** Words for a potential, so the panel never prints a bare 0.42. */
export function describePotential(potential: number): string {
  if (potential >= 0.5) return "Strong";
  if (potential >= 0.3) return "Good";
  if (potential >= 0.15) return "Moderate";
  if (potential > 0.02) return "Weak";
  return "Not favourable";
}
