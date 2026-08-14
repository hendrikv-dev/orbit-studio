import satelliteWebCatalog from "./generated/satelliteCatalog.web.json";
import {
  createHistoricalCatalogIndex,
  historicalObjectExistsOnDate as pipelineHistoricalObjectExistsOnDate,
  queryHistoricalCatalog,
} from "./explorerHistoricalPipeline";

export interface ExplorerHistoricalSourceAttribution {
  sourceId: string;
  sourceFamily: "space-track" | "celestrak" | "gcat" | "unknown";
  sourceRole?: "satcat" | "catalog" | "orbit-history" | "current-orbit" | "metadata" | "unknown";
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
  sourceObjectClass?: "payload" | "rocket_body" | "component" | "debris";
  launchDate?: string;
  existenceStartDate?: string;
  decayDate?: string;
  reentryDate?: string;
  /**
   * GCAT's authoritative parentage. Present only where the parent resolves to
   * another object in this catalog, so it is always followable. The separation
   * date is the fragmentation or deployment moment; its precision ranges from
   * a recorded minute to a bare year, and GCAT flags some as uncertain — both
   * travel with the link so a consumer can never present a guessed date as an
   * observed one.
   */
  fragmentation?: {
    parentRecordId: string;
    separationDateIso: string;
    separationDatePrecision: "second" | "minute" | "day" | "month" | "year";
    separationDateUncertain: boolean;
  };
  periodEndPresence?: {
    firstYear: number;
    lastYear: number;
    semantics: "present_at_period_end";
  };
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
  reconstructionVersion?: "orbit-studio-gcat-reconstruction-v1";
  raanDegReconstructed?: number;
  argumentOfPeriapsisDegReconstructed?: number;
  meanAnomalyDegReconstructed?: number;
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
    method:
      | "metadata-constrained-keplerian-v1"
      | "orbit-studio-gcat-reconstruction-v1";
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
      | "catalog-loaded"
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
  latestPublicSnapshot?: {
    timestampIso: string;
    catalogObjectCount: number;
    exactOrbitStateCount: number;
    reconstructedOrbitStateCount: number;
    catalogOnlyObjectCount: number;
    categoryCounts: {
      payloads: number;
      rocketBodies: number;
      components: number;
      debris: number;
    };
    renderableCategoryCounts: {
      payloads: number;
      rocketBodies: number;
      components: number;
      debris: number;
    };
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
      | "catalog-loaded"
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

type SatelliteObjectClass =
  | "payload"
  | "rocket_body"
  | "component"
  | "debris";

type SatelliteWebCatalogRow = [
  jcat: string,
  satcatNumber: string | null,
  name: string,
  payloadName: string | null,
  alternateNamesRaw: string | null,
  objectClassCode: "P" | "R" | "C" | "D",
  ownerCode: string | null,
  statusRaw: string | null,
  presentAtPeriodEndStartYear: number | null,
  presentAtPeriodEndEndYear: number | null,
  launchDateIso: string | null,
  separationDateIso: string | null,
  decayDateIso: string | null,
  sourceOrbitEpochIso: string | null,
  sourcePerigeeKm: number | null,
  sourceApogeeKm: number | null,
  sourceInclinationDeg: number | null,
  raanDegReconstructed: number | null,
  argumentOfPerigeeDegReconstructed: number | null,
  meanAnomalyDegReconstructed: number | null,
  /** GCAT's authoritative fragmentation link, null unless it resolves in this export. */
  parentJcat: string | null,
  separationDatePrecision: "second" | "minute" | "day" | "month" | "year" | null,
  /** 1 where GCAT marks the separation date itself as uncertain. */
  separationDateUncertain: 0 | 1,
];

interface SatelliteWebCatalogPeriod {
  year: number;
  periodEndDate: string;
  isPartialYear: boolean;
  membershipCount: number;
  reconstructedStateCount: number;
  catalogOnlyCount: number;
  classCounts: Record<SatelliteObjectClass, number>;
  reconstructedClassCounts: Record<SatelliteObjectClass, number>;
  catalogOnlyClassCounts: Record<SatelliteObjectClass, number>;
}

interface SatelliteWebCatalogArtifact {
  schemaVersion: 1;
  exportVersion: string;
  sourceFingerprint: string;
  source: {
    id: string;
    name: string;
    publisher: string;
    snapshotTimestampIso: string;
    license: string;
    attribution: string;
    rawSha256: string;
    databaseSha256: string;
  };
  counts: {
    sourceRecordCount: number;
    earthAssociatedSupportedClassCount: number;
    allHistoryReconstructionParameterCount: number;
    allHistoryCatalogOnlyCount: number;
    latestEarthMembershipCount: number;
    latestExactStateCount: number;
    latestReconstructedStateCount: number;
    latestCatalogOnlyCount: number;
    latestClassCounts: Record<SatelliteObjectClass, number>;
    latestRenderableClassCounts: Record<SatelliteObjectClass, number>;
    declaredParentCount: number;
    resolvedParentCount: number;
    resolvedDebrisParentCount: number;
  };
  periods: SatelliteWebCatalogPeriod[];
  rows: SatelliteWebCatalogRow[];
}

const canonicalSatelliteCatalog =
  satelliteWebCatalog as unknown as SatelliteWebCatalogArtifact;
const canonicalGcatSourceFile = "gcat-satcat-2026-06-27.tsv";
const canonicalGcatSourceId = canonicalSatelliteCatalog.source.id;
const sourceObjectClassForCode: Record<
  SatelliteWebCatalogRow[5],
  SatelliteObjectClass
> = {
  P: "payload",
  R: "rocket_body",
  C: "component",
  D: "debris",
};
const objectTypeForClass: Record<SatelliteObjectClass, string> = {
  payload: "Payload",
  rocket_body: "Rocket body",
  component: "Component",
  debris: "Debris",
};

function finiteOrbitSummary(
  row: SatelliteWebCatalogRow,
): ExplorerHistoricalOrbitalSummary | undefined {
  const [
    jcat,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    sourceOrbitEpochIso,
    sourcePerigeeKm,
    sourceApogeeKm,
    sourceInclinationDeg,
    raanDegReconstructed,
    argumentOfPeriapsisDegReconstructed,
    meanAnomalyDegReconstructed,
  ] = row;
  if (
    sourcePerigeeKm === null ||
    sourceApogeeKm === null ||
    sourceInclinationDeg === null
  ) {
    return undefined;
  }

  return {
    sourceEpoch: sourceOrbitEpochIso ?? undefined,
    perigeeAltitudeKm: sourcePerigeeKm,
    apogeeAltitudeKm: sourceApogeeKm,
    inclinationDeg: sourceInclinationDeg,
    sourceId: canonicalGcatSourceId,
    sourceFile: canonicalGcatSourceFile,
    recordId: jcat,
    reconstructionVersion: "orbit-studio-gcat-reconstruction-v1",
    raanDegReconstructed: raanDegReconstructed ?? undefined,
    argumentOfPeriapsisDegReconstructed:
      argumentOfPeriapsisDegReconstructed ?? undefined,
    meanAnomalyDegReconstructed: meanAnomalyDegReconstructed ?? undefined,
  };
}

function sourceAttributionForRow(
  jcat: string,
): ExplorerHistoricalSourceAttribution {
  return {
    sourceId: canonicalGcatSourceId,
    sourceFamily: "gcat",
    sourceRole: "catalog",
    sourceFile: canonicalGcatSourceFile,
    recordId: jcat,
    license: canonicalSatelliteCatalog.source.license,
    lastUpdated: canonicalSatelliteCatalog.source.snapshotTimestampIso,
  };
}

function historicalObjectForRow(
  row: SatelliteWebCatalogRow,
): ExplorerHistoricalCatalogObject {
  const [
    jcat,
    satcatNumber,
    name,
    payloadName,
    ,
    objectClassCode,
    ownerCode,
    statusRaw,
    firstYear,
    lastYear,
    launchDateIso,
    separationDateIso,
    decayDateIso,
  ] = row;
  const parentJcat = row[20];
  const separationDatePrecision = row[21];
  const separationDateUncertain = row[22] === 1;
  const sourceObjectClass = sourceObjectClassForCode[objectClassCode];
  const numericCatalogNumber = satcatNumber && /^\d+$/.test(satcatNumber)
    ? satcatNumber
    : undefined;
  const id = `gcat-${jcat.toLowerCase()}`;
  const source = sourceAttributionForRow(jcat);
  const alternateNames = [
    payloadName && payloadName !== name ? payloadName : null,
  ].filter((value): value is string => Boolean(value));

  return {
    id,
    canonicalId: id,
    canonicalIdentity: numericCatalogNumber
      ? { kind: "norad", value: numericCatalogNumber }
      : { kind: "source-record", value: jcat },
    catalogNumber: numericCatalogNumber,
    name,
    alternateNames,
    objectType: objectTypeForClass[sourceObjectClass],
    sourceObjectClass,
    launchDate: launchDateIso ?? undefined,
    existenceStartDate: separationDateIso ?? launchDateIso ?? undefined,
    decayDate: decayDateIso ?? undefined,
    fragmentation:
      parentJcat && separationDatePrecision && separationDateIso
        ? {
            parentRecordId: parentJcat,
            separationDateIso,
            separationDatePrecision,
            separationDateUncertain,
          }
        : undefined,
    periodEndPresence:
      firstYear !== null && lastYear !== null
        ? {
            firstYear,
            lastYear,
            semantics: "present_at_period_end",
          }
        : undefined,
    owner: ownerCode ?? undefined,
    status: statusRaw ?? undefined,
    orbitalSummary: finiteOrbitSummary(row),
    sources: [source],
    sourceRecordIds: [{ sourceId: canonicalGcatSourceId, recordId: jcat }],
    aliases: [
      {
        kind: "source-record",
        value: jcat,
        sourceId: canonicalGcatSourceId,
        sourceFamily: "gcat",
        sourceFile: canonicalGcatSourceFile,
        recordId: jcat,
      },
      ...(numericCatalogNumber
        ? [{
            kind: "norad" as const,
            value: numericCatalogNumber,
            sourceId: canonicalGcatSourceId,
            sourceFamily: "gcat" as const,
            sourceFile: canonicalGcatSourceFile,
            recordId: jcat,
          }]
        : []),
    ],
  };
}

const canonicalHistoricalObjects =
  canonicalSatelliteCatalog.rows.map(historicalObjectForRow);
const latestPeriod = canonicalSatelliteCatalog.periods[
  canonicalSatelliteCatalog.periods.length - 1
];
const launchDatedObjectCount = canonicalHistoricalObjects.filter(
  (object) => Boolean(object.launchDate),
).length;
const endedObjectCount = canonicalHistoricalObjects.filter(
  (object) => Boolean(object.decayDate ?? object.reentryDate),
).length;

export const explorerHistoricalCatalog: ExplorerHistoricalCatalogDataset = {
  schemaVersion: 2,
  generatedAt: canonicalSatelliteCatalog.source.snapshotTimestampIso,
  importVersion: canonicalSatelliteCatalog.exportVersion,
  sourceFingerprint: canonicalSatelliteCatalog.sourceFingerprint,
  importStatus: {
    historicalMembership: "satcat-loaded",
    historicalOrbitStates: "not-loaded",
    requiredSources: [
      {
        id: canonicalGcatSourceId,
        sourceFamily: "gcat",
        role: "catalog",
        status: "loaded",
        purpose:
          "Canonical public Earth-object membership, annual history, and reconstruction inputs.",
      },
    ],
  },
  validation: {
    issueCountBySeverity: { error: 0, warning: 0 },
    issues: [],
  },
  sourceFiles: [
    {
      id: canonicalGcatSourceId,
      family: "gcat",
      role: "satcat",
      fileName: canonicalGcatSourceFile,
      importedAt: canonicalSatelliteCatalog.source.snapshotTimestampIso,
      recordCount: canonicalSatelliteCatalog.counts.sourceRecordCount,
      checksum: canonicalSatelliteCatalog.source.rawSha256,
      license: canonicalSatelliteCatalog.source.license,
      lastUpdated: canonicalSatelliteCatalog.source.snapshotTimestampIso,
    },
  ],
  objects: canonicalHistoricalObjects,
  orbitStates: [],
  runtimeArtifacts: {
    schemaVersion: 1,
    generatedAt: canonicalSatelliteCatalog.source.snapshotTimestampIso,
    importVersion: canonicalSatelliteCatalog.exportVersion,
    sourceFingerprint: canonicalSatelliteCatalog.sourceFingerprint,
    recordCounts: {
      objects:
        canonicalSatelliteCatalog.counts.earthAssociatedSupportedClassCount,
      orbitStates: 0,
      sources: 1,
      identities:
        canonicalSatelliteCatalog.counts.earthAssociatedSupportedClassCount,
      launches: launchDatedObjectCount,
      decayOrReentryEvents: endedObjectCount,
    },
    coverageManifest: {
      membershipStatus: "satcat-loaded",
      orbitStateStatus: "not-loaded",
      completeMembership: true,
      catalogObjectCount:
        canonicalSatelliteCatalog.counts.earthAssociatedSupportedClassCount,
      launchDatedObjectCount,
      missingLaunchDateCount:
        canonicalSatelliteCatalog.counts.earthAssociatedSupportedClassCount
        - launchDatedObjectCount,
      missingLifecycleStartDateCount:
        canonicalHistoricalObjects.filter(
          (object) => !object.existenceStartDate && !object.launchDate,
        ).length,
      decayedOrReenteredObjectCount: endedObjectCount,
      renderableOrbitStateCount:
        canonicalSatelliteCatalog.counts.allHistoryReconstructionParameterCount,
      reconstructionEligibleObjectCount:
        canonicalSatelliteCatalog.counts.allHistoryReconstructionParameterCount,
      catalogOnlyObjectCount:
        canonicalSatelliteCatalog.counts.allHistoryCatalogOnlyCount,
      conflictCount: 0,
      validationErrors: 0,
      validationWarnings: 0,
    },
    latestPublicSnapshot: {
      timestampIso: canonicalSatelliteCatalog.source.snapshotTimestampIso,
      catalogObjectCount: latestPeriod.membershipCount,
      exactOrbitStateCount: 0,
      reconstructedOrbitStateCount: latestPeriod.reconstructedStateCount,
      catalogOnlyObjectCount: latestPeriod.catalogOnlyCount,
      categoryCounts: {
        payloads: latestPeriod.classCounts.payload,
        rocketBodies: latestPeriod.classCounts.rocket_body,
        components: latestPeriod.classCounts.component,
        debris: latestPeriod.classCounts.debris,
      },
      renderableCategoryCounts: {
        payloads: latestPeriod.reconstructedClassCounts.payload,
        rocketBodies: latestPeriod.reconstructedClassCounts.rocket_body,
        components: latestPeriod.reconstructedClassCounts.component,
        debris: latestPeriod.reconstructedClassCounts.debris,
      },
    },
    sourceManifest: {
      sourceFingerprint: canonicalSatelliteCatalog.sourceFingerprint,
      sourceFiles: [
        {
          id: canonicalGcatSourceId,
          family: "gcat",
          role: "catalog",
          fileName: canonicalGcatSourceFile,
          recordCount: canonicalSatelliteCatalog.counts.sourceRecordCount,
          checksum: canonicalSatelliteCatalog.source.rawSha256,
          license: canonicalSatelliteCatalog.source.license,
          lastUpdated: canonicalSatelliteCatalog.source.snapshotTimestampIso,
        },
      ],
    },
  },
};

export const explorerCanonicalSatellitePeriods =
  canonicalSatelliteCatalog.periods;
export const explorerCanonicalSatelliteSource =
  canonicalSatelliteCatalog.source;
export const explorerCanonicalSatelliteCounts =
  canonicalSatelliteCatalog.counts;

export const explorerHistoricalCatalogIsLoaded =
  explorerHistoricalCatalog.objects.length > 0 || explorerHistoricalCatalog.orbitStates.length > 0;
export const explorerLatestPublicCatalogSnapshot =
  explorerHistoricalCatalog.runtimeArtifacts?.latestPublicSnapshot;
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
