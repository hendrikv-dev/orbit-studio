import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  createConstellation,
  createDefaultScenario,
  createGroundStation,
  createSatellite,
  type CatalogObjectModel,
  type GroundStationModel,
  type SatelliteModel,
  type Scenario,
} from "../lib/scenario";
import type { TleData } from "../physics/tle";
import { explorerConstellationSemanticTerms } from "./explorerConstellationArchitecture";
import {
  explorerCanonicalSatellitePeriods,
  explorerHistoricalCatalog,
  explorerHistoricalCatalogIsLoaded,
  explorerHistoricalCatalogIndex,
  explorerLatestPublicCatalogSnapshot,
  historicalCatalogCoverageForDate,
  type ExplorerHistoricalCatalogObject,
  type ExplorerHistoricalOrbitState,
} from "./explorerHistoricalCatalog";
import {
  queryHistoricalCatalog,
  type HistoricalCatalogWorldObject,
  type HistoricalOrbitAvailability,
} from "./explorerHistoricalPipeline";
export { prioritizeExplorerSearchResults } from "./explorerDiscovery";

if (!explorerLatestPublicCatalogSnapshot) {
  throw new Error("The bundled GCAT catalog is missing latest-public-snapshot metadata.");
}

export const explorerLatestPublicCatalogDate =
  explorerLatestPublicCatalogSnapshot.timestampIso.slice(0, 10);
export const explorerCurrentCatalogMode = "release-public-gcat" as const;

export const explorerCategoryIds = [
  "payloads",
  "rocket-bodies",
  "components",
  "debris",
  "ground-stations",
  "constellations",
  "missions",
  "concepts",
] as const;

export type ExplorerCategoryId = (typeof explorerCategoryIds)[number];
export type ExplorerSelectionKind =
  | "satellite"
  | "ground-station"
  | "constellation"
  | "catalog-object";

export interface ExplorerCatalogSource {
  id: string;
  name: string;
  description: string;
  kind: "curated" | "tle-feed" | "historical-import" | "operator";
  supportsHistoricalSnapshots: boolean;
  updateCadence: "static" | "daily" | "operator-defined";
}

export interface ExplorerOrbitDefinition {
  altitudeKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  argumentOfPeriapsisDeg: number;
  trueAnomalyDeg: number;
  epoch?: string;
  color: string;
  sensorHalfAngleDeg?: number;
}

export type ExplorerOrbitAvailability =
  | HistoricalOrbitAvailability
  | "current-representative-orbit"
  | "curated-reference-orbit";

export interface ExplorerCatalogEntry {
  id: string;
  name: string;
  categoryId: ExplorerCategoryId;
  objectType: string;
  operator: string;
  country: string;
  launched: string;
  status: "Operational" | "Historical" | "Reference";
  summary: string;
  sourceId: string;
  catalogNumber?: string;
  alternateNames?: string[];
  internationalDesignator?: string;
  launchDate?: string;
  decayDate?: string;
  reentryDate?: string;
  sourceAttribution?: string[];
  constellationId?: string;
  selectionKind: ExplorerSelectionKind;
  visualRole: "selectable-orbital-object" | "catalog-reference";
  activeFromYear: number;
  activeToYear?: number;
  orbit?: ExplorerOrbitDefinition;
  tle?: TleData;
  groundStation?: Pick<
    GroundStationModel,
    "latitudeDeg" | "longitudeDeg" | "altitudeMeters" | "minimumElevationDeg"
  >;
  memberIds?: string[];
  semanticTerms?: string[];
  orbitAvailability?: ExplorerOrbitAvailability;
}

export interface ExplorerSnapshot {
  id: string;
  label: string;
  year: string;
  timestampIso: string;
  detail: string;
  milestone:
    | "Pre-Sputnik"
    | "Sputnik"
    | "Gagarin"
    | "Apollo 11"
    | "GPS"
    | "Hubble"
    | "ISS"
    | "Commercial Era"
    | "Starlink"
    | "Current";
  sourceId: string;
  catalogMode?: "current";
}

export interface ExplorerCatalogDataCoverage {
  status:
    | "current-loaded"
    | "latest-public-catalog"
    | "historical-loaded"
    | "historical-not-loaded";
  catalogObjectCount: number;
  /** Generic scene count of source-backed orbit states available to the physical scene. */
  renderableOrbitStateCount: number;
  /** Imported historical orbit records for the selected date or nearest source-backed historical epoch. */
  exactHistoricalOrbitStateCount?: number;
  /** Deterministic, metadata-constrained educational states, never historical fixes. */
  reconstructedHistoricalOrbitStateCount?: number;
  catalogOnlyObjectCount?: number;
  sourceLabels: string[];
  label: string;
  description: string;
}

export interface ExplorerCatalogSnapshotView {
  snapshot: ExplorerSnapshot;
  records: ExplorerCatalogEntry[];
  byId: ReadonlyMap<string, ExplorerCatalogEntry>;
  searchTextById: ReadonlyMap<string, string>;
  categoryCounts: ReadonlyMap<ExplorerCategoryId, number>;
  catalogObjectCount: number;
  renderableOrbitStateCount: number;
  dataCoverage: ExplorerCatalogDataCoverage;
}

export interface ExplorerCatalogFilters {
  query: string;
  categoryId: "all" | ExplorerCategoryId;
  status: "all" | ExplorerCatalogEntry["status"];
  operator: string;
  constellationId: string;
}

export const explorerCategoryHierarchy: Array<{
  id: ExplorerCategoryId;
  label: string;
  description: string;
}> = [
  { id: "payloads", label: "Payloads", description: "Operational and historical spacecraft" },
  { id: "rocket-bodies", label: "Rocket Bodies", description: "Launch vehicle stages in orbit" },
  { id: "components", label: "Components", description: "Separated functional and structural components" },
  { id: "debris", label: "Debris", description: "Tracked fragments and inactive material" },
  { id: "ground-stations", label: "Ground Stations", description: "Earth-based tracking infrastructure" },
  { id: "constellations", label: "Constellations", description: "Coordinated orbital systems" },
  { id: "missions", label: "Missions", description: "Historical mission reference records" },
  { id: "concepts", label: "Concepts", description: "Orbital regions and mission design ideas" },
];

export const explorerCatalogSources: ExplorerCatalogSource[] = [
  {
    id: "curated-reference",
    name: "Orbit Studio reference catalog",
    description: "Curated reference records used for object identity, topics, and current Explorer context.",
    kind: "curated",
    supportsHistoricalSnapshots: false,
    updateCadence: "static",
  },
  {
    id: "gcat-public-catalog",
    name: "GCAT public catalog",
    description:
      "Complete packaged Earth-object membership with deterministic educational orbit reconstruction where source orbital angles are unavailable.",
    kind: "historical-import",
    supportsHistoricalSnapshots: true,
    updateCadence: "static",
  },
  {
    id: "historical-import",
    name: "Imported catalog records",
    description:
      "Normalized historical records from explicitly identified source families.",
    kind: "historical-import",
    supportsHistoricalSnapshots: true,
    updateCadence: "static",
  },
];

const orbital = (
  entry: Omit<ExplorerCatalogEntry, "selectionKind" | "visualRole">,
): ExplorerCatalogEntry => ({
  ...entry,
  selectionKind: "satellite",
  visualRole: "selectable-orbital-object",
  orbitAvailability: entry.orbitAvailability ?? "curated-reference-orbit",
});

const reference = (
  entry: Omit<ExplorerCatalogEntry, "visualRole">,
): ExplorerCatalogEntry => ({
  ...entry,
  visualRole: "catalog-reference",
});

const curatedExplorerCatalog: ExplorerCatalogEntry[] = [
  orbital({
    id: "explorer-sputnik-1",
    name: "Sputnik 1",
    catalogNumber: "2",
    alternateNames: ["1-y ISZ"],
    categoryId: "payloads",
    objectType: "Historical payload",
    operator: "Soviet space program",
    country: "Soviet Union",
    launched: "1957",
    status: "Historical",
    summary: "The first artificial satellite, opening the age of tracked objects in Earth orbit.",
    sourceId: "curated-reference",
    activeFromYear: 1957,
    activeToYear: 1957,
    orbit: {
      altitudeKm: 577,
      eccentricity: 0.052,
      inclinationDeg: 65.1,
      raanDeg: 118,
      argumentOfPeriapsisDeg: 58,
      trueAnomalyDeg: 42,
      color: "#d7e6ef",
    },
  }),
  orbital({
    id: "explorer-vostok-1",
    name: "Vostok 1",
    categoryId: "missions",
    objectType: "Crewed mission spacecraft",
    operator: "Soviet space program",
    country: "Soviet Union",
    launched: "1961",
    status: "Historical",
    summary: "The spacecraft that carried Yuri Gagarin on the first human orbital flight.",
    sourceId: "curated-reference",
    activeFromYear: 1961,
    activeToYear: 1961,
    orbit: {
      altitudeKm: 245,
      eccentricity: 0.012,
      inclinationDeg: 64.95,
      raanDeg: 31,
      argumentOfPeriapsisDeg: 180,
      trueAnomalyDeg: 205,
      color: "#cbd5df",
    },
  }),
  orbital({
    id: "explorer-apollo-11-csm",
    name: "Apollo 11 Command Module",
    categoryId: "missions",
    objectType: "Crewed mission spacecraft",
    operator: "NASA",
    country: "United States",
    launched: "1969",
    status: "Historical",
    summary: "An Earth-orbit reference state from the mission that first landed people on the Moon.",
    sourceId: "curated-reference",
    activeFromYear: 1969,
    activeToYear: 1969,
    orbit: {
      altitudeKm: 185,
      eccentricity: 0.004,
      inclinationDeg: 32.5,
      raanDeg: 74,
      argumentOfPeriapsisDeg: 12,
      trueAnomalyDeg: 122,
      color: "#f0d99b",
    },
  }),
  orbital({
    id: "explorer-navstar-1",
    name: "Navstar 1",
    categoryId: "payloads",
    objectType: "Navigation payload",
    operator: "United States Air Force",
    country: "United States",
    launched: "1978",
    status: "Historical",
    summary: "The first Block I GPS development satellite.",
    sourceId: "curated-reference",
    activeFromYear: 1978,
    activeToYear: 1985,
    orbit: {
      altitudeKm: 20180,
      eccentricity: 0.01,
      inclinationDeg: 63,
      raanDeg: 48,
      argumentOfPeriapsisDeg: 22,
      trueAnomalyDeg: 140,
      color: "#77d9b4",
    },
  }),
  orbital({
    id: "explorer-iss",
    name: "International Space Station",
    catalogNumber: "25544",
    alternateNames: ["ISS"],
    categoryId: "payloads",
    objectType: "Crewed research payload",
    operator: "International partnership",
    country: "International",
    launched: "1998",
    status: "Operational",
    summary: "A continuously inhabited research laboratory in low Earth orbit.",
    sourceId: "curated-reference",
    activeFromYear: 1998,
    activeToYear: 2026,
    semanticTerms: ["iss", "zarya", "space station"],
    orbit: {
      altitudeKm: 420,
      eccentricity: 0.0005,
      inclinationDeg: 51.64,
      raanDeg: 92,
      argumentOfPeriapsisDeg: 40,
      trueAnomalyDeg: 20,
      color: "#75c8ff",
    },
  }),
  orbital({
    id: "explorer-hubble",
    name: "Hubble Space Telescope",
    catalogNumber: "20580",
    alternateNames: ["HST"],
    categoryId: "payloads",
    objectType: "Science payload",
    operator: "NASA / ESA",
    country: "United States",
    launched: "1990",
    status: "Operational",
    summary: "A space telescope observing from above most of Earth's atmosphere.",
    sourceId: "curated-reference",
    sourceAttribution: ["NASA / ESA mission reference"],
    activeFromYear: 1990,
    activeToYear: 2026,
    semanticTerms: ["hubble", "hst"],
    orbit: {
      altitudeKm: 535,
      eccentricity: 0.0003,
      inclinationDeg: 28.47,
      raanDeg: 64,
      argumentOfPeriapsisDeg: 18,
      trueAnomalyDeg: 156,
      color: "#c1cfdb",
    },
  }),
  orbital({
    id: "explorer-gps",
    name: "GPS IIF-7",
    categoryId: "payloads",
    objectType: "Navigation payload",
    operator: "U.S. Space Force",
    country: "United States",
    launched: "2014",
    status: "Operational",
    summary: "A representative spacecraft in the GPS navigation constellation.",
    sourceId: "curated-reference",
    constellationId: "explorer-gps-constellation",
    activeFromYear: 2014,
    activeToYear: 2026,
    semanticTerms: ["gps", "navstar"],
    orbit: {
      altitudeKm: 20180,
      eccentricity: 0.009,
      inclinationDeg: 55,
      raanDeg: 185,
      argumentOfPeriapsisDeg: 25,
      trueAnomalyDeg: 160,
      color: "#72d3ab",
    },
  }),
  orbital({
    id: "explorer-molniya-reference",
    name: "Molniya Orbit Reference",
    categoryId: "payloads",
    objectType: "Highly elliptical orbit reference",
    operator: "Orbit Studio",
    country: "Reference",
    launched: "2015",
    status: "Reference",
    summary: "A representative highly elliptical orbit that dwells over high northern latitudes.",
    sourceId: "curated-reference",
    activeFromYear: 2015,
    orbit: {
      altitudeKm: 26600 - EARTH_RADIUS_KM,
      eccentricity: 0.74,
      inclinationDeg: 63.4,
      raanDeg: 42,
      argumentOfPeriapsisDeg: 270,
      trueAnomalyDeg: 145,
      color: "#e0b96c",
    },
  }),
  orbital({
    id: "explorer-sentinel",
    name: "Sentinel-3A",
    categoryId: "payloads",
    objectType: "Earth observation payload",
    operator: "ESA / EUMETSAT",
    country: "Europe",
    launched: "2016",
    status: "Operational",
    summary: "A polar-orbiting environmental observation spacecraft.",
    sourceId: "curated-reference",
    activeFromYear: 2016,
    activeToYear: 2026,
    orbit: {
      altitudeKm: 814,
      eccentricity: 0.0012,
      inclinationDeg: 98.7,
      raanDeg: 132,
      argumentOfPeriapsisDeg: 12,
      trueAnomalyDeg: 250,
      color: "#d5dce5",
      sensorHalfAngleDeg: 18,
    },
  }),
  orbital({
    id: "explorer-goes",
    name: "GOES-16",
    categoryId: "payloads",
    objectType: "Weather payload",
    operator: "NOAA",
    country: "United States",
    launched: "2016",
    status: "Operational",
    summary: "A geostationary weather observatory over the Americas.",
    sourceId: "curated-reference",
    activeFromYear: 2016,
    activeToYear: 2026,
    orbit: {
      altitudeKm: 35786,
      eccentricity: 0.0002,
      inclinationDeg: 0.08,
      raanDeg: 0,
      argumentOfPeriapsisDeg: 0,
      trueAnomalyDeg: 286,
      color: "#77bfff",
      sensorHalfAngleDeg: 8,
    },
  }),
  reference({
    id: "explorer-starlink",
    name: "Starlink-30000",
    categoryId: "payloads",
    objectType: "Communications payload",
    operator: "SpaceX",
    country: "United States",
    launched: "2022",
    status: "Operational",
    summary: "A representative spacecraft from a large commercial low Earth orbit constellation.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 2022,
    semanticTerms: ["starlink", "spacex"],
    orbit: {
      altitudeKm: 550,
      eccentricity: 0.0002,
      inclinationDeg: 53.2,
      raanDeg: 220,
      argumentOfPeriapsisDeg: 0,
      trueAnomalyDeg: 305,
      color: "#a9c9dd",
    },
  }),
  reference({
    id: "explorer-sl8-rb",
    name: "SL-8 Rocket Body",
    categoryId: "rocket-bodies",
    objectType: "Rocket body",
    operator: "Historical launch vehicle",
    country: "Soviet Union",
    launched: "1986",
    status: "Reference",
    summary: "A representative tracked upper-stage rocket body in low Earth orbit.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1986,
    orbit: {
      altitudeKm: 760,
      eccentricity: 0.0042,
      inclinationDeg: 74,
      raanDeg: 288,
      argumentOfPeriapsisDeg: 102,
      trueAnomalyDeg: 48,
      color: "#b9a98e",
    },
  }),
  reference({
    id: "explorer-fengyun-debris",
    name: "Fengyun-1C Debris Fragment",
    categoryId: "debris",
    objectType: "Tracked debris",
    operator: "Uncontrolled",
    country: "China",
    launched: "2007",
    status: "Reference",
    summary: "A representative fragment from a major debris-producing event.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 2007,
    orbit: {
      altitudeKm: 850,
      eccentricity: 0.008,
      inclinationDeg: 98.8,
      raanDeg: 342,
      argumentOfPeriapsisDeg: 76,
      trueAnomalyDeg: 212,
      color: "#c28f81",
    },
  }),
  reference({
    id: "explorer-goldstone",
    name: "Goldstone Deep Space Communications Complex",
    categoryId: "ground-stations",
    objectType: "Ground station",
    operator: "NASA / JPL",
    country: "United States",
    launched: "1958",
    status: "Operational",
    summary: "A major antenna complex in NASA's Deep Space Network.",
    sourceId: "curated-reference",
    selectionKind: "ground-station",
    activeFromYear: 1958,
    groundStation: {
      latitudeDeg: 35.2472,
      longitudeDeg: -116.7933,
      altitudeMeters: 1006,
      minimumElevationDeg: 10,
    },
  }),
  reference({
    id: "explorer-gps-constellation",
    name: "Global Positioning System",
    categoryId: "constellations",
    objectType: "Navigation constellation",
    operator: "U.S. Space Force",
    country: "United States",
    launched: "1978",
    status: "Operational",
    summary: "A global medium Earth orbit navigation constellation.",
    sourceId: "curated-reference",
    selectionKind: "constellation",
    activeFromYear: 1978,
    memberIds: ["explorer-gps"],
    semanticTerms: ["gps", "navstar"],
  }),
  reference({
    id: "explorer-starlink-constellation",
    name: "Starlink Constellation",
    categoryId: "constellations",
    objectType: "Communications constellation",
    operator: "SpaceX",
    country: "United States",
    launched: "2019",
    status: "Operational",
    summary: "A large commercial communications constellation in low Earth orbit.",
    sourceId: "curated-reference",
    selectionKind: "constellation",
    activeFromYear: 2019,
    memberIds: ["explorer-starlink"],
    semanticTerms: ["starlink", "spacex"],
  }),
  reference({
    id: "explorer-oneweb-constellation",
    name: "OneWeb Constellation",
    categoryId: "constellations",
    objectType: "Communications constellation",
    operator: "Eutelsat OneWeb",
    country: "International",
    launched: "2019",
    status: "Operational",
    summary: "A polar low Earth orbit communications constellation.",
    sourceId: "curated-reference",
    selectionKind: "constellation",
    activeFromYear: 2019,
    memberIds: [],
  }),
  reference({
    id: "explorer-galileo-constellation",
    name: "Galileo Constellation",
    categoryId: "constellations",
    objectType: "Navigation constellation",
    operator: "European Union / ESA",
    country: "Europe",
    launched: "2011",
    status: "Operational",
    summary: "Europe's global medium Earth orbit navigation constellation.",
    sourceId: "curated-reference",
    selectionKind: "constellation",
    activeFromYear: 2011,
    memberIds: [],
    semanticTerms: ["galileo", "gnss"],
  }),
  reference({
    id: "explorer-beidou-constellation",
    name: "BeiDou Navigation Satellite System",
    categoryId: "constellations",
    objectType: "Navigation constellation",
    operator: "China Satellite Navigation Office",
    country: "China",
    launched: "2000",
    status: "Operational",
    summary:
      "China's global positioning, navigation, and timing constellation. Explorer groups any matching members present in the selected source-backed catalog.",
    sourceId: "curated-reference",
    selectionKind: "constellation",
    activeFromYear: 2000,
    memberIds: [],
    semanticTerms: ["beidou", "bds", "gnss", "navigation"],
  }),
  reference({
    id: "explorer-iridium-constellation",
    name: "Iridium Constellation",
    categoryId: "constellations",
    objectType: "Communications constellation",
    operator: "Iridium Communications",
    country: "United States",
    launched: "1997",
    status: "Operational",
    summary: "A near-polar low Earth orbit mobile communications network.",
    sourceId: "curated-reference",
    selectionKind: "constellation",
    activeFromYear: 1997,
    memberIds: [],
  }),
  reference({
    id: "explorer-noaa-constellation",
    name: "NOAA Environmental Satellites",
    categoryId: "constellations",
    objectType: "Environmental monitoring program group",
    operator: "NOAA",
    country: "United States",
    launched: "1970",
    status: "Operational",
    summary: "A coordinated family of operational weather and environmental monitoring spacecraft.",
    sourceId: "curated-reference",
    selectionKind: "constellation",
    activeFromYear: 1970,
    memberIds: [],
  }),
  reference({
    id: "explorer-sentinel-constellation",
    name: "Copernicus Sentinel Program",
    categoryId: "constellations",
    objectType: "Earth observation program group",
    operator: "ESA / European Commission",
    country: "Europe",
    launched: "2014",
    status: "Operational",
    summary: "A coordinated family of Earth observation missions for the Copernicus programme.",
    sourceId: "curated-reference",
    selectionKind: "constellation",
    activeFromYear: 2014,
    memberIds: [],
  }),
  reference({
    id: "explorer-apollo-program",
    name: "Apollo Program",
    categoryId: "missions",
    objectType: "Mission program",
    operator: "NASA",
    country: "United States",
    launched: "1961",
    status: "Historical",
    summary: "The mission program that developed human lunar exploration capability.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1961,
  }),
  reference({
    id: "explorer-saturn-v",
    name: "Saturn V",
    categoryId: "rocket-bodies",
    objectType: "Launch vehicle reference",
    operator: "NASA",
    country: "United States",
    launched: "1967",
    status: "Historical",
    summary:
      "The heavy-lift launch vehicle that sent Apollo crews from Earth toward the Moon.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1967,
    semanticTerms: ["saturn v", "launch vehicle", "apollo 11"],
  }),
  reference({
    id: "explorer-jwst",
    name: "James Webb Space Telescope",
    categoryId: "missions",
    objectType: "Space telescope reference",
    operator: "NASA / ESA / CSA",
    country: "International",
    launched: "2021",
    status: "Operational",
    summary:
      "A deep-space observatory at the Sun-Earth L2 region; included as a reference record rather than an Earth-orbit object.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 2021,
    semanticTerms: ["jwst", "james webb", "webb"],
  }),
  reference({
    id: "explorer-voyager-1",
    name: "Voyager 1",
    categoryId: "missions",
    objectType: "Deep-space mission reference",
    operator: "NASA / JPL",
    country: "United States",
    launched: "1977",
    status: "Operational",
    summary:
      "A deep-space mission reference record; it is discoverable in Explorer without being rendered as an Earth-orbit satellite.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1977,
    semanticTerms: ["voyager", "voyager 1"],
  }),
  reference({
    id: "explorer-voyager-2",
    name: "Voyager 2",
    categoryId: "missions",
    objectType: "Deep-space mission reference",
    operator: "NASA / JPL",
    country: "United States",
    launched: "1977",
    status: "Operational",
    summary:
      "A deep-space mission reference record; it remains catalog context rather than a renderable Earth-orbit object.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1977,
    semanticTerms: ["voyager", "voyager 2"],
  }),
  reference({
    id: "explorer-leo",
    name: "Low Earth Orbit",
    categoryId: "concepts",
    objectType: "Orbital concept",
    operator: "Educational reference",
    country: "Reference",
    launched: "Reference",
    status: "Reference",
    summary:
      "The busy orbital region close enough for short periods, frequent ground passes, and direct observation of Earth.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1957,
    semanticTerms: ["leo", "low earth orbit", "earth orbit"],
  }),
  reference({
    id: "explorer-meo",
    name: "Medium Earth Orbit",
    categoryId: "concepts",
    objectType: "Orbital concept",
    operator: "Educational reference",
    country: "Reference",
    launched: "Reference",
    status: "Reference",
    summary:
      "The orbital region used by navigation systems that need broad Earth coverage without going all the way to geostationary altitude.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1957,
    semanticTerms: ["meo", "medium earth orbit", "navigation orbit"],
  }),
  reference({
    id: "explorer-geo",
    name: "Geostationary Orbit",
    categoryId: "concepts",
    objectType: "Orbital concept",
    operator: "Educational reference",
    country: "Reference",
    launched: "Reference",
    status: "Reference",
    summary:
      "A circular equatorial orbit where a spacecraft appears to hover over one longitude on Earth.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1957,
    semanticTerms: ["geo", "geostationary", "geosynchronous", "weather satellite"],
  }),
  reference({
    id: "explorer-lagrange-points",
    name: "Lagrange Points",
    categoryId: "concepts",
    objectType: "Orbital concept",
    operator: "Educational reference",
    country: "Reference",
    launched: "Reference",
    status: "Reference",
    summary:
      "Gravitational balance regions where spacecraft can stay near useful positions relative to two larger bodies.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1957,
    semanticTerms: ["lagrange", "libration", "l1", "l2", "l4", "l5"],
  }),
  reference({
    id: "explorer-sun-earth-l2",
    name: "Sun-Earth L2",
    categoryId: "concepts",
    objectType: "Orbital concept",
    operator: "Educational reference",
    country: "Reference",
    launched: "Reference",
    status: "Reference",
    summary:
      "A Lagrange point beyond Earth from the Sun, useful for observatories that need a cold, stable viewing environment.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1957,
    semanticTerms: ["l2", "sun earth l2", "jwst", "webb", "deep space observatory"],
  }),
  reference({
    id: "explorer-halo-orbit",
    name: "Halo Orbit",
    categoryId: "concepts",
    objectType: "Orbital concept",
    operator: "Educational reference",
    country: "Reference",
    launched: "Reference",
    status: "Reference",
    summary:
      "A looping path around a Lagrange point that keeps a spacecraft near a valuable region rather than sitting exactly on it.",
    sourceId: "curated-reference",
    selectionKind: "catalog-object",
    activeFromYear: 1957,
    semanticTerms: ["halo orbit", "l2", "jwst", "lagrange"],
  }),
];

function inferredConstellationId(name: string): string | undefined {
  const normalizedName = name.toUpperCase();
  if (/^(BEIDOU|COMPASS)[ -]/.test(normalizedName)) {
    return "explorer-beidou-constellation";
  }
  if (/^(GPS|NAVSTAR)[ -]/.test(normalizedName)) {
    return "explorer-gps-constellation";
  }
  if (/^(GALILEO[ -]|GALILEOSAT-)/.test(normalizedName)) {
    return "explorer-galileo-constellation";
  }
  if (/^STARLINK[ -]/.test(normalizedName)) {
    return "explorer-starlink-constellation";
  }
  if (/^ONEWEB[ -]/.test(normalizedName)) {
    return "explorer-oneweb-constellation";
  }
  if (/^IRIDIUM[ -]/.test(normalizedName)) {
    return "explorer-iridium-constellation";
  }
  if (normalizedName.startsWith("NOAA ") || normalizedName.includes("NOAA")) {
    return "explorer-noaa-constellation";
  }
  if (normalizedName.startsWith("SENTINEL-")) {
    return "explorer-sentinel-constellation";
  }

  return undefined;
}

const sourceBackedCuratedCatalog = curatedExplorerCatalog;
const curatedCatalogByCatalogNumber = new Map(
  curatedExplorerCatalog
    .filter((entry) => entry.catalogNumber)
    .map((entry) => [entry.catalogNumber!, entry]),
);

export const explorerCatalog: ExplorerCatalogEntry[] = [
  ...sourceBackedCuratedCatalog,
];

function canonicalPeriodEndTimestamp(year: number): string {
  const period = explorerCanonicalSatellitePeriods.find(
    (candidate) => candidate.year === year,
  );
  if (!period) {
    throw new Error(`Canonical satellite catalog is missing annual period ${year}.`);
  }
  return period.isPartialYear
    ? explorerLatestPublicCatalogSnapshot!.timestampIso
    : `${period.periodEndDate}T12:00:00.000Z`;
}

export const explorerSnapshots: ExplorerSnapshot[] = [
  {
    id: "snapshot-1957",
    label: "First artificial satellite",
    year: "1957",
    timestampIso: canonicalPeriodEndTimestamp(1957),
    detail: "1957 period-end membership after the first orbital launches",
    milestone: "Sputnik",
    sourceId: "gcat-public-catalog",
  },
  {
    id: "snapshot-1961",
    label: "First human orbital flight",
    year: "1961",
    timestampIso: canonicalPeriodEndTimestamp(1961),
    detail: "1961 period-end membership during the first human-orbit era",
    milestone: "Gagarin",
    sourceId: "gcat-public-catalog",
  },
  {
    id: "snapshot-1969",
    label: "Lunar mission era",
    year: "1969",
    timestampIso: canonicalPeriodEndTimestamp(1969),
    detail: "1969 period-end membership during the lunar-mission era",
    milestone: "Apollo 11",
    sourceId: "gcat-public-catalog",
  },
  {
    id: "snapshot-1978",
    label: "Navigation constellation begins",
    year: "1978",
    timestampIso: canonicalPeriodEndTimestamp(1978),
    detail: "1978 period-end membership as navigation infrastructure emerges",
    milestone: "GPS",
    sourceId: "gcat-public-catalog",
  },
  {
    id: "snapshot-1990",
    label: "Hubble observatory deployed",
    year: "1990",
    timestampIso: canonicalPeriodEndTimestamp(1990),
    detail: "1990 period-end membership as long-lived science platforms expand",
    milestone: "Hubble",
    sourceId: "gcat-public-catalog",
  },
  {
    id: "snapshot-1998",
    label: "ISS assembly begins",
    year: "1998",
    timestampIso: canonicalPeriodEndTimestamp(1998),
    detail: "1998 period-end membership as international infrastructure expands",
    milestone: "ISS",
    sourceId: "gcat-public-catalog",
  },
  {
    id: "snapshot-2015",
    label: "Commercial launch expansion",
    year: "2015",
    timestampIso: canonicalPeriodEndTimestamp(2015),
    detail: "2015 period-end membership as commercial access accelerates",
    milestone: "Commercial Era",
    sourceId: "gcat-public-catalog",
  },
  {
    id: "snapshot-2019",
    label: "Large constellation deployment",
    year: "2019",
    timestampIso: canonicalPeriodEndTimestamp(2019),
    detail: "2019 period-end membership as constellation deployment expands",
    milestone: "Starlink",
    sourceId: "gcat-public-catalog",
  },
  {
    id: "snapshot-2026",
    label: "Latest public catalog",
    year: "2026",
    timestampIso: explorerLatestPublicCatalogSnapshot.timestampIso,
    detail: "Complete GCAT membership · reconstructed educational positions",
    milestone: "Current",
    sourceId: "gcat-public-catalog",
  },
];

export const explorerTimelineSnapshots: ExplorerSnapshot[] = [...explorerSnapshots];

function snapshotYear(snapshot: ExplorerSnapshot): number {
  return Number(snapshot.year);
}

export const currentExplorerSnapshot = explorerSnapshots[explorerSnapshots.length - 1];
export const explorerHistoricalTimelineAvailable = explorerHistoricalCatalogIsLoaded;

export function isExplorerCurrentSnapshot(snapshot: ExplorerSnapshot): boolean {
  return snapshot.id === currentExplorerSnapshot.id;
}

export function isExplorerCurrentCatalogSnapshot(snapshot: ExplorerSnapshot): boolean {
  return isExplorerCurrentSnapshot(snapshot) || snapshot.catalogMode === "current";
}

export function createExplorerCurrentSnapshot(simulationTimeUtc: string): ExplorerSnapshot {
  const timestampMs = Date.parse(simulationTimeUtc);
  if (!Number.isFinite(timestampMs)) {
    throw new RangeError(`Invalid Explorer simulation timestamp: ${simulationTimeUtc}`);
  }
  return explorerSnapshotForDateIso(new Date(timestampMs).toISOString());
}

export function explorerSnapshotHasHistoricalData(snapshot: ExplorerSnapshot): boolean {
  return isExplorerCurrentCatalogSnapshot(snapshot) || explorerHistoricalCatalogIsLoaded;
}

function clampTimelineYear(year: number): number {
  const firstYear = snapshotYear(explorerSnapshots[0]);
  const lastYear = snapshotYear(explorerSnapshots[explorerSnapshots.length - 1]);

  return Math.min(lastYear, Math.max(firstYear, year));
}

export function explorerSnapshotTimelinePosition(snapshot: ExplorerSnapshot): number {
  const firstYear = snapshotYear(explorerSnapshots[0]);
  const lastYear = snapshotYear(explorerSnapshots[explorerSnapshots.length - 1]);

  return (clampTimelineYear(snapshotYear(snapshot)) - firstYear) / (lastYear - firstYear);
}

export function explorerVisibleTimelinePosition(snapshot: ExplorerSnapshot): number {
  const firstYear = snapshotYear(explorerTimelineSnapshots[0]);
  const lastYear = snapshotYear(explorerTimelineSnapshots[explorerTimelineSnapshots.length - 1]);
  const clampedYear = Math.min(lastYear, Math.max(firstYear, snapshotYear(snapshot)));

  return (clampedYear - firstYear) / (lastYear - firstYear);
}

export function explorerSnapshotNearestToYear(year: number): ExplorerSnapshot {
  return explorerSnapshots.reduce((nearest, snapshot) =>
    Math.abs(snapshotYear(snapshot) - year) < Math.abs(snapshotYear(nearest) - year)
      ? snapshot
      : nearest,
  );
}

export function explorerSnapshotForYear(
  year: number,
  _options: { snap?: boolean; snapThresholdYears?: number } = {},
): ExplorerSnapshot {
  const selectedYear = Math.round(clampTimelineYear(year));
  const nearest = explorerSnapshotNearestToYear(selectedYear);

  if (snapshotYear(nearest) === selectedYear) {
    return nearest;
  }

  return {
    id: `timeline-${selectedYear}`,
    label: `${selectedYear} period end`,
    year: String(selectedYear),
    timestampIso: canonicalPeriodEndTimestamp(selectedYear),
    detail:
      selectedYear === 2026
        ? "Partial 2026 membership through the GCAT package snapshot"
        : `${selectedYear} membership present at calendar-year end`,
    milestone: nearest.milestone,
    sourceId: "gcat-public-catalog",
  };
}

export function explorerSnapshotForDateIso(timestampIso: string): ExplorerSnapshot {
  const parsed = new Date(timestampIso);
  const currentTimestampMs = Date.parse(currentExplorerSnapshot.timestampIso);
  const selectedTimestampMs = parsed.getTime();

  if (Number.isFinite(selectedTimestampMs) && selectedTimestampMs === currentTimestampMs) {
    return currentExplorerSnapshot;
  }

  const selectedYear = Number.isFinite(selectedTimestampMs)
    ? Math.round(clampTimelineYear(parsed.getUTCFullYear()))
    : Number(explorerSnapshots[0].year);
  const nearest = explorerSnapshotNearestToYear(selectedYear);
  if (snapshotYear(nearest) === selectedYear) return nearest;

  return {
    id: `timeline-${selectedYear}`,
    label: `${selectedYear} period end`,
    year: String(selectedYear),
    timestampIso: canonicalPeriodEndTimestamp(selectedYear),
    detail:
      selectedYear === 2026
        ? "Partial 2026 membership through the GCAT package snapshot"
        : `${selectedYear} membership present at calendar-year end`,
    milestone: nearest.milestone,
    sourceId: "gcat-public-catalog",
  };
}

function isRecordActive(entry: ExplorerCatalogEntry, snapshot: ExplorerSnapshot): boolean {
  const year = snapshotYear(snapshot);
  return entry.activeFromYear <= year && (entry.activeToYear === undefined || entry.activeToYear >= year);
}

function sourceLabelForId(sourceId: string): string {
  return explorerCatalogSources.find((source) => source.id === sourceId)?.name ?? sourceId;
}

function sourceLabelsForEntry(entry: ExplorerCatalogEntry): string[] {
  return entry.sourceAttribution?.length ? entry.sourceAttribution : [sourceLabelForId(entry.sourceId)];
}

function historicalCategoryFor(object: ExplorerHistoricalCatalogObject): ExplorerCategoryId {
  if (object.sourceObjectClass === "payload") return "payloads";
  if (object.sourceObjectClass === "rocket_body") return "rocket-bodies";
  if (object.sourceObjectClass === "component") return "components";
  if (object.sourceObjectClass === "debris") return "debris";

  const text = `${object.objectType ?? ""} ${object.name}`.toLowerCase();
  if (/\b(r\/b|rocket|upper stage|launcher)\b/.test(text)) return "rocket-bodies";
  if (/\b(deb|debris|fragment|piece|component)\b/.test(text)) return "debris";
  return "payloads";
}

function historicalColorFor(categoryId: ExplorerCategoryId): string {
  if (categoryId === "rocket-bodies") return "#b9a98e";
  if (categoryId === "components") return "#c99bd8";
  if (categoryId === "debris") return "#c28f81";
  return "#9fc7df";
}

function yearFromIso(value?: string): number {
  if (!value) return 0;
  const year = new Date(value).getUTCFullYear();
  return Number.isFinite(year) ? year : 0;
}

function historicalEntryForObject(
  object: ExplorerHistoricalCatalogObject,
  snapshot: ExplorerSnapshot,
  resolvedState?: ExplorerHistoricalOrbitState,
  options: {
    orbitAvailability?: HistoricalOrbitAvailability;
  } = {},
): ExplorerCatalogEntry {
  const state = resolvedState;
  const curatedIdentity = object.catalogNumber
    ? curatedCatalogByCatalogNumber.get(object.catalogNumber)
    : undefined;
  const categoryId = historicalCategoryFor(object);
  const orbit = state?.orbit
    ? { ...state.orbit, color: historicalColorFor(categoryId) }
    : undefined;
  const tle = state?.tle
    ? {
        name: state.tle.name ?? object.name,
        line1: state.tle.line1,
        line2: state.tle.line2,
      }
    : undefined;
  const renderable = Boolean(orbit);
  const orbitAvailability: ExplorerOrbitAvailability =
    state?.orbit
      ? options.orbitAvailability ?? "nearest-historical-orbit"
      : "catalog-only";
  const sourceAttribution = [
    ...new Set(
      [
        ...object.sources.map((source) => `${source.sourceFamily}: ${source.sourceFile}`),
        ...(state?.sources.map((source) => `${source.sourceFamily}: ${source.sourceFile}`) ?? []),
      ],
    ),
  ];

  return {
    id: curatedIdentity?.id ?? object.id,
    name: curatedIdentity?.name ?? object.name,
    catalogNumber: object.catalogNumber,
    alternateNames: [
      ...new Set([
        ...(object.alternateNames ?? []),
        ...(curatedIdentity?.alternateNames ?? []),
        ...(curatedIdentity && curatedIdentity.name !== object.name ? [object.name] : []),
      ]),
    ],
    internationalDesignator: object.internationalDesignator,
    categoryId,
    objectType: object.objectType ?? "Catalog object",
    operator: object.owner ?? "Historical catalog",
    country: object.owner ?? "Historical catalog",
    launched: object.launchDate ? String(yearFromIso(object.launchDate)) : "Source record",
    launchDate: object.launchDate,
    decayDate: object.decayDate,
    reentryDate: object.reentryDate,
    status: object.decayDate || object.reentryDate ? "Historical" : "Reference",
    summary: state?.stateKind === "reconstructed"
      ? `${object.name} has a deterministic educational orbit constrained by imported historical catalog metadata; its displayed position is not an exact historical fix.`
      : `${object.name} is loaded from imported historical catalog source records.`,
    sourceId: object.sources.every((source) => source.sourceFamily === "gcat")
      ? "gcat-public-catalog"
      : "historical-import",
    sourceAttribution,
    constellationId:
      curatedIdentity?.constellationId ??
      inferredConstellationId(object.name),
    selectionKind: renderable ? "satellite" : "catalog-object",
    visualRole: renderable ? "selectable-orbital-object" : "catalog-reference",
    activeFromYear: yearFromIso(object.launchDate),
    activeToYear: object.decayDate || object.reentryDate
      ? yearFromIso(object.decayDate ?? object.reentryDate)
      : undefined,
    orbit: renderable ? orbit : undefined,
    tle: renderable ? tle : undefined,
    orbitAvailability,
    semanticTerms: curatedIdentity?.semanticTerms,
  };
}

function historicalRecordsForSnapshot(snapshot: ExplorerSnapshot): ExplorerCatalogEntry[] {
  if (!explorerHistoricalCatalogIsLoaded) return [];

  return queryHistoricalCatalog(explorerHistoricalCatalogIndex, snapshot.timestampIso)
    .objects
    .map((item: HistoricalCatalogWorldObject) =>
      historicalEntryForObject(item.object, snapshot, item.orbitState, {
        orbitAvailability: item.orbitAvailability,
      }),
    );
}

function dataCoverageForSnapshot(
  snapshot: ExplorerSnapshot,
  records: ExplorerCatalogEntry[],
): ExplorerCatalogDataCoverage {
  if (isExplorerCurrentCatalogSnapshot(snapshot)) {
    const coverage = historicalCatalogCoverageForDate(snapshot.timestampIso);
    return {
      status: "latest-public-catalog",
      catalogObjectCount: coverage.catalogObjectCount,
      renderableOrbitStateCount: coverage.renderableOrbitStateCount,
      exactHistoricalOrbitStateCount: coverage.exactOrbitStateCount,
      reconstructedHistoricalOrbitStateCount: coverage.reconstructedOrbitStateCount,
      catalogOnlyObjectCount: coverage.catalogOnlyObjectCount,
      sourceLabels: coverage.sourceLabels,
      label: "GCAT membership · reconstructed positions",
      description:
        `Latest bundled public membership is the complete GCAT Earth-object snapshot dated ${explorerLatestPublicCatalogDate}. ` +
        "Positions are educational reconstructions constrained by source perigee, apogee, and inclination; they are not live tracking or exact observations.",
    };
  }

  const coverage = historicalCatalogCoverageForDate(snapshot.timestampIso);
  if (!coverage.loaded) {
    return {
      status: "historical-not-loaded",
      catalogObjectCount: 0,
      renderableOrbitStateCount: 0,
      exactHistoricalOrbitStateCount: 0,
      reconstructedHistoricalOrbitStateCount: 0,
      catalogOnlyObjectCount: 0,
      sourceLabels: [],
      label: "Historical catalog data not loaded",
      description: "The canonical GCAT annual membership data is unavailable.",
    };
  }
  const renderableOrbitStateCount = records.filter(
    (entry) => entry.selectionKind === "satellite" && Boolean(entry.orbit),
  ).length;
  const exactHistoricalOrbitStateCount = records.filter(
    (entry) =>
      entry.orbitAvailability === "exact-historical-orbit" ||
      entry.orbitAvailability === "nearest-historical-orbit",
  ).length;
  const reconstructedHistoricalOrbitStateCount = records.filter(
    (entry) => entry.orbitAvailability === "reconstructed-historical-orbit",
  ).length;
  const catalogOnlyObjectCount = records.filter(
    (entry) => entry.orbitAvailability === "catalog-only",
  ).length;
  const completeHistoricalMembership =
    explorerHistoricalCatalog.runtimeArtifacts?.coverageManifest.completeMembership === true;

  return {
    status: "historical-loaded",
    catalogObjectCount: coverage.catalogObjectCount,
    renderableOrbitStateCount,
    exactHistoricalOrbitStateCount,
    reconstructedHistoricalOrbitStateCount,
    catalogOnlyObjectCount,
    sourceLabels: [
      ...new Set([
        ...coverage.sourceLabels,
        ...records.flatMap((entry) => sourceLabelsForEntry(entry)),
      ]),
    ].sort(),
    label: completeHistoricalMembership
      ? `${snapshot.year} period-end membership`
      : "Incomplete historical membership",
    description: completeHistoricalMembership
      ? "Membership answers which GCAT Earth objects were present at this annual period end. Displayed states are explicitly identified educational reconstructions from source perigee, apogee, and inclination."
      : "Canonical annual membership is incomplete.",
  };
}

function createSearchText(entry: ExplorerCatalogEntry): string {
  const constellationId =
    entry.selectionKind === "constellation" ? entry.id : entry.constellationId;
  const semanticTerms = [
    ...(entry.semanticTerms ?? []),
    ...(entry.alternateNames ?? []),
    entry.internationalDesignator ?? "",
    ...(constellationId ? explorerConstellationSemanticTerms(constellationId) : []),
  ];

  return `${entry.name} ${entry.catalogNumber ?? ""} ${entry.objectType} ${entry.operator} ${entry.country} ${entry.summary} ${semanticTerms.join(" ")}`
    .toLowerCase();
}

export function createExplorerCatalogSnapshotView(
  snapshot: ExplorerSnapshot,
): ExplorerCatalogSnapshotView {
  const sourceRecords = historicalRecordsForSnapshot(snapshot);
  const sourceCatalogNumbers = new Set(
    sourceRecords.flatMap((entry) =>
      entry.catalogNumber ? [entry.catalogNumber] : []),
  );
  const records = isExplorerCurrentCatalogSnapshot(snapshot)
    ? uniqueExplorerCatalogEntries([
        ...sourceRecords,
        ...sourceBackedCuratedCatalog.filter(
          (entry) =>
            isRecordActive(entry, snapshot) &&
            (
              entry.selectionKind !== "satellite" ||
              !entry.catalogNumber ||
              !sourceCatalogNumbers.has(entry.catalogNumber)
            ),
        ),
      ])
    : sourceRecords;
  const byId = new Map(records.map((entry) => [entry.id, entry]));
  const searchTextById = new Map(
    records.map((entry) => [entry.id, createSearchText(entry)]),
  );
  const categoryCounts = new Map(
    explorerCategoryIds.map((categoryId) => [
      categoryId,
      records.filter((entry) => entry.categoryId === categoryId).length,
    ]),
  );

  const dataCoverage = dataCoverageForSnapshot(snapshot, records);

  return {
    snapshot,
    records,
    byId,
    searchTextById,
    categoryCounts,
    catalogObjectCount: dataCoverage.catalogObjectCount,
    renderableOrbitStateCount: dataCoverage.renderableOrbitStateCount,
    dataCoverage,
  };
}

function uniqueExplorerCatalogEntries(entries: ExplorerCatalogEntry[]): ExplorerCatalogEntry[] {
  const seen = new Set<string>();
  const unique: ExplorerCatalogEntry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    unique.push(entry);
  }

  return unique;
}

export const explorerCanonicalCatalogView: ExplorerCatalogSnapshotView = (() => {
  const snapshot = currentExplorerSnapshot;
  const currentView = createExplorerCatalogSnapshotView(snapshot);
  const records = currentView.records;
  const byId = new Map(records.map((entry) => [entry.id, entry]));
  const searchTextById = new Map(records.map((entry) => [entry.id, createSearchText(entry)]));
  const categoryCounts = new Map(
    explorerCategoryIds.map((categoryId) => [
      categoryId,
      records.filter((entry) => entry.categoryId === categoryId).length,
    ]),
  );
  const renderableOrbitStateCount = records.filter(
    (entry) => entry.selectionKind === "satellite" && Boolean(entry.orbit),
  ).length;

  return {
    snapshot,
    records,
    byId,
    searchTextById,
    categoryCounts,
    catalogObjectCount: records.length,
    renderableOrbitStateCount,
    dataCoverage: {
      status: currentView.dataCoverage.status,
      catalogObjectCount: records.length,
      renderableOrbitStateCount,
      exactHistoricalOrbitStateCount:
        currentView.dataCoverage.exactHistoricalOrbitStateCount,
      reconstructedHistoricalOrbitStateCount:
        currentView.dataCoverage.reconstructedHistoricalOrbitStateCount,
      catalogOnlyObjectCount: currentView.dataCoverage.catalogOnlyObjectCount,
      sourceLabels: [...new Set(records.flatMap((entry) => sourceLabelsForEntry(entry)))].sort(),
      label: "Canonical catalog",
      description: "Search uses the stable Explorer catalog identity layer.",
    },
  };
})();

export function filterExplorerCatalogSnapshot(
  view: ExplorerCatalogSnapshotView,
  filters: ExplorerCatalogFilters,
): ExplorerCatalogEntry[] {
  const normalizedQuery = filters.query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return view.records.filter((entry) => {
    let matchesQuery = true;
    if (queryTokens.length > 0) {
      const searchableText = (view.searchTextById.get(entry.id) ?? "")
        .replace(/[^a-z0-9]+/g, " ");
      const searchableTokens = searchableText.split(/\s+/);
      matchesQuery = queryTokens.every((token) =>
        token.length <= 3
          ? searchableTokens.includes(token)
          : searchableText.includes(token),
      );
    }
    const matchesCategory =
      filters.categoryId === "all" || entry.categoryId === filters.categoryId;
    const matchesStatus = filters.status === "all" || entry.status === filters.status;
    const matchesOperator = filters.operator === "all" || entry.operator === filters.operator;
    const matchesConstellation =
      filters.constellationId === "all" ||
      entry.constellationId === filters.constellationId ||
      entry.id === filters.constellationId;

    return Boolean(
      matchesQuery &&
      matchesCategory &&
      matchesStatus &&
      matchesOperator &&
      matchesConstellation,
    );
  });
}

export function filterExplorerCatalog(filters: ExplorerCatalogFilters): ExplorerCatalogEntry[] {
  return filterExplorerCatalogSnapshot(explorerCanonicalCatalogView, filters);
}

const snapshotViews = new Map<string, ExplorerCatalogSnapshotView>();
const fixedSnapshotIds = new Set(explorerSnapshots.map((snapshot) => snapshot.id));
const snapshotViewCacheLimit = explorerSnapshots.length + 4;

function cacheSnapshotView(
  snapshot: ExplorerSnapshot,
  view: ExplorerCatalogSnapshotView,
): ExplorerCatalogSnapshotView {
  snapshotViews.set(snapshot.id, view);

  if (snapshotViews.size <= snapshotViewCacheLimit) return view;

  for (const key of snapshotViews.keys()) {
    if (fixedSnapshotIds.has(key)) continue;
    snapshotViews.delete(key);
    if (snapshotViews.size <= snapshotViewCacheLimit) break;
  }

  return view;
}

export function getHistoricalCatalog(
  selectedDate: string | Date | ExplorerSnapshot,
): ExplorerCatalogSnapshotView {
  const snapshot =
    typeof selectedDate === "string"
      ? explorerSnapshotForDateIso(selectedDate)
      : selectedDate instanceof Date
        ? explorerSnapshotForDateIso(selectedDate.toISOString())
        : selectedDate;

  const cached = snapshotViews.get(snapshot.id);
  if (cached) return cached;

  const view = createExplorerCatalogSnapshotView(snapshot);
  return cacheSnapshotView(snapshot, view);
}

export function explorerSnapshotView(snapshot: ExplorerSnapshot): ExplorerCatalogSnapshotView {
  return getHistoricalCatalog(snapshot);
}

function catalogSatellite(
  entry: ExplorerCatalogEntry,
  epoch: Date,
  showTrail: boolean,
): SatelliteModel {
  if (!entry.orbit) {
    throw new Error(`Catalog record ${entry.id} does not define an orbit.`);
  }

  return createSatellite(entry.name, epoch, {
    id: entry.id,
    constellationId: entry.constellationId,
    catalogMetadata: {
      categoryId:
        entry.categoryId === "payloads" ||
        entry.categoryId === "rocket-bodies" ||
        entry.categoryId === "components" ||
        entry.categoryId === "debris"
          ? entry.categoryId
          : "unknown",
      objectType: entry.objectType,
      catalogNumber: entry.catalogNumber,
      operator: entry.operator,
      country: entry.country,
      sourceId: entry.sourceId,
      orbitStateProvenance:
        entry.orbitAvailability === "reconstructed-historical-orbit"
          ? "reconstructed-historical"
          : entry.orbitAvailability === "curated-reference-orbit"
            ? "curated-reference"
          : entry.orbitAvailability === "exact-historical-orbit"
            ? "exact-historical"
            : entry.orbitAvailability === "nearest-historical-orbit"
              ? "nearest-historical"
              : "current-source",
    },
    propagationMode: entry.tle ? "sgp4" : "two-body",
    editorMode: entry.tle ? "tle" : "keplerian",
    tle: entry.tle,
    keplerian: {
      semiMajorAxisKm: EARTH_RADIUS_KM + entry.orbit.altitudeKm,
      eccentricity: entry.orbit.eccentricity,
      inclinationDeg: entry.orbit.inclinationDeg,
      raanDeg: entry.orbit.raanDeg,
      argumentOfPeriapsisDeg: entry.orbit.argumentOfPeriapsisDeg,
      trueAnomalyDeg: entry.orbit.trueAnomalyDeg,
      epoch: entry.orbit.epoch ?? epoch.toISOString(),
    },
    visualization: {
      color: entry.orbit.color,
      visible: true,
      showTrail,
      showGroundTrack: false,
    },
    sensor: {
      enabled: entry.orbit.sensorHalfAngleDeg !== undefined,
      halfAngleDeg: entry.orbit.sensorHalfAngleDeg ?? 18,
      maxRangeKm: null,
      showCone: false,
      showFootprint: false,
    },
  });
}

function catalogMissionObject(entry: ExplorerCatalogEntry): CatalogObjectModel {
  return {
    id: entry.id,
    name: entry.name,
    objectType: entry.objectType,
    launchDate: entry.launched,
    source: entry.sourceId,
    propagationMode: "two-body",
    visible: false,
  };
}

const constellationColors: Record<string, string> = {
  "explorer-gps-constellation": "#74d6ad",
  "explorer-starlink-constellation": "#82b9de",
  "explorer-oneweb-constellation": "#b2a2e8",
  "explorer-galileo-constellation": "#e4bd76",
  "explorer-beidou-constellation": "#d89065",
  "explorer-iridium-constellation": "#9fc5de",
  "explorer-noaa-constellation": "#72cbd0",
  "explorer-sentinel-constellation": "#a8cf83",
};

export function createExplorerScenario(
  snapshot: ExplorerSnapshot = explorerSnapshots[explorerSnapshots.length - 1],
): Scenario {
  const epoch = new Date(snapshot.timestampIso);
  const scenario = createDefaultScenario(epoch);
  const view = getHistoricalCatalog(snapshot);
  const orbitalRecords = view.records.filter(
    (entry) => entry.visualRole === "selectable-orbital-object" && entry.orbit,
  );
  const satellites = orbitalRecords.map((entry) =>
    catalogSatellite(entry, epoch, false),
  );
  const groundStations = view.records
    .filter((entry) => entry.selectionKind === "ground-station" && entry.groundStation)
    .map((entry) =>
      createGroundStation(entry.name, entry.groundStation!.latitudeDeg, entry.groundStation!.longitudeDeg, {
        id: entry.id,
        altitudeMeters: entry.groundStation!.altitudeMeters,
        minimumElevationDeg: entry.groundStation!.minimumElevationDeg,
        visible: true,
        showCoverageCone: true,
        showHorizonCircle: true,
        source: entry.sourceId,
      }),
    );
  const constellations = view.records
    .filter((entry) => entry.selectionKind === "constellation")
    .map((entry) =>
      createConstellation(
        entry.name,
        [
          ...(entry.memberIds ?? []),
          ...satellites
            .filter((satellite) => satellite.constellationId === entry.id)
            .map((satellite) => satellite.id),
        ].filter((id, index, ids) => ids.indexOf(id) === index),
        {
          id: entry.id,
          color: constellationColors[entry.id] ?? "#78bfe9",
          visible: true,
          generator: { kind: "manual", createdAt: snapshot.timestampIso },
        },
      ),
    );
  const missionObjects = isExplorerCurrentCatalogSnapshot(snapshot)
    ? view.records
        .filter((entry) => entry.selectionKind === "catalog-object")
        .map(catalogMissionObject)
    : [];

  return {
    ...scenario,
    name: "Orbit Studio Explorer Catalog",
    simulationEpoch: snapshot.timestampIso,
    simulationTimeUtc: snapshot.timestampIso,
    renderSettings: {
      ...scenario.renderSettings,
      showClouds: false,
      earthCloudMode: "off",
      earthCloudOpacity: 0,
      earthCloudIntensity: 0,
      showNightLights: false,
      showAtmosphere: false,
      earthTextureSource:
        "NASA Blue Marble: Next Generation January global map with Natural Earth vector coastline overlay.",
      atmosphereIntensity: 0.16,
      atmosphereDayContribution: 0.64,
      atmosphereNightContribution: 0.1,
      showLatLonGrid: false,
      showEciGrid: false,
      showEcefGrid: false,
      showCoverageLayer: false,
      educationalOverlay: "none",
      showGeoValidationOverlay: false,
    },
    coverageSettings: {
      ...scenario.coverageSettings,
      enabled: false,
      targetType: "satellite",
      targetId: null,
    },
    cameraSettings: {
      ...scenario.cameraSettings,
      cameraMode: "free",
      viewPreset: "free",
      followSelectedObject: false,
    },
    selectedObjectType: "none",
    selectedObjectId: null,
    satellites,
    constellations,
    groundStations,
    regions: [],
    catalogLayers: missionObjects.length
      ? [
          {
            id: "explorer-reference-records",
            name: "Explorer reference records",
            description: "Non-orbital mission and catalog reference records.",
            visible: false,
            loaded: true,
            source: "curated-reference",
            objects: missionObjects,
            fullCatalogAvailable: false,
            historicalCatalogAvailable: true,
          },
        ]
      : [],
  };
}

export function explorerEntryForId(
  entryId: string,
  snapshot?: ExplorerSnapshot,
): ExplorerCatalogEntry | undefined {
  return snapshot
    ? explorerSnapshotView(snapshot).byId.get(entryId)
    : explorerCanonicalCatalogView.byId.get(entryId);
}

export function explorerEntryForSatellite(satelliteId: string): ExplorerCatalogEntry | undefined {
  return explorerEntryForId(satelliteId);
}

export function explorerCategoryLabel(categoryId: ExplorerCategoryId): string {
  return explorerCategoryHierarchy.find((category) => category.id === categoryId)?.label ?? categoryId;
}

export function validateExplorerRuntimeCatalogHealth(): string[] {
  const issues: string[] = [];
  const current = explorerSnapshotView(currentExplorerSnapshot);
  const latestSnapshot = explorerLatestPublicCatalogSnapshot!;
  const gcatRecords = current.records.filter(
    (entry) => entry.sourceId === "gcat-public-catalog",
  );
  const renderableRecords = gcatRecords.filter(
    (entry) =>
      entry.selectionKind === "satellite" &&
      entry.visualRole === "selectable-orbital-object" &&
      entry.orbit,
  );
  const categoryCount = (categoryId: ExplorerCategoryId, renderableOnly = false) =>
    gcatRecords.filter(
      (entry) =>
        entry.categoryId === categoryId &&
        (!renderableOnly || (
          entry.selectionKind === "satellite" &&
          Boolean(entry.orbit)
        )),
    ).length;

  if (current.dataCoverage.status !== "latest-public-catalog") {
    issues.push("Canonical GCAT mode does not disclose latest-public coverage.");
  }
  if (gcatRecords.length !== latestSnapshot.catalogObjectCount) {
    issues.push(
      `Latest public catalog exposes ${gcatRecords.length.toLocaleString()} GCAT members; canonical metadata declares ${latestSnapshot.catalogObjectCount.toLocaleString()}.`,
    );
  }
  if (renderableRecords.length !== latestSnapshot.reconstructedOrbitStateCount) {
    issues.push(
      `Latest public catalog exposes ${renderableRecords.length.toLocaleString()} renderable states; canonical metadata declares ${latestSnapshot.reconstructedOrbitStateCount.toLocaleString()}.`,
    );
  }
  const catalogOnlyCount = gcatRecords.filter(
    (entry) => entry.orbitAvailability === "catalog-only",
  ).length;
  if (catalogOnlyCount !== latestSnapshot.catalogOnlyObjectCount) {
    issues.push(
      `Latest public catalog exposes ${catalogOnlyCount.toLocaleString()} catalog-only objects; canonical metadata declares ${latestSnapshot.catalogOnlyObjectCount.toLocaleString()}.`,
    );
  }
  const categoryExpectations = [
    ["payloads", latestSnapshot.categoryCounts.payloads, latestSnapshot.renderableCategoryCounts.payloads],
    ["rocket-bodies", latestSnapshot.categoryCounts.rocketBodies, latestSnapshot.renderableCategoryCounts.rocketBodies],
    ["components", latestSnapshot.categoryCounts.components, latestSnapshot.renderableCategoryCounts.components],
    ["debris", latestSnapshot.categoryCounts.debris, latestSnapshot.renderableCategoryCounts.debris],
  ] as const;
  for (const [categoryId, expectedMembership, expectedRenderable] of categoryExpectations) {
    const actualMembership = categoryCount(categoryId);
    const actualRenderable = categoryCount(categoryId, true);
    if (actualMembership !== expectedMembership) {
      issues.push(
        `Latest public ${categoryId} membership is ${actualMembership.toLocaleString()}; canonical metadata declares ${expectedMembership.toLocaleString()}.`,
      );
    }
    if (actualRenderable !== expectedRenderable) {
      issues.push(
        `Latest public renderable ${categoryId} count is ${actualRenderable.toLocaleString()}; canonical metadata declares ${expectedRenderable.toLocaleString()}.`,
      );
    }
  }
  if (renderableRecords.some(
    (entry) => entry.orbitAvailability !== "reconstructed-historical-orbit",
  )) {
    issues.push("A canonical GCAT renderable record lacks reconstructed-orbit classification.");
  }
  if (renderableRecords.some(
    (entry) =>
      !entry.summary.includes("deterministic educational orbit") ||
      !entry.summary.includes("not an exact historical fix") ||
      /live tracking|current tracking|exact position|observed position/i.test(entry.summary),
  )) {
    issues.push("A reconstructed release record implies exact, observed, or live tracking.");
  }
  if (renderableRecords.some((entry) => entry.tle)) {
    issues.push("Canonical GCAT release records unexpectedly contain TLE data.");
  }

  return issues;
}
