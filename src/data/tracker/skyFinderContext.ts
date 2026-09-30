import { Body, Constellation, Equator, Horizon, MakeTime, Observer } from "astronomy-engine";

import constellationFigures from "../constellations/constellationLines.d3Celestial.json";
import brightStars from "../stars/hygBrightStars.v41.json";
import {
  normalizeDegrees,
  positionForSkyFinderTarget,
  signedAngleDifference,
  type PhonePointing,
  type SkyFinderTarget,
} from "./skyFinder";
import { skyMarkerKindForTarget, type SkyMarkerKind } from "./skyMarker";

interface BrightStarRecord {
  id: number;
  hip: number | null;
  name: string | null;
  raHours: number;
  decDeg: number;
  magnitude: number;
  constellation: string;
}

interface ConstellationFigureFeature {
  id: string;
  properties: { rank: string };
  geometry: { type: "MultiLineString"; coordinates: number[][][] };
}

export interface ExpectedSkyStar {
  id: number;
  name: string | null;
  label: string | null;
  xPercent: number;
  yPercent: number;
  radiusPx: number;
  magnitude: number;
  inTargetConstellation: boolean;
}

export interface ExpectedSkyLine {
  id: string;
  constellation: string;
  points: Array<{ xPercent: number; yPercent: number }>;
  primary: boolean;
}

export interface ExpectedSkyLabel {
  symbol: string;
  name: string;
  xPercent: number;
  yPercent: number;
  primary: boolean;
}

export interface ExpectedSkyObject {
  id: string;
  title: string;
  marker: SkyMarkerKind;
  xPercent: number;
  yPercent: number;
}

export interface ExpectedSkyContext {
  /** IAU constellation containing the selected target coordinate, when one exists. */
  constellation: { symbol: string; name: string } | null;
  /** Real HYG v4.1 stars projected into the current approximate Finder field of view. */
  stars: ExpectedSkyStar[];
  /** Conventional d3-celestial figure segments projected from J2000 into this local field. */
  lines: ExpectedSkyLine[];
  /** Names derived from the actual projected figure segments visible in the field. */
  labels: ExpectedSkyLabel[];
  /** Other production-ranked objects whose real positions fall inside the field. */
  objects: ExpectedSkyObject[];
}

const HORIZONTAL_FOV_DEG = 82;
const VERTICAL_FOV_DEG = 66;

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
      // ofdate=false returns the J2000 frame required by Constellation().
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
  const horizontal = Math.hypot(sum.x, sum.y);
  return {
    raHours: normalizeDegrees((Math.atan2(sum.y, sum.x) * 180) / Math.PI) / 15,
    decDeg: (Math.atan2(sum.z, horizontal) * 180) / Math.PI,
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

function projectHorizontal(
  centre: PhonePointing,
  position: { azimuthDeg: number; altitudeDeg: number },
): { xPercent: number; yPercent: number; inField: boolean } {
  // Longitude contracts toward the zenith on the local celestial sphere. This
  // remains an approximate camera field because browsers do not disclose the
  // rear-lens FOV, but it preserves local angular relationships better than
  // treating azimuth degrees as a flat Cartesian axis.
  const averageAltitude = ((centre.altitudeDeg + position.altitudeDeg) / 2) * (Math.PI / 180);
  const horizontalError =
    signedAngleDifference(centre.azimuthDeg, position.azimuthDeg) *
    Math.max(0.22, Math.cos(averageAltitude));
  const verticalError = position.altitudeDeg - centre.altitudeDeg;
  const xPercent = 50 + (horizontalError / HORIZONTAL_FOV_DEG) * 100;
  const yPercent = 50 - (verticalError / VERTICAL_FOV_DEG) * 100;
  return {
    xPercent,
    yPercent,
    inField: xPercent >= 0 && xPercent <= 100 && yPercent >= 0 && yPercent <= 100,
  };
}

function friendlyStarLabel(name: string | null, magnitude: number): string | null {
  if (!name || magnitude > 1.8) return null;
  // HYG contains both common names (Sirius) and compact Bayer/Flamsteed forms
  // ("21Alp Tau"). Only the former are useful in the low-clutter live field.
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(name) ? name : null;
}

/**
 * Build truthful visual context for Sky without claiming the camera detected it.
 *
 * Stars come from the documented HYG v4.1 magnitude-limited subset. Figure
 * segments come from the separately documented BSD-licensed d3-celestial data.
 * Both are projected through Astronomy Engine for the same observer and UTC
 * instant as the target. Other markers are the production-ranked targets
 * supplied by Tracker, never a parallel catalogue. The 82° × 66° field is an
 * orientation aid because the browser cannot provide a calibrated lens model.
 */
export function expectedSkyContext(
  target: SkyFinderTarget,
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
  centre: PhonePointing,
  references: SkyFinderTarget[] = [],
): ExpectedSkyContext {
  const equatorial = targetEquatorial(target, observer, at);
  const constellation = equatorial
    ? constellationAt(equatorial.raHours, equatorial.decDeg)
    : null;
  const astronomyObserver = new Observer(observer.latitudeDeg, observer.longitudeDeg, 0);
  const time = MakeTime(at);

  const stars = (brightStars as BrightStarRecord[])
    .flatMap((star) => {
      const horizontal = Horizon(time, astronomyObserver, star.raHours, star.decDeg, "normal");
      const projected = projectHorizontal(centre, {
        azimuthDeg: horizontal.azimuth,
        altitudeDeg: horizontal.altitude,
      });
      if (!projected.inField) return [];
      return [{
        id: star.id,
        name: star.name,
        label: friendlyStarLabel(star.name, star.magnitude),
        xPercent: projected.xPercent,
        yPercent: projected.yPercent,
        radiusPx: Math.max(0.8, Math.min(3.2, 2.85 - (star.magnitude + 1.5) * 0.34)),
        magnitude: star.magnitude,
        inTargetConstellation: constellation?.symbol === star.constellation,
      }];
    })
    .sort((a, b) => a.magnitude - b.magnitude)
    .slice(0, 92);

  const labelCandidates = new Map<
    string,
    { symbol: string; name: string; x: number; y: number; count: number; primary: boolean; rank: number }
  >();
  const lines: ExpectedSkyLine[] = [];
  for (const feature of (constellationFigures.features as ConstellationFigureFeature[])) {
    const primary = feature.id === constellation?.symbol;
    const rank = Number(feature.properties.rank);
    if (!primary && rank > 2) continue;
    let segmentIndex = 0;
    for (const line of feature.geometry.coordinates) {
      const projected = line.map(([raDeg, decDeg]) => {
        const horizontal = Horizon(
          time,
          astronomyObserver,
          normalizeDegrees(raDeg) / 15,
          decDeg,
          "normal",
        );
        return projectHorizontal(centre, {
          azimuthDeg: horizontal.azimuth,
          altitudeDeg: horizontal.altitude,
        });
      });
      for (let index = 1; index < projected.length; index += 1) {
        const start = projected[index - 1];
        const end = projected[index];
        const crossesField =
          start.inField ||
          end.inField ||
          (Math.min(start.xPercent, end.xPercent) <= 100 &&
            Math.max(start.xPercent, end.xPercent) >= 0 &&
            Math.min(start.yPercent, end.yPercent) <= 100 &&
            Math.max(start.yPercent, end.yPercent) >= 0);
        if (!crossesField || Math.abs(start.xPercent - end.xPercent) > 180) continue;
        const points = [start, end].map((point) => ({
          xPercent: Math.max(-8, Math.min(108, point.xPercent)),
          yPercent: Math.max(-8, Math.min(108, point.yPercent)),
        }));
        lines.push({
          id: `${feature.id}-${segmentIndex}`,
          constellation: feature.id,
          points,
          primary,
        });
        segmentIndex += 1;
        const visible = [start, end].filter((point) => point.inField);
        if (visible.length > 0) {
          const representative = constellationAt(normalizeDegrees(line[index][0]) / 15, line[index][1]);
          const current = labelCandidates.get(feature.id) ?? {
            symbol: feature.id,
            name: representative?.name ?? feature.id,
            x: 0,
            y: 0,
            count: 0,
            primary,
            rank,
          };
          for (const point of visible) {
            current.x += point.xPercent;
            current.y += point.yPercent;
            current.count += 1;
          }
          labelCandidates.set(feature.id, current);
        }
      }
    }
  }

  const labels = [...labelCandidates.values()]
    .filter((candidate) => candidate.count > 0)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.rank - b.rank || b.count - a.count)
    .slice(0, 4)
    .map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      xPercent: candidate.x / candidate.count,
      yPercent: candidate.y / candidate.count,
      primary: candidate.primary,
    }));

  const objects = references
    .filter((candidate) => candidate.id !== target.id)
    .flatMap((candidate) => {
      const position = positionForSkyFinderTarget(candidate, observer, at);
      if (!position || position.altitudeDeg <= 0) return [];
      const projected = projectHorizontal(centre, position);
      if (!projected.inField) return [];
      return [{
        id: candidate.id,
        title: candidate.title,
        marker: skyMarkerKindForTarget(candidate),
        xPercent: projected.xPercent,
        yPercent: projected.yPercent,
      }];
    })
    .slice(0, 7);

  return { constellation, stars, lines, labels, objects };
}
