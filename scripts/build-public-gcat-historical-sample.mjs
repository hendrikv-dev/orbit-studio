import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const inputPath = resolve("data/historical-catalog/raw/gcat-satcat.tsv");
const outputPath = resolve("src/data/historical/explorerHistoricalCatalog.normalized.json");
const importedAt = "2026-07-04T00:00:00.000Z";
const sampleModulo = 12;
const alwaysIncludeCatalogNumbers = new Set([
  "1",
  "2",
  "4",
  "20580",
  "25544",
  "29716",
  "33757",
  "33771",
  "44235",
]);
const exactLaunchTimes = new Map([
  ["1", "1957-10-04T19:28:34.000Z"],
  ["2", "1957-10-04T19:28:34.000Z"],
]);
const canonicalNames = new Map([
  ["1", "Sputnik 1 launch vehicle stage"],
  ["2", "Sputnik 1"],
]);

const months = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    .map((month, index) => [month.toLowerCase(), index]),
);

function normalizeCatalogNumber(value) {
  const normalized = value.trim().replace(/^0+/, "");
  return normalized || value.trim();
}

function parseGcatNumber(value) {
  const cleaned = String(value ?? "").replace(/[?~<>]/g, "").trim();
  if (!cleaned || cleaned === "-") return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseGcatDate(value) {
  const cleaned = value.trim().replace(/\?/g, "");
  if (!cleaned || cleaned === "-") return undefined;

  const match = cleaned.match(/^(\d{4})\s+([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{2})(\d{2}))?/);
  if (!match) return undefined;

  const [, yearText, monthText, dayText, hourText = "00", minuteText = "00"] = match;
  const month = months.get(monthText.toLowerCase());
  if (month === undefined) return undefined;

  const date = new Date(Date.UTC(
    Number(yearText),
    month,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
  ));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function alternateNames(row, indexes) {
  const names = new Set();
  const plName = row[indexes.PLName]?.trim();
  const altNames = row[indexes.AltNames]?.trim();

  if (plName && plName !== "-") names.add(plName);
  if (altNames && altNames !== "-") {
    altNames
      .split(":")
      .map((name) => name.trim())
      .filter(Boolean)
      .forEach((name) => names.add(name));
  }

  return [...names];
}

function statusLabel(status) {
  const normalized = status.trim();
  if (normalized.includes("O")) return "Operational";
  if (normalized.includes("R") || normalized.includes("D")) return "Historical";
  return "Reference";
}

function hasTerminalDecayStatus(status) {
  const normalized = status.trim();
  return normalized === "R" || normalized === "AR";
}

function objectTypeLabel(type) {
  const normalized = type.trim();
  if (normalized.startsWith("P")) return "PAYLOAD";
  if (normalized.startsWith("R")) return "ROCKET BODY";
  if (normalized.startsWith("C")) return "COMPONENT";
  return normalized || "CATALOG OBJECT";
}

function sourceAttribution(recordId) {
  return {
    sourceId: "gcat:public-satcat-sample",
    sourceFamily: "gcat",
    sourceRole: "catalog",
    sourceFile: "gcat-satcat.tsv",
    recordId,
    license: "CC-BY-4.0",
    lastUpdated: "2026-06-27",
  };
}

function objectForRow(row, indexes) {
  const catalogNumber = normalizeCatalogNumber(row[indexes.Satcat] ?? "");
  const jcat = row[indexes.JCAT]?.trim() || `S${catalogNumber.padStart(5, "0")}`;
  const launchDate = exactLaunchTimes.get(catalogNumber) ?? parseGcatDate(row[indexes.LDate] ?? "");
  const sourceExistenceStartDate = parseGcatDate(row[indexes.SDate] ?? "") ?? launchDate;
  const existenceStartDate = exactLaunchTimes.has(catalogNumber)
    ? launchDate
    : sourceExistenceStartDate;
  const rawStatus = row[indexes.Status] ?? "";
  const status = statusLabel(rawStatus);
  const parsedDecayDate = parseGcatDate(row[indexes.DDate] ?? "");
  const decayDate =
    hasTerminalDecayStatus(rawStatus) &&
    parsedDecayDate &&
    (!existenceStartDate || Date.parse(parsedDecayDate) >= Date.parse(existenceStartDate))
      ? parsedDecayDate
      : undefined;
  const source = sourceAttribution(jcat);
  const perigeeAltitudeKm = parseGcatNumber(row[indexes.Perigee]);
  const apogeeAltitudeKm = parseGcatNumber(row[indexes.Apogee]);
  const inclinationDeg = parseGcatNumber(row[indexes.Inc]);
  const orbitalSummary =
    perigeeAltitudeKm !== undefined &&
    apogeeAltitudeKm !== undefined &&
    inclinationDeg !== undefined &&
    apogeeAltitudeKm >= perigeeAltitudeKm &&
    inclinationDeg >= 0 && inclinationDeg <= 180
      ? {
          sourceEpoch: parseGcatDate(row[indexes.ODate] ?? ""),
          perigeeAltitudeKm,
          apogeeAltitudeKm,
          inclinationDeg,
          regime: row[indexes.OpOrbit]?.trim() || undefined,
          sourceId: source.sourceId,
          sourceFile: source.sourceFile,
          recordId: source.recordId,
        }
      : undefined;
  const aliases = [
    {
      kind: "norad",
      value: catalogNumber,
      sourceId: source.sourceId,
      sourceFamily: source.sourceFamily,
      sourceFile: source.sourceFile,
      recordId: source.recordId,
    },
    {
      kind: "source-record",
      value: jcat,
      sourceId: source.sourceId,
      sourceFamily: source.sourceFamily,
      sourceFile: source.sourceFile,
      recordId: source.recordId,
    },
  ];

  return {
    id: `gcat-${jcat.toLowerCase()}`,
    canonicalIdentity: {
      kind: "norad",
      value: catalogNumber,
    },
    catalogNumber,
    name: canonicalNames.get(catalogNumber) ??
      (row[indexes.Name]?.trim() || `GCAT ${jcat}`).replace(/\s+/g, " "),
    alternateNames: [
      ...new Set([
        ...alternateNames(row, indexes),
        ...(canonicalNames.has(catalogNumber) ? [row[indexes.Name]?.trim()].filter(Boolean) : []),
      ]),
    ],
    internationalDesignator: row[indexes.Piece]?.trim() || undefined,
    objectType: objectTypeLabel(row[indexes.Type] ?? ""),
    launchDate,
    existenceStartDate,
    decayDate,
    owner: row[indexes.Owner]?.trim() || row[indexes.State]?.trim() || undefined,
    status,
    orbitalSummary,
    sources: [source],
    sourceRecordIds: [{ sourceId: source.sourceId, recordId: source.recordId }],
    aliases,
  };
}

const lines = readFileSync(inputPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean);
const headerLine = lines.find((line) => line.startsWith("#JCAT"));
if (!headerLine) {
  throw new Error(`Could not find GCAT header in ${inputPath}`);
}

const header = headerLine.replace(/^#/, "").split("\t");
const indexes = Object.fromEntries(header.map((column, index) => [column, index]));
const rows = lines
  .filter((line) => !line.startsWith("#"))
  .map((line) => line.split("\t"))
  .filter((row) => {
    const satcat = row[indexes.Satcat]?.trim();
    const primary = row[indexes.Primary]?.trim();
    return primary === "Earth" && satcat && satcat !== "-" && parseGcatDate(row[indexes.LDate] ?? "");
  });

const selectedRows = rows.filter((row) => {
  const catalogNumber = normalizeCatalogNumber(row[indexes.Satcat] ?? "");
  const numericCatalogNumber = Number(catalogNumber);

  return (
    alwaysIncludeCatalogNumbers.has(catalogNumber) ||
    numericCatalogNumber <= 1_200 ||
    numericCatalogNumber % sampleModulo === 0
  );
});

const objectsById = new Map();
for (const row of selectedRows) {
  const object = objectForRow(row, indexes);
  if (!object.launchDate) continue;
  objectsById.set(object.id, object);
}

const objects = [...objectsById.values()].sort((left, right) =>
  (left.catalogNumber ?? left.id).localeCompare(right.catalogNumber ?? right.id, undefined, {
    numeric: true,
  }),
);
const decayedOrReenteredObjectCount = objects.filter((object) => object.decayDate || object.reentryDate).length;
const reconstructionEligibleObjectCount = objects.filter((object) => object.orbitalSummary).length;

const output = {
  schemaVersion: 2,
  generatedAt: importedAt,
  importVersion: "orbit-studio-public-gcat-sample-v2-orbital-summaries",
  sourceFingerprint: "gcat-public-sample:modulo-12-plus-early-and-milestones:orbital-summaries-v1",
  importStatus: {
    historicalMembership: "blocked-missing-satcat",
    historicalOrbitStates: "not-loaded",
    requiredSources: [
      {
        id: "gcat:satcat",
        sourceFamily: "gcat",
        role: "catalog",
        status: "loaded",
        purpose: "public-safe sampled historical catalog membership and lifecycle demonstration",
      },
      {
        id: "celestrak:satcat",
        sourceFamily: "celestrak",
        role: "satcat",
        status: "missing",
        purpose: "complete SATCAT-scale membership is generated locally and not bundled in the public sample",
      },
    ],
  },
  validation: {
    issueCountBySeverity: {
      error: 0,
      warning: 0,
    },
    issues: [],
  },
  sourceFiles: [
    {
      id: "gcat:public-satcat-sample",
      family: "gcat",
      role: "catalog",
      fileName: "gcat-satcat.tsv",
      importedAt,
      recordCount: objects.length,
      license: "CC-BY-4.0",
      lastUpdated: "2026-06-27",
    },
  ],
  objects,
  orbitStates: [],
  runtimeArtifacts: {
    schemaVersion: 1,
    generatedAt: importedAt,
    importVersion: "orbit-studio-public-gcat-sample-v2-orbital-summaries",
    sourceFingerprint: "gcat-public-sample:modulo-12-plus-early-and-milestones:orbital-summaries-v1",
    recordCounts: {
      objects: objects.length,
      orbitStates: 0,
      sources: 1,
      identities: objects.length,
      launches: objects.length,
      decayOrReentryEvents: decayedOrReenteredObjectCount,
    },
    coverageManifest: {
      membershipStatus: "blocked-missing-satcat",
      orbitStateStatus: "not-loaded",
      completeMembership: false,
      catalogObjectCount: objects.length,
      launchDatedObjectCount: objects.length,
      missingLaunchDateCount: 0,
      missingLifecycleStartDateCount: 0,
      decayedOrReenteredObjectCount,
      renderableOrbitStateCount: 0,
      reconstructionEligibleObjectCount,
      catalogOnlyObjectCount: objects.length - reconstructionEligibleObjectCount,
      conflictCount: 0,
      validationErrors: 0,
      validationWarnings: 0,
    },
    sourceManifest: {
      sourceFingerprint: "gcat-public-sample:modulo-12-plus-early-and-milestones:orbital-summaries-v1",
      sourceFiles: [
        {
          id: "gcat:public-satcat-sample",
          family: "gcat",
          role: "catalog",
          fileName: "gcat-satcat.tsv",
          recordCount: objects.length,
          license: "CC-BY-4.0",
          lastUpdated: "2026-06-27",
        },
      ],
    },
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${objects.length.toLocaleString()} GCAT-derived public historical sample objects to ${outputPath}`);
