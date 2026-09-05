import { SearchLunarEclipse } from "astronomy-engine";
import { searchEvents, showerFor, type CatalogueEvent } from "./eventCatalogue";
import { lunarEclipseTiming, lunarLocalVisibility } from "./lunarEclipse";
import { localSolarCircumstances, nextSolarEclipses } from "./solarEclipse";
import { describePotential, meteorPotentialAt } from "./meteorPotential";

/**
 * Finding an event, and finding one that happens *where the reader is*.
 *
 * ## Two questions, not one
 *
 * "When is the next total solar eclipse" and "when is the next total solar
 * eclipse I could actually go outside and watch" are different questions with
 * wildly different answers — for most places on Earth the second is decades
 * further away than the first. The search box answered only the first, and a
 * reader who typed "next total solar eclipse here" got the global one with no
 * hint that its path is nine thousand kilometres from their pin.
 *
 * So the query carries an intent. `next eclipse` is a question about the sky;
 * `next eclipse visible here` is a question about the reader's own patch of
 * ground, and is answered by evaluating candidates against their coordinates
 * until one qualifies.
 *
 * ## "Here" is the pin, and nothing else
 *
 * Not an IP lookup, not the map's centre. The reader has chosen a place —
 * that is the whole first step of the product — and quietly answering about
 * somewhere else would be worse than refusing. With no place chosen there is
 * no "here", and the caller is told so rather than being given a guess.
 *
 * ## Every result says where it stands with the reader
 *
 * Even for a global search: once a place is known, a row that says only "Total
 * solar eclipse · 2 Aug 2027" is withholding the one fact that decides whether
 * it matters. `Total here`, `Partial here · 63%`, `Moon sets during eclipse`,
 * `Not visible here` — phenomenon-appropriate, and derived from the same local
 * circumstance code the map and the cards use, so a row and the map it leads to
 * can never disagree.
 */

export type SearchScope = "anywhere" | "here";

export interface ParsedEventQuery {
  /** What is left to match on once the locality words are removed. */
  text: string;
  scope: SearchScope;
}

export interface LocalRelation {
  /** The row's own words: "Total here", "Partial here · 63%". */
  label: string;
  /** Whether this counts as observable from the reader's coordinates. */
  visible: boolean;
}

export interface EventSearchResult {
  event: CatalogueEvent;
  /** Null when no place is chosen, because then there is no "here". */
  local: LocalRelation | null;
}

export interface SearchPlace {
  latitude: number;
  longitude: number;
}

/**
 * The ways people write "from where I am", longest first.
 *
 * Longest first matters: "visible here" has to be consumed before "here", or
 * the shorter phrase leaves "visible" behind as a search term and the query
 * matches nothing.
 */
const LOCALITY_PHRASES = [
  "visible from where i am",
  "visible from my location",
  "visible from here",
  "from my location",
  "at my location",
  "visible from me",
  "visible here",
  "my location",
  "from here",
  "near me",
  "for me",
  "here",
];

/** Split a query into what to match and whether it is asking about the pin. */
export function parseEventQuery(query: string): ParsedEventQuery {
  let text = ` ${query.toLowerCase().replace(/\s+/g, " ").trim()} `;
  let scope: SearchScope = "anywhere";
  for (const phrase of LOCALITY_PHRASES) {
    const needle = ` ${phrase} `;
    if (text.includes(needle)) {
      text = text.split(needle).join(" ");
      scope = "here";
    }
  }
  return { text: text.trim(), scope };
}

/**
 * The reader's relationship to one event, at their own coordinates.
 *
 * Point evaluations rather than fields: a search shows up to eight rows, and
 * building an eclipse's whole coverage grid eight times over to label them
 * would cost seconds. These are the same functions the field is sampled from,
 * asked once each.
 */
export function localRelation(
  event: CatalogueEvent,
  place: SearchPlace,
): LocalRelation | null {
  if (event.kind === "solar-eclipse") return solarRelation(event, place);
  if (event.kind === "lunar-eclipse") return lunarRelation(event, place);
  return showerRelation(event, place);
}

function solarRelation(event: CatalogueEvent, place: SearchPlace): LocalRelation | null {
  const at = new Date(event.atUtc);
  const found = nextSolarEclipses(new Date(at.getTime() - 86_400_000), 2).find(
    (entry) => Math.abs(Date.parse(entry.peakUtc) - at.getTime()) < 86_400_000,
  );
  if (!found) return null;

  const local = localSolarCircumstances(found, place.latitude, place.longitude);
  if (local.kind === "none" || local.obscurationFraction <= 0) {
    return { label: "Not visible here", visible: false };
  }
  /**
   * An eclipse that happens below the horizon is not an eclipse you can see.
   *
   * The geometry is real — the Moon really does cover the Sun for that
   * coordinate — and the reader is on the night side of the planet while it
   * does. Reporting "Partial here · 41%" would be true and useless.
   */
  if (local.sunAltitudeAtPeakDeg <= 0) {
    return { label: "Below the horizon here", visible: false };
  }
  const percent = Math.round(local.obscurationFraction * 100);
  if (local.kind === "total") return { label: "Total here", visible: true };
  if (local.kind === "annular") return { label: "Annular here", visible: true };
  return { label: `Partial here · ${percent}%`, visible: true };
}

function lunarRelation(event: CatalogueEvent, place: SearchPlace): LocalRelation | null {
  const at = new Date(event.atUtc);
  const eclipse = SearchLunarEclipse(new Date(at.getTime() - 2 * 86_400_000));
  if (!eclipse) return null;
  const timing = lunarEclipseTiming(eclipse);
  if (Math.abs(Date.parse(timing.maximumUtc) - at.getTime()) > 86_400_000) return null;

  const local = lunarLocalVisibility(timing, place.latitude, place.longitude);
  if (local.band === "none") return { label: "Not visible here", visible: false };
  if (local.band === "moonrise") return { label: "Moon rises during eclipse", visible: true };
  if (local.band === "moonset") return { label: "Moon sets during eclipse", visible: true };
  return { label: "Visible here", visible: true };
}

function showerRelation(event: CatalogueEvent, place: SearchPlace): LocalRelation | null {
  const shower = showerFor(event);
  if (!shower) return null;
  const cell = meteorPotentialAt(shower, new Date(event.atUtc), place.latitude, place.longitude);
  // The same distinction the overlay draws: a shower nobody at this latitude
  // can see is not a weak shower, and calling it one invites the reader to go
  // out and be disappointed by the sky rather than by the geometry.
  if (cell.radiantTerm === 0) return { label: "Radiant never rises here", visible: false };
  if (cell.darkHours === 0) return { label: "No darkness here that night", visible: false };
  return { label: `${describePotential(cell.potential)} here`, visible: cell.potential > 0.02 };
}

/**
 * Search, with the reader's place taken into account where there is one.
 *
 * A local query filters rather than labels: asking for "the next lunar eclipse
 * visible here" and being handed one that is not, marked "Not visible here", is
 * an answer to a question nobody asked. A global query keeps everything and
 * labels it, because "the next total solar eclipse is in 2027 and you would
 * have to travel" is exactly what that question deserves.
 *
 * `horizon` is how many candidates to evaluate before giving up. A local search
 * can walk a long way — a total eclipse over one town is centuries apart — and
 * the catalogue is finite, so running out is a real answer that the caller
 * reports as a limit of the catalogue rather than as "there is no such event".
 */
export function searchEventsNear(
  query: string,
  from: Date,
  place: SearchPlace | null,
  limit = 8,
  horizon = 60,
): {
  results: EventSearchResult[];
  scope: SearchScope;
  /** How many the text search matched before the local filter, for the copy. */
  considered: number;
  exhausted: boolean;
} {
  const parsed = parseEventQuery(query);
  if (parsed.text.length === 0) {
    return { results: [], scope: parsed.scope, considered: 0, exhausted: false };
  }

  const candidates = searchEvents(parsed.text, from, horizon);
  const results: EventSearchResult[] = [];
  for (const event of candidates) {
    const local = place ? localRelation(event, place) : null;
    if (parsed.scope === "here" && place && !(local?.visible ?? false)) continue;
    results.push({ event, local });
    if (results.length >= limit) break;
  }

  return {
    results,
    scope: parsed.scope,
    considered: candidates.length,
    /**
     * The catalogue ran out, rather than the sky being empty.
     *
     * True when a local search matched events globally and could not fill its
     * list from the ones that qualify here. The difference matters and the
     * interface has to say it: "no total solar eclipse is visible from this
     * place in the next four years" is true, and "there is no such event" is
     * not. Totality returns to a given town about once every three or four
     * centuries, so this is the *ordinary* answer to a reasonable question, not
     * an error.
     */
    exhausted:
      parsed.scope === "here" &&
      Boolean(place) &&
      results.length < limit &&
      candidates.length > results.length,
  };
}
