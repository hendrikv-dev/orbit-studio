import { useEffect, useState } from "react";
import type { Scenario } from "../lib/scenario";
import { useSimulationStore } from "./useSimulationStore";

function sameStructuralScenario(next: Scenario, previous: Scenario): boolean {
  return (
    next.appVersion === previous.appVersion &&
    next.name === previous.name &&
    next.simulationEpoch === previous.simulationEpoch &&
    next.renderSettings === previous.renderSettings &&
    next.cameraSettings === previous.cameraSettings &&
    next.teacherMode === previous.teacherMode &&
    next.coverageSettings === previous.coverageSettings &&
    next.selectedObjectType === previous.selectedObjectType &&
    next.selectedObjectId === previous.selectedObjectId &&
    next.satellites === previous.satellites &&
    next.constellations === previous.constellations &&
    next.groundStations === previous.groundStations &&
    next.regions === previous.regions &&
    next.catalogLayers === previous.catalogLayers
  );
}

function sameSidebarScenario(next: Scenario, previous: Scenario): boolean {
  return (
    next.selectedObjectType === previous.selectedObjectType &&
    next.selectedObjectId === previous.selectedObjectId &&
    next.satellites === previous.satellites &&
    next.constellations === previous.constellations &&
    next.groundStations === previous.groundStations &&
    next.regions === previous.regions &&
    next.catalogLayers === previous.catalogLayers
  );
}

export function useRenderScenario(): Scenario {
  const [scenario, setScenario] = useState(() => useSimulationStore.getState().scenario);

  useEffect(
    () =>
      useSimulationStore.subscribe((state, previousState) => {
        const nextScenario = state.scenario;
        const previousScenario = previousState.scenario;
        const timeChanged = nextScenario.simulationTimeUtc !== previousScenario.simulationTimeUtc;

        if (
          !sameStructuralScenario(nextScenario, previousScenario) ||
          (!state.isPlaying && timeChanged)
        ) {
          setScenario(nextScenario);
        }
      }),
    [],
  );

  return scenario;
}

export function useSidebarScenario(): Scenario {
  const [scenario, setScenario] = useState(() => useSimulationStore.getState().scenario);

  useEffect(
    () =>
      useSimulationStore.subscribe((state, previousState) => {
        if (!sameSidebarScenario(state.scenario, previousState.scenario)) {
          setScenario(state.scenario);
        }
      }),
    [],
  );

  return scenario;
}
