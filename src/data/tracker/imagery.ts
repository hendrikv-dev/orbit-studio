/**
 * The photographs, and what each one is honestly claiming to be.
 *
 * These are real pictures of the real sky, taken by named photographers, under
 * licences that permit this use. That matters twice over: a drawing cannot make
 * somebody want to stand outside in the cold the way Yuri Beletsky's eclipsed
 * Moon rising behind the VLT can, and an open-source product has no business
 * shipping imagery whose rights it cannot show.
 *
 * Everything here is Creative Commons Attribution 4.0 — ESO and ESA/Hubble both
 * licence their public images that way as a blanket policy. Both also require
 * the credit to be **clearly and visibly** presented and not hidden away, which
 * is why `credit` is rendered on the image itself rather than tucked behind a
 * disclosure control. That is a licence condition, not a stylistic choice.
 *
 * ## The honesty problem a beautiful photograph creates
 *
 * A photograph of the sky is a claim about what the sky looks like, and the
 * fastest way to ruin a stargazing product is to show a Hubble portrait and let
 * somebody believe that is what their eyes will do. So every image carries a
 * classification and, where the picture and the eye differ, the sentence that
 * says how. Saturn really does look like `heic1917a` — through a space
 * telescope. Through your garden telescope it is a small pale oval, and the
 * interface says so before you go outside, not after.
 */

export type ImageryClass =
  /** A real photograph through a telescope. Not what an eye sees. */
  | "telescope-image"
  /** What a typical amateur instrument actually shows. */
  | "eyepiece-view"
  /** A camera collecting light for far longer than an eye can. */
  | "long-exposure"
  /** Assembled from several exposures or sources. */
  | "composite"
  /** Drawn from the same geometry the recommendation used. */
  | "simulation"
  /** A rendering of forecast values, not an observation. */
  | "forecast-visualisation"
  /** A spacecraft or observatory mosaic. Never a backyard view. */
  | "spacecraft-mosaic";

export const IMAGERY_CLASS_LABEL: Record<ImageryClass, string> = {
  "telescope-image": "Space-telescope image",
  "eyepiece-view": "Likely eyepiece view",
  "long-exposure": "Long-exposure photograph",
  composite: "Composite",
  simulation: "Simulation",
  "forecast-visualisation": "Forecast visualisation",
  "spacecraft-mosaic": "Spacecraft mosaic",
};

export type MediaClaim = "representative" | "event-specific" | "live";
export type MediaOrigin = "historical-capture" | "current-model" | "live-feed";
export type ExpectedViewMode =
  | "naked-eye"
  | "binoculars"
  | "telescope"
  | "long-exposure"
  | "processed";

export const EXPECTED_VIEW_MODE_LABEL: Record<ExpectedViewMode, string> = {
  "naked-eye": "Naked-eye view",
  binoculars: "Binocular view",
  telescope: "Telescope view",
  "long-exposure": "Long-exposure view",
  processed: "Processed view",
};

export const MEDIA_CLAIM_LABEL: Record<MediaClaim, string> = {
  representative: "Representative example",
  "event-specific": "Modelled for this event",
  live: "Live view",
};

export interface HeroImagery {
  /**
   * `photo` fills the frame; `subject` is an object on black that must not be
   * cropped, so it floats on a dark ground instead. Getting this wrong takes
   * the top and bottom off Saturn.
   */
  treatment: "photo" | "subject" | "moon";
  /** Null only for the Moon, which is composited at render time. */
  src: string | null;
  /**
   * Vertical focus for a cropped photograph, as a CSS percentage. The Moon and
   * Venus in "Spheres on Spheres" sit in the top third, and a centred crop of a
   * portrait photograph loses both.
   */
  focusY: string;
  title: string;
  classification: ImageryClass;
  claim: MediaClaim;
  origin: MediaOrigin;
  capturedAt: string | null;
  expectedMode: ExpectedViewMode;
  /** Rendered on the image. Required by the licence, not decoration. */
  credit: string;
  licence: string;
  sourceUrl: string;
  /** How the eye differs from the picture. Shown before going outside. */
  eyeExpectation: string | null;
}

const ESO_LICENCE = "CC BY 4.0";
const HUBBLE_LICENCE = "CC BY 4.0";

const PERSEIDS: HeroImagery = {
  treatment: "photo",
  // A sky-only crop of the same ESO release. The published frame is composed
  // around the VLT's telescope enclosures with the meteor small and off to one
  // side, which put a building where the phenomenon should be. Cropped to the
  // sky above them, the streak is the subject — which is what the card is about.
  src: "/sky/eso-potw1033a-perseid-in-a-dark-sky.webp",
  // The streak runs across the lower half of the crop.
  focusY: "62%",
  title: "A Perseid over Paranal, 2010",
  classification: "long-exposure",
  claim: "representative",
  origin: "historical-capture",
  capturedAt: "2010",
  expectedMode: "long-exposure",
  credit: "ESO/S. Guisard",
  licence: ESO_LICENCE,
  sourceUrl: "https://www.eso.org/public/images/potw1033a/",
  eyeExpectation:
    "A long exposure from one of the darkest places on Earth. Your sky will show fewer stars and no Milky Way from a town — but a bright meteor looks exactly like that, and lasts about a second.",
};

const MOON_AND_VENUS: HeroImagery = {
  treatment: "photo",
  // The published frame is a portrait built around a telescope dome, with the
  // Moon and Venus in the top third. Cropped to that third, what is left is the
  // pairing itself against the twilight gradient — no dome, and no need to
  // fight the composition with a focal point pulled to 26%.
  src: "/sky/eso-potw2031a-moon-and-venus-at-dusk.webp",
  focusY: "50%",
  title: "The Moon and Venus at dusk",
  classification: "long-exposure",
  claim: "representative",
  origin: "historical-capture",
  capturedAt: "2020",
  expectedMode: "naked-eye",
  credit: "Y. Beletsky (LCO)/ESO",
  licence: ESO_LICENCE,
  sourceUrl: "https://www.eso.org/public/images/potw2031a/",
  eyeExpectation:
    "Close to what you will actually see at dusk: two steady points, no telescope needed. The camera has drawn out more colour in the twilight than the eye does.",
};

const NIGHT_SKY: HeroImagery = {
  treatment: "photo",
  src: "/sky/eso-potw1033a-night-sky-detail.webp",
  focusY: "50%",
  title: "A dark sky over Paranal, 2010",
  classification: "long-exposure",
  claim: "representative",
  origin: "historical-capture",
  capturedAt: "2010",
  expectedMode: "long-exposure",
  credit: "ESO/S. Guisard",
  licence: ESO_LICENCE,
  sourceUrl: "https://www.eso.org/public/images/potw1033a/",
  eyeExpectation:
    "A long exposure from a dark observatory site, used only as an example of a clear night. Your sky and its visible star count depend on local light and weather.",
};

export function heroImageryFor(id: string, kind: string): HeroImagery {
  if (kind === "meteors") return PERSEIDS;

  if (kind === "lunar-eclipse") {
    return {
      treatment: "photo",
      src: "/sky/eso-potw2136a-eclipsed-moon-at-paranal.webp",
      focusY: "38%",
      title: "Eclipsed Moon at Paranal",
      classification: "long-exposure",
      claim: "representative",
      origin: "historical-capture",
      capturedAt: "2021",
      expectedMode: "long-exposure",
      credit: "Y. Beletsky (LCO)/ESO",
      licence: ESO_LICENCE,
      sourceUrl: "https://www.eso.org/public/images/potw2136a/",
      eyeExpectation:
        "The colour is real, but a camera saturates it. To the eye a totally eclipsed Moon is dimmer and browner than this — closer to old copper than to red.",
    };
  }

  if (kind === "moon") {
    return {
      treatment: "moon",
      src: null,
      focusY: "50%",
      title: "The Moon at tonight's phase",
      classification: "spacecraft-mosaic",
      claim: "event-specific",
      origin: "current-model",
      capturedAt: null,
      expectedMode: "binoculars",
      credit: "NASA's Scientific Visualization Studio (LROC WAC mosaic)",
      licence: "NASA Images and Media Usage Guidelines",
      sourceUrl: "https://svs.gsfc.nasa.gov/4720/",
      eyeExpectation:
        "A real lunar surface, lit for tonight's actual phase. Binoculars show the craters along the day–night line much like this; your eyes alone see a bright disc without the detail.",
    };
  }

  /**
   * Conjunctions get no photograph.
   *
   * This returned one picture of the Moon beside Venus for every pairing. For
   * "The Moon and Saturn" that is the wrong planet; for any date but the one it
   * was taken on it is the wrong lunar phase; and the separation was whatever
   * that evening happened to offer. The event page now draws the pairing from
   * its own ephemeris (`TrackerConjunctionScene`), and anything still asking
   * for imagery here gets a plain night sky, which claims no geometry at all.
   */
  if (kind === "conjunction") return NIGHT_SKY;

  if (kind === "planet") {
    if (id.includes("saturn")) {
      return {
        treatment: "subject",
        src: "/sky/esahubble-heic1917a-saturn.webp",
        focusY: "50%",
        title: "Saturn, photographed by Hubble in 2019",
        classification: "telescope-image",
        claim: "representative",
        origin: "historical-capture",
        capturedAt: "2019",
        expectedMode: "processed",
        credit: "NASA, ESA, A. Simon (GSFC) and M. H. Wong (UC Berkeley)",
        licence: HUBBLE_LICENCE,
        sourceUrl: "https://esahubble.org/images/heic1917a/",
        eyeExpectation:
          "This is Hubble, above the atmosphere. To your eyes Saturn is a steady yellow point with no disc at all; through a garden telescope it is a small pale oval with the rings just separated from the planet — and most people still call it the best thing they have seen through one.",
      };
    }
    if (id.includes("jupiter")) {
      return {
        treatment: "subject",
        src: "/sky/esahubble-heic2017a-jupiter-and-europa.webp",
        focusY: "50%",
        title: "Jupiter and Europa, photographed by Hubble in 2020",
        classification: "telescope-image",
        claim: "representative",
        origin: "historical-capture",
        capturedAt: "2020",
        expectedMode: "processed",
        credit: "NASA, ESA, A. Simon (GSFC), M. H. Wong (UC Berkeley) and the OPAL team",
        licence: HUBBLE_LICENCE,
        sourceUrl: "https://esahubble.org/images/heic2017a/",
        eyeExpectation:
          "Hubble's view. To your eyes Jupiter is the brightest steady point in the sky. Steady binoculars turn its moons into tiny dots in a line beside it; the cloud belts need a telescope, and never look this sharp.",
      };
    }
    if (id.includes("mars")) {
      return {
        treatment: "subject",
        src: "/sky/esahubble-heic1609a-mars.webp",
        focusY: "50%",
        title: "Mars at opposition, photographed by Hubble in 2016",
        classification: "telescope-image",
        claim: "representative",
        origin: "historical-capture",
        capturedAt: "2016",
        expectedMode: "processed",
        credit:
          "NASA, ESA, the Hubble Heritage Team (STScI/AURA), J. Bell (ASU) and M. Wolff (Space Science Institute)",
        licence: HUBBLE_LICENCE,
        sourceUrl: "https://esahubble.org/images/heic1609a/",
        eyeExpectation:
          "Hubble at Mars's closest in a decade. To your eyes Mars is an orange point of light. Even a good telescope shows a small disc with a few smudges — the polar cap is the one feature most people can pick out.",
      };
    }
    // Venus alone. The Moon-and-Venus frame implies a pairing that is not the
    // event, so the generic sky is used until a Venus-only image is cleared.
    if (id.includes("venus")) return NIGHT_SKY;
  }

  return NIGHT_SKY;
}

/** Every image that ships, for the provenance and attribution surfaces. */
export const TRACKER_IMAGERY = [
  PERSEIDS,
  MOON_AND_VENUS,
  NIGHT_SKY,
  heroImageryFor("lunar-eclipse", "lunar-eclipse"),
  heroImageryFor("moon", "moon"),
  heroImageryFor("planet-saturn", "planet"),
  heroImageryFor("planet-jupiter", "planet"),
  heroImageryFor("planet-mars", "planet"),
];
