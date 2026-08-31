import { SearchLunarEclipse, type LunarEclipseInfo } from "astronomy-engine";
import { METEOR_SHOWERS, type MeteorShower } from "./meteorShowers";
import { showerPeakTime } from "./meteorActivity";
import { nextSolarEclipses, type SolarEclipseEvent } from "./solarEclipse";
import { todayIn } from "./skyContext";

/**
 * Notable events, findable by name rather than by stepping through dates.
 *
 * ## Why this exists
 *
 * The date control is the right primary temporal control and it is a terrible
 * way to *find* anything. Nobody knows the date of the next annular eclipse;
 * that is the question, not the input. Before this, the only way to reach one
 * was to already know when it was — which meant the answer was reachable only
 * by people who did not need it.
 *
 * ## What it is not
 *
 * Not a second temporal architecture. Choosing an event sets the date and
 * selects the event; the date control remains authoritative and the reader can
 * step away from it immediately. This is a shortcut into a state the product
 * already had, not a mode.
 */

export type TrackerEventKind = "solar-eclipse" | "lunar-eclipse" | "meteor-shower";

export interface CatalogueEvent {
  /** Stable across recomputation, and what the URL carries. */
  id: string;
  kind: TrackerEventKind;
  title: string;
  /** What kind of thing it is, for the result row. */
  category: string;
  /** The instant the event is about, which the overlay and the date derive from. */
  atUtc: string;
  /** Extra identity the overlay needs, without recomputing the search. */
  detail?: { showerCode?: string };
}

/** How far ahead a search will look before giving up. */
const HORIZON_YEARS = 4;

/**
 * Solar eclipses, from the engine's own catalogue.
 *
 * Every eclipse, not only the ones visible from where the reader happens to be:
 * "the next total solar eclipse" is a question about the world, and the map is
 * what answers where it can be seen from. Filtering the list to a location
 * would make the map's whole job invisible.
 */
export function upcomingSolarEclipses(from: Date, count = 6): CatalogueEvent[] {
  return nextSolarEclipses(from, count).map((eclipse) => ({
    id: eclipse.id,
    kind: "solar-eclipse" as const,
    title: `${titleCase(eclipse.kind)} solar eclipse`,
    category: "Solar eclipse",
    atUtc: eclipse.peakUtc,
  }));
}

/** Lunar eclipses, walked forward from a date. */
export function upcomingLunarEclipses(from: Date, count = 6): CatalogueEvent[] {
  const out: CatalogueEvent[] = [];
  let search: LunarEclipseInfo | null = SearchLunarEclipse(from);
  const limit = from.getTime() + HORIZON_YEARS * 365.25 * 86_400_000;
  while (search && out.length < count && search.peak.date.getTime() <= limit) {
    const peak = search.peak.date;
    out.push({
      id: `lunar-eclipse-${peak.toISOString().slice(0, 10)}`,
      kind: "lunar-eclipse",
      title: `${titleCase(search.kind)} lunar eclipse`,
      category: "Lunar eclipse",
      atUtc: peak.toISOString(),
    });
    // A day past this one, so the next search does not find the same eclipse.
    search = SearchLunarEclipse(new Date(peak.getTime() + 86_400_000));
  }
  return out;
}

/**
 * Meteor shower maxima, one per shower per year.
 *
 * `showerPeakTime` solves for the solar longitude of maximum, so these are the
 * real peaks rather than the calendar dates a table would carry.
 */
export function upcomingMeteorShowers(from: Date, count = 8): CatalogueEvent[] {
  const out: CatalogueEvent[] = [];
  for (let year = 0; year <= HORIZON_YEARS; year += 1) {
    for (const shower of METEOR_SHOWERS) {
      const near = new Date(from.getTime() + year * 365.25 * 86_400_000);
      const peak = showerPeakTime(shower, near);
      if (!peak || peak.getTime() < from.getTime()) continue;
      const id = `meteor-shower-${shower.code}-${peak.toISOString().slice(0, 10)}`;
      if (out.some((entry) => entry.id === id)) continue;
      out.push({
        id,
        kind: "meteor-shower",
        title: shower.name,
        category: "Meteor shower",
        atUtc: peak.toISOString(),
        detail: { showerCode: shower.code },
      });
    }
  }
  out.sort((a, b) => Date.parse(a.atUtc) - Date.parse(b.atUtc));
  return out.slice(0, count);
}

/**
 * Everything findable, nearest first.
 *
 * The counts are generous on purpose. A catalogue truncated to the soonest few
 * of each kind is fine for a list and wrong for a search: from late August the
 * next Perseids is eleven months away, so a short list drops them and typing
 * "Perseids" found nothing. Searching a horizon and showing a few results is
 * the right way round; building a few results and searching those is not.
 *
 * Built on demand rather than cached — four years is a few dozen entries, and
 * computing them costs less than the machinery to keep a cache fresh would.
 */
export function catalogue(from: Date): CatalogueEvent[] {
  return [
    ...upcomingSolarEclipses(from, 10),
    ...upcomingLunarEclipses(from, 10),
    ...upcomingMeteorShowers(from, METEOR_SHOWERS.length * (HORIZON_YEARS + 1)),
  ].sort((a, b) => Date.parse(a.atUtc) - Date.parse(b.atUtc));
}

/**
 * What the reader typed, against what there is.
 *
 * Deliberately forgiving about "next": people type "next eclipse" and mean
 * "the soonest one", which is what an ordered list already gives them, so the
 * word is treated as an ordinary term that every entry matches rather than as
 * a keyword with its own parsing. "next perseids" and "perseids" therefore
 * return the same thing, which is what somebody typing either of them wants.
 */
export function searchEvents(query: string, from: Date, limit = 8): CatalogueEvent[] {
  const terms = query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && term !== "next" && term !== "the");
  if (terms.length === 0) return [];

  const scored = catalogue(from)
    .map((event) => {
      const haystack = `${event.title} ${event.category} ${event.kind}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += term.length >= 4 ? 2 : 1;
      }
      return { event, score };
    })
    .filter((entry) => entry.score > 0);

  const best = Math.max(0, ...scored.map((entry) => entry.score));
  return scored
    .filter((entry) => entry.score === best)
    .slice(0, limit)
    .map((entry) => entry.event);
}

/**
 * The observer's calendar date for an event, which is what the date control shows.
 *
 * A meteor shower peaking at 03:00 local belongs to the *previous* evening's
 * night, which is the night somebody would go out on. Everything else is dated
 * by the day it happens on. Getting this wrong sends the reader to an empty
 * night with the shower a day behind them.
 */
export function eventDate(event: CatalogueEvent, timeZone: string | null): string {
  const at = new Date(event.atUtc);
  if (event.kind === "meteor-shower") {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timeZone ?? undefined,
        hour: "2-digit",
        hour12: false,
      }).format(at),
    );
    if (hour < 12) return todayIn(timeZone, new Date(at.getTime() - 12 * 3_600_000));
  }
  return todayIn(timeZone, at);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** The shower behind a catalogue entry, where there is one. */
export function showerFor(event: CatalogueEvent): MeteorShower | null {
  const code = event.detail?.showerCode;
  if (!code) return null;
  return METEOR_SHOWERS.find((shower) => shower.code === code) ?? null;
}
