import { describe, expect, it } from "vitest";
import { trackerPlanningKey } from "./planningProtocol";
import {
  UPCOMING_RANGES,
  upcomingLocalContext,
  upcomingPlanningRequest,
  upcomingRangeEnd,
} from "./upcomingDiscovery";
import { solarEclipsesFor } from "./upcomingEvents";

const FROM = new Date("2026-09-26T18:00:00Z");

describe("Upcoming discovery ranges", () => {
  it("uses the four product ranges as planning inputs", () => {
    expect(UPCOMING_RANGES.map((range) => [range.label, range.days])).toEqual([
      ["7d", 7],
      ["30d", 30],
      ["3mo", 90],
      ["Year", 365],
    ]);
    expect(upcomingRangeEnd(FROM, "3-months").getTime() - FROM.getTime()).toBe(
      90 * 86_400_000,
    );
  });

  it("invalidates the planning identity for place, zone, or range", () => {
    const request = upcomingPlanningRequest({
      latitudeDeg: 45.5152,
      longitudeDeg: -122.6784,
      from: FROM,
      timeZone: "America/Los_Angeles",
      range: "30-days",
    });
    const moved = { ...request, latitudeDeg: 45.5153 };
    const rezoned = { ...request, timeZone: "America/Denver" };
    const extended = { ...request, nights: 90 };

    expect(new Set([request, moved, rezoned, extended].map(trackerPlanningKey)).size).toBe(4);
  });
});

describe("Upcoming local context", () => {
  it("quotes local eclipse geometry rather than a global headline", () => {
    const [event] = solarEclipsesFor(25.6872, 32.6396, FROM, "Africa/Cairo", 8, 365);
    expect(event).toBeDefined();
    expect(event.kind).toBe("solar-eclipse");
    expect(upcomingLocalContext(event)).toMatch(/covered here/);
    expect(upcomingLocalContext(event)).toMatch(/above the horizon/);
  });
});
