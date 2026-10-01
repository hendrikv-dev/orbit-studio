import { describe, expect, it } from "vitest";

import { projectSkyField } from "./skyFieldProjection";

describe("Sky field projection", () => {
  it("maps the documented horizontal and vertical half-fields to the display edges", () => {
    expect(projectSkyField(
      { azimuthDeg: 0, altitudeDeg: 0 },
      { azimuthDeg: 41, altitudeDeg: 0 },
    )).toEqual(expect.objectContaining({ xPercent: 100, yPercent: 50, inField: true }));
    expect(projectSkyField(
      { azimuthDeg: 0, altitudeDeg: 0 },
      { azimuthDeg: 0, altitudeDeg: 33 },
    )).toEqual(expect.objectContaining({ xPercent: 50, yPercent: 0, inField: true }));
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
