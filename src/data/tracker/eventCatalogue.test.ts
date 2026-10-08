import { describe, expect, it } from "vitest";
import { catalogue, eventDate, searchEvents, upcomingLunarEclipses, upcomingSolarEclipses } from "./eventCatalogue";

const FROM = new Date("2026-08-29T00:00:00Z");

describe("the event catalogue", () => {
  it("finds real solar eclipses ahead of a date", () => {
    const found = upcomingSolarEclipses(FROM, 3);
    expect(found).toHaveLength(3);
    for (const event of found) {
      expect(Date.parse(event.atUtc)).toBeGreaterThan(FROM.getTime());
      expect(event.title).toMatch(/solar eclipse/i);
    }
    // The 12 August 2026 total is behind us; the next is the 17 February 2027
    // annular, and the 2 August 2027 total follows it.
    expect(found[0].atUtc.slice(0, 7)).toBe("2027-02");
    expect(found.some((event) => event.atUtc.slice(0, 10) === "2027-08-02")).toBe(true);
  });

  it("finds lunar eclipses without returning the same one twice", () => {
    const found = upcomingLunarEclipses(FROM, 4);
    expect(found).toHaveLength(4);
    const dates = found.map((event) => event.atUtc.slice(0, 10));
    expect(new Set(dates).size).toBe(dates.length);
    for (let index = 1; index < found.length; index += 1) {
      expect(Date.parse(found[index].atUtc)).toBeGreaterThan(Date.parse(found[index - 1].atUtc));
    }
  });

  it("orders everything by when it happens", () => {
    const all = catalogue(FROM);
    expect(all.length).toBeGreaterThan(10);
    for (let index = 1; index < all.length; index += 1) {
      expect(Date.parse(all[index].atUtc)).toBeGreaterThanOrEqual(Date.parse(all[index - 1].atUtc));
    }
  });

  describe("search", () => {
    it("treats 'next' as noise rather than as a keyword", () => {
      const withWord = searchEvents("next perseids", FROM);
      const without = searchEvents("perseids", FROM);
      expect(withWord[0]?.id).toBe(without[0]?.id);
      expect(withWord[0]?.title).toMatch(/perseid/i);
    });

    it("finds the soonest solar eclipse for a broad query", () => {
      const found = searchEvents("next solar eclipse", FROM);
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].kind).toBe("solar-eclipse");
      expect(Date.parse(found[0].atUtc)).toBeGreaterThan(FROM.getTime());
    });

    it("separates lunar from solar", () => {
      expect(searchEvents("lunar eclipse", FROM)[0].kind).toBe("lunar-eclipse");
      expect(searchEvents("solar eclipse", FROM)[0].kind).toBe("solar-eclipse");
    });

    it("returns both kinds for a bare 'eclipse'", () => {
      const kinds = new Set(searchEvents("eclipse", FROM, 12).map((event) => event.kind));
      expect(kinds.has("solar-eclipse")).toBe(true);
      expect(kinds.has("lunar-eclipse")).toBe(true);
    });

    it("says nothing rather than guessing", () => {
      expect(searchEvents("", FROM)).toHaveLength(0);
      expect(searchEvents("next", FROM)).toHaveLength(0);
      expect(searchEvents("zzzz", FROM)).toHaveLength(0);
    });
  });

  it("dates a shower peaking after midnight to the evening it belongs to", () => {
    const event = {
      id: "x",
      kind: "meteor-shower" as const,
      title: "Perseids",
      category: "Meteor shower",
      // 03:00 UTC, which is the small hours of the 13th in London.
      atUtc: "2026-08-13T03:00:00Z",
    };
    expect(eventDate(event, "Europe/London")).toBe("2026-08-12");
    // A solar eclipse at the same instant belongs to the day it happens on.
    expect(eventDate({ ...event, kind: "solar-eclipse" }, "Europe/London")).toBe("2026-08-13");
  });
});
