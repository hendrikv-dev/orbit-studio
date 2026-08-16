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
import { meteorNight, cadenceDescription, compassPoint, describeCharacter } from "./meteorActivity";
import type { Opportunity } from "./opportunity";

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

  // The cadence is quoted from the low end, not the ceiling: it is the figure a
  // person will actually experience standing outside, and quoting the best case
  // as the felt rhythm of the night is the kind of small overstatement V1 §5
  // rules out.
  const summary = headline
    ? `Around ${Math.round(low)}–${Math.round(high)} meteors an hour at best — ${cadenceDescription(low)}.`
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
    guidance: {
      appearance: headline
        ? `Brief streaks lasting a fraction of a second — ${describeCharacter(headline.character, headline.speedKmS)}. Nothing like the long trails in photographs, which are built from many minutes of exposure.`
        : "Occasional brief streaks, most of them faint.",
      whenUtc: night.best.atUtc,
      durationMinutes: 60,
      direction,
      elevation: "About two-thirds of the way up, not at the radiant — meteors near it are foreshortened to dots.",
      howLong: "An hour at least. Rates are averages, and meteors arrive in clumps and gaps.",
      equipment: "eyes",
      technique:
        "Give your eyes 20 minutes to adapt and keep them off your phone. Lie back or use a reclining chair — neck ache ends more meteor watches than cloud does.",
      safety: null,
    },
    phenomenon,
    tonight,
    missingInputs: night.missingInputs,
    limitations: night.limitations,
  };
}

/* -------------------------------------------------------------------- Moon */

const MOON_PHASE_NAMES = [
  "New Moon", "waxing crescent", "First Quarter", "waxing gibbous",
  "Full Moon", "waning gibbous", "Last Quarter", "waning crescent",
];

function moonOpportunity(observer: Observer, period: ObservationPeriod): Opportunity | null {
  const times = sampleTimes(observer, period, false);
  if (times.length === 0) return null;
  const placement = bestPlacement(observer, Body.Moon, times);
  if (!placement) return null;

  const at = new Date(placement.atUtc);
  const illumination = Illumination(Body.Moon, MakeTime(at));
  const fraction = illumination.phase_fraction;
  const phaseIndex = Math.round((illumination.phase_angle / 360) * 8) % 8;
  const waxing = illumination.phase_angle < 180;
  const phaseName = fraction < 0.03
    ? "New Moon"
    : fraction > 0.97
      ? "Full Moon"
      : Math.abs(fraction - 0.5) < 0.06
        ? waxing ? "First Quarter" : "Last Quarter"
        : `${waxing ? "waxing" : "waning"} ${fraction < 0.5 ? "crescent" : "gibbous"}`;

  if (fraction < 0.03) return null;

  // The terminator is where the Moon is worth looking at: craters near the
  // day-night line throw long shadows and stand up in relief. A full Moon is
  // bright and flat, which is the opposite of what most people expect.
  const nearTerminator = 1 - Math.abs(fraction - 0.5) * 2;
  const spectacle = 0.25 + 0.45 * nearTerminator;
  const earthshine = fraction < 0.25;

  return {
    id: "moon",
    kind: "moon",
    title: phaseName === "First Quarter" || phaseName === "Last Quarter" || phaseName === "Full Moon"
      ? `The ${phaseName}`
      : `The Moon, a ${phaseName}`,
    summary: earthshine
      ? "A thin crescent with the rest of the disc faintly lit by earthshine."
      : `${Math.round(fraction * 100)}% lit and ${Math.round(placement.altitudeDeg)}° up at its best.`,
    qualities: {
      observability: Math.min(1, altitudeObservability(placement.altitudeDeg) + 0.3),
      spectacle,
      recognisability: 1,
      ease: timingEase(placement.atUtc, period),
      confidence: 1,
      rarity: 0.02,
    },
    guidance: {
      appearance: earthshine
        ? "A bright crescent with the unlit part glowing faintly grey — that is sunlight reflected off Earth, onto the Moon, and back again."
        : nearTerminator > 0.5
          ? "Craters along the day-night line stand out in relief, with shadows long enough to see with binoculars."
          : "A bright, flat disc. Detail is hard to see when the Sun is overhead on the Moon.",
      whenUtc: placement.atUtc,
      durationMinutes: 120,
      direction: compassPoint(placement.azimuthDeg),
      elevation: `About ${Math.round(placement.altitudeDeg)}° up at its highest.`,
      howLong: "A few minutes with your eyes; longer if you have binoculars.",
      equipment: "eyes",
      technique: nearTerminator > 0.4
        ? "Look along the terminator, the line between lit and unlit. Everything interesting is there."
        : null,
      safety: null,
    },
    phenomenon:
      "The Moon shows a phase because you are seeing a sphere lit from one side, from a changing angle as it goes round Earth. The phase is not Earth's shadow — that only happens during a lunar eclipse.",
    tonight: `${phaseName}, ${Math.round(fraction * 100)}% lit, highest at ${formatTime(placement.atUtc)} about ${Math.round(placement.altitudeDeg)}° above the ${compassPoint(placement.azimuthDeg)} horizon.`,
    missingInputs: [],
    limitations: fraction > 0.6
      ? ["A Moon this bright washes out everything faint tonight, including meteors."]
      : [],
  };
}

/* ----------------------------------------------------------------- planets */

interface PlanetProfile {
  body: Body;
  name: string;
  /** What is actually worth seeing, and with what. */
  telescopeTarget?: { title: string; appearance: string; equipment: "binoculars" | "telescope"; technique: string };
  phenomenon: string;
}

const PLANETS: PlanetProfile[] = [
  {
    body: Body.Venus,
    name: "Venus",
    phenomenon:
      "Venus orbits inside Earth's orbit, so it never strays far from the Sun and shows phases like the Moon. It is the brightest thing in the sky after the Sun and Moon because its cloud deck reflects three-quarters of the light that hits it.",
  },
  {
    body: Body.Mars,
    name: "Mars",
    phenomenon:
      "Mars is obviously orange to the naked eye because its surface is covered in iron oxide dust. Its brightness swings enormously — Earth laps it every 26 months, and between those passes it recedes to more than seven times the distance.",
  },
  {
    body: Body.Jupiter,
    name: "Jupiter",
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

function planetOpportunities(observer: Observer, period: ObservationPeriod): Opportunity[] {
  const times = sampleTimes(observer, period, false);
  if (times.length === 0) return [];
  const opportunities: Opportunity[] = [];

  for (const profile of PLANETS) {
    const placement = bestPlacement(observer, profile.body, times);
    if (!placement) continue;
    const at = new Date(placement.atUtc);
    const magnitude = Illumination(profile.body, MakeTime(at)).mag;

    // Brighter than about magnitude 2 and it is obvious; fainter than 4 and a
    // city observer will not pick it out at all.
    const brightness = Math.min(1, Math.max(0, (3.5 - magnitude) / 5));
    const observability = altitudeObservability(placement.altitudeDeg);
    if (observability <= 0) continue;

    opportunities.push({
      id: `planet-${profile.name.toLowerCase()}`,
      kind: "planet",
      title: profile.name,
      summary: `Magnitude ${magnitude.toFixed(1)}, ${Math.round(placement.altitudeDeg)}° above the ${compassPoint(placement.azimuthDeg)} horizon at its best.`,
      qualities: {
        observability,
        spectacle: brightness * 0.6,
        // A steady point among twinkling stars — real, but you have to be told.
        recognisability: 0.45 + brightness * 0.4,
        ease: timingEase(placement.atUtc, period),
        confidence: 1,
        rarity: 0.05,
      },
      guidance: {
        appearance: `A steady point of light, ${profile.name === "Mars" ? "distinctly orange" : profile.name === "Venus" ? "brilliant white" : "creamy white"}. Planets hold still while stars twinkle — that is how to tell them apart.`,
        whenUtc: placement.atUtc,
        durationMinutes: 90,
        direction: compassPoint(placement.azimuthDeg),
        elevation: `About ${Math.round(placement.altitudeDeg)}° up.`,
        howLong: "A minute is enough to find it.",
        equipment: "eyes",
        technique: null,
        safety: null,
      },
      phenomenon: profile.phenomenon,
      tonight: `Highest at ${formatTime(placement.atUtc)}, ${Math.round(placement.altitudeDeg)}° above the ${compassPoint(placement.azimuthDeg)} horizon, at magnitude ${magnitude.toFixed(1)}.`,
      missingInputs: [],
      limitations: [],
    });

    if (profile.telescopeTarget && observability > 0.25) {
      const target = profile.telescopeTarget;
      opportunities.push({
        id: `telescope-${profile.name.toLowerCase()}`,
        kind: "planet",
        title: target.title,
        summary: `${target.equipment === "telescope" ? "Telescope" : "Binoculars"} required. ${Math.round(placement.altitudeDeg)}° up at its best.`,
        qualities: {
          observability,
          spectacle: profile.body === Body.Saturn ? 0.85 : 0.6,
          recognisability: 0.8,
          ease: timingEase(placement.atUtc, period) * 0.7,
          confidence: 1,
          rarity: 0.05,
        },
        guidance: {
          appearance: target.appearance,
          whenUtc: placement.atUtc,
          durationMinutes: 90,
          direction: compassPoint(placement.azimuthDeg),
          elevation: `About ${Math.round(placement.altitudeDeg)}° up. Higher is better — you are looking through less air.`,
          howLong: "Ten minutes. The view improves as your eye learns what it is looking at.",
          equipment: target.equipment,
          technique: target.technique,
          safety: null,
        },
        phenomenon: profile.phenomenon,
        tonight: `${profile.name} is highest at ${formatTime(placement.atUtc)}, ${Math.round(placement.altitudeDeg)}° above the ${compassPoint(placement.azimuthDeg)} horizon.`,
        missingInputs: [],
        limitations: [
          "No promise is made about what a particular instrument will show — aperture, magnification and the steadiness of the air all change it.",
        ],
      });
    }
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

/** Angular separation between two horizontal positions, degrees. */
function separationDeg(
  a: { altitude: number; azimuth: number },
  b: { altitude: number; azimuth: number },
): number {
  const toRad = Math.PI / 180;
  const cosine =
    Math.sin(a.altitude * toRad) * Math.sin(b.altitude * toRad) +
    Math.cos(a.altitude * toRad) *
      Math.cos(b.altitude * toRad) *
      Math.cos((a.azimuth - b.azimuth) * toRad);
  return Math.acos(Math.min(1, Math.max(-1, cosine))) / toRad;
}

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
        const separation = separationDeg(a, b);
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

      opportunities.push({
        id: `conjunction-${first.name}-${second.name}`.replace(/\s+/g, "-").toLowerCase(),
        kind: "conjunction",
        title: `${first.name === "the Moon" ? "The Moon" : first.name} and ${second.name}`,
        summary: `${best.separation.toFixed(1)}° apart, ${Math.round(best.altitude)}° above the ${compassPoint(best.azimuth)} horizon.`,
        qualities: {
          observability: altitudeObservability(best.altitude),
          spectacle: 0.35 + 0.45 * closeness,
          recognisability: 0.7 + 0.25 * closeness,
          ease: timingEase(best.at.toISOString(), period),
          confidence: 1,
          rarity: 0.35 + 0.4 * closeness,
        },
        guidance: {
          appearance: `Two points close together — ${best.separation.toFixed(1)}° is about ${best.separation < 1.5 ? "a fingernail" : best.separation < 3 ? "a finger" : "two fingers"} held at arm's length.`,
          whenUtc: best.at.toISOString(),
          durationMinutes: 60,
          direction: compassPoint(best.azimuth),
          elevation: `About ${Math.round(best.altitude)}° up.`,
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
  const half = (totality ? eclipse.sd_total : partial ? eclipse.sd_partial : eclipse.sd_penum) * 2;

  return {
    id: "lunar-eclipse",
    kind: "lunar-eclipse",
    title: totality
      ? "Total lunar eclipse"
      : partial
        ? "Partial lunar eclipse"
        : "Penumbral lunar eclipse",
    summary: totality
      ? "The Moon passes fully into Earth's shadow and turns a deep copper red."
      : partial
        ? "A dark bite is taken out of the Moon as it crosses Earth's shadow."
        : "A subtle shading across the Moon — easy to miss unless you know it is happening.",
    qualities: {
      observability: Math.min(1, altitudeObservability(position.altitude) + 0.35),
      spectacle: totality ? 0.95 : partial ? 0.7 : 0.25,
      recognisability: totality ? 0.95 : partial ? 0.85 : 0.3,
      ease: timingEase(eclipse.peak.date.toISOString(), period) * 0.9,
      confidence: 1,
      rarity: totality ? 0.9 : partial ? 0.6 : 0.3,
    },
    guidance: {
      appearance: totality
        ? "Copper red to brick brown, and much dimmer than you expect — the colour is sunlight bent through every sunrise and sunset on Earth at once. Photographs exaggerate the saturation."
        : partial
          ? "A curved, distinctly dark edge creeping across the disc. The curve is Earth's shadow."
          : "A faint grey shading on one side. Genuinely hard to see.",
      whenUtc: eclipse.peak.date.toISOString(),
      durationMinutes: Math.round(half * 60),
      direction: compassPoint(position.azimuth),
      elevation: `About ${Math.round(position.altitude)}° up at mid-eclipse.`,
      howLong: "Go out well before the middle. The interesting part is the change, not the moment.",
      equipment: "eyes",
      technique: "No filter, no equipment, no danger — a lunar eclipse is just the Moon, and a dim one at that.",
      safety: null,
    },
    phenomenon:
      "Earth passes exactly between the Sun and the Moon and its shadow falls across the lunar surface. It only turns red rather than black because Earth's atmosphere bends some sunlight into the shadow, filtering out the blue on the way — the Moon is being lit by every sunset on the planet at once.",
    tonight: `Mid-eclipse at ${formatTime(eclipse.peak.date.toISOString())}, with the Moon ${Math.round(position.altitude)}° above the ${compassPoint(position.azimuth)} horizon from where you are.`,
    missingInputs: [],
    limitations: [],
  };
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
