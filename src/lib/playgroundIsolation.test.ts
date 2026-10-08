import { describe, expect, it } from "vitest";
import { createPlaygroundScenario } from "./scenario";

describe("Playground environment isolation", () => {
  it("creates a neutral authored scenario with no catalog context", () => {
    const scenario = createPlaygroundScenario(new Date("2026-07-30T00:00:00.000Z"));

    expect(scenario.environment).toBe("playground");
    expect(scenario.name).toBe("Playground");
    expect(scenario.satellites).toHaveLength(1);
    expect(scenario.satellites[0].name).toBe("Satellite 1");
    expect(scenario.satellites[0].catalogMetadata).toBeUndefined();
    expect(scenario.catalogLayers).toHaveLength(0);
    expect(scenario.constellations).toHaveLength(0);
    expect(scenario.groundStations).toHaveLength(0);
    expect(scenario.regions).toHaveLength(0);
  });
});
