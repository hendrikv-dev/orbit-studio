import { explorerReviewScenario } from "./explorer.mjs";

/**
 * Scenario registry. Adding a workspace review only requires a scenario module and
 * one entry here; the build/server/browser/artifact pipeline remains unchanged.
 */
export const reviewScenarios = [explorerReviewScenario];
