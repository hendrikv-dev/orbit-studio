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

  it("contracts azimuth toward the zenith and handles the north wrap", () => {
    const high = projectSkyField(
      { azimuthDeg: 0, altitudeDeg: 60 },
      { azimuthDeg: 82, altitudeDeg: 60 },
    );
    expect(high.xPercent).toBeCloseTo(100, 8);

    const wrapped = projectSkyField(
      { azimuthDeg: 350, altitudeDeg: 0 },
      { azimuthDeg: 10, altitudeDeg: 0 },
    );
    expect(wrapped.xPercent).toBeCloseTo(74.3902439, 6);
  });
});
