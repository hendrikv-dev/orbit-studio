import { describe, expect, it } from "vitest";
import {
  daylightPolygon,
  nightPolygon,
  subsolarPoint,
  sunAltitudeAt,
  twilightBandFor,
} from "./daylight";

/** Ray casting across every part, matching how the renderer fills them. */
function inside(poly: GeoJSON.Feature<GeoJSON.MultiPolygon>, lon: number, lat: number): boolean {
  for (const part of poly.geometry.coordinates) {
    const ring = part[0];
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
    if (hit) return true;
  }
  return false;
}

/** Every coordinate must be a valid one, which is what the renderer requires. */
function allInRange(poly: GeoJSON.Feature<GeoJSON.MultiPolygon>): boolean {
  return poly.geometry.coordinates.every((part) =>
    part[0].every(([lon, lat]) => lon >= -180.001 && lon <= 180.001 && lat >= -90.001 && lat <= 90.001),
  );
}

describe("nightPolygon", () => {
  const cases = [
    ["June solstice", new Date("2026-06-21T12:00:00Z")],
    ["December solstice", new Date("2026-12-21T12:00:00Z")],
    ["March equinox", new Date("2026-03-20T12:00:00Z")],
    ["September equinox", new Date("2026-09-23T00:00:00Z")],
  ] as const;

  for (const [name, at] of cases) {
    for (const altitude of [0, -6, -18]) {
      it(`${name} at ${altitude}° agrees with the altitude it was built from`, () => {
        const subsolar = subsolarPoint(at);
        const polygon = nightPolygon(subsolar, altitude);
        let checked = 0;
        let wrong = 0;
        // Sample away from the boundary: a polygon approximated by 240 segments
        // cannot be right to the degree on the edge itself, and nothing in the
        // product depends on it being so.
        for (let lat = -85; lat <= 85; lat += 5) {
          for (let lon = -175; lon <= 175; lon += 5) {
            const alt = sunAltitudeAt(subsolar, lat, lon);
            if (Math.abs(alt - altitude) < 2) continue;
            checked += 1;
            if (inside(polygon, lon, lat) !== alt < altitude) wrong += 1;
          }
        }
        expect(checked).toBeGreaterThan(1500);
        expect(wrong).toBe(0);
      });
    }
  }

  it("keeps every coordinate inside the world it is drawn on", () => {
    // Coordinates outside ±180 are not valid GeoJSON, and MapLibre's tiler
    // silently never finishes on them: the map stays blank and reports nothing.
    for (const [, at] of cases) {
      for (const altitude of [0, -6, -18]) {
        expect(allInRange(nightPolygon(subsolarPoint(at), altitude))).toBe(true);
      }
    }
  });

  it("does not fold into stripes: the boundary advances west to east", () => {
    const subsolar = subsolarPoint(new Date("2026-06-21T12:00:00Z"));
    const ring = nightPolygon(subsolar, 0).geometry.coordinates[0][0];
    // The trailing points close the shape along a pole; the boundary itself is
    // everything before that, and it must never double back.
    const boundary = ring.slice(0, ring.length - 3);
    const backwards = boundary.slice(1).filter((p, i) => p[0] < boundary[i][0]).length;
    expect(backwards).toBe(0);
  });

  it("covers the dark side and not the lit side at a known moment", () => {
    // Northern midsummer, midday at Greenwich: London is lit, and the far side
    // of the world is not. A terminator drawn inside out passes every
    // self-consistent test and still gets this backwards.
    const subsolar = subsolarPoint(new Date("2026-06-21T12:00:00Z"));
    const night = nightPolygon(subsolar, 0);
    expect(inside(night, -0.13, 51.5)).toBe(false);
    expect(inside(night, 174.76, -36.85)).toBe(true);
  });
});

describe("daylightPolygon", () => {
  it("is the complement of the night at the same altitude", () => {
    // Northern midsummer, midday at Greenwich. London is lit; the far side is not.
    const subsolar = subsolarPoint(new Date("2026-06-21T12:00:00Z"));
    const day = daylightPolygon(subsolar, 0);
    expect(inside(day, -0.13, 51.5)).toBe(true);
    expect(inside(day, 174.76, -36.85)).toBe(false);
  });

  it("agrees with the Sun's altitude everywhere away from the boundary", () => {
    for (const at of [new Date("2026-03-20T12:00:00Z"), new Date("2026-12-21T12:00:00Z")]) {
      const subsolar = subsolarPoint(at);
      const day = daylightPolygon(subsolar, 0);
      let wrong = 0;
      for (let lat = -85; lat <= 85; lat += 5) {
        for (let lon = -175; lon <= 175; lon += 5) {
          const alt = sunAltitudeAt(subsolar, lat, lon);
          if (Math.abs(alt) < 2) continue;
          if (inside(day, lon, lat) !== alt > 0) wrong += 1;
        }
      }
      expect(wrong).toBe(0);
    }
  });
});

describe("twilight bands", () => {
  it("names every altitude, with no gaps and no overlaps", () => {
    const seen = new Map<string, number[]>();
    for (let altitude = -90; altitude <= 90; altitude += 0.5) {
      const band = twilightBandFor(altitude);
      expect(band).toBeDefined();
      seen.set(band.id, [...(seen.get(band.id) ?? []), altitude]);
    }
    expect([...seen.keys()].sort()).toEqual(
      ["astronomical", "civil", "day", "nautical", "night"].sort(),
    );
  });

  it("puts the published boundaries where the almanacs put them", () => {
    expect(twilightBandFor(10).id).toBe("day");
    expect(twilightBandFor(-0.5).id).toBe("civil");
    expect(twilightBandFor(-6).id).toBe("nautical");
    expect(twilightBandFor(-12).id).toBe("astronomical");
    expect(twilightBandFor(-18).id).toBe("night");
    expect(twilightBandFor(-45).id).toBe("night");
  });
});
