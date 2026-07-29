// The public release intentionally imports an empty record set. Vite may replace this import with
// a locally acquired, ignored snapshot only when ORBIT_CURRENT_CATALOG_MODE=local is explicit.
import records from "./explorerCelestrakCatalog.records.json";

export type ExplorerCelestrakCatalogRecord = {
  id: string;
  name: string;
  catalogNumber: string;
  categoryId: "payloads" | "rocket-bodies" | "debris";
  objectType: string;
  operator: string;
  country: string;
  launched: string;
  status: "Operational" | "Reference";
  sourceGroup: string;
  constellationId?: string;
  tle: { name: string; line1: string; line2: string };
  orbit: {
    altitudeKm: number;
    eccentricity: number;
    inclinationDeg: number;
    raanDeg: number;
    argumentOfPeriapsisDeg: number;
    trueAnomalyDeg: number;
    epoch: string;
    color: string;
  };
};

export const explorerCurrentReferenceDate = "2026-07-18";

const snapshotEpochs = (records as ExplorerCelestrakCatalogRecord[])
  .map((record) => Date.parse(record.orbit.epoch))
  .filter(Number.isFinite);
const latestSnapshotEpoch = snapshotEpochs.length > 0 ? Math.max(...snapshotEpochs) : null;

export const explorerCelestrakSnapshotDate = latestSnapshotEpoch === null
  ? null
  : new Date(latestSnapshotEpoch).toISOString().slice(0, 10);

export const explorerCurrentCatalogMode = explorerCelestrakSnapshotDate
  ? "local-acquired"
  : "release-reference-only";

export const explorerCelestrakCatalogSource = {
  id: "celestrak-gp-local-acquisition",
  name: explorerCelestrakSnapshotDate
    ? "Locally acquired CelesTrak GP catalog"
    : "CelesTrak GP catalog (not bundled)",
  description: explorerCelestrakSnapshotDate
    ? `Local GP records generated from CelesTrak groups, latest epoch ${explorerCelestrakSnapshotDate}.`
    : "The public source and deployment do not bundle CelesTrak records because redistribution permission was not verified.",
  kind: "tle-feed",
  supportsHistoricalSnapshots: false,
  updateCadence: "daily",
} as const;

export const explorerCelestrakCatalogAttributionLabel =
  explorerCelestrakSnapshotDate
    ? `Locally acquired CelesTrak GP records, latest epoch ${explorerCelestrakSnapshotDate}`
    : "CelesTrak records not bundled";

export const explorerCelestrakCatalogRecords = records as ExplorerCelestrakCatalogRecord[];
