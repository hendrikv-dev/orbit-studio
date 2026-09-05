import { catalogue, eventDate, type TrackerEventKind } from "./eventCatalogue";
import type { LocalDate } from "./skyContext";

/**
 * Which days in a range carry an eclipse or a shower peak.
 *
 * ## Why the calendar marks anything at all
 *
 * The month started deliberately blank: a calendar with events drawn on it is a
 * second discovery surface competing with the observing rail, and keeping one
 * ranking honest is work enough.
 *
 * Marks are not that. They say only "something happens on this day", for the
 * two kinds of event whose date is the entire point — an eclipse and a shower
 * peak happen on a date and nowhere else on the calendar, and a reader opening
 * a month to find one should not have to already know when it is. They carry no
 * ranking, no quality, and no local circumstances; choosing the day is still
 * what tells the reader whether it is worth anything from where they are.
 *
 * ## Why only these two kinds
 *
 * Planets and the Moon are up most nights, so marking them would mark almost
 * every square and say nothing. Aurora is a forecast, not a date. What is left
 * is exactly the set of events a person looks up a calendar to find.
 */

export type MarkerKind = Extract<
  TrackerEventKind,
  "solar-eclipse" | "lunar-eclipse" | "meteor-shower"
>;

/** The order marks are drawn in, so a day with two is always laid out the same. */
const ORDER: MarkerKind[] = ["solar-eclipse", "lunar-eclipse", "meteor-shower"];

/**
 * Marks for every day between `from` and `to` inclusive.
 *
 * The catalogue is searched from a little before the range, because it only
 * looks forward and a range starting mid-month would otherwise miss an event
 * on its own first day. It has a finite horizon; months beyond it simply come
 * back unmarked, which is the truthful answer — Tracker does not know.
 */
export function markersForRange(
  from: LocalDate,
  to: LocalDate,
  timeZone: string | null,
): Map<LocalDate, MarkerKind[]> {
  const marks = new Map<LocalDate, MarkerKind[]>();
  const searchFrom = new Date(`${from}T00:00:00Z`);
  searchFrom.setUTCDate(searchFrom.getUTCDate() - 2);

  for (const event of catalogue(searchFrom)) {
    const kind = event.kind as MarkerKind;
    if (!ORDER.includes(kind)) continue;
    const date = eventDate(event, timeZone);
    if (date < from || date > to) continue;
    const existing = marks.get(date);
    if (existing) {
      if (!existing.includes(kind)) {
        existing.push(kind);
        existing.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      }
    } else {
      marks.set(date, [kind]);
    }
  }
  return marks;
}

/** What a marked day should say to a screen reader, appended to its date. */
export function describeMarkers(kinds: MarkerKind[]): string {
  const words: Record<MarkerKind, string> = {
    "solar-eclipse": "solar eclipse",
    "lunar-eclipse": "lunar eclipse",
    "meteor-shower": "meteor shower peak",
  };
  const list = kinds.map((kind) => words[kind]);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}
