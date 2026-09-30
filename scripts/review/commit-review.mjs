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
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
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
 * The approved source-image files are not repository inputs, so this document
 * never invents a pixel comparison. It maps the approved visual requirements
 * to the implemented product frames and says exactly where evidence stops.
 */
function referenceComparisonMarkdown(commit, shots) {
  const rows = [
    {
      surface: "Map 2D",
      target: "Quiet top-down geographic reading, restrained chrome, and one integrated recommendation.",
      ids: ["01-desktop-map-2d", "05-phone-map-2d", "15-unsupported-tablet-map"],
      matched: "Top-down geography remains primary; controls recede; one compact answer replaces the legacy rail.",
      deviation: "Production place labels and scientific overlays remain available because they carry real map meaning.",
      limitation: "No pixel-difference claim: the approved source-image files were not present in the checkout.",
    },
    {
      surface: "Map 3D",
      target: "Close observer-centred terrain atlas with immediately legible real ridges, valleys, slopes, and atmospheric depth.",
      ids: ["02-desktop-map-3d", "06-phone-map-3d", "12-tablet-map-3d"],
      matched: "DEM geometry visibly rises and falls; the camera is local and oblique; roads and transport labels are subordinate.",
      deviation: "A disclosed fixed 1.35× relief display scale is used for legibility instead of claiming natural-scale presentation.",
      limitation: "Screenshot evidence proves visible relief and renderer state, not survey-grade horizon accuracy.",
    },
    {
      surface: "Tonight",
      target: "Editorial nightly briefing with one composed lead, elegant secondary ranking, confident type, and little dashboard chrome.",
      ids: ["03-desktop-tonight-no-sky", "07-phone-tonight", "13-tablet-tonight", "16-unsupported-tablet-tonight"],
      matched: "The lead image and recommendation form one unit; secondary targets flatten into a quieter ranked list; raw unavailable labels are omitted.",
      deviation: "Production ranking, recovery, equipment, and evidence wording remain authoritative rather than being replaced by reference-image placeholder copy.",
      limitation: "The reference composition is assessed by hierarchy and density; source pixels were unavailable for direct overlay.",
    },
    {
      surface: "Object Detail",
      target: "Object-first identity, prominent recommendation, concise observing facts, visible why-it-is-worth-it, and collapsed depth.",
      ids: ["04-desktop-object-detail", "08-phone-object-detail-collapsed", "17-unsupported-tablet-object-detail"],
      matched: "The object owns the sole heading; category framing is absent; More details is closed; ordinary celestial objects have no generic map action.",
      deviation: "A small required image credit remains visible while full provenance and technical evidence stay in advanced disclosure.",
      limitation: "Phenomenon-specific geographic actions require their own event review and are not represented by Saturn.",
    },
    {
      surface: "Sky",
      target: "Emotional live-guidance payoff: selected target, one elegant lock, immediate movement cue, sky context, and minimal diagnostics.",
      ids: ["09-phone-sky-camera-granted", "10-phone-sky-guiding", "11-phone-sky-aligned", "14-tablet-sky-guiding"],
      matched: "One target lock carries direction and alignment; guidance changes through active and on-target states; diagnostics remain collapsed.",
      deviation: "No synthetic constellation lines are drawn because the catalog does not contain an authoritative line figure.",
      limitation: "These are explicitly fixture-driven browser frames with an empty MediaStream, not physical-device camera or sensor evidence.",
    },
    {
      surface: "Capability boundary",
      target: "Sky and Find in Sky only on camera-and-orientation-capable phones/tablets, with no reserved gap elsewhere.",
      ids: ["03-desktop-tonight-no-sky", "04-desktop-object-detail", "15-unsupported-tablet-map", "17-unsupported-tablet-object-detail"],
      matched: "Desktop and unsupported-tablet frames show Map · Tonight only; object detail contains neither live action nor generic Show on Map.",
      deviation: "None; the capability rule is preserved as specified.",
      limitation: "Browser capability fixtures validate gating logic; the operating-system permission UI still requires a physical-device run.",
    },
  ];

  return `# Approved-reference comparison

- **Commit** \`${commit.full}\`
- **Method** Requirement-to-frame comparison against the approved visual direction.
- **Evidence boundary** The approved generated source-image files were not available in this checkout, so this is an explicit visual-trait comparison rather than a pixel overlay or a parity claim.

| Surface | Reference target | Implemented screenshot | What matched | Intentional deviation | Remaining limitation |
| --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row.surface} | ${row.target} | ${screenshotLinks(shots, row.ids) || "_Not captured_"} | ${row.matched} | ${row.deviation} | ${row.limitation} |`).join("\n")}
`;
}

function terrainAndSkyValidationMarkdown(commit, shots) {
  const terrain = screenshotLinks(shots, [
    "02-desktop-map-3d",
    "06-phone-map-3d",
    "12-tablet-map-3d",
  ]);
  const sky = screenshotLinks(shots, [
    "09-phone-sky-camera-granted",
    "10-phone-sky-guiding",
    "11-phone-sky-aligned",
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

- Browser fixture evidence: ${sky || "_Not captured_"}.
- The fixture independently supplies handheld form factor, camera API, orientation API, permission flow, movement samples, and an aligned sample. It exercises the production capability and guidance paths.
- The fixture's \`MediaStream\` contains no camera frames. It does **not** validate live rear-camera composition, magnetic-heading accuracy, sensor jitter, operating-system permission UI, physical rotation, or background/resume recovery.
- No compatible physical phone or tablet was connected for this package. Physical-device Sky validation is therefore **blocked, not passed**. The required device protocol is recorded in \`docs/SKY_FINDER_ARCHITECTURE.md\`.
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
    referenceComparisonMarkdown(commit, shots),
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
