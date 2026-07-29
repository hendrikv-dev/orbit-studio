import type { ConstellationModel, SatelliteModel } from "../lib/scenario";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  explorerConstellationArchitectureFor,
  type ConstellationArchitectureShell,
} from "./explorerConstellationArchitecture";

export interface ResolvedConstellationShellGeometry {
  definition: ConstellationArchitectureShell;
  altitudeKm: number;
  inclinationDeg: number;
  matchedMembers: SatelliteModel[];
  validation: {
    displayedMatchCount: number;
    altitudeRangeKm: [number, number] | null;
    inclinationRangeDeg: [number, number] | null;
  };
}

function altitudeKm(satellite: SatelliteModel): number {
  return satellite.keplerian.semiMajorAxisKm - EARTH_RADIUS_KM;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function range(values: number[]): [number, number] | null {
  return values.length > 0 ? [Math.min(...values), Math.max(...values)] : null;
}

function shellMatchScore(
  satellite: SatelliteModel,
  shell: ConstellationArchitectureShell,
): number | null {
  const altitudeDelta = Math.abs(altitudeKm(satellite) - shell.altitudeKm);
  const inclinationDelta = Math.abs(satellite.keplerian.inclinationDeg - shell.inclinationDeg);
  if (
    altitudeDelta > shell.altitudeToleranceKm ||
    inclinationDelta > shell.inclinationToleranceDeg
  ) {
    return null;
  }

  return (
    altitudeDelta / shell.altitudeToleranceKm +
    inclinationDelta / shell.inclinationToleranceDeg
  );
}

export function resolveConstellationShellGeometries(
  constellation: ConstellationModel,
  satellites: SatelliteModel[],
): ResolvedConstellationShellGeometry[] {
  const architecture = explorerConstellationArchitectureFor(constellation.id);
  if (!architecture) return [];

  const memberIds = new Set(constellation.satelliteIds);
  const members = satellites.filter((satellite) => memberIds.has(satellite.id));
  const membersByShell = new Map<string, SatelliteModel[]>(
    architecture.shells.map((shell) => [shell.id, []]),
  );

  members.forEach((satellite) => {
    const match = architecture.shells
      .map((shell) => ({ shell, score: shellMatchScore(satellite, shell) }))
      .filter((candidate): candidate is { shell: ConstellationArchitectureShell; score: number } =>
        candidate.score !== null,
      )
      .sort((left, right) => left.score - right.score)[0];
    if (match) membersByShell.get(match.shell.id)?.push(satellite);
  });

  return architecture.shells.map((definition) => {
    const matchedMembers = membersByShell.get(definition.id) ?? [];
    const memberAltitudes = matchedMembers.map(altitudeKm);
    const memberInclinations = matchedMembers.map(
      (satellite) => satellite.keplerian.inclinationDeg,
    );
    const deriveFromMembers =
      definition.geometrySource === "displayed-members" && matchedMembers.length > 0;

    return {
      definition,
      altitudeKm: deriveFromMembers ? median(memberAltitudes) : definition.altitudeKm,
      inclinationDeg: deriveFromMembers ? median(memberInclinations) : definition.inclinationDeg,
      matchedMembers,
      validation: {
        displayedMatchCount: matchedMembers.length,
        altitudeRangeKm: range(memberAltitudes),
        inclinationRangeDeg: range(memberInclinations),
      },
    };
  });
}

export function circularAngleDistanceDeg(left: number, right: number): number {
  const difference = Math.abs(((left - right + 540) % 360) - 180);
  return Math.min(180, difference);
}

export function shellLatitudeLimitDeg(inclinationDeg: number): number {
  return Math.min(inclinationDeg, 180 - inclinationDeg);
}

export function representativePlaneIndices(shell: ConstellationArchitectureShell): number[] {
  const count = Math.min(shell.planeCount, shell.representativePlanes);
  return Array.from(
    { length: count },
    (_, index) => Math.floor((index * shell.planeCount) / count),
  );
}

export function representativePlaneRaanDeg(
  shell: ConstellationArchitectureShell,
  planeIndex: number,
): number {
  return (shell.raanOffsetDeg + planeIndex * shell.planeSpacingDeg) % 360;
}

export function closestDisplayedMemberForPlane(
  geometry: ResolvedConstellationShellGeometry,
  targetRaanDeg: number,
  excludedIds: ReadonlySet<string>,
): SatelliteModel | undefined {
  if (geometry.definition.geometrySource !== "displayed-members") return undefined;

  const closest = geometry.matchedMembers
    .filter((member) => !excludedIds.has(member.id))
    .sort(
      (left, right) =>
        circularAngleDistanceDeg(left.keplerian.raanDeg, targetRaanDeg) -
        circularAngleDistanceDeg(right.keplerian.raanDeg, targetRaanDeg),
    )[0];
  const maximumRepresentativeDeltaDeg = Math.max(
    12,
    geometry.definition.planeSpacingDeg * 0.75,
  );

  return closest &&
    circularAngleDistanceDeg(closest.keplerian.raanDeg, targetRaanDeg) <=
      maximumRepresentativeDeltaDeg
    ? closest
    : undefined;
}
