import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readInventory } from "../provenance/inventory.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "../..");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function git(repositoryRoot, args, encoding = "utf8") {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding,
    maxBuffer: 128 * 1024 * 1024,
  });
  return stdout;
}

function parseTreeEntries(output) {
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const tabIndex = record.indexOf("\t");
      if (tabIndex < 0) throw new Error(`Unexpected git ls-tree record: ${record}`);
      const [mode, type, objectId] = record.slice(0, tabIndex).split(" ");
      return {
        mode,
        type,
        objectId,
        path: record.slice(tabIndex + 1),
      };
    });
}

export async function auditReachableHistory({
  repositoryRoot = defaultProjectRoot,
  revision = "HEAD",
  inventory,
} = {}) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedInventory = inventory ?? await readInventory(resolvedRoot);
  const commits = (await git(resolvedRoot, ["rev-list", "--reverse", revision]))
    .trim()
    .split("\n")
    .filter(Boolean);
  const blobReferences = new Map();
  let pathObservationCount = 0;
  const failures = [];
  const prohibitedPrefixes =
    resolvedInventory.controls.prohibitedReachableHistoryPathPrefixes ?? [];
  const allowedPaths = new Set(
    resolvedInventory.controls.allowedReachableHistoryPaths ?? [],
  );

  for (const commit of commits) {
    const entries = parseTreeEntries(
      await git(
        resolvedRoot,
        ["ls-tree", "-r", "-z", "--full-tree", commit],
        "buffer",
      ),
    );

    for (const entry of entries) {
      if (entry.type !== "blob") continue;
      pathObservationCount += 1;
      const reference = blobReferences.get(entry.objectId) ?? {
        commits: new Set(),
        paths: new Set(),
      };
      reference.commits.add(commit);
      reference.paths.add(entry.path);
      blobReferences.set(entry.objectId, reference);

      if (
        !allowedPaths.has(entry.path) &&
        prohibitedPrefixes.some((prefix) => entry.path.startsWith(prefix))
      ) {
        failures.push(`prohibited-reachable-history-path:${entry.path}`);
      }
    }
  }

  const prohibitedChecksums = new Map(
    resolvedInventory.controls.prohibitedHistoricalChecksums.map((entry) => [
      entry.sha256,
      entry,
    ]),
  );
  const matchedProhibitedChecksums = [];

  for (const [objectId, reference] of blobReferences) {
    const content = await git(resolvedRoot, ["cat-file", "blob", objectId], "buffer");
    const digest = sha256(content);
    const prohibited = prohibitedChecksums.get(digest);
    if (!prohibited) continue;
    matchedProhibitedChecksums.push({
      sha256: digest,
      description: prohibited.description,
      objectId,
      paths: [...reference.paths].sort(),
      commits: [...reference.commits].sort(),
    });
    failures.push(`prohibited-reachable-history-hash:${digest}`);
  }

  return {
    revision,
    commits,
    commitCount: commits.length,
    uniqueBlobCount: blobReferences.size,
    pathObservationCount,
    matchedProhibitedChecksums,
    failures: [...new Set(failures)].sort(),
  };
}

async function main() {
  const result = await auditReachableHistory();
  if (result.failures.length > 0) {
    console.error("[history] Reachable-history audit failed:");
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    for (const match of result.matchedProhibitedChecksums) {
      console.error(
        `- matched ${match.sha256} at ${match.paths.join(", ")} ` +
          `(${match.description})`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `[history] PASS ${result.commitCount} reachable commits; ` +
      `${result.uniqueBlobCount} unique blobs; ${result.pathObservationCount} path observations`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[history] Reachable-history audit could not complete.");
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
