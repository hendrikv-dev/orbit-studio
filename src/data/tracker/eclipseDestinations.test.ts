import { describe, expect, it } from "vitest";
import {
  bearingDeg,
  destinationFrom,
  eclipseDestinations,
  findNextEclipse,
  findNextVisibleEclipse,
  findPreviousVisibleEclipse,
  greatCircleKm,
} from "./eclipseDestinations";

/**
 * Validated against eclipses people remember.
 *
 * Every assertion below is checkable against published circumstances rather
 * than against Tracker's own output, and the origins are deliberately spread
 * across the footprint: inside totality, inside the partial zone, and on the
 * wrong hemisphere entirely.
 */

const PORTLAND = { lat: 45.5152, lon: -122.6784 };
const MADRID = { lat: 40.4168, lon: -3.7038 };
const REYKJAVIK = { lat: 64.1466, lon: -21.9426 };
const LONDON = { lat: 51.5072, lon: -0.1276 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

describe("finding eclipses", () => {
  it("finds the 2026 eclipses in order, with the right kinds", () => {
    // Published: 17 Feb 2026 annular over Antarctica; 12 Aug 2026 total across
    // Greenland, Iceland and northern Spain.
    const events = findNextEclipse(new Date("2026-01-01T00:00:00Z"), 2);
    expect(events[0].id).toBe("solar-eclipse-2026-02-17");
    expect(events[0].kind).toBe("annular");
    expect(events[1].id).toBe("solar-eclipse-2026-08-12");
    expect(events[1].kind).toBe("total");
  });

  it("puts greatest eclipse for August 2026 over Iceland", () => {
    const [, august] = findNextEclipse(new Date("2026-01-01T00:00:00Z"), 2);
    expect(august.greatestPoint).not.toBeNull();
    // Published greatest eclipse: about 65°N, 25°W — off Iceland's west coast.
    expect(august.greatestPoint!.latitudeDeg).toBeCloseTo(65.2, 0);
    expect(august.greatestPoint!.longitudeDeg).toBeCloseTo(-25.2, 0);
  });

  describe("the two questions are different questions", () => {
    it("finds the next eclipse anywhere without asking where the reader is", () => {
      // The signature is the guarantee: no location can be passed, so this
      // search cannot silently become the visible-from-here one.
      expect(findNextEclipse.length).toBeLessThanOrEqual(2);
      const [next] = findNextEclipse(new Date("2026-06-01T00:00:00Z"), 1);
      expect(next.id).toBe("solar-eclipse-2026-08-12");
    });

    it("skips it for a reader who cannot see it", () => {
      // August 2026 is invisible from Portland; the next one Portland actually
      // sees is the January 2029 partial.
      const visible = findNextVisibleEclipse(
        PORTLAND.lat,
        PORTLAND.lon,
        new Date("2026-06-01T00:00:00Z"),
      );
      expect(visible).not.toBeNull();
      expect(visible!.event.id).toBe("solar-eclipse-2029-01-14");
      expect(visible!.circumstances.visibleFromHere).toBe(true);
      expect(visible!.circumstances.obscurationFraction).toBeGreaterThan(0.5);
    });

    it("does not skip it for a reader who is asking where to go", () => {
      // The same date, the same place, the other question — and the eclipse
      // that the first search discarded is the one this one returns.
      const [next] = findNextEclipse(new Date("2026-06-01T00:00:00Z"), 1);
      const destinations = eclipseDestinations(next, PORTLAND.lat, PORTLAND.lon);
      expect(destinations.event.id).toBe("solar-eclipse-2026-08-12");
      expect(destinations.origin.circumstances.obscurationFraction).toBe(0);
      expect(destinations.candidates.length).toBeGreaterThan(0);
    });
  });

  it("searches backwards for the last one visible from a place", () => {
    // From Portland, the most recent before 2026 is 8 April 2024 — the Great
    // North American Eclipse, which Portland saw as a modest partial.
    const previous = findPreviousVisibleEclipse(
      PORTLAND.lat,
      PORTLAND.lon,
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(previous).not.toBeNull();
    expect(previous!.event.id).toBe("solar-eclipse-2024-04-08");
    expect(previous!.circumstances.visibleFromHere).toBe(true);
    // Published: roughly 22% from Portland, far from the Texas-to-Maine path.
    expect(previous!.circumstances.obscurationFraction).toBeGreaterThan(0.15);
    expect(previous!.circumstances.obscurationFraction).toBeLessThan(0.3);
  });
});

describe("where should I go", () => {
  const [event] = findNextEclipse(new Date("2026-06-01T00:00:00Z"), 1);

  it("tells a reader already inside totality that they are", () => {
    // Reykjavik is on the 2026 track.
    const there = eclipseDestinations(event, REYKJAVIK.lat, REYKJAVIK.lon);
    expect(there.origin.circumstances.kind).toBe("total");
    expect(there.origin.circumstances.centralDurationSeconds).toBeGreaterThan(30);
    // And does not suggest travelling for what they already have.
    expect(there.candidates.every((c) => c.kind !== "closest-visibility")).toBe(true);
  });

  it("sends a reader in the partial zone to the central line", () => {
    // London sees about 90% of the 2026 eclipse; totality is in northern Spain,
    // roughly a thousand kilometres south-west.
    const from = eclipseDestinations(event, LONDON.lat, LONDON.lon);
    expect(from.origin.circumstances.obscurationFraction).toBeGreaterThan(0.85);
    expect(from.origin.circumstances.kind).toBe("partial");
    const central = from.candidates.find((c) => c.kind === "closest-central");
    expect(central).toBeDefined();
    expect(central!.circumstances.kind).toBe("total");
    expect(central!.distanceKm).toBeGreaterThan(500);
    expect(central!.distanceKm).toBeLessThan(2000);
    expect(central!.bearingDeg).toBeGreaterThan(180);
  });

  it("gives a reader outside the footprint both a nearest sight and a nearest totality", () => {
    const from = eclipseDestinations(event, PORTLAND.lat, PORTLAND.lon);
    expect(from.origin.circumstances.obscurationFraction).toBe(0);
    const kinds = from.candidates.map((c) => c.kind);
    expect(kinds).toContain("closest-central");
    expect(kinds).toContain("closest-visibility");
    // Closest visibility must be closer than closest totality, or it is not
    // answering "the least I could travel to see anything".
    const visibility = from.candidates.find((c) => c.kind === "closest-visibility")!;
    const central = from.candidates.find((c) => c.kind === "closest-central")!;
    expect(visibility.distanceKm).toBeLessThan(central.distanceKm);
  });

  it("does not pretend there is somewhere to go from the wrong hemisphere", () => {
    // Sydney is thirteen thousand kilometres from the track. Offering a nearest
    // partial would be true and absurd.
    const from = eclipseDestinations(event, SYDNEY.lat, SYDNEY.lon);
    expect(from.origin.circumstances.obscurationFraction).toBe(0);
    expect(from.candidates.some((c) => c.kind === "closest-visibility")).toBe(false);
  });

  describe("every candidate is somewhere worth standing", () => {
    const origins = [PORTLAND, MADRID, REYKJAVIK, LONDON, SYDNEY];

    it("never recommends a place where the Sun is on the horizon at maximum", () => {
      // `visibleFromHere` is true when any phase clears the horizon, which
      // includes an eclipse that is over by sunrise. Real, and not a place to
      // send anybody.
      for (const origin of origins) {
        for (const candidate of eclipseDestinations(event, origin.lat, origin.lon).candidates) {
          expect(candidate.circumstances.sunAltitudeAtPeakDeg).toBeGreaterThanOrEqual(5);
        }
      }
    });

    it("never recommends somewhere no better than home", () => {
      for (const origin of origins) {
        const from = eclipseDestinations(event, origin.lat, origin.lon);
        for (const candidate of from.candidates) {
          expect(candidate.circumstances.obscurationFraction).toBeGreaterThanOrEqual(
            from.origin.circumstances.obscurationFraction,
          );
        }
      }
    });

    it("offers a small number of choices rather than a coordinate dump", () => {
      for (const origin of origins) {
        expect(eclipseDestinations(event, origin.lat, origin.lon).candidates.length)
          .toBeLessThanOrEqual(3);
      }
    });

    it("labels its distances as straight lines, because that is what they are", () => {
      const from = eclipseDestinations(event, PORTLAND.lat, PORTLAND.lon);
      expect(from.distanceBasis).toBe("great-circle");
    });
  });

  it("works backwards in time from the same machinery", () => {
    // "Where could I have gone from Portland to see totality in 2024?" — the
    // answer is Texas through Maine, and it is the same call.
    const [historic] = findNextEclipse(new Date("2024-04-01T00:00:00Z"), 1);
    expect(historic.id).toBe("solar-eclipse-2024-04-08");
    const from = eclipseDestinations(historic, PORTLAND.lat, PORTLAND.lon);
    const central = from.candidates.find((c) => c.kind === "closest-central");
    expect(central).toBeDefined();
    expect(central!.circumstances.kind).toBe("total");
    // The 2024 path crossed North America; from Portland it is east and south.
    expect(central!.longitudeDeg).toBeGreaterThan(PORTLAND.lon);
  });
});

describe("the geometry underneath", () => {
  it("measures great-circle distance against known separations", () => {
    // London to New York is about 5,570 km.
    expect(greatCircleKm(51.5072, -0.1276, 40.7128, -74.006)).toBeCloseTo(5570, -2);
    expect(greatCircleKm(45, 0, 45, 0)).toBe(0);
  });

  it("bears north, east, south and west correctly", () => {
    expect(bearingDeg(0, 0, 10, 0)).toBeCloseTo(0, 0);
    expect(bearingDeg(0, 0, 0, 10)).toBeCloseTo(90, 0);
    expect(bearingDeg(0, 0, -10, 0)).toBeCloseTo(180, 0);
    expect(bearingDeg(0, 0, 0, -10)).toBeCloseTo(270, 0);
  });

  it("round-trips a bearing and distance back to the same place", () => {
    const start = { lat: 45.5152, lon: -122.6784 };
    for (const bearing of [0, 45, 137, 250, 359]) {
      const moved = destinationFrom(start.lat, start.lon, bearing, 800);
      expect(greatCircleKm(start.lat, start.lon, moved.latitudeDeg, moved.longitudeDeg))
        .toBeCloseTo(800, 0);
      // Compared on the circle: due north is both 0° and 360°, and a
      // round trip that lands on 359.99999 is exact, not half a degree out.
      const measured = bearingDeg(start.lat, start.lon, moved.latitudeDeg, moved.longitudeDeg);
      const apart = Math.abs(((measured - bearing + 540) % 360) - 180);
      expect(apart).toBeLessThan(0.5);
    }
  });
});
