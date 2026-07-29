import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readSourceIdentity, validateReleaseSource } from "./source-identity.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");
const reviewRoot = path.join(projectRoot, "review");

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function filesMatch(leftPath, rightPath) {
  try {
    const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
    return left.equals(right);
  } catch {
    return false;
  }
}

async function hasWebpScreenshot(directory) {
  try {
    return (await readdir(directory)).some((entry) => entry.endsWith(".webp"));
  } catch {
    return false;
  }
}

async function main() {
  const [packageJson, reviewDocument, identity] = await Promise.all([
    readFile(path.join(projectRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(reviewRoot, "review.json"), "utf8").then(JSON.parse),
    readSourceIdentity(projectRoot),
  ]);
  const artifacts = {
    "review.json": true,
    "REVIEW_NOTES.md": await fileExists(path.join(reviewRoot, "REVIEW_NOTES.md")),
    "timeline.mp4": await fileExists(path.join(reviewRoot, "timeline.mp4")),
    "timeline.csv": await fileExists(path.join(reviewRoot, "timeline.csv")),
    "screenshots/*.webp": await hasWebpScreenshot(path.join(reviewRoot, "screenshots")),
    "ATTRIBUTION.md": await filesMatch(
      path.join(projectRoot, "ATTRIBUTION.md"),
      path.join(reviewRoot, "ATTRIBUTION.md"),
    ),
    "THIRD_PARTY_NOTICES.md": await filesMatch(
      path.join(projectRoot, "THIRD_PARTY_NOTICES.md"),
      path.join(reviewRoot, "THIRD_PARTY_NOTICES.md"),
    ),
    "provenance/inventory.json": await filesMatch(
      path.join(projectRoot, "provenance/inventory.json"),
      path.join(reviewRoot, "provenance/inventory.json"),
    ),
  };
  const failures = validateReleaseSource({
    identity,
    reviewDocument,
    expectedBuild: `${packageJson.name}@${packageJson.version}`,
    artifacts,
  });

  if (failures.length > 0) {
    console.error("[release:verify] Release source verification failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    `[release:verify] PASS ${identity.gitCommit} ${identity.sourceTreeHash} ` +
      `(${identity.trackedFileCount} tracked files)`,
  );
}

main().catch((error) => {
  console.error("[release:verify] Verification could not complete.");
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
