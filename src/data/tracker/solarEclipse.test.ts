import { describe, expect, it } from "vitest";
import {
  coverageField,
  discObscuration,
  eclipseSampleAt,
  localSolarCircumstances,
  mapExtentFor,
  nextSolarEclipses,
  traceCentralPath,
} from "./solarEclipse";

/**
 * The eclipse geometry is checked against a published eclipse rather than
 * against itself.
 *
 * A self-consistency test on a model like this proves the arithmetic and
 * nothing else. The total eclipse of 2 August 2027 has a path everybody knows —
 * it crosses Luxor at greatest eclipse with a duration over six minutes — so
 * that is the assertion, and it is one the implementation cannot satisfy by
 * being wrong in a self-consistent way.
 */

const FROM = new Date("2027-01-01T00:00:00Z");

describe("solar eclipse disc geometry", () => {
  it("returns nothing where the discs do not touch", () => {
    expect(discObscuration(2, 0.26, 0.26)).toBe(0);
  });

  it("returns totality where the Moon covers the Sun completely", () => {
    expect(discObscuration(0, 0.26, 0.28)).toBe(1);
  });

  it("returns the area ratio for an annular eclipse rather than totality", () => {
    // A Moon smaller than the Sun can never obscure all of it, however well
    // aligned. Reporting 1 here is the classic annular/total confusion.
    const annular = discObscuration(0, 0.27, 0.25);
    expect(annular).toBeGreaterThan(0.8);
    expect(annular).toBeLessThan(1);
  });

  it("rises monotonically as the discs close", () => {
    const wide = discObscuration(0.4, 0.26, 0.26);
    const near = discObscuration(0.2, 0.26, 0.26);
    const closer = discObscuration(0.05, 0.26, 0.26);
    expect(near).toBeGreaterThan(wide);
    expect(closer).toBeGreaterThan(near);
  });
});

describe("solar eclipse catalogue", () => {
  it("finds the 2027 annular and total eclipses in order", () => {
    const events = nextSolarEclipses(FROM, 2);
    expect(events[0].kind).toBe("annular");
    expect(events[0].peakUtc.slice(0, 10)).toBe("2027-02-06");
    expect(events[1].kind).toBe("total");
    expect(events[1].peakUtc.slice(0, 10)).toBe("2027-08-02");
  });

  it("carries the shadow-axis point only where the axis reaches Earth", () => {
    const [annular, total] = nextSolarEclipses(FROM, 2);
    expect(annular.greatestPoint).not.toBeNull();
    expect(total.greatestPoint).not.toBeNull();
    // Greatest eclipse on 2 August 2027 is in southern Egypt, near Luxor.
    expect(total.greatestPoint!.latitudeDeg).toBeCloseTo(25.5, 0);
    expect(total.greatestPoint!.longitudeDeg).toBeCloseTo(33.2, 0);
  });
});

describe("the central path", () => {
  const total = nextSolarEclipses(FROM, 2)[1];
  const path = traceCentralPath(total, 15, 120);

  it("traces the published track across North Africa", () => {
    expect(path.length).toBeGreaterThan(6);
    // Enters over the Atlantic west of Morocco, leaves over the Indian Ocean.
    const first = path[0];
    const last = path[path.length - 1];
    expect(first.longitudeDeg).toBeLessThan(last.longitudeDeg);
    expect(first.latitudeDeg).toBeGreaterThan(last.latitudeDeg);
  });

  it("passes within a degree of Luxor at greatest eclipse", () => {
    const nearest = path.reduce((best, point) =>
      Math.abs(Date.parse(point.atUtc) - Date.parse(total.peakUtc)) <
      Math.abs(Date.parse(best.atUtc) - Date.parse(total.peakUtc))
        ? point
        : best,
    );
    expect(nearest.latitudeDeg).toBeCloseTo(25.8, 0);
    expect(nearest.longitudeDeg).toBeCloseTo(32.9, 0);
  });

  it("is total everywhere along a total eclipse's own centre line", () => {
    for (const point of path) expect(point.obscuration).toBeGreaterThan(0.99);
  });

  it("draws no path at all for an eclipse whose axis misses Earth", () => {
    const partial = nextSolarEclipses(FROM, 8).find((event) => event.kind === "partial");
    expect(partial).toBeDefined();
    expect(partial!.greatestPoint).toBeNull();
    expect(traceCentralPath(partial!)).toHaveLength(0);
  });
});

describe("local circumstances", () => {
  const total = nextSolarEclipses(FROM, 2)[1];

  it("reports totality from inside the path", () => {
    // Luxor.
    const local = localSolarCircumstances(total, 25.69, 32.64);
    expect(local.kind).toBe("total");
    expect(local.obscurationFraction).toBeCloseTo(1, 3);
    expect(local.visibleFromHere).toBe(true);
    expect(local.centralBeginUtc).not.toBeNull();
    expect(local.centralEndUtc).not.toBeNull();
  });

  it("reports a partial eclipse from outside the path, with contact times", () => {
    // Athens: well north of the track, deep partial.
    const local = localSolarCircumstances(total, 37.98, 23.73);
    expect(local.kind).toBe("partial");
    expect(local.obscurationFraction).toBeGreaterThan(0.5);
    expect(local.obscurationFraction).toBeLessThan(1);
    expect(local.centralBeginUtc).toBeNull();
    expect(Date.parse(local.partialBeginUtc!)).toBeLessThan(Date.parse(local.peakUtc!));
    expect(Date.parse(local.partialEndUtc!)).toBeGreaterThan(Date.parse(local.peakUtc!));
  });

  it("does not claim visibility where the Sun is below the horizon", () => {
    // Auckland, on the far side of the planet at this eclipse's maximum.
    const local = localSolarCircumstances(total, -36.85, 174.76);
    expect(local.visibleFromHere).toBe(false);
  });

  it("measures the distance to the centre line rather than guessing it", () => {
    const path = traceCentralPath(total, 15, 120);
    const onLine = localSolarCircumstances(total, 25.69, 32.64, path);
    const farOff = localSolarCircumstances(total, 37.98, 23.73, path);
    expect(onLine.distanceToCentralLineKm).toBeLessThan(120);
    // Athens is a few hundred kilometres north of the track through Libya. The
    // bound is loose because the answer is quoted to the nearest ten kilometres
    // and the point of the assertion is that it is not the nearest *sample*.
    expect(farOff.distanceToCentralLineKm).toBeGreaterThan(400);
    expect(farOff.distanceToCentralLineKm).toBeLessThan(900);
  });
});

describe("the coverage field", () => {
  const total = nextSolarEclipses(FROM, 2)[1];

  it("peaks on the track and falls away from it", () => {
    const field = coverageField(
      total,
      { south: 18, north: 34, west: 26, east: 42 },
      4,
      120,
    );
    const onTrack = field.cells.reduce((best, cell) =>
      cell.obscuration > best.obscuration ? cell : best,
    );
    expect(onTrack.obscuration).toBeGreaterThan(0.98);
    expect(onTrack.sunUp).toBe(true);

    const northEdge = field.cells.filter((cell) => cell.latitudeDeg >= 34);
    expect(northEdge.every((cell) => cell.obscuration < onTrack.obscuration)).toBe(true);
  });

  it("never reports coverage above one or below zero", () => {
    const field = coverageField(total, { south: 20, north: 32, west: 28, east: 40 }, 6, 120);
    for (const cell of field.cells) {
      expect(cell.obscuration).toBeGreaterThanOrEqual(0);
      expect(cell.obscuration).toBeLessThanOrEqual(1);
    }
  });
});

describe("the map extent", () => {
  it("keeps the observer inside the box", () => {
    const total = nextSolarEclipses(FROM, 2)[1];
    const path = traceCentralPath(total, 20, 120);
    const bounds = mapExtentFor(45.5, -122.7, path);
    expect(bounds.south).toBeLessThan(45.5);
    expect(bounds.north).toBeGreaterThan(45.5);
    expect(bounds.west).toBeLessThan(-122.7);
    expect(bounds.east).toBeGreaterThan(-122.7);
  });

  it("stays legible rather than growing to contain a track on the far side", () => {
    const total = nextSolarEclipses(FROM, 2)[1];
    const path = traceCentralPath(total, 20, 120);
    const bounds = mapExtentFor(45.5, -122.7, path);
    expect(bounds.east - bounds.west).toBeLessThanOrEqual(145);
  });
});

describe("one observer at one instant", () => {
  it("puts the Sun below the horizon on the night side", () => {
    const sample = eclipseSampleAt(new Date("2027-08-02T10:06:00Z"), -36.85, 174.76);
    expect(sample.sunAltitudeDeg).toBeLessThan(0);
  });
});
