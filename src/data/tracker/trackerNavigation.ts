import type { PhenomenonCategoryId } from "./phenomenonCategories";
import { isSupportedDate } from "./skyContext";

/**
 * Where the reader is inside Tracker, as one value.
 *
 * ## Why this exists
 *
 * Tracker's navigation used to live in three separate `useState` calls in three
 * separate components — `view` and `selectedId` in `TrackerApp`, `mode`,
 * `category`, `selectedId` and `cursor` in `TrackerUpcoming`, `overlayOpen` in
 * `UpcomingEventPage`. None of them touched the browser's history, so the whole
 * of Tracker occupied a single history entry: the `?app=tracker` page load.
 *
 * The consequence was the defect this module exists to fix. A reader who opened
 * Upcoming, opened an eclipse, opened its map, and pressed Back did not walk
 * back through those three steps — they left Tracker entirely and landed on the
 * Orbit Studio homepage, because that was genuinely the previous history entry.
 * Nothing they had done in Tracker was in the history at all.
 *
 * So navigation is one object, it is encoded in the URL, and each meaningful
 * step is a real history entry. Back and Forward then work because they are the
 * browser's own mechanism rather than something reimplemented on top of it.
 *
 * ## What counts as a step
 *
 * Opening an event, opening a drill-in, and switching between Tonight and
 * Upcoming are things a reader would expect Back to undo, so they push. The
 * category filter, the List/Calendar switch and the calendar's month are part
 * of the state of a page rather than separate pages: they are written into the
 * current entry instead, so that Back from an event restores the list the
 * reader was actually looking at without every filter fiddle becoming a step to
 * walk back through.
 */
export interface TrackerLocation {
  view: "tonight" | "upcoming";
  /**
   * The night being shown, as the observer's calendar date.
   *
   * Null means today, and today is not stored: the resting URL stays
   * `?app=tracker` rather than pinning a date that will be wrong tomorrow, and
   * a link shared without a date opens on the reader's own tonight.
   *
   * Independent of `place` by construction — they are separate fields, so
   * changing one cannot reset the other. That is what makes "what was visible
   * from Seattle on 12 August 2024" two ordinary changes rather than a mode.
   */
  date: string | null;
  /**
   * The event being shown.
   *
   * In Tonight this is the hero; in Upcoming it is the opened detail page, and
   * null means the browse view. One field rather than two because a given
   * location only ever has one of them.
   */
  eventId: string | null;
  /**
   * How Upcoming is presented.
   *
   * Three modes, because the control offered two and one of them was mislabelled:
   * what the tab called "List" was a card grid, which is a gallery. A real list
   * is a different tool — it trades pictures for density so more of the month
   * can be scanned at once — and calling the gallery one meant Tracker had no
   * way to offer it.
   */
  mode: "gallery" | "list" | "calendar";
  category: PhenomenonCategoryId;
  /** The calendar's month. Null in list mode, where the range follows now. */
  year: number | null;
  month: number | null;
  /**
   * An open drill-in, if any.
   *
   * `sky` is the altitude-and-bearing chart — where to look. `field` is the
   * geographic map — where on Earth. They are different tools answering
   * different questions, and conflating them is what made a control labelled
   * "View visibility map" open a sky chart.
   */
  drill: "sky" | "field" | null;
}

export const TRACKER_APP_PARAM = "app";
export const TRACKER_APP_VALUE = "tracker";

const VIEWS = new Set(["tonight", "upcoming"]);
const MODES = new Set(["gallery", "list", "calendar"]);
const DRILLS = new Set(["sky", "field"]);

export function defaultTrackerLocation(): TrackerLocation {
  return {
    view: "tonight",
    date: null,
    eventId: null,
    mode: "gallery",
    category: "all",
    year: null,
    month: null,
    drill: null,
  };
}

/**
 * Reads a location out of a query string.
 *
 * Deliberately total: anything unrecognised falls back to the default rather
 * than throwing, because this parses whatever a reader has in their address bar
 * — including a URL they edited, or one from an older build.
 */
export function parseTrackerLocation(search: string): TrackerLocation {
  const params = new URLSearchParams(search);
  const location = defaultTrackerLocation();

  const view = params.get("view");
  if (view && VIEWS.has(view)) location.view = view as TrackerLocation["view"];

  const date = params.get("date");
  if (date && isSupportedDate(date)) location.date = date;

  const mode = params.get("mode");
  if (mode && MODES.has(mode)) location.mode = mode as TrackerLocation["mode"];

  const category = params.get("filter");
  if (category) location.category = category as PhenomenonCategoryId;

  const eventId = params.get("event");
  if (eventId) location.eventId = eventId;

  const month = params.get("month");
  if (month) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (match) {
      const year = Number(match[1]);
      const monthNumber = Number(match[2]);
      if (monthNumber >= 1 && monthNumber <= 12) {
        location.year = year;
        location.month = monthNumber;
      }
    }
  }

  const drill = params.get("drill");
  if (drill && DRILLS.has(drill)) location.drill = drill as TrackerLocation["drill"];

  return location;
}

/**
 * Writes a location back into a query string.
 *
 * Only what differs from the default is written, so the resting URL stays
 * `?app=tracker` rather than accumulating six parameters that all say "the
 * default". `app=tracker` is always kept: it is what routes the page to this
 * bundle at all, and losing it on a refresh would drop the reader into the
 * Explorer entry with its 17 MB catalogue.
 */
export function trackerLocationToSearch(location: TrackerLocation): string {
  const params = new URLSearchParams();
  params.set(TRACKER_APP_PARAM, TRACKER_APP_VALUE);

  if (location.view !== "tonight") params.set("view", location.view);
  if (location.date) params.set("date", location.date);
  if (location.view === "upcoming") {
    if (location.mode !== "gallery") params.set("mode", location.mode);
    if (location.category !== "all") params.set("filter", location.category);
    if (location.mode === "calendar" && location.year !== null && location.month !== null) {
      params.set("month", `${location.year}-${String(location.month).padStart(2, "0")}`);
    }
  }
  if (location.eventId) params.set("event", location.eventId);
  if (location.drill) params.set("drill", location.drill);

  return `?${params.toString()}`;
}

/**
 * Whether moving between two locations is a step a reader would expect Back to
 * undo.
 *
 * The rule is about what changed, not about how far: opening an event, opening
 * a drill-in, or crossing between Tonight and Upcoming are all navigation.
 * Re-filtering a list is not — it changes what the current page shows rather
 * than moving to a different one.
 */
export function isNavigationStep(from: TrackerLocation, to: TrackerLocation): boolean {
  return (
    from.view !== to.view ||
    from.eventId !== to.eventId ||
    from.drill !== to.drill ||
    // Moving to another date is navigation in the sense that matters: Back
    // should return the reader to the night they came from, the same way it
    // returns them to the event they came from.
    from.date !== to.date
  );
}

export function sameTrackerLocation(a: TrackerLocation, b: TrackerLocation): boolean {
  return (
    a.view === b.view &&
    a.date === b.date &&
    a.eventId === b.eventId &&
    a.mode === b.mode &&
    a.category === b.category &&
    a.year === b.year &&
    a.month === b.month &&
    a.drill === b.drill
  );
}
