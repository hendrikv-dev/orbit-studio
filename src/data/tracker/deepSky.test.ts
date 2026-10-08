import { describe, expect, it } from "vitest";
import { deepSkyOpportunities } from "./deepSky";

/** A Portland winter night, well inside astronomical darkness. */
const NIGHT = { startUtc: "2027-01-15T04:00:00Z", endUtc: "2027-01-15T13:00:00Z" };
const PORTLAND = { lat: 45.54, lon: -122.4 };

describe("the deep-sky showpieces", () => {
  it("offers a short curated list rather than a catalogue", () => {
    const found = deepSkyOpportunities(PORTLAND.lat, PORTLAND.lon, NIGHT);
    expect(found.length).toBeGreaterThan(4);
    expect(found.length).toBeLessThan(26);
    expect(new Set(found.map((entry) => entry.id)).size).toBe(found.length);
  });

  /**
   * The tier is a property of the object, not of the night.
   *
   * The Ring Nebula is a telescope object on every night there has ever been.
   * Withholding it from a naked-eye reader with "too faint tonight" would imply
   * that some other night would do.
   */
  it("carries the equipment each object needs", () => {
    const found = deepSkyOpportunities(PORTLAND.lat, PORTLAND.lon, NIGHT);
    const byId = new Map(found.map((entry) => [entry.id, entry]));
    // The Pleiades has no NGC number, so it only exists here because the
    // generator reads OpenNGC's addendum as well as its NGC file.
    expect(byId.get("deep-sky-m45")?.guidance.equipment).toBe("eyes");
    expect(byId.get("deep-sky-m42")?.guidance.equipment).toBe("eyes");
    expect(byId.get("deep-sky-m1")?.guidance.equipment).toBe("telescope");
  });

  /**
   * Which showpieces are up depends on where you are standing.
   *
   * Not "fewer at high latitude" — that was the obvious guess and it is wrong:
   * the far north loses the southern objects and keeps the circumpolar ones, so
   * the counts can match while the lists do not. The property that matters is
   * that the answer is about the place.
   */
  it("offers a different set from a different latitude, and nothing in the murk", () => {
    const arctic = deepSkyOpportunities(71.0, 25.8, NIGHT);
    const portland = deepSkyOpportunities(PORTLAND.lat, PORTLAND.lon, NIGHT);
    const ids = (list: ReturnType<typeof deepSkyOpportunities>) =>
      list.map((entry) => entry.id).sort().join(",");
    expect(ids(arctic)).not.toBe(ids(portland));
    for (const entry of [...arctic, ...portland]) {
      const highest = Math.max(...entry.profile.map((sample) => sample.altitudeDeg ?? -90));
      expect(highest).toBeGreaterThanOrEqual(10);
    }
  });

  it("samples the night, with each sample relative to that night's own best", () => {
    const [first] = deepSkyOpportunities(PORTLAND.lat, PORTLAND.lon, NIGHT);
    expect(first.profile.length).toBeGreaterThan(10);
    const relatives = first.profile.map((sample) => sample.relative);
    expect(Math.max(...relatives)).toBeCloseTo(1, 5);
    expect(Math.min(...relatives)).toBeGreaterThanOrEqual(0);
  });

  /**
   * Showpieces are available for months, and must not borrow an eclipse's
   * rarity to climb the ranking.
   */
  it("claims no rarity", () => {
    for (const entry of deepSkyOpportunities(PORTLAND.lat, PORTLAND.lon, NIGHT)) {
      expect(entry.qualities.rarity).toBeLessThan(0.1);
    }
  });

  it("says what a person would actually see, and what the magnitude hides", () => {
    const found = deepSkyOpportunities(PORTLAND.lat, PORTLAND.lon, NIGHT);
    for (const entry of found) {
      expect(entry.summary.length).toBeGreaterThan(20);
      expect(entry.limitations.length).toBeGreaterThan(0);
    }
    const andromeda = found.find((entry) => entry.id === "deep-sky-m31");
    if (andromeda) {
      // Three degrees of sky: the integrated magnitude flatters it badly.
      expect(andromeda.limitations.join(" ")).toMatch(/spread over a large area/i);
    }
  });

  it("returns nothing for a window that is not one", () => {
    expect(deepSkyOpportunities(PORTLAND.lat, PORTLAND.lon, { startUtc: "x", endUtc: "y" })).toEqual([]);
    expect(
      deepSkyOpportunities(PORTLAND.lat, PORTLAND.lon, {
        startUtc: NIGHT.endUtc,
        endUtc: NIGHT.startUtc,
      }),
    ).toEqual([]);
  });
});
