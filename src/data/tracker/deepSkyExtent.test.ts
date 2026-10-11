import { describe, expect, it } from "vitest";
import { deepSkyAngularRadius } from "./deepSkyExtent";

describe("catalog extent and finder selection", () => {
  it("never invents an angular radius for unknown extent", () => {
    expect(deepSkyAngularRadius(null)).toBe(0);
  });
  it("preserves the existing selection allowance only for a known extent", () => {
    expect(deepSkyAngularRadius(0.7)).toBe(0.35);
    expect(deepSkyAngularRadius(120)).toBe(1);
  });
});
