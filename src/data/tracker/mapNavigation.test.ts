import { describe, expect, it } from "vitest";

import {
  defaultMapLocation,
  isMapNavigationStep,
  mapLocationToSearch,
  parseMapLocation,
} from "./mapNavigation";

describe("Tracker map Sky Finder navigation", () => {
  it("round-trips the Finder without losing its source card and detail", () => {
    const location = {
      ...defaultMapLocation(),
      card: "deep-sky-M45",
      detail: "deep-sky-M45",
      finder: "deep-sky-M45",
    };
    expect(parseMapLocation(mapLocationToSearch(location))).toMatchObject({
      card: "deep-sky-M45",
      detail: "deep-sky-M45",
      finder: "deep-sky-M45",
    });
  });

  it("treats opening and closing Finder as a Back-worthy decision", () => {
    const map = { ...defaultMapLocation(), card: "deep-sky-M45" };
    const finder = { ...map, finder: "deep-sky-M45" };
    expect(isMapNavigationStep(map, finder)).toBe(true);
    expect(isMapNavigationStep(finder, map)).toBe(true);
  });
});

describe("Tracker primary modes and map presentation", () => {
  it("round-trips Tonight without changing the observing context", () => {
    const location = {
      ...defaultMapLocation(),
      mode: "tonight" as const,
      pin: { latitudeDeg: 45.515, longitudeDeg: -122.678 },
      date: "2026-09-02",
      equipment: "binoculars" as const,
      layers: ["cloud", "light-pollution"],
      card: "planet-saturn",
    };
    expect(parseMapLocation(mapLocationToSearch(location))).toEqual(location);
  });

  it("preserves selection, date and layers when switching between 2D and 3D", () => {
    const twoD = {
      ...defaultMapLocation(),
      pin: { latitudeDeg: 45.515, longitudeDeg: -122.678 },
      centre: { latitudeDeg: 45.5, longitudeDeg: -122.7 },
      zoom: 8.25,
      date: "2026-09-02",
      card: "planet-saturn",
      layers: ["cloud"],
    };
    const terrain = { ...twoD, projection: "terrain" as const };
    expect(parseMapLocation(mapLocationToSearch(terrain))).toEqual(terrain);
    expect({ ...terrain, projection: "mercator" }).toEqual(twoD);
  });

  it("migrates old globe links into the real-terrain 3D presentation", () => {
    expect(parseMapLocation("?app=tracker&globe=1").projection).toBe("terrain");
    expect(mapLocationToSearch({ ...defaultMapLocation(), projection: "terrain" }))
      .toContain("terrain=1");
  });
});
