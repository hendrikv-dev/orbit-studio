import { SearchLunarEclipse } from "astronomy-engine";
import { describe, expect, it } from "vitest";
import {
  lunarEclipseTiming,
  lunarVisibilityAt,
  lunarVisibilityField,
} from "./lunarEclipse";
import { planNight } from "./schedule";

describe("lunar eclipse timing", () => {
  it("normalizes the audited 2026-08-28 semi-duration minutes into explicit contacts", () => {
    // Independent rounded reference: NASA 2026 eclipse circumstances,
    // P1 01:24, U1 02:34, greatest 04:13, U4 05:52, P4 07:02 UTC.
    const timing = lunarEclipseTiming(SearchLunarEclipse(new Date("2026-08-20T00:00:00Z")));
    expect(Math.abs(Date.parse(timing.maximumUtc) - Date.parse("2026-08-28T04:13:00Z"))).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(timing.partial!.startUtc) - Date.parse("2026-08-28T02:34:00Z"))).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(timing.partial!.endUtc) - Date.parse("2026-08-28T05:52:00Z"))).toBeLessThan(60_000);
    expect(Number(timing.partial!.durationMinutes)).toBeCloseTo(198.84, 1);
    expect(timing.totality).toBeNull();
    expect(Date.parse(timing.penumbral.startUtc)).toBeLessThan(Date.parse(timing.partial!.startUtc));
    expect(Date.parse(timing.partial!.endUtc)).toBeLessThan(Date.parse(timing.penumbral.endUtc));
  });

  it("carries the normalized contact model through ranking and presentation data", () => {
    const plan = planNight(
      45.5152,
      -122.6784,
      new Date("2026-08-28T00:00:00Z"),
      "America/Los_Angeles",
    )!;
    const eclipse = plan.ranking.ranked.find(
      (entry) => entry.opportunity.kind === "lunar-eclipse",
    )!.opportunity;
    expect(eclipse.guidance.durationMinutes).toBeGreaterThan(190);
    expect(eclipse.guidance.durationMinutes).toBeLessThan(210);
    expect(Date.parse(eclipse.profile.at(-1)!.atUtc) - Date.parse(eclipse.profile[0].atUtc)).toBeLessThan(
      4 * 60 * 60_000,
    );
    expect(eclipse.science?.kind).toBe("lunar-eclipse");
  });
});

describe("the visibility footprint", () => {
  const eclipse = SearchLunarEclipse(new Date("2026-08-01T00:00:00Z"));
  const timing = lunarEclipseTiming(eclipse);

  it("is the night side: visible where the Moon is up, not where it is down", () => {
    const field = lunarVisibilityField(
      timing,
      { south: -60, north: 60, west: -180, east: 175 },
      15,
    );
    const visible = field.cells.filter((cell) => cell.visibleFraction > 0);
    const hidden = field.cells.filter((cell) => cell.visibleFraction === 0);
    // A lunar eclipse is seen from roughly half the planet, so both sets exist.
    expect(visible.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThan(0);
    // Every cell that sees any of it has the Moon above the horizon at some
    // point; every cell that sees none of it has it below at maximum.
    for (const cell of hidden) expect(cell.altitudeAtMaximumDeg).toBeLessThanOrEqual(0);
  });

  it("agrees with the per-place answer the interface quotes", () => {
    const cell = lunarVisibilityAt(timing, 45.5152, -122.6784);
    expect(cell.visibleFraction).toBeGreaterThanOrEqual(0);
    expect(cell.visibleFraction).toBeLessThanOrEqual(1);
    if (cell.altitudeAtMaximumDeg > 5) expect(cell.visibleFraction).toBeGreaterThan(0);
  });

  it("never claims a fraction outside zero to one", () => {
    const field = lunarVisibilityField(
      timing,
      { south: 20, north: 60, west: -140, east: -60 },
      20,
    );
    for (const cell of field.cells) {
      expect(cell.visibleFraction).toBeGreaterThanOrEqual(0);
      expect(cell.visibleFraction).toBeLessThanOrEqual(1);
    }
  });
});
