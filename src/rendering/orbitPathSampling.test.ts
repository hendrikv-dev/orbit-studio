import { describe, expect, it } from "vitest";
import { createSatellite } from "../lib/scenario";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { tleToKeplerian, type TleData } from "../physics/tle";
import {
  normalizedOrbitPathSampleCount,
  propagatedThreePosition,
  samplePropagatedOrbitPath,
} from "./orbitPathSampling";

const VALLADO_VANGUARD_TLE: TleData = {
  name: "VANGUARD 1",
  line1: "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
  line2: "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667",
};

describe("orbit path sampling", () => {
  it("keeps an independently sourced SGP4 marker position on the sampled orbit path", () => {
    const centerDate = new Date("2000-06-29T12:50:19.000Z");
    const vanguard = createSatellite("Vanguard 1", centerDate, {
      id: "vallado-vanguard",
      propagationMode: "sgp4",
      editorMode: "tle",
      tle: VALLADO_VANGUARD_TLE,
      keplerian: tleToKeplerian(VALLADO_VANGUARD_TLE, centerDate),
    });
    const sampleCount = normalizedOrbitPathSampleCount(121);
    const path = samplePropagatedOrbitPath(vanguard, centerDate, sampleCount);
    const markerPosition = propagatedThreePosition(vanguard, centerDate);
    const centerSample = path[sampleCount / 2];

    expect(sampleCount % 2).toBe(0);
    expect(centerSample.distanceTo(markerPosition)).toBeLessThan(1e-9);
  });

  it("samples one complete propagated period around the selected playback date", () => {
    const epoch = new Date("2026-01-01T00:00:00.000Z");
    const satellite = createSatellite("LEO", epoch, {
      id: "leo",
      keplerian: {
        semiMajorAxisKm: EARTH_RADIUS_KM + 550,
        eccentricity: 0.001,
        inclinationDeg: 51.6,
        raanDeg: 30,
        argumentOfPeriapsisDeg: 12,
        trueAnomalyDeg: 48,
        epoch: epoch.toISOString(),
      },
    });
    const centerDate = new Date("2026-01-01T00:45:00.000Z");
    const sampleCount = 120;
    const path = samplePropagatedOrbitPath(satellite, centerDate, sampleCount);

    expect(path).toHaveLength(sampleCount + 1);
    expect(path[0].distanceTo(path[path.length - 1])).toBeLessThan(0.01);
    expect(path[sampleCount / 2].distanceTo(propagatedThreePosition(satellite, centerDate))).toBeLessThan(1e-9);
  });
});
