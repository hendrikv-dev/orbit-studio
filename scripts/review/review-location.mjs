import path from "node:path";

/**
 * Where a review package is allowed to be written, and under what name.
 *
 * ## Why this is a module of its own
 *
 * Two rules govern review evidence and both are easy to break by accident:
 *
 *  1. It never goes inside the repository. Not in a gitignored folder either —
 *     `.gitignore` stops a commit, it does not stop a `git clean -x`, an
 *     archive export, a `tar` of the working tree, or somebody reading the
 *     directory and assuming it is source. The boundary has to be the
 *     filesystem, not a pattern file.
 *
 *  2. It is append-only. A review package is the evidence that a specific
 *     commit was inspected. Overwriting one destroys the record of what was
 *     actually seen at the time, which is the only thing that made it evidence
 *     rather than decoration.
 *
 * Both rules are pure path arithmetic, so they live here where they can be
 * tested directly instead of being inferred from whether a run happened to put
 * files somewhere sensible.
 */

/** The default home for review history: a sibling of the repository. */
export const DEFAULT_REVIEW_DIRNAME = "orbit-studio-reviews";

/**
 * Resolve the requested output root.
 *
 * `ORBIT_REVIEW_OUTPUT_DIR` wins when set. Otherwise a predictable sibling of
 * the repository, so a fresh clone on another machine writes somewhere
 * discoverable without configuration.
 */
export function resolveReviewRoot({ env = {}, repoRoot }) {
  if (!repoRoot) throw new Error("repoRoot is required");
  const requested = (env.ORBIT_REVIEW_OUTPUT_DIR ?? "").trim();
  if (requested) return path.resolve(requested);
  return path.resolve(path.dirname(repoRoot), DEFAULT_REVIEW_DIRNAME);
}

/**
 * Is `candidate` the repository itself, or anywhere beneath it?
 *
 * Compared as resolved absolute paths with a trailing separator, so
 * `/a/repo-notes` is not mistaken for a child of `/a/repo`. Callers are
 * expected to pass real paths — `realpath`-ed where symlinks are possible — so
 * that a link pointing back into the repository cannot slip through.
 */
export function isInsideRepository(candidate, repoRoot) {
  const target = path.resolve(candidate);
  const root = path.resolve(repoRoot);
  if (target === root) return true;
  return target.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}

/**
 * The guard itself. Throws with the reason rather than returning false, because
 * every caller's correct response is to stop.
 */
export function assertOutsideRepository(candidate, repoRoot) {
  if (isInsideRepository(candidate, repoRoot)) {
    throw new Error(
      `Review output would be written inside the repository (${candidate}). ` +
        "Review evidence must live outside it: set ORBIT_REVIEW_OUTPUT_DIR to a " +
        "path that is not the repository or a descendant of it.",
    );
  }
  return path.resolve(candidate);
}

/**
 * The directory one commit's evidence belongs in.
 *
 * The commit hash is the identity; the date is there so the history browses in
 * chronological order in a file listing, which is how anybody actually reads
 * one of these.
 */
export function commitDirectoryName(committedAtIso, shortHash) {
  if (!/^[0-9a-f]{7,40}$/.test(shortHash)) {
    throw new Error(`Not a commit hash: ${shortHash}`);
  }
  const day = committedAtIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Not an ISO date: ${committedAtIso}`);
  }
  return `${day}_${shortHash}`;
}

/**
 * The name to use given what is already on disk for this commit.
 *
 * The first package for a commit is the bare name. A regeneration never
 * replaces it: it becomes `-r2`, then `-r3`, and the original stays exactly as
 * it was. There is deliberately no option to overwrite — a flag that discards
 * evidence is a flag that will eventually be used in a hurry.
 *
 * `existing` is the set of directory names already present for this commit.
 */
export function revisionName(baseName, existing) {
  const present = new Set(existing);
  if (!present.has(baseName)) return { name: baseName, revision: 1 };
  let revision = 2;
  while (present.has(`${baseName}-r${revision}`)) revision += 1;
  return { name: `${baseName}-r${revision}`, revision };
}

/** Where commit-specific and aggregate-pass evidence each live. */
export function reviewPaths(reviewRoot, product = "tracker") {
  const base = path.join(path.resolve(reviewRoot), product);
  return {
    product: base,
    commits: path.join(base, "commits"),
    passes: path.join(base, "passes"),
  };
}
