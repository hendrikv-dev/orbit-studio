import { describe, expect, it } from "vitest";
import type { CoverageSettings, GroundStationModel, RegionModel } from "../lib/scenario";
import { computeRegionCoverage, targetSetForCoverage } from "./regionCoverage";

const settings: CoverageSettings = {
  enabled: true,
  targetType: "ground-station",
  targetId: "station-1",
  showFutureVisibility: false,
  lookAheadMinutes: 60,
};

const station: GroundStationModel = {
  id: "station-1",
  name: "Test Station",
  latitudeDeg: 45,
  longitudeDeg: -122,
  altitudeMeters: 0,
  minimumElevationDeg: 10,
  antennaRangeKm: null,
  bands: [],
  color: "#67e8f9",
  visible: true,
  showCoverageCone: true,
  showHorizonCircle: true,
};

describe("region coverage", () => {
  it("marks a nearby circular region visible from a ground station", () => {
    const region: RegionModel = {
      id: "portland",
      name: "Portland",
      type: "city",
      boundary: {
        kind: "circle",
        centerLatitudeDeg: 45.5,
        centerLongitudeDeg: -122.7,
        radiusDeg: 0.5,
      },
      color: "#67e8f9",
      visible: true,
      showLabel: true,
    };

    const target = targetSetForCoverage(settings, [], [station]);
    const coverage = computeRegionCoverage(region, target, settings, new Date("2026-06-02T00:00:00Z"));

    expect(coverage.visibleNow).toBe(true);
    expect(coverage.coveredPercent).toBeGreaterThan(50);
  });

  it("marks a distant region uncovered from the same station", () => {
    const region: RegionModel = {
      id: "antipode",
      name: "Opposite Hemisphere",
      type: "city",
      boundary: {
        kind: "circle",
        centerLatitudeDeg: -45,
        centerLongitudeDeg: 58,
        radiusDeg: 0.5,
      },
      color: "#a78bfa",
      visible: true,
      showLabel: true,
    };

    const target = targetSetForCoverage(settings, [], [station]);
    const coverage = computeRegionCoverage(region, target, settings, new Date("2026-06-02T00:00:00Z"));

    expect(coverage.visibleNow).toBe(false);
    expect(coverage.coveredPercent).toBe(0);
  });
});
