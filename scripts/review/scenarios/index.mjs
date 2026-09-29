import { explorerReviewScenario } from "./explorer.mjs";
import { playgroundReviewScenario } from "./playground.mjs";
import { trackerReviewScenario } from "./tracker.mjs";
import { trackerRecoveryReviewScenario } from "./tracker-recovery.mjs";

/**
 * Scenario registry. Adding a workspace review only requires a scenario module and
 * one entry here; the build/server/browser/artifact pipeline remains unchanged.
 */
export const reviewScenarios = [
  explorerReviewScenario,
  playgroundReviewScenario,
  trackerReviewScenario,
  trackerRecoveryReviewScenario,
];
