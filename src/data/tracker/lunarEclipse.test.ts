import {
  Body,
  EquatorFromVector,
  GeoVector,
  MakeTime,
  RotateVector,
  Rotation_EQJ_EQD,
  SearchLunarEclipse,
  SiderealTime,
} from "astronomy-engine";
import { describe, expect, it } from "vitest";
import {
  angularSeparationDeg,
  capOutline,
  lunarEclipseTiming,
  lunarGeographicVisibility,
  lunarLocalVisibility,
  sublunarCap,
  sublunarPoint,
} from "./lunarEclipse";
import { planNight } from "./schedule";

describe("lunar eclipse timing", () => {
  it("normalizes the audited 2026-08-28 semi-duration minutes into explicit contacts", () => {
    // Independent rounded reference: NASA 2026 eclipse circumstances,
    // P1 01:24, U1 02:34, greatest 04:13, U4 05:52, P4 07:02 UTC.
    const timing = lunarEclipseTiming(SearchLunarEclipse(new Date("2026-08-20T00:00:00Z")));
    expect(Math.abs(Date.parse(timing.maximumUtc) - Date.parse("2026-08-28T04:13:00Z"))).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(timing.partial!.startUtc) - Date.parse("2026-08-28T02:34:00Z"))).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(timing.partial!.endUtc) - Date.parse("2026-08-28T05:52:00Z"))).toBeLessThan(60_000);
    expect(Number(timing.partial!.durationMinutes)).toBeCloseTo(198.84, 1);
    expect(timing.totality).toBeNull();
    expect(Date.parse(timing.penumbral.startUtc)).toBeLessThan(Date.parse(timing.partial!.startUtc));
    expect(Date.parse(timing.partial!.endUtc)).toBeLessThan(Date.parse(timing.penumbral.endUtc));
  });

  it("carries the normalized contact model through ranking and presentation data", () => {
    const plan = planNight(
      45.5152,
      -122.6784,
      new Date("2026-08-28T00:00:00Z"),
      "America/Los_Angeles",
    )!;
    const eclipse = plan.ranking.ranked.find(
      (entry) => entry.opportunity.kind === "lunar-eclipse",
    )!.opportunity;
    expect(eclipse.guidance.durationMinutes).toBeGreaterThan(190);
    expect(eclipse.guidance.durationMinutes).toBeLessThan(210);
    expect(Date.parse(eclipse.profile.at(-1)!.atUtc) - Date.parse(eclipse.profile[0].atUtc)).toBeLessThan(
      4 * 60 * 60_000,
    );
    expect(eclipse.science?.kind).toBe("lunar-eclipse");
  });
});

describe("lunar eclipse horizon geometry", () => {
  // 3 March 2026, a total lunar eclipse. Fixed rather than "the next one" so
  // the numbers below mean something a year from now.
  const eclipse = SearchLunarEclipse(new Date("2026-01-01T00:00:00Z"));
  const timing = lunarEclipseTiming(eclipse);

  /** Where the Sun stands overhead, for the independent check below. */
  function subsolarPoint(at: Date) {
    const time = MakeTime(at);
    const sun = RotateVector(Rotation_EQJ_EQD(time), GeoVector(Body.Sun, time, true));
    const equatorial = EquatorFromVector(sun);
    return {
      latitudeDeg: equatorial.dec,
      longitudeDeg: ((equatorial.ra - SiderealTime(time)) * 15 + 540) % 360 - 180,
    };
  }

  it("puts the Moon overhead opposite the Sun, because that is what a full Moon is", () => {
    // The strongest check available without a published table: a lunar eclipse
    // happens at full Moon, so the sub-lunar point must sit at the antipode of
    // the sub-solar point, offset only by however far the Moon is from the
    // centre of the shadow. For a total eclipse that is under a degree and a
    // half, and anything larger would mean the coordinate conversion is wrong.
    const at = new Date(timing.maximumUtc);
    const sun = subsolarPoint(at);
    const moon = sublunarPoint(at);
    const separation = angularSeparationDeg(
      moon.latitudeDeg,
      moon.longitudeDeg,
      -sun.latitudeDeg,
      ((sun.longitudeDeg + 360) % 360) - 180,
    );
    expect(separation).toBeLessThan(1.5);
  });

  it("measures the horizon cap just inside 90°, where parallax and refraction leave it", () => {
    // Not 90°. Horizontal parallax lowers the Moon by about 0.95° and
    // refraction lifts it by about 0.57°, so the limb of visibility falls
    // slightly short of the geometric hemisphere. A result at exactly 90 would
    // mean the radius was assumed rather than computed.
    const cap = sublunarCap(new Date(timing.maximumUtc));
    expect(cap.radiusDeg).toBeGreaterThan(89.2);
    expect(cap.radiusDeg).toBeLessThan(90);
  });

  it("agrees with the altitude calculation at its own boundary", () => {
    // The map's edge and the reader's own answer have to come from one model.
    // A degree inside the cap the Moon must be up; a degree outside, down.
    const at = new Date(timing.maximumUtc);
    const cap = sublunarCap(at);
    const inside = lunarLocalVisibility(timing, cap.latitudeDeg - (cap.radiusDeg - 1), cap.longitudeDeg);
    const outside = lunarLocalVisibility(timing, cap.latitudeDeg - (cap.radiusDeg + 1), cap.longitudeDeg);
    expect(inside.altitudeAtMaximumDeg).toBeGreaterThan(0);
    expect(outside.altitudeAtMaximumDeg).toBeLessThan(0);
  });

  it("sees the whole eclipse from under the Moon, and none of it from the far side", () => {
    const moon = sublunarPoint(new Date(timing.maximumUtc));
    const under = lunarLocalVisibility(timing, moon.latitudeDeg, moon.longitudeDeg);
    expect(under.band).toBe("all");
    expect(under.visibleFraction).toBe(1);
    expect(under.altitudeAtMaximumDeg).toBeGreaterThan(85);
    expect(under.horizonCrossingUtc).toBeNull();

    const far = lunarLocalVisibility(
      timing,
      -moon.latitudeDeg,
      ((moon.longitudeDeg + 360) % 360) - 180,
    );
    expect(far.band).toBe("none");
    expect(far.visibleFraction).toBe(0);
    expect(far.horizonCrossingUtc).toBeNull();
  });

  it("finds the moonrise and moonset cases on the two edges of the cap", () => {
    // The interesting third case: the terminator sweeps during the eclipse, so
    // somewhere near the cap's edge the Moon must cross the horizon mid-event.
    // Searching the edge rather than asserting a hand-picked city keeps the
    // test about the geometry instead of about one location's timezone.
    const cap = sublunarCap(new Date(timing.maximumUtc));
    const found = new Set<string>();
    const crossings: string[] = [];
    for (let bearing = 0; bearing < 360; bearing += 5) {
      const outline = capOutline({ ...cap, radiusDeg: cap.radiusDeg }, 72);
      const point = outline[Math.round((bearing / 360) * 72) % 72];
      const local = lunarLocalVisibility(timing, point.latitudeDeg, point.longitudeDeg);
      found.add(local.band);
      if (local.horizonCrossingUtc) crossings.push(local.horizonCrossingUtc);
    }
    expect(found.has("moonrise")).toBe(true);
    expect(found.has("moonset")).toBe(true);

    // Every crossing reported must fall inside the eclipse, or it is not a
    // crossing *during* the event.
    const start = Date.parse(timing.observablePhase.startUtc);
    const end = Date.parse(timing.observablePhase.endUtc);
    for (const crossing of crossings) {
      expect(Date.parse(crossing)).toBeGreaterThanOrEqual(start);
      expect(Date.parse(crossing)).toBeLessThanOrEqual(end);
    }
  });

  it("classifies a field into regions whose boundaries follow the caps", () => {
    const moon = sublunarPoint(new Date(timing.maximumUtc));
    const bounds = {
      south: Math.max(-85, moon.latitudeDeg - 60),
      north: Math.min(85, moon.latitudeDeg + 60),
      west: moon.longitudeDeg - 120,
      east: moon.longitudeDeg + 120,
    };
    const field = lunarGeographicVisibility(timing, bounds, 4, 9);

    // All four bands should be represented across a field this wide.
    const bands = new Set(field.cells.map((cell) => cell.band));
    expect(bands.has("all")).toBe(true);
    expect(bands.has("none")).toBe(true);
    expect(bands.size).toBeGreaterThanOrEqual(3);

    // And each cell's band must agree with the caps it was derived from, which
    // is what makes the drawn boundary a horizon rather than a grid artefact.
    for (const cell of field.cells) {
      const insideFirst =
        angularSeparationDeg(
          cell.latitudeDeg,
          cell.longitudeDeg,
          field.keyCaps.start.latitudeDeg,
          field.keyCaps.start.longitudeDeg,
        ) <= field.keyCaps.start.radiusDeg;
      const insideLast =
        angularSeparationDeg(
          cell.latitudeDeg,
          cell.longitudeDeg,
          field.keyCaps.end.latitudeDeg,
          field.keyCaps.end.longitudeDeg,
        ) <= field.keyCaps.end.radiusDeg;
      if (cell.band === "all") expect(insideFirst && insideLast).toBe(true);
      if (cell.band === "none") expect(insideFirst || insideLast).toBe(false);
    }
  });

  it("draws a closed outline that stays on the globe", () => {
    const outline = capOutline(sublunarCap(new Date(timing.maximumUtc)), 120);
    expect(outline).toHaveLength(121);
    for (const point of outline) {
      expect(point.latitudeDeg).toBeGreaterThanOrEqual(-90);
      expect(point.latitudeDeg).toBeLessThanOrEqual(90);
      expect(point.longitudeDeg).toBeGreaterThanOrEqual(-180);
      expect(point.longitudeDeg).toBeLessThanOrEqual(180);
    }
    // Closed: the last point returns to the first.
    expect(outline[0].latitudeDeg).toBeCloseTo(outline[120].latitudeDeg, 6);
  });
});
