import { describe, expect, it } from "vitest";
import { trackerBasemapFallbackImage } from "./basemapStyleImage";

describe("trackerBasemapFallbackImage", () => {
  it("resolves the known OpenFreeMap city-circle omission", () => {
    const image = trackerBasemapFallbackImage("circle-11");

    expect(image).not.toBeNull();
    expect(image?.width).toBe(11);
    expect(image?.height).toBe(11);
    expect(image?.data).toHaveLength(11 * 11 * 4);
    expect(image?.data[3]).toBe(0);
    expect(image?.data[(5 * 11 + 5) * 4 + 3]).toBe(255);
  });

  it("resolves the known OpenFreeMap wood-pattern omission without hiding the terrain", () => {
    const image = trackerBasemapFallbackImage("wood-pattern");

    expect(image).not.toBeNull();
    expect(image?.width).toBe(8);
    expect(image?.height).toBe(8);
    expect(image?.data).toHaveLength(8 * 8 * 4);
    expect(image?.data[3]).toBe(255);
    expect(image?.data[0]).not.toBe(image?.data[4]);
  });

  it("does not conceal an unknown missing style image", () => {
    expect(trackerBasemapFallbackImage("unexpected-icon")).toBeNull();
  });
});
