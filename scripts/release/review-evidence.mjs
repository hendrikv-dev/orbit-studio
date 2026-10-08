import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  assertOutsideRepository,
  resolveReviewRoot,
} from "../review/review-location.mjs";

export const REVIEW_RUN_ENV = "ORBIT_REVIEW_RUN_DIR";

async function externalDirectory(candidate, projectRoot) {
  let resolvedCandidate;
  let resolvedProjectRoot;
  try {
    [resolvedCandidate, resolvedProjectRoot] = await Promise.all([
      realpath(candidate),
      realpath(projectRoot),
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`External review evidence directory does not exist: ${candidate}`, { cause: error });
    }
    throw error;
  }
  return assertOutsideRepository(resolvedCandidate, resolvedProjectRoot);
}

/**
 * Select the external review run that release verification must inspect.
 *
 * An explicit run is the strongest and most reproducible input. Without one,
 * the newest append-only timestamped run under the same review-root authority
 * used by `npm run review` is selected. Source identity and every artifact are
 * still validated by `validateReleaseSource`; discovery grants no exceptions.
 */
export async function resolveReleaseReviewRun({ env = {}, projectRoot }) {
  if (!projectRoot) throw new Error("projectRoot is required");

  const explicit = (env[REVIEW_RUN_ENV] ?? "").trim();
  if (explicit) {
    return externalDirectory(path.resolve(projectRoot, explicit), projectRoot);
  }

  const reviewRoot = resolveReviewRoot({ env, repoRoot: projectRoot });
  const runsRoot = await externalDirectory(path.join(reviewRoot, "runs"), projectRoot);
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const newest = entries
    .filter((entry) => entry.isDirectory() && /^review-\d{4}-\d{2}-\d{2}T/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))[0];

  if (!newest) {
    throw new Error(
      `No external review runs were found in ${runsRoot}. ` +
        `Run npm run review first or set ${REVIEW_RUN_ENV} to an exact run directory.`,
    );
  }

  return externalDirectory(path.join(runsRoot, newest), projectRoot);
}
