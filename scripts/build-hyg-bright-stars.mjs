#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve(process.argv[2] ?? "data/vendor/hygdata_v41.csv");
const outputPath = resolve(
  process.argv[3] ?? "src/data/stars/hygBrightStars.v41.json",
);
const magnitudeLimit = 5.1;

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

const source = await readFile(sourcePath, "utf8");
const lines = source.trim().split(/\r?\n/);
const headers = parseCsvLine(lines[0]);
const column = Object.fromEntries(headers.map((name, index) => [name, index]));
const stars = lines
  .slice(1)
  .map(parseCsvLine)
  .filter((row) => Number(row[column.id]) !== 0)
  .filter((row) => Number(row[column.mag]) <= magnitudeLimit)
  .map((row) => ({
    id: Number(row[column.id]),
    hip: row[column.hip] ? Number(row[column.hip]) : null,
    name: row[column.proper] || row[column.bf] || row[column.bayer] || null,
    raHours: Number(row[column.ra]),
    decDeg: Number(row[column.dec]),
    magnitude: Number(row[column.mag]),
    colorIndexBv: row[column.ci] ? Number(row[column.ci]) : null,
    xParsec: Number(row[column.x]),
    yParsec: Number(row[column.y]),
    zParsec: Number(row[column.z]),
    vxParsecPerYear: Number(row[column.vx]),
    vyParsecPerYear: Number(row[column.vy]),
    vzParsecPerYear: Number(row[column.vz]),
    constellation: row[column.con] || null,
  }))
  .sort((left, right) => left.magnitude - right.magnitude || left.id - right.id);

await writeFile(outputPath, `${JSON.stringify(stars, null, 2)}\n`);
process.stdout.write(
  `Wrote ${stars.length} authentic HYG v4.1 stars (magnitude <= ${magnitudeLimit}) to ${outputPath}\n`,
);
