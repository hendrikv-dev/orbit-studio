import { createPlaygroundScenario, type Scenario } from "../lib/scenario";

export function createStudioScenarioFromExplorerSelection(scenario: Scenario): Scenario {
  const selectedObjectId = scenario.selectedObjectId;
  const selectedObjectType = scenario.selectedObjectType;
  const selectedSatellite =
    selectedObjectType === "satellite"
      ? scenario.satellites.find((item) => item.id === selectedObjectId)
      : undefined;

  return createPlaygroundScenario(new Date(scenario.simulationTimeUtc), selectedSatellite);
}
