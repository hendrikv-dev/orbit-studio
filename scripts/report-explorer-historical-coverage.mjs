import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCoverageReport } from "./import-explorer-historical-catalog.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const datasetPath = resolve(
  args.find((arg) => !arg.startsWith("--")) ??
    "src/data/historical/explorerHistoricalCatalog.normalized.json",
);

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const report = createCoverageReport(dataset);

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Dataset: ${datasetPath}`);
  console.log(`Source fingerprint: ${report.sourceFingerprint}`);
  console.log(`Source-backed complete build: ${report.sourceBackedCompleteBuild ? "yes" : "no"}`);
  console.log(`Membership status: ${report.membershipStatus}`);
  console.log(`Orbit state status: ${report.orbitStateStatus}`);
  console.log(`Objects: ${report.recordCounts.objects}`);
  console.log(`Orbit states: ${report.recordCounts.orbitStates}`);
  console.log(`Identity keys: ${report.recordCounts.identities}`);
  console.log(`Launch events: ${report.recordCounts.launches}`);
  console.log(`Decay/reentry events: ${report.recordCounts.decayOrReentryEvents}`);
  console.log(`Validation errors: ${report.coverage.validationErrors}`);
  console.log(`Validation warnings: ${report.coverage.validationWarnings}`);
}
