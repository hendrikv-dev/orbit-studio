import { describe, expect, it } from "vitest";
import {
  auroraRiskFor,
  buildUpcomingEvents,
  filterUpcoming,
  groupUpcomingByDate,
  hasFinished,
  mergeUpcoming,
  notableUpcomingEvents,
  solarEclipsesFor,
} from "./upcomingEvents";
import { parseKpForecast, type AuroraConditions } from "./aurora";
import { planNights } from "./schedule";

/**
 * Upcoming merges three sources with three different horizons, and the tests
 * are about that mismatch rather than about the merge.
 *
 * The failure this guards against is the tempting one: filling a month-long
 * view with aurora entries by extrapolating a three-day index, which would look
 * complete and be fiction.
 */

const NOW = new Date("2026-08-21T08:00:00Z");
const PORTLAND = { lat: 45.5152, lon: -122.6784 };

function auroraConditions(rows: { time_tag: string; kp: number }[]): AuroraConditions {
  return {
    grid: null,
    currentKp: null,
    kpForecast: parseKpForecast(rows.map((row) => ({ ...row, observed: "predicted" }))),
    fetchedAtUtc: NOW.toISOString(),
    source: {
      id: "noaa-swpc",
      name: "n",
      attribution: "a",
      cost: "public-no-fee",
      coverage: "global",
    },
    failures: [],
  };
}

describe("auroral risk in Upcoming", () => {
  it("appears only inside the three days the K-index forecast covers", () => {
    const events = auroraRiskFor(
      auroraConditions([
        { time_tag: "2026-08-22T06:00:00", kp: 6 },
        // Beyond the published forecast: this row should not exist, and if it
        // ever does it must still be refused.
        { time_tag: "2026-09-10T06:00:00", kp: 7 },
      ]),
      NOW,
      "America/Los_Angeles",
    );
    expect(events).toHaveLength(1);
    expect(events[0].dateKey.startsWith("2026-08-2")).toBe(true);
  });

  it("stays silent below storm level, where a drive out disappoints", () => {
    const events = auroraRiskFor(
      auroraConditions([{ time_tag: "2026-08-22T06:00:00", kp: 4.3 }]),
      NOW,
      "UTC",
    );
    expect(events).toHaveLength(0);
  });

  it("keeps the strongest bin for a night rather than averaging it away", () => {
    const events = auroraRiskFor(
      auroraConditions([
        { time_tag: "2026-08-22T03:00:00", kp: 5 },
        { time_tag: "2026-08-22T06:00:00", kp: 7 },
      ]),
      NOW,
      "UTC",
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind === "aurora" && events[0].kp).toBe(7);
    expect(events[0].reason).toMatch(/G3 strong/);
  });

  it("produces nothing at all with no space-weather data", () => {
    expect(auroraRiskFor(null, NOW, "UTC")).toHaveLength(0);
  });
});

describe("solar eclipses in Upcoming", () => {
  const events = solarEclipsesFor(PORTLAND.lat, PORTLAND.lon, NOW, "America/Los_Angeles");

  it("lists only eclipses this observer can actually see", () => {
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.kind).toBe("solar-eclipse");
      if (event.kind !== "solar-eclipse") continue;
      expect(event.local.visibleFromHere).toBe(true);
      expect(event.local.obscurationFraction).toBeGreaterThan(0.02);
    }
  });

  it("does not offer the 2027 African total eclipse to an observer in Oregon", () => {
    expect(events.some((event) => event.id === "solar-eclipse-2027-08-02")).toBe(false);
  });

  it("finds the 2029 partial, which is the next one Oregon actually gets", () => {
    const found = events.find((event) => event.id === "solar-eclipse-2029-01-14");
    expect(found).toBeDefined();
    expect(found!.kind === "solar-eclipse" && Math.round(found!.local.obscurationFraction * 100))
      .toBeGreaterThan(50);
  });

  it("demands a filter in the reason, for every solar event", () => {
    for (const event of events) {
      if (event.kind !== "solar-eclipse") continue;
      if (event.local.kind === "partial") expect(event.reason).toMatch(/filter/i);
    }
  });
});

describe("the merged list", () => {
  it("is chronological across all three sources", () => {
    const plans = planNights(PORTLAND.lat, PORTLAND.lon, NOW, 12, "America/Los_Angeles");
    const merged = mergeUpcoming(
      notableUpcomingEvents(plans, 8),
      solarEclipsesFor(PORTLAND.lat, PORTLAND.lon, NOW, "America/Los_Angeles"),
      auroraRiskFor(
        auroraConditions([{ time_tag: "2026-08-22T06:00:00", kp: 6 }]),
        NOW,
        "America/Los_Angeles",
      ),
    );
    expect(merged.length).toBeGreaterThan(2);
    for (let index = 1; index < merged.length; index += 1) {
      expect(Date.parse(merged[index].atUtc)).toBeGreaterThanOrEqual(
        Date.parse(merged[index - 1].atUtc),
      );
    }
  });

  it("filters by category without losing anything else", () => {
    const merged = mergeUpcoming(
      solarEclipsesFor(PORTLAND.lat, PORTLAND.lon, NOW, "UTC"),
      auroraRiskFor(auroraConditions([{ time_tag: "2026-08-22T06:00:00", kp: 6 }]), NOW, "UTC"),
    );
    expect(filterUpcoming(merged, "all")).toHaveLength(merged.length);
    expect(
      filterUpcoming(merged, "eclipses").every((event) => event.category === "eclipses"),
    ).toBe(true);
    expect(filterUpcoming(merged, "meteors")).toHaveLength(0);
  });
});


/**
 * "Upcoming" has to mean upcoming.
 *
 * A calendar opened on 21 August was showing events from the 8th, the 11th and
 * the 19th, because nothing ever tested whether an event had finished. The
 * naive fix — dropping anything whose start is behind us — introduces the
 * opposite defect, so the test covers an event already under way as well.
 */
describe("what counts as upcoming", () => {
  const base = {
    kind: "aurora" as const,
    id: "x",
    dateKey: "2026-08-21",
    category: "auroras" as const,
    title: "Aurora watch",
    label: "Aurora",
    reason: "r",
    kp: 6,
  };

  it("drops events that have finished", () => {
    const finished = {
      ...base,
      atUtc: "2026-08-08T06:00:00Z",
      endUtc: "2026-08-08T09:00:00Z",
    };
    expect(hasFinished(finished, NOW)).toBe(true);
  });

  it("keeps an event that started before now and is still running", () => {
    const running = {
      ...base,
      atUtc: "2026-08-21T06:00:00Z",
      endUtc: "2026-08-21T09:00:00Z",
    };
    expect(hasFinished(running, NOW)).toBe(false);
  });

  it("keeps events entirely in the future", () => {
    const ahead = {
      ...base,
      atUtc: "2026-08-23T06:00:00Z",
      endUtc: "2026-08-23T09:00:00Z",
    };
    expect(hasFinished(ahead, NOW)).toBe(false);
  });

  it("carries an end for every kind of event it produces", () => {
    const plans = planNights(PORTLAND.lat, PORTLAND.lon, NOW, 10, "America/Los_Angeles");
    const built = buildUpcomingEvents({
      plans,
      latitudeDeg: PORTLAND.lat,
      longitudeDeg: PORTLAND.lon,
      timeZone: "America/Los_Angeles",
      auroraConditions: auroraConditions([{ time_tag: "2026-08-22T06:00:00", kp: 6 }]),
      now: NOW,
      from: NOW,
    });
    expect(built.length).toBeGreaterThan(0);
    const kinds = new Set(built.map((event) => event.kind));
    expect(kinds.size).toBeGreaterThan(1);
    for (const event of built) {
      expect(Number.isNaN(Date.parse(event.endUtc))).toBe(false);
      expect(Date.parse(event.endUtc)).toBeGreaterThanOrEqual(Date.parse(event.atUtc));
    }
  });

  it("excludes finished events from the canonical list by default", () => {
    const plans = planNights(PORTLAND.lat, PORTLAND.lon, NOW, 10, "America/Los_Angeles");
    const inputs = {
      plans,
      latitudeDeg: PORTLAND.lat,
      longitudeDeg: PORTLAND.lon,
      timeZone: "America/Los_Angeles",
      auroraConditions: null,
      // Two weeks after the plans were generated, so some of them are behind us.
      now: new Date("2026-09-04T08:00:00Z"),
      from: NOW,
    };
    const upcoming = buildUpcomingEvents(inputs);
    const everything = buildUpcomingEvents({ ...inputs, includeFinished: true });
    expect(everything.length).toBeGreaterThan(upcoming.length);
    for (const event of upcoming) {
      expect(hasFinished(event, inputs.now)).toBe(false);
    }
  });
});

/**
 * List and Calendar render the same array.
 *
 * This is the property the architecture change exists to guarantee, so it is
 * asserted on the array rather than left to the components: whatever grouping
 * by date produces must be exactly the events that went in.
 */
describe("one list, two renderings", () => {
  const plans = planNights(PORTLAND.lat, PORTLAND.lon, NOW, 20, "America/Los_Angeles");
  const events = buildUpcomingEvents({
    plans,
    latitudeDeg: PORTLAND.lat,
    longitudeDeg: PORTLAND.lon,
    timeZone: "America/Los_Angeles",
    auroraConditions: auroraConditions([{ time_tag: "2026-08-22T06:00:00", kp: 6 }]),
    now: NOW,
    from: NOW,
  });

  it("loses nothing when grouped by date", () => {
    const grouped = groupUpcomingByDate(events);
    const flattened = [...grouped.values()].flat();
    expect(flattened).toHaveLength(events.length);
    expect(new Set(flattened.map((event) => event.id))).toEqual(
      new Set(events.map((event) => event.id)),
    );
  });

  it("gives every event a date key its own timestamp agrees with", () => {
    for (const event of events) {
      const derived = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(event.atUtc));
      // Notable events are keyed by observing night, which can begin the
      // evening before the peak instant's local date. Everything else must
      // agree exactly.
      if (event.kind !== "notable") expect(event.dateKey).toBe(derived);
    }
  });

  it("carries solar eclipses and aurora into the same array the calendar groups", () => {
    const grouped = groupUpcomingByDate(events);
    const categories = new Set(
      [...grouped.values()].flat().map((event) => event.category),
    );
    // The two that Calendar could never previously contain.
    expect(events.some((event) => event.kind === "solar-eclipse")).toBe(true);
    expect(events.some((event) => event.kind === "aurora")).toBe(true);
    expect(categories.has("eclipses")).toBe(true);
    expect(categories.has("auroras")).toBe(true);
  });

  it("filters both renderings through the same taxonomy", () => {
    const eclipses = filterUpcoming(events, "eclipses");
    const grouped = groupUpcomingByDate(eclipses);
    expect(eclipses.every((event) => event.category === "eclipses")).toBe(true);
    expect([...grouped.values()].flat()).toHaveLength(eclipses.length);
  });
});
