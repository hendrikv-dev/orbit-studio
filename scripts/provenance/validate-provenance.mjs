import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  projectRoot,
  readInventory,
  renderAttribution,
  renderEarthReadme,
} from "./inventory.mjs";
import {
  renderDependencyNotices,
  validateDependencyLicenses,
} from "./dependency-licenses.mjs";

const execFileAsync = promisify(execFile);
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function gitPaths(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.toString("utf8").split("\0").filter(Boolean).sort();
}

async function recursiveFiles(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(directory);
  return files.sort();
}

function expectedExactBundlePaths(inventory) {
  const paths = new Set([
    "ATTRIBUTION.md",
    "THIRD_PARTY_NOTICES.md",
    "earth/README.md",
    inventory.controls.releaseBuildMetadata.path,
    "provenance/inventory.json",
  ]);

  for (const item of inventory.items) {
    for (const bundlePath of item.productionBundlePaths) {
      if (!bundlePath.includes("*")) paths.add(bundlePath);
    }
  }
  for (const item of inventory.controls.firstPartyArtifacts) {
    for (const sourcePath of item.paths) {
      if (sourcePath.startsWith("public/")) paths.add(sourcePath.slice("public/".length));
    }
  }
  return paths;
}

function validateInventorySchema(inventory, failures) {
  const requiredString = (value, field) => {
    if (typeof value !== "string" || value.trim() === "") {
      failures.push(`provenance-required-field-missing:${field}`);
    }
  };
  const itemIds = new Set();
  const inclusionStatuses = new Set([
    "excluded",
    "external-acquisition",
    "external-acquisition-disabled",
    "local-only",
    "placeholder-only",
    "retained",
    "retained-test-only",
  ]);

  if (!Array.isArray(inventory.items) || inventory.items.length === 0) {
    failures.push("provenance-items-missing");
    return;
  }
  requiredString(
    inventory.controls?.releaseBuildMetadata?.path,
    "controls.releaseBuildMetadata.path",
  );
  if (inventory.controls?.releaseBuildMetadata?.schemaVersion !== 1) {
    failures.push("provenance-release-build-schema-invalid");
  }
  if (inventory.controls?.releaseBuildMetadata?.currentCatalogMode !== "release") {
    failures.push("provenance-release-build-mode-invalid");
  }
  const requiredControlArrays = [
    "prohibitedHistoricalChecksums",
    "prohibitedReachableHistoryPathPrefixes",
    "allowedReachableHistoryPaths",
  ];
  for (const field of requiredControlArrays) {
    if (!Array.isArray(inventory.controls?.[field])) {
      failures.push(`provenance-control-invalid:${field}`);
    }
  }
  for (const entry of inventory.controls?.prohibitedHistoricalChecksums ?? []) {
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 ?? "")) {
      failures.push("provenance-prohibited-checksum-invalid");
    }
    requiredString(entry.description, "controls.prohibitedHistoricalChecksums.description");
  }
  const archiveControls = inventory.controls?.sourceArchive;
  requiredString(archiveControls?.outputDirectory, "controls.sourceArchive.outputDirectory");
  requiredString(archiveControls?.filenamePrefix, "controls.sourceArchive.filenamePrefix");
  for (const field of [
    "prohibitedPaths",
    "prohibitedPathPrefixes",
    "allowedPaths",
    "prohibitedBasenames",
    "prohibitedExtensions",
  ]) {
    if (!Array.isArray(archiveControls?.[field])) {
      failures.push(`provenance-control-invalid:sourceArchive.${field}`);
    }
  }

  for (const item of inventory.items) {
    requiredString(item.id, "item.id");
    requiredString(item.category, `${item.id}.category`);
    if (itemIds.has(item.id)) failures.push(`provenance-id-duplicated:${item.id}`);
    itemIds.add(item.id);

    if (!Array.isArray(item.repositoryPaths)) {
      failures.push(`provenance-repository-paths-invalid:${item.id}`);
    }
    if (!Array.isArray(item.productionBundlePaths)) {
      failures.push(`provenance-production-paths-invalid:${item.id}`);
    }

    requiredString(item.originalSource?.title, `${item.id}.originalSource.title`);
    requiredString(item.originalSource?.publisher, `${item.id}.originalSource.publisher`);
    requiredString(item.originalSource?.version, `${item.id}.originalSource.version`);
    if (
      !item.originalSource?.url &&
      !item.originalSource?.publicationUrl &&
      item.originalSource?.publisher !== "Orbit Studio"
    ) {
      failures.push(`provenance-authoritative-source-missing:${item.id}`);
    }
    if (!Array.isArray(item.processing) || item.processing.length === 0) {
      failures.push(`provenance-processing-missing:${item.id}`);
    } else {
      item.processing.forEach((step, index) =>
        requiredString(step, `${item.id}.processing.${index}`)
      );
    }

    requiredString(item.rights?.verification, `${item.id}.rights.verification`);
    requiredString(item.rights?.licenseOrBasis, `${item.id}.rights.licenseOrBasis`);
    requiredString(item.rights?.attribution, `${item.id}.rights.attribution`);
    requiredString(
      item.rights?.sourceRedistribution,
      `${item.id}.rights.sourceRedistribution`,
    );
    requiredString(
      item.rights?.deployedRedistribution,
      `${item.id}.rights.deployedRedistribution`,
    );
    requiredString(item.rights?.modification, `${item.id}.rights.modification`);
    if (!Array.isArray(item.rights?.evidenceUrls)) {
      failures.push(`provenance-rights-evidence-invalid:${item.id}`);
    } else if (
      item.rights.evidenceUrls.length === 0 &&
      item.originalSource?.publisher !== "Orbit Studio"
    ) {
      failures.push(`provenance-rights-evidence-missing:${item.id}`);
    }

    if (!inclusionStatuses.has(item.release?.inclusionStatus)) {
      failures.push(`provenance-inclusion-status-unreviewed:${item.id}`);
    }
    if (typeof item.release?.release1Included !== "boolean") {
      failures.push(`provenance-release-inclusion-invalid:${item.id}`);
    }
    requiredString(item.release?.restrictions, `${item.id}.release.restrictions`);

    for (const asset of item.originalSource?.assets ?? []) {
      requiredString(asset.id, `${item.id}.asset.id`);
      requiredString(asset.url, `${item.id}.${asset.id}.url`);
      requiredString(asset.metadataUrl, `${item.id}.${asset.id}.metadataUrl`);
      requiredString(asset.publisher, `${item.id}.${asset.id}.publisher`);
      if (!/^[0-9a-f]{64}$/.test(asset.sha256 ?? "")) {
        failures.push(`provenance-asset-checksum-invalid:${item.id}:${asset.id}`);
      }
    }
    for (const component of item.originalSource?.components ?? []) {
      requiredString(component.id, `${item.id}.component.id`);
      requiredString(component.url, `${item.id}.${component.id}.url`);
      requiredString(component.licenseUrl, `${item.id}.${component.id}.licenseUrl`);
      if (!/^[0-9a-f]{40}$/.test(component.commit ?? "")) {
        failures.push(`provenance-component-commit-invalid:${item.id}:${component.id}`);
      }
    }
  }
}

async function validateTrackedFiles(inventory, failures) {
  const trackedPaths = await gitPaths([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
  ]);
  const classified = new Set(inventory.controls.projectMetadataPaths);

  for (const item of inventory.controls.firstPartyArtifacts) {
    for (const sourcePath of item.paths) {
      classified.add(sourcePath);
      const content = await readFile(path.join(projectRoot, sourcePath)).catch(() => null);
      if (!content) {
        failures.push(`first-party-artifact-missing:${sourcePath}`);
      } else if (sha256(content) !== item.sha256[sourcePath]) {
        failures.push(`first-party-artifact-checksum-mismatch:${sourcePath}`);
      }
    }
  }

  for (const item of inventory.items) {
    if (item.release.release1Included && item.rights.verification !== "verified") {
      failures.push(`included-item-rights-unresolved:${item.id}`);
    }
    if (
      item.release.release1Included &&
      ["unresolved", "excluded", "local-only"].includes(item.rights.sourceRedistribution)
    ) {
      failures.push(`included-item-source-redistribution-unsafe:${item.id}`);
    }
    if (
      item.release.release1Included &&
      ["unresolved", "excluded", "local-only"].includes(item.rights.deployedRedistribution)
    ) {
      failures.push(`included-item-deployment-redistribution-unsafe:${item.id}`);
    }

    for (const sourcePath of item.repositoryPaths) {
      if (classified.has(sourcePath)) failures.push(`provenance-path-owned-twice:${sourcePath}`);
      classified.add(sourcePath);
      const content = await readFile(path.join(projectRoot, sourcePath)).catch(() => null);
      if (!content) {
        failures.push(`provenance-file-missing:${item.id}:${sourcePath}`);
        continue;
      }
      const expected = item.localSha256[sourcePath];
      if (!expected) {
        failures.push(`provenance-checksum-missing:${item.id}:${sourcePath}`);
      } else if (sha256(content) !== expected) {
        failures.push(`provenance-checksum-mismatch:${item.id}:${sourcePath}`);
      }
    }
  }

  const classifiedExtensions = new Set(
    inventory.controls.trackedArtifactExtensionsRequiringClassification,
  );
  for (const trackedPath of trackedPaths) {
    const baseName = path.basename(trackedPath);
    if (inventory.controls.prohibitedTrackedNames.includes(baseName)) {
      failures.push(`prohibited-tracked-name:${trackedPath}`);
    }
    if (
      inventory.controls.prohibitedTrackedPrefixes.some((prefix) =>
        trackedPath.startsWith(prefix)
      )
    ) {
      failures.push(`prohibited-tracked-prefix:${trackedPath}`);
    }
    if (trackedPath.startsWith("evidence/") || trackedPath.startsWith("screenshots/")) {
      failures.push(`excluded-review-artifact-tracked:${trackedPath}`);
    }
    if (
      classifiedExtensions.has(path.extname(trackedPath).toLowerCase()) &&
      !classified.has(trackedPath)
    ) {
      failures.push(`tracked-artifact-unclassified:${trackedPath}`);
    }
  }

  const documentedHosts = new Set(inventory.controls.documentedExternalHosts);
  for (const trackedPath of trackedPaths) {
    if (trackedPath === "package-lock.json") continue;
    if (!textExtensions.has(path.extname(trackedPath).toLowerCase())) continue;
    const content = await readFile(path.join(projectRoot, trackedPath), "utf8");
    for (const match of content.matchAll(/https?:\/\/[^\s<>)"'`]+/g)) {
      try {
        const host = new URL(match[0].replace(/[.,;:]$/, "")).hostname;
        if (!documentedHosts.has(host)) {
          failures.push(`external-host-unreviewed:${trackedPath}:${host}`);
        }
      } catch {
        failures.push(`external-url-invalid:${trackedPath}:${match[0]}`);
      }
    }
  }

  for (const prohibited of inventory.controls.prohibitedHistoricalChecksums) {
    for (const trackedPath of trackedPaths) {
      const content = await readFile(path.join(projectRoot, trackedPath));
      if (sha256(content) === prohibited.sha256) {
        failures.push(`prohibited-historical-content-tracked:${trackedPath}`);
      }
    }
  }
}

async function validateHumanNotices(inventory, dependencyAudit, failures) {
  const checks = [
    ["ATTRIBUTION.md", renderAttribution(inventory)],
    ["public/earth/README.md", renderEarthReadme(inventory)],
    ["THIRD_PARTY_NOTICES.md", renderDependencyNotices(dependencyAudit)],
  ];
  for (const [relativePath, expected] of checks) {
    const actual = await readFile(path.join(projectRoot, relativePath), "utf8").catch(() => null);
    if (actual !== expected) failures.push(`generated-notice-out-of-date:${relativePath}`);
  }
}

async function validateProductionBundle(inventory, failures) {
  const distRoot = path.join(projectRoot, "dist");
  if (!(await fileExists(path.join(distRoot, "index.html")))) {
    failures.push("production-bundle-missing");
    return 0;
  }

  const files = await recursiveFiles(distRoot);
  const relativePaths = files.map((filePath) =>
    path.relative(distRoot, filePath).replaceAll(path.sep, "/")
  );
  const expectedExact = expectedExactBundlePaths(inventory);
  const classifiedExtensions = new Set(
    inventory.controls.trackedArtifactExtensionsRequiringClassification,
  );
  const documentedHosts = new Set(inventory.controls.documentedExternalHosts);

  for (const relativePath of relativePaths) {
    const baseName = path.basename(relativePath);
    if (inventory.controls.prohibitedBundleNames.includes(baseName)) {
      failures.push(`prohibited-bundle-name:${relativePath}`);
    }
    const extension = path.extname(relativePath).toLowerCase();
    if (
      classifiedExtensions.has(extension) &&
      !expectedExact.has(relativePath)
    ) {
      failures.push(`bundle-artifact-unclassified:${relativePath}`);
    }
    if (
      textExtensions.has(extension) &&
      !["ATTRIBUTION.md", "THIRD_PARTY_NOTICES.md", "provenance/inventory.json"]
        .includes(relativePath)
    ) {
      const content = await readFile(path.join(distRoot, relativePath), "utf8");
      for (const marker of inventory.controls.prohibitedBundleText) {
        if (content.includes(marker)) {
          failures.push(`prohibited-bundle-text:${relativePath}:${marker}`);
        }
      }
      for (const match of content.matchAll(/https?:\/\/[^\s<>)"'`]+/g)) {
        try {
          const host = new URL(match[0].replace(/[.,;:]$/, "")).hostname;
          if (!documentedHosts.has(host)) {
            failures.push(`bundle-external-host-unreviewed:${relativePath}:${host}`);
          }
        } catch {
          failures.push(`bundle-external-url-invalid:${relativePath}:${match[0]}`);
        }
      }
    }
  }

  for (const relativePath of expectedExact) {
    if (!relativePaths.includes(relativePath)) {
      failures.push(`required-bundle-artifact-missing:${relativePath}`);
    }
  }

  for (const item of inventory.items) {
    for (const bundlePath of item.productionBundlePaths) {
      if (bundlePath.includes("*")) continue;
      const sourcePath = item.repositoryPaths.find((value) =>
        value.endsWith(bundlePath)
      );
      if (!sourcePath) continue;
      const bundleContent = await readFile(path.join(distRoot, bundlePath)).catch(() => null);
      if (!bundleContent) continue;
      const expected = item.localSha256[sourcePath];
      if (expected && sha256(bundleContent) !== expected) {
        failures.push(`bundle-checksum-mismatch:${item.id}:${bundlePath}`);
      }
    }
  }

  const exactCopies = [
    ["ATTRIBUTION.md", "ATTRIBUTION.md"],
    ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
    ["provenance/inventory.json", "provenance/inventory.json"],
    ["public/earth/README.md", "earth/README.md"],
  ];
  for (const [sourcePath, bundlePath] of exactCopies) {
    const [source, bundled] = await Promise.all([
      readFile(path.join(projectRoot, sourcePath)).catch(() => null),
      readFile(path.join(distRoot, bundlePath)).catch(() => null),
    ]);
    if (!source || !bundled || !source.equals(bundled)) {
      failures.push(`bundle-notice-mismatch:${bundlePath}`);
    }
  }

  const releaseMetadata = await readFile(
    path.join(distRoot, inventory.controls.releaseBuildMetadata.path),
    "utf8",
  ).then(JSON.parse).catch(() => null);
  if (
    releaseMetadata?.schemaVersion !== inventory.controls.releaseBuildMetadata.schemaVersion ||
    releaseMetadata?.currentCatalogMode !==
      inventory.controls.releaseBuildMetadata.currentCatalogMode
  ) {
    failures.push(
      `production-build-mode-unsafe:${releaseMetadata?.currentCatalogMode ?? "missing"}`,
    );
  }

  return relativePaths.length;
}

async function main() {
  const inventory = await readInventory();
  const treeFailures = [];
  const bundleFailures = [];
  const { audit: dependencyAudit, failures: dependencyFailures } =
    await validateDependencyLicenses({ checkNotice: true });
  treeFailures.push(...dependencyFailures);

  if (inventory.schemaVersion !== 1) {
    treeFailures.push(`unsupported-provenance-schema:${inventory.schemaVersion}`);
  }

  validateInventorySchema(inventory, treeFailures);
  await validateTrackedFiles(inventory, treeFailures);
  await validateHumanNotices(inventory, dependencyAudit, treeFailures);
  const bundleFileCount = await validateProductionBundle(inventory, bundleFailures);

  const uniqueTreeFailures = [...new Set(treeFailures)].sort();
  const uniqueBundleFailures = [...new Set(bundleFailures)].sort();
  if (uniqueTreeFailures.length > 0) {
    console.error("[provenance:tree] Current-tree audit failed:");
    uniqueTreeFailures.forEach((failure) => console.error(`- ${failure}`));
  } else {
    console.log(
      `[provenance:tree] PASS ${inventory.items.length} inventory items; ` +
        `${dependencyAudit.packages.length} locked packages; tracked and non-ignored source audited`,
    );
  }
  if (uniqueBundleFailures.length > 0) {
    console.error("[provenance:bundle] Production-bundle audit failed:");
    uniqueBundleFailures.forEach((failure) => console.error(`- ${failure}`));
  } else {
    console.log(
      `[provenance:bundle] PASS ${bundleFileCount} production files audited`,
    );
  }
  if (uniqueTreeFailures.length > 0 || uniqueBundleFailures.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(
    "[provenance] PASS current tree and production bundle independently audited",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
