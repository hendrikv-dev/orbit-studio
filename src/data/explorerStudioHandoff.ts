import { createPlaygroundScenario, type Scenario } from "../lib/scenario";

/**
 * Explorer and Playground intentionally do not share catalog selections.
 * This compatibility helper now always returns a clean authored Playground.
 * A future import workflow must be explicit and must copy data through a
 * dedicated boundary rather than inheriting Explorer state.
 */
export function createStudioScenarioFromExplorerSelection(scenario: Scenario): Scenario {
  return createPlaygroundScenario(new Date(scenario.simulationTimeUtc));
}
