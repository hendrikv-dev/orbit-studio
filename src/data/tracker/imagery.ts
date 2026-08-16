/**
 * What the hero image is, and what it is honestly claiming to be.
 *
 * The imagery exists to make someone want to go outside — it is the invitation,
 * not decoration. But an image of the sky is a claim about what the sky looks
 * like, and the easiest way to ruin a stargazing product is to show a
 * long-exposure photograph and let someone believe that is what their eyes will
 * do. So every image carries a classification, and every classification is
 * shown.
 *
 * The rule the classifications enforce: **the picture may be beautiful, the
 * expectation must be true.** A planetary hero can be a fine telescope capture
 * as long as the eyepiece reality is stated before the user commits to going
 * out, and nothing may imply that a spacecraft mosaic is a backyard view.
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
  "telescope-image": "Telescope image",
  "eyepiece-view": "Likely eyepiece view",
  "long-exposure": "Long-exposure photograph",
  composite: "Composite",
  simulation: "Simulation",
  "forecast-visualisation": "Forecast visualisation",
  "spacecraft-mosaic": "Spacecraft mosaic",
};

export interface HeroImagery {
  /** Which scene to draw. */
  scene:
    | "meteors"
    | "moon"
    | "lunar-eclipse"
    | "planet-saturn"
    | "planet-jupiter"
    | "planet-mars"
    | "planet-venus"
    | "conjunction"
    | "night-sky";
  classification: ImageryClass;
  /**
   * Credit, where the image is somebody's photograph. Null for the drawn
   * scenes, which are this project's own work.
   */
  credit: string | null;
  /**
   * What the eye will actually see, where that differs from the picture. Shown
   * before the user goes outside, never after.
   */
  eyeExpectation: string | null;
}

/**
 * The scene for an opportunity.
 *
 * Keyed on the opportunity's id and kind rather than its title, so a change of
 * wording cannot silently swap the picture.
 */
export function heroImageryFor(id: string, kind: string): HeroImagery {
  if (kind === "meteors") {
    return {
      scene: "meteors",
      classification: "simulation",
      credit: null,
      // The specific dishonesty this guards against: meteor photographs are
      // minutes of exposure stacked together, and no model predicts where an
      // individual meteor will fall.
      eyeExpectation:
        "Drawn from tonight's radiant and rate. Real meteors arrive one at a time, seconds apart at best — the streaks here show where they come from, not when.",
    };
  }
  if (kind === "lunar-eclipse") {
    return {
      scene: "lunar-eclipse",
      classification: "simulation",
      credit: "Lunar surface: NASA's Scientific Visualization Studio (LROC WAC mosaic).",
      eyeExpectation:
        "The colour is real but photographs exaggerate it. To the eye a totally eclipsed Moon is dim, coppery and much darker than you expect.",
    };
  }
  if (kind === "moon") {
    return {
      scene: "moon",
      classification: "spacecraft-mosaic",
      credit: "NASA's Scientific Visualization Studio (LROC WAC mosaic), lit for tonight's phase.",
      eyeExpectation:
        "A real lunar surface, shown at tonight's actual phase. Through binoculars the craters along the lit edge look much like this; to the naked eye it is a bright disc without the detail.",
    };
  }
  if (kind === "conjunction") {
    return {
      scene: "conjunction",
      classification: "simulation",
      credit: null,
      eyeExpectation: "Two steady points, close together. No telescope shows them better than your eyes do.",
    };
  }
  if (kind === "planet") {
    if (id.includes("saturn")) {
      return {
        scene: "planet-saturn",
        classification: "simulation",
        credit: null,
        eyeExpectation:
          "To your eyes Saturn is a steady yellow point, no disc at all. The rings need a telescope, and even then they are a small pale oval rather than this.",
      };
    }
    if (id.includes("jupiter")) {
      return {
        scene: "planet-jupiter",
        classification: "simulation",
        credit: null,
        eyeExpectation:
          "To your eyes Jupiter is the brightest steady point in the sky. Binoculars show its moons as tiny dots in a line; the bands need a telescope.",
      };
    }
    if (id.includes("mars")) {
      return {
        scene: "planet-mars",
        classification: "simulation",
        credit: null,
        eyeExpectation:
          "To your eyes Mars is an orange point. Even a good telescope shows a small disc with faint markings, not a globe.",
      };
    }
    if (id.includes("venus")) {
      return {
        scene: "planet-venus",
        classification: "simulation",
        credit: null,
        eyeExpectation:
          "Brilliant white and unmistakable, but a point of light — the crescent shape needs a telescope.",
      };
    }
  }
  return {
    scene: "night-sky",
    classification: "simulation",
    credit: null,
    eyeExpectation: null,
  };
}
