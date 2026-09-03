import * as satellite from "satellite.js";

import brightness from "../satellites/brightness.json";
import { compassPoint } from "./meteorActivity";
import type { SkyConditions } from "./nakedEye";
import type { OpportunitySample } from "./conditions";
import type { Opportunity } from "./opportunity";
import type { Deployment, ElementSet, IssEphemeris } from "./satelliteSources";
import { segmentFor } from "./satelliteSources";
import { passesFor, stateAt, type Pass } from "./satelliteVisibility";

/**
 * Spacecraft passes, as things a person might go outside and watch.
 *
 * ## What is here and what is deliberately not
 *
 * The ISS, because it is the one artificial object almost everybody has seen
 * without meaning to, and the one whose brightness is measured well enough to
 * predict. And a Starlink train, when a real one exists, because it is the
 * question Tracker gets asked and the honest answer is usually "not tonight".
 *
 * Nothing else. There are a hundred and fifty objects on CelesTrak's list of the
 * brightest satellites and standard magnitudes published for most of them, and
 * a rail of anonymous rocket bodies at magnitude 2 is not an answer to "what can
 * I see tonight" — it is a catalogue with the catalogue's own indifference to
 * whether any of it is worth going outside for. Tiangong is missing for the
 * opposite reason: it is worth seeing and there is no published brightness for
 * it that Tracker can cite, so it is absent rather than guessed at.
 */

const ISS = brightness.spacecraft.find((entry) => entry.id === "iss")!;
const STARLINK = brightness.starlink;

/** Everything a pass needs to know about the sky, supplied by the caller. */
export interface SatelliteInputs {
  startUtc: string;
  endUtc: string;
  skyAt: (when: Date) => SkyConditions;
  iss: IssEphemeris | null;
  deployment: Deployment | null;
}

const satrecCache = new Map<string, satellite.SatRec | null>();

function satrecOf(set: ElementSet): satellite.SatRec | null {
  const key = `${set.line1}\n${set.line2}`;
  if (!satrecCache.has(key)) {
    try {
      const satrec = satellite.twoline2satrec(set.line1, set.line2);
      satrecCache.set(key, satrec.error ? null : satrec);
    } catch {
      satrecCache.set(key, null);
    }
  }
  return satrecCache.get(key) ?? null;
}

function profileOf(pass: Pass): OpportunitySample[] {
  const best = pass.samples.reduce(
    (a, b) => ((b.headroom ?? -Infinity) > (a.headroom ?? -Infinity) ? b : a),
    pass.samples[0],
  );
  const peak = Math.max(0.0001, best.altitudeDeg);
  return pass.samples.map((sample) => ({
    atUtc: sample.atUtc,
    relative: Math.max(0, Math.min(1, sample.altitudeDeg / peak)),
    altitudeDeg: sample.altitudeDeg,
    azimuthDeg: sample.azimuthDeg,
  }));
}

/**
 * What is unusual about *this* pass, as opposed to passes in general.
 *
 * The station goes over most places several times a week, so a pass is routine
 * by default and has to earn anything more. What earns it is the thing an
 * observer would actually notice: how high it climbs. A pass that goes almost
 * straight overhead is closest, brightest and longest; one that scrapes across
 * the north at twenty-five degrees is the same object on a night not to bother.
 *
 * It stops at `favourable`. `notable` is the tier that means news — an eclipse,
 * an opposition — and the station passing over is not news however good the
 * pass is. The reasons are the measured circumstances rather than a score.
 */
function significanceOfPass(pass: Pass, subject: string): {
  tier: "routine" | "good-example" | "favourable";
  reasons: string[];
} {
  const peak = Math.round(pass.peakAltitudeDeg);
  const brightness =
    pass.brightestMagnitude === null ? [] : [`Magnitude ${pass.brightestMagnitude.toFixed(1)} at its best`];
  if (peak >= 70) {
    return {
      tier: "favourable",
      reasons: [`${subject} passes almost directly overhead, ${peak}° up`, ...brightness],
    };
  }
  if (peak >= 45) {
    return { tier: "good-example", reasons: [`A high pass, ${peak}° above the horizon`, ...brightness] };
  }
  return { tier: "routine", reasons: [`A low pass, reaching ${peak}°`, ...brightness] };
}

function minutesOf(pass: Pass): number {
  return Math.max(1, Math.round((Date.parse(pass.endUtc) - Date.parse(pass.startUtc)) / 60_000));
}

/**
 * How the pass reads as an event: rises here, crosses there, ends there.
 *
 * The last part is the one worth saying. Most passes do not set — the
 * spacecraft flies into the Earth's shadow partway across and simply goes out,
 * which surprises anybody watching it for the first time.
 */
function shapeOf(pass: Pass): { entersShadow: boolean; from: string; to: string } {
  const lit = pass.samples.filter((sample) => sample.illumination === "sunlit");
  const last = lit[lit.length - 1] ?? pass.samples[pass.samples.length - 1];
  const first = lit[0] ?? pass.samples[0];
  const finalSample = pass.samples[pass.samples.length - 1];
  return {
    entersShadow: last !== finalSample && last.altitudeDeg > 12,
    from: compassPoint(first.azimuthDeg),
    to: compassPoint(last.azimuthDeg),
  };
}

/* ------------------------------------------------------------------ ISS */

/**
 * The ISS's passes tonight, keeping only the ones worth being told about.
 *
 * A night usually has one to three. The best of them is offered; the others
 * are in the same pass list and could be, but a rail with three entries for one
 * object has stopped being a ranking of the night.
 */
export function issOpportunities(
  latitudeDeg: number,
  longitudeDeg: number,
  inputs: SatelliteInputs,
): Opportunity[] {
  const ephemeris = inputs.iss;
  if (!ephemeris || ephemeris.segments.length === 0) return [];

  const passes = passesFor(
    (when) => {
      const segment = segmentFor(ephemeris.segments, when);
      return segment ? satrecOf(segment) : null;
    },
    { kind: "standard", standardMagnitude: ISS.standardMagnitude },
    { latitudeDeg, longitudeDeg },
    {
      startUtc: inputs.startUtc,
      endUtc: inputs.endUtc,
      skyAt: inputs.skyAt,
      /**
       * A pass has to reach twenty degrees, not ten.
       *
       * Ten is the altitude below which extinction takes over; twenty is where
       * a pass stops being a thing glimpsed between roofs. The station is bright
       * enough that the limit here is what the reader can actually get to, not
       * what the sky will allow.
       */
      minimumAltitudeDeg: 20,
    },
  );

  const visible = passes.filter((pass) => pass.visible);
  if (visible.length === 0) return [];
  const best = visible.reduce((a, b) => ((b.bestHeadroom ?? 0) > (a.bestHeadroom ?? 0) ? b : a));
  const shape = shapeOf(best);
  const minutes = minutesOf(best);

  return [
    {
      id: "satellite-iss",
      kind: "satellite",
      title: "The Space Station",
      // "The Space Stati…" in a closed card names nothing; this names it exactly.
      shortTitle: "ISS",
      summary: ISS.appearance,
      qualities: {
        // It cleared the same test everything else does, and it clears it by a
        // wider margin than anything in the sky except the Moon and Venus.
        observability: Math.min(1, 0.6 + Math.min(0.4, best.peakAltitudeDeg / 225)),
        spectacle: 0.72,
        // Nothing else moves like it, so nobody who sees it wonders what it was.
        recognisability: 0.95,
        // It takes four minutes and no equipment, but you have to be out for them.
        ease: 0.75,
        // Geometry from an operator's own ephemeris, and a measured brightness.
        confidence: 0.9,
        /**
         * Not rare, and it must not claim to be.
         *
         * The station passes over most places several times a week. What makes
         * one worth mentioning is that this one is lit, high and in a dark sky
         * — which is observability, not rarity.
         */
        rarity: 0.08,
      },
      significance: significanceOfPass(best, "The station"),
      guidance: {
        appearance: ISS.appearance,
        whenUtc: best.bestUtc,
        durationMinutes: minutes,
        direction: compassPoint(best.bestAzimuthDeg),
        elevation: `${Math.round(best.peakAltitudeDeg)}° up at its highest, moving from the ${shape.from} towards the ${shape.to}`,
        howLong: `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} from first sight to last. Be outside a couple of minutes early.`,
        equipment: "eyes",
        technique: shape.entersShadow
          ? "It will not set. Partway across it flies into the Earth's shadow and fades out in a few seconds, still high in the sky."
          : "Look for something moving steadily and not blinking. Aircraft flash; this does not.",
        safety: null,
      },
      phenomenon:
        "The International Space Station orbits about four hundred kilometres up, going round the Earth roughly every ninety minutes. It makes no light of its own: what you see is sunlight off its solar arrays, which is why it is only visible when it is still in sunlight and you are already in the dark.",
      // No time of day in the sentence: the best pass of a night is as often
      // before dawn as after dusk, and "this evening" beside a 5 a.m. card is
      // the interface contradicting itself.
      tonight: `It crosses from the ${shape.from} to the ${shape.to}, reaching ${Math.round(best.peakAltitudeDeg)}° above the horizon${shape.entersShadow ? ", and goes out partway across as it enters the Earth's shadow" : ""}.`,
      missingInputs: [],
      limitations: [
        ephemeris.source === "supgp"
          ? "Orbit from NASA's own published trajectory for the station, by way of CelesTrak."
          : "Orbit from the public catalogue rather than NASA's own trajectory, which was not reachable. Timing may be a few seconds out.",
        `Brightness is scaled from a measured standard magnitude of ${ISS.standardMagnitude.toFixed(1)}; the station's real brightness varies with how its arrays happen to be turned.`,
      ],
      profile: profileOf(best),
      geometry: {
        kind: "target",
        riseUtc: best.startUtc,
        culminationUtc: best.bestUtc,
        setUtc: best.endUtc,
      },
      /**
       * A bright moving point is the last thing haze takes away.
       *
       * It is brighter than every star, so a sky that has lost the Milky Way
       * still shows it. Requiring a transparent night would withhold the one
       * target that survives a mediocre one.
       */
      transparency: "low",
    },
  ];
}

/* -------------------------------------------------------------- the train */

export type TrainVerdict =
  | { offered: true; opportunity: Opportunity }
  | { offered: false; reason: string };

/**
 * Whether tonight has a Starlink train worth telling anybody about.
 *
 * ## Why this withholds so much
 *
 * Because the brightness behind it is a population mean and not a measurement
 * of this stack. Mallama and colleagues sorted 580 observations of orbit-raising
 * satellites by height and found two populations nearly three magnitudes apart,
 * split at 357 km, where SpaceX appears to start dimming them. A mean over the
 * bright population is a reasonable centre for a prediction and is nothing like
 * a promise about one pass on one night.
 *
 * So the screen has four parts, and all four have to hold:
 *
 * 1. **It is a real deployment.** Not Starlink objects that happen to be in a
 *    recent-launch feed — CelesTrak's own post-deployment stack vector, derived
 *    from the state vector SpaceX published for that separation.
 * 2. **It is still a stack.** A train stops being a train once it spreads out.
 * 3. **It is low enough to be the bright population, with room to spare.** Above
 *    340 km Tracker will not call it bright, because the threshold is 357 and a
 *    stack raising its orbit crosses that in about a day. Below 250 km the study
 *    excluded objects as de-orbiting, so its figures do not describe them.
 * 4. **The prediction clears the sky by more than the population is wide.**
 *    Half the separation between the two brightness modes, on top of the margin
 *    every naked-eye judgement already carries.
 *
 * Each of those can say no on its own, and saying no is the common answer.
 */
export function trainVerdict(
  latitudeDeg: number,
  longitudeDeg: number,
  inputs: SatelliteInputs,
): TrainVerdict {
  const deployment = inputs.deployment;
  if (!deployment) {
    return { offered: false, reason: "No recent Starlink deployment is being published." };
  }

  const windowStart = Date.parse(inputs.startUtc);
  const ageDays = (windowStart - Date.parse(deployment.deployedUtc)) / 86_400_000;
  if (ageDays < 0) {
    return { offered: false, reason: "The deployment has not happened yet." };
  }
  if (ageDays > COHERENCE_DAYS) {
    return {
      offered: false,
      reason: `The last deployment was ${Math.round(ageDays)} days ago, by which time the satellites have spread out and no longer travel as a train.`,
    };
  }

  const satrec = satrecOf(deployment.stack);
  if (!satrec) {
    return { offered: false, reason: "The deployment's orbit could not be read." };
  }

  const midpoint = new Date((windowStart + Date.parse(inputs.endUtc)) / 2);
  const state = stateAt(satrec, { latitudeDeg, longitudeDeg }, midpoint);
  if (!state) {
    return { offered: false, reason: "The deployment's orbit could not be propagated to tonight." };
  }
  if (state.heightKm < STARLINK.deorbitingBelowKm) {
    return {
      offered: false,
      reason: `At ${Math.round(state.heightKm)} km these are below the height the brightness study covers, so there is no measurement to predict from.`,
    };
  }
  if (state.heightKm > STARLINK.confidentBelowKm) {
    return {
      offered: false,
      reason: `At ${Math.round(state.heightKm)} km they are near or above the height at which SpaceX dims them, and which of the two brightnesses applies cannot be called from here.`,
    };
  }

  const passes = passesFor(
    () => satrec,
    { kind: "distance-adjusted", magnitudeAt1000Km: STARLINK.magnitudeAt1000KmBelowThreshold },
    { latitudeDeg, longitudeDeg },
    {
      startUtc: inputs.startUtc,
      endUtc: inputs.endUtc,
      skyAt: inputs.skyAt,
      minimumAltitudeDeg: 20,
      uncertaintyMargin: STARLINK.uncertaintyMargin,
    },
  );

  const visible = passes.filter((pass) => pass.visible);
  if (visible.length === 0) {
    return {
      offered: false,
      reason:
        passes.length === 0
          ? "The train does not pass high enough over here tonight."
          : "It passes, but not brightly enough for the prediction to be worth acting on.",
    };
  }

  const best = visible.reduce((a, b) => ((b.bestHeadroom ?? 0) > (a.bestHeadroom ?? 0) ? b : a));
  const shape = shapeOf(best);
  const minutes = minutesOf(best);
  const appearance =
    "A line of points of light, evenly spaced, following each other along the same track. They do not blink and they do not change course.";

  return {
    offered: true,
    opportunity: {
      id: `satellite-train-${deployment.file}`,
      kind: "satellite",
      title: "A Starlink train",
      shortTitle: "Starlink train",
      summary: appearance,
      qualities: {
        observability: Math.min(1, 0.55 + Math.min(0.35, best.peakAltitudeDeg / 250)),
        spectacle: 0.7,
        recognisability: 0.9,
        ease: 0.7,
        /**
         * The lowest confidence Tracker offers anything at.
         *
         * The orbit is an operator's own state vector and is not the doubt; the
         * brightness is a population mean standing in for one stack on one
         * night, and that is.
         */
        confidence: 0.45,
        // A few days after a launch, and only for the launches that pass here.
        rarity: 0.55,
      },
      /**
       * A train is unusual on its own terms, not on the pass's.
       *
       * There is one for a few days after a launch and none the rest of the
       * time, which is what makes it worth a card at all — so its tier comes
       * from that rather than from how high this particular pass climbs.
       */
      significance: {
        tier: "favourable",
        reasons: [
          `Deployed ${ageDays < 1 ? "today" : `${Math.round(ageDays)} days ago`}, and still travelling together`,
          `About ${Math.round(state.heightKm)} km up, below the height at which they are dimmed`,
        ],
      },
      guidance: {
        appearance,
        whenUtc: best.bestUtc,
        durationMinutes: minutes,
        direction: compassPoint(best.bestAzimuthDeg),
        elevation: `${Math.round(best.peakAltitudeDeg)}° up at its highest, moving from the ${shape.from} towards the ${shape.to}`,
        howLong: `The line takes a few minutes to pass. Be outside by ${minutes} minutes before.`,
        equipment: "eyes",
        technique:
          "Look along the track rather than at one point: the spacing is what makes it unmistakable.",
        safety: null,
      },
      phenomenon:
        "Starlink satellites are released as a stack and spread out over the following weeks as they raise their orbits. For the first few days they are still close together and still low, which is when they are bright enough to be seen with the unaided eye and close enough together to look like a line.",
      tonight: `Deployed ${ageDays < 1 ? "today" : `${Math.round(ageDays)} days ago`} and currently about ${Math.round(state.heightKm)} km up, the stack crosses from the ${shape.from} to the ${shape.to}.${
        deployment.catalogued && deployment.catalogued > 0
          ? ` ${deployment.catalogued} of them are already in the public catalogue.`
          : ""
      }`,
      missingInputs: [],
      limitations: [
        "Brightness is a published average over many satellites, not a measurement of these ones. Individual satellites in the line will be brighter and fainter than the average, and some passes are dimmer than predicted.",
        "The satellites are already spreading apart. The line will be longer and looser than the pictures taken on deployment day.",
      ],
      profile: profileOf(best),
      geometry: {
        kind: "target",
        riseUtc: best.startUtc,
        culminationUtc: best.bestUtc,
        setUtc: best.endUtc,
      },
      transparency: "low",
    },
  };
}

/**
 * How long after separation a deployment is still a train.
 *
 * A coherence bound, not a brightness one — brightness is decided by height, on
 * the study's own finding that height rather than time is what drives it. This
 * is about whether the objects are still travelling close enough together to
 * read as a line, which is the thing the reader is being sent out to see.
 */
const COHERENCE_DAYS = 5;

/** Everything artificial worth going outside for tonight. */
export function satelliteOpportunities(
  latitudeDeg: number,
  longitudeDeg: number,
  inputs: SatelliteInputs,
): Opportunity[] {
  const train = trainVerdict(latitudeDeg, longitudeDeg, inputs);
  return [
    ...issOpportunities(latitudeDeg, longitudeDeg, inputs),
    ...(train.offered ? [train.opportunity] : []),
  ];
}
