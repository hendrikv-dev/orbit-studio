import { describe, expect, it } from "vitest";
import {
  DEFAULT_HORIZON_NIGHTS,
  distinguishingOpportunity,
  nightDistinction,
  planMonth,
  planNight,
  planNights,
  notableEvents,
} from "./schedule";

// Joshua Tree: mid-latitude, real observing site, no polar edge cases.
const LAT = 34.135;
const LON = -116.313;
const ZONE = "America/Los_Angeles";

describe("the shared schedule layer", () => {
  it("plans a single night with a ranked set", () => {
    const plan = planNight(LAT, LON, new Date("2026-08-16T22:00:00Z"), ZONE);
    expect(plan).not.toBeNull();
    expect(plan!.ranking.ranked.length).toBeGreaterThan(0);
    expect(plan!.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("plans a rolling horizon of distinct, ordered nights", () => {
    const plans = planNights(LAT, LON, new Date("2026-08-16T22:00:00Z"), 10, ZONE);
    expect(plans.length).toBe(10);
    const keys = plans.map((plan) => plan.dateKey);
    // Distinct: stepping by 24h across a daylight-saving change must not
    // produce the same observing night twice.
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
  });

  it("invalidates plan identity for location, observing period, zone, or model input changes", () => {
    const first = planNight(34.135, -116.313, new Date("2026-08-19T20:00:00Z"), "America/Los_Angeles")!;
    const otherPlace = planNight(34.136, -116.313, new Date("2026-08-19T20:00:00Z"), "America/Los_Angeles")!;
    const nextNight = planNight(34.135, -116.313, new Date("2026-08-20T20:00:00Z"), "America/Los_Angeles")!;
    const sameNightLater = planNight(34.135, -116.313, new Date("2026-08-19T20:10:00Z"), "America/Los_Angeles")!;
    expect(first.identity.key).toBe(sameNightLater.identity.key);
    expect(first.identity.key).not.toBe(otherPlace.identity.key);
    expect(first.identity.key).not.toBe(nextNight.identity.key);
    expect(
      Math.abs(Date.parse(first.identity.periodStartUtc) - Date.parse(first.period.startUtc)),
    ).toBeLessThanOrEqual(500);
  });

  it("survives a daylight-saving transition without duplicating a night", () => {
    // US clocks go back on 2026-11-01.
    const plans = planNights(LAT, LON, new Date("2026-10-29T22:00:00Z"), 6, ZONE);
    const keys = plans.map((plan) => plan.dateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("computes a month on demand and keeps only that month's nights", () => {
    const plans = planMonth(LAT, LON, 2026, 9, ZONE);
    expect(plans.length).toBeGreaterThanOrEqual(29);
    expect(plans.length).toBeLessThanOrEqual(30);
    for (const plan of plans) expect(plan.dateKey.startsWith("2026-09")).toBe(true);
  });

  it("produces the same night for Tonight and for the horizon's first entry", () => {
    // The guard against Upcoming drifting away from Tonight by being computed
    // a cheaper way. They must be the same call.
    const at = new Date("2026-08-16T22:00:00Z");
    const tonight = planNight(LAT, LON, at, ZONE)!;
    const [first] = planNights(LAT, LON, at, 3, ZONE);
    expect(first.dateKey).toBe(tonight.dateKey);
    expect(first.ranking.ranked.map((entry) => entry.opportunity.id)).toEqual(
      tonight.ranking.ranked.map((entry) => entry.opportunity.id),
    );
  });

  it("carries a horizon default rather than leaving it to the interface", () => {
    expect(DEFAULT_HORIZON_NIGHTS).toBe(30);
    expect(planNights(LAT, LON, new Date("2026-08-16T22:00:00Z"), undefined, ZONE).length).toBe(
      DEFAULT_HORIZON_NIGHTS,
    );
  });

  it("ranks different nights differently across a horizon", () => {
    // If every night came back identical, the generation would not actually be
    // per-night and Upcoming would be Tonight wearing a different label.
    const plans = planNights(LAT, LON, new Date("2026-08-16T22:00:00Z"), 20, ZONE);
    const leads = new Set(plans.map((plan) => plan.ranking.ranked[0]?.opportunity.id));
    expect(leads.size).toBeGreaterThan(1);
  });

  it("ranks a rare event above a night whose best thing is a routine Moon", () => {
    // The defect this primitive exists for: ordering nights by their best
    // opportunity's strength put a Moon phase at the top of nearly all thirty
    // and gave a partial lunar eclipse the same standing as a routine Tuesday.
    // Every night has a Moon; what makes a night worth choosing is what the
    // nights either side of it do not have.
    const plans = planNights(LAT, LON, new Date("2026-08-17T22:00:00Z"), 30, ZONE);
    const eclipse = plans.find((plan) =>
      plan.ranking.ranked.some((entry) => entry.opportunity.kind === "lunar-eclipse"),
    );
    expect(eclipse).toBeDefined();

    const routine = plans.filter(
      (plan) =>
        plan !== eclipse &&
        distinguishingOpportunity(plan)?.opportunity.kind === "moon",
    );
    expect(routine.length).toBeGreaterThan(0);
    for (const plan of routine) {
      expect(nightDistinction(eclipse!)).toBeGreaterThan(nightDistinction(plan));
    }

    // And the night is presented by the thing that earned it its place.
    expect(distinguishingOpportunity(eclipse!)?.opportunity.kind).toBe("lunar-eclipse");
  });
});

describe("notability", () => {
  const plans = planNights(LAT, LON, new Date("2026-08-17T22:00:00Z"), 30, ZONE);

  it("gives an object one entry rather than one per night it is visible", () => {
    // The defect this layer exists for: Saturn observable on five consecutive
    // nights produced five Curated entries, none of which anyone would plan
    // around. Deduplicated by what the event is, keeping its best night.
    const events = notableEvents(plans, 20);
    // Keyed by what the event is, not by its opportunity id. The Moon can
    // legitimately appear twice in a month as two different milestones — a
    // Full Moon and a First Quarter are different dates people mark — so the
    // identity that must not repeat is phase-aware.
    const identity = events.map((event) =>
      event.entry.opportunity.kind === "moon"
        ? event.entry.opportunity.title
        : event.entry.opportunity.id,
    );
    expect(new Set(identity).size).toBe(identity.length);

    // The actual regression: a planet appears once, at its best night.
    const planets = events.filter((event) => event.entry.opportunity.kind === "planet");
    expect(new Set(planets.map((event) => event.entry.opportunity.id)).size).toBe(planets.length);
  });

  it("admits an eclipse and refuses an ordinary gibbous Moon", () => {
    const events = notableEvents(plans, 20);
    expect(events.some((event) => event.kind === "eclipse")).toBe(true);
    for (const event of events) {
      if (event.entry.opportunity.kind !== "moon") continue;
      expect(event.entry.opportunity.title).toMatch(
        /Full Moon|New Moon|First Quarter|Last Quarter/,
      );
    }
  });

  it("stays a short list, not a feed", () => {
    expect(notableEvents(plans).length).toBeLessThanOrEqual(6);
    expect(notableEvents(plans).length).toBeGreaterThan(0);
  });

  it("orders by significance, with the rarest kind first", () => {
    const events = notableEvents(plans, 20);
    const rank = { eclipse: 5, "shower-peak": 4, conjunction: 3, "moon-phase": 2, opposition: 1 };
    const weights = events.map((event) => rank[event.kind]);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });
});
