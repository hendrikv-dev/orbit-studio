import { catalogueImageFor } from "./imagery";
import type { Opportunity } from "./opportunity";

/**
 * What a card shows, decided in one place for every phenomenon Tracker knows.
 *
 * ## Why this exists
 *
 * Media was resolved in two unrelated places. The event page asked
 * `heroImageryFor`, which returns a photograph and falls back to a generic
 * star field for anything it has no picture of — so an annular eclipse was
 * illustrated with a long exposure of Paranal, which depicts nothing about an
 * annular eclipse. The observing rail asked whether that photograph had a
 * `src`, and drew an empty grey square when it did not — which is what the
 * Moon-and-Saturn card showed.
 *
 * Both failures are the same failure: no one decided what a phenomenon class
 * without a photograph should look like, so each surface improvised, and the
 * improvisations were a wrong picture and no picture.
 *
 * ## The order of preference
 *
 * 1. A rights-cleared photograph that actually depicts this class.
 * 2. A drawing made from *this event's own* numbers — a conjunction's real
 *    separation, an eclipse's real obscuration.
 * 3. A deliberate mark for the class, chosen because it is honest about being a
 *    symbol rather than a photograph of something else.
 *
 * There is no fourth case. `cardMediaFor` is total: every opportunity kind
 * returns something, and the test suite asserts it for every kind in the union,
 * so adding a phenomenon cannot silently reintroduce the empty square.
 */

export type CardMedia =
  | { kind: "photo"; src: string; alt: string }
  | { kind: "moon"; illuminatedFraction: number; waning: boolean }
  | {
      kind: "pair";
      /** Both bodies, so the drawing can name what it is showing. */
      bodies: readonly [string, string];
      separationDeg: number;
      /** The Moon's real phase, when the Moon is half of the pairing. */
      moon: { illuminatedFraction: number; waning: boolean } | null;
    }
  | {
      kind: "eclipse";
      variant: "total" | "annular" | "partial";
      /** 0–1, from the event's own local circumstances. */
      obscuration: number;
    }
  | { kind: "mark"; phenomenon: MarkPhenomenon };

/**
 * Classes drawn as a deliberate mark rather than photographed.
 *
 * The brief's audit list also names aurora, comets and occultations. None of
 * them is an opportunity in this build — aurora exists only as a map layer over
 * a nowcast, and comets and occultations are not modelled at all — so there is
 * no card for them to have media on. They are absent rather than unhandled, and
 * the exhaustiveness test below is written against the kinds that exist, so
 * adding one later fails the test until it is given media.
 */
export type MarkPhenomenon = "deep-sky" | "sky";

/** A photograph that genuinely depicts its class, by opportunity kind. */
const PHOTOGRAPHS: Record<string, { src: string; alt: string }> = {
  meteors: {
    src: "/sky/eso-potw1033a-perseid-in-a-dark-sky.webp",
    alt: "A meteor streaking across a dark sky",
  },
  "lunar-eclipse": {
    src: "/sky/eso-potw2136a-eclipsed-moon-at-paranal.webp",
    alt: "The Moon during a total lunar eclipse, lit deep copper",
  },
};

/** Planets Tracker holds a real image of, keyed by the id fragment. */
const PLANETS: { match: string; src: string; alt: string }[] = [
  { match: "saturn", src: "/sky/esahubble-heic1917a-saturn.webp", alt: "Saturn and its rings" },
  {
    match: "jupiter",
    src: "/sky/esahubble-heic2017a-jupiter-and-europa.webp",
    alt: "Jupiter, with Europa crossing in front of it",
  },
  { match: "mars", src: "/sky/esahubble-heic1609a-mars.webp", alt: "Mars, showing its polar cap" },
  { match: "venus", src: "/sky/nasa-PIA23791-planet-venus.webp", alt: "Venus, a featureless white disc of cloud" },
];

export function cardMediaFor(opportunity: Opportunity): CardMedia {
  const { kind, id, science } = opportunity;

  if (kind === "moon") {
    return {
      kind: "moon",
      illuminatedFraction: opportunity.sceneHints?.illuminatedFraction ?? 0.5,
      waning: opportunity.sceneHints?.waning ?? false,
    };
  }

  if (science?.kind === "conjunction") {
    return {
      kind: "pair",
      bodies: science.bodies,
      separationDeg: Number(science.separationDeg),
      moon: science.moon,
    };
  }

  /**
   * Solar eclipses are drawn, not photographed.
   *
   * Tracker holds no cleared photograph of one, and the class is the one where
   * a stand-in is least defensible: the whole subject is a specific geometry,
   * and how much of the Sun is covered *from the reader's own position* is the
   * single fact the card exists to carry. A drawing made from that number says
   * it exactly; a photograph of somebody else's eclipse contradicts it, and a
   * star field says nothing at all.
   */
  if (science?.kind === "solar-eclipse") {
    const variant =
      science.eclipseKind === "total"
        ? "total"
        : science.eclipseKind === "annular"
          ? "annular"
          : "partial";
    return { kind: "eclipse", variant, obscuration: science.obscuration };
  }
  if (kind === "solar-eclipse") {
    return { kind: "eclipse", variant: "partial", obscuration: 0.5 };
  }

  const photo = PHOTOGRAPHS[kind];
  if (photo) return { kind: "photo", ...photo };

  if (kind === "planet") {
    const match = PLANETS.find((planet) => id.includes(planet.match));
    // Venus and the outer planets have no cleared image of their own. A mark is
    // honest about being a symbol; the night-sky photograph that used to fill
    // the space implied a picture of the planet, which it is not.
    if (match) return { kind: "photo", src: match.src, alt: match.alt };
    return { kind: "mark", phenomenon: "sky" };
  }

  /**
   * A deep-sky card shows the object, not a symbol for its class.
   *
   * The mark was the right answer while Tracker had no picture of any of these
   * — better to draw a shorthand than to put a photograph of a different
   * object on the card. It has pictures now, verified against the archives'
   * own record of what each one shows, so the shorthand is no longer the
   * honest option: it is just less than the card can say.
   */
  if (kind === "deep-sky") {
    const catalogued = catalogueImageFor(id.replace(/^deep-sky-/, ""));
    if (catalogued) return { kind: "photo", ...catalogued };
    return { kind: "mark", phenomenon: "deep-sky" };
  }

  return { kind: "mark", phenomenon: "sky" };
}
