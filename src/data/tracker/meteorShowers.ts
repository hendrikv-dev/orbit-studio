/**
 * The vendored meteor stream catalogue.
 *
 * Astronomy Engine computes positions and circumstances but does not know that
 * the Perseids exist, so stream parameters are static data that ships with the
 * app (TRACKER_PRD R9.1–R9.4). Nothing here is fetched at runtime.
 *
 * Source: the IMO working list of visual meteor showers, cross-referenced to the
 * IAU Meteor Data Center established-shower list for stream identity and
 * numbering. Radiants are equinox J2000, as published. Snapshot pinned at the
 * date in `METEOR_SHOWER_SNAPSHOT` and replaced deliberately, never
 * automatically (R9.3) — shower parameters drift as streams are re-observed, and
 * a silent update would move ranking outputs with no visible cause.
 *
 * ## What is sourced and what is not
 *
 * `iauNumber`, `code`, `name`, `peakSolarLongitudeDeg`, `radiantRaDeg`,
 * `radiantDecDeg`, `speedKmS`, `populationIndex` and `nominalZhr` are the
 * published working-list values.
 *
 * `peakWidthDays` is **not** a published IMO quantity and is not attributed to
 * one. It is an approximate full width at half maximum, set from the commonly
 * reported character of each peak — a few hours for the Quadrantids, most of a
 * week for the Southern delta Aquariids. It exists because a shower's *width* is
 * what decides whether tonight is worth going outside for when tonight is not
 * the peak, and reporting only the peak would answer the wrong question. It is
 * coarse on purpose: an error of 50% in a width changes an estimated rate far
 * less than the same error in an exponential slope would, and the alternative
 * — vendoring IMO's B-values from memory — would be inventing precision.
 *
 * The widths are set so that the profile in `meteorActivity.ts` reproduces the
 * published *character* of each shower: the Quadrantid maximum lasting hours,
 * the eta Aquariids holding high rates for most of a week, the Taurids barely
 * varying across a month. They were adjusted against those curves, which is
 * exactly why they are recorded here as editorial rather than sourced.
 *
 * That split is the point of R9.4: coming from an authoritative table does not
 * make every field of a record equally authoritative.
 */

/** Pinned snapshot identity, recorded in `provenance/inventory.json`. */
export const METEOR_SHOWER_SNAPSHOT = {
  snapshotDate: "2026-08-16",
  sources: [
    "IMO working list of visual meteor showers",
    "IAU Meteor Data Center list of established showers",
  ],
} as const;

export interface MeteorShower {
  /** IAU Meteor Data Center stream number. */
  iauNumber: number;
  /** Three-letter IAU code. */
  code: string;
  name: string;
  /** Parent body, where one is established. Null where it is not. */
  parent: string | null;
  /** Solar longitude of maximum, degrees, equinox of date. */
  peakSolarLongitudeDeg: number;
  /** Solar longitude at which activity is first and last detectable. */
  activityStartSolarLongitudeDeg: number;
  activityEndSolarLongitudeDeg: number;
  /** Radiant at maximum, equinox J2000, degrees. */
  radiantRaDeg: number;
  radiantDecDeg: number;
  /** Geocentric velocity, km/s. Governs how fast the meteors look. */
  speedKmS: number;
  /**
   * Population index r: the factor by which meteor counts increase per
   * magnitude. A low r means a stream rich in bright meteors.
   */
  populationIndex: number;
  /** Zenithal hourly rate at maximum, under a 6.5-magnitude sky. */
  nominalZhr: number;
  /** Approximate FWHM of the peak in days. Editorial, not IMO. See above. */
  peakWidthDays: number;
}

/**
 * Solar longitudes are equinox of date and wrap at 360°. A shower whose activity
 * crosses the vernal equinox (the Quadrantids) is stored with a start longitude
 * numerically greater than its end; `isActiveAt` handles the wrap rather than
 * the table storing negative angles.
 */
export const METEOR_SHOWERS: readonly MeteorShower[] = [
  {
    iauNumber: 10,
    code: "QUA",
    name: "Quadrantids",
    parent: "2003 EH1",
    peakSolarLongitudeDeg: 283.15,
    activityStartSolarLongitudeDeg: 275.6,
    activityEndSolarLongitudeDeg: 292.0,
    radiantRaDeg: 230.1,
    radiantDecDeg: 49.5,
    speedKmS: 41,
    populationIndex: 2.1,
    nominalZhr: 110,
    // The sharpest major peak there is: high rates last hours, not a night.
    peakWidthDays: 0.35,
  },
  {
    iauNumber: 6,
    code: "LYR",
    name: "Lyrids",
    parent: "C/1861 G1 Thatcher",
    peakSolarLongitudeDeg: 32.32,
    activityStartSolarLongitudeDeg: 24.2,
    activityEndSolarLongitudeDeg: 40.0,
    radiantRaDeg: 271.4,
    radiantDecDeg: 33.6,
    speedKmS: 49,
    populationIndex: 2.1,
    nominalZhr: 18,
    peakWidthDays: 1.0,
  },
  {
    iauNumber: 31,
    code: "ETA",
    name: "eta Aquariids",
    parent: "1P/Halley",
    peakSolarLongitudeDeg: 45.5,
    activityStartSolarLongitudeDeg: 29.0,
    activityEndSolarLongitudeDeg: 67.0,
    radiantRaDeg: 338.0,
    radiantDecDeg: -0.8,
    speedKmS: 66,
    populationIndex: 2.4,
    nominalZhr: 50,
    // A plateau, not a peak: high rates hold for the best part of a week.
    peakWidthDays: 9.0,
  },
  {
    iauNumber: 1,
    code: "CAP",
    name: "alpha Capricornids",
    parent: "169P/NEAT",
    peakSolarLongitudeDeg: 127.0,
    activityStartSolarLongitudeDeg: 101.0,
    activityEndSolarLongitudeDeg: 142.0,
    radiantRaDeg: 306.6,
    radiantDecDeg: -8.2,
    speedKmS: 23,
    populationIndex: 2.5,
    nominalZhr: 5,
    peakWidthDays: 8.0,
  },
  {
    iauNumber: 5,
    code: "SDA",
    name: "Southern delta Aquariids",
    parent: "96P/Machholz",
    peakSolarLongitudeDeg: 125.0,
    activityStartSolarLongitudeDeg: 110.0,
    activityEndSolarLongitudeDeg: 150.0,
    radiantRaDeg: 339.7,
    radiantDecDeg: -16.4,
    speedKmS: 41,
    populationIndex: 3.2,
    nominalZhr: 25,
    peakWidthDays: 12.0,
  },
  {
    iauNumber: 7,
    code: "PER",
    name: "Perseids",
    parent: "109P/Swift-Tuttle",
    peakSolarLongitudeDeg: 140.0,
    activityStartSolarLongitudeDeg: 114.0,
    activityEndSolarLongitudeDeg: 151.0,
    radiantRaDeg: 48.2,
    radiantDecDeg: 58.1,
    speedKmS: 59,
    populationIndex: 2.2,
    nominalZhr: 100,
    peakWidthDays: 2.0,
  },
  {
    iauNumber: 8,
    code: "ORI",
    name: "Orionids",
    parent: "1P/Halley",
    peakSolarLongitudeDeg: 208.0,
    activityStartSolarLongitudeDeg: 189.0,
    activityEndSolarLongitudeDeg: 225.0,
    radiantRaDeg: 95.2,
    radiantDecDeg: 15.8,
    speedKmS: 66,
    populationIndex: 2.5,
    nominalZhr: 20,
    peakWidthDays: 5.0,
  },
  {
    iauNumber: 2,
    code: "STA",
    name: "Southern Taurids",
    parent: "2P/Encke",
    peakSolarLongitudeDeg: 196.0,
    activityStartSolarLongitudeDeg: 167.0,
    activityEndSolarLongitudeDeg: 238.0,
    radiantRaDeg: 32.0,
    radiantDecDeg: 9.0,
    speedKmS: 27,
    populationIndex: 2.3,
    nominalZhr: 5,
    // Barely a peak at all: a long, low, fireball-rich drizzle that holds a
    // near-constant rate for weeks.
    peakWidthDays: 25.0,
  },
  {
    iauNumber: 17,
    code: "NTA",
    name: "Northern Taurids",
    parent: "2P/Encke",
    peakSolarLongitudeDeg: 230.0,
    activityStartSolarLongitudeDeg: 206.0,
    activityEndSolarLongitudeDeg: 258.0,
    radiantRaDeg: 58.0,
    radiantDecDeg: 22.0,
    speedKmS: 29,
    populationIndex: 2.3,
    nominalZhr: 5,
    peakWidthDays: 25.0,
  },
  {
    iauNumber: 13,
    code: "LEO",
    name: "Leonids",
    parent: "55P/Tempel-Tuttle",
    peakSolarLongitudeDeg: 235.27,
    activityStartSolarLongitudeDeg: 223.0,
    activityEndSolarLongitudeDeg: 248.0,
    radiantRaDeg: 152.3,
    radiantDecDeg: 22.2,
    speedKmS: 71,
    populationIndex: 2.5,
    nominalZhr: 15,
    peakWidthDays: 1.0,
  },
  {
    iauNumber: 4,
    code: "GEM",
    name: "Geminids",
    parent: "3200 Phaethon",
    peakSolarLongitudeDeg: 262.2,
    activityStartSolarLongitudeDeg: 251.0,
    activityEndSolarLongitudeDeg: 268.0,
    radiantRaDeg: 112.3,
    radiantDecDeg: 32.5,
    speedKmS: 35,
    populationIndex: 2.6,
    nominalZhr: 150,
    peakWidthDays: 1.2,
  },
  {
    iauNumber: 15,
    code: "URS",
    name: "Ursids",
    parent: "8P/Tuttle",
    peakSolarLongitudeDeg: 270.7,
    activityStartSolarLongitudeDeg: 265.0,
    activityEndSolarLongitudeDeg: 274.0,
    radiantRaDeg: 217.1,
    radiantDecDeg: 75.9,
    speedKmS: 33,
    populationIndex: 3.0,
    nominalZhr: 10,
    peakWidthDays: 0.5,
  },
];

/**
 * The sporadic background: meteors belonging to no identified stream.
 *
 * These are not a shower and have no radiant, but they are most of what a casual
 * observer sees on an ordinary night, and omitting them would make every night
 * outside a shower period read as empty. The nominal rate is the conventional
 * dark-sky figure for a single observer; the strong time-of-night dependence is
 * not a property of this constant but of the apex geometry, and is computed.
 */
export const SPORADIC_BACKGROUND = {
  /** Zenithal hourly equivalent under a 6.5-magnitude sky. */
  nominalZhr: 10,
  /** Sporadics are on average fainter than shower meteors. */
  populationIndex: 3.0,
} as const;

const DEGREES_PER_TURN = 360;

/** Shortest signed separation between two angles, in degrees. */
export function angularDifferenceDeg(a: number, b: number): number {
  let difference = (a - b) % DEGREES_PER_TURN;
  if (difference > 180) difference -= DEGREES_PER_TURN;
  if (difference < -180) difference += DEGREES_PER_TURN;
  return difference;
}

/**
 * True where the shower is within its published activity interval at this solar
 * longitude, handling the wrap for showers that cross 0°.
 */
export function isShowerActiveAt(shower: MeteorShower, solarLongitudeDeg: number): boolean {
  const start = shower.activityStartSolarLongitudeDeg;
  const end = shower.activityEndSolarLongitudeDeg;
  const longitude = ((solarLongitudeDeg % DEGREES_PER_TURN) + DEGREES_PER_TURN) % DEGREES_PER_TURN;
  if (start <= end) return longitude >= start && longitude <= end;
  // Wraps through 0°, as the Quadrantids do.
  return longitude >= start || longitude <= end;
}

/** Lookup by IAU three-letter code. */
export function meteorShowerByCode(code: string): MeteorShower | undefined {
  return METEOR_SHOWERS.find((shower) => shower.code === code);
}
