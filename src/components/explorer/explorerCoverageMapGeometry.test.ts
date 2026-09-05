import { describe, expect, it } from "vitest";
import { mapGeometry } from "./ExplorerCoverageMap";

/**
 * An equirectangular map spans 360° by 180°, so it is only geographically true
 * at 2:1. The layout hands the canvas whatever shape it has room for — docked
 * panels, a split pane, a phone in full screen — and every one of those boxes
 * used to be filled edge to edge, stretching the continents by up to 4x.
 */
describe("coverage map geometry", () => {
  const shapes: [string, number, number][] = [
    ["docked panel", 366, 182],
    ["desktop split pane", 1008, 333],
    ["desktop full screen", 1440, 720],
    ["tablet full screen", 834, 417],
    ["phone full screen", 390, 774],
    ["extreme column", 200, 2000],
    ["extreme banner", 2000, 200],
  ];

  it.each(shapes)("keeps 2:1 in a %s", (_label, width, height) => {
    const geometry = mapGeometry(width, height);
    expect(geometry.mapWidth / geometry.mapHeight).toBeCloseTo(2, 6);
  });

  it.each(shapes)("stays inside a %s", (_label, width, height) => {
    const geometry = mapGeometry(width, height);
    expect(geometry.mapWidth).toBeLessThanOrEqual(width + 1e-9);
    expect(geometry.mapHeight).toBeLessThanOrEqual(height + 1e-9);
    expect(geometry.mapX).toBeGreaterThanOrEqual(0);
    expect(geometry.mapY).toBeGreaterThanOrEqual(0);
  });

  it("uses the full extent of whichever axis is binding", () => {
    // Taller than 2:1 — width is binding and must not be wasted.
    expect(mapGeometry(390, 774).mapWidth).toBeCloseTo(390, 6);
    // Wider than 2:1 — height is binding.
    expect(mapGeometry(1008, 333).mapHeight).toBeCloseTo(333, 6);
  });

  it("centres the letterbox", () => {
    const geometry = mapGeometry(1000, 200);
    expect(geometry.mapX).toBeCloseTo((1000 - 400) / 2, 6);
    expect(geometry.mapY).toBeCloseTo(0, 6);
  });

  it("survives a zero-sized box before the first measurement", () => {
    const geometry = mapGeometry(0, 0);
    expect(geometry.mapWidth).toBe(0);
    expect(Number.isNaN(geometry.mapX)).toBe(false);
  });
});
