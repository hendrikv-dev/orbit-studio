#!/usr/bin/env node
/**
 * A short list of deep-sky showpieces, from OpenNGC.
 *
 * ## Why a curated list and not a catalogue
 *
 * Tracker answers "what is particularly worth observing from here tonight". A
 * catalogue answers "what exists", which is a different product and a worse
 * one: thirteen thousand NGC entries ranked by an algorithm produces a list
 * nobody asked for, and the ranking has nothing to say about most of them. What
 * belongs here is the set of objects an experienced observer would actually
 * point somebody at — the ones in every beginner's guide, for the reason that
 * they are worth the trouble.
 *
 * The *selection* is therefore editorial and is written out below by name. The
 * *values* are not: every position, magnitude and size comes from OpenNGC, so
 * nothing in the shipped file is remembered or estimated.
 *
 * ## Which equipment each one needs
 *
 * Assigned by one rule, applied uniformly, from the object's own visual
 * magnitude:
 *
 *   V ≤ 4.5 → the unaided eye        V ≤ 7.0 → binoculars        else → a telescope
 *
 * The boundaries are conventional observing practice rather than a model, and
 * they reproduce it: the Pleiades, Andromeda, Orion, the Beehive, the Double
 * Cluster and Ptolemy's Cluster come out naked-eye; the Hercules and Sagittarius
 * globulars, the Lagoon and Bode's Galaxy come out binocular; the Ring, the
 * Dumbbell, the Whirlpool and the Sombrero come out telescopic. Every one of
 * those matches what an observing guide would say.
 *
 * Objects with no recorded visual magnitude are dropped rather than guessed at.
 * The Rosette, the Veil and the North America Nebula are genuine showpieces and
 * are excluded for exactly that reason: with no magnitude there is no
 * defensible tier, and a tier assigned by feel is the thing this file is
 * written to avoid.
 *
 * ## What the tier does *not* decide
 *
 * Whether the reader can see it tonight. A naked-eye tier means "this is a
 * naked-eye object"; whether it is visible from *their* sky, with *their* Moon
 * and *their* streetlights, is decided afterwards by the naked-eye rule in
 * `src/data/tracker/nakedEye.ts`. Andromeda is a naked-eye object and is not
 * visible from a city centre, and both of those statements have to survive.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Two files, because the Messier list is not a subset of the NGC.
 *
 * The Pleiades has no NGC number — it is Melotte 22 — and OpenNGC keeps objects
 * like it in an addendum. Reading only NGC.csv silently dropped the single most
 * obvious naked-eye deep-sky object in the sky, which is exactly the kind of
 * absence a curated list is supposed to make impossible.
 */
const SOURCES = [
  "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv",
  "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv",
];
const OUT = path.join(projectRoot, "src/data/deep-sky/showpieces.json");

/**
 * The list, by OpenNGC name, with the one thing OpenNGC cannot supply: what a
 * person actually sees, in a sentence, so a card can say something better than
 * the object's type.
 */
const SHOWPIECES = [
  ["Mel022", "A knot of six or seven blue stars close together, obvious the moment you notice it."],
  ["NGC1976", "A glowing cloud with four young stars at its heart, the nearest place stars are being born."],
  ["NGC2632", "A loose scatter of stars that looks like a smudge until you look slightly away from it."],
  ["NGC0224", "The furthest thing the unaided eye can reach: another galaxy, two and a half million light years off."],
  ["NGC0869", "Two rich clusters side by side in one field, which almost nothing else in the sky does."],
  ["NGC0884", "The second half of the Double Cluster, and the richer of the pair in a small telescope."],
  ["NGC6475", "A big, bright, loose cluster low in the summer south, catalogued by Ptolemy in the second century."],
  ["NGC6405", "A cluster whose brighter stars really do suggest a butterfly's open wings."],
  ["NGC2168", "A field of a few hundred stars, all much the same brightness, filling a low-power eyepiece."],
  ["NGC6205", "A ball of several hundred thousand stars; in a telescope the edges begin to break into points."],
  ["NGC6656", "One of the closest globular clusters, and one of the few that resolves in binoculars."],
  ["NGC7078", "A very dense globular with a bright, almost stellar core."],
  ["NGC6341", "A compact northern globular, often skipped because it stands beside a more famous one."],
  ["NGC6523", "A bright nebula split by a dark lane, with a cluster embedded in it."],
  ["NGC6611", "The cluster and nebula whose dust pillars are the most reproduced image in astronomy."],
  ["NGC0752", "A wide, loose cluster that suits binoculars better than any telescope."],
  ["NGC0457", "A cluster with two bright stars at one end that everyone sees as eyes."],
  ["NGC3031", "A bright spiral galaxy, and one of the few that shows structure in a modest telescope."],
  ["NGC6853", "A planetary nebula bright enough to show its shape rather than just its presence."],
  ["NGC6720", "A small, distinct smoke ring — the classic first planetary nebula for a new telescope."],
  ["NGC5194", "Two galaxies caught mid-collision, with the spiral arms still traceable."],
  ["NGC3034", "An edge-on galaxy crossed by dust, being torn about by the one beside it."],
  ["NGC4594", "An edge-on galaxy with a dust lane across a bright bulge, which is where the hat comes from."],
  ["NGC1952", "What is left of a star seen to explode in 1054, and the first object in Messier's list."],
  ["NGC7009", "A small planetary nebula with faint extensions that suggested a ringed planet."],
  ["NGC6543", "A bright, compact planetary nebula with a visibly blue-green cast."],
];

/** One rule, applied uniformly. See the note above. */
function equipmentFor(visualMagnitude) {
  if (visualMagnitude <= 4.5) return "eyes";
  if (visualMagnitude <= 7.0) return "binoculars";
  return "telescope";
}

/** OpenNGC's own type codes, in words a reader would use. */
const TYPES = {
  G: "galaxy",
  GCl: "globular cluster",
  OCl: "open cluster",
  PN: "planetary nebula",
  Neb: "nebula",
  HII: "nebula",
  SNR: "supernova remnant",
  "Cl+N": "cluster and nebula",
};

const sexagesimalToDegrees = (value, isHours) => {
  const sign = value.trim().startsWith("-") ? -1 : 1;
  const [a, b, c] = value.replace("+", "").replace("-", "").split(":").map(Number);
  const degrees = a + b / 60 + c / 3600;
  return sign * degrees * (isHours ? 15 : 1);
};

function parse(csv) {
  const [header, ...lines] = csv.trim().split("\n");
  const columns = header.split(";");
  return lines.map((line) => {
    const cells = line.split(";");
    return Object.fromEntries(columns.map((name, index) => [name, cells[index] ?? ""]));
  });
}

const byName = new Map();
const digests = [];
for (const url of SOURCES) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenNGC ${url}: ${response.status}`);
  const csv = await response.text();
  digests.push({ file: url.split("/").pop(), sha256: createHash("sha256").update(csv).digest("hex") });
  for (const row of parse(csv)) byName.set(row.Name, row);
}

const objects = [];
const dropped = [];
for (const [name, appearance] of SHOWPIECES) {
  const row = byName.get(name);
  if (!row) {
    dropped.push(`${name}: not in OpenNGC`);
    continue;
  }
  const magnitude = Number.parseFloat(row["V-Mag"]);
  if (!Number.isFinite(magnitude)) {
    dropped.push(`${name}: no recorded visual magnitude`);
    continue;
  }
  const messier = row.M ? `M${Number.parseInt(row.M, 10)}` : null;
  const common = (row["Common names"] || "").split(",")[0] || null;
  objects.push({
    id: (messier ?? name).toLowerCase(),
    name: common || messier || name,
    designation: messier ? `${messier} · ${name}` : name,
    type: TYPES[row.Type] ?? row.Type,
    rightAscensionDeg: Number(sexagesimalToDegrees(row.RA, true).toFixed(5)),
    declinationDeg: Number(sexagesimalToDegrees(row.Dec, false).toFixed(5)),
    visualMagnitude: magnitude,
    majorAxisArcmin: Number.parseFloat(row.MajAx) || null,
    equipment: equipmentFor(magnitude),
    appearance,
  });
}

// Brightest first, so the file reads the way the list is meant to be used and
// two runs of the same source produce the same bytes.
objects.sort((a, b) => a.visualMagnitude - b.visualMagnitude || a.id.localeCompare(b.id));

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      format: "tracker-deep-sky-showpieces/1",
      source: {
        title: "OpenNGC",
        url: "https://github.com/mattiaverga/OpenNGC",
        files: digests,
        licence: "CC BY-SA 4.0",
        retrievedAt: new Date().toISOString().slice(0, 10),
      },
      equipmentRule: "V ≤ 4.5 eyes; V ≤ 7.0 binoculars; otherwise telescope",
      objects,
    },
    null,
    2,
  )}\n`,
);

console.log(`wrote ${objects.length} showpieces to ${path.relative(projectRoot, OUT)}`);
for (const digest of digests) console.log(`  ${digest.file} sha256 ${digest.sha256}`);
for (const line of dropped) console.log(`  dropped ${line}`);
const counts = objects.reduce((totals, object) => {
  totals[object.equipment] = (totals[object.equipment] ?? 0) + 1;
  return totals;
}, {});
console.log(`  by equipment: ${JSON.stringify(counts)}`);
