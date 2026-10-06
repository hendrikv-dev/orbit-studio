import { Body, Constellation, Equator, MakeTime, Observer } from "astronomy-engine";

import {
  catalogDirectionForObserver,
  horizontalToEnu,
  normalizeDegrees,
  type EnuDirection,
} from "../../astronomy/topocentricSky";
import constellationFigures from "../constellations/constellationFigureStars.bsc5p.json";
import brightStars from "../stars/bsc5pBrightStars.json";
import {
  positionForSkyFinderTarget,
  type PhonePointing,
  type SkyFinderTarget,
} from "./skyFinder";
import { solarSystemTargets } from "./skyExplorer";
import { skyMarkerKindForTarget, type SkyMarkerKind } from "./skyMarker";

export interface Bsc5pBrightStarRecord {
  id: number;
  name: string | null;
  designation: string | null;
  raHours: number;
  decDeg: number;
  magnitude: number;
  colorIndexBv: number | null;
  properMotionRaArcsecPerYear: number | null;
  properMotionDecArcsecPerYear: number | null;
  constellation: string;
}

interface ConstellationFigureRecord {
  id: string;
  rank: number;
  lines: number[][];
}

export interface ExpectedSkyStar {
  id: number;
  name: string | null;
  designation: string | null;
  label: string | null;
  direction: EnuDirection;
  radiusPx: number;
  luminance: number;
  color: string;
  magnitude: number;
  inTargetConstellation: boolean;
}

export interface ExpectedSkyLine {
  id: string;
  constellation: string;
  startStarId: number;
  endStarId: number;
  start: EnuDirection;
  end: EnuDirection;
  primary: boolean;
}

export interface ExpectedSkyLabel {
  symbol: string;
  name: string;
  direction: EnuDirection;
  primary: boolean;
}

export interface ExpectedSkyFigure {
  symbol: string;
  name: string;
  directions: EnuDirection[];
  primary: boolean;
}

export interface ExpectedSkyBandSegment {
  id: string;
  start: EnuDirection;
  end: EnuDirection;
}

export interface ExpectedSkyObject {
  id: string;
  title: string;
  marker: SkyMarkerKind;
  direction: EnuDirection;
}

export interface ExpectedSkyContext {
  /** IAU constellation containing the selected target coordinate, when one exists. */
  constellation: { symbol: string; name: string } | null;
  /** Real BSC5P stars fixed in the observer's local ENU frame for this UTC instant. */
  stars: ExpectedSkyStar[];
  /** Conventional d3-celestial figures, with every endpoint anchored to a BSC5P HR star. */
  lines: ExpectedSkyLine[];
  /** Names for the actual visible figure candidates, never decorative placement. */
  labels: ExpectedSkyLabel[];
  /** Original display apparitions derived from, and anchored to, real figure stars. */
  figures: ExpectedSkyFigure[];
  /** The true J2000 galactic equator, used as the Milky Way display spine. */
  milkyWay: ExpectedSkyBandSegment[];
  /** Other production-ranked objects fixed in the same local ENU frame. */
  objects: ExpectedSkyObject[];
  /** True apparent Sun altitude, used only for daylight/twilight presentation. */
  sunAltitudeDeg: number | null;
}

const STARS = brightStars as Bsc5pBrightStarRecord[];
const STAR_BY_ID = new Map(STARS.map((star) => [star.id, star]));
const FIGURES = constellationFigures as ConstellationFigureRecord[];

function targetEquatorial(
  target: SkyFinderTarget,
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
): { raHours: number; decDeg: number } | null {
  if (target.source.kind === "equatorial") {
    return {
      raHours: target.source.rightAscensionHours,
      decDeg: target.source.declinationDeg,
    };
  }
  if (target.source.kind !== "body" && target.source.kind !== "body-region") return null;

  const bodies = target.source.kind === "body" ? [target.source.body] : target.source.bodies;
  const astronomyObserver = new Observer(observer.latitudeDeg, observer.longitudeDeg, 0);
  const time = MakeTime(at);
  const vectors = bodies.flatMap((body) => {
    try {
      const equator = Equator(body as Body, time, astronomyObserver, false, true);
      const ra = (equator.ra * Math.PI) / 12;
      const dec = (equator.dec * Math.PI) / 180;
      return [{
        x: Math.cos(dec) * Math.cos(ra),
        y: Math.cos(dec) * Math.sin(ra),
        z: Math.sin(dec),
      }];
    } catch {
      return [];
    }
  });
  if (vectors.length === 0) return null;
  const sum = vectors.reduce(
    (total, value) => ({ x: total.x + value.x, y: total.y + value.y, z: total.z + value.z }),
    { x: 0, y: 0, z: 0 },
  );
  return {
    raHours: normalizeDegrees((Math.atan2(sum.y, sum.x) * 180) / Math.PI) / 15,
    decDeg: (Math.atan2(sum.z, Math.hypot(sum.x, sum.y)) * 180) / Math.PI,
  };
}

function constellationAt(raHours: number, decDeg: number) {
  try {
    const result = Constellation(raHours, decDeg);
    return { symbol: result.symbol, name: result.name };
  } catch {
    return null;
  }
}

function dot(left: EnuDirection, right: EnuDirection): number {
  return left.east * right.east + left.north * right.north + left.up * right.up;
}

function averageDirection(directions: EnuDirection[]): EnuDirection {
  const sum = directions.reduce(
    (total, direction) => ({
      east: total.east + direction.east,
      north: total.north + direction.north,
      up: total.up + direction.up,
    }),
    { east: 0, north: 0, up: 0 },
  );
  const length = Math.hypot(sum.east, sum.north, sum.up) || 1;
  return { east: sum.east / length, north: sum.north / length, up: sum.up / length };
}

function friendlyStarLabel(star: Bsc5pBrightStarRecord): string | null {
  if (star.name && star.magnitude <= 1.8) return star.name;
  return null;
}

function sameCelestialIdentity(left: SkyFinderTarget, right: SkyFinderTarget): boolean {
  if (left.id === right.id) return true;
  if (left.source.kind === "body" && right.source.kind === "body") {
    return left.source.body.toLowerCase() === right.source.body.toLowerCase();
  }
  return left.title.trim().toLocaleLowerCase() === right.title.trim().toLocaleLowerCase();
}

/** IAU 1958/J2000 galactic frame rotation, transposed from equatorial→galactic. */
function galacticPlaneCoordinate(longitudeDeg: number): { raHours: number; decDeg: number } {
  const longitude = longitudeDeg * Math.PI / 180;
  const xg = Math.cos(longitude);
  const yg = Math.sin(longitude);
  const x = -0.0548755604 * xg + 0.4941094279 * yg;
  const y = -0.8734370902 * xg - 0.4448296300 * yg;
  const z = -0.4838350155 * xg + 0.7469822445 * yg;
  return {
    raHours: normalizeDegrees(Math.atan2(y, x) * 180 / Math.PI) / 15,
    decDeg: Math.asin(z) * 180 / Math.PI,
  };
}

export function starColorFromBv(colorIndexBv: number | null): string {
  if (colorIndexBv === null) return "rgb(236 241 255)";
  const t = Math.max(0, Math.min(1, (colorIndexBv + 0.3) / 1.9));
  if (t < 0.5) {
    const amount = t / 0.5;
    return `rgb(${Math.round(174 + 81 * amount)} ${Math.round(202 + 47 * amount)} ${Math.round(255 - 22 * amount)})`;
  }
  const amount = (t - 0.5) / 0.5;
  return `rgb(255 ${Math.round(249 - 78 * amount)} ${Math.round(233 - 111 * amount)})`;
}

function directionForStar(
  star: Bsc5pBrightStarRecord,
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
): EnuDirection {
  return catalogDirectionForObserver(
    {
      raHours: star.raHours,
      decDeg: star.decDeg,
      properMotionRaArcsecPerYear: star.properMotionRaArcsecPerYear,
      properMotionDecArcsecPerYear: star.properMotionDecArcsecPerYear,
    },
    observer,
    at,
  ).enu;
}

interface CachedDirectionFrame {
  key: string;
  directions: Map<number, EnuDirection>;
}

// One Sky surface is live at a time. Keep exactly its most recent derived
// catalog frame so crossing a three-degree pointing bucket only re-culls the
// field instead of re-running 8,404 observer transforms. The observer and UTC
// instant are the complete cache key; a location or 15-second astronomy tick
// replaces the frame rather than allowing stale positions to accumulate.
let cachedDirectionFrame: CachedDirectionFrame | null = null;

function directionFrameFor(
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
): Map<number, EnuDirection> {
  const key = `${observer.latitudeDeg.toFixed(7)}:${observer.longitudeDeg.toFixed(7)}:${at.getTime()}`;
  if (cachedDirectionFrame?.key === key) return cachedDirectionFrame.directions;
  const directions = new Map(
    STARS.map((star) => [star.id, directionForStar(star, observer, at)] as const),
  );
  cachedDirectionFrame = { key, directions };
  return directions;
}

/**
 * Build truthful visual context without claiming that the camera detected it.
 * Candidate culling uses an approximate centre only for performance; every
 * retained coordinate is a fixed ENU direction and final placement uses the
 * exact stabilized camera quaternion in the component.
 */
export function expectedSkyContext(
  target: SkyFinderTarget | null,
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
  centre: PhonePointing,
  references: SkyFinderTarget[] = [],
): ExpectedSkyContext {
  const targetCoordinate = target ? targetEquatorial(target, observer, at) : null;
  const selectedConstellationSymbol = target?.id.startsWith("constellation-")
    ? FIGURES.find((figure) => figure.id.toLowerCase() === target.id.slice("constellation-".length))?.id ?? null
    : null;
  const constellation = selectedConstellationSymbol
    ? { symbol: selectedConstellationSymbol, name: target?.title ?? selectedConstellationSymbol }
    : targetCoordinate
      ? constellationAt(targetCoordinate.raHours, targetCoordinate.decDeg)
      : null;
  const centreDirection = horizontalToEnu(centre);
  const candidateCosine = Math.cos((68 * Math.PI) / 180);
  const directions = directionFrameFor(observer, at);
  const direction = (star: Bsc5pBrightStarRecord) => directions.get(star.id)!;

  const stars = STARS
    .filter((star) => star.magnitude <= 6.5)
    .flatMap((star) => {
      const enu = direction(star);
      if (enu.up < -0.18 || dot(enu, centreDirection) < candidateCosine) return [];
      const luminance = Math.max(0.18, Math.min(1, Math.pow(2.512, -star.magnitude) * 0.95));
      return [{
        id: star.id,
        name: star.name,
        designation: star.designation,
        label: friendlyStarLabel(star),
        direction: enu,
        radiusPx: Math.max(1.05, Math.min(5.2, 4.9 - (star.magnitude + 1.5) * 0.48)),
        luminance,
        color: starColorFromBv(star.colorIndexBv),
        magnitude: star.magnitude,
        inTargetConstellation: constellation?.symbol === star.constellation,
      }];
    })
    .sort((left, right) => left.magnitude - right.magnitude)
    .slice(0, 240);

  const lines: ExpectedSkyLine[] = [];
  const labelDirections = new Map<string, EnuDirection[]>();
  for (const figure of FIGURES) {
    const primary = figure.id === (selectedConstellationSymbol ?? constellation?.symbol);
    if (!primary && figure.rank > 2) continue;
    let segmentIndex = 0;
    for (const line of figure.lines) {
      for (let index = 1; index < line.length; index += 1) {
        const startStar = STAR_BY_ID.get(line[index - 1]);
        const endStar = STAR_BY_ID.get(line[index]);
        if (!startStar || !endStar) continue;
        const start = direction(startStar);
        const end = direction(endStar);
        if (dot(start, centreDirection) < candidateCosine && dot(end, centreDirection) < candidateCosine) {
          continue;
        }
        lines.push({
          id: `${figure.id}-${segmentIndex}`,
          constellation: figure.id,
          startStarId: startStar.id,
          endStarId: endStar.id,
          start,
          end,
          primary,
        });
        segmentIndex += 1;
        const current = labelDirections.get(figure.id) ?? [];
        current.push(start, end);
        labelDirections.set(figure.id, current);
      }
    }
  }

  const labels = [...labelDirections.entries()]
    .flatMap(([symbol, values]) => {
      const representative = STAR_BY_ID.get(
        FIGURES.find((figure) => figure.id === symbol)?.lines[0]?.[0] ?? -1,
      );
      const named = representative ? constellationAt(representative.raHours, representative.decDeg) : null;
      return named ? [{
        symbol,
        name: named.name,
        direction: averageDirection(values),
        primary: symbol === constellation?.symbol,
      }] : [];
    })
    .sort((left, right) => Number(right.primary) - Number(left.primary))
    .slice(0, 5);

  const figures = labels.flatMap((label) => {
    const directionsForFigure = labelDirections.get(label.symbol) ?? [];
    const unique = [...new Map(directionsForFigure.map((value) => [
      `${value.east.toFixed(7)}:${value.north.toFixed(7)}:${value.up.toFixed(7)}`,
      value,
    ])).values()];
    return unique.length >= 3 ? [{
      symbol: label.symbol,
      name: label.name,
      directions: unique,
      primary: label.primary,
    }] : [];
  });

  const galacticDirections = Array.from({ length: 73 }, (_, index) => {
    const coordinate = galacticPlaneCoordinate(index * 5);
    return catalogDirectionForObserver(coordinate, observer, at).enu;
  });
  const milkyWay: ExpectedSkyBandSegment[] = galacticDirections.flatMap((start, index) => {
    const end = galacticDirections[index + 1];
    if (!end || (dot(start, centreDirection) < candidateCosine && dot(end, centreDirection) < candidateCosine)) return [];
    return [{ id: `milky-${index}`, start, end }];
  });

  const objectCandidates = [...solarSystemTargets(at), ...references];
  const seenObjects = new Set<string>();
  const objects = objectCandidates
    // A ranked recommendation and the browse catalogue can describe the same
    // body with different IDs (for example `planet-saturn` and `body-saturn`).
    // Keep the selected lock as the sole rendering authority for that object.
    .filter((candidate) => !target || !sameCelestialIdentity(candidate, target))
    .flatMap((candidate) => {
      if (seenObjects.has(candidate.id)) return [];
      seenObjects.add(candidate.id);
      const position = positionForSkyFinderTarget(candidate, observer, at);
      if (!position || position.altitudeDeg <= 0) return [];
      const enu = horizontalToEnu(position);
      if (dot(enu, centreDirection) < candidateCosine) return [];
      return [{
        id: candidate.id,
        title: candidate.title,
        marker: skyMarkerKindForTarget(candidate),
        direction: enu,
      }];
    })
    .slice(0, 18);

  const sun = solarSystemTargets(at).find((candidate) => candidate.title === "Sun") ?? null;
  const sunAltitudeDeg = sun ? positionForSkyFinderTarget(sun, observer, at)?.altitudeDeg ?? null : null;

  return { constellation, stars, lines, labels, figures, milkyWay, objects, sunAltitudeDeg };
}
