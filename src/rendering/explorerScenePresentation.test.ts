import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  createExplorerScenario,
  currentExplorerSnapshot,
  getHistoricalCatalog,
} from "../data/explorerCatalog";
import {
  CATALOG_ONLY_EARTH_FRAMING_RADIUS_KM,
  createCatalogOnlyEarthFocusFrame,
  isCatalogOnlyExplorerScene,
} from "./explorerScenePresentation";

describe("Explorer scene presentation", () => {
  it("uses Earth-focused framing for historical catalog-only snapshots", () => {
    const catalogOnly = isCatalogOnlyExplorerScene({
      scaleCatalogRendering: true,
      satelliteCount: 0,
    });
    const frame = createCatalogOnlyEarthFocusFrame({
      simulationEpoch: "2022-01-01T12:00:00.000Z",
      focusPreset: "earth-orbit",
      requestKey: 0,
      viewDirection: new Vector3(0.62, 0.42, 0.66),
    });

    expect(catalogOnly).toBe(true);
    expect(frame.target.length()).toBe(0);
    expect(frame.framingRadiusKm).toBe(CATALOG_ONLY_EARTH_FRAMING_RADIUS_KM);
    expect(frame.framingRadiusKm).toBeGreaterThan(EARTH_RADIUS_KM);
    expect(frame.framingRadiusKm).toBeLessThan(EARTH_RADIUS_KM * 1.5);
  });

  it("renders constrained reconstructions while keeping current GP records out", () => {
    const historical = getHistoricalCatalog("2020-06-01T12:00:00.000Z");
    const scenario = createExplorerScenario(historical.snapshot);

    expect(historical.records.length).toBeGreaterThan(1_500);
    expect(historical.renderableOrbitStateCount).toBeGreaterThan(1_500);
    expect(historical.dataCoverage.reconstructedHistoricalOrbitStateCount)
      .toBe(historical.renderableOrbitStateCount);
    expect(historical.dataCoverage.catalogOnlyObjectCount).toBeGreaterThan(0);
    expect(scenario.satellites).toHaveLength(historical.renderableOrbitStateCount);
    expect(scenario.satellites.some((satellite) =>
      satellite.catalogMetadata?.sourceId === "celestrak-gp-snapshot",
    )).toBe(false);
  });

  it("keeps the latest public Explorer scene dense without bundling current GP records", () => {
    const scenario = createExplorerScenario(currentExplorerSnapshot);

    expect(scenario.satellites).toHaveLength(33_474);
    expect(isCatalogOnlyExplorerScene({
      scaleCatalogRendering: true,
      satelliteCount: scenario.satellites.length,
    })).toBe(false);
    const gcatSatellites = scenario.satellites.filter(
      (satellite) => satellite.catalogMetadata?.sourceId === "gcat-public-catalog",
    );
    const curatedReferences = scenario.satellites.filter(
      (satellite) => satellite.catalogMetadata?.sourceId === "curated-reference",
    );
    expect(gcatSatellites).toHaveLength(33_468);
    expect(gcatSatellites.every((satellite) =>
      satellite.catalogMetadata?.orbitStateProvenance === "reconstructed-historical",
    )).toBe(true);
    expect(curatedReferences).toHaveLength(6);
    expect(curatedReferences.every((satellite) =>
      satellite.catalogMetadata?.orbitStateProvenance === "curated-reference",
    )).toBe(true);
    expect(scenario.satellites.every((satellite) => satellite.tle === undefined)).toBe(true);
  });
});
