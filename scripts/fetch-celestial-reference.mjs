#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const earthTimestamps = [
  "2026-01-01T13:18:20.000Z",
  "2026-07-17T23:53:42.000Z",
  "2026-03-20T14:46:00.000Z",
  "2026-06-21T08:24:00.000Z",
  "2026-09-23T00:05:00.000Z",
  "2026-12-21T20:50:00.000Z",
  "1998-11-20T12:26:40.000Z",
  "2030-01-01T12:00:00.000Z",
];

const moonTimestamps = [
  "2026-07-14T09:43:00.000Z",
  "2026-07-21T11:05:00.000Z",
  "2026-07-29T14:36:00.000Z",
  "2026-08-06T02:21:00.000Z",
  "1998-11-20T12:26:40.000Z",
  "2030-01-01T12:00:00.000Z",
];

function julianDate(iso) {
  return Date.parse(iso) / 86_400_000 + 2_440_587.5;
}

function resultLine(text) {
  const match = text.match(/\$\$SOE\s*\n([^\n]+)\n\$\$EOE/);
  if (!match) throw new Error(`No Horizons result row found:\n${text.slice(0, 1000)}`);
  return match[1].split(",").map((value) => value.trim()).filter(Boolean);
}

function hmsToDegrees(value) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return (hours + minutes / 60 + seconds / 3600) * 15;
}

async function horizons(body, iso, ephemerisType, quantities = "2") {
  const command = body === "sun" ? "10" : "301";
  const parameters = new URLSearchParams({
    format: "text",
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: `'${ephemerisType}'`,
    CENTER: "'500@399'",
    TLIST: `'${julianDate(iso).toFixed(9)}'`,
    TIME_TYPE: "'UT'",
    CSV_FORMAT: "'YES'",
  });

  if (ephemerisType === "VECTORS") {
    parameters.set("REF_SYSTEM", "'ICRF'");
    parameters.set("REF_PLANE", "'FRAME'");
    parameters.set("VEC_CORR", "'LT+S'");
    parameters.set("VEC_TABLE", "'1'");
    parameters.set("OUT_UNITS", "'KM-S'");
  } else {
    parameters.set("QUANTITIES", `'${quantities}'`);
    parameters.set("ANG_FORMAT", "'DEG'");
    parameters.set("EXTRA_PREC", "'YES'");
    parameters.set("RANGE_UNITS", "'KM'");
  }

  const response = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${parameters}`);
  if (!response.ok) throw new Error(`Horizons ${response.status}: ${await response.text()}`);
  return resultLine(await response.text());
}

async function usnoSidereal(iso) {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  const response = await fetch(
    `https://aa.usno.navy.mil/api/siderealtime?date=${date}&time=${time}&coords=0,0&reps=1&intv_mag=1&intv_unit=seconds`,
  );
  if (!response.ok) throw new Error(`USNO ${response.status}: ${await response.text()}`);
  const row = (await response.json()).properties.data[0];
  return {
    gast: row.gast,
    gastDeg: hmsToDegrees(row.gast),
    gmst: row.gmst,
    gmstDeg: hmsToDegrees(row.gmst),
    equationOfEquinoxesSeconds: Number(row.eqofeq),
  };
}

const earthSun = [];
for (const timestampUtc of earthTimestamps) {
  const [vector, observer, sidereal] = await Promise.all([
    horizons("sun", timestampUtc, "VECTORS"),
    horizons("sun", timestampUtc, "OBSERVER", "2"),
    usnoSidereal(timestampUtc),
  ]);
  earthSun.push({
    timestampUtc,
    jplIcrfApparentVectorKm: vector.slice(2, 5).map(Number),
    jplApparentRaDegOfDate: Number(observer[1]),
    jplApparentDecDegOfDate: Number(observer[2]),
    usno: sidereal,
    subsolarLatitudeDeg: Number(observer[2]),
    subsolarLongitudeDeg: ((Number(observer[1]) - sidereal.gastDeg + 540) % 360) - 180,
  });
}

const moon = [];
for (const timestampUtc of moonTimestamps) {
  const [vector, observer] = await Promise.all([
    horizons("moon", timestampUtc, "VECTORS"),
    horizons("moon", timestampUtc, "OBSERVER", "2,10,20,24"),
  ]);
  moon.push({
    timestampUtc,
    jplIcrfApparentVectorKm: vector.slice(2, 5).map(Number),
    jplApparentRaDegOfDate: Number(observer[1]),
    jplApparentDecDegOfDate: Number(observer[2]),
    jplIlluminatedFraction: Number(observer[3]) / 100,
    jplDistanceKm: Number(observer[4]),
    jplSunTargetObserverAngleDeg: Number(observer[6]),
  });
}

const fixture = {
  generatedAtUtc: new Date().toISOString(),
  sources: {
    vectors: "NASA/JPL Horizons DE441, geocentric ICRF, light-time and stellar-aberration corrected (LT+S)",
    apparentCoordinates: "NASA/JPL Horizons DE441, geocentric airless apparent RA/Dec of date",
    earthRotation: "U.S. Naval Observatory Astronomical Applications sidereal-time API, longitude 0, UT1 input",
    seasons: "U.S. Naval Observatory 2026 equinox and solstice table",
    lunarPhases: "U.S. Naval Observatory 2026 phases of the Moon table",
  },
  earthSun,
  moon,
};

const output = resolve("src/astronomy/reference/jplHorizonsUsnoReference.json");
await writeFile(output, `${JSON.stringify(fixture, null, 2)}\n`);
process.stdout.write(`Wrote ${output}\n`);
