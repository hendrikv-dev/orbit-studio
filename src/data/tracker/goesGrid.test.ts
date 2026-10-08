import { describe, expect, it } from "vitest";

import {
  categoryOf,
  cellFor,
  placeOf,
  probabilityOf,
  qualityOf,
  type FixedGrid,
} from "./goesGrid";

/**
 * The real CONUS grid from a GOES-East granule, read out of its own metadata.
 *
 * `goes_imager_projection` gives the ellipsoid and the sub-satellite longitude;
 * `x` and `y` give the scan angle of the first cell and the step between them.
 * Nothing here is a remembered constant.
 */
const GOES_EAST_CONUS: FixedGrid = {
  originLongitudeDeg: -75,
  perspectiveHeightM: 35786023,
  semiMajorM: 6378137,
  semiMinorM: 6356752.31414,
  xOffsetRad: -0.10133200138807297,
  xScaleRad: 5.6000000768108293e-5,
  yOffsetRad: 0.12821200489997864,
  yScaleRad: -5.6000000768108293e-5,
  columns: 2500,
  rows: 1500,
};

describe("finding the pixel over a place", () => {
  it("round-trips a place through the grid and back", () => {
    for (const [latitude, longitude] of [
      [45.5152, -122.6784], // Portland
      [40.7128, -74.006], // New York
      [29.7604, -95.3698], // Houston
      [47.6062, -122.3321], // Seattle
    ] as const) {
      const cell = cellFor(GOES_EAST_CONUS, latitude, longitude);
      expect(cell, `${latitude},${longitude}`).not.toBeNull();
      const back = placeOf(GOES_EAST_CONUS, cell!);
      expect(back).not.toBeNull();
      /**
       * Within a pixel, which is the whole claim.
       *
       * The grid is 2 km at nadir and coarser towards the limb, so a round trip
       * lands inside the cell it started in rather than back on the exact
       * coordinate. Anything larger than a few hundredths of a degree would
       * mean the geolocation is wrong rather than quantised.
       */
      expect(Math.abs(back!.latitudeDeg - latitude)).toBeLessThan(0.05);
      expect(Math.abs(back!.longitudeDeg - longitude)).toBeLessThan(0.05);
    }
  });

  it("puts neighbouring places in neighbouring cells, in the right direction", () => {
    const here = cellFor(GOES_EAST_CONUS, 45.5, -122.7)!;
    const east = cellFor(GOES_EAST_CONUS, 45.5, -122.2)!;
    const north = cellFor(GOES_EAST_CONUS, 46.0, -122.7)!;
    // Columns increase eastward and rows increase southward, which is what the
    // negative y scale in the file says.
    expect(east.column).toBeGreaterThan(here.column);
    expect(north.row).toBeLessThan(here.row);
  });

  /**
   * A geostationary satellite sees a disc, and the arithmetic does not know
   * that on its own: without the visibility test it returns a perfectly
   * plausible pixel for somewhere on the far side of the Earth.
   */
  it("returns nothing for a place the spacecraft cannot see", () => {
    expect(cellFor(GOES_EAST_CONUS, 35, 139)).toBeNull(); // Tokyo
    expect(cellFor(GOES_EAST_CONUS, -33.9, 151.2)).toBeNull(); // Sydney
  });

  it("returns nothing for a place outside this scene's own window", () => {
    // The CONUS scene is a window on the full disc: Buenos Aires is in view of
    // the spacecraft and is not in this file.
    expect(cellFor(GOES_EAST_CONUS, -34.6, -58.4)).toBeNull();
  });
});

describe("what the numbers mean", () => {
  it("names the four levels in the product's own order", () => {
    expect(categoryOf(0)).toBe("clear");
    expect(categoryOf(1)).toBe("probably_clear");
    expect(categoryOf(2)).toBe("probably_cloudy");
    expect(categoryOf(3)).toBe("cloudy");
    // 255 is the fill value, and a fill is not a category.
    expect(categoryOf(255)).toBeNull();
    expect(categoryOf(null)).toBeNull();
  });

  /**
   * Space is not clear sky.
   *
   * `space_qf` is the pixel looking past the limb of the Earth. Treating
   * anything that is not explicitly bad as usable would paint the ocean beyond
   * the horizon a confident clear.
   */
  it("only trusts good and degraded quality", () => {
    expect(qualityOf(0)).toBe("good");
    expect(qualityOf(6)).toBe("degraded");
    expect(qualityOf(1)).toBe("unusable");
    expect(qualityOf(2)).toBe("unusable");
    expect(qualityOf(undefined)).toBe("unusable");
  });

  it("scales the probability and refuses its fill value", () => {
    const scale = 1.5261e-5;
    // 0xf458, which is what a cloudy pixel measured in a real granule.
    expect(probabilityOf(62552, scale)).toBeCloseTo(0.954, 2);
    expect(probabilityOf(0, scale)).toBe(0);
    expect(probabilityOf(65535, scale)).toBeNull();
    expect(probabilityOf(null, scale)).toBeNull();
  });
});
