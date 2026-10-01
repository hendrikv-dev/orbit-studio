#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Constellation } from "astronomy-engine";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "src/data/stars/bsc5pBrightStars.json");
const FIGURE_INPUT = path.join(ROOT, "src/data/constellations/constellationLines.d3Celestial.json");
const FIGURE_OUTPUT = path.join(ROOT, "src/data/constellations/constellationFigureStars.bsc5p.json");
const MAGNITUDE_LIMIT = 6.5;
const EXPECTED_RENDERABLE_RECORDS = 8_404;

// A deliberately small label crosswalk, not a second astrometric catalogue.
// Names and HR identities are the factual standard names published by the IAU
// Working Group on Star Names. Coordinates, magnitudes, colours, and proper
// motions always come from BSC5P.
const IAU_MAJOR_NAMES = new Map([
  [424, "Polaris"],
  [1457, "Aldebaran"],
  [1708, "Capella"],
  [1713, "Rigel"],
  [1790, "Bellatrix"],
  [1852, "Mintaka"],
  [1903, "Alnilam"],
  [1948, "Alnitak"],
  [2061, "Betelgeuse"],
  [2491, "Sirius"],
  [2618, "Adhara"],
  [2891, "Castor"],
  [2943, "Procyon"],
  [2990, "Pollux"],
  [3982, "Regulus"],
  [4295, "Merak"],
  [4301, "Dubhe"],
  [4554, "Phecda"],
  [4660, "Megrez"],
  [5056, "Spica"],
  [5340, "Arcturus"],
  [6134, "Antares"],
  [7001, "Vega"],
  [7557, "Altair"],
  [7924, "Deneb"],
  [8728, "Fomalhaut"],
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function rightAscensionHours(value) {
  const [hours, minutes, seconds] = value.trim().split(/\s+/).map(Number);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours + minutes / 60 + seconds / 3600;
}

function declinationDegrees(value) {
  const match = value.trim().match(/^([+-])(\d+)\s+(\d+)\s+([\d.]+)$/);
  if (!match) return null;
  const degrees = Number(match[2]) + Number(match[3]) / 60 + Number(match[4]) / 3600;
  return match[1] === "-" ? -degrees : degrees;
}

function nullableNumber(value) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRow(line) {
  const fields = line.split("|").slice(1, -1).map((field) => field.trim());
  if (fields.length !== 8 || !/^HR\s+\d+$/.test(fields[0])) return null;
  const hr = Number(fields[0].replace(/^HR\s+/, ""));
  const raHours = rightAscensionHours(fields[1]);
  const decDeg = declinationDegrees(fields[2]);
  const magnitude = nullableNumber(fields[3]);
  if (!Number.isInteger(hr) || raHours === null || decDeg === null || magnitude === null) return null;
  if (magnitude > MAGNITUDE_LIMIT) return null;
  const constellation = Constellation(raHours, decDeg).symbol;
  return {
    id: hr,
    name: IAU_MAJOR_NAMES.get(hr) ?? null,
    designation: fields[7] || null,
    raHours,
    decDeg,
    magnitude,
    colorIndexBv: nullableNumber(fields[4]),
    properMotionRaArcsecPerYear: nullableNumber(fields[5]),
    properMotionDecArcsecPerYear: nullableNumber(fields[6]),
    constellation,
  };
}

function angularSeparationDeg(left, right) {
  const raLeft = (left.raHours * Math.PI) / 12;
  const raRight = (right.raDeg * Math.PI) / 180;
  const decLeft = (left.decDeg * Math.PI) / 180;
  const decRight = (right.decDeg * Math.PI) / 180;
  const cosine =
    Math.sin(decLeft) * Math.sin(decRight) +
    Math.cos(decLeft) * Math.cos(decRight) * Math.cos(raLeft - raRight);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

const inputPath = argument("--input");
if (!inputPath) {
  throw new Error(
    "Usage: node scripts/build-bsc5p-bright-stars.mjs --input /path/to/heasarc-bsc5p.txt",
  );
}

const input = await readFile(inputPath, "utf8");
const records = input
  .split(/\r?\n/)
  .map(parseRow)
  .filter(Boolean)
  .sort((left, right) => left.magnitude - right.magnitude || left.id - right.id);

if (records.length !== EXPECTED_RENDERABLE_RECORDS) {
  throw new Error(
    `Expected ${EXPECTED_RENDERABLE_RECORDS.toLocaleString("en-US")} BSC5P records with a ` +
      `reported V<=${MAGNITUDE_LIMIT}; received ${records.length}.`,
  );
}
if (new Set(records.map((record) => record.id)).size !== records.length) {
  throw new Error("BSC5P HR identifiers are not unique after transformation.");
}

await writeFile(OUTPUT, `${JSON.stringify(records, null, 2)}\n`);
const figures = JSON.parse(await readFile(FIGURE_INPUT, "utf8"));
let maximumFigureMatchDeg = 0;
const figureRecords = figures.features.map((feature) => ({
  id: feature.id,
  rank: Number(feature.properties.rank),
  lines: feature.geometry.coordinates.map((line) =>
    line.map(([raDeg, decDeg]) => {
      const nearest = records.reduce(
        (best, star) => {
          const separationDeg = angularSeparationDeg(star, { raDeg, decDeg });
          return separationDeg < best.separationDeg ? { star, separationDeg } : best;
        },
        { star: records[0], separationDeg: Number.POSITIVE_INFINITY },
      );
      if (nearest.separationDeg > 0.01) {
        throw new Error(
          `${feature.id} figure point ${raDeg},${decDeg} is ${nearest.separationDeg.toFixed(6)}° ` +
            `from its nearest BSC5P star.`,
        );
      }
      maximumFigureMatchDeg = Math.max(maximumFigureMatchDeg, nearest.separationDeg);
      return nearest.star.id;
    }),
  ),
}));
await writeFile(FIGURE_OUTPUT, `${JSON.stringify(figureRecords, null, 2)}\n`);
const inputSha256 = createHash("sha256").update(input).digest("hex");
const outputSha256 = createHash("sha256").update(await readFile(OUTPUT)).digest("hex");
const figureOutputSha256 = createHash("sha256").update(await readFile(FIGURE_OUTPUT)).digest("hex");
console.log(
  JSON.stringify(
    {
      records: records.length,
      excludedWithoutVisualMagnitude: 14,
      magnitudeLimit: MAGNITUDE_LIMIT,
      inputSha256,
      outputSha256,
      output: OUTPUT,
      figureEndpointCount: figureRecords.reduce(
        (count, feature) => count + feature.lines.reduce((lineCount, line) => lineCount + line.length, 0),
        0,
      ),
      maximumFigureMatchDeg,
      figureOutputSha256,
      figureOutput: FIGURE_OUTPUT,
    },
    null,
    2,
  ),
);
