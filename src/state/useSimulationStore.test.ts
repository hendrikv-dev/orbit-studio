import { afterEach, describe, expect, it, vi } from "vitest";
import { createExplorerScenario, explorerSnapshots } from "../data/explorerCatalog";
import { useSimulationStore } from "./useSimulationStore";

describe("simulation store time authority", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets simulationTimeUtc to the real current instant when reset to now", () => {
    const fixedNow = new Date("2026-06-02T15:13:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    useSimulationStore.getState().resetSimulationTime();

    expect(useSimulationStore.getState().scenario.simulationTimeUtc).toBe(fixedNow.toISOString());
  });

  it("loads Explorer with no hidden fallback selection and clears selection explicitly", () => {
    const explorer = createExplorerScenario(explorerSnapshots[explorerSnapshots.length - 1]);
    useSimulationStore.getState().loadScenario(explorer);

    expect(useSimulationStore.getState().scenario.selectedObjectId).toBeNull();
    expect(useSimulationStore.getState().scenario.selectedObjectType).toBe("none");
    expect(useSimulationStore.getState().selectedSatelliteId).toBeNull();
    expect(useSimulationStore.getState().selectedConstellationId).toBeNull();

    useSimulationStore.getState().selectSatellite("explorer-iss");
    expect(useSimulationStore.getState().selectedSatelliteId).toBe("explorer-iss");

    useSimulationStore.getState().clearSelection();
    expect(useSimulationStore.getState().scenario.selectedObjectId).toBeNull();
    expect(useSimulationStore.getState().scenario.selectedObjectType).toBe("none");
    expect(useSimulationStore.getState().selectedSatelliteId).toBeNull();
    expect(useSimulationStore.getState().selectedConstellationId).toBeNull();
  });

  it("keeps constellation selection distinct from satellite selection", () => {
    const explorer = createExplorerScenario(explorerSnapshots[explorerSnapshots.length - 1]);
    useSimulationStore.getState().loadScenario(explorer);
    useSimulationStore.getState().selectSatellite("explorer-iss");
    useSimulationStore.getState().setFollowSelectedObject(true);
    useSimulationStore.getState().selectConstellation("explorer-gps-constellation");

    expect(useSimulationStore.getState().scenario.selectedObjectType).toBe("constellation");
    expect(useSimulationStore.getState().scenario.selectedObjectId).toBe(
      "explorer-gps-constellation",
    );
    expect(useSimulationStore.getState().selectedSatelliteId).toBeNull();
    expect(useSimulationStore.getState().scenario.cameraSettings.followSelectedObject).toBe(false);
    expect(
      useSimulationStore
        .getState()
        .scenario.constellations.filter((constellation) => constellation.visible)
        .map((constellation) => constellation.id),
    ).toEqual(["explorer-gps-constellation"]);

    useSimulationStore.getState().setConstellationVisibilityMode("all");
    expect(
      useSimulationStore
        .getState()
        .scenario.constellations.every((constellation) => constellation.visible),
    ).toBe(true);
  });
});
