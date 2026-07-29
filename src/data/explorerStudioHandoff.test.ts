import { describe, expect, it } from "vitest";
import { createExplorerScenario, explorerSnapshots } from "./explorerCatalog";
import { createStudioScenarioFromExplorerSelection } from "./explorerStudioHandoff";

describe("Explorer Studio handoff", () => {
  it("opens a clean Playground without catalog context when there is no selection", () => {
    const explorer = createExplorerScenario(explorerSnapshots[explorerSnapshots.length - 1]);
    const studio = createStudioScenarioFromExplorerSelection(explorer);

    expect(explorer.selectedObjectId).toBeNull();
    expect(studio.name).toBe("Playground");
    expect(studio.satellites).toHaveLength(1);
    expect(studio.constellations).toHaveLength(0);
    expect(studio.groundStations).toHaveLength(0);
    expect(studio.regions).toHaveLength(0);
    expect(studio.catalogLayers).toHaveLength(0);
    expect(studio.selectedObjectType).toBe("satellite");
    expect(studio.selectedObjectId).toBe(studio.satellites[0].id);
    expect(studio.renderSettings.showCoverageLayer).toBe(false);
    expect(studio.satellites[0].visualization.showGroundTrack).toBe(true);
  });

  it("opens a selected satellite as a single editable Playground orbit", () => {
    const explorer = createExplorerScenario(explorerSnapshots[explorerSnapshots.length - 1]);
    const selected = explorer.satellites.find(
      (satellite) => satellite.id === "explorer-iss",
    )!;
    const studio = createStudioScenarioFromExplorerSelection({
      ...explorer,
      selectedObjectType: "satellite",
      selectedObjectId: selected.id,
    });

    expect(explorer.satellites.length).toBeGreaterThan(5);
    expect(studio.satellites).toHaveLength(1);
    expect(studio.satellites[0].id).toBe(selected.id);
    expect(studio.satellites[0].editorMode).toBe("keplerian");
    expect(studio.satellites[0].visualization.showTrail).toBe(true);
    expect(studio.satellites[0].visualization.showGroundTrack).toBe(true);
    expect(studio.satellites[0].constellationId).toBeNull();
    expect(studio.satellites[0].catalogMetadata).toBeUndefined();
  });

  it("uses the clean Playground for non-satellite Explorer selections", () => {
    const explorer = createExplorerScenario(explorerSnapshots[explorerSnapshots.length - 1]);
    const constellation = explorer.constellations.find(
      (item) => item.id === "explorer-starlink-constellation",
    )!;
    const studio = createStudioScenarioFromExplorerSelection({
      ...explorer,
      selectedObjectType: "constellation",
      selectedObjectId: constellation.id,
    });

    expect(studio.satellites).toHaveLength(1);
    expect(studio.satellites[0].name).toBe("Satellite 1");
    expect(studio.selectedObjectType).toBe("satellite");
    expect(studio.selectedObjectId).toBe(studio.satellites[0].id);
    expect(studio.constellations).toHaveLength(0);
    expect(studio.catalogLayers).toHaveLength(0);
  });
});
