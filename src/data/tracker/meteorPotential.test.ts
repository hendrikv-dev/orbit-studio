import { describe, expect, it } from "vitest";
import { describePotential, meteorPotentialAt, meteorPotentialField } from "./meteorPotential";
import { meteorShowerByCode } from "./meteorShowers";

const PERSEIDS = meteorShowerByCode("PER")!;
// The 2027 Perseid maximum, near enough for a night-shaped test.
const PEAK = new Date("2027-08-13T04:00:00Z");

describe("meteor observing potential", () => {
  const field = meteorPotentialField(PERSEIDS, PEAK, 10);

  it("covers the world and stays inside its own range", () => {
    expect(field.cells.length).toBeGreaterThan(500);
    for (const cell of field.cells) {
      expect(cell.potential).toBeGreaterThanOrEqual(0);
      expect(cell.potential).toBeLessThanOrEqual(1);
      expect(cell.darkHours).toBeLessThanOrEqual(24);
    }
  });

  it("is a northern shower: the Perseid radiant never favours the deep south", () => {
    const north = field.cells.filter((c) => c.latitudeDeg >= 35 && c.latitudeDeg <= 65);
    const south = field.cells.filter((c) => c.latitudeDeg <= -35);
    const best = (cells: typeof north) => Math.max(...cells.map((c) => c.potential));
    expect(best(north)).toBeGreaterThan(best(south));
  });

  it("gives nothing where the radiant never rises", () => {
    // The Perseid radiant is at +58° declination, so it is always below the horizon
    // south of about −32°. Antarctic cells must be flat zero on the radiant.
    for (const cell of field.cells.filter((c) => c.latitudeDeg <= -60)) {
      expect(cell.radiantTerm).toBe(0);
      expect(cell.potential).toBe(0);
    }
  });

  it("gives nothing where it never gets dark", () => {
    // Mid-August: the Arctic is still in permanent twilight or daylight.
    const arctic = field.cells.filter((c) => c.latitudeDeg >= 80);
    expect(arctic.every((c) => c.darkHours === 0)).toBe(true);
    expect(arctic.every((c) => c.potential === 0)).toBe(true);
  });

  it("separates its inputs, so a low score can be explained", () => {
    const somewhere = field.cells.find((c) => c.potential > 0.1);
    expect(somewhere).toBeDefined();
    expect(somewhere!.darkHours).toBeGreaterThan(0);
    expect(somewhere!.radiantTerm).toBeGreaterThan(0);
    expect(somewhere!.moonTerm).toBeGreaterThan(0);
    expect(somewhere!.activityTerm).toBeGreaterThan(0);
  });

  it("reads the same at a point as the field does around it", () => {
    const cell = field.cells.find((c) => c.latitudeDeg === 45 && c.longitudeDeg === -120)!;
    const direct = meteorPotentialAt(PERSEIDS, PEAK, 45, -120);
    expect(direct.potential).toBeCloseTo(cell.potential, 10);
    expect(direct.darkHours).toBeCloseTo(cell.darkHours, 10);
  });

  it("falls away from the peak night", () => {
    const offPeak = meteorPotentialField(PERSEIDS, new Date("2027-07-25T04:00:00Z"), 20);
    expect(offPeak.peak).toBeLessThan(field.peak);
  });

  it("names a potential rather than printing a bare number", () => {
    expect(describePotential(0.6)).toBe("Strong");
    expect(describePotential(0.35)).toBe("Good");
    expect(describePotential(0.2)).toBe("Moderate");
    expect(describePotential(0.05)).toBe("Weak");
    expect(describePotential(0)).toBe("Not favourable");
  });
});
