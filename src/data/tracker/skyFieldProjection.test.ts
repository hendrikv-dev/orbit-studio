import { describe, expect, it } from "vitest";

import { projectSkyField } from "./skyFieldProjection";

describe("Sky field projection", () => {
  it("maps the documented horizontal and vertical half-fields to the display edges", () => {
    const horizontalEdge = projectSkyField(
      { azimuthDeg: 0, altitudeDeg: 0 },
      { azimuthDeg: 41, altitudeDeg: 0 },
    );
    expect(horizontalEdge.inField).toBe(true);
    expect(horizontalEdge.xPercent).toBeCloseTo(100, 10);
    expect(horizontalEdge.yPercent).toBeCloseTo(50, 10);
    const verticalEdge = projectSkyField(
      { azimuthDeg: 0, altitudeDeg: 0 },
      { azimuthDeg: 0, altitudeDeg: 33 },
    );
    expect(verticalEdge.inField).toBe(true);
    expect(verticalEdge.xPercent).toBeCloseTo(50, 10);
    expect(verticalEdge.yPercent).toBeCloseTo(0, 10);
  });

  it("uses perspective on the celestial sphere near the zenith and handles the north wrap", () => {
    const high = projectSkyField(
      { azimuthDeg: 0, altitudeDeg: 60 },
      { azimuthDeg: 82, altitudeDeg: 60 },
    );
    expect(high.xPercent).toBeCloseTo(86.2889546, 6);
    expect(high.inField).toBe(true);

    const wrapped = projectSkyField(
      { azimuthDeg: 350, altitudeDeg: 0 },
      { azimuthDeg: 10, altitudeDeg: 0 },
    );
    expect(wrapped.xPercent).toBeCloseTo(70.9349929, 6);
  });
});
