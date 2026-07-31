import { describe, expect, it } from "vitest";
import { isRenderableCartesianState } from "./propagation";

describe("renderable propagation state validation", () => {
  it("accepts finite propagated states", () => {
    expect(
      isRenderableCartesianState({
        epoch: "2026-06-01T12:00:00.000Z",
        positionKm: [6_800, 120, -42],
        velocityKmS: [0.2, 7.6, 0.1],
      }),
    ).toBe(true);
  });

  it("rejects NaN, zero-motion, and invalid-epoch states before rendering", () => {
    expect(
      isRenderableCartesianState({
        epoch: "2026-06-01T12:00:00.000Z",
        positionKm: [Number.NaN, 120, -42],
        velocityKmS: [0.2, 7.6, 0.1],
      }),
    ).toBe(false);
    expect(
      isRenderableCartesianState({
        epoch: "2026-06-01T12:00:00.000Z",
        positionKm: [6_800, 120, -42],
        velocityKmS: [0, 0, 0],
      }),
    ).toBe(false);
    expect(
      isRenderableCartesianState({
        epoch: "invalid-date",
        positionKm: [6_800, 120, -42],
        velocityKmS: [0.2, 7.6, 0.1],
      }),
    ).toBe(false);
  });
});
