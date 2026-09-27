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
