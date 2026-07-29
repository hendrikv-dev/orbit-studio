import { EARTH_RADIUS_KM } from "../physics/constants";
import { keplerianToCartesian } from "../physics/kepler";
import type { CartesianState, KeplerianElements } from "../physics/types";
import type { TleData } from "../physics/tle";
import { NASA_GIBS_KNOWN_SAFE_DATE } from "../data/earthLayers";
import type { EarthCloudMode, EarthLayerStatus } from "../data/earthLayers";

export const APP_VERSION = "0.1.0";
export const PRODUCT_NAME = "Orbit Studio";

export type PropagationMode = "two-body" | "sgp4" | "advanced";
export type EditorMode = "keplerian" | "cartesian" | "tle" | "visualization";
export type CameraMode = "free" | "follow-satellite" | "earth-fixed" | "inertial" | "ground-station";
export type ViewPreset = "free" | "equatorial" | "polar" | "follow" | "ground-track";
export type QualityLevel = "low" | "medium" | "high";
export type EducationalOverlay =
  | "none"
  | "inclination"
  | "altitude"
  | "eccentricity"
  | "raan"
  | "argument-of-periapsis"
  | "true-anomaly"
  | "coverage"
  | "ground-track"
  | "sensor-footprint";
export type EarthDebugMode =
  | "full"
  | "base-texture"
  | "base-lighting"
  | "base-clouds"
  | "base-atmosphere"
  | "night-lights";
export type RegionType = "country" | "state" | "city" | "custom-circle" | "custom-polygon";
export type OrbitalObjectCategory = "payloads" | "rocket-bodies" | "debris" | "unknown";
export type CoverageTargetType = "satellite" | "constellation" | "sensor" | "ground-station";
export type ConstellationGeneratorKind =
  | "manual"
  | "walker-delta"
  | "circular-ring"
  | "polar-network";
export type SelectedObjectType =
  | "none"
  | "satellite"
  | "constellation"
  | "ground-station"
  | "region"
  | "catalog-object";

export interface RenderSettings {
  quality: QualityLevel;
  showClouds: boolean;
  showNightLights: boolean;
  showAtmosphere: boolean;
  showLatLonGrid: boolean;
  showEciGrid: boolean;
  showEcefGrid: boolean;
  showCoverageLayer: boolean;
  educationalOverlay: EducationalOverlay;
  earthTextureSource: string;
  earthCloudMode: EarthCloudMode;
  earthCloudOpacity: number;
  earthCloudIntensity: number;
  earthDataOverlayOpacity: number;
  earthLiveLayerStatus: EarthLayerStatus;
  earthLiveLayerDate: string;
  earthLiveLayerUpdatedAt: string | null;
  earthLiveLayerError: string | null;
  earthDebugMode: EarthDebugMode;
  atmosphereIntensity: number;
  atmosphereFalloff: number;
  atmosphereScale: number;
  atmosphereDayContribution: number;
  atmosphereNightContribution: number;
  atmosphereColor: string;
  showGeoValidationOverlay: boolean;
  showStarOcclusionDiagnostics: boolean;
}

export interface CameraSettings {
  cameraMode: CameraMode;
  viewPreset: ViewPreset;
  followSelectedObject: boolean;
  followSatelliteId?: string | null;
  groundStationViewId?: string | null;
}

export interface SatelliteVisualization {
  color: string;
  visible: boolean;
  showTrail: boolean;
  showGroundTrack: boolean;
}

export interface SatelliteSensorSettings {
  enabled: boolean;
  halfAngleDeg: number;
  maxRangeKm?: number | null;
  showCone: boolean;
  showFootprint: boolean;
}

export interface SatelliteCatalogMetadata {
  categoryId: OrbitalObjectCategory;
  objectType?: string;
  catalogNumber?: string;
  operator?: string;
  country?: string;
  sourceId?: string;
  orbitStateProvenance?:
    | "current-source"
    | "exact-historical"
    | "nearest-historical"
    | "reconstructed-historical";
}

export interface SatelliteModel {
  id: string;
  name: string;
  constellationId?: string | null;
  catalogMetadata?: SatelliteCatalogMetadata;
  propagationMode: PropagationMode;
  editorMode: EditorMode;
  keplerian: KeplerianElements;
  cartesian: CartesianState;
  tle?: TleData;
  visualization: SatelliteVisualization;
  sensor: SatelliteSensorSettings;
}

export interface RegionPoint {
  latitudeDeg: number;
  longitudeDeg: number;
}

export type RegionBoundary =
  | {
      kind: "circle";
      centerLatitudeDeg: number;
      centerLongitudeDeg: number;
      radiusDeg: number;
    }
  | {
      kind: "polygon";
      points: RegionPoint[];
    };

export interface RegionModel {
  id: string;
  name: string;
  type: RegionType;
  boundary: RegionBoundary;
  color: string;
  visible: boolean;
  showLabel: boolean;
  source?: string;
}

export interface ConstellationGeneratorSettings {
  kind: ConstellationGeneratorKind;
  totalSatellites?: number;
  planes?: number;
  phasing?: number;
  altitudeKm?: number;
  count?: number;
  inclinationDeg?: number;
  createdAt?: string;
}

export interface ConstellationModel {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  satelliteIds: string[];
  generator: ConstellationGeneratorSettings;
}

export interface CoverageSettings {
  enabled: boolean;
  targetType: CoverageTargetType;
  targetId: string | null;
  showFutureVisibility: boolean;
  lookAheadMinutes: number;
}

export interface GroundStationModel {
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeMeters: number;
  minimumElevationDeg: number;
  antennaRangeKm?: number | null;
  bands?: string[];
  color: string;
  visible: boolean;
  showCoverageCone: boolean;
  showHorizonCircle: boolean;
  notes?: string;
  source?: string;
}

export interface CatalogObjectModel {
  id: string;
  noradCatalogNumber?: number;
  name: string;
  objectType?: string;
  launchDate?: string;
  tleEpoch?: string;
  source: string;
  propagationMode: PropagationMode;
  visible: boolean;
  tle?: TleData;
  keplerian?: KeplerianElements;
}

export interface CatalogSnapshotMetadata {
  id: string;
  name: string;
  epoch: string;
  source: string;
  importedAt: string;
}

export interface CatalogLayerModel {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  loaded: boolean;
  source: string;
  objects: CatalogObjectModel[];
  snapshotMetadata?: CatalogSnapshotMetadata;
  fullCatalogAvailable: boolean;
  historicalCatalogAvailable: boolean;
}

export interface Scenario {
  appVersion: string;
  name: string;
  simulationEpoch: string;
  simulationTimeUtc: string;
  timeScale: number;
  isReverse: boolean;
  renderSettings: RenderSettings;
  cameraSettings: CameraSettings;
  teacherMode: boolean;
  coverageSettings: CoverageSettings;
  selectedObjectType: SelectedObjectType;
  selectedObjectId: string | null;
  satellites: SatelliteModel[];
  constellations: ConstellationModel[];
  groundStations: GroundStationModel[];
  regions: RegionModel[];
  catalogLayers: CatalogLayerModel[];
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createSampleKeplerian(epoch: Date): KeplerianElements {
  return {
    semiMajorAxisKm: EARTH_RADIUS_KM + 550,
    eccentricity: 0.0012,
    inclinationDeg: 51.64,
    raanDeg: 38,
    argumentOfPeriapsisDeg: 12,
    trueAnomalyDeg: 144,
    epoch: epoch.toISOString(),
  };
}

export function createSatellite(
  name: string,
  epoch: Date,
  overrides: Partial<SatelliteModel> = {},
): SatelliteModel {
  const keplerian = overrides.keplerian ?? createSampleKeplerian(epoch);
  const cartesian = overrides.cartesian ?? keplerianToCartesian(keplerian);

  return {
    id: overrides.id ?? createId("sat"),
    name,
    constellationId: overrides.constellationId ?? null,
    catalogMetadata: overrides.catalogMetadata,
    propagationMode: overrides.propagationMode ?? "two-body",
    editorMode: overrides.editorMode ?? "keplerian",
    keplerian,
    cartesian,
    tle: overrides.tle,
    visualization: {
      color: "#5eead4",
      visible: true,
      showTrail: true,
      showGroundTrack: true,
      ...overrides.visualization,
    },
    sensor: {
      enabled: true,
      halfAngleDeg: 18,
      maxRangeKm: null,
      showCone: true,
      showFootprint: true,
      ...overrides.sensor,
    },
  };
}

export function createRegion(
  name: string,
  type: RegionType,
  boundary: RegionBoundary,
  overrides: Partial<RegionModel> = {},
): RegionModel {
  return {
    id: overrides.id ?? createId("region"),
    name,
    type,
    boundary,
    color: overrides.color ?? "#22d3ee",
    visible: overrides.visible ?? true,
    showLabel: overrides.showLabel ?? true,
    source: overrides.source,
  };
}

export function createConstellation(
  name: string,
  satelliteIds: string[] = [],
  overrides: Partial<ConstellationModel> = {},
): ConstellationModel {
  return {
    id: overrides.id ?? createId("constellation"),
    name,
    color: overrides.color ?? "#67e8f9",
    visible: overrides.visible ?? true,
    satelliteIds,
    generator: {
      kind: "manual",
      createdAt: new Date().toISOString(),
      ...overrides.generator,
    },
  };
}

export function createDemoRegions(): RegionModel[] {
  return [
    createRegion(
      "Portland",
      "city",
      {
        kind: "circle",
        centerLatitudeDeg: 45.5152,
        centerLongitudeDeg: -122.6784,
        radiusDeg: 0.65,
      },
      {
        color: "#67e8f9",
        source: "Simplified classroom city region.",
      },
    ),
    createRegion(
      "Seattle",
      "city",
      {
        kind: "circle",
        centerLatitudeDeg: 47.6062,
        centerLongitudeDeg: -122.3321,
        radiusDeg: 0.72,
      },
      {
        color: "#5eead4",
        source: "Simplified classroom city region.",
      },
    ),
    createRegion(
      "New York",
      "city",
      {
        kind: "circle",
        centerLatitudeDeg: 40.7128,
        centerLongitudeDeg: -74.006,
        radiusDeg: 0.78,
      },
      {
        color: "#a78bfa",
        source: "Simplified classroom city region.",
      },
    ),
    createRegion(
      "London",
      "city",
      {
        kind: "circle",
        centerLatitudeDeg: 51.5074,
        centerLongitudeDeg: -0.1278,
        radiusDeg: 0.72,
      },
      {
        color: "#38bdf8",
        source: "Simplified classroom city region.",
      },
    ),
    createRegion(
      "Tokyo",
      "city",
      {
        kind: "circle",
        centerLatitudeDeg: 35.6762,
        centerLongitudeDeg: 139.6503,
        radiusDeg: 0.85,
      },
      {
        color: "#c4b5fd",
        source: "Simplified classroom city region.",
      },
    ),
    createRegion(
      "Australia",
      "country",
      {
        kind: "polygon",
        points: [
          { latitudeDeg: -10, longitudeDeg: 113 },
          { latitudeDeg: -12, longitudeDeg: 153 },
          { latitudeDeg: -28, longitudeDeg: 155 },
          { latitudeDeg: -44, longitudeDeg: 132 },
          { latitudeDeg: -35, longitudeDeg: 113 },
        ],
      },
      {
        color: "#60a5fa",
        source: "Simplified classroom polygon boundary.",
      },
    ),
    createRegion(
      "Europe",
      "country",
      {
        kind: "polygon",
        points: [
          { latitudeDeg: 36, longitudeDeg: -10 },
          { latitudeDeg: 58, longitudeDeg: -6 },
          { latitudeDeg: 71, longitudeDeg: 25 },
          { latitudeDeg: 58, longitudeDeg: 55 },
          { latitudeDeg: 41, longitudeDeg: 43 },
          { latitudeDeg: 36, longitudeDeg: 12 },
        ],
      },
      {
        color: "#22d3ee",
        source: "Simplified classroom polygon boundary.",
      },
    ),
    createRegion(
      "United States",
      "country",
      {
        kind: "polygon",
        points: [
          { latitudeDeg: 49, longitudeDeg: -125 },
          { latitudeDeg: 49, longitudeDeg: -67 },
          { latitudeDeg: 31, longitudeDeg: -80 },
          { latitudeDeg: 25, longitudeDeg: -97 },
          { latitudeDeg: 32, longitudeDeg: -117 },
        ],
      },
      {
        color: "#2dd4bf",
        source: "Simplified contiguous U.S. classroom polygon boundary.",
      },
    ),
  ];
}

export function createGroundStation(
  name: string,
  latitudeDeg: number,
  longitudeDeg: number,
  overrides: Partial<GroundStationModel> = {},
): GroundStationModel {
  return {
    id: overrides.id ?? createId("gs"),
    name,
    latitudeDeg,
    longitudeDeg,
    altitudeMeters: overrides.altitudeMeters ?? 0,
    minimumElevationDeg: overrides.minimumElevationDeg ?? 10,
    antennaRangeKm: overrides.antennaRangeKm ?? null,
    bands: overrides.bands ?? [],
    color: overrides.color ?? "#fbbf24",
    visible: overrides.visible ?? true,
    showCoverageCone: overrides.showCoverageCone ?? true,
    showHorizonCircle: overrides.showHorizonCircle ?? true,
    notes: overrides.notes,
    source: overrides.source,
  };
}

export function createDemoGroundStations(): GroundStationModel[] {
  return [
    createGroundStation("Goldstone DSS-14", 35.4267, -116.89, {
      altitudeMeters: 1000,
      minimumElevationDeg: 10,
      antennaRangeKm: 75000,
      bands: ["S", "X", "Ka"],
      color: "#fbbf24",
      source: "NASA DSN public station coordinates, approximate.",
    }),
    createGroundStation("Madrid DSS-63", 40.4314, -4.2486, {
      altitudeMeters: 865,
      minimumElevationDeg: 10,
      antennaRangeKm: 75000,
      bands: ["S", "X", "Ka"],
      color: "#93c5fd",
      source: "NASA DSN public station coordinates, approximate.",
    }),
    createGroundStation("Canberra DSS-43", -35.402, 148.981, {
      altitudeMeters: 689,
      minimumElevationDeg: 10,
      antennaRangeKm: 75000,
      bands: ["S", "X", "Ka"],
      color: "#f472b6",
      source: "NASA DSN public station coordinates, approximate.",
    }),
  ];
}

export function createSampleCatalogLayer(epoch: Date): CatalogLayerModel {
  return {
    id: "sample-catalog-layer",
    name: "Sample Catalog",
    description: "Small bundled catalog sample for rendering architecture and filtering workflows.",
    visible: true,
    loaded: false,
    source: "Bundled demo data; representative public satellite metadata, not a live catalog.",
    fullCatalogAvailable: false,
    historicalCatalogAvailable: false,
    objects: [
      {
        id: "cat-iss",
        noradCatalogNumber: 25544,
        name: "ISS (sample)",
        objectType: "active payload",
        launchDate: "1998-11-20",
        tleEpoch: epoch.toISOString(),
        source: "Bundled sample object; import current TLE snapshot for operational use.",
        propagationMode: "two-body",
        visible: true,
        keplerian: {
          semiMajorAxisKm: EARTH_RADIUS_KM + 420,
          eccentricity: 0.0005,
          inclinationDeg: 51.64,
          raanDeg: 92,
          argumentOfPeriapsisDeg: 40,
          trueAnomalyDeg: 20,
          epoch: epoch.toISOString(),
        },
      },
      {
        id: "cat-gps",
        noradCatalogNumber: 40105,
        name: "GPS MEO (sample)",
        objectType: "navigation",
        launchDate: "2014-08-02",
        tleEpoch: epoch.toISOString(),
        source: "Bundled sample object; not a live catalog entry.",
        propagationMode: "two-body",
        visible: true,
        keplerian: {
          semiMajorAxisKm: 26560,
          eccentricity: 0.01,
          inclinationDeg: 55,
          raanDeg: 185,
          argumentOfPeriapsisDeg: 25,
          trueAnomalyDeg: 160,
          epoch: epoch.toISOString(),
        },
      },
      {
        id: "cat-geo",
        name: "GEO Comsat (sample)",
        objectType: "active payload",
        tleEpoch: epoch.toISOString(),
        source: "Bundled sample object; not a live catalog entry.",
        propagationMode: "two-body",
        visible: true,
        keplerian: {
          semiMajorAxisKm: 42164,
          eccentricity: 0.0002,
          inclinationDeg: 0.2,
          raanDeg: 0,
          argumentOfPeriapsisDeg: 0,
          trueAnomalyDeg: 286,
          epoch: epoch.toISOString(),
        },
      },
    ],
  };
}

export function createDefaultScenario(now = new Date()): Scenario {
  const simulationEpoch = now.toISOString();
  const demoSatellite = createSatellite("Orbiter-1 Demo", now);
  const catalogLayer = createSampleCatalogLayer(now);
  const demoConstellation = createConstellation("Demo Constellation", [demoSatellite.id], {
    id: "demo-constellation",
    color: "#67e8f9",
    generator: {
      kind: "manual",
      createdAt: simulationEpoch,
    },
  });
  demoSatellite.constellationId = demoConstellation.id;

  return {
    appVersion: APP_VERSION,
    name: "Classroom Mission Playground",
    simulationEpoch,
    simulationTimeUtc: simulationEpoch,
    timeScale: 1,
    isReverse: false,
    renderSettings: {
      quality: "high",
      showClouds: false,
      showNightLights: false,
      showAtmosphere: false,
      showLatLonGrid: true,
      showEciGrid: true,
      showEcefGrid: false,
      showCoverageLayer: true,
      educationalOverlay: "coverage",
      earthTextureSource:
        "NASA Blue Marble: Next Generation January global map with Natural Earth vector coastline overlay.",
      earthCloudMode: "off",
      earthCloudOpacity: 0,
      earthCloudIntensity: 0,
      earthDataOverlayOpacity: 0.18,
      earthLiveLayerStatus: "idle",
      earthLiveLayerDate: NASA_GIBS_KNOWN_SAFE_DATE,
      earthLiveLayerUpdatedAt: null,
      earthLiveLayerError: null,
      earthDebugMode: "full",
      atmosphereIntensity: 0.24,
      atmosphereFalloff: 3.8,
      atmosphereScale: 1.024,
      atmosphereDayContribution: 0.72,
      atmosphereNightContribution: 0.14,
      atmosphereColor: "#78c9ff",
      showGeoValidationOverlay: true,
      showStarOcclusionDiagnostics: false,
    },
    cameraSettings: {
      cameraMode: "free",
      viewPreset: "free",
      followSelectedObject: false,
      followSatelliteId: null,
      groundStationViewId: null,
    },
    teacherMode: false,
    coverageSettings: {
      enabled: true,
      targetType: "satellite",
      targetId: demoSatellite.id,
      showFutureVisibility: true,
      lookAheadMinutes: 180,
    },
    selectedObjectType: "satellite",
    selectedObjectId: demoSatellite.id,
    satellites: [demoSatellite],
    constellations: [demoConstellation],
    groundStations: createDemoGroundStations(),
    regions: createDemoRegions(),
    catalogLayers: [catalogLayer],
  };
}

export function createPlaygroundScenario(now = new Date(), seedSatellite?: SatelliteModel): Scenario {
  const simulationEpoch = now.toISOString();
  const sourceSatellite = seedSatellite ?? createSatellite("Satellite 1", now, {
    keplerian: {
      ...createSampleKeplerian(now),
      trueAnomalyDeg: 324,
    },
  });
  const satellite: SatelliteModel = {
    ...sourceSatellite,
    name: seedSatellite?.name ?? "Satellite 1",
    constellationId: null,
    catalogMetadata: undefined,
    propagationMode: sourceSatellite.propagationMode === "advanced" ? "two-body" : sourceSatellite.propagationMode,
    editorMode: "keplerian",
    visualization: {
      ...sourceSatellite.visualization,
      visible: true,
      showTrail: true,
      showGroundTrack: true,
    },
    sensor: {
      ...sourceSatellite.sensor,
      enabled: false,
      showCone: false,
      showFootprint: false,
    },
  };

  return {
    appVersion: APP_VERSION,
    name: "Playground",
    simulationEpoch,
    simulationTimeUtc: simulationEpoch,
    timeScale: 1_250,
    isReverse: false,
    renderSettings: {
      quality: "high",
      showClouds: false,
      showNightLights: false,
      showAtmosphere: false,
      showLatLonGrid: false,
      showEciGrid: false,
      showEcefGrid: false,
      showCoverageLayer: false,
      educationalOverlay: "none",
      earthTextureSource:
        "NASA Blue Marble: Next Generation January global map with Natural Earth vector coastline overlay.",
      earthCloudMode: "off",
      earthCloudOpacity: 0,
      earthCloudIntensity: 0,
      earthDataOverlayOpacity: 0.18,
      earthLiveLayerStatus: "idle",
      earthLiveLayerDate: NASA_GIBS_KNOWN_SAFE_DATE,
      earthLiveLayerUpdatedAt: null,
      earthLiveLayerError: null,
      earthDebugMode: "full",
      atmosphereIntensity: 0.24,
      atmosphereFalloff: 3.8,
      atmosphereScale: 1.024,
      atmosphereDayContribution: 0.72,
      atmosphereNightContribution: 0.14,
      atmosphereColor: "#78c9ff",
      showGeoValidationOverlay: false,
      showStarOcclusionDiagnostics: false,
    },
    cameraSettings: {
      cameraMode: "free",
      viewPreset: "free",
      followSelectedObject: false,
      followSatelliteId: null,
      groundStationViewId: null,
    },
    teacherMode: false,
    coverageSettings: {
      enabled: false,
      targetType: "satellite",
      targetId: satellite.id,
      showFutureVisibility: false,
      lookAheadMinutes: 180,
    },
    selectedObjectType: "satellite",
    selectedObjectId: satellite.id,
    satellites: [satellite],
    constellations: [],
    groundStations: [],
    regions: [],
    catalogLayers: [],
  };
}

export function normalizeImportedScenario(value: unknown): Scenario {
  if (!value || typeof value !== "object") {
    throw new Error("Scenario JSON must be an object.");
  }

  const candidate = value as Partial<Scenario> & { currentSimulationTime?: unknown };
  if (!Array.isArray(candidate.satellites)) {
    throw new Error("Scenario JSON must include a satellite list.");
  }

  const now = new Date();
  const fallback = createDefaultScenario(now);
  const importedSimulationTime =
    typeof candidate.simulationTimeUtc === "string"
      ? candidate.simulationTimeUtc
      : typeof candidate.currentSimulationTime === "string"
        ? candidate.currentSimulationTime
        : null;
  const simulationTimeUtc =
    importedSimulationTime && Number.isFinite(Date.parse(importedSimulationTime))
      ? new Date(importedSimulationTime).toISOString()
      : fallback.simulationTimeUtc;

  const satellites = Array.isArray(candidate.satellites) ? candidate.satellites : [];
  const constellations = Array.isArray(candidate.constellations) ? candidate.constellations : [];
  const groundStations = Array.isArray(candidate.groundStations) ? candidate.groundStations : [];
  const regions = Array.isArray(candidate.regions) ? candidate.regions : [];
  const catalogLayers = Array.isArray(candidate.catalogLayers) ? candidate.catalogLayers : [];
  const selectedObjectType: SelectedObjectType =
    candidate.selectedObjectType === "none" ||
    candidate.selectedObjectType === "satellite" ||
    candidate.selectedObjectType === "constellation" ||
    candidate.selectedObjectType === "ground-station" ||
    candidate.selectedObjectType === "region" ||
    candidate.selectedObjectType === "catalog-object"
      ? candidate.selectedObjectType
      : fallback.selectedObjectType;

  return {
    appVersion: typeof candidate.appVersion === "string" ? candidate.appVersion : APP_VERSION,
    name: typeof candidate.name === "string" ? candidate.name : fallback.name,
    simulationEpoch:
      typeof candidate.simulationEpoch === "string" &&
      Number.isFinite(Date.parse(candidate.simulationEpoch))
        ? candidate.simulationEpoch
        : fallback.simulationEpoch,
    simulationTimeUtc,
    timeScale:
      typeof candidate.timeScale === "number" && Number.isFinite(candidate.timeScale)
        ? candidate.timeScale
        : fallback.timeScale,
    isReverse: Boolean(candidate.isReverse),
    renderSettings: {
      ...fallback.renderSettings,
      ...(candidate.renderSettings ?? {}),
    },
    cameraSettings: {
      ...fallback.cameraSettings,
      ...(candidate.cameraSettings ?? {}),
    },
    teacherMode: Boolean(candidate.teacherMode),
    coverageSettings: {
      ...fallback.coverageSettings,
      ...(candidate.coverageSettings ?? {}),
    },
    selectedObjectType,
    selectedObjectId:
      selectedObjectType === "none" || candidate.selectedObjectId === null
        ? null
        : typeof candidate.selectedObjectId === "string"
          ? candidate.selectedObjectId
          : fallback.selectedObjectId,
    satellites: satellites.map((satellite, index) => {
      const sat = satellite as Partial<SatelliteModel>;
      const epoch = new Date(simulationTimeUtc);
      const keplerian = sat.keplerian ?? createSampleKeplerian(epoch);
      const cartesian = sat.cartesian ?? keplerianToCartesian(keplerian);

      return {
        id: typeof sat.id === "string" ? sat.id : createId("sat"),
        name: typeof sat.name === "string" ? sat.name : `Imported Satellite ${index + 1}`,
        constellationId:
          typeof sat.constellationId === "string" ? sat.constellationId : sat.constellationId ?? null,
        catalogMetadata: sat.catalogMetadata,
        propagationMode: sat.propagationMode ?? "two-body",
        editorMode: sat.editorMode ?? "keplerian",
        keplerian,
        cartesian,
        tle: sat.tle,
        visualization: {
          color: "#5eead4",
          visible: true,
          showTrail: true,
          showGroundTrack: false,
          ...(sat.visualization ?? {}),
        },
        sensor: {
          enabled: true,
          halfAngleDeg: 18,
          maxRangeKm: null,
          showCone: false,
          showFootprint: false,
          ...(sat.sensor ?? {}),
        },
      };
    }),
    constellations: constellations.map((constellation, index) => {
      const item = constellation as Partial<ConstellationModel>;
      return createConstellation(
        typeof item.name === "string" ? item.name : `Constellation ${index + 1}`,
        Array.isArray(item.satelliteIds) ? item.satelliteIds.filter(Boolean) : [],
        {
          ...item,
          id: typeof item.id === "string" ? item.id : createId("constellation"),
          generator: {
            kind: "manual",
            createdAt: simulationTimeUtc,
            ...(item.generator ?? {}),
          },
        },
      );
    }),
    groundStations: groundStations.map((station, index) => {
      const gs = station as Partial<GroundStationModel>;
      return createGroundStation(
        typeof gs.name === "string" ? gs.name : `Imported Station ${index + 1}`,
        Number.isFinite(gs.latitudeDeg) ? Number(gs.latitudeDeg) : 0,
        Number.isFinite(gs.longitudeDeg) ? Number(gs.longitudeDeg) : 0,
        {
          ...gs,
          id: typeof gs.id === "string" ? gs.id : createId("gs"),
        },
      );
    }),
    regions: regions.map((region, index) => {
      const item = region as Partial<RegionModel>;
      const fallbackRegion = fallback.regions[index] ?? createDemoRegions()[0];
      return createRegion(
        typeof item.name === "string" ? item.name : `Region ${index + 1}`,
        item.type ?? "custom-circle",
        item.boundary ?? fallbackRegion.boundary,
        {
          ...item,
          id: typeof item.id === "string" ? item.id : createId("region"),
        },
      );
    }),
    catalogLayers: catalogLayers.map((layer, index) => {
      const cat = layer as Partial<CatalogLayerModel>;
      return {
        id: typeof cat.id === "string" ? cat.id : createId("cat-layer"),
        name: typeof cat.name === "string" ? cat.name : `Catalog Layer ${index + 1}`,
        description: cat.description ?? "Imported catalog layer.",
        visible: cat.visible ?? true,
        loaded: cat.loaded ?? true,
        source: cat.source ?? "Imported scenario JSON.",
        objects: Array.isArray(cat.objects) ? (cat.objects as CatalogObjectModel[]) : [],
        snapshotMetadata: cat.snapshotMetadata,
        fullCatalogAvailable: Boolean(cat.fullCatalogAvailable),
        historicalCatalogAvailable: Boolean(cat.historicalCatalogAvailable),
      };
    }),
  };
}
