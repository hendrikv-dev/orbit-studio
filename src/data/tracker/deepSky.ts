import { Horizon, MakeTime, Observer } from "astronomy-engine";
import showpieces from "../deep-sky/showpieces.json";
import { hasCataloguedImagery } from "./imagery";
import type { Opportunity } from "./opportunity";
import type { OpportunitySample } from "./conditions";
import { compassPoint } from "./meteorActivity";

/**
 * The deep sky, as a short list of things worth pointing somebody at.
 *
 * ## Why these twenty-five and not thirteen thousand
 *
 * Because Tracker's question is "what is particularly worth observing from here
 * tonight", and a catalogue answers a different one. The selection is editorial
 * and lives in `scripts/build-deep-sky-showpieces.mjs`; every number in it comes
 * from OpenNGC, so nothing shipped here is remembered or estimated.
 *
 * ## Why they only appear under the right rule
 *
 * Each object carries the equipment it needs, assigned by one stated rule from
 * its own visual magnitude. That is what makes the observing-rule control mean
 * something: the Ring Nebula is not withheld from the naked-eye rail because it
 * is faint tonight — it is withheld because it is a telescope object on every
 * night there has ever been, and saying "too faint tonight" would imply
 * otherwise.
 *
 * The seven naked-eye showpieces then still have to pass the naked-eye rule,
 * which knows about the reader's own Moon and streetlights. Andromeda is a
 * naked-eye object *and* is not visible from a city centre, and Tracker has to
 * be able to say both.
 */

interface Showpiece {
  id: string;
  name: string;
  designation: string;
  type: string;
  rightAscensionDeg: number;
  declinationDeg: number;
  visualMagnitude: number;
  majorAxisArcmin: number | null;
  equipment: "eyes" | "binoculars" | "telescope";
  appearance: string;
}

const CATALOGUE = showpieces as { objects: Showpiece[]; source: { title: string; url: string } };

export const DEEP_SKY_SOURCE = CATALOGUE.source;

/** Where an object stands, from its fixed position. */
function altitudeAzimuth(object: Showpiece, observer: Observer, at: Date) {
  const horizon = Horizon(
    MakeTime(at),
    observer,
    // Astronomy Engine takes right ascension in hours, as the ephemeris does.
    object.rightAscensionDeg / 15,
    object.declinationDeg,
    "normal",
  );
  return { altitudeDeg: horizon.altitude, azimuthDeg: horizon.azimuth };
}

/**
 * How observable an object is from its altitude, on the same curve everything
 * else in Tracker uses: nothing below the horizon, little in the murk, and no
 * further credit for being overhead rather than merely high.
 */
function altitudeObservability(altitudeDeg: number): number {
  if (altitudeDeg <= 0) return 0;
  return Math.min(1, altitudeDeg / 45);
}

export interface DeepSkyNight {
  /** The dark window the objects are judged across. */
  startUtc: string;
  endUtc: string;
}

/**
 * Tonight's deep-sky candidates for one place.
 *
 * Sampled every twenty minutes across the dark window, which is fine enough for
 * an object that moves fifteen degrees an hour and cheap enough to run for
 * twenty-five of them. Objects that never clear ten degrees are not returned at
 * all: at that height they are in the worst of the atmosphere and behind most
 * people's trees, and the ranking has nothing useful to say about them.
 */
export function deepSkyOpportunities(
  latitudeDeg: number,
  longitudeDeg: number,
  night: DeepSkyNight,
): Opportunity[] {
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const start = Date.parse(night.startUtc);
  const end = Date.parse(night.endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const step = 20 * 60_000;
  const opportunities: Opportunity[] = [];

  for (const object of CATALOGUE.objects) {
    /**
     * Nothing is offered that cannot be shown.
     *
     * The event page leads with a photograph of the object, and an object with
     * no picture would fall through to a generic night sky — a picture of
     * somewhere else, presented as the thing the reader is being sent out to
     * find. Better to leave it out of the night's list than to illustrate it
     * with the wrong sky. NGC 752 is the one showpiece this currently drops:
     * no observatory archive Tracker draws on publishes an image of it.
     */
    if (!hasCataloguedImagery(object.id)) continue;

    const profile: OpportunitySample[] = [];
    let best: { atUtc: string; altitudeDeg: number; azimuthDeg: number } | null = null;

    for (let at = start; at <= end; at += step) {
      const when = new Date(at);
      const { altitudeDeg, azimuthDeg } = altitudeAzimuth(object, observer, when);
      profile.push({ atUtc: when.toISOString(), relative: 0, altitudeDeg, azimuthDeg });
      if (!best || altitudeDeg > best.altitudeDeg) {
        best = { atUtc: when.toISOString(), altitudeDeg, azimuthDeg };
      }
    }
    if (!best || best.altitudeDeg < 10) continue;

    // `relative` is each sample against the night's own best, which is what the
    // window finder and the conditions model both expect.
    for (const sample of profile) {
      sample.relative =
        best.altitudeDeg > 0
          ? Math.max(0, (sample.altitudeDeg ?? 0) / best.altitudeDeg)
          : 0;
    }

    const observability = altitudeObservability(best.altitudeDeg);
    const compass = compassPoint(best.azimuthDeg);
    opportunities.push({
      id: `deep-sky-${object.id}`,
      kind: "deep-sky",
      title: object.name,
      summary: object.appearance,
      qualities: {
        observability,
        /**
         * How striking it is, from how bright it is.
         *
         * Deliberately shallow: this is a list of showpieces, so the floor is
         * high and the spread is narrow. Ranking them finely against each other
         * would be inventing a preference Tracker has no basis for — the
         * difference between the Ring Nebula and the Dumbbell is a matter of
         * taste, and the ranking should not pretend to have one.
         */
        spectacle: Math.min(0.9, Math.max(0.5, (9 - object.visualMagnitude) / 9)),
        // Every one of these is a named object in a fixed place; if you find
        // it, you know you have.
        recognisability: 0.8,
        ease: object.equipment === "eyes" ? 0.8 : object.equipment === "binoculars" ? 0.6 : 0.45,
        // A fixed position and a published magnitude: nothing here is forecast.
        confidence: 0.95,
        /**
         * Not rare, and saying so matters.
         *
         * These are available for months every year, which is most of why they
         * are showpieces. Rarity is what lifts an eclipse above a planet, and a
         * globular cluster that is up half the year must not borrow it.
         */
        rarity: 0.05,
      },
      guidance: {
        appearance: object.appearance,
        whenUtc: best.atUtc,
        durationMinutes: Math.round((end - start) / 60_000),
        direction: compass,
        elevation: `${Math.round(best.altitudeDeg)}° above the ${compass} horizon at its highest`,
        howLong: "Give your eyes twenty minutes in the dark before looking for it.",
        equipment: object.equipment,
        technique:
          object.equipment === "eyes"
            ? "Look slightly to one side of it: the eye's faint-light vision is off-centre."
            : null,
        safety: null,
      },
      phenomenon: `${object.designation} is a ${object.type} at a fixed position in the sky, visible whenever it is above the horizon in a dark enough sky.`,
      tonight: `It reaches ${Math.round(best.altitudeDeg)}° above the ${compass} horizon tonight, at magnitude ${object.visualMagnitude.toFixed(1)}.`,
      missingInputs: [],
      limitations: [
        // The honest caveat for extended objects, said once and plainly.
        object.majorAxisArcmin !== null && object.majorAxisArcmin > 30
          ? "Its magnitude is the whole object's light added together, spread over a large area — so it is harder to see than the number suggests."
          : "Magnitude and position are catalogued values, not measurements made tonight.",
      ],
      profile,
      /**
       * A faint extended object is the definition of needing a transparent sky.
       *
       * The Moon survives cloud that ends a deep-sky session entirely, and the
       * same forecast therefore has to mean different things to the two of
       * them. Naked-eye showpieces are a shade more forgiving than a galaxy in
       * a telescope, but not by much: all of them are the first thing haze
       * takes away.
       */
      transparency: object.equipment === "eyes" ? "medium" : "high",
    });
  }

  return opportunities;
}
