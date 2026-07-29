import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliArgs = process.argv.slice(2);
const mergeExistingFlag = cliArgs.includes("--merge-existing");
const writeRuntimeFlag = cliArgs.includes("--write-runtime");
const positionalArgs = cliArgs.filter((arg) => arg !== "--merge-existing" && arg !== "--write-runtime");
const inputDirectory = resolve(positionalArgs[0] ?? "data/historical-catalog/raw");
const outputPath = resolve(
  positionalArgs[1] ??
    (writeRuntimeFlag
      ? "src/data/historical/explorerHistoricalCatalog.normalized.json"
      : "data/generated/historical/explorerHistoricalCatalog.normalized.json"),
);

const earthRadiusKm = 6378.137;
const earthMuKm3S2 = 398600.4418;
const schemaVersion = 2;
const importVersion = "explorer-historical-import-v3";
const runtimeArtifactsSchemaVersion = 1;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicTimestamp(seed) {
  const text = String(seed ?? "");
  if (!text) return null;
  if (process.env.SOURCE_DATE_EPOCH) {
    const seconds = Number(process.env.SOURCE_DATE_EPOCH);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  const seconds = Number.parseInt(sha256Text(text).slice(0, 8), 16);
  const start = Date.UTC(2000, 0, 1);
  const span = 30 * 365 * 24 * 60 * 60;
  return new Date(start + (seconds % span) * 1000).toISOString();
}

const fieldDefinitions = {
  catalogNumber: [
    "NORAD_CAT_ID",
    "NORAD_CAT_NR",
    "CATALOG_NUMBER",
    "Satcat",
    "SatCat",
    "satcat",
    "catalogNumber",
    "norad",
  ],
  internationalDesignator: [
    "OBJECT_ID",
    "INTLDES",
    "InternationalDesignator",
    "COSPAR_ID",
    "COSPAR",
    "Piece",
    "objectId",
  ],
  name: [
    "OBJECT_NAME",
    "OBJECT_NAME_LONG",
    "name",
    "Name",
    "ObjectName",
    "Satellite",
    "JCAT",
  ],
  objectType: [
    "OBJECT_TYPE",
    "object_type",
    "ObjectType",
    "TYPE",
    "Type",
    "Payload",
    "category",
  ],
  launchDate: ["LAUNCH_DATE", "LDate", "LaunchDate", "launchDate"],
  existenceStartDate: ["SDate", "ExistenceStartDate", "existenceStartDate"],
  decayDate: ["DECAY_DATE", "DDate", "DecayDate", "decayDate"],
  reentryDate: ["REENTRY_DATE", "RDate", "ReentryDate", "reentryDate"],
  owner: ["OWNER", "OWNER_CODE", "COUNTRY", "State", "state", "owner", "Owner"],
  status: ["OPS_STATUS_CODE", "STATUS", "Status", "status"],
};

const monthIndexes = new Map(
  ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].map(
    (month, index) => [month, index],
  ),
);

function clean(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length ? text : undefined;
}

function isPlaceholderValue(value) {
  const text = clean(value);
  if (!text) return true;
  return ["-", "?", "N/A", "NA", "NNA", "NONE", "NULL", "UNKNOWN"].includes(text.toUpperCase());
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function numeric(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function orbitalSummaryFromRecord(record, source) {
  const perigeeAltitudeKm = numeric(clean(record.Perigee ?? record.PERIGEE));
  const apogeeAltitudeKm = numeric(clean(record.Apogee ?? record.APOGEE));
  const inclinationDeg = numeric(clean(record.Inc ?? record.INCLINATION));
  if (
    perigeeAltitudeKm === undefined ||
    apogeeAltitudeKm === undefined ||
    inclinationDeg === undefined ||
    apogeeAltitudeKm < perigeeAltitudeKm ||
    inclinationDeg < 0 || inclinationDeg > 180
  ) return undefined;

  return {
    sourceEpoch: normalizeDate(record.ODate ?? record.ORBIT_DATE).value,
    perigeeAltitudeKm,
    apogeeAltitudeKm,
    inclinationDeg,
    regime: clean(record.OpOrbit ?? record.ORBIT_REGIME),
    sourceId: source.sourceId,
    sourceFile: source.sourceFile,
    recordId: source.recordId,
  };
}

function firstField(record, fields) {
  for (const field of fields) {
    const value = clean(record[field]);
    if (value !== undefined) return { fieldName: field, rawValue: value };
  }
  return undefined;
}

function normalizeCatalogNumber(value) {
  const text = clean(value);
  if (!text) return undefined;
  if (isPlaceholderValue(text)) return undefined;
  if (!/^\d+$/.test(text)) return undefined;
  return String(Number(text));
}

function normalizeInternationalDesignator(value) {
  const text = clean(value);
  if (!text) return undefined;
  if (isPlaceholderValue(text)) return undefined;
  const normalized = text.toUpperCase().replace(/\s+/g, "");
  if (!/^\d{4}-\d{3}[A-Z0-9]{0,4}$/.test(normalized)) return undefined;
  return normalized;
}

function normalizeObjectType(value) {
  const text = clean(value);
  if (!text) return undefined;
  if (isPlaceholderValue(text)) return undefined;
  const normalized = text.replace(/\s+/g, " ").trim();
  const upper = normalized.toUpperCase();
  if (["PAY", "PAYLOAD", "P"].includes(upper)) return "PAYLOAD";
  if (["R/B", "ROCKET BODY", "ROCKET_BODY", "ROCKET"].includes(upper)) return "ROCKET BODY";
  if (["DEB", "DEBRIS", "D"].includes(upper)) return "DEBRIS";
  if (upper.startsWith("P")) return "PAYLOAD";
  if (upper.startsWith("R")) return "ROCKET BODY";
  if (upper.startsWith("D")) return "DEBRIS";
  return normalized;
}

function hasFullDateShape(text) {
  return (
    /^\d{4}-\d{2}-\d{2}(?:$|[T\s])/.test(text) ||
    /^\d{4}\/\d{2}\/\d{2}(?:$|[T\s])/.test(text) ||
    /^\d{4}\s+[A-Za-z]{3,}\s+\d{1,2}/.test(text) ||
    /^\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}/.test(text) ||
    /^[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}/.test(text)
  );
}

function normalizeDate(value) {
  const text = clean(value);
  if (!text) return { value: undefined };
  if (text === "-" || text === "?") return { value: undefined };
  const normalizedText = text
    .replace(/\?/g, "")
    .replace(/\s+/g, " ")
    .replace(/(\d{4}\s+[A-Za-z]{3,}\s+\d{1,2})\s+(\d{2})(\d{2})(?::(\d{2}))?$/, "$1 $2:$3:$4")
    .replace(/:$/, "")
    .trim();
  if (!hasFullDateShape(normalizedText)) {
    return { value: undefined, invalidReason: "date is not precise to a full day" };
  }
  const monthDateMatch = normalizedText.match(
    /^(\d{4})\s+([A-Za-z]{3,})\s+(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (monthDateMatch) {
    const monthIndex = monthIndexes.get(monthDateMatch[2].slice(0, 3).toUpperCase());
    if (monthIndex === undefined) return { value: undefined, invalidReason: "month could not be parsed" };
    return {
      value: new Date(
        Date.UTC(
          Number(monthDateMatch[1]),
          monthIndex,
          Number(monthDateMatch[3]),
          Number(monthDateMatch[4] ?? 0),
          Number(monthDateMatch[5] ?? 0),
          Number(monthDateMatch[6] ?? 0),
        ),
      ).toISOString(),
    };
  }
  const parsed = Date.parse(normalizedText);
  if (!Number.isFinite(parsed)) return { value: undefined, invalidReason: "date could not be parsed" };
  return { value: new Date(parsed).toISOString() };
}

function dateMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDay(value) {
  const parsed = dateMs(value);
  if (parsed === null) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

function isDateOnlyIso(value) {
  return Boolean(value?.endsWith("T00:00:00.000Z"));
}

function lifecycleEndBeforeStart(endValue, startValue) {
  const endMs = dateMs(endValue);
  const startMs = dateMs(startValue);
  if (endMs === null || startMs === null || endMs >= startMs) return false;
  if (isDateOnlyIso(endValue) && utcDay(endValue) === utcDay(startValue)) return false;
  return true;
}

function lifecycleEndBeforeReferenceDate(endValue, referenceValue = new Date().toISOString()) {
  const endMs = dateMs(endValue);
  const referenceMs = dateMs(referenceValue);
  if (endMs === null || referenceMs === null || endMs >= referenceMs) return false;
  if (isDateOnlyIso(endValue) && utcDay(endValue) === utcDay(referenceValue)) return false;
  return true;
}

function dateBeforeDate(leftValue, rightValue) {
  const leftMs = dateMs(leftValue);
  const rightMs = dateMs(rightValue);
  if (leftMs === null || rightMs === null || leftMs >= rightMs) return false;
  if (isDateOnlyIso(leftValue) && utcDay(leftValue) === utcDay(rightValue)) return false;
  return true;
}

const activeOrOpenStatusCodes = new Set(["+", "O"]);

function isActiveOrOpenStatus(value) {
  const status = clean(value)?.toUpperCase();
  return Boolean(status && activeOrOpenStatusCodes.has(status));
}

function normalizeField(field, rawValue) {
  if (field === "catalogNumber") return normalizeCatalogNumber(rawValue);
  if (field === "internationalDesignator") return normalizeInternationalDesignator(rawValue);
  if (field === "objectType") return normalizeObjectType(rawValue);
  if (
    field === "launchDate" ||
    field === "existenceStartDate" ||
    field === "decayDate" ||
    field === "reentryDate"
  ) {
    return normalizeDate(rawValue).value;
  }
  if (field === "name") return isPlaceholderValue(rawValue) ? undefined : clean(rawValue)?.replace(/\s+/g, " ");
  return clean(rawValue);
}

function isSatcatAuthority(source) {
  return source?.sourceRole === "satcat" &&
    (source.sourceFamily === "space-track" || source.sourceFamily === "celestrak");
}

function hasOpenAuthoritativeLifecycle(group, field) {
  if (field !== "decayDate" && field !== "reentryDate") return false;
  return group.some(
    (candidate) =>
      isSatcatAuthority(candidate.source) &&
      !candidate.fields[field]?.value &&
      isActiveOrOpenStatus(candidate.fields.status?.value),
  );
}

function confidenceFor(source, field) {
  if (isSatcatAuthority(source)) {
    if (
      [
        "catalogNumber",
        "internationalDesignator",
        "launchDate",
        "decayDate",
        "reentryDate",
        "owner",
        "objectType",
      ].includes(field)
    ) {
      return "authoritative";
    }
    return "source";
  }
  if (source.sourceFamily === "space-track") return "source";
  if (source.sourceFamily === "gcat") return "supplemental";
  if (source.sourceFamily === "celestrak") return "current-orbit";
  return "unknown";
}

function sourceRank(source, field) {
  if (source.sourceFamily === "space-track" && source.sourceRole === "satcat") return 500;
  if (source.sourceFamily === "celestrak" && source.sourceRole === "satcat") return 450;
  if (source.sourceFamily === "space-track") return 400;
  if (source.sourceFamily === "gcat" && field === "existenceStartDate") return 425;
  if (source.sourceFamily === "gcat") {
    return ["name", "objectType", "owner", "status"].includes(field) ? 250 : 200;
  }
  if (source.sourceFamily === "unknown") return 100;
  if (source.sourceFamily === "celestrak") return 50;
  return 0;
}

function makeIssue({ severity = "warning", code, message, objectId, sourceId, sourceFile, field, values }) {
  return {
    id: `${code}:${objectId ?? sourceId ?? sourceFile ?? "dataset"}:${field ?? "record"}:${slug(message).slice(0, 48)}`,
    severity,
    code,
    message,
    objectId,
    sourceId,
    sourceFile,
    field,
    values,
  };
}

function provenanceFor(source, fieldName, field, rawValue, value) {
  return {
    sourceId: source.sourceId,
    sourceFamily: source.sourceFamily,
    sourceRole: source.sourceRole,
    sourceFile: source.sourceFile,
    recordId: source.recordId,
    fieldName,
    rawValue,
    value,
    confidence: confidenceFor(source, field),
    license: source.license,
    lastUpdated: source.lastUpdated,
  };
}

function parseCsv(text, delimiter = ",") {
  const rows = [];
  let cell = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (quoted && character === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (character === "\"") {
      quoted = !quoted;
      continue;
    }

    if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim().length)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  row.push(cell);
  if (row.some((value) => value.trim().length)) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows
    .slice(1)
    .filter((values) => !values[0]?.trim().startsWith("#"))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])),
    );
}

function parseTsv(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (rows.length === 0) return [];

  const headers = rows[0]
    .split("\t")
    .map((header) => header.trim().replace(/^#/, ""));

  return rows
    .slice(1)
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => {
      const values = line.split("\t");
      return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
    });
}

function flattenJson(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  for (const key of ["records", "objects", "satcat", "gp", "history", "data"]) {
    if (Array.isArray(value[key])) return value[key];
  }

  return [value];
}

function parseTleEpoch(line1) {
  const year = Number(line1.slice(18, 20));
  const day = Number(line1.slice(20, 32));
  if (!Number.isFinite(year) || !Number.isFinite(day)) return undefined;

  const fullYear = year >= 57 ? 1900 + year : 2000 + year;
  const start = Date.UTC(fullYear, 0, 1);
  return new Date(start + (day - 1) * 86_400_000).toISOString();
}

function parseInternationalDesignatorFromTle(line1) {
  const raw = line1.slice(9, 17);
  const match = raw.match(/^(\d{2})(\d{3})([A-Z0-9 ]{1,3})$/);
  if (!match) return undefined;
  const year = Number(match[1]) >= 57 ? `19${match[1]}` : `20${match[1]}`;
  return `${year}-${match[2]}${match[3].trim()}`;
}

function meanToTrueAnomalyDeg(meanAnomalyDeg, eccentricity) {
  const mean = ((((meanAnomalyDeg % 360) + 360) % 360) * Math.PI) / 180;
  let eccentricAnomaly = eccentricity < 0.8 ? mean : Math.PI;

  for (let index = 0; index < 20; index += 1) {
    const delta =
      (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - mean) /
      (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }

  const trueAnomaly = Math.atan2(
    Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomaly),
    Math.cos(eccentricAnomaly) - eccentricity,
  );
  return (((trueAnomaly * 180) / Math.PI) % 360 + 360) % 360;
}

function semiMajorAxisKm(meanMotionRevolutionsPerDay) {
  const meanMotionRadS = (meanMotionRevolutionsPerDay * Math.PI * 2) / 86400;
  return Math.cbrt(earthMuKm3S2 / (meanMotionRadS * meanMotionRadS));
}

function orbitFromElements(record, epoch) {
  const meanMotion = numeric(
    record.MEAN_MOTION ?? record.mean_motion ?? record.MEANMOTION ?? record.MM,
  );
  const inclinationDeg = numeric(
    record.INCLINATION ?? record.inclination ?? record.INCLINATION_DEG ?? record.INC,
  );
  const raanDeg = numeric(
    record.RA_OF_ASC_NODE ?? record.ra_of_asc_node ?? record.RAAN ?? record.NODE,
  );
  const eccentricity = numeric(record.ECCENTRICITY ?? record.eccentricity ?? record.ECC);
  const argumentOfPeriapsisDeg = numeric(
    record.ARG_OF_PERICENTER ?? record.arg_of_pericenter ?? record.ARG_PERICENTER ?? record.ARGP,
  );
  const meanAnomalyDeg = numeric(
    record.MEAN_ANOMALY ?? record.mean_anomaly ?? record.MEANANOMALY ?? record.MA,
  );

  if (
    meanMotion === undefined ||
    inclinationDeg === undefined ||
    raanDeg === undefined ||
    eccentricity === undefined ||
    argumentOfPeriapsisDeg === undefined ||
    meanAnomalyDeg === undefined ||
    !epoch
  ) {
    return undefined;
  }

  return {
    altitudeKm: semiMajorAxisKm(meanMotion) - earthRadiusKm,
    eccentricity,
    inclinationDeg,
    raanDeg,
    argumentOfPeriapsisDeg,
    trueAnomalyDeg: meanToTrueAnomalyDeg(meanAnomalyDeg, eccentricity),
    epoch,
  };
}

function orbitFromTle(line1, line2, epoch) {
  if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) return undefined;
  const inclinationDeg = numeric(line2.slice(8, 16));
  const raanDeg = numeric(line2.slice(17, 25));
  const eccentricity = numeric(`0.${line2.slice(26, 33).trim()}`);
  const argumentOfPeriapsisDeg = numeric(line2.slice(34, 42));
  const meanAnomalyDeg = numeric(line2.slice(43, 51));
  const meanMotion = numeric(line2.slice(52, 63));

  if (
    inclinationDeg === undefined ||
    raanDeg === undefined ||
    eccentricity === undefined ||
    argumentOfPeriapsisDeg === undefined ||
    meanAnomalyDeg === undefined ||
    meanMotion === undefined ||
    !epoch
  ) {
    return undefined;
  }

  return {
    altitudeKm: semiMajorAxisKm(meanMotion) - earthRadiusKm,
    eccentricity,
    inclinationDeg,
    raanDeg,
    argumentOfPeriapsisDeg,
    trueAnomalyDeg: meanToTrueAnomalyDeg(meanAnomalyDeg, eccentricity),
    epoch,
  };
}

function detectFamily(fileName, records) {
  const lower = fileName.toLowerCase();
  const sampleKeys = Object.keys(records[0] ?? {}).join(" ").toLowerCase();

  if (lower.includes("gcat") || sampleKeys.includes("jcat")) return "gcat";
  if (lower.includes("celestrak")) return "celestrak";
  if (
    lower.includes("space-track") ||
    lower.includes("spacetrack") ||
    lower.includes("satcat") ||
    sampleKeys.includes("norad_cat_id") ||
    sampleKeys.includes("object_name")
  ) {
    return "space-track";
  }
  return "unknown";
}

function detectRole(fileName, records) {
  const lower = fileName.toLowerCase();
  const sampleKeys = Object.keys(records[0] ?? {}).join(" ").toLowerCase();
  if (lower.includes("gcat")) return "metadata";
  if (
    lower.includes("gp") ||
    lower.includes("tle") ||
    sampleKeys.includes("epoch") ||
    sampleKeys.includes("mean_motion") ||
    sampleKeys.includes("tle_line")
  ) {
    return "orbit-history";
  }
  if (
    lower.includes("satcat") ||
    sampleKeys.includes("launch_date") ||
    sampleKeys.includes("decay_date")
  ) {
    return "satcat";
  }
  return "catalog";
}

function recordIdFrom(record, fallback) {
  for (const value of [record.RECORD_ID, record.JCAT, record.OBJECT_ID, record.NORAD_CAT_ID, record.Satcat]) {
    if (!isPlaceholderValue(value)) return clean(value);
  }
  return String(fallback);
}

function fieldCandidate(record, source, field, issues) {
  if (field === "existenceStartDate") {
    const rawType = clean(record.Type ?? record.OBJECT_TYPE ?? record.objectType);
    const normalizedType = normalizeObjectType(rawType);
    const isDebrisLike = normalizedType === "DEBRIS" || rawType?.trim().startsWith("D");
    if (!isDebrisLike) return undefined;
  }

  const match = firstField(record, fieldDefinitions[field]);
  if (!match) return undefined;

  if (field === "catalogNumber" && !normalizeCatalogNumber(match.rawValue)) {
    if (isPlaceholderValue(match.rawValue)) return undefined;
    issues.push(
      makeIssue({
        severity: "error",
        code: "invalid-catalog-number",
        message: `Invalid NORAD catalog number "${match.rawValue}" in ${source.sourceFile}.`,
        sourceId: source.sourceId,
        sourceFile: source.sourceFile,
        field,
        values: [match.rawValue],
      }),
    );
    return undefined;
  }

  if (
    field === "launchDate" ||
    field === "existenceStartDate" ||
    field === "decayDate" ||
    field === "reentryDate"
  ) {
    const normalized = normalizeDate(match.rawValue);
    if (normalized.invalidReason) {
      issues.push(
        makeIssue({
          severity: isSatcatAuthority(source) ? "error" : "warning",
          code: "invalid-date",
          message: `Invalid ${field} "${match.rawValue}" in ${source.sourceFile}: ${normalized.invalidReason}.`,
          sourceId: source.sourceId,
          sourceFile: source.sourceFile,
          field,
          values: [match.rawValue],
        }),
      );
      return undefined;
    }
  }

  const value = normalizeField(field, match.rawValue);
  if (!value) return undefined;

  return {
    field,
    value,
    provenance: provenanceFor(source, match.fieldName, field, match.rawValue, value),
  };
}

function aliasesForCandidate(candidate) {
  const aliases = [];
  const source = candidate.source;
  if (candidate.fields.catalogNumber) {
    aliases.push({
      kind: "norad",
      value: candidate.fields.catalogNumber.value,
      sourceId: source.sourceId,
      sourceFamily: source.sourceFamily,
      sourceFile: source.sourceFile,
      recordId: source.recordId,
    });
  }
  if (candidate.fields.internationalDesignator) {
    aliases.push({
      kind: "international-designator",
      value: candidate.fields.internationalDesignator.value,
      sourceId: source.sourceId,
      sourceFamily: source.sourceFamily,
      sourceFile: source.sourceFile,
      recordId: source.recordId,
    });
    aliases.push({
      kind: "cospar",
      value: candidate.fields.internationalDesignator.value,
      sourceId: source.sourceId,
      sourceFamily: source.sourceFamily,
      sourceFile: source.sourceFile,
      recordId: source.recordId,
    });
  }
  if (candidate.fields.name) {
    aliases.push({
      kind: "name",
      value: normalizeName(candidate.fields.name.value),
      sourceId: source.sourceId,
      sourceFamily: source.sourceFamily,
      sourceFile: source.sourceFile,
      recordId: source.recordId,
    });
  }
  aliases.push({
    kind: "source-record",
    value: `${source.sourceId}:${source.recordId ?? candidate.index}`,
    sourceId: source.sourceId,
    sourceFamily: source.sourceFamily,
    sourceFile: source.sourceFile,
    recordId: source.recordId,
  });
  return aliases;
}

function aliasKey(alias) {
  return `${alias.kind}:${alias.value}`;
}

function isStableRuntimeAlias(alias) {
  return alias.kind !== "name" && alias.kind !== "source-record";
}

function mergeAliasesForCandidate(candidate) {
  return candidate.aliases.filter((alias) => alias.kind !== "name" && alias.kind !== "source-record");
}

function candidateInternationalDesignator(candidate) {
  return candidate.fields.internationalDesignator?.value ?? candidate.supplementalInternationalDesignator;
}

function canMergeCandidatesByAlias(left, right, kind) {
  if (kind !== "norad") return true;
  const leftDesignator = candidateInternationalDesignator(left);
  const rightDesignator = candidateInternationalDesignator(right);
  return !leftDesignator || !rightDesignator || leftDesignator === rightDesignator;
}

function candidateFromRecord(record, source, index, issues) {
  const fields = {};
  for (const field of Object.keys(fieldDefinitions)) {
    const candidate = fieldCandidate(record, source, field, issues);
    if (candidate) fields[field] = candidate;
  }
  const supplementalInternationalDesignator = !isSatcatAuthority(source) && fields.catalogNumber
    ? fields.internationalDesignator?.value
    : undefined;
  if (!isSatcatAuthority(source) && fields.catalogNumber) {
    delete fields.internationalDesignator;
  }

  const hasIdentity = Boolean(
    fields.catalogNumber || fields.internationalDesignator || fields.name,
  );
  if (!hasIdentity) {
    issues.push(
      makeIssue({
        severity: isSatcatAuthority(source) ? "error" : "warning",
        code: "missing-identity",
        message: `Record ${source.recordId ?? index} in ${source.sourceFile} has no supported identity.`,
        sourceId: source.sourceId,
        sourceFile: source.sourceFile,
      }),
    );
    return undefined;
  }

  const alternateNames = [
    clean(record.ALTERNATE_NAMES),
    clean(record.AltNames),
    clean(record.altNames),
    clean(record.Names),
  ].flatMap(
    (value) =>
      value
        ?.split(/[|;]/)
        .map((name) => name.trim())
        .filter((name) => name && !isPlaceholderValue(name)) ?? [],
  );

  const candidate = {
    index,
    rawRecord: record,
    source,
    fields,
    supplementalInternationalDesignator,
    alternateNames,
    orbitalSummary: orbitalSummaryFromRecord(record, source),
  };
  candidate.aliases = aliasesForCandidate(candidate);
  return candidate;
}

function candidateFromExistingObject(object, index) {
  const source =
    object.sources?.[0] ?? {
      sourceId: "existing-normalized",
      sourceFamily: "unknown",
      sourceFile: "existing-normalized",
      recordId: object.id,
    };
  const fields = {};
  for (const field of Object.keys(fieldDefinitions)) {
    const value = object[field];
    if (!value) continue;
    const provenance = object.fieldProvenance?.[field]?.[0] ??
      provenanceFor(source, field, field, value, value);
    fields[field] = { field, value, provenance };
  }
  const candidate = {
    index,
    rawRecord: object,
    source,
    fields,
    alternateNames: object.alternateNames ?? [],
    aliases: object.aliases ?? [],
    orbitalSummary: object.orbitalSummary,
  };
  if (candidate.aliases.length === 0) candidate.aliases = aliasesForCandidate(candidate);
  return candidate;
}

class UnionFind {
  constructor(size) {
    this.parents = Array.from({ length: size }, (_, index) => index);
  }

  find(index) {
    if (this.parents[index] !== index) this.parents[index] = this.find(this.parents[index]);
    return this.parents[index];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents[rightRoot] = leftRoot;
  }
}

function candidateGroups(candidates, issues) {
  const union = new UnionFind(candidates.length);
  const aliases = new Map();

  candidates.forEach((candidate, index) => {
    for (const alias of mergeAliasesForCandidate(candidate)) {
      const key = aliasKey(alias);
      aliases.set(key, [...(aliases.get(key) ?? []), index]);
    }
  });

  for (const [key, indexes] of aliases) {
    const [kind] = key.split(":");
    for (let leftIndex = 0; leftIndex < indexes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < indexes.length; rightIndex += 1) {
        const left = indexes[leftIndex];
        const right = indexes[rightIndex];
        if (canMergeCandidatesByAlias(candidates[left], candidates[right], kind)) {
          union.union(left, right);
        }
      }
    }

    const sourceFileKeys = new Set(indexes.map((index) => `${candidates[index].source.sourceId}`));
    if ((kind === "norad" || kind === "cospar") && indexes.length > sourceFileKeys.size) {
      issues.push(
        makeIssue({
          severity: "warning",
          code: kind === "norad" ? "duplicate-norad-id" : "duplicate-cospar-id",
          message: `Duplicate ${kind} identity ${key.slice(kind.length + 1)} was merged.`,
          field: kind,
          values: indexes.map((index) => candidates[index].source.recordId ?? String(index)),
        }),
      );
    }
  }

  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const root = union.find(index);
    groups.set(root, [...(groups.get(root) ?? []), candidate]);
  });

  return [...groups.values()];
}

function chooseCanonicalIdentity(group) {
  const catalogCandidates = group
    .map((candidate) => candidate.fields.catalogNumber?.value)
    .filter(Boolean)
    .sort((left, right) => Number(left) - Number(right));
  if (catalogCandidates.length) {
    const value = catalogCandidates[0];
    return { kind: "norad", value, id: `object-norad-${value}` };
  }

  const designatorCandidates = group
    .map((candidate) => candidate.fields.internationalDesignator?.value)
    .filter(Boolean)
    .sort();
  if (designatorCandidates.length) {
    const value = designatorCandidates[0];
    return { kind: "international-designator", value, id: `object-intl-${slug(value)}` };
  }

  const nameCandidates = group
    .map((candidate) => candidate.fields.name?.value)
    .filter(Boolean)
    .sort();
  const value = normalizeName(nameCandidates[0] ?? group[0].source.recordId ?? group[0].index);
  return { kind: "source-record", value, id: `object-source-${slug(value)}` };
}

function reconcileField(group, field, objectId, issues) {
  const allCandidates = group
    .map((candidate, index) => ({
      index,
      source: candidate.source,
      field: candidate.fields[field],
    }))
    .filter((candidate) => candidate.field?.value);
  const candidates = hasOpenAuthoritativeLifecycle(group, field)
    ? allCandidates.filter((candidate) => isSatcatAuthority(candidate.source))
    : allCandidates;

  if (candidates.length === 0) return { value: undefined, provenance: [], conflict: undefined };

  const byValue = new Map();
  for (const candidate of candidates) {
    const key = candidate.field.value;
    byValue.set(key, [...(byValue.get(key) ?? []), candidate.field.provenance]);
  }

  const sorted = [...candidates].sort((left, right) => {
    const rankDelta =
      sourceRank(right.source, field) -
      sourceRank(left.source, field);
    if (rankDelta !== 0) return rankDelta;
    return left.index - right.index;
  });
  const selected = sorted[0].field.value;
  const provenance = candidates.map((candidate) => candidate.field.provenance);

  if (byValue.size <= 1) return { value: selected, provenance, conflict: undefined };

  const lifecycleFields = new Set(["launchDate", "existenceStartDate", "decayDate", "reentryDate"]);
  const authoritativeLifecycleValues = new Set(
    candidates
      .filter((candidate) => lifecycleFields.has(field) && isSatcatAuthority(candidate.source))
      .map((candidate) => candidate.field.value),
  );
  const severity =
    lifecycleFields.has(field) && authoritativeLifecycleValues.size > 1 ? "error" : "warning";
  const conflict = {
    field,
    severity,
    selectedValue: selected,
    values: [...byValue.entries()].map(([value, provenances]) => ({ value, provenances })),
    message: `Conflicting ${field} values were loaded for ${objectId}.`,
  };

  issues.push(
    makeIssue({
      severity,
      code: `conflicting-${field}`,
      message: conflict.message,
      objectId,
      field,
      values: [...byValue.keys()],
    }),
  );

  return { value: selected, provenance, conflict };
}

function uniqueSources(group) {
  const byKey = new Map();
  for (const candidate of group) {
    const source = candidate.source;
    byKey.set(`${source.sourceId}:${source.recordId ?? ""}`, source);
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.sourceId}:${left.recordId ?? ""}`.localeCompare(`${right.sourceId}:${right.recordId ?? ""}`),
  );
}

function uniqueAliases(group) {
  const byKey = new Map();
  for (const candidate of group) {
    for (const alias of candidate.aliases) byKey.set(aliasKey(alias), alias);
  }
  return [...byKey.values()].sort((left, right) => aliasKey(left).localeCompare(aliasKey(right)));
}

function sourceRecordIds(group) {
  return group
    .map((candidate) => ({
      sourceId: candidate.source.sourceId,
      recordId: candidate.source.recordId,
    }))
    .filter((item) => item.recordId)
    .sort((left, right) => `${left.sourceId}:${left.recordId}`.localeCompare(`${right.sourceId}:${right.recordId}`));
}

function buildObject(group, issues) {
  const canonicalIdentity = chooseCanonicalIdentity(group);
  const objectId = canonicalIdentity.id;
  const fieldProvenance = {};
  const conflicts = [];
  const object = {
    id: objectId,
    canonicalId: objectId,
    canonicalIdentity: {
      kind: canonicalIdentity.kind,
      value: canonicalIdentity.value,
    },
    sources: uniqueSources(group),
    sourceRecordIds: sourceRecordIds(group),
    aliases: uniqueAliases(group),
  };

  for (const field of Object.keys(fieldDefinitions)) {
    const reconciled = reconcileField(group, field, objectId, issues);
    if (reconciled.value) object[field] = reconciled.value;
    if (reconciled.provenance.length) fieldProvenance[field] = reconciled.provenance;
    if (reconciled.conflict) conflicts.push(reconciled.conflict);
  }

  const orbitalSummaryCandidate = [...group]
    .filter((candidate) => candidate.orbitalSummary)
    .sort((left, right) =>
      sourceRank(right.source, "objectType") - sourceRank(left.source, "objectType") ||
      `${left.source.sourceId}:${left.source.recordId ?? ""}`.localeCompare(
        `${right.source.sourceId}:${right.source.recordId ?? ""}`,
      ),
    )[0];
  if (orbitalSummaryCandidate) object.orbitalSummary = orbitalSummaryCandidate.orbitalSummary;

  if (!object.name) {
    issues.push(
      makeIssue({
        severity: "warning",
        code: "missing-name",
        message: `${object.id} has no object name; Explorer will display its canonical identifier.`,
        objectId,
        field: "name",
      }),
    );
    object.name = object.catalogNumber
      ? `NORAD ${object.catalogNumber}`
      : object.internationalDesignator ?? object.id;
  }

  object.alternateNames = [
    ...new Set(
      group
        .flatMap((candidate) => [
          ...candidate.alternateNames,
          candidate.fields.name?.value,
        ])
        .filter(Boolean)
        .filter((name) => name !== object.name),
    ),
  ].sort();

  if (dateBeforeDate(object.existenceStartDate, object.launchDate)) {
    delete object.existenceStartDate;
    delete fieldProvenance.existenceStartDate;
  }

  object.fieldProvenance = fieldProvenance;
  if (conflicts.length) object.conflicts = conflicts;

  const hasPrimarySource = group.some((candidate) => isSatcatAuthority(candidate.source));
  if (!object.launchDate) {
    issues.push(
      makeIssue({
        severity: hasPrimarySource ? "error" : "warning",
        code: "missing-launch-date",
        message: `${object.name ?? object.id} has no launch date and cannot participate in historical membership.`,
        objectId,
        field: "launchDate",
      }),
    );
  }

  if (!object.objectType) {
    issues.push(
      makeIssue({
        severity: "warning",
        code: "missing-object-type",
        message: `${object.name ?? object.id} has no object type.`,
        objectId,
        field: "objectType",
      }),
    );
  }

  for (const field of ["decayDate", "reentryDate"]) {
    const startValue = object.existenceStartDate ?? object.launchDate;
    if (lifecycleEndBeforeStart(object[field], startValue)) {
      issues.push(
        makeIssue({
          severity: "error",
          code: "invalid-chronology",
          message: `${object.name ?? object.id} has ${field} before lifecycle start.`,
          objectId,
          field,
          values: [startValue, object[field]],
        }),
      );
    }
    if (isActiveOrOpenStatus(object.status) && lifecycleEndBeforeReferenceDate(object[field])) {
      issues.push(
        makeIssue({
          severity: "error",
          code: "active-open-object-has-past-lifecycle-end",
          message: `${object.name ?? object.id} is active/open but has past ${field}.`,
          objectId,
          field,
          values: [object.status, object[field]],
        }),
      );
    }
  }

  return object;
}

function orbitStateFromRecord(record, objectId, source) {
  const catalogNumber = normalizeCatalogNumber(
    firstField(record, fieldDefinitions.catalogNumber)?.rawValue,
  );
  const epoch = normalizeDate(record.EPOCH ?? record.epoch ?? record.Epoch).value;
  const line1 = clean(record.TLE_LINE1 ?? record.TLE_LINE_1 ?? record.line1);
  const line2 = clean(record.TLE_LINE2 ?? record.TLE_LINE_2 ?? record.line2);
  const orbit = orbitFromElements(record, epoch);

  if (!epoch || (!orbit && (!line1 || !line2))) return undefined;

  return {
    id: `${objectId ?? catalogNumber ?? "unknown"}:${epoch}`,
    objectId,
    catalogNumber,
    epoch,
    sourceEpoch: clean(record.EPOCH ?? record.epoch ?? record.Epoch),
    tle: line1 && line2 ? { name: clean(record.OBJECT_NAME ?? record.name), line1, line2 } : undefined,
    orbit,
    gp: record,
    sources: [source],
  };
}

function parseTleRecords(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length);
  const records = [];

  for (let index = 0; index < lines.length; index += 1) {
    let name;
    let line1 = lines[index];
    let line2 = lines[index + 1];

    if (!line1.startsWith("1 ") && lines[index + 1]?.startsWith("1 ")) {
      name = line1.trim();
      line1 = lines[index + 1];
      line2 = lines[index + 2];
      index += 1;
    }

    if (!line1?.startsWith("1 ") || !line2?.startsWith("2 ")) continue;

    const catalogNumber = normalizeCatalogNumber(line1.slice(2, 7));
    const epoch = parseTleEpoch(line1);
    const objectId = parseInternationalDesignatorFromTle(line1);
    records.push({
      OBJECT_NAME: name ?? `NORAD ${catalogNumber}`,
      NORAD_CAT_ID: catalogNumber,
      OBJECT_ID: objectId,
      EPOCH: epoch,
      TLE_LINE1: line1,
      TLE_LINE2: line2,
    });
    index += 1;
  }

  return records;
}

async function recordsFromFile(path) {
  const buffer = await readFile(path);
  const text = buffer.toString("utf8");
  const extension = extname(path).toLowerCase();
  const metadata = {
    byteLength: buffer.byteLength,
    checksum: `sha256:${sha256Buffer(buffer)}`,
  };

  if (extension === ".json") return { records: flattenJson(JSON.parse(text)), ...metadata };
  if (extension === ".csv") return { records: parseCsv(text, ","), ...metadata };
  if (extension === ".tsv") return { records: parseTsv(text), ...metadata };
  return { records: parseTleRecords(text), ...metadata };
}

function summarizeValidation(issues) {
  const uniqueIssues = [...new Map(issues.map((issue) => [issue.id, issue])).values()].sort((left, right) =>
    `${left.severity}:${left.code}:${left.objectId ?? ""}`.localeCompare(
      `${right.severity}:${right.code}:${right.objectId ?? ""}`,
    ),
  );
  const issueCountBySeverity = { error: 0, warning: 0 };
  const issueCountByCode = {};
  for (const issue of uniqueIssues) {
    issueCountBySeverity[issue.severity] = (issueCountBySeverity[issue.severity] ?? 0) + 1;
    issueCountByCode[issue.code] = (issueCountByCode[issue.code] ?? 0) + 1;
  }
  return {
    issueCountBySeverity,
    issueCountByCode,
    issues: uniqueIssues,
  };
}

function mergeCountMaps(left = {}, right = {}) {
  const output = { ...left };
  for (const [key, value] of Object.entries(right)) output[key] = (output[key] ?? 0) + value;
  return output;
}

function compactValidationForRuntime(validation) {
  const issues = validation?.issues ?? [];
  const retainedIssues = issues.filter((issue) => issue.severity === "error");
  const retainedSummary = summarizeValidation(retainedIssues);
  const suppressedIssues = issues.filter((issue) => issue.severity !== "error");
  const suppressedSummary = summarizeValidation(suppressedIssues);

  return {
    issueCountBySeverity: validation?.issueCountBySeverity ?? retainedSummary.issueCountBySeverity,
    issueCountByCode: validation?.issueCountByCode ?? mergeCountMaps(retainedSummary.issueCountByCode, suppressedSummary.issueCountByCode),
    issues: retainedSummary.issues,
    compacted: suppressedIssues.length > 0,
    suppressedIssueCountBySeverity: suppressedSummary.issueCountBySeverity,
    suppressedIssueCountByCode: suppressedSummary.issueCountByCode,
  };
}

function sourceFileFromInput(input, records) {
  const family = input.family ?? detectFamily(input.fileName, records);
  const role = input.role ?? detectRole(input.fileName, records);
  const fingerprintSeed = stableJson({
    checksum: input.checksum,
    family,
    fileName: input.fileName,
    recordCount: records.length,
    role,
  });
  return {
    id: input.id ?? `${family}:${input.fileName}`,
    family,
    role,
    fileName: input.fileName,
    importedAt: input.importedAt ?? input.lastUpdated ?? deterministicTimestamp(fingerprintSeed),
    recordCount: records.length,
    byteLength: input.byteLength,
    checksum: input.checksum,
    license: input.license,
    lastUpdated: input.lastUpdated,
  };
}

function sourceForRecord(sourceFile, record, index) {
  return {
    sourceId: sourceFile.id,
    sourceFamily: sourceFile.family,
    sourceRole: sourceFile.role,
    sourceFile: sourceFile.fileName,
    recordId: recordIdFrom(record, index),
    license: sourceFile.license,
    lastUpdated: sourceFile.lastUpdated,
  };
}

function canonicalIdForOrbitState(record, objectsByAlias) {
  const catalogNumber = normalizeCatalogNumber(
    firstField(record, fieldDefinitions.catalogNumber)?.rawValue,
  );
  if (catalogNumber && objectsByAlias.has(`norad:${catalogNumber}`)) {
    return objectsByAlias.get(`norad:${catalogNumber}`);
  }
  const internationalDesignator = normalizeInternationalDesignator(
    firstField(record, fieldDefinitions.internationalDesignator)?.rawValue,
  );
  if (internationalDesignator && objectsByAlias.has(`international-designator:${internationalDesignator}`)) {
    return objectsByAlias.get(`international-designator:${internationalDesignator}`);
  }
  return undefined;
}

function sourceSetFingerprint(sourceFiles) {
  return `sha256:${sha256Text(
    stableJson(
      sourceFiles.map((sourceFile) => ({
        id: sourceFile.id,
        role: sourceFile.role,
        family: sourceFile.family,
        fileName: sourceFile.fileName,
        recordCount: sourceFile.recordCount,
        byteLength: sourceFile.byteLength,
        checksum: sourceFile.checksum,
        lastUpdated: sourceFile.lastUpdated,
      })),
    ),
  )}`;
}

function sortedEntries(entries, dateField = "date") {
  return entries.sort((left, right) =>
    `${left[dateField] ?? ""}:${left.objectId}`.localeCompare(`${right[dateField] ?? ""}:${right.objectId}`),
  );
}

export function createRuntimeArtifacts(dataset) {
  const objectIndex = {};
  const identityIndex = {};
  const launchIndex = [];
  const decayIndex = [];
  const orbitStateIndex = {};

  dataset.objects.forEach((object, index) => {
    objectIndex[object.id] = {
      index,
      catalogNumber: object.catalogNumber,
      internationalDesignator: object.internationalDesignator,
      launchDate: object.launchDate,
      existenceStartDate: object.existenceStartDate,
      decayDate: object.decayDate,
      reentryDate: object.reentryDate,
      objectType: object.objectType,
      owner: object.owner,
    };
    identityIndex[`id:${object.id}`] = object.id;
    if (object.canonicalId) identityIndex[`id:${object.canonicalId}`] = object.id;
    if (object.catalogNumber) identityIndex[`norad:${object.catalogNumber}`] = object.id;
    if (object.internationalDesignator) {
      identityIndex[`international-designator:${object.internationalDesignator}`] = object.id;
      identityIndex[`cospar:${object.internationalDesignator}`] = object.id;
    }
    for (const alias of object.aliases ?? []) {
      if (isStableRuntimeAlias(alias)) identityIndex[`${alias.kind}:${alias.value}`] = object.id;
    }
    if (object.launchDate) launchIndex.push({ date: object.launchDate, objectId: object.id });
    if (object.decayDate) decayIndex.push({ date: object.decayDate, objectId: object.id, field: "decayDate" });
    if (object.reentryDate) decayIndex.push({ date: object.reentryDate, objectId: object.id, field: "reentryDate" });
  });

  for (const state of dataset.orbitStates) {
    const objectId = state.objectId ?? (state.catalogNumber ? identityIndex[`norad:${state.catalogNumber}`] : undefined);
    const key = objectId ?? `unresolved:${state.catalogNumber ?? state.id}`;
    orbitStateIndex[key] = [...(orbitStateIndex[key] ?? []), { id: state.id, epoch: state.epoch }];
  }

  for (const key of Object.keys(orbitStateIndex)) {
    orbitStateIndex[key].sort((left, right) => left.epoch.localeCompare(right.epoch));
  }

  const sourceFingerprint =
    dataset.sourceFingerprint ??
    sourceSetFingerprint(dataset.sourceFiles ?? []);
  const validationErrors = dataset.validation?.issueCountBySeverity?.error ?? 0;
  const missingLaunchDateCount = dataset.objects.filter((object) => !object.launchDate).length;
  const missingLifecycleStartDateCount = dataset.objects.filter(
    (object) => !(object.existenceStartDate ?? object.launchDate),
  ).length;
  const conflictCount = dataset.objects.reduce(
    (count, object) => count + (object.conflicts?.length ?? 0),
    0,
  );
  const completeMembership =
    dataset.importStatus?.historicalMembership === "satcat-loaded" &&
    validationErrors === 0 &&
    missingLifecycleStartDateCount === 0;

  return {
    schemaVersion: runtimeArtifactsSchemaVersion,
    generatedAt: dataset.generatedAt,
    importVersion: dataset.importVersion ?? importVersion,
    sourceFingerprint,
    recordCounts: {
      objects: dataset.objects.length,
      orbitStates: dataset.orbitStates.length,
      sources: dataset.sourceFiles.length,
      identities: Object.keys(identityIndex).length,
      launches: launchIndex.length,
      decayOrReentryEvents: decayIndex.length,
    },
    objectIndex,
    identityIndex,
    launchIndex: sortedEntries(launchIndex),
    decayIndex: sortedEntries(decayIndex),
    orbitStateIndex,
    coverageManifest: {
      membershipStatus: dataset.importStatus?.historicalMembership ?? "blocked-missing-satcat",
      orbitStateStatus: dataset.importStatus?.historicalOrbitStates ?? "not-loaded",
      completeMembership,
      catalogObjectCount: dataset.objects.length,
      launchDatedObjectCount: dataset.objects.length - missingLaunchDateCount,
      missingLaunchDateCount,
      missingLifecycleStartDateCount,
      decayedOrReenteredObjectCount: new Set(decayIndex.map((entry) => entry.objectId)).size,
      renderableOrbitStateCount: dataset.orbitStates.filter((state) => state.orbit).length,
      reconstructionEligibleObjectCount: dataset.objects.filter((object) => object.orbitalSummary).length,
      catalogOnlyObjectCount: dataset.objects.filter((object) => !object.orbitalSummary).length,
      conflictCount,
      validationErrors,
      validationWarnings: dataset.validation?.issueCountBySeverity?.warning ?? 0,
    },
    sourceManifest: {
      sourceFingerprint,
      sourceFiles: (dataset.sourceFiles ?? []).map((sourceFile) => ({
        id: sourceFile.id,
        family: sourceFile.family,
        role: sourceFile.role,
        fileName: sourceFile.fileName,
        recordCount: sourceFile.recordCount,
        byteLength: sourceFile.byteLength,
        checksum: sourceFile.checksum,
        license: sourceFile.license,
        lastUpdated: sourceFile.lastUpdated,
      })),
    },
  };
}

export function validateHistoricalDataset(dataset) {
  const issues = [...(dataset.validation?.issues ?? [])];
  const objectIds = new Set();
  const identityKeys = new Map();

  for (const object of dataset.objects ?? []) {
    if (objectIds.has(object.id)) {
      issues.push(
        makeIssue({
          severity: "error",
          code: "duplicate-canonical-object-id",
          message: `Duplicate canonical object id ${object.id}.`,
          objectId: object.id,
        }),
      );
    }
    objectIds.add(object.id);

    if (!object.catalogNumber && !object.internationalDesignator && !(object.aliases ?? []).length) {
      issues.push(
        makeIssue({
          severity: "error",
          code: "missing-identifiers",
          message: `${object.name ?? object.id} has no stable normalized identifiers.`,
          objectId: object.id,
        }),
      );
    }

    for (const alias of object.aliases ?? []) {
      if (!isStableRuntimeAlias(alias)) continue;
      const key = `${alias.kind}:${alias.value}`;
      const existingObjectId = identityKeys.get(key);
      if (existingObjectId && existingObjectId !== object.id) {
        issues.push(
          makeIssue({
            severity: "error",
            code: "duplicate-identity-across-objects",
            message: `Identity ${key} appears on both ${existingObjectId} and ${object.id}.`,
            objectId: object.id,
            field: alias.kind,
            values: [existingObjectId, object.id],
          }),
        );
      }
      identityKeys.set(key, object.id);
    }

    const launchMs = dateMs(object.launchDate);
    const existenceStartMs = dateMs(object.existenceStartDate);
    if (launchMs === null) {
      issues.push(
        makeIssue({
          severity: "error",
          code: "missing-launch-date",
          message: `${object.name ?? object.id} has no launch date and cannot participate in historical membership.`,
          objectId: object.id,
          field: "launchDate",
        }),
      );
    }
    if (dateBeforeDate(object.existenceStartDate, object.launchDate)) {
      issues.push(
        makeIssue({
          severity: "error",
          code: "existence-before-launch",
          message: `${object.name ?? object.id} has existenceStartDate before launchDate.`,
          objectId: object.id,
          field: "existenceStartDate",
          values: [object.existenceStartDate, object.launchDate],
        }),
      );
    }
    for (const field of ["decayDate", "reentryDate"]) {
      const startValue = object.existenceStartDate ?? object.launchDate;
      if (lifecycleEndBeforeStart(object[field], startValue)) {
        issues.push(
          makeIssue({
            severity: "error",
            code: "invalid-chronology",
            message: `${object.name ?? object.id} has ${field} before lifecycle start.`,
            objectId: object.id,
            field,
            values: [startValue, object[field]],
          }),
        );
      }
      if (isActiveOrOpenStatus(object.status) && lifecycleEndBeforeReferenceDate(object[field])) {
        issues.push(
          makeIssue({
            severity: "error",
            code: "active-open-object-has-past-lifecycle-end",
            message: `${object.name ?? object.id} is active/open but has past ${field}.`,
            objectId: object.id,
            field,
            values: [object.status, object[field]],
          }),
        );
      }
    }
  }

  const summary = summarizeValidation(issues);
  if (dataset.validation?.compacted) {
    summary.issueCountBySeverity = mergeCountMaps(
      summary.issueCountBySeverity,
      dataset.validation.suppressedIssueCountBySeverity,
    );
    summary.issueCountByCode = mergeCountMaps(
      summary.issueCountByCode,
      dataset.validation.suppressedIssueCountByCode,
    );
    summary.compacted = true;
    summary.suppressedIssueCountBySeverity = dataset.validation.suppressedIssueCountBySeverity;
    summary.suppressedIssueCountByCode = dataset.validation.suppressedIssueCountByCode;
  }
  return summary;
}

function compactSourceAttribution(source) {
  return {
    sourceId: source.sourceId,
    sourceFamily: source.sourceFamily,
    sourceRole: source.sourceRole,
    sourceFile: source.sourceFile,
    license: source.license,
    lastUpdated: source.lastUpdated,
  };
}

function compactSources(sources = []) {
  return [
    ...new Map(
      sources.map((source) => {
        const compact = compactSourceAttribution(source);
        return [`${compact.sourceId}:${compact.sourceFile}`, compact];
      }),
    ).values(),
  ].sort((left, right) =>
    `${left.sourceId}:${left.sourceFile}`.localeCompare(`${right.sourceId}:${right.sourceFile}`),
  );
}

function compactObjectForRuntime(object) {
  const aliases = (object.aliases ?? []).filter(
    (alias) => isStableRuntimeAlias(alias) && !object.catalogNumber && !object.internationalDesignator,
  );
  return {
    id: object.id,
    catalogNumber: object.catalogNumber,
    name: object.name,
    alternateNames: object.alternateNames?.length ? object.alternateNames : undefined,
    internationalDesignator: object.internationalDesignator,
    objectType: object.objectType,
    launchDate: object.launchDate,
    existenceStartDate: object.existenceStartDate,
    decayDate: object.decayDate,
    reentryDate: object.reentryDate,
    owner: object.owner,
    status: object.status,
    orbitalSummary: object.orbitalSummary,
    sources: compactSources(object.sources),
    aliases: aliases.length ? aliases : undefined,
  };
}

function compactOrbitStateForRuntime(state) {
  return {
    id: state.id,
    objectId: state.objectId,
    catalogNumber: state.catalogNumber,
    epoch: state.epoch,
    sourceEpoch: state.sourceEpoch,
    tle: state.tle,
    gp: state.gp,
    omm: state.omm,
    orbit: state.orbit,
    sources: compactSources(state.sources),
  };
}

function compactRuntimeArtifactsForRuntime(artifacts) {
  return {
    schemaVersion: artifacts.schemaVersion,
    generatedAt: artifacts.generatedAt,
    importVersion: artifacts.importVersion,
    sourceFingerprint: artifacts.sourceFingerprint,
    recordCounts: artifacts.recordCounts,
    coverageManifest: artifacts.coverageManifest,
    sourceManifest: artifacts.sourceManifest,
  };
}

export function compactHistoricalDatasetForRuntime(dataset) {
  const artifacts = createRuntimeArtifacts(dataset);
  const compact = {
    schemaVersion: dataset.schemaVersion,
    generatedAt: dataset.generatedAt,
    importVersion: dataset.importVersion,
    sourceFingerprint: dataset.sourceFingerprint,
    importStatus: dataset.importStatus,
    validation: compactValidationForRuntime(dataset.validation),
    sourceFiles: dataset.sourceFiles,
    objects: dataset.objects.map(compactObjectForRuntime),
    orbitStates: dataset.orbitStates.map(compactOrbitStateForRuntime),
  };
  compact.runtimeArtifacts = compactRuntimeArtifactsForRuntime(artifacts);
  return compact;
}

export function createCoverageReport(dataset) {
  const artifacts = dataset.runtimeArtifacts ?? createRuntimeArtifacts(dataset);
  return {
    generatedAt: dataset.generatedAt,
    importVersion: dataset.importVersion ?? importVersion,
    sourceFingerprint: artifacts.sourceFingerprint,
    sourceBackedCompleteBuild: artifacts.coverageManifest.completeMembership,
    membershipStatus: artifacts.coverageManifest.membershipStatus,
    orbitStateStatus: artifacts.coverageManifest.orbitStateStatus,
    recordCounts: artifacts.recordCounts,
    coverage: artifacts.coverageManifest,
    validation: dataset.validation,
    requiredSources: dataset.importStatus?.requiredSources ?? [],
  };
}

export function normalizeHistoricalCatalogRecords(sourceInputs, options = {}) {
  const issues = [];
  const candidates = [];
  const sourceFilesById = new Map();
  const rawOrbitRecords = [];

  if (options.existingDataset) {
    for (const sourceFile of options.existingDataset.sourceFiles ?? []) {
      sourceFilesById.set(sourceFile.id, sourceFile);
    }
    for (const [index, object] of (options.existingDataset.objects ?? []).entries()) {
      candidates.push(candidateFromExistingObject(object, index));
    }
    for (const state of options.existingDataset.orbitStates ?? []) rawOrbitRecords.push({ state });
  }

  for (const input of sourceInputs) {
    const records = (input.records ?? []).filter((record) => record && typeof record === "object");
    const sourceFile = sourceFileFromInput(input, records);
    sourceFilesById.set(sourceFile.id, sourceFile);

    for (const [index, record] of records.entries()) {
      const source = sourceForRecord(sourceFile, record, index);
      const candidate = candidateFromRecord(record, source, candidates.length, issues);
      if (candidate) candidates.push(candidate);
      rawOrbitRecords.push({ record, source });
    }
  }

  const membershipSatcatSource = [...sourceFilesById.values()].find(
    (sourceFile) =>
      (sourceFile.family === "space-track" || sourceFile.family === "celestrak") &&
      sourceFile.role === "satcat" &&
      sourceFile.recordCount > 0,
  );
  const hasRequiredSatcat = Boolean(membershipSatcatSource);
  if (!hasRequiredSatcat) {
    issues.push(
      makeIssue({
        severity: "error",
        code: "missing-required-satcat",
        message: "No SATCAT source file was loaded; historical membership is not complete.",
        sourceId: "satcat",
      }),
    );
  }

  const normalizedObjects = candidateGroups(candidates, issues).map((group) => buildObject(group, issues));
  const objects = hasRequiredSatcat
    ? normalizedObjects.filter((object) => object.sources.some(isSatcatAuthority))
    : normalizedObjects;
  const objectsByAlias = new Map();
  for (const object of objects) {
    objectsByAlias.set(`id:${object.id}`, object.id);
    for (const alias of object.aliases ?? []) objectsByAlias.set(aliasKey(alias), object.id);
  }

  const orbitStates = [];
  for (const item of rawOrbitRecords) {
    if (item.state) {
      orbitStates.push(item.state);
      continue;
    }
    const objectId = canonicalIdForOrbitState(item.record, objectsByAlias);
    const state = orbitStateFromRecord(item.record, objectId, item.source);
    const line1 = clean(item.record.TLE_LINE1 ?? item.record.TLE_LINE_1 ?? item.record.line1);
    const line2 = clean(item.record.TLE_LINE2 ?? item.record.TLE_LINE_2 ?? item.record.line2);
    if (state) {
      orbitStates.push({
        ...state,
        tle: line1 && line2 ? { name: clean(item.record.OBJECT_NAME ?? item.record.name), line1, line2 } : state.tle,
        orbit: state.orbit ?? (line1 && line2 ? orbitFromTle(line1, line2, state.epoch) : undefined),
      });
    }
  }

  const uniqueOrbitStates = [
    ...new Map(
      orbitStates
        .filter((state) => state.epoch)
        .map((state) => [`${state.objectId ?? state.catalogNumber ?? state.id}:${state.epoch}`, state]),
    ).values(),
  ];

  const sourceFiles = [...sourceFilesById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sourceFingerprint = sourceSetFingerprint(sourceFiles);
  const importedAt = options.generatedAt ?? deterministicTimestamp(sourceFingerprint);
  const validation = summarizeValidation(issues);
  const output = {
    schemaVersion,
    generatedAt: importedAt,
    importVersion,
    sourceFingerprint,
    importStatus: {
      historicalMembership: hasRequiredSatcat
        ? validation.issueCountBySeverity.error > 0
          ? "loaded-with-errors"
          : "satcat-loaded"
        : "blocked-missing-satcat",
      historicalOrbitStates: uniqueOrbitStates.length > 0 ? "partial" : "not-loaded",
      requiredSources: [
        {
          id: membershipSatcatSource?.id ?? "satcat",
          sourceFamily: membershipSatcatSource?.family ?? "space-track",
          role: "satcat",
          status: hasRequiredSatcat ? "loaded" : "missing",
          purpose: "authoritative historical catalog membership and lifecycle",
        },
      ],
    },
    validation,
    sourceFiles,
    objects: objects.sort((left, right) =>
      (left.catalogNumber ?? left.internationalDesignator ?? left.name ?? left.id).localeCompare(
        right.catalogNumber ?? right.internationalDesignator ?? right.name ?? right.id,
        undefined,
        { numeric: true },
      ),
    ),
    orbitStates: uniqueOrbitStates.sort((left, right) =>
      `${left.catalogNumber ?? left.objectId ?? ""}:${left.epoch}`.localeCompare(
        `${right.catalogNumber ?? right.objectId ?? ""}:${right.epoch}`,
      ),
    ),
  };

  output.runtimeArtifacts = createRuntimeArtifacts(output);
  return output;
}

export async function importHistoricalCatalog({
  sourceDirectory = inputDirectory,
  destinationPath = outputPath,
  mergeExisting = false,
} = {}) {
  let existingDataset;
  if (mergeExisting) {
    try {
      existingDataset = JSON.parse(await readFile(destinationPath, "utf8"));
    } catch {
      existingDataset = undefined;
    }
  }

  let files = [];
  try {
    files = (await readdir(sourceDirectory))
      .filter((file) => !file.startsWith("."))
      .filter((file) => !file.endsWith(".manifest.json"))
      .filter((file) => file !== "source-manifest.json")
      .filter((file) => file !== "space-track-download-manifest.json")
      .filter((file) => [".json", ".csv", ".tsv", ".tle", ".txt"].includes(extname(file).toLowerCase()))
      .sort();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const sourceInputs = [];
  for (const file of files) {
    const path = join(sourceDirectory, file);
    const fileData = await recordsFromFile(path);
    sourceInputs.push({
      fileName: file,
      records: fileData.records,
      byteLength: fileData.byteLength,
      checksum: fileData.checksum,
      family: detectFamily(file, fileData.records),
      role: detectRole(file, fileData.records),
    });
  }

  const output = compactHistoricalDatasetForRuntime(
    normalizeHistoricalCatalogRecords(sourceInputs, { existingDataset }),
  );

  await mkdir(resolve(destinationPath, ".."), { recursive: true });
  await writeFile(destinationPath, `${stableJson(output)}\n`);
  return output;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const output = await importHistoricalCatalog({ mergeExisting: mergeExistingFlag });
  const errorCount = output.validation.issueCountBySeverity.error ?? 0;
  const warningCount = output.validation.issueCountBySeverity.warning ?? 0;
  console.log(
    `Imported ${output.objects.length} historical catalog objects and ${output.orbitStates.length} orbit states from ${output.sourceFiles.length} file(s).`,
  );
  console.log(`Validation: ${errorCount} error(s), ${warningCount} warning(s).`);
  if (!writeRuntimeFlag) {
    console.log(
      "Generated historical data is local-only by default. Use --write-runtime only for private builds and do not commit full generated snapshots without confirmed redistribution rights.",
    );
  }
  if (errorCount > 0) process.exitCode = 1;
}
