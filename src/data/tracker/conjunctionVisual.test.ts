import { describe, expect, it } from "vitest";
import { planNight } from "./schedule";
import { heroImageryFor } from "./imagery";
import { UPCOMING_TIME_LABEL } from "./upcomingEvents";

/**
 * The visual must not contradict the event.
 *
 * Every conjunction used to render one photograph of the Moon beside Venus.
 * For "The Moon and Saturn" that is the wrong planet; for any date but the one
 * it was taken on it is the wrong lunar phase; and the separation was whatever
 * that evening happened to offer. A "Representative example" badge is a
 * disclosure, not a licence to contradict the thing printed beside it.
 *
 * These assert the *data* the visual is handed rather than pixels, which is the
 * stronger claim: if the geometry reaching the component is the event's own,
 * the drawing cannot be of a different event.
 */

/** A month of nights from Portland, to find whatever conjunctions occur. */
function conjunctionsNear(from: Date) {
  const found = [];
  for (let day = 0; day < 45; day += 1) {
    const at = new Date(from.getTime() + day * 86_400_000);
    const plan = planNight(45.5152, -122.6784, at, "America/Los_Angeles");
    for (const entry of plan.ranking.ranked) {
      if (entry.opportunity.science?.kind === "conjunction") {
        found.push(entry.opportunity);
      }
    }
    if (found.length >= 3) break;
  }
  return found;
}

describe("conjunction visuals are computed from the conjunction", () => {
  const conjunctions = conjunctionsNear(new Date("2026-08-22T12:00:00Z"));

  it("finds conjunctions to check at all", () => {
    expect(conjunctions.length).toBeGreaterThan(0);
  });

  it("carries a position for each of the two bodies it names", () => {
    for (const opportunity of conjunctions) {
      const science = opportunity.science!;
      if (science.kind !== "conjunction") continue;
      expect(science.positions).toHaveLength(2);
      // The positions describe the bodies the title names — not two other ones.
      expect(science.positions.map((entry) => entry.body)).toEqual([...science.bodies]);
      for (const position of science.positions) {
        expect(Number.isFinite(position.altitudeDeg)).toBe(true);
        expect(Number.isFinite(position.azimuthDeg)).toBe(true);
        expect(position.azimuthDeg).toBeGreaterThanOrEqual(0);
        expect(position.azimuthDeg).toBeLessThan(360);
      }
    }
  });

  it("reports a separation that matches the positions it carries", () => {
    // The number in the copy and the geometry in the drawing come from one
    // evaluation, so a reader cannot be told 1.4° beside a picture of 6°.
    for (const opportunity of conjunctions) {
      const science = opportunity.science!;
      if (science.kind !== "conjunction") continue;
      const [a, b] = science.positions;
      const toRad = Math.PI / 180;
      const cosine =
        Math.sin(a.altitudeDeg * toRad) * Math.sin(b.altitudeDeg * toRad) +
        Math.cos(a.altitudeDeg * toRad) *
          Math.cos(b.altitudeDeg * toRad) *
          Math.cos((a.azimuthDeg - b.azimuthDeg) * toRad);
      const measured = Math.acos(Math.min(1, Math.max(-1, cosine))) / toRad;
      expect(measured).toBeCloseTo(science.separationDeg, 4);
    }
  });

  it("carries the Moon's real phase whenever the Moon is one of the pair", () => {
    for (const opportunity of conjunctions) {
      const science = opportunity.science!;
      if (science.kind !== "conjunction") continue;
      const hasMoon = science.bodies.some((body) => body === "the Moon");
      if (!hasMoon) {
        expect(science.moon).toBeNull();
        continue;
      }
      expect(science.moon).not.toBeNull();
      expect(science.moon!.illuminatedFraction).toBeGreaterThanOrEqual(0);
      expect(science.moon!.illuminatedFraction).toBeLessThanOrEqual(1);
      expect(typeof science.moon!.waning).toBe("boolean");
    }
  });

  it("describes the instant the positions were taken at", () => {
    for (const opportunity of conjunctions) {
      const science = opportunity.science!;
      if (science.kind !== "conjunction") continue;
      expect(science.atUtc).toBe(opportunity.guidance.whenUtc);
      expect(Number.isFinite(Date.parse(science.atUtc))).toBe(true);
    }
  });

  it("no longer offers a photograph of a different pairing", () => {
    // The specific regression guard: whatever the imagery layer returns for a
    // conjunction, it must not be the Moon-and-Venus frame.
    const imagery = heroImageryFor("conjunction-the-moon-saturn", "conjunction");
    expect(imagery.title).not.toMatch(/venus/i);
    expect(imagery.claim).not.toBe("event-specific");
  });
});

describe("upcoming times say what they mean", () => {
  it("never labels a quarter phase as full", () => {
    // "Full phase 8:14 AM" appeared on The Last Quarter, because one label
    // served every phase.
    expect(UPCOMING_TIME_LABEL.phase).not.toMatch(/full/i);
  });

  it("gives every timing kind a distinct, concrete label", () => {
    const labels = Object.values(UPCOMING_TIME_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(2);
  });
});
