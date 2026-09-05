import { describe, expect, it } from "vitest";
import { lunarPhaseAt } from "./lunarPhase";
import { planNight, notableEvents, planMonth } from "./schedule";

/**
 * Principal-phase instants are from the committed USNO 2026 phase table in
 * `src/astronomy/reference/jplHorizonsUsnoReference.json`. Intermediate cases
 * sit between those independently sourced boundaries and test direction.
 */
const CASES = [
  ["2026-07-14T09:43:00Z", "New Moon"],
  ["2026-07-17T22:24:00Z", "Waxing Crescent"],
  ["2026-07-21T11:05:00Z", "First Quarter"],
  ["2026-07-25T12:50:00Z", "Waxing Gibbous"],
  ["2026-07-29T14:36:00Z", "Full Moon"],
  ["2026-08-02T08:28:00Z", "Waning Gibbous"],
  ["2026-08-06T02:21:00Z", "Last Quarter"],
  ["2026-08-09T10:00:00Z", "Waning Crescent"],
] as const;

describe("the authoritative lunar phase representation", () => {
  it.each(CASES)("classifies %s as %s", (atUtc, expected) => {
    const phase = lunarPhaseAt(new Date(atUtc));
    expect(phase.name).toBe(expected);
    expect(Number(phase.cycleAngleDeg)).toBeGreaterThanOrEqual(0);
    expect(Number(phase.cycleAngleDeg)).toBeLessThan(360);
    expect(Number(phase.illuminatedFraction)).toBeGreaterThanOrEqual(0);
    expect(Number(phase.illuminatedFraction)).toBeLessThanOrEqual(1);
  });

  it("uses the 0..360° cycle, not the symmetric 0..180° illumination angle, for direction", () => {
    expect(lunarPhaseAt(new Date("2026-07-17T22:24:00Z")).waxing).toBe(true);
    expect(lunarPhaseAt(new Date("2026-08-09T10:00:00Z")).waning).toBe(true);
  });

  it("regresses the audited August 2026 failure through the production planning path", () => {
    // USNO's Joshua Tree case: ten hours after Last Quarter, 42% waning.
    const plan = planNight(
      34.135,
      -116.313,
      new Date("2026-08-06T12:00:00Z"),
      "America/Los_Angeles",
    )!;
    const moon = plan.ranking.ranked.find((entry) => entry.opportunity.kind === "moon")!;
    expect(moon.opportunity.title).toMatch(/waning crescent/i);
    expect(moon.opportunity.sceneHints?.waning).toBe(true);
    expect(moon.opportunity.science?.kind).toBe("lunar-phase");
  });

  it("feeds the same phase semantics into Calendar notability", () => {
    const events = notableEvents(
      planMonth(34.135, -116.313, 2026, 8, "America/Los_Angeles"),
      20,
    );
    const phases = events.filter((event) => event.kind === "moon-phase");
    expect(phases.length).toBeGreaterThan(0);
    for (const event of phases) {
      expect(event.entry.opportunity.science?.kind).toBe("lunar-phase");
    }
    expect(
      phases.some(
        (event) => event.plan.dateKey === "2026-08-05" && event.entry.opportunity.title === "The First Quarter",
      ),
    ).toBe(false);
  });
});
