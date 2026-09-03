/**
 * The aggregate review package for a whole Tracker pass.
 *
 * Commit packages are the per-change record; this is the view of the feature as
 * a whole, and it is additional to them rather than a replacement. It is
 * append-only in the same way and for the same reason: an aggregate package
 * describes what the product looked like on a day, and rewriting it destroys
 * the only thing that made it worth keeping.
 *
 * It writes outside the repository. The previous version of this script wrote
 * into `review/` in the working tree and relied on `.gitignore`, which stops a
 * commit and nothing else — not `git clean -x`, not an archive of the tree, not
 * a reader assuming the directory is source.
 *
 * Usage:
 *   node scripts/review/tracker-pass-review.mjs [--label map-first] [--origin URL]
 */
import { mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { preview } from "vite";
import {
  assertOutsideRepository,
  resolveReviewRoot,
  reviewPaths,
  revisionName,
} from "./review-location.mjs";
import { captureStates, SATELLITE_CLOCK, writeContactSheet } from "./tracker-states.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function option(name, fallback = null) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function main() {
  const repoRoot = await realpath(git("rev-parse", "--show-toplevel"));
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
  await mkdir(paths.passes, { recursive: true });

  const label = option("label", "pass");
  const head = git("rev-parse", "--short", "HEAD");
  const day = new Date().toISOString().slice(0, 10);
  const base = `${day}_${label}_${head}`;
  const siblings = await readdir(paths.passes).catch(() => []);
  const { name } = revisionName(base, siblings);
  const outDir = path.join(paths.passes, name);
  if (existsSync(outDir)) {
    throw new Error(`${outDir} already exists; refusing to overwrite review evidence`);
  }
  const shotsDir = path.join(outDir, "screenshots");
  await mkdir(shotsDir, { recursive: true });

  const origin = option("origin", "http://127.0.0.1:4182");
  let server = null;
  if (!(await fetch(origin).then(() => true).catch(() => false))) {
    server = await preview({
      root: repoRoot,
      preview: { host: "127.0.0.1", port: Number(new URL(origin).port), strictPort: true },
    });
  }
  const browser = await chromium.launch();
  const { shots, problems } = await captureStates({ browser, origin, shotsDir });
  await writeContactSheet({
    browser,
    shotsDir,
    outFile: path.join(outDir, "CONTACT_SHEET.png"),
    shots,
    title: `Tracker ${label} — ${head}`,
  });
  await browser.close();
  if (server) await server.close();

  await writeFile(
    path.join(shotsDir, "manifest.json"),
    `${JSON.stringify(
      {
        head,
        capturedUtc: new Date().toISOString(),
        pinnedClockUtc: SATELLITE_CLOCK.toISOString(),
        shots,
      },
      null,
      2,
    )}\n`,
  );

  execFileSync("zip", ["-qr", `tracker-${label}-${head}.zip`, name], { cwd: paths.passes });

  console.log(`\n${shots.filter((s) => s.verified).length} of ${shots.length} states verified`);
  if (problems.length) {
    console.log("\nUnverified:");
    for (const problem of problems) console.log(`  - ${problem}`);
  }
  console.log(`\nPackage: ${outDir}`);
  process.exitCode = problems.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
