import { describe, expect, it } from "vitest";
import { localRelation, parseEventQuery, searchEventsNear } from "./eventSearch";
import { catalogue } from "./eventCatalogue";

/** A fixed instant, so "the next eclipse" is a fixed eclipse. */
const FROM = new Date("2026-09-01T00:00:00Z");
const TROUTDALE = { latitude: 45.54, longitude: -122.4 };
/** Inside the path of the 2 August 2027 total solar eclipse. */
const LUXOR = { latitude: 25.687, longitude: 32.64 };

const eventFor = (id: string) => catalogue(FROM).find((entry) => entry.id === id)!;

describe("reading the intent in a query", () => {
  it("finds the word that changes the question", () => {
    expect(parseEventQuery("next solar eclipse")).toEqual({
      text: "next solar eclipse",
      scope: "anywhere",
    });
    expect(parseEventQuery("next solar eclipse here")).toEqual({
      text: "next solar eclipse",
      scope: "here",
    });
  });

  /**
   * Longest phrase first, or the short one wins and ruins the search.
   *
   * "visible here" has to be consumed whole. Strip "here" first and "visible"
   * is left behind as a search term, and since no event title contains it, a
   * perfectly ordinary question returns nothing at all.
   */
  it("takes the longest phrasing rather than the first match inside it", () => {
    for (const query of [
      "next lunar eclipse visible here",
      "next lunar eclipse visible from here",
      "next lunar eclipse from my location",
      "next lunar eclipse near me",
    ]) {
      expect(parseEventQuery(query)).toEqual({ text: "next lunar eclipse", scope: "here" });
    }
  });

  it("leaves a query with no locality word alone", () => {
    expect(parseEventQuery("Perseids").scope).toBe("anywhere");
    expect(parseEventQuery("geminids").text).toBe("geminids");
  });
});

describe("what an event does at the reader's own coordinates", () => {
  it("says total where the observer stands in the path", () => {
    const relation = localRelation(eventFor("solar-eclipse-2027-08-02"), LUXOR);
    expect(relation).toEqual({ label: "Total here", visible: true });
  });

  it("says not visible where the shadow never arrives", () => {
    const relation = localRelation(eventFor("solar-eclipse-2027-08-02"), TROUTDALE);
    expect(relation?.visible).toBe(false);
    expect(relation?.label).toMatch(/not visible/i);
  });

  /**
   * A partial eclipse quotes how partial, because that is the decision.
   *
   * "Partial" alone covers everything from a nick out of the limb to a
   * ninety-nine percent crescent, and those are different evenings.
   */
  it("quotes the coverage for a partial", () => {
    const relation = localRelation(eventFor("solar-eclipse-2029-01-14"), TROUTDALE);
    expect(relation?.label).toMatch(/^Partial here · \d+%$/);
    expect(relation?.visible).toBe(true);
  });

  it("uses the lunar bands, which are about the Moon being up", () => {
    const relation = localRelation(eventFor("lunar-eclipse-2027-08-17"), TROUTDALE);
    expect(["Visible here", "Moon rises during eclipse", "Moon sets during eclipse"]).toContain(
      relation?.label,
    );
  });

  it("grades a shower where it is observable and refuses to where it is not", () => {
    const perseids = eventFor("meteor-shower-PER-2027-08-12");
    const north = localRelation(perseids, TROUTDALE);
    expect(north?.visible).toBe(true);
    expect(north?.label).toMatch(/here$/);

    // Melbourne: the Perseid radiant is at +58° declination and never rises.
    const south = localRelation(perseids, { latitude: -37.81, longitude: 144.96 });
    expect(south).toEqual({ label: "Radiant never rises here", visible: false });
  });
});

describe("searching with a place in mind", () => {
  it("labels every result of a global search without dropping any", () => {
    const found = searchEventsNear("solar eclipse", FROM, TROUTDALE, 5);
    expect(found.scope).toBe("anywhere");
    expect(found.results.length).toBe(5);
    expect(found.results.every((result) => result.local !== null)).toBe(true);
    // The 2027 totality is the famous one, and it is not visible from Oregon.
    // A global search must still offer it, because that was the question.
    expect(found.results.some((result) => result.local?.visible === false)).toBe(true);
  });

  it("filters rather than labels when the question is local", () => {
    const found = searchEventsNear("solar eclipse here", FROM, TROUTDALE, 5);
    expect(found.scope).toBe("here");
    expect(found.results.every((result) => result.local?.visible === true)).toBe(true);
  });

  /**
   * Running out of catalogue is not the same as there being nothing.
   *
   * Totality returns to a given town roughly once every three or four
   * centuries. "No total solar eclipse is visible from Oregon in the next four
   * years" is true; "there is no such event" is not, and the caller needs to be
   * able to tell the difference in order to say the right thing.
   */
  it("reports a catalogue that ran out, rather than an empty sky", () => {
    const found = searchEventsNear("total solar eclipse here", FROM, TROUTDALE, 5);
    expect(found.results).toHaveLength(0);
    expect(found.considered).toBeGreaterThan(0);
    expect(found.exhausted).toBe(true);
  });

  it("does not claim exhaustion when the words simply matched nothing", () => {
    const found = searchEventsNear("zzzzz here", FROM, TROUTDALE, 5);
    expect(found.results).toHaveLength(0);
    expect(found.considered).toBe(0);
    expect(found.exhausted).toBe(false);
  });

  it("has no opinion about here when there is no here", () => {
    const found = searchEventsNear("solar eclipse here", FROM, null, 5);
    expect(found.scope).toBe("here");
    expect(found.results.every((result) => result.local === null)).toBe(true);
  });
});
