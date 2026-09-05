import { Body } from "astronomy-engine";
import { describe, expect, it } from "vitest";
import { angularSeparation, oppositionDuring, supportsOpposition } from "./planetaryEvents";
import { planNight, notableEvents, planNights } from "./schedule";

describe("planetary event classification", () => {
  it("recognizes a valid Jupiter opposition against NASA's 2026-01-10 reference date", () => {
    const event = oppositionDuring(Body.Jupiter, "2026-01-10T00:00:00Z", "2026-01-11T12:00:00Z");
    expect(event?.kind).toBe("opposition");
    expect(event?.body).toBe(Body.Jupiter);
  });

  it("makes an impossible inferior-planet opposition unrepresentable", () => {
    expect(supportsOpposition(Body.Venus)).toBe(false);
    expect(oppositionDuring(Body.Venus, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")).toBeNull();
  });

  it("validates angular separation in degrees with a geometric reference vector", () => {
    expect(
      Number(
        angularSeparation(
          { altitudeDeg: 0, azimuthDeg: 0 },
          { altitudeDeg: 0, azimuthDeg: 90 },
        ),
      ),
    ).toBeCloseTo(90, 10);
  });

  it("generates a real conjunction and preserves its physical classification", () => {
    // NASA's January 2026 skywatching guide identifies the Moon/Saturn
    // conjunction on January 23. Tracker's local opportunity must be an actual
    // close angular pairing, not a display synonym.
    const plans = planNights(34.135, -116.313, new Date("2026-01-22T12:00:00Z"), 3, "America/Los_Angeles");
    const conjunction = plans
      .flatMap((plan) => plan.ranking.ranked)
      .find((entry) => entry.opportunity.kind === "conjunction")?.opportunity;
    expect(conjunction).toBeDefined();
    expect(conjunction?.science?.kind).toBe("conjunction");
    if (conjunction?.science?.kind === "conjunction") {
      expect(Number(conjunction.science.separationDeg)).toBeLessThanOrEqual(6);
    }
  });

  it("presents only physically generated oppositions in Calendar notability", () => {
    const plans = planNights(34.135, -116.313, new Date("2026-01-08T12:00:00Z"), 6, "America/Los_Angeles");
    const events = notableEvents(plans, 20);
    expect(events.some((event) => event.kind === "opposition" && event.entry.opportunity.id === "planet-jupiter")).toBe(true);
    expect(events.some((event) => event.kind === "opposition" && event.entry.opportunity.id === "planet-venus")).toBe(false);
  });

  it("does not label ordinary placement as opposition", () => {
    const plan = planNight(45.5152, -122.6784, new Date("2026-08-01T12:00:00Z"), "America/Los_Angeles")!;
    const events = notableEvents([plan], 20);
    expect(events.some((event) => event.entry.opportunity.id === "planet-venus")).toBe(false);
  });
});

