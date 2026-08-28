import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MakeTime,
  Observer,
  SearchLunarEclipse,
} from "astronomy-engine";
import type { ObservationPeriod } from "./observationPeriod";
import {
  meteorNight,
  cadenceDescription,
  cadenceRangeDescription,
  compassPoint,
  describeCharacter,
} from "./meteorActivity";
import type { Opportunity, PhenomenonGeometry } from "./opportunity";
import type { OpportunitySample } from "./conditions";
import { lunarPhaseAt } from "./lunarPhase";
import { lunarEclipseTiming } from "./lunarEclipse";
import { angularSeparation, nearestOpposition, oppositionDuring } from "./planetaryEvents";
import {
  conjunctionSignificance,
  lunarEclipseSignificance,
  meteorSignificance,
  moonPhaseSignificance,
  planetSignificance,
  type PlanetState,
} from "./significance";

/**
 * The phenomena Tracker can offer tonight, each turned into an `Opportunity`.
 *
 * Every phenomenon defines its own observability, expected appearance, guidance
 * and reliability, which V1 §7.5 requires of anything added here. The qualities
 * a phenomenon reports are the ones the ranking uses and the ones the
 * explanation is written from, so a phenomenon that reports flattering numbers
 * will be flatteringly ranked — the honesty has to live at this layer.
 *
 * What is here: meteors, the Moon, the naked-eye planets, close conjunctions,
 * and lunar eclipses. All of it is geometry or a vendored catalogue, computed on
 * the device, which is why it costs nothing to serve (V1 §10).
 *
 * What is not here: satellite passes (V1 §7.1) and aurora (V1 §7.3). Both are
 * Confirmed V1 requirements and neither can be computed from what ships in the
 * bundle — passes need current orbital elements, aurora needs a nowcast. See the
 * note in `docs/TRACKER_V1_PRD.md`; they are absent, not quietly faked.
 */

const MS_PER_MINUTE = 60_000;
const SAMPLE_INTERVAL_MINUTES = 15;

interface Placement {
  atUtc: string;
  altitudeDeg: number;
  azimuthDeg: number;
}

function horizontal(observer: Observer, body: Body, at: Date) {
  const time = MakeTime(at);
  const equator = Equator(body, time, observer, true, true);
  return Horizon(time, observer, equator.ra, equator.dec, "normal");
}

function sunAltitude(observer: Observer, at: Date): number {
  return horizontal(observer, Body.Sun, at).altitude;
}

/**
 * Instants worth evaluating a target at.
 *
 * `darkOnly` separates the two cases honestly: a meteor or a galaxy needs real
 * darkness, while the Moon and Venus are perfectly good in twilight, and
 * requiring darkness for them would hide the best planetary evenings of the
 * year behind a rule that does not apply to them.
 */
function sampleTimes(
  observer: Observer,
  period: ObservationPeriod,
  darkOnly: boolean,
): Date[] {
  const start = Date.parse(period.startUtc);
  const end = Date.parse(period.endUtc);
  const times: Date[] = [];
  for (let stamp = start; stamp <= end; stamp += SAMPLE_INTERVAL_MINUTES * MS_PER_MINUTE) {
    const at = new Date(stamp);
    const altitude = sunAltitude(observer, at);
    if (darkOnly ? altitude <= -12 : altitude <= -3) times.push(at);
  }
  return times;
}

/** Where a body is at its highest across the sampled times. */
function bestPlacement(observer: Observer, body: Body, times: Date[]): Placement | null {
  let best: Placement | null = null;
  for (const at of times) {
    const position = horizontal(observer, body, at);
    if (!best || position.altitude > best.altitudeDeg) {
      best = {
        atUtc: at.toISOString(),
        altitudeDeg: position.altitude,
        azimuthDeg: position.azimuth,
      };
    }
  }
  return best && best.altitudeDeg > 0 ? best : null;
}

/**
 * How observable something at this altitude is.
 *
 * Nothing below about 10° is worth recommending — that is where trees, houses
 * and the thickest air are — and above about 40° the altitude has stopped being
 * the limiting factor.
 */
function altitudeObservability(altitudeDeg: number): number {
  if (altitudeDeg <= 5) return 0;
  return Math.min(1, (altitudeDeg - 5) / 35);
}

/**
 * How good a positional target is across the night, relative to its own best.
 *
 * Altitude is the whole story for a planet or the Moon: the same object is a
 * different proposition at 8° and at 50°, because of what it is being seen
 * through. Normalising to its own best is what lets weather be applied against
 * the shape of the night rather than a single instant.
 */
function altitudeProfile(observer: Observer, body: Body, times: Date[]): OpportunitySample[] {
  // Both coordinates are kept. The azimuth was being discarded here, one line
  // after being computed, which is why the sky drawing had no bearing to plot
  // and the interface could only say "south" in a sentence.
  const raw = times.map((at) => {
    const { altitude, azimuth } = horizontal(observer, body, at);
    return { atUtc: at.toISOString(), altitude, azimuth };
  });
  const peak = raw.reduce((best, entry) => Math.max(best, entry.altitude), 0);
  if (peak <= 0) return [];
  return raw.map((entry) => ({
    atUtc: entry.atUtc,
    relative: Math.max(0, entry.altitude) / peak,
    altitudeDeg: entry.altitude,
    azimuthDeg: entry.azimuth,
  }));
}

/**
 * Rise, culmination and set, read off a profile that now carries altitude.
 *
 * Derived from the samples rather than searched for separately, so the three
 * marks cannot disagree with the curve drawn through them. A separate
 * ephemeris search would be more precise than the sample interval and would
 * sometimes put the rise mark visibly off the point where the drawn path
 * crosses the horizon, which reads as a bug whichever one is right.
 *
 * Any of the three may be null: an object already up at dusk never rises during
 * the period, and one that stays up never sets.
 */
function targetGeometry(profile: OpportunitySample[]): PhenomenonGeometry | undefined {
  const withAltitude = profile.filter((sample) => sample.altitudeDeg !== undefined);
  if (withAltitude.length === 0) return undefined;

  let riseUtc: string | null = null;
  let setUtc: string | null = null;
  for (let index = 1; index < withAltitude.length; index += 1) {
    const previous = withAltitude[index - 1].altitudeDeg as number;
    const current = withAltitude[index].altitudeDeg as number;
    if (previous <= 0 && current > 0 && riseUtc === null) riseUtc = withAltitude[index].atUtc;
    if (previous > 0 && current <= 0 && setUtc === null) setUtc = withAltitude[index].atUtc;
  }

  const highest = withAltitude.reduce((best, sample) =>
    (sample.altitudeDeg as number) > (best.altitudeDeg as number) ? sample : best,
  );
  // Only a culmination if it actually turns over inside the period. A target
  // still climbing at sunrise has its maximum at the last sample, which is the
  // end of the window rather than the top of its arc.
  const isInterior =
    highest !== withAltitude[0] && highest !== withAltitude[withAltitude.length - 1];

  return {
    kind: "target",
    riseUtc,
    setUtc,
    culminationUtc: isInterior ? highest.atUtc : null,
  };
}

/**
 * An altitude in fists at arm's length, which is how people actually point.
 *
 * A fist held out is close to ten degrees for almost everyone, tall or short,
 * because the ratio of arm to hand barely varies. "About 40 degrees up" means
 * nothing to most readers; "four fists above the horizon" can be done standing
 * in a garden in the dark.
 */
export function elevationInFists(altitudeDeg: number): string {
  const fists = Math.round(altitudeDeg / 10);
  if (altitudeDeg >= 75) return "almost straight overhead";
  if (fists <= 1) return "one fist above the horizon at arm's length";
  return `${fists} fists above the horizon at arm's length`;
}

/** Hours from local midnight, as a cost. Nobody enjoys a 4am alarm. */
function timingEase(atUtc: string, period: ObservationPeriod): number {
  const middle = (Date.parse(period.startUtc) + Date.parse(period.endUtc)) / 2;
  const hoursFromMidnight = Math.abs(Date.parse(atUtc) - middle) / 3_600_000;
  // Early evening is the easiest time to go outside, the small hours the worst.
  const isEvening = Date.parse(atUtc) < middle;
  const penalty = isEvening ? hoursFromMidnight / 12 : hoursFromMidnight / 6;
  return Math.max(0.15, 1 - penalty);
}

function formatTime(iso: string): string {
  return `${iso.slice(11, 16)} UTC`;
}

/* ------------------------------------------------------------------ meteors */

function meteorOpportunity(
  latitudeDeg: number,
  longitudeDeg: number,
  period: ObservationPeriod,
): Opportunity | null {
  const night = meteorNight(latitudeDeg, longitudeDeg, period);
  if (!night.best) return null;

  const rate = night.best.totalPerHour;
  const headline = night.headline;
  const [low, high] = night.ratePerHourRange ?? [rate, rate];

  // The rate is what decides whether this is worth anyone's evening, so it
  // drives spectacle directly rather than the shower's name doing it. A famous
  // shower washed out by a full Moon is not a good night, and should not read
  // like one.
  const spectacle = Math.min(1, Math.log10(1 + rate) / Math.log10(80));
  const observability = Math.min(1, Math.log10(1 + rate) / Math.log10(15));

  const title = headline
    ? `${headline.name}${Math.abs(headline.daysFromPeak) < 0.75 ? " at their peak" : ""}`
    : "Meteors";

  const direction = headline
    ? `anywhere, but keep the ${compassPoint(headline.radiantAzimuthDeg)} sky in view`
    : null;

  // The cadence describes the same range the sentence quotes. It used to quote
  // the range and then describe the felt rhythm from its low end alone, which
  // characterised "6-16 an hour" as "one every 10 minutes" — true of 6, and
  // wrong by more than half for 16.
  const summary = headline
    ? `Around ${Math.round(low)}–${Math.round(high)} meteors an hour at best — ${cadenceRangeDescription(low, high)}.`
    : `A quiet sky: ${cadenceDescription(low)} from the background alone.`;

  const phenomenon = headline
    ? `Earth is crossing a trail of dust left behind by ${
        headline.code === "GEM"
          ? "3200 Phaethon, an asteroid that sheds material like a comet"
          : "a comet"
      }. The grains hit the atmosphere at ${Math.round(headline.speedKmS)} km/s and burn up 80–100 km overhead. They appear to come from one point because they are all travelling on parallel paths, the same reason railway tracks seem to meet.`
    : "On any night, Earth sweeps up dust that belongs to no identified stream. These sporadic meteors arrive from every direction and are most of what you see when no shower is running.";

  const tonight = headline
    ? `The radiant is ${Math.round(headline.radiantAltitudeDeg)}° up at ${formatTime(
        night.best.atUtc,
      )}, ${Math.abs(headline.daysFromPeak) < 0.75 ? "the shower is at maximum" : `${Math.abs(headline.daysFromPeak).toFixed(0)} days ${headline.daysFromPeak < 0 ? "before" : "after"} maximum`}, and the sky reaches magnitude ${night.best.limitingMagnitude.toFixed(1)}${
        night.best.moonAltitudeDeg > 0
          ? ` with the Moon ${Math.round(night.best.moonIlluminatedFraction * 100)}% lit and up`
          : " with no Moon in the way"
      }.`
    : `No shower is running. The background rate rises towards dawn as your side of Earth turns to face the direction it is travelling, which is why ${formatTime(night.best.atUtc)} is the best of a quiet night.`;

  return {
    id: "meteors",
    kind: "meteors",
    title,
    summary,
    qualities: {
      observability,
      spectacle,
      // A meteor is unmistakable. There is nothing to learn to recognise.
      recognisability: 0.95,
      ease: timingEase(night.best.atUtc, period) * 0.8,
      // Geometry and darkness are certain; how many actually fall is not.
      confidence: 0.55,
      rarity: headline ? Math.min(1, headline.zhrTonight / 100) : 0.05,
    },
    // What the shower is actually producing here, which is the number that
    // decides whether tonight is a meteor night or a night that happens to have
    // meteors in it.
    significance: meteorSignificance(
      headline?.name ?? null,
      // The headline shower's own contribution, never the total: the sporadic
      // background is exactly what this is trying to distinguish itself from,
      // so counting it would let a quiet night look like an active one.
      headline?.perHour ?? null,
      headline?.daysFromPeak ?? null,
    ),
    guidance: {
      appearance: headline
        ? `Brief streaks lasting a fraction of a second — ${describeCharacter(headline.character, headline.speedKmS)}. Nothing like the long trails in photographs, which are built from many minutes of exposure.`
        : "Occasional brief streaks, most of them faint.",
      whenUtc: night.best.atUtc,
      durationMinutes: 60,
      direction,
      /**
       * Radiant guidance only where there is a radiant.
       *
       * This string was unconditional, so a night with no active shower — where
       * the panel correctly says "no radiant tonight, so no direction to face"
       * — also told the reader not to look straight at the radiant and what
       * meteors near it would look like. Two sentences in one panel, one of
       * them about something that does not exist.
       */
      elevation: headline
        ? "About two-thirds of the way up, and not straight at the radiant. Meteors close to it are coming towards you, so they look like dots instead of streaks."
        : "Anywhere. Sporadic meteors come from all over the sky, so take in as much of it as you can rather than watching one spot.",
      howLong: "An hour at least. Rates are averages, and meteors arrive in clumps and gaps.",
      equipment: "eyes",
      technique: headline
        ? "Give your eyes 20 minutes to adapt and stay off your phone. Lie back or use a reclining chair — you will last much longer than standing and craning your neck."
        : "Give your eyes 20 minutes to adapt and stay off your phone. Lie back so you can see a wide stretch of sky at once.",
      safety: null,
    },
    phenomenon,
    tonight,
    missingInputs: night.missingInputs,
    limitations: night.limitations,
    profile: (() => {
      const peak = night.samples.reduce((best, sample) => Math.max(best, sample.totalPerHour), 0);
      if (peak <= 0) return [];
      // No altitude or azimuth: a shower is not somewhere you look. The rate is
      // the quality curve, and the radiant travels separately in `geometry`.
      return night.samples.map((sample) => ({
        atUtc: sample.atUtc,
        relative: sample.totalPerHour / peak,
      }));
    })(),
    geometry: headline ? { kind: "radiant", track: headline.radiantTrack } : undefined,
    // The most demanding thing here. Faint meteors are the majority of any
    // stream, and they are the first thing thin cloud or smoke takes away.
    transparency: "high",
  };
}

/* -------------------------------------------------------------------- Moon */

function moonOpportunity(observer: Observer, period: ObservationPeriod): Opportunity | null {
  const times = sampleTimes(observer, period, false);
  if (times.length === 0) return null;
  const placement = bestPlacement(observer, Body.Moon, times);
  const periodMiddle = new Date((Date.parse(period.startUtc) + Date.parse(period.endUtc)) / 2);
  const phase = lunarPhaseAt(placement ? new Date(placement.atUtc) : periodMiddle);
  const fraction = Number(phase.illuminatedFraction);
  const phaseName = phase.name;
  const isNewMoon = phaseName === "New Moon";
  if (!placement && !isNewMoon) return null;

  // The terminator is where the Moon is worth looking at: craters near the
  // day-night line throw long shadows and stand up in relief. A full Moon is
  // bright and flat, which is the opposite of what most people expect.
  const nearTerminator = 1 - Math.abs(fraction - 0.5) * 2;
  const spectacle = 0.25 + 0.45 * nearTerminator;
  const earthshine = fraction < 0.25;
  // Bound once so the profile and the geometry read off the same samples.
  const moonProfile = placement
    ? altitudeProfile(observer, Body.Moon, times)
    : times.map((at) => ({ atUtc: at.toISOString(), relative: 1 }));
  const direction = placement ? compassPoint(placement.azimuthDeg) : null;
  const whenUtc = placement?.atUtc ?? periodMiddle.toISOString();

  return {
    id: "moon",
    kind: "moon",
    title: phaseName === "First Quarter" || phaseName === "Last Quarter" || phaseName === "Full Moon"
      ? `The ${phaseName}`
      : phaseName === "New Moon"
        // Named for what it offers. "New Moon" alone reads as a thing to look
        // at, and the one certainty about a New Moon is that there is nothing
        // to look at.
        ? "New Moon — darkest skies"
        : `The Moon, a ${phaseName.toLowerCase()}`,
    summary: isNewMoon
      ? "The Moon is near the Sun and absent from the night sky, leaving the darkest lunar conditions of the month."
      : earthshine
      ? "A thin crescent, with the dark part glowing faintly — that glow is Earth, shining back."
      : nearTerminator > 0.5
        ? "Craters along the day-night line stand up in relief. The best night of the month for binoculars."
        : "Big, bright and impossible to miss.",
    qualities: {
      observability: isNewMoon ? 0.45 : Math.min(1, altitudeObservability(placement!.altitudeDeg) + 0.3),
      spectacle: isNewMoon ? 0.15 : spectacle,
      recognisability: isNewMoon ? 0.2 : 1,
      ease: isNewMoon ? 0.8 : timingEase(placement!.atUtc, period),
      confidence: 1,
      rarity: 0.02,
    },
    // A phase is a calendar fact rather than an event. The brief is explicit
    // that a routine Moon must not outrank a rarer thing merely for being
    // bright and obvious, and this is where that is guaranteed.
    significance: moonPhaseSignificance(),
    guidance: {
      appearance: isNewMoon
        ? "The Moon itself is not visible at night. Its absence makes faint stars and meteors easier to see."
        : earthshine
        ? "A bright crescent with the unlit part glowing faintly grey — that is sunlight reflected off Earth, onto the Moon, and back again."
        : nearTerminator > 0.5
          ? "Craters along the day-night line stand out in relief, with shadows long enough to see with binoculars."
          : "A bright, flat disc. Detail is hard to see when the Sun is overhead on the Moon.",
      whenUtc,
      durationMinutes: 120,
      direction,
      elevation: isNewMoon
        ? "There is no lunar target to point at tonight."
        : `${elevationInFists(placement!.altitudeDeg)[0].toUpperCase()}${elevationInFists(placement!.altitudeDeg).slice(1)}.`,
      howLong: isNewMoon
        ? "Use the moonless darkness for faint targets across the night."
        : "A few minutes with your eyes; longer if you have binoculars.",
      equipment: "eyes",
      technique: isNewMoon
        ? "Let your eyes adapt for 20 minutes and keep bright screens away."
        : nearTerminator > 0.4
        ? "Look along the terminator, the line between lit and unlit. Everything interesting is there."
        : null,
      safety: null,
    },
    phenomenon:
      "The Moon shows a phase because you are seeing a sphere lit from one side, from a changing angle as it goes round Earth. The phase is not Earth's shadow — that only happens during a lunar eclipse.",
    tonight: isNewMoon
      ? `New Moon, ${Math.round(fraction * 100)}% lit. The Moon is not a visible target; the opportunity is the darker sky.`
      : `${phaseName}, ${Math.round(fraction * 100)}% lit, best after dusk at ${formatTime(placement!.atUtc)} about ${Math.round(placement!.altitudeDeg)}° above the ${compassPoint(placement!.azimuthDeg)} horizon.`,
    missingInputs: [],
    limitations: fraction > 0.6
      ? ["A Moon this bright drowns out faint objects tonight, meteors included."]
      : isNewMoon
        ? ["New Moon is a dark-sky condition, not a visible lunar target."]
        : [],
    science: { kind: "lunar-phase", phase },
    profile: moonProfile,
    geometry: placement ? targetGeometry(moonProfile) : undefined,
    // The Moon is visible through cloud that would end everything else.
    transparency: "low",
    sceneHints: { illuminatedFraction: fraction, waning: phase.waning },
  };
}

/* ----------------------------------------------------------------- planets */

interface PlanetProfile {
  body: Body;
  name: string;
  /** Plain language. What someone is being invited to go and see. */
  invitation: string;
  /** What is actually worth seeing, and with what. */
  telescopeTarget?: { title: string; appearance: string; equipment: "binoculars" | "telescope"; technique: string };
  phenomenon: string;
}

const PLANETS: PlanetProfile[] = [
  {
    body: Body.Venus,
    name: "Venus",
    invitation: "The brightest thing in the sky after the Sun and Moon. You cannot miss it.",
    phenomenon:
      "Venus orbits inside Earth's orbit, so it never strays far from the Sun and shows phases like the Moon. It is the brightest thing in the sky after the Sun and Moon because its cloud deck reflects three-quarters of the light that hits it.",
  },
  {
    body: Body.Mars,
    name: "Mars",
    invitation: "The orange one. Obviously coloured once you spot it, even from a city.",
    phenomenon:
      "Mars is obviously orange to the naked eye because its surface is covered in iron oxide dust. Its brightness swings enormously — Earth laps it every 26 months, and between those passes it recedes to more than seven times the distance.",
  },
  {
    body: Body.Jupiter,
    name: "Jupiter",
    invitation: "Bright enough to find in seconds, and steady binoculars show its four moons.",
    telescopeTarget: {
      title: "Jupiter's moons",
      appearance:
        "Up to four tiny points in a line either side of the planet, changing places from night to night. Not discs — points.",
      equipment: "binoculars",
      technique: "Steady the binoculars against a wall or a fence. Hand-held, the moons blur into the glare.",
    },
    phenomenon:
      "Jupiter is a gas giant more massive than every other planet combined. The four points beside it are the Galilean moons, the objects Galileo watched circle it in 1610 — the first thing ever seen to orbit something other than Earth.",
  },
  {
    body: Body.Saturn,
    name: "Saturn",
    invitation: "A quiet yellow point to your eyes — and the rings through any small telescope.",
    telescopeTarget: {
      title: "Saturn's rings",
      appearance:
        "A small pale oval, not the poster. At low power the rings just make the planet look stretched; at higher power they separate into an unmistakable ring. Most people find it the best thing they have seen through a telescope anyway.",
      equipment: "telescope",
      technique: "Any telescope over about 60 mm shows them. Wait for a moment of steady air — the view sharpens and softens as the atmosphere moves.",
    },
    phenomenon:
      "Saturn's rings are billions of chunks of water ice, most of them smaller than a house, spread into a sheet only tens of metres thick. Earth's changing angle on them means they open and close over a 15-year cycle, and edge-on they nearly vanish.",
  },
];

/**
 * The physical constants behind "is this an unusually good showing".
 *
 * Equatorial radii are IAU values; the geocentric distance ranges are the
 * standard perigee/apogee extremes for each planet. Both are properties of the
 * solar system rather than of Tracker, which is the point — the apparent
 * diameter tonight is computed from the ephemeris distance, and these say what
 * that number should be measured against. A planet is "large" when it is large
 * *for itself*, because 45″ is enormous for Mars and edge-on invisible for
 * Jupiter.
 *
 * `brightestMagnitude` is the brightest each body is known to get. Saturn's
 * −0.55 belongs to a wide-open ring presentation; with the rings closed its own
 * best opposition is nearer +0.5, so the test correctly reports that a
 * ring-plane-crossing Saturn is not as bright as Saturn gets.
 */
const PLANET_PHYSICAL: Record<
  string,
  { radiusKm: number; distanceRangeAu: readonly [number, number]; brightestMagnitude: number }
> = {
  Venus: { radiusKm: 6051.8, distanceRangeAu: [0.265, 1.735], brightestMagnitude: -4.9 },
  Mars: { radiusKm: 3396.2, distanceRangeAu: [0.372, 2.68], brightestMagnitude: -2.94 },
  Jupiter: { radiusKm: 71492, distanceRangeAu: [3.95, 6.45], brightestMagnitude: -2.94 },
  Saturn: { radiusKm: 60268, distanceRangeAu: [8.03, 11.09], brightestMagnitude: -0.55 },
};

const AU_KM = 149_597_870.7;
const ARCSEC_PER_RADIAN = 206_264.806;

/** Apparent equatorial diameter in arcseconds at a geocentric distance. */
function apparentDiameterArcsec(radiusKm: number, distanceAu: number): number {
  return 2 * Math.atan(radiusKm / (distanceAu * AU_KM)) * ARCSEC_PER_RADIAN;
}

/**
 * How long a target is usefully placed, in minutes.
 *
 * "Usefully" is above ten degrees, which is where it has cleared the worst of
 * the horizon murk and most suburban obstructions. The number matters because a
 * thirty-minute pre-dawn gap and a five-hour evening are different offers even
 * when the planet is identical.
 */
function usefulWindowMinutes(profile: { atUtc: string }[], observer: Observer, body: Body): number {
  let minutes = 0;
  for (let index = 1; index < profile.length; index += 1) {
    const at = new Date(profile[index].atUtc);
    if (horizontal(observer, body, at).altitude >= 10) {
      minutes += (Date.parse(profile[index].atUtc) - Date.parse(profile[index - 1].atUtc)) / MS_PER_MINUTE;
    }
  }
  return minutes;
}

/**
 * Everything about tonight's showing of one planet that could make it unusual.
 *
 * Read from the ephemeris, every field. The brief's warning is against
 * "arbitrary novelty bonuses", and the test of whether a factor is arbitrary is
 * whether it would change if the sky changed — each of these would.
 */
function planetState(
  observer: Observer,
  body: Body,
  name: string,
  at: Date,
  placement: Placement,
  profile: OpportunitySample[],
): PlanetState | null {
  const physical = PLANET_PHYSICAL[name];
  if (!physical) return null;
  const illumination = Illumination(body, MakeTime(at));
  const [near, far] = physical.distanceRangeAu;
  let peakAltitudeDeg = placement.altitudeDeg;
  for (const sample of profile) {
    if (sample.altitudeDeg !== undefined && sample.altitudeDeg > peakAltitudeDeg) {
      peakAltitudeDeg = sample.altitudeDeg;
    }
  }
  return {
    body: name,
    daysFromOpposition: nearestOpposition(body, at),
    magnitude: illumination.mag,
    brightestMagnitude: physical.brightestMagnitude,
    apparentDiameterArcsec: apparentDiameterArcsec(physical.radiusKm, illumination.geo_dist),
    // Largest at perigee, smallest at apogee — so the range is built from the
    // distance extremes rather than quoted separately and allowed to drift.
    diameterRangeArcsec: [
      apparentDiameterArcsec(physical.radiusKm, far),
      apparentDiameterArcsec(physical.radiusKm, near),
    ],
    peakAltitudeDeg,
    usefulWindowMinutes: usefulWindowMinutes(profile, observer, body),
    // Undefined for every body but Saturn, which is what the ephemeris means by
    // "this body has no ring plane to tilt".
    ringTiltDeg: illumination.ring_tilt ?? null,
  };
}

function planetOpportunities(observer: Observer, period: ObservationPeriod): Opportunity[] {
  const times = sampleTimes(observer, period, false);
  if (times.length === 0) return [];
  const opportunities: Opportunity[] = [];

  for (const profile of PLANETS) {
    const placement = bestPlacement(observer, profile.body, times);
    if (!placement) continue;
    const planetProfile = altitudeProfile(observer, profile.body, times);
    const at = new Date(placement.atUtc);
    const magnitude = Illumination(profile.body, MakeTime(at)).mag;

    // Brighter than about magnitude 2 and it is obvious; fainter than 4 and a
    // city observer will not pick it out at all.
    const brightness = Math.min(1, Math.max(0, (3.5 - magnitude) / 5));
    const observability = altitudeObservability(placement.altitudeDeg);
    if (observability <= 0) continue;

    const target = profile.telescopeTarget;
    const physicalEvent = oppositionDuring(profile.body, period.startUtc, period.endUtc);
    const state = planetState(observer, profile.body, profile.name, at, placement, planetProfile);
    // Saturn and "Saturn's rings" used to be two entries, ranked separately and
    // reading as unrelated events. They are one thing in the sky: a point you
    // can find with your eyes, which becomes a ringed planet through a
    // telescope. One card, two ways to look at it.
    opportunities.push({
      id: `planet-${profile.name.toLowerCase()}`,
      kind: "planet",
      title: profile.name,
      summary: profile.invitation,
      qualities: {
        observability,
        // The telescope view is part of what makes a planet worth the trip, so
        // it lifts the spectacle of the one entry rather than competing with it
        // — but only a little. A more generous bump pushed Jupiter on an
        // ordinary March evening into the "exceptional" band, which is the word
        // held back for a total lunar eclipse and exactly the overclaiming the
        // band thresholds were retuned to stop.
        spectacle: Math.min(0.62, brightness * 0.5 + (target ? 0.12 : 0)),
        recognisability: 0.45 + brightness * 0.4,
        ease: timingEase(placement.atUtc, period),
        confidence: 1,
        rarity: 0.05,
      },
      /**
       * What is unusual about *this* showing, from the ephemeris.
       *
       * "Saturn is visible tonight" and "Saturn is three weeks from opposition,
       * forty degrees up, with the rings well open" are the same object and
       * different opportunities, and this is what tells them apart. Null state
       * would fall back to routine, which is the honest default for a body with
       * no physical constants recorded.
       */
      significance: state ? planetSignificance(state) : undefined,
      guidance: {
        appearance: `A steady point of light, ${profile.name === "Mars" ? "distinctly orange" : profile.name === "Venus" ? "brilliant white" : "creamy white"}. Planets hold still while stars twinkle — that is how to tell them apart.`,
        whenUtc: placement.atUtc,
        durationMinutes: 90,
        direction: compassPoint(placement.azimuthDeg),
        elevation: `About ${Math.round(placement.altitudeDeg)}° up — roughly ${elevationInFists(placement.altitudeDeg)}.`,
        howLong: "A minute to find it. Longer if you have something to look through.",
        equipment: "eyes",
        technique: null,
        safety: null,
      },
      phenomenon: profile.phenomenon,
      tonight: `Highest at ${formatTime(placement.atUtc)}, ${Math.round(placement.altitudeDeg)}° above the ${compassPoint(placement.azimuthDeg)} horizon, at magnitude ${magnitude.toFixed(1)}.`,
      missingInputs: [],
      limitations: target
        ? [
            "No promise is made about what a particular instrument will show — aperture, magnification and the steadiness of the air all change it.",
          ]
        : [],
      science: { kind: "planet", body: profile.name, event: physicalEvent, state },
      profile: planetProfile,
      geometry: targetGeometry(planetProfile),
      transparency: "low",
      alsoWith: target
        ? {
            equipment: target.equipment,
            lead:
              target.equipment === "telescope"
                ? "Through a telescope"
                : "Through binoculars",
            appearance: target.appearance,
            technique: target.technique,
          }
        : undefined,
    });
  }

  return opportunities;
}

/* ------------------------------------------------------------ conjunctions */

const CONJUNCTION_BODIES: { body: Body; name: string }[] = [
  { body: Body.Moon, name: "the Moon" },
  { body: Body.Venus, name: "Venus" },
  { body: Body.Mars, name: "Mars" },
  { body: Body.Jupiter, name: "Jupiter" },
  { body: Body.Saturn, name: "Saturn" },
];

/** Pairs closer than this are worth pointing out. */
const CONJUNCTION_LIMIT_DEG = 6;

function conjunctionOpportunities(observer: Observer, period: ObservationPeriod): Opportunity[] {
  const times = sampleTimes(observer, period, false);
  if (times.length === 0) return [];
  const opportunities: Opportunity[] = [];

  for (let i = 0; i < CONJUNCTION_BODIES.length; i += 1) {
    for (let j = i + 1; j < CONJUNCTION_BODIES.length; j += 1) {
      const first = CONJUNCTION_BODIES[i];
      const second = CONJUNCTION_BODIES[j];

      let best: { at: Date; separation: number; altitude: number; azimuth: number } | null = null;
      for (const at of times) {
        const a = horizontal(observer, first.body, at);
        const b = horizontal(observer, second.body, at);
        if (a.altitude <= 5 || b.altitude <= 5) continue;
        const separation = Number(
          angularSeparation(
            { altitudeDeg: a.altitude, azimuthDeg: a.azimuth },
            { altitudeDeg: b.altitude, azimuthDeg: b.azimuth },
          ),
        );
        // The best moment is the highest one, not the closest: a pair 2° apart
        // in the trees is worse than the same pair 3° apart and well up.
        const altitude = (a.altitude + b.altitude) / 2;
        if (separation > CONJUNCTION_LIMIT_DEG) continue;
        if (!best || altitude > best.altitude) {
          best = { at, separation, altitude, azimuth: (a.azimuth + b.azimuth) / 2 };
        }
      }
      if (!best) continue;

      // A pair closer than the width of a finger at arm's length is striking;
      // six degrees apart is a pleasant coincidence and no more.
      const closeness = 1 - best.separation / CONJUNCTION_LIMIT_DEG;
      // Tracked on the first body of the pair — they are within a few degrees
      // of each other by definition, so one path describes both.
      const conjunctionProfile = altitudeProfile(observer, first.body, times);

      opportunities.push({
        id: `conjunction-${first.name}-${second.name}`.replace(/\s+/g, "-").toLowerCase(),
        kind: "conjunction",
        title: `${first.name === "the Moon" ? "The Moon" : first.name} and ${second.name}`,
    summary: `${first.name === "the Moon" ? "The Moon" : first.name} and ${second.name} almost touching — ${best.separation < 2 ? "close enough to cover with a fingertip" : "a striking pair"}, low in the ${compassPoint(best.azimuth)}.`,
        qualities: {
          observability: altitudeObservability(best.altitude),
          // A close conjunction is a lovely thing and not a rare one. Rated
          // higher, a 1.7° Moon–Venus pairing came out "exceptional", the same
          // word reserved for a total lunar eclipse — and the Moon passes a
          // bright planet most months.
          spectacle: 0.25 + 0.35 * closeness,
          recognisability: 0.7 + 0.25 * closeness,
          ease: timingEase(best.at.toISOString(), period),
          confidence: 1,
          rarity: 0.15 + 0.3 * closeness,
        },
        // Separation is the event. Two things a degree apart read as one
        // object; the same two things eight degrees apart are a coincidence of
        // direction that happens constantly.
        significance: conjunctionSignificance(best.separation),
        guidance: {
          appearance: `Two points close together — ${best.separation.toFixed(1)}° is about ${best.separation < 1.5 ? "a fingernail" : best.separation < 3 ? "a finger" : "two fingers"} held at arm's length.`,
          whenUtc: best.at.toISOString(),
          durationMinutes: 60,
          direction: compassPoint(best.azimuth),
          elevation: `${elevationInFists(best.altitude)[0].toUpperCase()}${elevationInFists(best.altitude).slice(1)}.`,
          howLong: "A few minutes. It looks much the same for an hour either side.",
          equipment: "eyes",
          technique: best.separation < 2
            ? "Close enough to fit in one binocular field, which is worth doing if you have a pair."
            : null,
          safety: null,
        },
        phenomenon:
          "A conjunction is a line-of-sight coincidence, not a real meeting. The two bodies are hundreds of millions of kilometres apart and only appear close because they both sit near the plane of the solar system, so they travel the same narrow band of sky.",
        tonight: `Closest useful view at ${formatTime(best.at.toISOString())}, ${best.separation.toFixed(1)}° apart and ${Math.round(best.altitude)}° up.`,
        missingInputs: [],
        limitations: [],
        science: (() => {
          // Both positions, once, at the instant being recommended. Computed
          // here rather than re-derived downstream so the separation quoted in
          // words and the geometry a visual draws come from one evaluation.
          const firstAt = horizontal(observer, first.body, best.at);
          const secondAt = horizontal(observer, second.body, best.at);
          const moonInvolved =
            first.name === "the Moon" || second.name === "the Moon";
          const phase = moonInvolved ? lunarPhaseAt(best.at) : null;
          return {
            kind: "conjunction" as const,
            bodies: [first.name, second.name] as readonly [string, string],
            separationDeg: angularSeparation(
              { altitudeDeg: firstAt.altitude, azimuthDeg: firstAt.azimuth },
              { altitudeDeg: secondAt.altitude, azimuthDeg: secondAt.azimuth },
            ),
            positions: [
              { body: first.name, altitudeDeg: firstAt.altitude, azimuthDeg: firstAt.azimuth },
              { body: second.name, altitudeDeg: secondAt.altitude, azimuthDeg: secondAt.azimuth },
            ] as const,
            atUtc: best.at.toISOString(),
            moon: phase
              ? { illuminatedFraction: phase.illuminatedFraction, waning: phase.waning }
              : null,
          };
        })(),
        profile: conjunctionProfile,
        geometry: targetGeometry(conjunctionProfile),
        transparency: "low",
      });
    }
  }

  return opportunities;
}

/* --------------------------------------------------------- lunar eclipses */

function lunarEclipseOpportunity(
  observer: Observer,
  period: ObservationPeriod,
): Opportunity | null {
  const start = Date.parse(period.startUtc);
  const end = Date.parse(period.endUtc);
  const eclipse = SearchLunarEclipse(new Date(start - 2 * 86_400_000));
  const peak = eclipse.peak.date.getTime();
  if (peak < start || peak > end) return null;

  const position = horizontal(observer, Body.Moon, eclipse.peak.date);
  if (position.altitude <= 0) return null;

  const totality = eclipse.kind === "total";
  const partial = eclipse.kind === "partial";
  const timing = lunarEclipseTiming(eclipse);
  const contactInstants = {
    penumbralStart: timing.penumbral.startUtc,
    partialStart: timing.partial?.startUtc,
    totalityStart: timing.totality?.startUtc,
    maximum: timing.maximumUtc,
    totalityEnd: timing.totality?.endUtc,
    partialEnd: timing.partial?.endUtc,
    penumbralEnd: timing.penumbral.endUtc,
  };
  const localContacts = Object.fromEntries(
    Object.entries(contactInstants)
      .flatMap(([name, atUtc]) =>
        atUtc
          ? [[name, horizontal(observer, Body.Moon, new Date(atUtc)).altitude] as const]
          : [],
      ),
  );
  if (!Object.values(localContacts).some((altitude) => altitude > 0)) return null;
  const recommendedContact = Object.entries(localContacts).reduce((best, entry) =>
    entry[1] > best[1] ? entry : best,
  );
  const recommendedAt = new Date(contactInstants[recommendedContact[0] as keyof typeof contactInstants] ?? timing.maximumUtc);
  const recommendedPosition = horizontal(observer, Body.Moon, recommendedAt);

  return {
    id: "lunar-eclipse",
    kind: "lunar-eclipse",
    title: totality
      ? "Total lunar eclipse"
      : partial
        ? "Partial lunar eclipse"
        : "Penumbral lunar eclipse",
    summary: totality
      ? "The Moon slides into Earth's shadow and turns deep copper red. Worth setting an alarm for."
      : partial
        ? "A dark, curved bite creeps across the Moon — the edge of Earth's own shadow."
        : "A faint shading across the Moon. Subtle, and easy to miss.",
    qualities: {
      observability: Math.min(1, altitudeObservability(position.altitude) + 0.35),
      // Depth is most of what a partial looks like. A flat 0.7 for every
      // partial rated a three-percent graze the same as a dark bite across
      // most of the disc, and the two are not the same evening.
      spectacle: totality ? 0.95 : partial ? 0.3 + 0.45 * eclipse.obscuration : 0.25,
      recognisability: totality ? 0.95 : partial ? 0.45 + 0.45 * eclipse.obscuration : 0.3,
      ease: timingEase(eclipse.peak.date.toISOString(), period) * 0.9,
      confidence: 1,
      rarity: totality ? 0.9 : partial ? 0.6 : 0.3,
    },
    // The reason this file exists to be changed: Earth's shadow crossing the
    // Moon is the most unusual thing in any night sky it happens in, and the
    // old capped-rarity model could not lift it past a well-placed planet.
    significance: lunarEclipseSignificance(
      totality ? "total" : partial ? "partial" : "penumbral",
      eclipse.obscuration,
    ),
    guidance: {
      appearance: totality
        ? "Copper red to brick brown, and much dimmer than you expect — the colour is sunlight bent through every sunrise and sunset on Earth at once. Photographs exaggerate the saturation."
        : partial
          ? "A curved, distinctly dark edge creeping across the disc. The curve is Earth's shadow."
          : "A faint grey shading on one side. Genuinely hard to see.",
      whenUtc: eclipse.peak.date.toISOString(),
      durationMinutes: Math.round(Number(timing.observablePhase.durationMinutes)),
      direction: compassPoint(recommendedPosition.azimuth),
      elevation: `${elevationInFists(recommendedPosition.altitude)[0].toUpperCase()}${elevationInFists(recommendedPosition.altitude).slice(1)}, at the best locally visible contact.`,
      howLong: "Go out well before the middle. The interesting part is the change, not the moment.",
      equipment: "eyes",
      technique: "No filter, no equipment, no danger — a lunar eclipse is just the Moon, and a dim one at that.",
      safety: null,
    },
    phenomenon:
      "Earth passes exactly between the Sun and the Moon and its shadow falls across the lunar surface. It only turns red rather than black because Earth's atmosphere bends some sunlight into the shadow, filtering out the blue on the way — the Moon is being lit by every sunset on the planet at once.",
    tonight: position.altitude > 0
      ? `Maximum eclipse at ${formatTime(timing.maximumUtc)}, with the Moon ${Math.round(position.altitude)}° above the ${compassPoint(position.azimuth)} horizon from where you are.`
      : `Maximum eclipse is below your horizon, but part of the eclipse is locally visible around ${formatTime(recommendedAt.toISOString())}.`,
    missingInputs: [],
    limitations: [
      "Contact times are global model-derived circumstances. Local visibility is checked from Moon altitude at each contact, and the visibility footprint is sampled from the same altitudes on a coarse grid.",
    ],
    science: {
      kind: "lunar-eclipse",
      timing,
      obscurationFraction: eclipse.obscuration,
      localContactAltitudesDeg: localContacts,
    },
    // Fixed to the eclipse itself rather than to altitude: an eclipse is only
    // worth watching while it is happening, wherever the Moon has got to.
    profile: eclipseProfile(observer, timing),
    transparency: "low",
    sceneHints: { illuminatedFraction: 1 },
  };
}

/**
 * A window centred on mid-eclipse, tapering to its edges.
 *
 * The quality curve is fixed to the eclipse rather than to altitude — an
 * eclipse is only worth watching while it is happening, wherever the Moon has
 * got to. The Moon's position is still carried on every sample, because the
 * reader still has to find it: knowing the eclipse peaks at 03:12 is no help
 * without knowing which way to face.
 */
function eclipseProfile(
  observer: Observer,
  timing: ReturnType<typeof lunarEclipseTiming>,
): OpportunitySample[] {
  const samples: OpportunitySample[] = [];
  const start = Date.parse(timing.observablePhase.startUtc);
  const end = Date.parse(timing.observablePhase.endUtc);
  const peak = Date.parse(timing.maximumUtc);
  const span = Math.max(1, end - start);
  for (let stamp = start; stamp <= end; stamp += SAMPLE_INTERVAL_MINUTES * MS_PER_MINUTE) {
    const at = new Date(stamp);
    const { altitude, azimuth } = horizontal(observer, Body.Moon, at);
    samples.push({
      altitudeDeg: altitude,
      azimuthDeg: azimuth,
      atUtc: at.toISOString(),
      relative: altitude > 0 ? Math.max(0, 1 - (2 * Math.abs(stamp - peak)) / span) : 0,
    });
  }
  if (samples.at(-1)?.atUtc !== timing.observablePhase.endUtc) {
    const at = new Date(end);
    const { altitude, azimuth } = horizontal(observer, Body.Moon, at);
    samples.push({
      altitudeDeg: altitude,
      azimuthDeg: azimuth,
      atUtc: at.toISOString(),
      relative: 0,
    });
  }
  return samples;
}

/* ------------------------------------------------------------------ public */

/** Everything Tracker can offer for this location and period. */
export function tonightsOpportunities(
  latitudeDeg: number,
  longitudeDeg: number,
  period: ObservationPeriod,
): Opportunity[] {
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const opportunities: Opportunity[] = [];

  const meteors = meteorOpportunity(latitudeDeg, longitudeDeg, period);
  if (meteors) opportunities.push(meteors);

  const eclipse = lunarEclipseOpportunity(observer, period);
  if (eclipse) opportunities.push(eclipse);

  const moon = moonOpportunity(observer, period);
  if (moon) opportunities.push(moon);

  opportunities.push(...planetOpportunities(observer, period));
  opportunities.push(...conjunctionOpportunities(observer, period));

  return opportunities;
}
