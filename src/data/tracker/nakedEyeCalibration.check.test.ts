import { describe, expect, it } from "vitest";
import { Body, Equator, Horizon, Illumination, MakeTime, Observer } from "astronomy-engine";
import { nakedEyeVerdict, skyConditionsAt, skyLimit } from "./nakedEye";

/**
 * The planets a person can obviously see must never be withheld.
 *
 * This is a calibration check rather than a unit test: it walks a year of real
 * nights at two real places and asserts that the five classical naked-eye
 * planets are admitted whenever they are reasonably placed. A rule that removes
 * Mars from "what can I see tonight" is worse than no rule at all, and the
 * failure mode of a magnitude threshold is that it creeps.
 */

const PLACES = [
  { name: "Portland", lat: 45.52, lon: -122.68 },
  { name: "Fairbanks", lat: 64.84, lon: -147.72 },
];

const PLANETS = [Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn, Body.Mercury];

function look(body: Body, lat: number, lon: number, at: Date) {
  const time = MakeTime(at);
  const observer = new Observer(lat, lon, 0);
  const equator = Equator(body, time, observer, true, true);
  const horizon = Horizon(time, observer, equator.ra, equator.dec, "normal");
  return { altitudeDeg: horizon.altitude, magnitude: Illumination(body, time).mag };
}

describe("the naked-eye rule against real nights", () => {
  it("admits every classical planet whenever it is well placed in a dark sky", () => {
    const withheld: string[] = [];
    let considered = 0;

    for (const place of PLACES) {
      for (let day = 0; day < 365; day += 7) {
        const at = new Date(Date.UTC(2027, 0, 1 + day, 8, 0, 0));
        const sky = skyConditionsAt(place.lat, place.lon, at.toISOString(), null);
        // Only nights that are actually dark: twilight is a real reason to
        // withhold and is not what this is checking.
        if (sky.sunAltitudeDeg > -18) continue;
        for (const body of PLANETS) {
          const seen = look(body, place.lat, place.lon, at);
          // Well placed: comfortably clear of the horizon murk.
          if (seen.altitudeDeg < 25) continue;
          considered += 1;
          const verdict = nakedEyeVerdict(
            { apparentMagnitude: seen.magnitude, altitudeDeg: seen.altitudeDeg },
            sky,
          );
          if (!verdict.visible) {
            withheld.push(
              `${place.name} ${at.toISOString().slice(0, 10)} ${String(body)} mag ${seen.magnitude.toFixed(1)} at ${seen.altitudeDeg.toFixed(0)}° — ${verdict.reason}`,
            );
          }
        }
      }
    }

    expect(considered).toBeGreaterThan(50);
    expect(withheld, withheld.slice(0, 5).join("; ")).toHaveLength(0);
  });

  /**
   * And the city does not remove them either.
   *
   * Downtown Portland measures 12.3 nW/cm²/sr, which costs about two and a half
   * magnitudes. The planets are all brighter than magnitude 2 at their worst,
   * so a rule that dropped them under city light would be badly wrong.
   */
  it("still admits them from a city centre", () => {
    const at = new Date(Date.UTC(2027, 6, 15, 8, 0, 0));
    const sky = skyConditionsAt(45.52, -122.68, at.toISOString(), 12.3);
    expect(skyLimit(sky).artificialLoss).toBeGreaterThan(2);
    for (const body of PLANETS) {
      const seen = look(body, 45.52, -122.68, at);
      if (seen.altitudeDeg < 25) continue;
      const verdict = nakedEyeVerdict(
        { apparentMagnitude: seen.magnitude, altitudeDeg: seen.altitudeDeg },
        sky,
      );
      expect(verdict.visible, `${String(body)} mag ${seen.magnitude.toFixed(1)}`).toBe(true);
    }
  });
});
