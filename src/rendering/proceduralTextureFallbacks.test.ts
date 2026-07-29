import { describe, expect, it } from "vitest";
import { DataTexture } from "three";
import { createGeneratedEarthTexture } from "./proceduralTextureFallbacks";

function dataTexturePixel(texture: ReturnType<typeof createGeneratedEarthTexture>): number[] {
  expect(texture).toBeInstanceOf(DataTexture);
  const data = (texture as DataTexture).image.data;
  return Array.from(data.slice(0, 4));
}

describe("procedural Earth texture fallbacks", () => {
  it("keeps unverified cloud and night layers visually neutral", () => {
    expect(dataTexturePixel(createGeneratedEarthTexture("clouds"))).toEqual([0, 0, 0, 0]);
    expect(dataTexturePixel(createGeneratedEarthTexture("night"))).toEqual([0, 0, 0, 255]);
  });

  it("retains a non-empty emergency surface fallback while NASA imagery loads", () => {
    expect(dataTexturePixel(createGeneratedEarthTexture("surface"))).toEqual([12, 25, 35, 255]);
  });
});
