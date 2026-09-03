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
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
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
import { captureStates, writeContactSheet } from "./tracker-states.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

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
  const shotsDir = path.join(outDir, "screenshots");
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
    outFile: path.join(outDir, "CONTACT_SHEET.png"),
    shots,
    title: `${commit.short} — ${commit.subject}`,
  });
  await browser.close();
  if (server) await server.close();

  await writeFile(
    path.join(outDir, "SUMMARY.md"),
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
  await writeFile(path.join(outDir, "FILES_CHANGED.md"), filesMarkdown(commit));
  await writeFile(path.join(outDir, "GATES.md"), gatesMarkdown(commit, gates));
  await writeFile(
    path.join(outDir, "LIMITATIONS.md"),
    `# Limitations\n\n${option("limitations", "None known from this commit.")}\n`,
  );
  await writeFile(
    path.join(shotsDir, "manifest.json"),
    `${JSON.stringify({ commit: commit.full, capturedUtc: new Date().toISOString(), shots }, null, 2)}\n`,
  );
  if (revision > 1) {
    await writeFile(
      path.join(outDir, "REVISION.md"),
      `# Revision ${revision}\n\nThis is a later package for commit \`${commit.short}\`.\n` +
        `Earlier packages for the same commit are kept beside it and were not modified.\n\n` +
        `Reason: ${option("why", "not recorded")}\n`,
    );
  }

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

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
