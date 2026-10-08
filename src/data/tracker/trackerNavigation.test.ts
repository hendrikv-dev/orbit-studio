import { describe, expect, it } from "vitest";
import {
  defaultTrackerLocation,
  isNavigationStep,
  parseTrackerLocation,
  sameTrackerLocation,
  trackerLocationToSearch,
  type TrackerLocation,
} from "./trackerNavigation";

describe("tracker locations in the URL", () => {
  it("keeps app=tracker on every location, because that is what loads Tracker", () => {
    // Losing it on a refresh would drop the reader into the Explorer entry and
    // its 17 MB catalogue, which is the one thing the separate bundle exists to
    // prevent.
    const locations: TrackerLocation[] = [
      defaultTrackerLocation(),
      { ...defaultTrackerLocation(), view: "upcoming" },
      { ...defaultTrackerLocation(), view: "upcoming", eventId: "eclipse-1", drill: "field" },
    ];
    for (const location of locations) {
      expect(new URLSearchParams(trackerLocationToSearch(location)).get("app")).toBe("tracker");
    }
  });

  it("writes nothing but app=tracker for the resting state", () => {
    expect(trackerLocationToSearch(defaultTrackerLocation())).toBe("?app=tracker");
  });

  it("round-trips every field it encodes", () => {
    const location: TrackerLocation = {
      view: "upcoming",
      date: "2026-03-03",
      eventId: "lunar-eclipse-2026-03-03",
      mode: "calendar",
      category: "eclipses",
      year: 2026,
      month: 3,
      drill: "field",
    };
    expect(parseTrackerLocation(trackerLocationToSearch(location))).toEqual(location);
  });

  it("keeps the resting URL free of today's date", () => {
    // A link shared without a date should open on the reader's own tonight
    // rather than pinning the day it was copied.
    expect(trackerLocationToSearch(defaultTrackerLocation())).toBe("?app=tracker");
    expect(parseTrackerLocation("?app=tracker").date).toBeNull();
  });

  it("carries a chosen date, and refuses one outside the supported range", () => {
    const search = trackerLocationToSearch({
      ...defaultTrackerLocation(),
      date: "2024-08-12",
    });
    expect(new URLSearchParams(search).get("date")).toBe("2024-08-12");
    expect(parseTrackerLocation("?date=2024-08-12").date).toBe("2024-08-12");
    // Outside the ephemeris's accuracy window, and not a real date at all.
    expect(parseTrackerLocation("?date=1543-06-01").date).toBeNull();
    expect(parseTrackerLocation("?date=2026-02-31").date).toBeNull();
    expect(parseTrackerLocation("?date=yesterday").date).toBeNull();
  });

  it("treats a change of date as a step Back should undo", () => {
    const base = defaultTrackerLocation();
    expect(isNavigationStep(base, { ...base, date: "2024-08-12" })).toBe(true);
  });

  it("keeps date and place independent", () => {
    // Nothing in the location couples them: changing one leaves the other
    // exactly as it was, which is what "what was visible from Seattle on 12
    // August 2024" needs.
    const withDate = { ...defaultTrackerLocation(), date: "2024-08-12" };
    const alsoFiltered = { ...withDate, category: "eclipses" as const };
    expect(alsoFiltered.date).toBe("2024-08-12");
    expect(parseTrackerLocation(trackerLocationToSearch(alsoFiltered)).date).toBe("2024-08-12");
  });

  it("round-trips a Tonight drill-in", () => {
    const location: TrackerLocation = {
      ...defaultTrackerLocation(),
      eventId: "aurora",
      drill: "sky",
    };
    expect(parseTrackerLocation(trackerLocationToSearch(location))).toEqual(location);
  });

  it("pads a single-digit month so the string sorts and parses", () => {
    const search = trackerLocationToSearch({
      ...defaultTrackerLocation(),
      view: "upcoming",
      mode: "calendar",
      year: 2026,
      month: 4,
    });
    expect(new URLSearchParams(search).get("month")).toBe("2026-04");
  });

  it("does not carry Upcoming's browse state into Tonight", () => {
    // A Tonight URL describing a calendar month would restore a state the view
    // does not have, and the reader would arrive somewhere they never were.
    const search = trackerLocationToSearch({
      view: "tonight",
      eventId: "saturn",
      mode: "calendar",
      category: "eclipses",
      year: 2026,
      month: 3,
      drill: null,
    });
    const params = new URLSearchParams(search);
    expect(params.get("mode")).toBeNull();
    expect(params.get("filter")).toBeNull();
    expect(params.get("month")).toBeNull();
    expect(params.get("event")).toBe("saturn");
  });

  describe("parsing what is actually in the address bar", () => {
    it("falls back to the default rather than throwing on nonsense", () => {
      // This parses whatever a reader has typed, or a URL from an older build.
      expect(parseTrackerLocation("?app=tracker&view=sideways&mode=spiral&drill=deep")).toEqual(
        defaultTrackerLocation(),
      );
    });

    it("rejects a month that is not one", () => {
      expect(parseTrackerLocation("?month=2026-13").month).toBeNull();
      expect(parseTrackerLocation("?month=March").month).toBeNull();
      expect(parseTrackerLocation("?month=2026-00").month).toBeNull();
      expect(parseTrackerLocation("?month=2026-03").month).toBe(3);
    });

    it("reads an empty query as the entry state", () => {
      expect(parseTrackerLocation("")).toEqual(defaultTrackerLocation());
    });
  });
});

describe("what counts as a step to walk back through", () => {
  const base = defaultTrackerLocation();

  it("treats opening an event as navigation", () => {
    expect(isNavigationStep(base, { ...base, eventId: "saturn" })).toBe(true);
  });

  it("treats opening a drill-in as navigation", () => {
    // The specific failure this protects: with the map not in the history,
    // Back from an open map left Tracker rather than closing the map.
    const onEvent = { ...base, view: "upcoming" as const, eventId: "eclipse" };
    expect(isNavigationStep(onEvent, { ...onEvent, drill: "field" })).toBe(true);
  });

  it("treats crossing between Tonight and Upcoming as navigation", () => {
    expect(isNavigationStep(base, { ...base, view: "upcoming" })).toBe(true);
  });

  it("does not treat re-filtering a list as navigation", () => {
    // Otherwise every fiddle with the filter becomes an entry the reader has to
    // press Back through to leave the page.
    const upcoming = { ...base, view: "upcoming" as const };
    expect(isNavigationStep(upcoming, { ...upcoming, category: "eclipses" })).toBe(false);
    expect(isNavigationStep(upcoming, { ...upcoming, mode: "calendar" })).toBe(false);
    expect(isNavigationStep(upcoming, { ...upcoming, year: 2027, month: 5 })).toBe(false);
  });

  it("still records those changes, so Back onto the page restores them", () => {
    // Not a step, but not discarded either: the current entry is rewritten, so
    // returning to it comes back to the filter the reader had set.
    const filtered = {
      ...base,
      view: "upcoming" as const,
      category: "eclipses" as const,
      mode: "calendar" as const,
      year: 2026,
      month: 3,
    };
    expect(parseTrackerLocation(trackerLocationToSearch(filtered))).toEqual(filtered);
  });
});

describe("comparing locations", () => {
  it("is true only when every navigable field agrees", () => {
    const base = defaultTrackerLocation();
    expect(sameTrackerLocation(base, { ...base })).toBe(true);
    expect(sameTrackerLocation(base, { ...base, drill: "sky" })).toBe(false);
    expect(sameTrackerLocation(base, { ...base, category: "moon" })).toBe(false);
    expect(sameTrackerLocation(base, { ...base, month: 4 })).toBe(false);
  });
});
