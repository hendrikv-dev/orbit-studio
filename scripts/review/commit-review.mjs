/**
 * A private, commit-specific review package.
 *
 * ## The rule this implements
 *
 * Every commit gets its own package, outside the repository, and no package is
 * ever overwritten. One commit, one directory, kept forever. A regeneration
 * becomes a revision beside the original rather than replacing it, because the
 * original is the record of what somebody actually inspected — and evidence you
 * can quietly rewrite is not evidence.
 *
 * There is deliberately no `--force`. A flag that discards review history is a
 * flag that gets used in a hurry, at the exact moment the history mattered.
 *
 * ## What it will not do
 *
 * It will not write inside the repository. Not into a gitignored folder either:
 * `.gitignore` stops a commit, not a `git clean -x`, an archive of the working
 * tree, or a reader assuming the directory is source. The boundary is the
 * filesystem, checked before anything is created. See `review-location.mjs`.
 *
 * ## What it will not claim
 *
 * It records only gates that actually ran. Results come from a file the caller
 * writes after running them; with no such file, `GATES.md` says so rather than
 * implying a suite passed. The generator has no way to assert a gate it did not
 * observe, which is the only structural defence against a report that is
 * cheaper to write than to earn.
 *
 * Usage:
 *   node scripts/review/commit-review.mjs [--commit <ref>] [--states a,b,c]
 *                                         [--gates <results.json>] [--why <text>]
 *                                         [--references <directory>]
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { preview } from "vite";
import {
  assertOutsideRepository,
  commitDirectoryName,
  resolveReviewRoot,
  reviewPaths,
  revisionName,
} from "./review-location.mjs";
import { writeContactSheet } from "./tracker-states.mjs";
import { captureStates } from "./tracker-responsive-states.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** Recorded so a failure can clean up after itself. */
let staging = null;

function option(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/** Everything the package says about the commit, taken from git rather than from me. */
function describeCommit(ref) {
  const short = git("rev-parse", "--short", ref);
  const full = git("rev-parse", ref);
  const committedAt = git("show", "-s", "--format=%cI", ref);
  const subject = git("show", "-s", "--format=%s", ref);
  const body = git("show", "-s", "--format=%b", ref);
  const parent = git("rev-parse", `${ref}^`);
  const numstat = git("diff", "--numstat", `${parent}..${ref}`);
  const files = numstat
    ? numstat.split("\n").map((line) => {
        const [added, deleted, file] = line.split("\t");
        return {
          file,
          added: added === "-" ? 0 : Number(added),
          deleted: deleted === "-" ? 0 : Number(deleted),
        };
      })
    : [];
  return { short, full, committedAt, subject, body, parent, files };
}

/**
 * Gate results, read rather than assumed.
 *
 * The file is a list of `{ gate, command, result, passed }`. Anything else is
 * rejected: a malformed results file must not degrade into "no gates recorded",
 * because that reads as an honest absence when it is really a broken pipeline.
 */
async function readGateResults(file) {
  if (!file) return null;
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} does not contain a list of gate results`);
  for (const entry of parsed) {
    if (!entry || typeof entry.gate !== "string" || typeof entry.result !== "string") {
      throw new Error(`${file} has an entry without a gate name and result`);
    }
  }
  return parsed;
}

function summaryMarkdown(commit, { purpose, unchanged, limitations, shots, gates }) {
  const verified = shots.filter((shot) => shot.verified).length;
  return `# ${commit.subject}

- **Commit** \`${commit.full}\` (\`${commit.short}\`)
- **Committed** ${commit.committedAt}
- **Parent** \`${commit.parent.slice(0, 7)}\`
- **Files changed** ${commit.files.length}
- **Screenshots** ${verified} of ${shots.length} states verified

## Purpose

${purpose}

## What the commit changes

${commit.body.trim() || "_No extended message on this commit._"}

## Deliberately unchanged

${unchanged}

## Verification actually performed

${
  gates && gates.length
    ? gates.map((g) => `- ${g.gate} — \`${g.command ?? ""}\` — ${g.result}`).join("\n")
    : "_No gate results were recorded for this package. See `GATES.md`._"
}

Screenshot preconditions were checked before each frame was kept; what each one
actually found is in \`screenshots/manifest.json\`.

## Known limitations

${limitations}
`;
}

function filesMarkdown(commit) {
  const added = commit.files.reduce((sum, f) => sum + f.added, 0);
  const deleted = commit.files.reduce((sum, f) => sum + f.deleted, 0);
  const rows = commit.files
    .slice()
    .sort((a, b) => b.added + b.deleted - (a.added + a.deleted))
    .map((f) => `- \`${f.file}\` — +${f.added} / -${f.deleted}`)
    .join("\n");
  return `# Files changed

\`${commit.parent.slice(0, 7)}..${commit.short}\` — ${commit.files.length} files, +${added} / -${deleted}.

${rows || "_No file changes recorded for this commit._"}
`;
}

function gatesMarkdown(commit, gates) {
  if (!gates || gates.length === 0) {
    return `# Gates

No gate results were supplied for this package.

This section records only checks that actually ran. Nothing was recorded here,
so nothing should be assumed to have passed for \`${commit.short}\`. Supply
results with \`--gates <file.json>\` after running them.
`;
  }
  const rows = gates
    .map((g) => `| ${g.gate} | \`${g.command ?? ""}\` | ${g.result} |`)
    .join("\n");
  const failed = gates.filter((g) => g.passed === false);
  return `# Gates

Only checks that actually ran are listed. Each result is the output of the
command beside it.

| Gate | Command | Result |
| --- | --- | --- |
${rows}
${failed.length ? `\n**${failed.length} of these did not pass.**\n` : ""}`;
}

function screenshotLinks(shots, ids) {
  return ids
    .map((id) => shots.find((shot) => shot.id === id))
    .filter(Boolean)
    .map((shot) => `[${shot.id}](screenshots/${shot.file})`)
    .join(" · ");
}

/**
 * Comparison notes belong beside the exact frames they discuss.
 *
 * The approved source-image files are supplied externally and copied into the
 * private package. This document places those exact references beside the
 * implementation frames while keeping them out of release source.
 */
function referenceComparisonMarkdown(commit, shots, referencesIncluded) {
  const rows = [
    {
      surface: "Map 2D",
      reference: "01-map-3d.png",
      target: "Quiet top-down geographic reading, restrained chrome, and one integrated recommendation.",
      ids: ["01-desktop-map-2d", "05-phone-map-2d", "15-unsupported-tablet-map"],
      matched: "Top-down geography remains primary; controls recede; one compact answer replaces the legacy rail.",
      deviation: "Production place labels and scientific overlays remain available because they carry real map meaning.",
      limitation: "The supplied Map reference is 3D; 2D intentionally keeps top-down geographic reading.",
    },
    {
      surface: "Map 3D",
      reference: "01-map-3d.png",
      target: "Close observer-centred terrain atlas with immediately legible real ridges, valleys, slopes, and atmospheric depth.",
      ids: ["02-desktop-map-3d", "06-phone-map-3d", "12-tablet-map-3d"],
      matched: "DEM geometry visibly rises and falls; the camera is local and oblique; roads and transport labels are subordinate.",
      deviation: "A disclosed fixed 1.35× relief display scale is used for legibility instead of claiming natural-scale presentation.",
      limitation: "Screenshot evidence proves visible relief and renderer state, not survey-grade horizon accuracy.",
    },
    {
      surface: "Tonight",
      reference: "02-tonight.png",
      target: "Editorial nightly briefing with one composed lead, elegant secondary ranking, confident type, and little dashboard chrome.",
      ids: ["03-desktop-tonight-no-sky", "07-phone-tonight", "13-tablet-tonight", "16-unsupported-tablet-tonight"],
      matched: "The lead image and recommendation form one unit; secondary targets flatten into a quieter ranked list; raw unavailable labels are omitted.",
      deviation: "Production ranking, recovery, equipment, and evidence wording remain authoritative rather than being replaced by reference-image placeholder copy.",
      limitation: "Production object media differs from the illustrative reference imagery, while its visual allocation and order are retained.",
    },
    {
      surface: "Object Detail",
      reference: "04-object-detail.png",
      target: "Object-first identity, prominent recommendation, concise observing facts, visible why-it-is-worth-it, and collapsed depth.",
      ids: ["04-desktop-object-detail", "08-phone-object-detail-collapsed", "17-unsupported-tablet-object-detail"],
      matched: "The object owns the sole heading; category framing is absent; More details is closed; ordinary celestial objects have no generic map action.",
      deviation: "A small required image credit remains visible while full provenance and technical evidence stay in advanced disclosure.",
      limitation: "Phenomenon-specific geographic actions require their own event review and are not represented by Saturn.",
    },
    {
      surface: "Viewing capability",
      reference: null,
      target: "One approachable product whose ranking and contextual guidance adapt to Naked eye, Binoculars, Telescope, or Astrophotography.",
      ids: ["07-phone-tonight", "07a-phone-viewing-capability-selector", "07b-phone-tonight-telescope", "08-phone-object-detail-collapsed"],
      matched: "The compact selector stays on Tonight; setup is optional; the saved telescope adds only contextual 10 mm / 120× guidance to the same collapsed detail surface.",
      deviation: "The supplied visual references do not depict capability selection, so this row is compared against the behavioral requirement rather than a reference image.",
      limitation: "The fixture proves one saved 8-inch Dobsonian path; it does not constitute observational validation of every equipment combination.",
    },
    {
      surface: "Sky",
      reference: "03-sky.png",
      target: "A sky-first rendered celestial sphere that works indoors, with optional orientation and camera registration over the identical astronomical scene.",
      ids: ["09-phone-sky-untargeted", "09b-phone-sky-manually-panned", "09c-phone-sky-search", "09d-phone-sky-layers", "09e-phone-sky-orion-figure", "09f-phone-sky-sun", "09g-phone-sky-moon", "09h-phone-sky-venus", "09i-phone-sky-jupiter", "09j-phone-sky-neptune", "09k-phone-sky-iss", "09l-phone-sky-tiangong", "09m-phone-sky-starlink-train", "09-phone-sky-camera-granted", "09n-phone-sky-camera-denied", "10-phone-sky-guiding", "11-phone-sky-aligned", "11a-phone-sky-below-horizon", "11b-phone-sky-ar-diagnostics", "14-tablet-sky-guiding"],
      matched: "The celestial field owns the viewport; real catalog stars, conventional constellation geometry, all 88 searchable identities, an astronomical Milky Way spine, bodies and station targets share one projection; controls and target context float compactly over it.",
      deviation: "The optional figure layer is original geometry-derived apparition art instead of copied historical or proprietary illustrations. Camera mode starts from an approximate 82° × 66° lens model because browsers do not disclose calibrated rear-lens intrinsics.",
      limitation: "Camera and sensor frames are explicitly deterministic fixtures, not physical-device AR evidence. Station path geometry does not imply visibility where a measured brightness model is absent.",
    },
    {
      surface: "Capability boundary",
      reference: null,
      target: "Rendered Sky on confirmed phones/tablets regardless of optional camera/orientation support, and no Sky destination or fake AR on desktop/laptop.",
      ids: ["03-desktop-tonight-no-sky", "04-desktop-object-detail", "15-unsupported-tablet-map", "17-unsupported-tablet-object-detail"],
      matched: "Desktop remains Map · Tonight with no Find in Sky; the sensorless tablet retains rendered Sky and Find in Sky while camera/orientation controls are absent.",
      deviation: "This is the rendered-first Sky 2.0 capability contract, which intentionally supersedes the earlier camera-required rule.",
      limitation: "Browser capability fixtures validate application gating; operating-system form-factor and permission behavior still require physical-device coverage.",
    },
  ];

  return `# Requirement-to-render comparison

- **Commit** \`${commit.full}\`
- **Method** Per-surface comparison of the final production-build frames against the current request. ${referencesIncluded ? "`COMPARISON_SHEET.png` also contains direct supplied-reference pairs." : "The current request explicitly supplies no visual references, so this package makes no reference-parity claim."}
- **Evidence boundary** ${referencesIncluded ? "The four explicitly supplied source images are copied unchanged into `references/` inside this private package." : "No reference directory was supplied or assumed."}

| Surface | Reference | Reference target | Implemented screenshot | What matched | Intentional deviation | Remaining limitation |
| --- | --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row.surface} | ${row.reference && referencesIncluded ? `[${row.reference}](references/${row.reference})` : "_Behavioral rule_"} | ${row.target} | ${screenshotLinks(shots, row.ids) || "_Not captured_"} | ${row.matched} | ${row.deviation} | ${row.limitation} |`).join("\n")}
`;
}

const REFERENCE_FILES = [
  "01-map-3d.png",
  "02-tonight.png",
  "03-sky.png",
  "04-object-detail.png",
];

async function copyApprovedReferences(sourceDir, destinationDir) {
  if (!sourceDir) return false;
  const resolved = await realpath(sourceDir);
  await mkdir(destinationDir, { recursive: true });
  for (const file of REFERENCE_FILES) {
    const source = path.join(resolved, file);
    if (!existsSync(source)) throw new Error(`Missing approved reference: ${source}`);
    await copyFile(source, path.join(destinationDir, file));
  }
  return true;
}

async function writeReferenceComparisonSheet({ browser, referencesDir, shotsDir, outFile, shots }) {
  const pairs = [
    ["Map 3D", "01-map-3d.png", "06-phone-map-3d"],
    ["Tonight", "02-tonight.png", "07-phone-tonight"],
    ["Sky · guiding fixture", "03-sky.png", "10-phone-sky-guiding"],
    ["Object Detail · collapsed", "04-object-detail.png", "08-phone-object-detail-collapsed"],
  ];
  const cards = [];
  for (const [label, referenceFile, shotId] of pairs) {
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!shot) continue;
    const [reference, implementation] = await Promise.all([
      readFile(path.join(referencesDir, referenceFile)),
      readFile(path.join(shotsDir, shot.file)),
    ]);
    cards.push(`
      <section>
        <h2>${label}</h2>
        <div class="pair">
          <figure><figcaption>Approved reference</figcaption><img src="data:image/png;base64,${reference.toString("base64")}"></figure>
          <figure><figcaption>Implementation · ${shot.id}</figcaption><img src="data:image/png;base64,${implementation.toString("base64")}"></figure>
        </div>
        <p>${shot.caption}</p>
      </section>`);
  }
  const context = await browser.newContext({ viewport: { width: 1640, height: 980 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box} body{margin:0;padding:38px;background:#070a10;color:#ecf0f7;font:15px/1.45 system-ui,sans-serif}
    header{margin:0 auto 34px;max-width:1500px} h1{margin:0;font-size:34px;letter-spacing:-.04em} header p,section>p{color:#98a5ba}
    section{max-width:1500px;margin:0 auto 34px;padding:24px;border:1px solid #202838;border-radius:18px;background:#0c111c;break-inside:avoid}
    h2{margin:0 0 16px;font-size:22px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}
    figure{margin:0;min-width:0}figcaption{margin:0 0 8px;color:#b9c4d6;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
    img{display:block;width:100%;height:720px;object-fit:contain;object-position:top center;border-radius:13px;background:#03050a}
    section>p{margin:14px 0 0;font-size:13px}
  </style></head><body><header><h1>Approved reference / implementation</h1><p>Exact supplied reference images paired with final production-build phone captures. Different aspect ratios are contained without cropping.</p></header>${cards.join("")}</body></html>`);
  await page.screenshot({ path: outFile, fullPage: true, animations: "disabled" });
  await context.close();
}

function terrainAndSkyValidationMarkdown(commit, shots) {
  const terrain = screenshotLinks(shots, [
    "02-desktop-map-3d",
    "06-phone-map-3d",
    "12-tablet-map-3d",
  ]);
  const sky = screenshotLinks(shots, [
    "09-phone-sky-untargeted",
    "09b-phone-sky-manually-panned",
    "09c-phone-sky-search",
    "09d-phone-sky-layers",
    "09e-phone-sky-orion-figure",
    "09f-phone-sky-sun",
    "09g-phone-sky-moon",
    "09h-phone-sky-venus",
    "09i-phone-sky-jupiter",
    "09j-phone-sky-neptune",
    "09k-phone-sky-iss",
    "09l-phone-sky-tiangong",
    "09m-phone-sky-starlink-train",
    "09-phone-sky-camera-granted",
    "09n-phone-sky-camera-denied",
    "09a-phone-sky-target-offscreen",
    "10-phone-sky-guiding",
    "10a-phone-sky-almost-aligned",
    "11-phone-sky-aligned",
    "11a-phone-sky-below-horizon",
    "11b-phone-sky-ar-diagnostics",
    "14-tablet-sky-guiding",
  ]);
  return `# Terrain and Sky validation notes

- **Commit** \`${commit.full}\`

## Terrain / DEM

- Production renderer: MapLibre terrain over the existing licensed DEM, not a decorative mesh.
- Default 3D camera: zoom **11.35**, pitch **67°**, bearing **92°**.
- Vertical display scale: fixed **1.35×**. This is a restrained presentation transform; observer coordinates and underlying DEM geography remain authoritative.
- Visual evidence: ${terrain || "_Not captured_"}.
- Runtime preconditions record the DEM source, zoom, pitch, and bearing in \`screenshots/manifest.json\`.

## Sky / camera and sensors

- Browser/runtime evidence: ${sky || "_Not captured_"}.
- Rendered Sky is the product foundation. A confirmed handheld can browse, pan, zoom, search, select targets and change layers without camera or orientation permission. Camera is an explicit optional control and reuses the same projected ENU scene.
- Solar-system authority: Astronomy Engine **2.1.19**, MIT, for Sun, Moon, planets and the applicable equatorial/horizon transforms. The independent regression fixture uses NASA/JPL Horizons topocentric values and records its own timestamp, observer, frame, refraction mode and tolerances.
- Star population: Yale Bright Star Catalog BSC5P via NASA/GSFC HEASARC (8,404 records with reported apparent magnitude ≤ 6.5), projected through the shared topocentric ENU pipeline for the selected observer and UTC instant. No procedural astronomical stars are rendered. HEASARC's official policy makes its materials freely available for use and asks for acknowledgement; it does not assign BSC5P an SPDX license, so this package records that free-use basis rather than inventing one.
- BSC5P source: \`https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html\`; raw query SHA-256 \`4b7e89fc0f18103683db2f8e66cd2de597b1912d7469f6d44f295c290f4fc1a0\`; deterministic local catalog SHA-256 \`529702e4a4fdedce2c98c1974f9a35cfdee4a0b33ff83a9c3d1373e6c40ae384\`.
- Constellation figures: d3-celestial conventional line figures at immutable commit \`7e720a3de062059d4c5400a379146a601d9010e0\`, BSD 3-Clause. They are orientation aids, not IAU boundaries. All 88 unique constellation identities are searchable. The optional translucent apparition is original runtime geometry derived from those projected endpoints; no external figure artwork was added.
- All 893 conventional-figure endpoints are mapped to real BSC5P HR stars within 0.008397°. Constellation names derive from the projected figures; selective major-star labels use the documented IAU identity crosswalk.
- Milky Way: project-authored galactic-equator display geometry from the standard J2000 equatorial/galactic transform, projected through the same ENU path. No photographic texture or external asset was added.
- Satellite objects: Tracker's existing production TLE/catalog authority; Sky does not add a second satellite catalog or propagation path. ISS and Tiangong are one extensible crewed-station collection. Tiangong receives current position and geometric next-path calculation but no unsupported brightness/visibility claim. Starlink remains restricted to qualified post-deployment stacks; dispersed traffic is not rendered as a train.
- Alerts: device-local, opt-in category and lead-time preferences plus a high-interest event filter. No push-delivery service exists, and the interface states that dependency rather than simulating notifications.
- Coordinate pipeline: catalog or ephemeris position → apparent equatorial position → observer/UTC horizontal position → fixed local ENU direction → stabilized device quaternion → camera projection. Celestial directions never derive from device callbacks.
- Pose stabilization: W3C intrinsic Z-X'-Y'' orientation and the display rotation compose exactly once into one quaternion; camera-local -Z is the rear optical axis. Safari's magnetic heading replaces the arbitrary alpha yaw before quaternion construction. A 0.18° deadband and 85 ms time-based slerp stabilize the whole scene rather than any target.
- Camera projection: the base **82° × 66°** field of view is an explicit estimate because browser media APIs expose stream dimensions but not calibrated optical intrinsics. The production projection reads the live video dimensions and overlay viewport, then applies the exact centred \`object-fit: cover\` crop to derive the visible horizontal or vertical FOV. Developer diagnostics can override the base FOV on localhost for measured-device sessions.
- North reference: Astronomy Engine azimuths use true north, while Safari exposes magnetic heading and no browser declination correction. An uncalibrated magnetic session may guide but cannot assert **On target**; aligning to a known celestial reference upgrades the whole-pose solution. This limitation is a browser accuracy boundary, not hidden as sensor confidence.
- Notable-object markers are visual classifications of Tracker's existing ranked \`SkyFinderTarget\` instances. Saturn, Jupiter, Mars, Venus, Moon, satellite, radiant, cluster and deep-sky treatments do not create another object catalogue.
- The fixture independently supplies handheld form factor, camera API, orientation API, permission flow, movement samples, and an aligned sample. It exercises the production capability and guidance paths. Separate sensorless-tablet frames prove rendered Sky does not depend on either protected API.
- The fixture's \`MediaStream\` is a deterministic 1,280 × 720 canvas stream with no real camera image. It proves the production video layer, media metadata, centred cover-crop calculation and overlay viewport are exercised, but it does **not** validate live rear-camera composition, optical intrinsics, magnetic-heading accuracy, sensor jitter, operating-system permission UI, physical rotation, or background/resume recovery.
- No compatible physical phone or tablet was connected for this package. Physical-device camera alignment is therefore **blocked, not passed**. Rendered-sky behavior is reviewed independently. The required device protocol is recorded in \`docs/SKY_FINDER_ARCHITECTURE.md\`.

## Dependency and asset inventory

- New npm dependencies: **none**.
- New vendored third-party datasets: **none**.
- New image/texture/illustration assets: **none**.
- Reused authorities: Astronomy Engine 2.1.19 (MIT), satellite.js (MIT), BSC5P under the recorded HEASARC free-use basis, d3-celestial figures (BSD-3-Clause), existing deep-sky catalogue, and transient CelesTrak runtime responses under the already documented non-redistribution boundary.

## Observing capability

- Phone evidence: ${screenshotLinks(shots, ["07-phone-tonight", "07a-phone-viewing-capability-selector", "07b-phone-tonight-telescope", "08-phone-object-detail-collapsed"]) || "_Not captured_"}.
- The default remains Naked eye. Capability selection immediately reuses the existing eligibility/ranking path; it does not create a parallel recommendation product.
- Optional telescope details are versioned, device-local and skippable. The fixture uses an 8-inch, 1,200 mm Dobsonian with 25 mm and 10 mm eyepieces; Saturn detail conservatively selects 10 mm / 120× and does not expose that guidance in Naked eye mode.
`;
}

async function main() {
  const repoRoot = await realpath(git("rev-parse", "--show-toplevel"));
  const ref = option("commit", "HEAD");
  const commit = describeCommit(ref);

  /**
   * The boundary check runs before anything is created, and on the real path,
   * so a symlink pointing back into the repository cannot slip past it.
   */
  /**
   * Refuse before creating anything.
   *
   * The check runs twice on purpose. First on the resolved path, before any
   * `mkdir`, so a destination inside the repository never causes a directory to
   * be created there — an earlier version made the folder and *then* refused,
   * which left exactly the litter the rule exists to prevent. Then again on the
   * real path once it exists, so a symlink pointing back into the repository
   * cannot slip past the first check.
   */
  const requested = assertOutsideRepository(
    resolveReviewRoot({ env: process.env, repoRoot }),
    repoRoot,
  );
  await mkdir(requested, { recursive: true });
  const reviewRoot = assertOutsideRepository(await realpath(requested), repoRoot);

  const paths = reviewPaths(reviewRoot);
  await mkdir(paths.commits, { recursive: true });

  const base = commitDirectoryName(commit.committedAt, commit.short);
  const siblings = await readdir(paths.commits).catch(() => []);
  const { name, revision } = revisionName(base, siblings);
  const outDir = path.join(paths.commits, name);
  if (existsSync(outDir)) {
    throw new Error(`${outDir} already exists; refusing to overwrite review evidence`);
  }
  /**
   * Built aside, then moved into place.
   *
   * A run that dies partway — a bad selector, a browser that will not start —
   * would otherwise leave a half-written directory in the history, and the
   * append-only rule would then treat that wreckage as the commit's evidence
   * and push the real package to `-r2`. Only complete packages enter the
   * history; an interrupted one leaves nothing behind.
   */
  const stagingDir = path.join(paths.commits, `.incomplete-${commit.short}-${process.pid}`);
  staging = stagingDir;
  await rm(stagingDir, { recursive: true, force: true });
  const shotsDir = path.join(stagingDir, "screenshots");
  await mkdir(shotsDir, { recursive: true });
  const referencesDir = path.join(stagingDir, "references");
  const referencesIncluded = await copyApprovedReferences(option("references"), referencesDir);

  const gates = await readGateResults(option("gates"));
  const only = option("states") ? option("states").split(",").filter(Boolean) : null;

  const origin = option("origin", "http://127.0.0.1:4183");
  let server = null;
  if (!(await fetch(origin).then(() => true).catch(() => false))) {
    server = await preview({
      root: repoRoot,
      preview: { host: "127.0.0.1", port: Number(new URL(origin).port), strictPort: true },
    });
  }
  const browser = await chromium.launch();
  console.log(`\nReview package for ${commit.short} — ${commit.subject}\n`);
  const { shots, problems } = await captureStates({ browser, origin, shotsDir, only });
  await writeContactSheet({
    browser,
    shotsDir,
    outFile: path.join(stagingDir, "CONTACT_SHEET.png"),
    shots,
    title: `${commit.short} — ${commit.subject}`,
  });
  if (referencesIncluded) {
    await writeReferenceComparisonSheet({
      browser,
      referencesDir,
      shotsDir,
      outFile: path.join(stagingDir, "COMPARISON_SHEET.png"),
      shots,
    });
  }
  await browser.close();
  if (server) await server.close();

  await writeFile(
    path.join(stagingDir, "SUMMARY.md"),
    summaryMarkdown(commit, {
      purpose: option("purpose", commit.subject),
      unchanged: option(
        "unchanged",
        "Everything not named in the commit message. This pass did not reopen the " +
          "map architecture, the ranking model, the licensing boundary, or the rail rule.",
      ),
      limitations: option("limitations", "None known from this commit."),
      shots,
      gates,
    }),
  );
  await writeFile(path.join(stagingDir, "FILES_CHANGED.md"), filesMarkdown(commit));
  await writeFile(path.join(stagingDir, "GATES.md"), gatesMarkdown(commit, gates));
  await writeFile(
    path.join(stagingDir, "REFERENCE_COMPARISON.md"),
    referenceComparisonMarkdown(commit, shots, referencesIncluded),
  );
  await writeFile(
    path.join(stagingDir, "TERRAIN_AND_SKY_VALIDATION.md"),
    terrainAndSkyValidationMarkdown(commit, shots),
  );
  await writeFile(
    path.join(stagingDir, "LIMITATIONS.md"),
    `# Limitations\n\n${option("limitations", "None known from this commit.")}\n`,
  );
  await writeFile(
    path.join(shotsDir, "manifest.json"),
    `${JSON.stringify({ commit: commit.full, capturedUtc: new Date().toISOString(), shots }, null, 2)}\n`,
  );
  if (revision > 1) {
    await writeFile(
      path.join(stagingDir, "REVISION.md"),
      `# Revision ${revision}\n\nThis is a later package for commit \`${commit.short}\`.\n` +
        `Earlier packages for the same commit are kept beside it and were not modified.\n\n` +
        `Reason: ${option("why", "not recorded")}\n`,
    );
  }

  // Complete: the package becomes visible in the history under its real name.
  await rename(stagingDir, outDir);
  execFileSync("zip", ["-qr", `tracker-review-${commit.short}.zip`, name], { cwd: paths.commits });

  console.log(`\n${shots.filter((s) => s.verified).length} of ${shots.length} states verified`);
  if (problems.length) {
    console.log("\nUnverified:");
    for (const problem of problems) console.log(`  - ${problem}`);
  }
  console.log(`\nPackage: ${outDir}`);
  console.log(`ZIP:     ${path.join(paths.commits, `tracker-review-${commit.short}.zip`)}`);
  process.exitCode = problems.length ? 1 : 0;
}

main().catch(async (error) => {
  console.error(error.message ?? error);
  // Leave nothing half-written where the history lives.
  if (staging) await rm(staging, { recursive: true, force: true }).catch(() => {});
  process.exitCode = 1;
});
