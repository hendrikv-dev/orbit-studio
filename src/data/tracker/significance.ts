/**
 * How much a thing being in the sky tonight is *news*.
 *
 * ## The defect this exists to fix
 *
 * Tracker ranked Saturn above a locally visible partial lunar eclipse. Nothing
 * was broken: Saturn really was easier to see, higher, and available for longer,
 * and the ordering value said so. The model was wrong rather than the arithmetic
 * — rarity entered the score through `RARITY_CAP`, which was documented as
 * "one band, never more", and one band is not enough to lift a once-a-year event
 * over a planet that is up most nights of the year.
 *
 * A product whose headline question is "what is worth seeing tonight" cannot
 * answer with the thing that is worth seeing on four hundred other nights too.
 *
 * ## The priority the brief asks for
 *
 *   novelty / significance → local event quality → temporal relevance
 *     → observing conditions → practical observability
 *
 * Significance is first, and it is *not* a weight added to a sum. A weighted
 * sum cannot express "generally outranks", because a large enough term anywhere
 * else always wins eventually. What expresses it is a band: each tier owns a
 * stretch of the ordering scale, and how good the individual opportunity is
 * decides where inside its own stretch it falls.
 *
 * ## The bands, and why they overlap the way they do
 *
 *   routine        0.00 … 0.34
 *   good-example   0.22 … 0.52
 *   favourable     0.40 … 0.72
 *   notable        0.60 … 1.00
 *
 * Adjacent tiers overlap; non-adjacent tiers do not. So an outstanding routine
 * target can edge past a poor example of the tier above it — which is right,
 * because those two really are close calls — and no amount of routine
 * visibility can ever reach past `favourable` into `notable`. "A locally
 * observable unusual event should generally outrank a routine target" is then a
 * property of the arithmetic rather than a hope about the inputs.
 *
 * ## What keeps this honest
 *
 * Every tier below is decided by measured astronomical state: contact times,
 * days from opposition, apparent diameter in arcseconds, ring tilt, the rate a
 * shower is actually producing. There are no per-body bonuses and no editorial
 * nudges. `reasons` carries the facts that put an opportunity in its tier, and
 * those facts — never the tier, and never a score — are what the interface is
 * allowed to show. A reader is told "Saturn is three weeks from opposition and
 * reaches 49° from here", not "novelty 0.46".
 *
 * The one thing significance may never do is rescue something unobservable.
 * That is `OBSERVABILITY_GATE`'s job and it runs first, which is why a
 * once-a-decade event low in twilight still does not lead the page.
 */

export type SignificanceTier = "routine" | "good-example" | "favourable" | "notable";

export interface Significance {
  tier: SignificanceTier;
  /**
   * Why, as facts a reader could check.
   *
   * Deliberately not a score and not a grade. The brief forbids exposing a
   * crude numeric novelty value, and the reason it is the right instruction is
   * that "0.46" is unfalsifiable where "37 days from opposition" is not.
   */
  reasons: string[];
}

/** Each tier's stretch of the ordering scale. */
const TIER_BAND: Record<SignificanceTier, readonly [number, number]> = {
  routine: [0, 0.34],
  "good-example": [0.22, 0.52],
  favourable: [0.4, 0.72],
  notable: [0.6, 1],
};

export const SIGNIFICANCE_ORDER: Record<SignificanceTier, number> = {
  routine: 0,
  "good-example": 1,
  favourable: 2,
  notable: 3,
};

export const ROUTINE: Significance = { tier: "routine", reasons: [] };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The ordering value: which band, and where inside it.
 *
 * `strength` keeps its own meaning untouched — how good this opportunity is,
 * which is what quality labels and the eligibility floor are calibrated on.
 * Priority is a second value derived from it, exactly as `applySkyAccess`
 * already derives an ordering from strength without overwriting it. Two
 * different questions, two different numbers, neither pretending to be the
 * other.
 */
export function priorityFor(significance: Significance, strength: number): number {
  const [floor, ceiling] = TIER_BAND[significance.tier];
  return floor + (ceiling - floor) * clamp01(strength);
}

/* ------------------------------------------------------------- eclipses */

/**
 * How deep a partial has to be before it is an event rather than a footnote.
 *
 * A three-percent partial is a nick out of the limb that most people would not
 * notice without being told where to look, and it is in the catalogue for the
 * same reason a penumbral is: the geometry happened, not the spectacle. Twenty
 * percent is about where the bite is unmistakable to an unaided eye.
 */
export const MATERIAL_PARTIAL_OBSCURATION = 0.2;

/**
 * An eclipse, which is the case the whole model exists for.
 *
 * A total eclipse is notable without qualification: Earth's shadow swallowing
 * the Moon is visible from a given place a handful of times a decade and is the
 * most unusual thing in any night sky it happens in.
 *
 * Partials are judged on depth, because "partial lunar eclipse" covers both a
 * dark bite across most of the disc and a three-percent graze nobody would spot
 * unprompted. Treating those as equally notable put a 3% eclipse above a
 * well-placed Jupiter, which overstates a real but marginal event — and
 * overstating is the failure this whole model was introduced to stop, in the
 * other direction.
 *
 * A penumbral eclipse is rarer than a planet and almost invisible, so it sits a
 * tier down with a shallow partial. The tier still says "this is unusual", and
 * low spectacle keeps it near the bottom of that band, which is where a barely
 * perceptible shading belongs.
 */
export function lunarEclipseSignificance(
  eclipseKind: "total" | "partial" | "penumbral",
  obscurationFraction: number,
): Significance {
  const percent = Math.round(obscurationFraction * 100);
  if (eclipseKind === "total") {
    return {
      tier: "notable",
      reasons: ["The Moon passes entirely into Earth's shadow — a total lunar eclipse."],
    };
  }
  if (eclipseKind === "partial") {
    return obscurationFraction >= MATERIAL_PARTIAL_OBSCURATION
      ? {
          tier: "notable",
          reasons: [`Earth's shadow covers ${percent}% of the Moon at maximum.`],
        }
      : {
          tier: "favourable",
          reasons: [
            `Earth's shadow clips ${percent}% of the Moon at maximum — a small bite out of one edge.`,
          ],
        };
  }
  return {
    tier: "favourable",
    reasons: ["The Moon passes through the faint outer shadow only, which is subtle to see."],
  };
}

/**
 * A solar eclipse, judged on how much of the Sun goes from where the reader is.
 *
 * The threshold is where a partial eclipse stops being something only an
 * instrument notices. Below about a sixth of the disc the sky does not change
 * and nobody looking up would know it was happening.
 */
export function solarEclipseSignificance(
  eclipseKind: "total" | "annular" | "partial" | "none",
  obscurationFraction: number,
): Significance {
  const percent = Math.round(obscurationFraction * 100);
  if (eclipseKind === "total") {
    return { tier: "notable", reasons: ["The Moon covers the Sun completely from here."] };
  }
  if (eclipseKind === "annular") {
    return { tier: "notable", reasons: ["The Moon crosses the Sun's centre, leaving a ring of light."] };
  }
  if (eclipseKind === "partial" && obscurationFraction >= 0.15) {
    return { tier: "notable", reasons: [`${percent}% of the Sun is covered from here.`] };
  }
  if (eclipseKind === "partial") {
    return { tier: "favourable", reasons: [`Only ${percent}% of the Sun is covered from here.`] };
  }
  return ROUTINE;
}

/* -------------------------------------------------------------- meteors */

/** Where a shower stops being indistinguishable from the sporadic background. */
export const SHOWER_MATERIAL_PER_HOUR = 15;
/** Where a shower is producing enough that the night is about the shower. */
export const SHOWER_STRONG_PER_HOUR = 40;

/**
 * A shower, judged on what it is actually producing tonight.
 *
 * The brief's instruction is that a peak outranks ordinary background meteors,
 * and the honest reading of "peak" is the rate rather than the calendar: a
 * shower whose nominal maximum is tonight but whose radiant barely rises here
 * is not a peak from here. `perHour` already folds in radiant altitude, the
 * population index and the limiting magnitude, so it is the number that answers
 * the question the reader is asking.
 */
export function meteorSignificance(
  showerName: string | null,
  perHour: number | null,
  daysFromPeak: number | null,
): Significance {
  if (!showerName || perHour === null || perHour < SHOWER_MATERIAL_PER_HOUR) {
    return {
      tier: "routine",
      reasons: ["No shower is producing above the background rate tonight."],
    };
  }
  const atPeak = daysFromPeak !== null && Math.abs(daysFromPeak) <= 1;
  const rate = Math.round(perHour);
  if (perHour >= SHOWER_STRONG_PER_HOUR && atPeak) {
    return {
      tier: "notable",
      reasons: [`The ${showerName} are at maximum, around ${rate} an hour from here.`],
    };
  }
  if (perHour >= SHOWER_STRONG_PER_HOUR || atPeak) {
    return {
      tier: "favourable",
      reasons: [
        atPeak
          ? `The ${showerName} peak tonight, around ${rate} an hour from here.`
          : `The ${showerName} are running at around ${rate} an hour from here.`,
      ],
    };
  }
  return {
    tier: "good-example",
    reasons: [`The ${showerName} are active, around ${rate} an hour from here.`],
  };
}

/* ----------------------------------------------------------------- moon */

/**
 * The Moon's own phase, which is a calendar fact rather than an event.
 *
 * Full, First Quarter and Last Quarter recur every month and are visible for
 * days either side. The brief is explicit that a routine phase must not outrank
 * a rarer event merely for being obvious and bright, and `routine` is how that
 * is guaranteed rather than hoped for.
 *
 * Tracker does not currently model the things that genuinely distinguish one
 * Full Moon from another — perigee distance, a favourable libration, a bright
 * graze. When it does, they belong here as measured facts. Until then the gate
 * does not pretend to have them, which is why there is no "supermoon" branch.
 */
export function moonPhaseSignificance(): Significance {
  return {
    tier: "routine",
    reasons: ["A lunar phase recurs every month and is visible for several nights either side."],
  };
}

/* ---------------------------------------------------------- conjunction */

/**
 * A pairing, judged on how close the two actually get.
 *
 * Separation is the whole event. Half a degree is the Moon's own width and the
 * pair reads as one object at a glance; five degrees is two things in roughly
 * the same part of the sky, which happens constantly.
 */
export function conjunctionSignificance(separationDeg: number): Significance {
  const rounded = separationDeg < 1 ? separationDeg.toFixed(1) : Math.round(separationDeg).toString();
  if (separationDeg <= 1) {
    return {
      tier: "notable",
      reasons: [`The pair close to ${rounded}° — about the width of the Moon, or less.`],
    };
  }
  if (separationDeg <= 3) {
    return { tier: "favourable", reasons: [`The pair close to ${rounded}°, tight enough to sit together in binoculars.`] };
  }
  if (separationDeg <= 8) {
    return { tier: "good-example", reasons: [`The pair are ${rounded}° apart.`] };
  }
  return { tier: "routine", reasons: [`The pair are ${rounded}° apart, which is a wide spacing.`] };
}

/* --------------------------------------------------------------- aurora */

/**
 * Aurora, judged on whether it could be seen rather than on whether it exists.
 *
 * Aurora over the reader's own head is one of the most unusual things most
 * places ever see. Aurora on the northern horizon is a real opportunity and a
 * lesser one. A quiet oval is not an event at all, and its row exists to say so
 * rather than to be ranked.
 */
export function auroraSignificance(
  visibility: "overhead" | "horizon" | "none",
): Significance {
  if (visibility === "overhead") {
    return { tier: "notable", reasons: ["NOAA puts the auroral oval over this location."] };
  }
  if (visibility === "horizon") {
    return { tier: "favourable", reasons: ["The oval is close enough to show above the northern horizon."] };
  }
  return { tier: "routine", reasons: ["The oval is too far away to be seen from here tonight."] };
}

/* -------------------------------------------------------------- planets */

/**
 * The measured state a planet is in tonight.
 *
 * Every field is read from the ephemeris rather than assigned. That is the
 * point: the brief asks for "event-specific factors" and warns against
 * "arbitrary novelty bonuses", and the difference between the two is whether
 * the number would change if the sky did.
 */
export interface PlanetState {
  body: string;
  /**
   * Days to the next opposition, negative, or since the last, positive —
   * whichever is nearer. Null for Venus and Mercury, which never reach
   * opposition because their orbits are inside Earth's.
   */
  daysFromOpposition: number | null;
  /** Apparent visual magnitude now. Lower is brighter. */
  magnitude: number;
  /** The brightest this body gets, from its own range. */
  brightestMagnitude: number;
  /** Apparent equatorial diameter now, in arcseconds. */
  apparentDiameterArcsec: number;
  /** This body's own smallest and largest apparent diameters. */
  diameterRangeArcsec: readonly [number, number];
  /** The highest it reaches in the observing period, in degrees. */
  peakAltitudeDeg: number;
  /** How long it is usefully placed, in minutes. */
  usefulWindowMinutes: number;
  /**
   * Saturn only: the tilt of the ring plane as seen from Earth, in degrees.
   *
   * Zero is edge-on and the rings all but vanish; about 27 is fully open. The
   * cycle takes about fifteen years, so both extremes are genuinely unusual
   * presentations of a planet that is otherwise up for months at a time.
   */
  ringTiltDeg: number | null;
}

/** Within three weeks of opposition a superior planet is at its practical best. */
export const NEAR_OPPOSITION_DAYS = 21;
/** Inside two months it is already noticeably larger and brighter than usual. */
export const APPROACHING_OPPOSITION_DAYS = 60;
/** Above this a target has cleared the haze and most obstructions. */
export const WELL_PLACED_ALTITUDE_DEG = 30;
/** Within this of its own best, a planet is as bright as it ever gets. */
const BRIGHT_TOLERANCE_MAG = 0.35;
/** Rings this closed are a ring-plane crossing, which happens twice in ~15 years. */
export const RINGS_EDGE_ON_DEG = 3;
/** Rings this open are the presentation people are shown in photographs. */
export const RINGS_WIDE_OPEN_DEG = 20;

function fractionOfRange(value: number, [low, high]: readonly [number, number]): number {
  if (high === low) return 0;
  return clamp01((value - low) / (high - low));
}

/**
 * A recurring planet, and how good *this* showing of it is.
 *
 * "Saturn is visible tonight" and "Saturn is three weeks from opposition, forty
 * degrees up, with the rings well open" are the same object and different
 * events, and the brief is that the second must rank materially above the
 * first. Everything consulted here is a reason the second is actually better to
 * look at:
 *
 * - **Opposition proximity** — nearest to Earth, fully lit, and up all night.
 * - **Apparent size**, measured against the body's own range, because Mars at
 *   25″ and Mars at 4″ are not the same experience through anything.
 * - **Brightness**, against the body's own best rather than an absolute scale.
 * - **Altitude**, because a planet in the murk is a planet you cannot resolve.
 * - **Window length**, because a thirty-minute pre-dawn gap is not an evening.
 * - **Ring presentation** for Saturn, at both extremes: wide open is the view
 *   people hope for, and edge-on is a rarer sight than either.
 */
export function planetSignificance(state: PlanetState): Significance {
  const reasons: string[] = [];
  const near =
    state.daysFromOpposition !== null &&
    Math.abs(state.daysFromOpposition) <= NEAR_OPPOSITION_DAYS;
  const approaching =
    state.daysFromOpposition !== null &&
    Math.abs(state.daysFromOpposition) <= APPROACHING_OPPOSITION_DAYS;
  const wellPlaced = state.peakAltitudeDeg >= WELL_PLACED_ALTITUDE_DEG;
  const large = fractionOfRange(state.apparentDiameterArcsec, state.diameterRangeArcsec) >= 0.75;
  const bright = state.magnitude <= state.brightestMagnitude + BRIGHT_TOLERANCE_MAG;
  const longWindow = state.usefulWindowMinutes >= 180;
  const ringsEdgeOn = state.ringTiltDeg !== null && Math.abs(state.ringTiltDeg) <= RINGS_EDGE_ON_DEG;
  const ringsOpen = state.ringTiltDeg !== null && Math.abs(state.ringTiltDeg) >= RINGS_WIDE_OPEN_DEG;

  if (state.daysFromOpposition !== null) {
    const days = Math.round(Math.abs(state.daysFromOpposition));
    if (near) {
      reasons.push(
        days <= 1
          ? `${state.body} is at opposition — closest to Earth, fully lit, and up all night.`
          : `${state.body} is ${days} days from opposition, so it is near its closest and brightest.`,
      );
    } else if (approaching) {
      reasons.push(
        `${state.body} is ${days} days from opposition and already larger and brighter than usual.`,
      );
    }
  }
  if (large) {
    reasons.push(
      `It shows ${state.apparentDiameterArcsec.toFixed(1)}″ across, near the largest it ever appears.`,
    );
  }
  if (bright) {
    reasons.push(`At magnitude ${state.magnitude.toFixed(1)} it is as bright as it gets.`);
  }
  if (wellPlaced) {
    reasons.push(`It reaches ${Math.round(state.peakAltitudeDeg)}° from here, clear of the horizon murk.`);
  }
  if (ringsEdgeOn) {
    reasons.push(
      `The rings are ${Math.abs(state.ringTiltDeg!).toFixed(1)}° from edge-on and nearly disappear — a presentation that comes round about twice every fifteen years.`,
    );
  } else if (ringsOpen) {
    reasons.push(`The rings are tilted ${Math.abs(state.ringTiltDeg!).toFixed(0)}° towards us and wide open.`);
  }

  /**
   * A ring-plane crossing is unusual in its own right, whatever else is true.
   * It is the one planetary circumstance here that is genuinely rare rather
   * than merely favourable, so it is the one that can reach `notable` alone.
   */
  if (ringsEdgeOn && wellPlaced) return { tier: "notable", reasons };

  if (near && wellPlaced && (large || bright)) return { tier: "favourable", reasons };
  if (near && wellPlaced) return { tier: "favourable", reasons };
  if (approaching && wellPlaced && (large || bright || ringsOpen)) {
    return { tier: "favourable", reasons };
  }
  if (wellPlaced && (approaching || bright || ringsOpen || longWindow)) {
    return { tier: "good-example", reasons };
  }
  if (near) return { tier: "good-example", reasons };
  return {
    tier: "routine",
    reasons: reasons.length > 0 ? reasons : [`${state.body} is up tonight, as it is for much of the year.`],
  };
}

/* ------------------------------------------------------------- deep sky */

export function deepSkySignificance(peakAltitudeDeg: number): Significance {
  if (peakAltitudeDeg >= 50) {
    return {
      tier: "good-example",
      reasons: [`It climbs to ${Math.round(peakAltitudeDeg)}°, which is as well placed as it gets from here.`],
    };
  }
  return ROUTINE;
}
