import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const cliArgs = process.argv.slice(2);
const writeRuntime = cliArgs.includes("--write-runtime");
if (writeRuntime) {
  throw new Error(
    "--write-runtime is disabled for public release safety. " +
      "Acquire data locally and build with ORBIT_CURRENT_CATALOG_MODE=local.",
  );
}
const onlyGroup = cliArgs
  .find((arg) => arg.startsWith("--only-group="))
  ?.slice("--only-group=".length);
const positionalArgs = cliArgs.filter(
  (arg) => arg !== "--write-runtime" && !arg.startsWith("--only-group="),
);
const inputDirectory = positionalArgs[0] ?? null;
const outputDirectory = resolve(
  positionalArgs[1] ?? "data/local-only/celestrak",
);
const outputDataPath = resolve(outputDirectory, "explorerCelestrakCatalog.records.json");
const provenancePath = resolve(outputDirectory, "acquisition.provenance.json");
const earthRadiusKm = 6378.137;
const earthMuKm3S2 = 398600.4418;
const acquisitionEvents = [];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const groups = [
  {
    file: "celestrak-stations.json",
    celestrakGroup: "stations",
    group: "Space Stations",
    operator: "International station operators",
    categoryId: "payloads",
    color: "#8dd8ff",
  },
  {
    file: "celestrak-tdrss.json",
    celestrakGroup: "tdrss",
    group: "Tracking and Data Relay Satellites",
    operator: "NASA",
    categoryId: "payloads",
    color: "#8dd8ff",
  },
  {
    file: "celestrak-gps.json",
    celestrakGroup: "gps-ops",
    group: "GPS Operational",
    operator: "U.S. Space Force",
    categoryId: "payloads",
    constellationId: "explorer-gps-constellation",
    color: "#72d3ab",
  },
  {
    file: "celestrak-galileo.json",
    celestrakGroup: "galileo",
    group: "Galileo",
    operator: "European Union / ESA",
    categoryId: "payloads",
    constellationId: "explorer-galileo-constellation",
    color: "#e4bd76",
  },
  {
    file: "celestrak-geo.json",
    celestrakGroup: "geo",
    group: "Geosynchronous",
    operator: "Geosynchronous satellite operators",
    categoryId: "payloads",
    color: "#77bfff",
  },
  {
    file: "celestrak-weather.json",
    celestrakGroup: "weather",
    group: "Weather Satellites",
    operator: "International weather operators",
    categoryId: "payloads",
    color: "#9dc8e6",
  },
  {
    file: "celestrak-starlink.json",
    celestrakGroup: "starlink",
    group: "Starlink",
    operator: "SpaceX",
    categoryId: "payloads",
    constellationId: "explorer-starlink-constellation",
    color: "#a9c9dd",
  },
  {
    file: "celestrak-oneweb.json",
    celestrakGroup: "oneweb",
    group: "OneWeb",
    operator: "Eutelsat OneWeb",
    categoryId: "payloads",
    constellationId: "explorer-oneweb-constellation",
    color: "#b7d5e8",
  },
  {
    file: "celestrak-molniya.json",
    query: "NAME",
    value: "MOLNIYA",
    group: "Molniya",
    operator: "Cataloged Molniya operators",
    categoryId: "payloads",
    status: "Reference",
    color: "#e0b96c",
  },
  {
    file: "celestrak-fengyun-debris.json",
    celestrakGroup: "fengyun-1c-debris",
    group: "Fengyun-1C Debris",
    operator: "Uncontrolled",
    categoryId: "debris",
    color: "#c28f81",
    include: (record) => record.OBJECT_NAME.includes("DEB"),
  },
  {
    file: "celestrak-cosmos-1408-debris.json",
    celestrakGroup: "cosmos-1408-debris",
    group: "Cosmos 1408 Debris",
    operator: "Uncontrolled",
    categoryId: "debris",
    color: "#bd8178",
  },
  {
    file: "celestrak-iridium-33-debris.json",
    celestrakGroup: "iridium-33-debris",
    group: "Iridium 33 Debris",
    operator: "Uncontrolled",
    categoryId: "debris",
    color: "#c09183",
  },
  {
    file: "celestrak-cosmos-2251-debris.json",
    celestrakGroup: "cosmos-2251-debris",
    group: "Cosmos 2251 Debris",
    operator: "Uncontrolled",
    categoryId: "debris",
    color: "#b97878",
  },
  {
    file: "celestrak-last30.json",
    celestrakGroup: "last-30-days",
    group: "Recent Launches",
    operator: "Recent launch operators",
    categoryId: (record) => record.OBJECT_NAME.includes("R/B") ? "rocket-bodies" : "payloads",
    color: (record) => record.OBJECT_NAME.includes("R/B") ? "#b9a98e" : "#91bfdc",
  },
];

function semiMajorAxisKm(meanMotionRevolutionsPerDay) {
  const meanMotionRadS = meanMotionRevolutionsPerDay * Math.PI * 2 / 86400;
  return Math.cbrt(earthMuKm3S2 / (meanMotionRadS * meanMotionRadS));
}

function meanToTrueAnomalyDeg(meanAnomalyDeg, eccentricity) {
  const mean = ((meanAnomalyDeg % 360) + 360) % 360 * Math.PI / 180;
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
  return ((trueAnomaly * 180 / Math.PI) % 360 + 360) % 360;
}

function launchYear(record) {
  const year = Number(record.OBJECT_ID?.slice(0, 4));
  return Number.isFinite(year) ? year : 2026;
}

function colorFor(group, record) {
  return typeof group.color === "function" ? group.color(record) : group.color;
}

function categoryFor(group, record) {
  return typeof group.categoryId === "function" ? group.categoryId(record) : group.categoryId;
}

function checksum(line) {
  let sum = 0;
  for (const character of line.slice(0, 68)) {
    if (character >= "0" && character <= "9") {
      sum += Number(character);
    } else if (character === "-") {
      sum += 1;
    }
  }
  return String(sum % 10);
}

function tleLine(line) {
  if (line.length !== 68) {
    throw new Error(`TLE line must be 68 characters before checksum; received ${line.length}.`);
  }
  return `${line}${checksum(line)}`;
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function formatAngle(value) {
  const normalized = normalizeDegrees(value);
  const rounded = Number(normalized.toFixed(4)) >= 360 ? 0 : normalized;
  return rounded.toFixed(4).padStart(8, " ");
}

function formatEccentricity(value) {
  return String(Math.round(Math.max(0, Math.min(0.9999999, value)) * 10_000_000))
    .padStart(7, "0");
}

function formatMeanMotion(value) {
  return value.toFixed(8).padStart(11, " ");
}

function formatNdot(value) {
  if (!Number.isFinite(value) || value === 0) {
    return " .00000000";
  }

  const sign = value < 0 ? "-" : " ";
  return `${sign}${Math.abs(value).toFixed(8).replace(/^0/, "")}`.slice(0, 10);
}

function formatTleExponent(value) {
  if (!Number.isFinite(value) || value === 0) {
    return " 00000+0";
  }

  const sign = value < 0 ? "-" : " ";
  let exponent = Math.floor(Math.log10(Math.abs(value))) + 1;
  let mantissa = Math.round((Math.abs(value) / 10 ** exponent) * 100_000);
  if (mantissa >= 100_000) {
    mantissa = 10_000;
    exponent += 1;
  }

  const exponentSign = exponent < 0 ? "-" : "+";
  const exponentDigit = String(Math.min(9, Math.abs(exponent)));
  return `${sign}${String(mantissa).padStart(5, "0")}${exponentSign}${exponentDigit}`;
}

function formatEpoch(date) {
  const year = date.getUTCFullYear();
  const epochYear = String(year % 100).padStart(2, "0");
  const yearStart = Date.UTC(year, 0, 1);
  const dayOfYear = (date.getTime() - yearStart) / 86_400_000 + 1;
  return `${epochYear}${dayOfYear.toFixed(8).padStart(12, "0")}`;
}

function formatInternationalDesignator(objectId) {
  const match = typeof objectId === "string"
    ? objectId.match(/^(\d{4})-(\d{3})([A-Z0-9]{1,3})$/)
    : null;

  if (!match) {
    return "        ";
  }

  return `${match[1].slice(2)}${match[2]}${match[3].padEnd(3, " ")}`.slice(0, 8);
}

function tleFromMeanElements({
  name,
  catalogNumber,
  classification = "U",
  objectId,
  epoch,
  meanMotionRevolutionsPerDay,
  meanMotionDot = 0,
  meanMotionDdot = 0,
  bstar = 0,
  inclinationDeg,
  raanDeg,
  eccentricity,
  argumentOfPeriapsisDeg,
  meanAnomalyDeg,
  ephemerisType = 0,
  elementSetNumber = 999,
  revolutionAtEpoch = 0,
}) {
  const satnum = String(catalogNumber).slice(-5).padStart(5, "0");
  const line1 = tleLine(
    `1 ${satnum}${String(classification || "U").slice(0, 1)} ` +
      `${formatInternationalDesignator(objectId)} ${formatEpoch(new Date(epoch))} ` +
      `${formatNdot(meanMotionDot)} ${formatTleExponent(meanMotionDdot)} ` +
      `${formatTleExponent(bstar)} ${String(ephemerisType).slice(0, 1)} ` +
      `${String(elementSetNumber).slice(-4).padStart(4, " ")}`,
  );
  const line2 = tleLine(
    `2 ${satnum} ${formatAngle(inclinationDeg)} ${formatAngle(raanDeg)} ` +
      `${formatEccentricity(eccentricity)} ${formatAngle(argumentOfPeriapsisDeg)} ` +
      `${formatAngle(meanAnomalyDeg)} ${formatMeanMotion(meanMotionRevolutionsPerDay)}` +
      `${String(revolutionAtEpoch).slice(-5).padStart(5, " ")}`,
  );

  return {
    name,
    line1,
    line2,
  };
}

function tleFromGpRecord(record) {
  return tleFromMeanElements({
    name: record.OBJECT_NAME,
    catalogNumber: record.NORAD_CAT_ID,
    classification: record.CLASSIFICATION_TYPE ?? "U",
    objectId: record.OBJECT_ID,
    epoch: record.EPOCH,
    meanMotionRevolutionsPerDay: record.MEAN_MOTION,
    meanMotionDot: record.MEAN_MOTION_DOT,
    meanMotionDdot: record.MEAN_MOTION_DDOT,
    bstar: record.BSTAR,
    inclinationDeg: record.INCLINATION,
    raanDeg: record.RA_OF_ASC_NODE,
    eccentricity: record.ECCENTRICITY,
    argumentOfPeriapsisDeg: record.ARG_OF_PERICENTER,
    meanAnomalyDeg: record.MEAN_ANOMALY,
    ephemerisType: record.EPHEMERIS_TYPE ?? 0,
    elementSetNumber: record.ELEMENT_SET_NO ?? 999,
    revolutionAtEpoch: record.REV_AT_EPOCH ?? 0,
  });
}

const recordsByCatalogNumber = new Map();
let latestEpochMs = 0;
const existingRecordsBySourceGroup = new Map();
let existingCatalogRecords = [];
let existingCatalogChecksum = null;

try {
  const existingCatalogContent = await readFile(outputDataPath, "utf8");
  existingCatalogChecksum = `sha256:${sha256(existingCatalogContent)}`;
  existingCatalogRecords = JSON.parse(existingCatalogContent);
  for (const record of existingCatalogRecords) {
    existingRecordsBySourceGroup.set(record.sourceGroup, [
      ...(existingRecordsBySourceGroup.get(record.sourceGroup) ?? []),
      record,
    ]);
  }
} catch {
  // No previous local-only catalog exists yet.
}

if (onlyGroup) {
  for (const record of existingCatalogRecords) {
    if (!record.tle) continue;
    latestEpochMs = Math.max(latestEpochMs, Date.parse(record.orbit.epoch) || 0);
    recordsByCatalogNumber.set(record.catalogNumber, record);
  }
}

async function recordsForGroup(group) {
  if (inputDirectory) {
    const sourcePath = resolve(inputDirectory, group.file);
    const sourceContent = await readFile(sourcePath, "utf8");
    const sourceRecords = JSON.parse(sourceContent);
    acquisitionEvents.push({
      group: group.group,
      source: sourcePath,
      status: "local-input",
      sourceChecksum: `sha256:${sha256(sourceContent)}`,
      recordCount: sourceRecords.length,
    });
    return {
      kind: "source",
      records: sourceRecords,
    };
  }

  const query = group.query
    ? `${group.query}=${encodeURIComponent(group.value)}`
    : `GROUP=${group.celestrakGroup}`;
  let response;
  try {
    response = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?${query}&FORMAT=json`,
    );
  } catch (error) {
    const fallbackRecords = existingRecordsBySourceGroup.get(group.group);
    if (fallbackRecords?.length) {
      acquisitionEvents.push({
        group: group.group,
        query,
        status: "reused-local-cache",
        recordCount: fallbackRecords.length,
        cachedCatalogChecksum: existingCatalogChecksum,
      });
      console.warn(
        `CelesTrak ${query} failed (${error instanceof Error ? error.message : "network error"}); reusing ${fallbackRecords.length} existing ${group.group} records.`,
      );
      return { kind: "generated", records: fallbackRecords };
    }
    if (group.optional) {
      acquisitionEvents.push({ group: group.group, query, status: "optional-unavailable" });
      console.warn(`CelesTrak ${query} failed; skipping optional ${group.group} feed.`);
      return { kind: "generated", records: [] };
    }
    throw error;
  }
  if (!response.ok) {
    const fallbackRecords = existingRecordsBySourceGroup.get(group.group);
    if (fallbackRecords?.length) {
      acquisitionEvents.push({
        group: group.group,
        query,
        status: "reused-local-cache",
        httpStatus: response.status,
        recordCount: fallbackRecords.length,
        cachedCatalogChecksum: existingCatalogChecksum,
      });
      console.warn(
        `CelesTrak ${query} returned ${response.status}; reusing ${fallbackRecords.length} existing ${group.group} records.`,
      );
      return { kind: "generated", records: fallbackRecords };
    }
    if (group.optional) {
      acquisitionEvents.push({
        group: group.group,
        query,
        status: "optional-unavailable",
        httpStatus: response.status,
      });
      console.warn(`CelesTrak ${query} returned ${response.status}; skipping optional ${group.group} feed.`);
      return { kind: "generated", records: [] };
    }
    throw new Error(`CelesTrak ${query} returned ${response.status}`);
  }
  const sourceContent = await response.text();
  const fetchedRecords = JSON.parse(sourceContent);
  acquisitionEvents.push({
    group: group.group,
    query,
    status: "retrieved",
    httpStatus: response.status,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    sourceChecksum: `sha256:${sha256(sourceContent)}`,
    recordCount: fetchedRecords.length,
  });
  return { kind: "source", records: fetchedRecords };
}

const selectedGroups = onlyGroup
  ? groups.filter(
      (group) => group.celestrakGroup === onlyGroup || group.group === onlyGroup,
    )
  : groups;

if (onlyGroup && selectedGroups.length === 0) {
  throw new Error(`Unknown CelesTrak group: ${onlyGroup}`);
}

for (const group of selectedGroups) {
  const source = await recordsForGroup(group);

  if (source.kind === "generated") {
    for (const record of source.records) {
      if (!record.tle) continue;
      latestEpochMs = Math.max(latestEpochMs, Date.parse(record.orbit.epoch) || 0);
      if (!recordsByCatalogNumber.has(record.catalogNumber)) {
        recordsByCatalogNumber.set(record.catalogNumber, record);
      }
    }
    continue;
  }

  const selected = source.records
    .filter((record) => Number(record.NORAD_CAT_ID) <= 69_999)
    .filter((record) => group.include?.(record) ?? true)
    .sort((left, right) => left.NORAD_CAT_ID - right.NORAD_CAT_ID);

  for (const record of selected) {
    latestEpochMs = Math.max(latestEpochMs, Date.parse(record.EPOCH) || 0);
    const catalogNumber = String(record.NORAD_CAT_ID);
    if (recordsByCatalogNumber.has(catalogNumber)) continue;

    const categoryId = categoryFor(group, record);
    recordsByCatalogNumber.set(catalogNumber, {
      id: `celestrak-${catalogNumber}`,
      name: record.OBJECT_NAME,
      catalogNumber,
      categoryId,
      objectType:
        categoryId === "debris"
          ? "Tracked debris"
          : categoryId === "rocket-bodies"
            ? "Rocket body"
            : `${group.group} payload`,
      operator: group.operator,
      country: "Cataloged orbital object",
      launched: String(launchYear(record)),
      status: group.status ?? (categoryId === "payloads" ? "Operational" : "Reference"),
      sourceGroup: group.group,
      constellationId: group.constellationId,
      tle: tleFromGpRecord(record),
      orbit: {
        altitudeKm: semiMajorAxisKm(record.MEAN_MOTION) - earthRadiusKm,
        eccentricity: record.ECCENTRICITY,
        inclinationDeg: record.INCLINATION,
        raanDeg: record.RA_OF_ASC_NODE,
        argumentOfPeriapsisDeg: record.ARG_OF_PERICENTER,
        trueAnomalyDeg: meanToTrueAnomalyDeg(record.MEAN_ANOMALY, record.ECCENTRICITY),
        epoch: new Date(record.EPOCH).toISOString(),
        color: colorFor(group, record),
      },
    });
  }
}

const records = [...recordsByCatalogNumber.values()];
const snapshotDate = new Date(latestEpochMs).toISOString().slice(0, 10);
const serializedRecords = `${JSON.stringify(records, null, 2)}\n`;
const localChecksum = sha256(serializedRecords);
await mkdir(dirname(outputDataPath), { recursive: true });
await writeFile(outputDataPath, serializedRecords);
await writeFile(
  provenancePath,
  `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    upstream: "https://celestrak.org/NORAD/elements/gp.php",
    usagePolicy: "https://celestrak.org/usage-policy.php",
    inclusionStatus: "local-only",
    redistributionStatus: "unresolved-not-for-public-source-or-deployment",
    snapshotDate,
    recordCount: records.length,
    localChecksum: `sha256:${localChecksum}`,
    processing: [
      "Select documented CelesTrak GP groups.",
      "Deduplicate by NORAD catalog number.",
      "Convert mean elements to Orbit Studio records and TLE text.",
    ],
    acquisitionEvents,
  }, null, 2)}\n`,
);
console.log(`Wrote ${records.length} CelesTrak records to ${outputDataPath}`);
console.log(`Wrote local acquisition receipt to ${provenancePath}`);
console.log(
  "Generated data is local-only. Build with ORBIT_CURRENT_CATALOG_MODE=local; do not publish the snapshot.",
);
