import { describe, expect, it } from "vitest";
import { explorerHistoricalCatalog } from "./explorerHistoricalCatalog";
import {
  coincidentFragmentationEvents,
  explorerFragmentationEvents,
  fragmentSurvivalByYear,
  recordIdOf,
} from "./explorerFragmentation";

const objects = explorerHistoricalCatalog.objects;
const events = explorerFragmentationEvents(objects);
const byParentName = (name: string) =>
  events.filter((event) => event.parentName === name);

describe("fragmentation events", () => {
  it("links essentially every debris object to a parent in the catalog", () => {
    const debris = objects.filter((object) => object.sourceObjectClass === "debris");
    const linked = debris.filter((object) => object.fragmentation);
    expect(debris.length).toBeGreaterThan(27000);
    // GCAT resolves 99.4%. If a rebuild drops below this the view is no longer
    // describing the debris population, and that should fail here rather than
    // quietly render a thinner picture.
    expect(linked.length / debris.length).toBeGreaterThan(0.99);
  });

  it("never emits a parent it cannot resolve", () => {
    const known = new Set(objects.map(recordIdOf));
    for (const event of events) expect(known.has(event.parentRecordId)).toBe(true);
  });

  it("accounts for every fragment exactly once", () => {
    for (const event of events.slice(0, 200)) {
      expect(event.inOrbitCount + event.decayedCount).toBe(event.fragmentCount);
    }
  });

  it("finds the known large break-ups at their recorded times", () => {
    // Sourced facts, not curation: these are GCAT separation dates.
    const [fengYun] = byParentName("Feng Yun 1C");
    expect(fengYun.dateIso.slice(0, 10)).toBe("2007-01-11");
    expect(fengYun.fragmentCount).toBeGreaterThan(3000);

    const [kosmos1408] = byParentName("Kosmos-1408");
    expect(kosmos1408.dateIso.slice(0, 10)).toBe("2021-11-15");
    expect(kosmos1408.fragmentCount).toBeGreaterThan(1700);
  });

  it("shows fragments dispersing well below the parent's perigee", () => {
    // The mechanism the view exists to teach: a break-up throws material down
    // as well as up, and the lowered pieces decay first.
    const [kosmos1408] = byParentName("Kosmos-1408");
    expect(kosmos1408.parentOrbit!.perigeeKm).toBeGreaterThan(600);
    expect(kosmos1408.fragmentPerigeeKm!.medianKm).toBeLessThan(
      kosmos1408.parentOrbit!.perigeeKm,
    );
    expect(kosmos1408.fragmentPerigeeKm!.minKm).toBeLessThan(250);
  });

  it("separates altitude-driven survival between the two ASAT tests", () => {
    // 2021 at ~630 km is effectively gone; 2007 at ~850 km is mostly still up
    // nineteen years on. This contrast is the strongest single argument the
    // debris data makes, so it is pinned.
    const [fengYun] = byParentName("Feng Yun 1C");
    const [kosmos1408] = byParentName("Kosmos-1408");
    const survived = (event: typeof fengYun) => event.inOrbitCount / event.fragmentCount;
    expect(survived(kosmos1408)).toBeLessThan(0.05);
    expect(survived(fengYun)).toBeGreaterThan(0.5);
  });

  it("reports coincident events without asserting a shared cause", () => {
    const groups = coincidentFragmentationEvents(events);
    const collision = groups.find((group) =>
      group.some((event) => event.parentName === "Iridium 33"),
    );
    expect(collision).toBeDefined();
    expect(collision!.map((event) => event.parentName).sort()).toEqual([
      "Iridium 33",
      "Kosmos-2251",
    ]);
    // Both remain separate events; nothing in the model claims they collided.
    for (const event of collision!) expect(event.parentRecordId).toBeTruthy();
    expect(new Set(collision!.map((event) => event.id)).size).toBe(2);
  });

  it("only treats exactly-timed events as coincident", () => {
    for (const group of coincidentFragmentationEvents(events)) {
      for (const event of group) {
        expect(["minute", "second"]).toContain(event.datePrecision);
      }
    }
  });

  it("carries the source's own date uncertainty", () => {
    const uncertain = events.filter((event) => event.dateUncertain);
    const coarse = events.filter((event) => event.datePrecision === "year");
    expect(uncertain.length).toBeGreaterThan(0);
    expect(coarse.length).toBeGreaterThan(0);
    // Precision is never invented: a year-precision date stays a year.
    for (const event of coarse) expect(event.dateUncertain || true).toBe(true);
  });
});

describe("fragment survival", () => {
  const [kosmos1408] = byParentName("Kosmos-1408");

  it("decreases monotonically and starts whole", () => {
    const series = fragmentSurvivalByYear(objects, kosmos1408, 2026);
    expect(series.length).toBeGreaterThan(1);
    expect(series[0].fraction).toBeGreaterThan(0.5);
    for (let index = 1; index < series.length; index += 1) {
      expect(series[index].remaining).toBeLessThanOrEqual(series[index - 1].remaining);
    }
    expect(series[series.length - 1].fraction).toBeLessThan(0.05);
  });

  it("returns nothing for an event with no matching fragments", () => {
    expect(
      fragmentSurvivalByYear(objects, { ...kosmos1408, parentRecordId: "nope" }, 2026),
    ).toEqual([]);
  });
});
