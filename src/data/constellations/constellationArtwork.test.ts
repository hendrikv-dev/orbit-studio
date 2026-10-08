import { describe, expect, it } from "vitest";

import figureStars from "./constellationFigureStars.bsc5p.json";
import {
  CONSTELLATION_ARTWORK_DEFINITIONS,
  constellationArtworkAnchorIds,
  constellationArtworkFor,
} from "./constellationArtwork";

const figures = figureStars as { id: string; lines: number[][] }[];

describe("recognizable constellation artwork", () => {
  it("uses only real BSC5P anchors belonging to each conventional figure", () => {
    for (const definition of CONSTELLATION_ARTWORK_DEFINITIONS) {
      const figure = figures.find((candidate) => candidate.id === definition.symbol);
      const realFigureStars = new Set(figure?.lines.flat() ?? []);
      expect(figure, definition.symbol).toBeDefined();
      expect(constellationArtworkAnchorIds(definition.symbol).every((id) => realFigureStars.has(id))).toBe(true);
    }
  });

  it("resolves Orion and Aquarius into a reusable family of wash and line paths", () => {
    const directionForStar = (id: number) => ({ east: id / 10_000, north: 0.7, up: 0.5 });
    for (const symbol of ["Ori", "Aqr"]) {
      const artwork = constellationArtworkFor(symbol, directionForStar);
      expect(artwork?.paths.some((path) => path.role === "wash")).toBe(true);
      expect(artwork?.paths.some((path) => path.role === "outline")).toBe(true);
      expect(artwork?.paths.every((path) => path.directions.length >= 2)).toBe(true);
    }
  });

  it("does not invent generic artwork where no reviewed source drawing exists", () => {
    expect(constellationArtworkFor("And", () => ({ east: 1, north: 0, up: 0 }))).toBeNull();
  });
});
