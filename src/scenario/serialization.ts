import type { Scenario } from "./schema";

export function serializeScenario(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}

export function parseScenario(json: string): Scenario {
  const parsed = JSON.parse(json) as Scenario;
  if (!parsed.appVersion || !parsed.name || !Array.isArray(parsed.satellites)) {
    throw new Error("Scenario JSON is missing required APSIS fields.");
  }
  return parsed;
}

export function downloadScenario(scenario: Scenario): void {
  const blob = new Blob([serializeScenario(scenario)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.apsis.json`;
  link.click();
  URL.revokeObjectURL(url);
}
