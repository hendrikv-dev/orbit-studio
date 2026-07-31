import { describe, expect, it } from "vitest";
import { tleToCartesian, type TleData } from "../physics/tle";
import { writeInterpolatedThreePositions } from "./catalogMotion";
import {
  CATALOG_PROPAGATION_WINDOW_MS,
  catalogPropagationWindowBounds,
} from "./catalogPropagation";

const VALLADO_VANGUARD_TLE: TleData = {
  name: "VANGUARD 1",
  line1: "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
  line2: "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667",
};

describe("catalog motion", () => {
  it("maps ECI samples into the canonical right-handed Three.js axes without allocating vectors", () => {
    const target = new Float32Array(9);
    writeInterpolatedThreePositions(
      target,
      1,
      new Float32Array([10, 20, 30]),
      new Float32Array([1, 2, 3]),
      new Float32Array([20, 40, 60]),
      new Float32Array([1, 2, 3]),
      new Uint8Array([1]),
      0,
      10_000,
      5_000,
    );

    expect([...target]).toEqual([0, 0, 0, 15, 45, -30, 0, 0, 0]);
  });

  it("stays close to exact SGP4 across the speed-independent UTC window", () => {
    const sampleDate = new Date("2000-06-29T12:50:19.000Z");
    const interpolationWindowSeconds = CATALOG_PROPAGATION_WINDOW_MS / 1_000;
    const elapsedSeconds = interpolationWindowSeconds / 2;
    const start = tleToCartesian(VALLADO_VANGUARD_TLE, sampleDate);
    const end = tleToCartesian(
      VALLADO_VANGUARD_TLE,
      new Date(sampleDate.getTime() + interpolationWindowSeconds * 1000),
    );
    const exact = tleToCartesian(
      VALLADO_VANGUARD_TLE,
      new Date(sampleDate.getTime() + elapsedSeconds * 1000),
    );
    const predicted = new Float32Array(3);

    writeInterpolatedThreePositions(
      predicted,
      0,
      new Float32Array(start.positionKm),
      new Float32Array(start.velocityKmS),
      new Float32Array(end.positionKm),
      new Float32Array(end.velocityKmS),
      new Uint8Array([1]),
      sampleDate.getTime(),
      sampleDate.getTime() + interpolationWindowSeconds * 1000,
      sampleDate.getTime() + elapsedSeconds * 1000,
    );

    const errorKm = Math.hypot(
      predicted[0] - exact.positionKm[0],
      predicted[2] + exact.positionKm[1],
      predicted[1] - exact.positionKm[2],
    );
    expect(errorKm).toBeLessThan(0.06);
  });

  it("selects the same propagation window regardless of playback speed", () => {
    const timestampMs = Date.parse("1969-07-16T13:32:17.345Z");
    const windows = [1, 10, 100, 1_000, 2_500].map(() =>
      catalogPropagationWindowBounds(timestampMs),
    );
    expect(new Set(windows.map((window) => JSON.stringify(window))).size).toBe(1);
    expect(windows[0].endTimestampMs - windows[0].startTimestampMs)
      .toBe(CATALOG_PROPAGATION_WINDOW_MS);
  });

  it("omits unsupported samples instead of leaving an old physical position visible", () => {
    const target = new Float32Array([7, 8, 9]);
    const scales = new Float32Array([0.8]);
    const written = writeInterpolatedThreePositions(
      target,
      0,
      new Float32Array([1, 2, 3]),
      new Float32Array([0, 0, 0]),
      new Float32Array([4, 5, 6]),
      new Float32Array([0, 0, 0]),
      new Uint8Array([0]),
      0,
      1_000,
      500,
      scales,
      new Float32Array([0.8]),
    );

    expect(written).toBe(0);
    expect(scales[0]).toBe(0);
    expect([...target]).toEqual([7, 8, 9]);
  });
});
