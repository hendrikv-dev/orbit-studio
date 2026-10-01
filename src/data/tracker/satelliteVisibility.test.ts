import { describe, expect, it } from "vitest";
import * as satellite from "satellite.js";

import {
  apparentMagnitude,
  magnitudeFor,
  illuminationOf,
  passesFor,
  stateAt,
  sunEcef,
} from "./satelliteVisibility";
import type { SkyConditions } from "./nakedEye";

/**
 * A station-like orbit, constructed here rather than acquired.
 *
 * Four hundred and seventeen kilometres up at 51.64°, which is the shape of the
 * orbit the Space Station is in, and chosen so it makes a high sunlit pass over
 * Portland in the pinned window. It is not a snapshot of anybody's catalogue:
 * CelesTrak's usage policy covers retrieving their data, and this repository's
 * own provenance review found no grant for committing or redistributing it, so
 * the fixtures are Orbit Studio's own elements rather than a copy of theirs.
 */
const ISS = satellite.twoline2satrec(
  "1 99001U 26900A   26245.50000000  .00000000  00000+0  00000+0 0  9998",
  "2 99001  51.6400   6.0000 0005000  90.0000 298.0000 15.49000000000016",
);

const PORTLAND = { latitudeDeg: 45.5152, longitudeDeg: -122.6784 };

/** A dark, moonless, unlit sky, so a test is about the satellite and not the site. */
const DARK: SkyConditions = {
  sunAltitudeDeg: -20,
  moonAltitudeDeg: -30,
  moonIlluminatedFraction: 0,
  artificialLightRadiance: null,
};

describe("apparentMagnitude", () => {
  it("returns the standard magnitude at the geometry that defines it", () => {
    // A thousand kilometres, half lit, which is a phase angle of ninety degrees.
    expect(apparentMagnitude(-2.5, 1000, 90)).toBeCloseTo(-2.5, 3);
    expect(apparentMagnitude(4.58, 1000, 90)).toBeCloseTo(4.58, 3);
  });

  it("follows the inverse-square law with range", () => {
    const near = apparentMagnitude(-2.5, 500, 90)!;
    const far = apparentMagnitude(-2.5, 1000, 90)!;
    // Twice as far is four times fainter, which is 1.505 magnitudes.
    expect(far - near).toBeCloseTo(2.5 * Math.log10(4), 3);
  });

  it("is brighter when more of the lit face is turned towards you", () => {
    const gibbous = apparentMagnitude(-2.5, 1000, 30)!;
    const half = apparentMagnitude(-2.5, 1000, 90)!;
    const crescent = apparentMagnitude(-2.5, 1000, 150)!;
    expect(gibbous).toBeLessThan(half);
    expect(half).toBeLessThan(crescent);
  });

  it("reports nothing rather than a number when no lit face is turned towards you", () => {
    expect(apparentMagnitude(-2.5, 1000, 180)).toBeNull();
  });
});

describe("a population mean is not a standard magnitude", () => {
  /**
   * Mallama's distance-adjusted means have range normalised out and phase left
   * in. Running them through the standard-magnitude relation would apply a
   * phase term the number already contains, and the error runs the wrong way:
   * at a small phase angle it makes a train look brighter than it was measured.
   */
  it("scales a distance-adjusted mean by range and leaves phase alone", () => {
    const near = magnitudeFor({ kind: "distance-adjusted", magnitudeAt1000Km: 4.58 }, 500, 20)!;
    const far = magnitudeFor({ kind: "distance-adjusted", magnitudeAt1000Km: 4.58 }, 1000, 20)!;
    expect(far).toBeCloseTo(4.58, 6);
    expect(far - near).toBeCloseTo(5 * Math.log10(2), 6);
  });

  it("gives the same answer at every phase angle, which a standard magnitude does not", () => {
    const adjusted = { kind: "distance-adjusted" as const, magnitudeAt1000Km: 4.58 };
    expect(magnitudeFor(adjusted, 400, 20)).toBeCloseTo(magnitudeFor(adjusted, 400, 140)!, 6);

    const standard = { kind: "standard" as const, standardMagnitude: 4.58 };
    expect(magnitudeFor(standard, 400, 20)).not.toBeCloseTo(magnitudeFor(standard, 400, 140)!, 1);
  });
});

describe("the Earth's shadow", () => {
  const sun = { unit: [1, 0, 0] as [number, number, number], distanceKm: 149_597_870.7 };

  it("puts a spacecraft on the sunward side in daylight", () => {
    expect(illuminationOf([7000, 0, 0], sun)).toBe("sunlit");
  });

  it("puts one directly behind the Earth in the umbra", () => {
    expect(illuminationOf([-7000, 0, 0], sun)).toBe("umbra");
  });

  it("finds the penumbra between the two", () => {
    // Just outside the umbra at this distance behind the Earth, and well inside
    // the partial shadow.
    expect(illuminationOf([-7000, 6470, 0], sun)).toBe("penumbra");
  });

  it("leaves a spacecraft clear of the shadow in sunlight", () => {
    expect(illuminationOf([-7000, 6600, 0], sun)).toBe("sunlit");
  });

  /**
   * The shadow is a cone, not a cylinder.
   *
   * Far enough behind the Earth the full shadow closes to nothing; a cylinder
   * would keep it the same width for ever and hold a satellite dark hundreds of
   * kilometres past where the Sun has come back.
   */
  it("narrows the umbra with distance behind the Earth", () => {
    expect(illuminationOf([-7000, 6300, 0], sun)).toBe("umbra");
    expect(illuminationOf([-40000, 6300, 0], sun)).not.toBe("umbra");
  });
});

describe("the Sun in the orbit's own frame", () => {
  it("puts the Sun over the tropic of Cancer at the June solstice", () => {
    const { unit } = sunEcef(new Date("2026-06-21T09:00:00Z"));
    const declination = (Math.asin(unit[2]) * 180) / Math.PI;
    expect(declination).toBeGreaterThan(23.2);
    expect(declination).toBeLessThan(23.6);
  });

  it("and over the tropic of Capricorn at the December one", () => {
    const { unit } = sunEcef(new Date("2026-12-21T15:00:00Z"));
    const declination = (Math.asin(unit[2]) * 180) / Math.PI;
    expect(declination).toBeLessThan(-23.2);
    expect(declination).toBeGreaterThan(-23.6);
  });

  /**
   * Noon UTC puts the Sun over the Greenwich meridian.
   *
   * The check that the frame rotation is right: get the sidereal term wrong and
   * the sub-solar point lands at the wrong longitude, which quietly moves every
   * shadow entry and exit by hours.
   */
  it("puts the Sun near the Greenwich meridian at noon UTC", () => {
    const { unit } = sunEcef(new Date("2026-03-21T12:00:00Z"));
    const longitude = (Math.atan2(unit[1], unit[0]) * 180) / Math.PI;
    expect(Math.abs(longitude)).toBeLessThan(4);
  });
});

describe("a station-like orbit over one place", () => {
  const window = { startUtc: "2026-09-02T04:00:00Z", endUtc: "2026-09-03T04:00:00Z" };

  it("stays in the orbit it is actually in", () => {
    const state = stateAt(ISS, PORTLAND, new Date("2026-09-02T12:00:00Z"));
    expect(state).not.toBeNull();
    expect(state!.heightKm).toBeGreaterThan(370);
    expect(state!.heightKm).toBeLessThan(440);
  });

  it("comes over several times a day", () => {
    const passes = passesFor(() => ISS, { kind: "standard", standardMagnitude: -2.5 }, PORTLAND, { ...window, skyAt: () => DARK });
    // Sixteen orbits a day, of which a handful reach ten degrees from any one
    // place. Fewer than two would mean the propagation is wrong, more than a
    // dozen would mean passes are being split.
    expect(passes.length).toBeGreaterThanOrEqual(2);
    expect(passes.length).toBeLessThanOrEqual(12);
  });

  it("gives each pass a beginning, a best moment and an end, in order", () => {
    const passes = passesFor(() => ISS, { kind: "standard", standardMagnitude: -2.5 }, PORTLAND, { ...window, skyAt: () => DARK });
    for (const pass of passes) {
      expect(Date.parse(pass.startUtc)).toBeLessThanOrEqual(Date.parse(pass.bestUtc));
      expect(Date.parse(pass.bestUtc)).toBeLessThanOrEqual(Date.parse(pass.endUtc));
      expect(pass.peakAltitudeDeg).toBeGreaterThanOrEqual(10);
    }
  });

  /**
   * Being up is not being visible, and this is the case that proves it.
   *
   * In the middle of the night the ISS is in the Earth's shadow for most of its
   * pass: geometrically overhead, and nothing to see. A model that admitted
   * passes on altitude alone would recommend them.
   */
  it("finds passes that are geometrically fine and completely dark", () => {
    // A stretch containing several passes that never leave the Earth's shadow:
    // overhead, in a black sky, and nothing whatever to see.
    const passes = passesFor(
      () => ISS,
      { kind: "standard", standardMagnitude: -2.5 },
      PORTLAND,
      { startUtc: "2026-09-06T00:00:00Z", endUtc: "2026-09-10T00:00:00Z", skyAt: () => DARK },
    );
    const shadowed = passes.filter((pass) =>
      pass.samples.every((sample) => sample.illumination !== "sunlit"),
    );
    expect(shadowed.length).toBeGreaterThan(0);
    for (const pass of shadowed) {
      expect(pass.visible).toBe(false);
      expect(pass.brightestMagnitude).toBeNull();
    }
  });

  /**
   * The invariant behind that case, which holds whatever the window contains.
   *
   * Brightness is reflected sunlight, so a pass with no sunlit moment has no
   * brightness — not a faint one. Stated as a property rather than as a search
   * for an example, because the example depends on which nights are in the
   * window and the rule does not.
   */
  it("never admits a pass without a sunlit moment in it", () => {
    const passes = passesFor(
      () => ISS,
      { kind: "standard", standardMagnitude: -2.5 },
      PORTLAND,
      { startUtc: "2026-09-02T12:00:00Z", endUtc: "2026-09-10T00:00:00Z", skyAt: () => DARK },
    );
    expect(passes.length).toBeGreaterThan(10);
    for (const pass of passes) {
      const anyLit = pass.samples.some((sample) => sample.illumination === "sunlit");
      if (!anyLit) {
        expect(pass.visible).toBe(false);
        expect(pass.brightestMagnitude).toBeNull();
      }
      if (pass.visible) expect(anyLit).toBe(true);
    }
  });

  it("and passes that are lit, and says how bright", () => {
    const passes = passesFor(() => ISS, { kind: "standard", standardMagnitude: -2.5 }, PORTLAND, { ...window, skyAt: () => DARK });
    const lit = passes.filter((pass) => pass.samples.some((s) => s.illumination === "sunlit"));
    expect(lit.length).toBeGreaterThan(0);
    for (const pass of lit) {
      expect(pass.brightestMagnitude).not.toBeNull();
      // The ISS is never fainter than the brightest stars on a pass that
      // clears ten degrees in full sunlight, and never brighter than Venus.
      expect(pass.brightestMagnitude!).toBeGreaterThan(-6);
      expect(pass.brightestMagnitude!).toBeLessThan(2);
    }
  });

  it("withholds a pass whose margin is inside the uncertainty it was given", () => {
    const generous = passesFor(() => ISS, { kind: "standard", standardMagnitude: -2.5 }, PORTLAND, { ...window, skyAt: () => DARK });
    const admitted = generous.filter((pass) => pass.visible).length;
    expect(admitted).toBeGreaterThan(0);

    /**
     * The same passes, with an uncertainty margin wider than the ISS is bright.
     *
     * Nothing about the sky or the orbit changed; only how much room the
     * prediction is required to leave. That is the withholding rule, and it has
     * to be able to reach every pass or it is not a rule.
     */
    const cautious = passesFor(() => ISS, { kind: "standard", standardMagnitude: -2.5 }, PORTLAND, {
      ...window,
      skyAt: () => DARK,
      uncertaintyMargin: 40,
    });
    expect(cautious.filter((pass) => pass.visible).length).toBe(0);
  });

  it("says nothing about brightness for a spacecraft with no measured magnitude", () => {
    const passes = passesFor(() => ISS, null, PORTLAND, { ...window, skyAt: () => DARK });
    expect(passes.length).toBeGreaterThan(0);
    for (const pass of passes) {
      expect(pass.brightestMagnitude).toBeNull();
      // No magnitude is not a dim magnitude: nothing is admitted on geometry.
      expect(pass.visible).toBe(false);
    }
  });

  /**
   * A daylit sky takes the pass away, and the same model does it.
   *
   * The ISS is magnitude −3 in broad daylight too. What changes is the sky it
   * is seen against, which is `nakedEye`'s limiting magnitude and not a second
   * rule invented here.
   */
  it("does not offer a pass in a daylit sky", () => {
    const daylight: SkyConditions = { ...DARK, sunAltitudeDeg: 20 };
    const passes = passesFor(() => ISS, { kind: "standard", standardMagnitude: -2.5 }, PORTLAND, { ...window, skyAt: () => daylight });
    expect(passes.some((pass) => pass.visible)).toBe(false);
  });
});
