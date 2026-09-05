import { describe, expect, it } from "vitest";
import { planNight } from "./schedule";

/**
 * The 2 August 2027 total solar eclipse, whose path of totality runs over Luxor.
 *
 * The gap this covers is the one review found: a night ranking excluded daytime
 * events, so Tracker could not show a reader the total eclipse passing directly
 * over their own house.
 */
const LUXOR = { lat: 25.6872, lon: 32.6396 };
const TOTALITY_DAY = new Date("2027-08-02T12:00:00Z");

describe("daytime events on the selected date", () => {
  it("surfaces a total solar eclipse from inside its own path", () => {
    const plan = planNight(LUXOR.lat, LUXOR.lon, TOTALITY_DAY, "Africa/Cairo");
    expect(plan).not.toBeNull();
    const eclipse = plan!.ranking.ranked.find((entry) => entry.opportunity.kind === "solar-eclipse");
    expect(eclipse).toBeDefined();
    expect(eclipse!.opportunity.title).toBe("Total solar eclipse");
  });

  it("ranks it above everything else that night", () => {
    const plan = planNight(LUXOR.lat, LUXOR.lon, TOTALITY_DAY, "Africa/Cairo");
    expect(plan!.ranking.ranked[0].opportunity.kind).toBe("solar-eclipse");
  });

  it("carries mandatory solar safety on the opportunity itself", () => {
    const plan = planNight(LUXOR.lat, LUXOR.lon, TOTALITY_DAY, "Africa/Cairo");
    const eclipse = plan!.ranking.ranked.find((e) => e.opportunity.kind === "solar-eclipse")!;
    expect(eclipse.opportunity.guidance.safety).toMatch(/permanent eye damage/i);
  });

  it("offers it as a partial from well outside the path", () => {
    // Rome sees a deep partial from the same eclipse.
    const plan = planNight(41.9, 12.5, TOTALITY_DAY, "Europe/Rome");
    const eclipse = plan!.ranking.ranked.find((e) => e.opportunity.kind === "solar-eclipse");
    expect(eclipse).toBeDefined();
    expect(eclipse!.opportunity.title).toBe("Partial solar eclipse");
  });

  it("does not offer it where the shadow never reaches", () => {
    // Sydney is on the wrong side of the planet for this one.
    const plan = planNight(-33.87, 151.21, TOTALITY_DAY, "Australia/Sydney");
    expect(plan!.ranking.ranked.some((e) => e.opportunity.kind === "solar-eclipse")).toBe(false);
  });

  it("does not offer it on a day with no eclipse", () => {
    const plan = planNight(LUXOR.lat, LUXOR.lon, new Date("2027-06-15T12:00:00Z"), "Africa/Cairo");
    expect(plan!.ranking.ranked.some((e) => e.opportunity.kind === "solar-eclipse")).toBe(false);
  });
});
