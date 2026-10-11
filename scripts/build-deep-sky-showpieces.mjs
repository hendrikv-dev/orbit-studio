#!/usr/bin/env node
/** Offline normalization: no network or alternate catalog fallback. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = "src/data/deep-sky/permissive-snapshot.json";
const bytes = await readFile(path.join(root, input));
const snapshot = JSON.parse(bytes);
if (snapshot.format !== "tracker-permissive-deep-sky-input/1" || snapshot.objects.length !== 26) throw new Error("Expected reviewed 26-object snapshot");
const ids = new Set();
for (const object of snapshot.objects) {
  if (ids.has(object.id)) throw new Error(`Duplicate ${object.id}`);
  ids.add(object.id);
  if (!Number.isFinite(object.rightAscensionDeg) || object.rightAscensionDeg < 0 || object.rightAscensionDeg >= 360
      || !Number.isFinite(object.declinationDeg) || Math.abs(object.declinationDeg) > 90
      || !Number.isFinite(object.visualMagnitude)
      || (object.majorAxisArcmin !== null && (!Number.isFinite(object.majorAxisArcmin) || object.majorAxisArcmin <= 0))) throw new Error(`Invalid fields ${object.id}`);
  const equipment = object.visualMagnitude <= 4.5 ? "eyes" : object.visualMagnitude <= 7 ? "binoculars" : "telescope";
  if (object.equipment !== equipment) throw new Error(`Invalid tier ${object.id}`);
  if (!snapshot.sources.some(source => source.id === object.id)) throw new Error(`Missing provenance ${object.id}`);
}
const objects = [...snapshot.objects].sort((a, b) => a.visualMagnitude - b.visualMagnitude || a.id.localeCompare(b.id));
const output = `${JSON.stringify({
  format: "tracker-deep-sky-showpieces/1",
  source: {
    title: "NASA HEASARC / Hubble Caldwell and Wikidata CC0",
    url: "https://heasarc.gsfc.nasa.gov/W3Browse/catalog/messier.html",
    files: [{ file: input, sha256: createHash("sha256").update(bytes).digest("hex") }],
    licence: "NASA public information / government-work resource; Wikidata CC0-1.0",
    retrievedAt: snapshot.retrievedAt,
  },
  equipmentRule: "V ≤ 4.5 eyes; V ≤ 7.0 binoculars; otherwise telescope",
  objects,
}, null, 2)}\n`;
const destination = path.join(root, "src/data/deep-sky/showpieces.json");
if (process.argv.includes("--check")) {
  if (await readFile(destination, "utf8") !== output) throw new Error("Deep-sky output differs from reviewed snapshot");
  console.log("PASS deterministic deep-sky normalization (26 objects)");
} else {
  await writeFile(destination, output);
  console.log("Wrote 26 permissive deep-sky showpieces");
}
