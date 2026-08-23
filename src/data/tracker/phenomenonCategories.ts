import type { EventCategoryId } from "./eventCategories";
import type { NotableEvent, NotableKind } from "./schedule";

/**
 * The discovery inventory: what Tracker can browse by, and what it cannot yet.
 *
 * Entries that are not backed by a real source stay in the list and stay
 * unselectable. That is the point of keeping them: a filter that silently
 * omits comets tells the reader nothing, while a filter that lists comets and
 * returns an empty result implies Tracker looked and found none. Naming the
 * gap is the only honest third option.
 *
 * Identifiers match `EventCategoryId`, so the browse control, the page heading
 * and the visualization slot are all keyed by the same value. They used to be
 * three separate vocabularies, which is how a category could be selectable in
 * one place and unknown in another.
 */

export type PhenomenonCategoryId = EventCategoryId | "all";

export type PhenomenonSupport = "supported" | "partial" | "not-yet";

export interface PhenomenonCategory {
  id: string;
  label: string;
  support: PhenomenonSupport;
  /** Exactly how far the support goes, in the reader's terms. */
  scope: string;
  selectable: boolean;
}

export const PHENOMENON_CATEGORIES: readonly PhenomenonCategory[] = [
  {
    id: "meteors",
    label: "Meteor showers",
    support: "supported",
    scope: "Tonight, Upcoming, Calendar",
    selectable: true,
  },
  {
    id: "moon",
    label: "Moon phases",
    support: "supported",
    scope: "Tonight, Upcoming, Calendar",
    selectable: true,
  },
  {
    id: "planets",
    label: "Planets",
    support: "supported",
    scope: "Tonight; oppositions in future views",
    selectable: true,
  },
  {
    id: "pairings",
    label: "Close pairings",
    support: "supported",
    scope: "Tonight, Upcoming, Calendar",
    selectable: true,
  },
  {
    id: "eclipses",
    label: "Eclipses",
    support: "supported",
    scope: "Solar and lunar, with real track and visibility geometry",
    selectable: true,
  },
  {
    // Partial, and the scope says why: the nowcast is good for the next half
    // hour and the K-index forecast for three days. There is no long-range
    // aurora product anywhere, and Tracker will not be the first to invent one.
    id: "auroras",
    label: "Aurora",
    support: "partial",
    scope: "Nowcast and three-day risk only; no long-range forecast exists",
    selectable: true,
  },
  {
    id: "occultations",
    label: "Occultations",
    support: "not-yet",
    scope: "No event source or ranking contract",
    selectable: false,
  },
  {
    id: "comets",
    label: "Comets",
    support: "not-yet",
    scope: "No event source or brightness model",
    selectable: false,
  },
  {
    id: "satellites",
    label: "Satellite passes",
    support: "not-yet",
    scope: "Tracker has no live pass-prediction authority",
    selectable: false,
  },
] as const;

export const SELECTABLE_PHENOMENON_CATEGORIES = PHENOMENON_CATEGORIES.filter(
  (category): category is PhenomenonCategory & { id: Exclude<PhenomenonCategoryId, "all"> } =>
    category.selectable,
);

const CATEGORY_FOR_KIND: Record<NotableKind, Exclude<PhenomenonCategoryId, "all">> = {
  eclipse: "eclipses",
  "shower-peak": "meteors",
  conjunction: "pairings",
  "moon-phase": "moon",
  "quarter-phase": "moon",
  "dark-sky": "moon",
  opposition: "planets",
};

export function categoryForNotableKind(kind: NotableKind): Exclude<PhenomenonCategoryId, "all"> {
  return CATEGORY_FOR_KIND[kind];
}

export function filterNotableEvents(
  events: NotableEvent[],
  category: PhenomenonCategoryId,
): NotableEvent[] {
  if (category === "all") return events;
  return events.filter((event) => CATEGORY_FOR_KIND[event.kind] === category);
}
