import { describe, expect, it } from "vitest";
import { createDefaultScenario, createPlaygroundScenario, normalizeImportedScenario } from "./scenario";

describe("foundation scenario schema", () => {
  it("persists camera, station, sensor, and catalog layer fields", () => {
    const scenario = createDefaultScenario(new Date("2026-06-01T00:00:00.000Z"));
    scenario.cameraSettings.cameraMode = "earth-fixed";
    scenario.cameraSettings.followSelectedObject = false;
    scenario.satellites[0].sensor.halfAngleDeg = 24;
    scenario.groundStations[0].minimumElevationDeg = 12;
    scenario.catalogLayers[0].loaded = true;

    const imported = normalizeImportedScenario(JSON.parse(JSON.stringify(scenario)));

    expect(imported.cameraSettings.cameraMode).toBe("earth-fixed");
    expect(imported.cameraSettings.followSelectedObject).toBe(false);
    expect(imported.renderSettings.showLatLonGrid).toBe(true);
    expect(imported.renderSettings.showCoverageLayer).toBe(true);
    expect(imported.satellites[0].sensor.halfAngleDeg).toBe(24);
    expect(imported.satellites[0].constellationId).toBe("demo-constellation");
    expect(imported.constellations[0].satelliteIds).toContain(imported.satellites[0].id);
    expect(imported.groundStations[0].minimumElevationDeg).toBe(12);
    expect(imported.regions.length).toBeGreaterThan(0);
    expect(imported.catalogLayers[0].loaded).toBe(true);
    expect(imported.catalogLayers[0].fullCatalogAvailable).toBe(false);
    expect(imported.catalogLayers[0].historicalCatalogAvailable).toBe(false);
    expect(imported.teacherMode).toBe(false);
    expect(imported.coverageSettings.targetType).toBe("satellite");
  });

  it("preserves an explicit no-selection scenario state", () => {
    const scenario = createDefaultScenario(new Date("2026-06-01T00:00:00.000Z"));
    scenario.selectedObjectType = "none";
    scenario.selectedObjectId = null;

    const imported = normalizeImportedScenario(JSON.parse(JSON.stringify(scenario)));

    expect(imported.selectedObjectType).toBe("none");
    expect(imported.selectedObjectId).toBeNull();
  });

  it("starts Playground at an immediately readable educational speed", () => {
    expect(createPlaygroundScenario(new Date("2026-06-01T00:00:00.000Z")).timeScale).toBe(1_250);
  });

  it("starts Playground with a neutral authored satellite rather than a catalog object", () => {
    const scenario = createPlaygroundScenario(new Date("2026-06-01T00:00:00.000Z"));

    expect(scenario.satellites).toHaveLength(1);
    expect(scenario.satellites[0].name).toBe("Satellite 1");
    expect(scenario.satellites[0].catalogMetadata).toBeUndefined();
  });
});
