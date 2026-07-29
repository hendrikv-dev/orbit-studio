#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import * as Astronomy from "astronomy-engine";

const fixture = JSON.parse(
  await readFile("src/astronomy/reference/jplHorizonsUsnoReference.json", "utf8"),
);
const sunDirectionToleranceArcmin = 1;
const subsolarToleranceDeg = 0.02;
const gastToleranceSeconds = 0.02;
const moonDirectionToleranceArcmin = 0.15;
const moonDistanceToleranceKm = 60;
const moonIlluminationTolerance = 0.001;
const moonPhaseToleranceDeg = 0.02;

function angleArcmin(left, right) {
  const dot = left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  const cosine = dot / (Math.hypot(...left) * Math.hypot(...right));
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI * 60;
}

function longitudeError(left, right) {
  return Math.abs(((left - right + 540) % 360) - 180);
}

function fixed(value, digits = 6) {
  return Number(value).toFixed(digits);
}

function unitVector(values) {
  const length = Math.hypot(...values);
  return values.map((value) => value / length);
}

function vectorText(values) {
  return `[${values.map((value) => fixed(value, 7)).join(", ")}]`;
}

const lines = [
  "# Celestial numerical comparison report",
  "",
  `Generated from the committed independent fixture on ${fixture.generatedAtUtc}.`,
  "",
  "Reference sources: NASA/JPL Horizons DE441 (apparent geocentric ICRF vectors, apparent coordinates, lunar range/phase) and the U.S. Naval Observatory sidereal-time API. The fixture-generation script and exact API settings are committed in `scripts/fetch-celestial-reference.mjs`.",
  "",
  "## Earth and Sun",
  "",
  `Accepted tolerances: Sun direction < ${sunDirectionToleranceArcmin} arcmin; subsolar latitude/longitude < ${subsolarToleranceDeg}°; GAST < ${gastToleranceSeconds} s.`,
  "",
  "| UTC | JPL direction (unit EQJ) | Computed direction (unit EQJ) | Direction error / tolerance (arcmin) | USNO / computed GAST (°) | GAST error / tolerance (s) | JPL / computed subsolar lat, lon (°) | Lat, lon error / tolerance (°) | Result |",
  "|---|---|---|---:|---:|---:|---:|---:|---|",
];

for (const expected of fixture.earthSun) {
  const time = new Astronomy.AstroTime(new Date(expected.timestampUtc));
  const sun = Astronomy.GeoVector(Astronomy.Body.Sun, time, true);
  const sunOfDate = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(time), sun);
  const raDeg = Math.atan2(sunOfDate.y, sunOfDate.x) * 180 / Math.PI;
  const latitudeDeg = Math.asin(sunOfDate.z / sunOfDate.Length()) * 180 / Math.PI;
  const gastDeg = Astronomy.SiderealTime(time) * 15;
  const longitudeDeg = ((raDeg - gastDeg + 540) % 360) - 180;
  const directionError = angleArcmin(
    [sun.x, sun.y, sun.z],
    expected.jplIcrfApparentVectorKm,
  );
  const latitudeError = Math.abs(latitudeDeg - expected.subsolarLatitudeDeg);
  const longitudeDifference = longitudeError(longitudeDeg, expected.subsolarLongitudeDeg);
  const gastErrorSeconds = Math.abs(gastDeg - expected.usno.gastDeg) * 240;
  const pass = directionError < sunDirectionToleranceArcmin &&
    latitudeError < subsolarToleranceDeg &&
    longitudeDifference < subsolarToleranceDeg &&
    gastErrorSeconds < gastToleranceSeconds;

  lines.push(
    `| ${expected.timestampUtc} | ${vectorText(unitVector(expected.jplIcrfApparentVectorKm))} | ${vectorText(unitVector([sun.x, sun.y, sun.z]))} | ${fixed(directionError, 4)} / ${fixed(sunDirectionToleranceArcmin, 2)} | ${fixed(expected.usno.gastDeg, 7)} / ${fixed(gastDeg, 7)} | ${fixed(gastErrorSeconds, 4)} / ${fixed(gastToleranceSeconds, 2)} | ${fixed(expected.subsolarLatitudeDeg)}, ${fixed(expected.subsolarLongitudeDeg)} / ${fixed(latitudeDeg)}, ${fixed(longitudeDeg)} | ${fixed(latitudeError, 6)}, ${fixed(longitudeDifference, 6)} / ${fixed(subsolarToleranceDeg, 2)} | ${pass ? "PASS" : "FAIL"} |`,
  );
}

lines.push(
  "",
  "## Moon",
  "",
  `Accepted tolerances: direction < ${moonDirectionToleranceArcmin} arcmin; distance < ${moonDistanceToleranceKm} km; illuminated fraction < ${moonIlluminationTolerance}; phase angle < ${moonPhaseToleranceDeg}°.`,
  "",
  "| UTC | JPL direction (unit EQJ) | Computed direction (unit EQJ) | Direction error / tolerance (arcmin) | JPL / computed distance; error / tolerance (km) | JPL / computed illuminated fraction; error / tolerance | JPL / computed phase; error / tolerance (°) | Result |",
  "|---|---|---|---:|---:|---:|---:|---|",
);

for (const expected of fixture.moon) {
  const time = new Astronomy.AstroTime(new Date(expected.timestampUtc));
  const moon = Astronomy.GeoVector(Astronomy.Body.Moon, time, true);
  const illumination = Astronomy.Illumination(Astronomy.Body.Moon, time);
  const distanceKm = moon.Length() * Astronomy.KM_PER_AU;
  const directionError = angleArcmin(
    [moon.x, moon.y, moon.z],
    expected.jplIcrfApparentVectorKm,
  );
  const distanceError = Math.abs(distanceKm - expected.jplDistanceKm);
  const illuminationError = Math.abs(
    illumination.phase_fraction - expected.jplIlluminatedFraction,
  );
  const phaseError = Math.abs(
    illumination.phase_angle - expected.jplSunTargetObserverAngleDeg,
  );
  const pass = directionError < moonDirectionToleranceArcmin &&
    distanceError < moonDistanceToleranceKm &&
    illuminationError < moonIlluminationTolerance &&
    phaseError < moonPhaseToleranceDeg;

  lines.push(
    `| ${expected.timestampUtc} | ${vectorText(unitVector(expected.jplIcrfApparentVectorKm))} | ${vectorText(unitVector([moon.x, moon.y, moon.z]))} | ${fixed(directionError, 4)} / ${fixed(moonDirectionToleranceArcmin, 2)} | ${fixed(expected.jplDistanceKm, 2)} / ${fixed(distanceKm, 2)}; ${fixed(distanceError, 2)} / ${fixed(moonDistanceToleranceKm, 0)} | ${fixed(expected.jplIlluminatedFraction, 7)} / ${fixed(illumination.phase_fraction, 7)}; ${fixed(illuminationError, 7)} / ${fixed(moonIlluminationTolerance, 3)} | ${fixed(expected.jplSunTargetObserverAngleDeg, 5)} / ${fixed(illumination.phase_angle, 5)}; ${fixed(phaseError, 5)} / ${fixed(moonPhaseToleranceDeg, 2)} | ${pass ? "PASS" : "FAIL"} |`,
  );
}

lines.push(
  "",
  "All computed values are produced by the same released runtime dependency used by Orbit Studio. All expected values are committed outputs from the independent JPL/USNO services, not values generated by the implementation under test.",
  "",
);

await writeFile("docs/celestial-numerical-comparison.md", `${lines.join("\n")}\n`);
process.stdout.write("Wrote docs/celestial-numerical-comparison.md\n");
