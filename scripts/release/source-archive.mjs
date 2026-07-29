import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
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

function tarField(header, start, length) {
  const end = header.indexOf(0, start);
  return header
    .subarray(start, end >= start && end < start + length ? end : start + length)
    .toString("utf8");
}

function tarOctal(header, start, length) {
  const value = tarField(header, start, length).trim().replace(/\0/g, "");
  return value === "" ? 0 : Number.parseInt(value, 8);
}

function parsePax(content) {
  const values = {};
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    if (space < 0) throw new Error("Malformed PAX record length.");
    const length = Number.parseInt(content.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isInteger(length) || length <= 0 || offset + length > content.length) {
      throw new Error("Malformed PAX record.");
    }
    const record = content.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

export function parseTarGz(content) {
  const tar = gunzipSync(content);
  const entries = [];
  let offset = 0;
  let globalPax = {};
  let pendingPax = {};

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;

    const name = tarField(header, 0, 100);
    const prefix = tarField(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const size = tarOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0);
    const linkPath = tarField(header, 157, 100);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error(`Truncated tar entry: ${headerPath}`);
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "g") {
      globalPax = { ...globalPax, ...parsePax(data) };
      continue;
    }
    if (type === "x") {
      pendingPax = parsePax(data);
      continue;
    }

    const pax = { ...globalPax, ...pendingPax };
    pendingPax = {};
    const entryPath = pax.path ?? headerPath;
    const resolvedLinkPath = pax.linkpath ?? linkPath;
    const kind =
      type === "5" ? "directory" :
        type === "2" ? "symlink" :
          "file";
    entries.push({
      path: entryPath,
      kind,
      content: kind === "symlink" ? Buffer.from(resolvedLinkPath) : Buffer.from(data),
    });
  }

  return entries;
}

function archiveRelativePath(archivePath, prefix, failures) {
  const root = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (archivePath === root.slice(0, -1) || archivePath === root) return null;
  if (!archivePath.startsWith(root)) {
    failures.push(`archive-entry-outside-prefix:${archivePath}`);
    return null;
  }
  const relativePath = archivePath.slice(root.length);
  if (
    relativePath === "" ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.split("/").includes("..")
  ) {
    failures.push(`archive-entry-path-unsafe:${archivePath}`);
    return null;
  }
  return relativePath;
}

function classifiedArtifactPaths(inventory) {
  const classified = new Set(inventory.controls.projectMetadataPaths);
  for (const item of inventory.controls.firstPartyArtifacts) {
    item.paths.forEach((itemPath) => classified.add(itemPath));
  }
  for (const item of inventory.items) {
    item.repositoryPaths.forEach((itemPath) => classified.add(itemPath));
  }
  return classified;
}

function archivePathFailure(relativePath, inventory) {
  const controls = inventory.controls.sourceArchive;
  const allowedPaths = new Set(controls.allowedPaths ?? []);
  if (allowedPaths.has(relativePath)) return null;
  const baseName = path.posix.basename(relativePath);
  const extension = path.posix.extname(relativePath).toLowerCase();

  if ((controls.prohibitedPaths ?? []).includes(relativePath)) {
    return `archive-prohibited-path:${relativePath}`;
  }
  if (
    (controls.prohibitedPathPrefixes ?? []).some(
      (prefix) => relativePath === prefix.replace(/\/$/, "") || relativePath.startsWith(prefix),
    )
  ) {
    return `archive-prohibited-prefix:${relativePath}`;
  }
  if ((controls.prohibitedBasenames ?? []).includes(baseName)) {
    return `archive-prohibited-name:${relativePath}`;
  }
  if ((controls.prohibitedExtensions ?? []).includes(extension)) {
    return `archive-prohibited-extension:${relativePath}`;
  }
  if (
    (baseName === ".env" || baseName.startsWith(".env.")) &&
    baseName !== ".env.example"
  ) {
    return `archive-environment-file:${relativePath}`;
  }
  return null;
}

export function validateSourceArchiveEntries({
  entries,
  expectedPaths,
  expectedEntries = [],
  prefix,
  inventory,
}) {
  const failures = [];
  const archiveFiles = new Map();
  const archiveDirectories = new Set();
  const expectedEntryMap = new Map(
    expectedEntries.map((entry) => [entry.path, entry]),
  );
  const classified = classifiedArtifactPaths(inventory);
  const classifiedExtensions = new Set(
    inventory.controls.trackedArtifactExtensionsRequiringClassification,
  );
  const prohibitedChecksums = new Set(
    inventory.controls.prohibitedHistoricalChecksums.map((entry) => entry.sha256),
  );

  for (const entry of entries) {
    const relativePath = archiveRelativePath(entry.path, prefix, failures);
    if (relativePath === null) continue;
    const pathFailure = archivePathFailure(relativePath, inventory);
    if (pathFailure) failures.push(pathFailure);
    if (entry.kind === "directory") {
      if (archiveDirectories.has(relativePath)) {
        failures.push(`archive-entry-duplicated:${relativePath}`);
      }
      archiveDirectories.add(relativePath);
      continue;
    }
    if (archiveFiles.has(relativePath)) {
      failures.push(`archive-entry-duplicated:${relativePath}`);
      continue;
    }
    archiveFiles.set(relativePath, entry);

    const expectedEntry = expectedEntryMap.get(relativePath);
    if (expectedEntry && expectedEntry.kind !== entry.kind) {
      failures.push(`archive-entry-kind-mismatch:${relativePath}`);
    }
    if (expectedEntry && !expectedEntry.content.equals(entry.content)) {
      failures.push(`archive-entry-content-mismatch:${relativePath}`);
    }
    if (
      entry.kind === "symlink" &&
      (
        path.posix.isAbsolute(entry.content.toString("utf8")) ||
        entry.content.toString("utf8").split("/").includes("..")
      )
    ) {
      failures.push(`archive-symlink-target-unsafe:${relativePath}`);
    }
    const extension = path.posix.extname(relativePath).toLowerCase();
    if (
      classifiedExtensions.has(extension) &&
      !classified.has(relativePath)
    ) {
      failures.push(`archive-artifact-unclassified:${relativePath}`);
    }
    const digest = sha256(entry.content);
    if (prohibitedChecksums.has(digest)) {
      failures.push(`archive-prohibited-hash:${relativePath}:${digest}`);
    }
  }

  const expected = new Set(
    expectedPaths ?? expectedEntries.map((entry) => entry.path),
  );
  const expectedDirectories = new Set();
  for (const expectedPath of expected) {
    const parts = expectedPath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      expectedDirectories.add(`${parts.slice(0, index).join("/")}/`);
    }
  }
  for (const expectedPath of expected) {
    if (!archiveFiles.has(expectedPath)) {
      failures.push(`archive-entry-missing:${expectedPath}`);
    }
  }
  for (const archivePath of archiveFiles.keys()) {
    if (!expected.has(archivePath)) {
      failures.push(`archive-entry-unexpected:${archivePath}`);
    }
  }
  for (const archiveDirectory of archiveDirectories) {
    if (!expectedDirectories.has(archiveDirectory)) {
      failures.push(`archive-entry-unexpected:${archiveDirectory}`);
    }
  }

  return {
    entryCount: archiveFiles.size,
    paths: [...archiveFiles.keys()].sort(),
    failures: [...new Set(failures)].sort(),
  };
}

export async function verifySourceArchive({
  archivePath,
  repositoryRoot = defaultProjectRoot,
  revision = "HEAD",
  prefix,
  inventory,
} = {}) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedInventory = inventory ?? await readInventory(resolvedRoot);
  const archiveContent = await readFile(archivePath);
  const entries = parseTarGz(archiveContent);
  const treeRecords = (
    await git(resolvedRoot, ["ls-tree", "-r", "-z", "--full-tree", revision], "buffer")
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const expectedEntries = [];
  for (const record of treeRecords) {
    const tabIndex = record.indexOf("\t");
    if (tabIndex < 0) throw new Error(`Unexpected git ls-tree record: ${record}`);
    const [mode, type, objectId] = record.slice(0, tabIndex).split(" ");
    if (type !== "blob") continue;
    expectedEntries.push({
      path: record.slice(tabIndex + 1),
      kind: mode === "120000" ? "symlink" : "file",
      content: Buffer.from(
        await git(resolvedRoot, ["cat-file", "blob", objectId], "buffer"),
      ),
    });
  }
  const validation = validateSourceArchiveEntries({
    entries,
    expectedEntries,
    prefix,
    inventory: resolvedInventory,
  });
  const metadata = await stat(archivePath);

  return {
    ...validation,
    archivePath,
    revision,
    sizeBytes: metadata.size,
    sha256: sha256(archiveContent),
  };
}

export async function createSourceArchive({
  repositoryRoot = defaultProjectRoot,
  revision = "HEAD",
  inventory,
  requireClean = true,
} = {}) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedInventory = inventory ?? await readInventory(resolvedRoot);
  if (requireClean) {
    const status = await git(resolvedRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
    ]);
    if (status.trim() !== "") {
      throw new Error("Source archive creation requires a clean tracked source tree.");
    }
  }

  const commit = (await git(resolvedRoot, ["rev-parse", revision])).trim();
  const shortCommit = commit.slice(0, 12);
  const controls = resolvedInventory.controls.sourceArchive;
  const archiveName = `${controls.filenamePrefix}-${shortCommit}.tar.gz`;
  const outputDirectory = path.join(resolvedRoot, controls.outputDirectory);
  const archivePath = path.join(outputDirectory, archiveName);
  const prefix = `${controls.filenamePrefix}-${shortCommit}/`;
  await mkdir(outputDirectory, { recursive: true });
  await rm(archivePath, { force: true });
  await git(resolvedRoot, [
    "archive",
    "--format=tar.gz",
    `--prefix=${prefix}`,
    `--output=${archivePath}`,
    commit,
  ]);

  return {
    commit,
    prefix,
    ...await verifySourceArchive({
      archivePath,
      repositoryRoot: resolvedRoot,
      revision: commit,
      prefix,
      inventory: resolvedInventory,
    }),
  };
}

async function main() {
  const result = await createSourceArchive();
  if (result.failures.length > 0) {
    console.error("[archive] Source archive verification failed:");
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(
    `[archive] PASS ${path.relative(defaultProjectRoot, result.archivePath)}; ` +
      `${result.entryCount} tracked HEAD entries; ${result.sizeBytes} bytes; ` +
      `sha256:${result.sha256}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[archive] Source archive creation could not complete.");
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
