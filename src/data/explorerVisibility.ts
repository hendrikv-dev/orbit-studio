import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  createSatellite,
  type ConstellationModel,
  type SatelliteModel,
} from "../lib/scenario";
import { explorerConstellationArchitectureFor } from "./explorerConstellationArchitecture";
import {
  closestDisplayedMemberForPlane,
  representativePlaneIndices,
  representativePlaneRaanDeg,
  resolveConstellationShellGeometries,
  type ResolvedConstellationShellGeometry,
} from "./explorerConstellationGeometry";
import type {
  ExplorerCatalogEntry,
  ExplorerCatalogSnapshotView,
  ExplorerCategoryId,
} from "./explorerCatalog";

export interface ExplorerVisibilityState {
  layers: Record<ExplorerCategoryId, boolean>;
  constellations: Record<string, boolean>;
  constellationSatellites: Record<string, boolean>;
  constellationOrbits: Record<string, boolean>;
  constellationShells: Record<string, boolean>;
  objects: Record<string, boolean>;
  selectedOrbitVisible: boolean;
}

export interface ExplorerResolvedVisibility {
  satelliteIds: string[];
  groundStationIds: string[];
  visibleObjectIds: ReadonlySet<string>;
  representativeOrbitConstellationIds: string[];
  shellConstellationIds: string[];
}

export interface ExplorerConstellationSummary {
  memberCount: number;
  systemPopulation: number;
  orbitalClassification: string;
  purpose: string;
  teachingSummary: string;
  inclinationFamilies: number;
  inclinationValuesDeg: number[];
  shellCount: number;
  shellLabels: string[];
  shells: Array<{
    id: string;
    label: string;
    altitudeKm: number;
    inclinationDeg: number;
    population: number;
    color: string;
    geometrySourceLabel: string;
    displayedMatchCount: number;
    displayedAltitudeRangeKm: [number, number] | null;
    displayedInclinationRangeDeg: [number, number] | null;
  }>;
  planeCount: number;
  altitudeRangeKm: [number, number];
  hasTeachingArchitecture: boolean;
}

export const defaultExplorerLayerVisibility: Record<ExplorerCategoryId, boolean> = {
  payloads: true,
  "rocket-bodies": true,
  components: true,
  debris: true,
  "ground-stations": false,
  constellations: true,
  missions: true,
  concepts: true,
};

export function createExplorerVisibilityState(): ExplorerVisibilityState {
  return {
    layers: { ...defaultExplorerLayerVisibility },
    constellations: {},
    constellationSatellites: {},
    constellationOrbits: {},
    constellationShells: {},
    objects: {},
    selectedOrbitVisible: true,
  };
}

export function explorerVisibilityLayer(entry: ExplorerCatalogEntry): ExplorerCategoryId {
  return entry.categoryId;
}

export function isExplorerEntryVisible(
  entry: ExplorerCatalogEntry,
  visibility: ExplorerVisibilityState,
): boolean {
  const constellationId =
    entry.selectionKind === "constellation" ? entry.id : entry.constellationId;
  const layerVisible = visibility.layers[entry.categoryId];
  const constellationLayerVisible =
    !constellationId || visibility.layers.constellations;
  const constellationVisible =
    !constellationId || visibility.constellations[constellationId] !== false;
  const constellationSatellitesVisible =
    !entry.constellationId || visibility.constellationSatellites[entry.constellationId] !== false;
  const objectVisible = visibility.objects[entry.id] !== false;

  return (
    layerVisible &&
    constellationLayerVisible &&
    constellationVisible &&
    constellationSatellitesVisible &&
    objectVisible
  );
}

export function resolveExplorerVisibility(
  view: ExplorerCatalogSnapshotView,
  filteredEntries: ExplorerCatalogEntry[],
  visibility: ExplorerVisibilityState,
  maximumSatelliteMarkers: number,
  selectedObjectId?: string | null,
): ExplorerResolvedVisibility {
  const visibleEntries = filteredEntries.filter((entry) =>
    isExplorerEntryVisible(entry, visibility),
  );
  const matchingSatelliteIds = visibleEntries
    .filter(
      (entry) =>
        entry.selectionKind === "satellite" &&
        entry.visualRole === "selectable-orbital-object",
    )
    .map((entry) => entry.id);
  const satelliteIds = matchingSatelliteIds.slice(0, maximumSatelliteMarkers);
  const selectedEntry = selectedObjectId ? view.byId.get(selectedObjectId) : undefined;
  const selectedSatelliteIsVisible = Boolean(
    selectedEntry &&
      selectedEntry.selectionKind === "satellite" &&
      selectedEntry.visualRole === "selectable-orbital-object" &&
      isExplorerEntryVisible(selectedEntry, visibility),
  );
  if (selectedObjectId && selectedSatelliteIsVisible && !satelliteIds.includes(selectedObjectId)) {
    if (satelliteIds.length < maximumSatelliteMarkers) {
      satelliteIds.push(selectedObjectId);
    } else if (satelliteIds.length > 0) {
      satelliteIds[satelliteIds.length - 1] = selectedObjectId;
    }
  }
  const groundStationIds = visibleEntries
    .filter((entry) => entry.selectionKind === "ground-station")
    .map((entry) => entry.id);
  if (
    selectedObjectId &&
    selectedEntry?.selectionKind === "ground-station" &&
    isExplorerEntryVisible(selectedEntry, visibility) &&
    !groundStationIds.includes(selectedObjectId)
  ) {
    groundStationIds.push(selectedObjectId);
  }
  const visibleObjectIds = new Set([
    ...satelliteIds,
    ...groundStationIds,
    ...view.records
      .filter(
        (entry) =>
          entry.selectionKind === "constellation" &&
          visibility.layers.constellations &&
          visibility.constellations[entry.id] !== false,
      )
      .map((entry) => entry.id),
  ]);
  const representativeOrbitConstellationIds = view.records
    .filter(
      (entry) =>
        entry.selectionKind === "constellation" &&
        visibility.layers.constellations &&
        visibility.constellations[entry.id] !== false &&
        visibility.constellationOrbits[entry.id] === true,
    )
    .map((entry) => entry.id);
  const shellConstellationIds = view.records
    .filter(
      (entry) =>
        entry.selectionKind === "constellation" &&
        visibility.layers.constellations &&
        visibility.constellations[entry.id] !== false &&
        visibility.constellationShells[entry.id] === true,
    )
    .map((entry) => entry.id);

  return {
    satelliteIds,
    groundStationIds,
    visibleObjectIds,
    representativeOrbitConstellationIds,
    shellConstellationIds,
  };
}

function altitudeKm(satellite: SatelliteModel): number {
  return satellite.keplerian.semiMajorAxisKm - EARTH_RADIUS_KM;
}

function shellKey(satellite: SatelliteModel): string {
  const altitudeBand = Math.round(altitudeKm(satellite) / 250);
  const inclinationBand = Math.round(satellite.keplerian.inclinationDeg / 5);
  return `${altitudeBand}:${inclinationBand}`;
}

function architectureEpoch(members: SatelliteModel[]): Date {
  return new Date(members[0]?.keplerian.epoch ?? "2026-06-08T12:00:00.000Z");
}

function architectureSatellite(
  constellation: ConstellationModel,
  geometry: ResolvedConstellationShellGeometry,
  planeIndex: number,
  role: "representative-plane" | "shell",
  epoch: Date,
  sourceMember?: SatelliteModel,
): SatelliteModel {
  const shell = geometry.definition;
  const raanDeg = representativePlaneRaanDeg(shell, planeIndex);

  return createSatellite(`${constellation.name} ${shell.label}`, epoch, {
    id: `${constellation.id}:${role}:${shell.id}:${planeIndex}`,
    constellationId: constellation.id,
    keplerian: sourceMember
      ? { ...sourceMember.keplerian }
      : {
          semiMajorAxisKm: EARTH_RADIUS_KM + geometry.altitudeKm,
          eccentricity: 0.0004,
          inclinationDeg: geometry.inclinationDeg,
          raanDeg,
          argumentOfPeriapsisDeg: 0,
          trueAnomalyDeg: (planeIndex * 29) % 360,
          epoch: epoch.toISOString(),
        },
    visualization: {
      color: shell.color,
      visible: true,
      showTrail: true,
      showGroundTrack: false,
    },
    sensor: {
      enabled: false,
      halfAngleDeg: 18,
      maxRangeKm: null,
      showCone: false,
      showFootprint: false,
    },
  });
}

export function summarizeExplorerConstellation(
  constellation: ConstellationModel,
  satellites: SatelliteModel[],
): ExplorerConstellationSummary {
  const memberIds = new Set(constellation.satelliteIds);
  const members = satellites.filter((satellite) => memberIds.has(satellite.id));
  const architecture = explorerConstellationArchitectureFor(constellation.id);
  const resolvedGeometries = resolveConstellationShellGeometries(constellation, satellites);
  const shells = new Set(members.map(shellKey));
  const measuredInclinations = new Set(
    members.map((satellite) => Math.round(satellite.keplerian.inclinationDeg / 5)),
  );
  const averageAltitude =
    members.reduce((sum, satellite) => sum + altitudeKm(satellite), 0) /
    Math.max(1, members.length);
  const orbitalClassification =
    averageAltitude < 2_000
      ? "Low Earth orbit shell system"
      : averageAltitude < 30_000
        ? "Medium Earth orbit architecture"
        : "High-altitude orbital architecture";
  const memberAltitudes = members.map(altitudeKm);
  const measuredRange: [number, number] = memberAltitudes.length > 0
    ? [Math.min(...memberAltitudes), Math.max(...memberAltitudes)]
    : [0, 0];
  const architectureInclinations = architecture
    ? [...new Set(resolvedGeometries.map((geometry) => geometry.inclinationDeg))]
    : [];
  const architectureAltitudes = resolvedGeometries.map((geometry) => geometry.altitudeKm);
  const altitudeRangeKm: [number, number] = architectureAltitudes.length > 0
    ? [Math.min(...architectureAltitudes), Math.max(...architectureAltitudes)]
    : measuredRange;

  return {
    memberCount: members.length,
    systemPopulation: Math.max(architecture?.systemPopulation ?? 0, members.length),
    orbitalClassification: architecture?.orbitalClassification ?? orbitalClassification,
    purpose: architecture?.purpose ?? constellation.name,
    teachingSummary:
      architecture?.teachingSummary ??
      `${constellation.name} groups spacecraft into a coordinated orbital system.`,
    inclinationFamilies: architectureInclinations.length || measuredInclinations.size,
    inclinationValuesDeg:
      architectureInclinations.length > 0
        ? architectureInclinations
        : [...measuredInclinations].map((value) => value * 5),
    shellCount: architecture?.shells.length ?? shells.size,
    shellLabels: architecture?.shells.map((shell) => shell.label) ?? [],
    shells: resolvedGeometries.map((geometry) => ({
        id: geometry.definition.id,
        label: geometry.definition.label,
        altitudeKm: geometry.altitudeKm,
        inclinationDeg: geometry.inclinationDeg,
        population: geometry.definition.population,
        color: geometry.definition.color,
        geometrySourceLabel: geometry.definition.geometrySourceLabel,
        displayedMatchCount: geometry.validation.displayedMatchCount,
        displayedAltitudeRangeKm: geometry.validation.altitudeRangeKm,
        displayedInclinationRangeDeg: geometry.validation.inclinationRangeDeg,
      })),
    planeCount:
      architecture?.shells.reduce((sum, shell) => sum + shell.planeCount, 0) ?? shells.size,
    altitudeRangeKm,
    hasTeachingArchitecture: Boolean(architecture),
  };
}

export function representativeConstellationSatellites(
  constellation: ConstellationModel,
  satellites: SatelliteModel[],
  maximumPlanes = 12,
): SatelliteModel[] {
  const memberIds = new Set(constellation.satelliteIds);
  const members = satellites.filter((satellite) => memberIds.has(satellite.id));
  const architecture = explorerConstellationArchitectureFor(constellation.id);

  if (architecture) {
    const epoch = architectureEpoch(members);
    return resolveConstellationShellGeometries(constellation, satellites)
      .flatMap((geometry) => {
        const usedMemberIds = new Set<string>();
        return representativePlaneIndices(geometry.definition).map((planeIndex) => {
          const sourceMember = closestDisplayedMemberForPlane(
            geometry,
            representativePlaneRaanDeg(geometry.definition, planeIndex),
            usedMemberIds,
          );
          if (sourceMember) usedMemberIds.add(sourceMember.id);
          return architectureSatellite(
            constellation,
            geometry,
            planeIndex,
            "representative-plane",
            epoch,
            sourceMember,
          );
        });
      })
      .slice(0, maximumPlanes);
  }

  const shells = new Map<string, SatelliteModel[]>();

  members.forEach((satellite) => {
    const key = shellKey(satellite);
    shells.set(key, [...(shells.get(key) ?? []), satellite]);
  });

  const representatives: SatelliteModel[] = [];
  const orderedShells = [...shells.values()].sort((left, right) => right.length - left.length);

  for (const shell of orderedShells) {
    if (representatives.length >= maximumPlanes) break;
    const ordered = [...shell].sort(
      (left, right) => left.keplerian.raanDeg - right.keplerian.raanDeg,
    );
    const desiredPlanes = Math.min(
      6,
      ordered.length,
      Math.max(1, Math.ceil(Math.sqrt(ordered.length))),
      maximumPlanes - representatives.length,
    );

    for (let index = 0; index < desiredPlanes; index += 1) {
      const member = ordered[Math.floor((index * ordered.length) / desiredPlanes)];
      representatives.push({
        ...member,
        id: `${constellation.id}:representative-plane:${member.id}`,
        name: `${constellation.name} representative plane`,
        visualization: {
          ...member.visualization,
          color: constellation.color,
          visible: true,
          showTrail: true,
          showGroundTrack: false,
        },
      });
    }
  }

  return representatives;
}

export function representativeConstellationShells(
  constellation: ConstellationModel,
  satellites: SatelliteModel[],
  maximumShells = 8,
): SatelliteModel[] {
  const memberIds = new Set(constellation.satelliteIds);
  const members = satellites.filter((satellite) => memberIds.has(satellite.id));
  const architecture = explorerConstellationArchitectureFor(constellation.id);

  if (architecture) {
    const epoch = architectureEpoch(members);
    return resolveConstellationShellGeometries(constellation, satellites)
      .slice(0, maximumShells)
      .map((geometry) =>
        architectureSatellite(
          constellation,
          geometry,
          0,
          "shell",
          epoch,
        ),
      );
  }

  const shells = new Map<string, SatelliteModel[]>();

  members.forEach((satellite) => {
      const key = shellKey(satellite);
      shells.set(key, [...(shells.get(key) ?? []), satellite]);
    });

  return [...shells.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, maximumShells)
    .map(([key, shell]) => {
      const ordered = [...shell].sort(
        (left, right) => left.keplerian.raanDeg - right.keplerian.raanDeg,
      );
      const member = ordered[Math.floor(ordered.length / 2)];

      return {
        ...member,
        id: `${constellation.id}:shell:${key}`,
        name: `${constellation.name} shell`,
        visualization: {
          ...member.visualization,
          color: constellation.color,
          visible: true,
          showTrail: true,
          showGroundTrack: false,
        },
      };
    });
}
