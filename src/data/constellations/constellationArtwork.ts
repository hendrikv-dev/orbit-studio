import type { EnuDirection } from "../../astronomy/topocentricSky";

export type ConstellationArtworkRole = "wash" | "outline" | "detail" | "accent";

export interface ConstellationArtworkPath {
  id: string;
  role: ConstellationArtworkRole;
  closed: boolean;
  directions: EnuDirection[];
}

export interface ConstellationArtwork {
  symbol: string;
  paths: ConstellationArtworkPath[];
}

type AnchorBlend = readonly (readonly [starId: number, weight: number])[];

interface ArtworkPathDefinition {
  id: string;
  role: ConstellationArtworkRole;
  closed?: boolean;
  points: readonly AnchorBlend[];
}

interface ArtworkDefinition {
  symbol: string;
  sourceReference: "jamieson-1822" | "uranias-mirror-1825";
  paths: readonly ArtworkPathDefinition[];
}

const at = (starId: number): AnchorBlend => [[starId, 1]];
const blend = (...anchors: readonly [number, number][]): AnchorBlend => anchors;

/*
 * These are original, deliberately economical celestial drawings, not traced
 * atlas pixels. Jamieson's hunter and Urania's water bearer are the historical
 * recognition references; every production control point is instead defined
 * as a barycentric blend of real BSC5P stars. Negative weights provide small
 * extrapolations for a head or limb while keeping the figure rigidly attached
 * to the catalogue geometry under every projection.
 */
export const CONSTELLATION_ARTWORK_DEFINITIONS: readonly ArtworkDefinition[] = [
  {
    symbol: "Ori",
    sourceReference: "jamieson-1822",
    paths: [
      {
        id: "hunter-torso-wash",
        role: "wash",
        closed: true,
        points: [at(1790), at(2061), at(1948), at(1903), at(1852)],
      },
      {
        id: "hunter-head",
        role: "outline",
        closed: true,
        points: [
          blend([1879, 1.35], [1790, -0.175], [2061, -0.175]),
          blend([1879, 0.82], [1790, 0.25], [2061, -0.07]),
          blend([1879, 0.56], [1790, 0.22], [2061, 0.22]),
          blend([1879, 0.82], [1790, -0.07], [2061, 0.25]),
        ],
      },
      {
        id: "hunter-torso",
        role: "outline",
        closed: true,
        points: [at(1790), at(2061), at(1948), at(1903), at(1852)],
      },
      {
        id: "hunter-left-leg",
        role: "outline",
        points: [at(1852), at(1713), blend([1713, 1.08], [1852, -0.08])],
      },
      {
        id: "hunter-right-leg",
        role: "outline",
        points: [at(1948), at(2004), blend([2004, 1.08], [1948, -0.08])],
      },
      {
        id: "hunter-raised-arm",
        role: "outline",
        points: [at(2061), at(2124), at(2199)],
      },
      {
        id: "hunter-club",
        role: "accent",
        points: [at(2047), at(2135), at(2159), at(2199)],
      },
      {
        id: "hunter-shield-arm",
        role: "outline",
        points: [at(1790), at(1570), at(1580)],
      },
      {
        id: "hunter-shield",
        role: "wash",
        closed: true,
        points: [at(1570), at(1580), at(1638), at(1676), blend([1570, 0.7], [1676, 0.3])],
      },
      {
        id: "hunter-belt",
        role: "accent",
        points: [at(1852), at(1903), at(1948)],
      },
      {
        id: "hunter-sword",
        role: "detail",
        points: [at(1903), blend([1903, 1.42], [1879, -0.42])],
      },
    ],
  },
  {
    symbol: "Aqr",
    sourceReference: "uranias-mirror-1825",
    paths: [
      {
        id: "water-bearer-torso-wash",
        role: "wash",
        closed: true,
        points: [at(8232), at(8414), at(8499), at(8418)],
      },
      {
        id: "water-bearer-head",
        role: "outline",
        closed: true,
        points: [
          blend([8232, 1.34], [7990, -0.17], [8414, -0.17]),
          blend([8232, 0.8], [7990, 0.27], [8414, -0.07]),
          blend([8232, 0.55], [7990, 0.22], [8414, 0.23]),
          blend([8232, 0.8], [7990, -0.07], [8414, 0.27]),
        ],
      },
      {
        id: "water-bearer-torso",
        role: "outline",
        closed: true,
        points: [at(8232), at(8414), at(8499), at(8418)],
      },
      {
        id: "water-bearer-back-arm",
        role: "detail",
        points: [at(8232), at(7990), at(7950)],
      },
      {
        id: "water-bearer-pouring-arm",
        role: "outline",
        points: [at(8232), at(8414), at(8518), at(8559)],
      },
      {
        id: "urn",
        role: "accent",
        closed: true,
        points: [at(8414), at(8518), at(8559), at(8539), at(8414)],
      },
      {
        id: "water-bearer-near-leg",
        role: "outline",
        points: [at(8418), at(8698), at(8812)],
      },
      {
        id: "water-bearer-bent-leg",
        role: "outline",
        points: [at(8499), at(8858), at(8892)],
      },
      {
        id: "water-stream-one",
        role: "accent",
        points: [at(8559), at(8597), at(8698), at(8858), at(8982)],
      },
      {
        id: "water-stream-two",
        role: "detail",
        points: [
          at(8539),
          blend([8597, 0.66], [8499, 0.34]),
          blend([8698, 0.72], [8812, 0.28]),
          at(8892),
        ],
      },
    ],
  },
] as const;

function normalizedBlend(
  anchors: AnchorBlend,
  directionForStar: (starId: number) => EnuDirection | null,
): EnuDirection | null {
  let east = 0;
  let north = 0;
  let up = 0;
  for (const [starId, weight] of anchors) {
    const direction = directionForStar(starId);
    if (!direction) return null;
    east += direction.east * weight;
    north += direction.north * weight;
    up += direction.up * weight;
  }
  const length = Math.hypot(east, north, up);
  return length > 1e-8 ? { east: east / length, north: north / length, up: up / length } : null;
}

/** Resolve original figure art through the same real-star ENU authority as its lines. */
export function constellationArtworkFor(
  symbol: string,
  directionForStar: (starId: number) => EnuDirection | null,
): ConstellationArtwork | null {
  const definition = CONSTELLATION_ARTWORK_DEFINITIONS.find((candidate) => candidate.symbol === symbol);
  if (!definition) return null;
  const paths = definition.paths.flatMap((path) => {
    const directions = path.points.map((point) => normalizedBlend(point, directionForStar));
    if (directions.some((direction) => direction === null)) return [];
    return [{ id: path.id, role: path.role, closed: path.closed === true, directions: directions as EnuDirection[] }];
  });
  return paths.length === definition.paths.length ? { symbol, paths } : null;
}

export function constellationArtworkAnchorIds(symbol: string): number[] {
  const definition = CONSTELLATION_ARTWORK_DEFINITIONS.find((candidate) => candidate.symbol === symbol);
  return definition
    ? [...new Set(definition.paths.flatMap((path) => path.points.flatMap((point) => point.map(([starId]) => starId))))]
    : [];
}
