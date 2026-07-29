import normalizedCatalog from "./historical/explorerHistoricalCatalog.normalized.json";
import {
  createHistoricalCatalogIndex,
  historicalObjectExistsOnDate as pipelineHistoricalObjectExistsOnDate,
  queryHistoricalCatalog,
} from "./explorerHistoricalPipeline";

export interface ExplorerHistoricalSourceAttribution {
  sourceId: string;
  sourceFamily: "space-track" | "celestrak" | "gcat" | "unknown";
  sourceRole?: "satcat" | "orbit-history" | "current-orbit" | "metadata" | "unknown";
  sourceFile: string;
  recordId?: string;
  license?: string;
  lastUpdated?: string;
}

export interface ExplorerHistoricalIdentityAlias {
  kind: "norad" | "international-designator" | "cospar" | "name" | "source-record" | "mission";
  value: string;
  sourceId: string;
  sourceFamily: ExplorerHistoricalSourceAttribution["sourceFamily"];
  sourceFile: string;
  recordId?: string;
}

export interface ExplorerHistoricalFieldProvenance extends ExplorerHistoricalSourceAttribution {
  fieldName: string;
  rawValue: string;
  value: string;
  confidence: "authoritative" | "supplemental" | "source" | "current-orbit" | "unknown";
}

export interface ExplorerHistoricalMetadataConflict {
  field: string;
  severity: "error" | "warning";
  selectedValue: string;
  values: {
    value: string;
    provenances: ExplorerHistoricalFieldProvenance[];
  }[];
  message: string;
}

export interface ExplorerHistoricalValidationIssue {
  id: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  objectId?: string;
  sourceId?: string;
  sourceFile?: string;
  field?: string;
  values?: string[];
}

export interface ExplorerHistoricalCatalogObject {
  id: string;
  canonicalId?: string;
  canonicalIdentity?: {
    kind: "norad" | "international-designator" | "source-record";
    value: string;
  };
  catalogNumber?: string;
  name: string;
  alternateNames?: string[];
  internationalDesignator?: string;
  objectType?: string;
  launchDate?: string;
  existenceStartDate?: string;
  decayDate?: string;
  reentryDate?: string;
  owner?: string;
  status?: string;
  /**
   * Source-reported orbital envelope. These values constrain an educational
   * reconstruction; they are not an assertion of an exact Cartesian state.
   */
  orbitalSummary?: ExplorerHistoricalOrbitalSummary;
  sources: ExplorerHistoricalSourceAttribution[];
  sourceRecordIds?: { sourceId: string; recordId?: string }[];
  aliases?: ExplorerHistoricalIdentityAlias[];
  fieldProvenance?: Partial<Record<keyof ExplorerHistoricalCatalogObject | string, ExplorerHistoricalFieldProvenance[]>>;
  conflicts?: ExplorerHistoricalMetadataConflict[];
}

export interface ExplorerHistoricalOrbitalSummary {
  sourceEpoch?: string;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  inclinationDeg: number;
  regime?: string;
  sourceId: string;
  sourceFile: string;
  recordId?: string;
}

export interface ExplorerHistoricalOrbitState {
  id: string;
  objectId?: string;
  catalogNumber?: string;
  epoch: string;
  sourceEpoch?: string;
  tle?: {
    name?: string;
    line1: string;
    line2: string;
  };
  gp?: Record<string, string | number | null>;
  omm?: Record<string, string | number | null>;
  orbit?: {
    altitudeKm: number;
    eccentricity: number;
    inclinationDeg: number;
    raanDeg: number;
    argumentOfPeriapsisDeg: number;
    trueAnomalyDeg: number;
    epoch: string;
  };
  stateKind?: "source" | "reconstructed";
  reconstruction?: {
    method: "metadata-constrained-keplerian-v1";
    deterministicSeed: string;
    constrainedFields: readonly ["perigeeAltitudeKm", "apogeeAltitudeKm", "inclinationDeg"];
    synthesizedFields: readonly ["raanDeg", "argumentOfPeriapsisDeg", "trueAnomalyDeg"];
    sourceEpoch?: string;
    regime?: string;
  };
  sources: ExplorerHistoricalSourceAttribution[];
}

export interface ExplorerHistoricalSourceFile {
  id: string;
  family: ExplorerHistoricalSourceAttribution["sourceFamily"];
  role?: "satcat" | "metadata" | "orbit-history" | "catalog";
  fileName: string;
  importedAt: string;
  recordCount: number;
  byteLength?: number;
  checksum?: string;
  license?: string;
  lastUpdated?: string;
}

export interface ExplorerHistoricalRuntimeArtifacts {
  schemaVersion: 1;
  generatedAt: string | null;
  importVersion: string;
  sourceFingerprint: string;
  recordCounts: {
    objects: number;
    orbitStates: number;
    sources: number;
    identities: number;
    launches: number;
      decayOrReentryEvents: number;
  };
  objectIndex?: Record<
    string,
    {
      index: number;
      catalogNumber?: string;
      internationalDesignator?: string;
      launchDate?: string;
      existenceStartDate?: string;
      decayDate?: string;
      reentryDate?: string;
      objectType?: string;
      owner?: string;
    }
  >;
  identityIndex?: Record<string, string>;
  launchIndex?: { date: string; objectId: string }[];
  decayIndex?: { date: string; objectId: string; field: "decayDate" | "reentryDate" }[];
  orbitStateIndex?: Record<string, { id: string; epoch: string }[]>;
  coverageManifest: {
    membershipStatus:
      | "blocked-missing-satcat"
      | "loaded-with-errors"
      | "satcat-loaded";
    orbitStateStatus: "not-loaded" | "partial";
    completeMembership: boolean;
    catalogObjectCount: number;
    launchDatedObjectCount: number;
    missingLaunchDateCount: number;
    missingLifecycleStartDateCount?: number;
    decayedOrReenteredObjectCount: number;
    renderableOrbitStateCount: number;
    reconstructionEligibleObjectCount?: number;
    catalogOnlyObjectCount?: number;
    conflictCount: number;
    validationErrors: number;
    validationWarnings: number;
  };
  sourceManifest: {
    sourceFingerprint: string;
    sourceFiles: {
      id: string;
      family: ExplorerHistoricalSourceAttribution["sourceFamily"];
      role?: string;
      fileName: string;
      recordCount: number;
      byteLength?: number;
      checksum?: string;
      license?: string;
      lastUpdated?: string;
    }[];
  };
}

export interface ExplorerHistoricalCatalogDataset {
  schemaVersion: 1 | 2;
  generatedAt: string | null;
  importVersion?: string;
  sourceFingerprint?: string;
  importStatus?: {
    historicalMembership:
      | "blocked-missing-satcat"
      | "loaded-with-errors"
      | "satcat-loaded";
    historicalOrbitStates: "not-loaded" | "partial";
    requiredSources: {
      id: string;
      sourceFamily: ExplorerHistoricalSourceAttribution["sourceFamily"];
      role: string;
      status: "loaded" | "missing";
      purpose: string;
    }[];
  };
  validation?: {
    issueCountBySeverity: Partial<Record<"error" | "warning", number>>;
    issues: ExplorerHistoricalValidationIssue[];
  };
  sourceFiles: ExplorerHistoricalSourceFile[];
  objects: ExplorerHistoricalCatalogObject[];
  orbitStates: ExplorerHistoricalOrbitState[];
  runtimeArtifacts?: ExplorerHistoricalRuntimeArtifacts;
}

export interface ExplorerHistoricalCoverage {
  loaded: boolean;
  catalogObjectCount: number;
  renderableOrbitStateCount: number;
  exactOrbitStateCount: number;
  reconstructedOrbitStateCount: number;
  catalogOnlyObjectCount: number;
  sourceLabels: string[];
}

export const explorerHistoricalCatalog =
  normalizedCatalog as ExplorerHistoricalCatalogDataset;

export const explorerHistoricalCatalogIsLoaded =
  explorerHistoricalCatalog.objects.length > 0 || explorerHistoricalCatalog.orbitStates.length > 0;
export const explorerHistoricalCatalogIndex =
  createHistoricalCatalogIndex(explorerHistoricalCatalog);

export function historicalObjectExistsOnDate(
  object: ExplorerHistoricalCatalogObject,
  dateIso: string,
): boolean {
  return pipelineHistoricalObjectExistsOnDate(object, dateIso);
}

export function historicalOrbitStateForDate(
  object: ExplorerHistoricalCatalogObject,
  dateIso: string,
): ExplorerHistoricalOrbitState | undefined {
  return queryHistoricalCatalog(explorerHistoricalCatalogIndex, dateIso)
    .byObjectId.get(object.id)?.orbitState;
}

export function historicalCatalogCoverageForDate(dateIso: string): ExplorerHistoricalCoverage {
  const world = queryHistoricalCatalog(explorerHistoricalCatalogIndex, dateIso);

  if (!explorerHistoricalCatalogIndex.loaded) {
    return {
      loaded: false,
      catalogObjectCount: 0,
      renderableOrbitStateCount: 0,
      exactOrbitStateCount: 0,
      reconstructedOrbitStateCount: 0,
      catalogOnlyObjectCount: 0,
      sourceLabels: [],
    };
  }

  return {
    loaded: true,
    catalogObjectCount: world.catalogObjectCount,
    renderableOrbitStateCount: world.renderableOrbitStateCount,
    exactOrbitStateCount: world.exactOrbitStateCount,
    reconstructedOrbitStateCount: world.reconstructedOrbitStateCount,
    catalogOnlyObjectCount: world.catalogOnlyObjects.length,
    sourceLabels: world.sourceLabels,
  };
}
