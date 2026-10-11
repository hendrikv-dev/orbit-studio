#!/usr/bin/env node
/** Offline deterministic normalization. No acquisition, legacy import or fallback. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SunPosition } from "astronomy-engine";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshot = JSON.parse(await readFile(path.join(root, "src/data/meteors/nasa-snapshot.json"), "utf8"));
const model = JSON.parse(await readFile(path.join(root, "src/data/meteors/tracker-model.json"), "utf8"));
const expected = ["QUA","LYR","ETA","CAP","SDA","PER","ORI","STA","NTA","LEO","GEM","URS"];
if (snapshot.format !== "tracker-nasa-meteor-input/1" || snapshot.normalizationYear !== 2026
    || snapshot.showers.length !== 12 || JSON.stringify(snapshot.showers.map(s => s.code)) !== JSON.stringify(expected)
    || model.format !== "tracker-meteor-model/1") throw new Error("Invalid reviewed NASA/model snapshot");
if (snapshot.sources.CP?.documentId !== "20110016582"
    || !snapshot.sources.CP?.rights.includes("Public Use Permitted")
    || !snapshot.sources.CP?.frame.includes("J2000.0")) throw new Error("Missing public-use J2000 radiant authority");
const longitude = iso => {
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) throw new Error(`Invalid UTC ${iso}`);
  return Number(SunPosition(instant).elon.toFixed(9));
};
const showers = snapshot.showers.map(s => {
  for (const field of ["peakSource","zhrSource","activitySource","speedSource","populationSource"]) {
    if (!snapshot.sources[s[field]]?.rights.includes("Public Use Permitted")) throw new Error(`Missing rights/source ${s.code}.${field}`);
  }
  for (const field of ["radiantRaDeg","radiantDecDeg","radiantSolarLongitudeJ2000Deg","speedKmS","populationIndex","nominalZhr"]) {
    if (!Number.isFinite(s[field])) throw new Error(`Invalid number ${s.code}.${field}`);
  }
  if (s.radiantRaDeg < 0 || s.radiantRaDeg >= 360 || Math.abs(s.radiantDecDeg) > 90
      || s.radiantSolarLongitudeJ2000Deg < 0 || s.radiantSolarLongitudeJ2000Deg >= 360
      || s.speedKmS <= 0 || s.populationIndex <= 1 || s.nominalZhr <= 0
      || !(model.peakWidthDays[s.code] > 0)) throw new Error(`Invalid shower ${s.code}`);
  const first = Date.parse(`${s.activityStart}T00:00:00Z`);
  const end = Date.parse(`${s.activityLast}T00:00:00Z`) + 86400000;
  if (!(first < Date.parse(s.peakUtc) && Date.parse(s.peakUtc) < end && end-first < 120*86400000)) throw new Error(`Invalid activity bounds ${s.code}`);
  return {
    code:s.code, name:s.name,
    peakSolarLongitudeDeg:longitude(s.peakUtc),
    activityStartSolarLongitudeDeg:longitude(new Date(first).toISOString()),
    activityEndSolarLongitudeDeg:longitude(new Date(end).toISOString()),
    radiantRaDeg:s.radiantRaDeg, radiantDecDeg:s.radiantDecDeg,
    radiantSolarLongitudeJ2000Deg:s.radiantSolarLongitudeJ2000Deg,
    speedKmS:s.speedKmS, populationIndex:s.populationIndex, nominalZhr:s.nominalZhr,
    peakWidthDays:model.peakWidthDays[s.code],
  };
});
const output = `${JSON.stringify({format:"tracker-nasa-meteors/1",normalizationYear:2026,showers},null,2)}\n`;
const destination = path.join(root,"src/data/meteors/showers.json");
if (process.argv.includes("--check")) {
  if (await readFile(destination,"utf8") !== output) throw new Error("NASA meteor output differs from reviewed inputs");
  console.log("PASS deterministic NASA normalization: 12 showers; no legacy fallback");
} else {
  await writeFile(destination,output);
  console.log("Wrote 12 NASA meteor showers");
}
