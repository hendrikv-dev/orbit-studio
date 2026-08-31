import type { OpportunityKind } from "./opportunity";

/**
 * The categories a Tracker page can be about, and what each page says it is.
 *
 * There is one page. Its geometry — heading, hero, visualization slot, four
 * condition cards, ranked list — does not change between a meteor shower and an
 * eclipse, and this table is the reason it does not have to: the only things
 * that vary are a heading, a line under it, and which drawing goes in the slot.
 *
 * Keeping that here rather than in the components is what stops the drift the
 * previous version had. Aurora, eclipse and meteor pages were each free to
 * decide their own shape, and each one did, so a reader moving between them was
 * relearning the interface every time. A category cannot introduce a layout;
 * it can only fill the slots this table names.
 */

export type EventCategoryId =
  | "meteors"
  | "auroras"
  | "eclipses"
  | "planets"
  | "moon"
  | "pairings"
  | "deep-sky";

/**
 * Which drawing belongs in the fixed visualization slot.
 *
 * Named by what the drawing *answers*, not by what it looks like. `geo-forecast`
 * and `geo-coverage` are both maps and are deliberately separate, because one
 * shows a probability field that changes hour to hour and the other shows a
 * geometry fixed centuries in advance — and a reader who cannot tell those
 * apart has been misled by the interface, not by the data.
 */
export type VisualizationKind =
  /** Activity through the night: evening to dawn, with the best period obvious. */
  | "night-activity"
  /** A forecast field over a region, with the observer on it. */
  | "geo-forecast"
  /** Fixed geometry over a region: an eclipse track, or a visibility footprint. */
  | "geo-coverage"
  /** One object's path across the observing window, in altitude and bearing. */
  | "sky-path";

export interface EventCategory {
  id: EventCategoryId;
  /** The page heading. Always in the same place, at the same size. */
  heading: string;
  /** The line under it, for the immediate observing night. */
  /** Template. `{night}` is filled with the night on screen. */
  tonightSubtitle: string;
  /** The line under it, for anything beyond tonight. */
  upcomingSubtitle: string;
  visualization: VisualizationKind;
  /** Phenomenon hue, used only where hue carries information. */
  tone: string;
}

export const EVENT_CATEGORIES: Record<EventCategoryId, EventCategory> = {
  meteors: {
    id: "meteors",
    heading: "Meteor showers",
    tonightSubtitle: "Ranked for your location {night}",
    upcomingSubtitle: "Peaks worth planning around",
    visualization: "night-activity",
    tone: "meteor",
  },
  auroras: {
    id: "auroras",
    heading: "Auroras",
    tonightSubtitle: "Forecast for your location {night}",
    upcomingSubtitle: "Only as far ahead as the forecast reaches",
    visualization: "geo-forecast",
    tone: "aurora",
  },
  eclipses: {
    id: "eclipses",
    heading: "Eclipses",
    tonightSubtitle: "Relevant to your location",
    upcomingSubtitle: "Relevant to your location",
    visualization: "geo-coverage",
    tone: "eclipse",
  },
  planets: {
    id: "planets",
    heading: "Planets",
    tonightSubtitle: "Where they are from your location {night}",
    upcomingSubtitle: "Best placements ahead",
    visualization: "sky-path",
    tone: "planet",
  },
  moon: {
    id: "moon",
    heading: "The Moon",
    tonightSubtitle: "The phase from your location {night}",
    upcomingSubtitle: "Phases worth timing an evening around",
    visualization: "sky-path",
    tone: "moon",
  },
  pairings: {
    id: "pairings",
    heading: "Close pairings",
    tonightSubtitle: "Two objects close enough to see together",
    upcomingSubtitle: "Conjunctions worth planning around",
    visualization: "sky-path",
    tone: "planet",
  },
  "deep-sky": {
    id: "deep-sky",
    heading: "Deep sky",
    tonightSubtitle: "Faint targets from your location {night}",
    upcomingSubtitle: "Best placements ahead",
    visualization: "sky-path",
    tone: "neutral",
  },
};

const KIND_TO_CATEGORY: Record<OpportunityKind, EventCategoryId> = {
  meteors: "meteors",
  moon: "moon",
  planet: "planets",
  conjunction: "pairings",
  "lunar-eclipse": "eclipses",
  "solar-eclipse": "eclipses",
  "deep-sky": "deep-sky",
};

export function categoryForOpportunityKind(kind: OpportunityKind): EventCategoryId {
  return KIND_TO_CATEGORY[kind];
}

export function categoryOf(id: EventCategoryId): EventCategory {
  return EVENT_CATEGORIES[id];
}

/**
 * The subtitle for a page, which depends on when the event is as well as what
 * it is.
 *
 * "Ranked for your location tonight" under an eclipse three months away would
 * be a small lie told by a layout constant, which is exactly the kind that
 * survives review.
 */
export function subtitleFor(id: EventCategoryId, nightWord: string): string {
  const category = EVENT_CATEGORIES[id];
  /**
   * The night on screen, not the night the copy was written for.
   *
   * The subtitles are templates now. They used to be constants ending in
   * "tonight", which is the small lie the note above warns about: a page
   * showing 12 September introduced itself as "Where they are from your
   * location tonight". `describeDate` supplies "tonight", "tomorrow",
   * "last night" or "on 12 Sep", and the sentence reads in all four.
   */
  return category.tonightSubtitle.replace("{night}", nightWord);
}
