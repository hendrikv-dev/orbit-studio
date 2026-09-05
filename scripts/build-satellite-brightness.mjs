#!/usr/bin/env node
/**
 * How bright each spacecraft actually is, from somebody who measured it.
 *
 * ## The rule
 *
 * A two-line element set says where an object is and nothing at all about how
 * much light it reflects. Size, shape, attitude and surface finish decide that,
 * and none of them is in a TLE — so a magnitude derived from orbital geometry
 * is a number with no observation behind it. Everything in this file comes from
 * a published measurement, and an object with no published measurement is not
 * offered by Tracker at all.
 *
 * ## Two kinds of measurement, which are not interchangeable
 *
 * A **standard magnitude** is normalised to a stated geometry: 1000 km range,
 * half lit. Range and phase can both be applied to it, because both have been
 * taken out of it. That is what the amateur catalogues publish and what the ISS
 * entry below is.
 *
 * A **distance-adjusted population mean** has had range taken out and phase left
 * in, and describes a population rather than an object. Only range may be
 * applied to it, and what comes out is where the middle of that population sits
 * — never a promise about one pass. That is what the Starlink entries are, and
 * why they carry a withholding margin rather than a decimal place.
 *
 * Usage: node scripts/build-satellite-brightness.mjs [--check]
 */

import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(projectRoot, "src/data/satellites/brightness.json");

/**
 * Mike McCants' intrinsic magnitude file, as used by Quicksat.
 *
 * The long-standing amateur reference for satellite standard magnitudes,
 * compiled from visual and electronic observations. The checksum is pinned so
 * that a changed source fails the build rather than silently moving a number
 * Tracker admits things on: McCants revises the file, and a revision is
 * something to look at rather than something to absorb.
 */
const QSMAG = {
  url: "https://mmccants.org/programs/qsmag.zip",
  published: "2020-09-14",
  sha256: "3f3f507014a047b6319813e73e818f065a029355c37a4b4e644213408f6a70a9",
  citation:
    "McCants, M. — Quicksat intrinsic magnitude file (qs.mag), 14 September 2020, https://mmccants.org/programs/",
  convention:
    "Visual magnitude at 1000 km range and 50 per cent illumination, which is a phase angle of 90 degrees.",
};

/** The named spacecraft Tracker offers, and nothing else. */
const SPACECRAFT = [
  {
    id: "iss",
    catalogNumber: 25544,
    name: "International Space Station",
    designator: "1998-067A",
    appearance:
      "A steady white point, brighter than any star, crossing the sky in a few minutes without blinking. Aircraft have flashing lights and change course; this does neither.",
  },
];

/**
 * Starlink during orbit-raising, from the one study that measured it.
 *
 * Mallama et al. sorted 580 observations of V2 Mini satellites by height and
 * found a strongly bimodal distribution: satellites below 357 km average 4.58
 * adjusted to 1000 km, and those above average 7.52 — a difference of 2.94
 * magnitudes, which they attribute to SpaceX applying brightness mitigation at
 * that height. The study excluded objects below 250 km as de-orbiting rather
 * than orbit-raising, so its figures say nothing about those.
 *
 * These are means over a population that spans several magnitudes, not a
 * prediction for one pass, which is what `uncertaintyMargin` is for. Half the
 * separation between the two modes is the amount by which a prediction has to
 * clear the threshold before Tracker will call a train visible.
 */
const STARLINK = {
  id: "starlink-orbit-raising",
  citation:
    "Mallama, A., Cole, R. E., Respler, J., Harrington, S., Lee, R. and Worley, A. (2024) — The Brightness of Starlink Mini Satellites During Orbit-Raising, arXiv:2405.12007",
  citationUrl: "https://arxiv.org/abs/2405.12007",
  convention:
    "Mean apparent magnitude adjusted to a uniform distance of 1000 km. Distance is normalised out; phase angle is not, so only range may be applied to it.",
  brightBelowKm: 357,
  magnitudeAt1000KmBelowThreshold: 4.58,
  magnitudeAt1000KmAboveThreshold: 7.52,
  modeSeparation: 2.94,
  uncertaintyMargin: 1.47,
  /** Below this the study flagged objects as de-orbiting and left them out. */
  deorbitingBelowKm: 250,
  /**
   * The height at which Tracker stops being willing to call it bright.
   *
   * Seventeen kilometres under the mitigation threshold, which is roughly a
   * day of orbit-raising: close enough to it that a stack could cross while a
   * night's prediction is still on screen.
   */
  confidentBelowKm: 340,
};

/* ------------------------------------------------------------------ zip */

/** One deflated entry, which is all this archive has ever contained. */
function firstEntry(zip) {
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip archive");
  const method = zip.readUInt16LE(8);
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;
  const compressed = zip.readUInt32LE(18);
  const body = zip.subarray(start, compressed > 0 ? start + compressed : undefined);
  if (method === 0) return body;
  if (method !== 8) throw new Error(`unsupported compression method ${method}`);
  return inflateRawSync(body);
}

/* ----------------------------------------------------------------- main */

const check = process.argv.includes("--check");

const response = await fetch(QSMAG.url, { headers: { "user-agent": "orbit-studio/1.0" } });
if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${QSMAG.url}`);
const archive = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(archive).digest("hex");
if (digest !== QSMAG.sha256) {
  console.error(
    `The magnitude file has changed.\n  expected ${QSMAG.sha256}\n  received ${digest}\n` +
      "Review the new file and update the pin deliberately; do not absorb it.",
  );
  process.exit(1);
}

const table = firstEntry(archive).toString("latin1");
const magnitudes = new Map();
for (const line of table.split(/\r?\n/)) {
  if (line.length < 40) continue;
  const catalogNumber = Number(line.slice(0, 5));
  if (!Number.isFinite(catalogNumber)) continue;
  const magnitude = Number(line.slice(32, 37).trim());
  if (Number.isFinite(magnitude)) magnitudes.set(catalogNumber, magnitude);
}
console.log(`read ${magnitudes.size} standard magnitudes`);

const spacecraft = [];
for (const entry of SPACECRAFT) {
  const standardMagnitude = magnitudes.get(entry.catalogNumber);
  if (standardMagnitude === undefined) {
    console.error(`${entry.id}: no measured magnitude for catalogue ${entry.catalogNumber}`);
    process.exitCode = 1;
    continue;
  }
  spacecraft.push({ ...entry, standardMagnitude });
  console.log(`  ${entry.id.padEnd(6)} ${String(standardMagnitude).padStart(5)}  ${entry.name}`);
}

const payload = {
  format: "orbit-studio-satellite-brightness-v1",
  generatedBy: "scripts/build-satellite-brightness.mjs",
  note: "Every magnitude here is a published measurement. Nothing is derived from orbital geometry, and an object with no measurement is not offered.",
  standardMagnitudeSource: QSMAG,
  spacecraft,
  starlink: STARLINK,
};

if (!check) {
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(projectRoot, OUT)}`);
} else {
  const existing = JSON.parse(readFileSync(OUT, "utf8"));
  if (JSON.stringify(existing) !== JSON.stringify(payload)) {
    console.error("brightness.json is out of date with its sources");
    process.exitCode = 1;
  }
}
