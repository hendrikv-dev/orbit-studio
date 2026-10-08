import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function gitOutput(projectRoot, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

function nulSeparated(output) {
  return output.split("\0").filter(Boolean);
}

function updateField(hash, label, value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${label}:${content.byteLength}:`);
  hash.update(content);
  hash.update("\0");
}

async function hashSourceTree(projectRoot, sourcePaths) {
  const hash = createHash("sha256");
  updateField(hash, "format", "orbit-studio-source-tree-v1");

  for (const sourcePath of sourcePaths) {
    const absolutePath = path.join(projectRoot, sourcePath);
    updateField(hash, "path", sourcePath.replaceAll(path.sep, "/"));

    try {
      const metadata = await lstat(absolutePath);
      updateField(hash, "mode", metadata.mode & 0o111 ? "executable" : "regular");
      if (metadata.isSymbolicLink()) {
        updateField(hash, "symlink", await readlink(absolutePath));
      } else if (metadata.isFile()) {
        updateField(hash, "file", await readFile(absolutePath));
      } else {
        updateField(hash, "unsupported", metadata.mode);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      updateField(hash, "missing", sourcePath);
    }
  }

  return `sha256:${hash.digest("hex")}`;
}

export async function readSourceIdentity(projectRoot) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const repositoryRoot = path.resolve(
    (await gitOutput(resolvedProjectRoot, ["rev-parse", "--show-toplevel"])).trim(),
  );
  const gitCommit = (
    await gitOutput(resolvedProjectRoot, ["rev-parse", "HEAD"])
  ).trim();
  const statusEntries = nulSeparated(
    await gitOutput(resolvedProjectRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ]),
  );
  const trackedPaths = nulSeparated(
    await gitOutput(resolvedProjectRoot, ["ls-files", "-z", "--", "."]),
  ).sort();
  const sourcePaths = nulSeparated(
    await gitOutput(resolvedProjectRoot, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ]),
  ).sort();
  const relativeRepositoryRoot = path.relative(resolvedProjectRoot, repositoryRoot) || ".";

  return {
    kind: "git",
    repositoryRoot: relativeRepositoryRoot.replaceAll(path.sep, "/"),
    gitCommit,
    gitDirty: statusEntries.length > 0,
    gitStatusEntryCount: statusEntries.length,
    trackedFileCount: trackedPaths.length,
    sourceFileCount: sourcePaths.length,
    sourceTreeHash: await hashSourceTree(resolvedProjectRoot, sourcePaths),
  };
}

/**
 * Whether a review state certifies the current satellite catalog.
 *
 * The release rule this serves is that nothing shipped may carry the locally
 * acquired catalog: a state that rendered it must say so, and say it rendered
 * the release-safe public GCAT membership with no current records.
 *
 * That rule was written when every review state came from Explorer, so it was
 * applied to all of them. Tracker's review states then arrived carrying no
 * catalog metadata at all — correctly, because Tracker never loads that catalog
 * — and a rule that asked every state for a catalog identity had no way to say
 * so except to fail them.
 *
 * The fix is not to exempt a product. It is to make each state declare what it
 * is, and to hold it to the rule that follows from the declaration:
 *
 * - `current-catalog` — the state rendered the catalog, and must prove it was
 *   the release-safe one. This is the original rule, unchanged.
 * - `none` — the state never loaded it, and must therefore carry *no* catalog
 *   identity. Declaring "none" buys no leniency: it forbids the metadata rather
 *   than excusing its absence, so a state cannot quietly ship a local catalog
 *   under a disclaimer.
 *
 * The declaration comes from the scenario registry and is stamped by the review
 * runner after a scenario's own state is spread, so it is never something a
 * captured surface can choose for itself. A package with no catalog-bearing
 * state at all fails too, because otherwise the whole review could opt out.
 */
export const CATALOG_AUTHORITIES = ["current-catalog", "none"];

/** Whether a state's datasets make any claim about the current catalog. */
function carriesCatalogIdentity(datasets) {
  if (!datasets || typeof datasets !== "object") return false;
  return (
    datasets.currentCatalogMode !== undefined ||
    datasets.currentCatalogRecordCount !== undefined ||
    datasets.catalogVersion !== undefined
  );
}

export function validateReleaseSource({
  identity,
  reviewDocument,
  expectedBuild,
  artifacts,
}) {
  const failures = [];
  const reviewSource = reviewDocument?.source;

  if (identity?.kind !== "git") failures.push("source-not-git");
  if (identity?.repositoryRoot !== ".") failures.push("repository-boundary-mismatch");
  if (!identity?.gitCommit || identity.gitCommit === "unavailable") {
    failures.push("commit-unavailable");
  }
  if (identity?.gitDirty !== false) failures.push("source-dirty");
  if (!Number.isInteger(identity?.trackedFileCount) || identity.trackedFileCount <= 0) {
    failures.push("tracked-source-empty");
  }
  if (identity?.sourceFileCount !== identity?.trackedFileCount) {
    failures.push("untracked-source-present");
  }

  if (!reviewSource) {
    failures.push("review-source-missing");
  } else {
    for (const key of [
      "repositoryRoot",
      "gitCommit",
      "gitDirty",
      "gitStatusEntryCount",
      "trackedFileCount",
      "sourceFileCount",
      "sourceTreeHash",
    ]) {
      if (reviewSource[key] !== identity?.[key]) failures.push(`review-source-${key}-mismatch`);
    }
  }

  if (reviewDocument?.gitCommit !== identity?.gitCommit) failures.push("legacy-commit-mismatch");
  if (reviewDocument?.gitDirty !== false) failures.push("legacy-dirty-state");
  if (reviewDocument?.build !== expectedBuild) failures.push("build-identity-mismatch");
  if (reviewDocument?.schemaVersion !== 6) failures.push("review-schema-mismatch");
  if (reviewDocument?.currentCatalogMode !== "release-public-gcat") {
    failures.push("review-current-catalog-mode-unsafe");
  }
  if (reviewDocument?.currentCatalogRecordCount !== 0) {
    failures.push("review-current-catalog-records-present");
  }
  if (
    !Number.isInteger(reviewDocument?.latestPublicCatalogMembershipCount) ||
    reviewDocument.latestPublicCatalogMembershipCount < 33_000
  ) {
    failures.push("review-latest-public-catalog-too-small");
  }
  if (!Array.isArray(reviewDocument?.scenarios) || reviewDocument.scenarios.length === 0) {
    failures.push("review-scenarios-missing");
  }
  if (!Array.isArray(reviewDocument?.states) || reviewDocument.states.length === 0) {
    failures.push("review-states-missing");
  } else {
    const states = reviewDocument.states;
    if (states.some((state) => !CATALOG_AUTHORITIES.includes(state.catalogAuthority))) {
      failures.push("review-state-catalog-authority-missing");
    }
    const catalogBearing = states.filter((state) => state.catalogAuthority === "current-catalog");
    if (catalogBearing.length === 0) failures.push("review-catalog-states-missing");
    if (
      catalogBearing.some(
        (state) =>
          state.datasets?.currentCatalogMode !== "release-public-gcat" ||
          state.datasets?.currentCatalogRecordCount !== 0,
      )
    ) {
      failures.push("review-state-current-catalog-unsafe");
    }
    if (
      states.some(
        (state) => state.catalogAuthority === "none" && carriesCatalogIdentity(state.datasets),
      )
    ) {
      failures.push("review-state-catalog-authority-mismatch");
    }
  }
  const latestPublicStates = reviewDocument?.states?.filter(
    (state) => state.dataCoverage?.status === "latest-public-catalog",
  ) ?? [];
  if (
    latestPublicStates.length === 0 ||
    latestPublicStates.some(
      (state) =>
        !Number.isInteger(state.datasets?.latestPublicCatalogMembershipCount) ||
        state.datasets.latestPublicCatalogMembershipCount < 33_000,
    )
  ) {
    failures.push("review-state-latest-public-catalog-too-small");
  }
  if (
    !Array.isArray(reviewDocument?.milestoneValidations) ||
    reviewDocument.milestoneValidations.some((validation) => validation.pass !== true)
  ) {
    failures.push("milestone-validation-failed");
  }
  if (
    !Array.isArray(reviewDocument?.playbackDeterminismValidations) ||
    reviewDocument.playbackDeterminismValidations.some((validation) => validation.pass !== true)
  ) {
    failures.push("determinism-validation-failed");
  }
  if (
    !Array.isArray(reviewDocument?.populationValidations) ||
    reviewDocument.populationValidations.length < 2 ||
    reviewDocument.populationValidations.some((validation) => validation.pass !== true)
  ) {
    failures.push("population-validation-failed");
  }
  if (!Array.isArray(reviewDocument?.browserDiagnostics) || reviewDocument.browserDiagnostics.length > 0) {
    failures.push("browser-diagnostics-present");
  }

  for (const [artifact, present] of Object.entries(artifacts ?? {})) {
    if (!present) failures.push(`artifact-missing:${artifact}`);
  }

  return [...new Set(failures)];
}
