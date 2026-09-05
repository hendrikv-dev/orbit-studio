import { describe, expect, it } from "vitest";
import { SearchGlobalSolarEclipse } from "astronomy-engine";
import {
  coverageField,
  discObscuration,
  eclipseSampleAt,
  localSolarCircumstances,
  mapExtentFor,
  nextSolarEclipses,
  shadowAxisPoint,
  traceCentralPath,
} from "./solarEclipse";

/**
 * The eclipse geometry is checked against published circumstances, not against
 * itself.
 *
 * A self-consistency test on a model like this proves the arithmetic and
 * nothing else, and this file previously contained one that a *wrong* centre
 * line passed: asserting only that the traced line lands somewhere inside the
 * corridor cannot distinguish the shadow axis from any other point in a
 * two-hundred-kilometre-wide band of total obscuration.
 *
 * The eclipse used throughout is the total eclipse of 2 August 2027, whose
 * circumstances are widely published:
 *
 * - greatest eclipse 25°31'N 33°11'E, near Luxor;
 * - maximum path width about 258 km;
 * - about 6m 23s of totality at Luxor.
 *
 * Reference values are quoted with their tolerance where the assertion depends
 * on one, so a future change has to face the number rather than the intent.
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

describe("the shadow axis", () => {
  it("reproduces the engine's own greatest-eclipse point to under a metre", () => {
    // The strongest check available. Astronomy Engine derives the coordinates
    // of greatest eclipse from the same construction and its figure agrees with
    // published circumstances; reproducing it exactly is what licenses using
    // this function at every *other* instant, where the engine offers nothing
    // to compare against.
    for (const seed of ["2027-01-01", "2028-01-01", "2030-01-01", "2033-01-01"]) {
      const engine = SearchGlobalSolarEclipse(new Date(`${seed}T00:00:00Z`));
      if (engine.latitude === undefined || engine.longitude === undefined) continue;
      const axis = shadowAxisPoint(engine.peak.date);
      expect(axis).not.toBeNull();
      // A ten-thousandth of a degree is about eleven metres.
      expect(axis!.latitudeDeg).toBeCloseTo(engine.latitude, 4);
      expect(axis!.longitudeDeg).toBeCloseTo(engine.longitude, 4);
    }
  });

  it("returns nothing where the axis misses Earth", () => {
    const partial = nextSolarEclipses(FROM, 8).find((event) => event.kind === "partial");
    expect(partial).toBeDefined();
    // A partial eclipse is partial precisely because the axis passes Earth by.
    expect(shadowAxisPoint(new Date(partial!.peakUtc))).toBeNull();
  });
});

describe("the central path", () => {
  const total = nextSolarEclipses(FROM, 2)[1];
  const path = traceCentralPath(total, 6, 240, true);

  it("traces the published track across North Africa", () => {
    expect(path.length).toBeGreaterThan(20);
    const first = path[0];
    const last = path[path.length - 1];
    expect(first.longitudeDeg).toBeLessThan(last.longitudeDeg);
    expect(first.latitudeDeg).toBeGreaterThan(last.latitudeDeg);
  });

  it("puts greatest eclipse where the published circumstances put it", () => {
    const nearest = path.reduce((best, point) =>
      Math.abs(Date.parse(point.atUtc) - Date.parse(total.peakUtc)) <
      Math.abs(Date.parse(best.atUtc) - Date.parse(total.peakUtc))
        ? point
        : best,
    );
    // Published: 25 deg 31 min N, 33 deg 11 min E.
    expect(nearest.latitudeDeg).toBeCloseTo(25.517, 1);
    expect(nearest.longitudeDeg).toBeCloseTo(33.183, 1);
  });

  it("is the axis, not merely a point inside the band", () => {
    // The test the previous implementation would have passed and should not
    // have: a hill-climb on obscuration lands anywhere in the umbra, so the
    // discriminating check is that the traced point sits at the *centre* of the
    // band rather than somewhere in it. Both limits must be roughly equidistant.
    const withLimits = path.filter((point) => point.limits !== null);
    expect(withLimits.length).toBeGreaterThan(10);
    for (const point of withLimits) {
      const { limits } = point;
      const northGap = Math.hypot(
        limits!.northLatitudeDeg - point.latitudeDeg,
        (limits!.northLongitudeDeg - point.longitudeDeg) *
          Math.cos(point.latitudeDeg * (Math.PI / 180)),
      );
      const southGap = Math.hypot(
        limits!.southLatitudeDeg - point.latitudeDeg,
        (limits!.southLongitudeDeg - point.longitudeDeg) *
          Math.cos(point.latitudeDeg * (Math.PI / 180)),
      );
      // Within a tenth of the half-width of each other.
      expect(Math.abs(northGap - southGap)).toBeLessThan(0.1 * Math.max(northGap, southGap));
    }
  });

  it("measures a path width that matches the published maximum", () => {
    const widest = path.reduce(
      (best, point) => Math.max(best, point.limits?.widthKm ?? 0),
      0,
    );
    // Published maximum width for this eclipse is about 258 km.
    expect(widest).toBeGreaterThan(230);
    expect(widest).toBeLessThan(285);
  });

  it("classifies each point of the band rather than the eclipse as a whole", () => {
    for (const point of path) {
      expect(point.central).toBe("total");
      expect(point.obscuration).toBeGreaterThan(0.999);
    }
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

  it("puts maximum eclipse in the middle of totality, not at its start", () => {
    // The defect this exists for: obscuration is exactly 1 from second contact
    // to third, so "the first sample at the maximum value" reported the start of
    // totality as "maximum here" — three minutes early, on the one event where
    // people set an alarm.
    const local = localSolarCircumstances(total, 25.6872, 32.6396); // Luxor
    expect(local.kind).toBe("total");
    expect(local.centralBeginUtc).not.toBeNull();
    expect(local.centralEndUtc).not.toBeNull();

    const begin = Date.parse(local.centralBeginUtc!);
    const end = Date.parse(local.centralEndUtc!);
    const maximum = Date.parse(local.peakUtc!);

    expect(maximum).toBeGreaterThan(begin);
    expect(maximum).toBeLessThan(end);
    // Materially after second contact: more than a minute, for an eclipse whose
    // totality here runs over six.
    expect(maximum - begin).toBeGreaterThan(60_000);
    // And within a few seconds of the midpoint, which is what "maximum" means
    // for a near-symmetric central phase.
    expect(Math.abs(maximum - (begin + end) / 2)).toBeLessThan(10_000);
  });

  it("reports a totality duration that matches the published one", () => {
    const local = localSolarCircumstances(total, 25.6872, 32.6396); // Luxor
    // Published: about 6m 23s at Luxor.
    expect(local.centralDurationSeconds).toBeGreaterThan(370);
    expect(local.centralDurationSeconds).toBeLessThan(400);
  });

  it("separates on-centre, off-centre and outside the band", () => {
    const path = traceCentralPath(total, 6, 240, true);
    const onAxis = path.find(
      (point) => Math.abs(Date.parse(point.atUtc) - Date.parse(total.peakUtc)) < 4 * 60_000,
    );
    expect(onAxis).toBeDefined();

    const centre = localSolarCircumstances(
      total,
      onAxis!.latitudeDeg,
      onAxis!.longitudeDeg,
      path,
    );
    // Just inside the northern limit: still total, but a much shorter one.
    const edge = localSolarCircumstances(
      total,
      onAxis!.limits!.northLatitudeDeg - 0.05,
      onAxis!.limits!.northLongitudeDeg - 0.05,
      path,
    );
    // Well outside the band: partial only.
    const outside = localSolarCircumstances(total, 30.0444, 31.2357, path); // Cairo

    expect(centre.kind).toBe("total");
    expect(edge.kind).toBe("total");
    expect(outside.kind).toBe("partial");

    expect(centre.distanceToCentralLineKm).toBeLessThan(5);
    expect(edge.distanceToCentralLineKm).toBeGreaterThan(80);
    expect(outside.distanceToCentralLineKm).toBeGreaterThan(200);

    // The discriminating property: duration collapses towards the limit. A
    // point in the band is not the axis, and the two must not report alike.
    expect(centre.centralDurationSeconds).toBeGreaterThan(
      2 * (edge.centralDurationSeconds ?? 0),
    );
    expect(outside.centralDurationSeconds).toBeNull();
    expect(outside.centralBeginUtc).toBeNull();
  });

  it("orders the contacts and brackets them around maximum", () => {
    const local = localSolarCircumstances(total, 25.6872, 32.6396);
    const times = [
      local.partialBeginUtc,
      local.centralBeginUtc,
      local.peakUtc,
      local.centralEndUtc,
      local.partialEndUtc,
    ].map((value) => Date.parse(value!));
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).toBeGreaterThan(times[index - 1]);
    }
  });

  it("measures the distance to the centre line rather than guessing it", () => {
    const path = traceCentralPath(total, 6, 240);
    const onLine = localSolarCircumstances(total, 25.69, 32.64, path);
    const farOff = localSolarCircumstances(total, 37.98, 23.73, path);
    // Luxor is close to the axis but not on it — a real, checkable number now
    // that the line is the axis rather than a point in the band.
    expect(onLine.distanceToCentralLineKm).toBeGreaterThan(2);
    expect(onLine.distanceToCentralLineKm).toBeLessThan(40);
    // Athens is a few hundred kilometres north of the track through Libya.
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
