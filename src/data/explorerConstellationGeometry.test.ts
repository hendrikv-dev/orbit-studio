import { describe, expect, it } from "vitest";
import { createExplorerScenario, explorerSnapshots } from "./explorerCatalog";
import {
  circularAngleDistanceDeg,
  representativePlaneIndices,
  representativePlaneRaanDeg,
  resolveConstellationShellGeometries,
  shellLatitudeLimitDeg,
} from "./explorerConstellationGeometry";
import { explorerConstellationArchitectureFor } from "./explorerConstellationArchitecture";
import { representativeConstellationSatellites } from "./explorerVisibility";
import { EARTH_RADIUS_KM } from "../physics/constants";

const currentSnapshot = explorerSnapshots[explorerSnapshots.length - 1];

function constellationAndScenario(id: string) {
  const scenario = createExplorerScenario(currentSnapshot);
  return {
    scenario,
    constellation: scenario.constellations.find((item) => item.id === id)!,
  };
}

describe("Explorer constellation geometry fidelity", () => {
  it("keeps Starlink shell geometry aligned with its published definitions", () => {
    const { scenario, constellation } = constellationAndScenario(
      "explorer-starlink-constellation",
    );
    const geometries = resolveConstellationShellGeometries(
      constellation,
      scenario.satellites,
    );
    const latitudeLimits = geometries.map((geometry) =>
      shellLatitudeLimitDeg(geometry.inclinationDeg),
    );

    expect(geometries.map((geometry) => geometry.altitudeKm)).toEqual([550, 540, 570, 560]);
    expect(geometries.map((geometry) => geometry.inclinationDeg)).toEqual([53, 53.2, 70, 97.6]);
    expect(latitudeLimits.slice(0, 3).every((latitude) => latitude <= 70)).toBe(true);
    expect(latitudeLimits[3]).toBeCloseTo(82.4, 8);
    expect(
      geometries.every(
        (geometry) =>
          geometry.definition.geometrySource === "published-shell-definition",
      ),
    ).toBe(true);
    expect(
      geometries.reduce(
        (sum, geometry) => sum + geometry.validation.displayedMatchCount,
        0,
      ),
    ).toBe(0);
    expect(
      geometries.every(
        (geometry) =>
          geometry.validation.altitudeRangeKm === null &&
          geometry.validation.inclinationRangeDeg === null,
      ),
    ).toBe(true);

    const representatives = representativeConstellationSatellites(
      constellation,
      scenario.satellites,
    );
    expect(
      representatives
        .filter((satellite) => satellite.id.includes("starlink-53:"))
        .every((satellite) => satellite.keplerian.inclinationDeg === 53),
    ).toBe(true);
    expect(
      representatives
        .filter((satellite) => satellite.id.includes("starlink-53-2:"))
        .every((satellite) => satellite.keplerian.inclinationDeg === 53.2),
    ).toBe(true);
    expect(
      representatives.filter((satellite) => satellite.keplerian.inclinationDeg > 90),
    ).toHaveLength(2);
  });

  it("spaces derived planes using the real shell plane count", () => {
    const starlinkShell = explorerConstellationArchitectureFor(
      "explorer-starlink-constellation",
    )!.shells[0];
    const gpsShell = explorerConstellationArchitectureFor(
      "explorer-gps-constellation",
    )!.shells[0];
    const oneWebShell = explorerConstellationArchitectureFor(
      "explorer-oneweb-constellation",
    )!.shells[0];
    const iridiumShell = explorerConstellationArchitectureFor(
      "explorer-iridium-constellation",
    )!.shells[0];

    expect(representativePlaneIndices(starlinkShell)).toEqual([0, 36]);
    expect(representativePlaneRaanDeg(starlinkShell, 36)).toBe(180);
    expect(representativePlaneIndices(gpsShell)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(
      representativePlaneIndices(gpsShell).map((index) =>
        representativePlaneRaanDeg(gpsShell, index),
      ),
    ).toEqual([0, 60, 120, 180, 240, 300]);
    expect(
      representativePlaneIndices(oneWebShell).map((index) =>
        representativePlaneRaanDeg(oneWebShell, index),
      ),
    ).toEqual([8, 53, 98, 143]);
    expect(
      representativePlaneIndices(iridiumShell).map((index) =>
        representativePlaneRaanDeg(iridiumShell, index),
      ),
    ).toEqual([15, 45, 75, 105, 135, 165]);
  });

  it("uses a displayed GPS member while keeping OneWeb on its nominal definition", () => {
    const gps = constellationAndScenario("explorer-gps-constellation");
    const oneWeb = constellationAndScenario("explorer-oneweb-constellation");
    const gpsGeometry = resolveConstellationShellGeometries(
      gps.constellation,
      gps.scenario.satellites,
    )[0];
    const oneWebGeometry = resolveConstellationShellGeometries(
      oneWeb.constellation,
      oneWeb.scenario.satellites,
    )[0];
    const gpsRepresentatives = representativeConstellationSatellites(
      gps.constellation,
      gps.scenario.satellites,
    );

    expect(gpsGeometry.validation.displayedMatchCount).toBeGreaterThan(0);
    expect(gpsGeometry.altitudeKm).toBeGreaterThan(20_100);
    expect(gpsGeometry.altitudeKm).toBeLessThan(20_250);
    expect(gpsGeometry.inclinationDeg).toBeGreaterThan(53);
    expect(gpsGeometry.inclinationDeg).toBeLessThan(57);
    expect(gpsRepresentatives).toHaveLength(6);
    expect(
      gpsRepresentatives.every(
        (satellite) => satellite.keplerian.semiMajorAxisKm > EARTH_RADIUS_KM + 20_100,
      ),
    ).toBe(true);
    expect(
      gpsRepresentatives.every((satellite, index) =>
        circularAngleDistanceDeg(satellite.keplerian.raanDeg, index * 60) <= 31,
      ),
    ).toBe(true);

    expect(oneWebGeometry.validation.displayedMatchCount).toBe(0);
    expect(oneWebGeometry.altitudeKm).toBeGreaterThan(1_190);
    expect(oneWebGeometry.altitudeKm).toBeLessThan(1_230);
    expect(oneWebGeometry.inclinationDeg).toBeCloseTo(87.9, 1);
    expect(
      representativeConstellationSatellites(
        oneWeb.constellation,
        oneWeb.scenario.satellites,
      ).every((satellite) => satellite.keplerian.inclinationDeg > 87.8),
    ).toBe(true);
  });

  it("uses explicit nominal definitions independently of displayed members", () => {
    const galileo = constellationAndScenario("explorer-galileo-constellation");
    const iridium = constellationAndScenario("explorer-iridium-constellation");
    const galileoGeometry = resolveConstellationShellGeometries(
      galileo.constellation,
      galileo.scenario.satellites,
    )[0];
    const iridiumGeometry = resolveConstellationShellGeometries(
      iridium.constellation,
      iridium.scenario.satellites,
    )[0];

    expect(galileoGeometry.validation.displayedMatchCount).toBe(0);
    expect(galileoGeometry.altitudeKm).toBe(23_222);
    expect(galileoGeometry.inclinationDeg).toBe(56);
    expect(iridiumGeometry.validation.displayedMatchCount).toBe(0);
    expect(iridiumGeometry.altitudeKm).toBe(780);
    expect(iridiumGeometry.inclinationDeg).toBe(86.4);
  });
});
