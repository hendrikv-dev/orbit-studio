import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  projectRoot,
  readInventory,
  renderAttribution,
  renderEarthReadme,
} from "./inventory.mjs";

async function main() {
  const inventory = await readInventory();
  await Promise.all([
    writeFile(path.join(projectRoot, "ATTRIBUTION.md"), renderAttribution(inventory), "utf8"),
    writeFile(
      path.join(projectRoot, "public/earth/README.md"),
      renderEarthReadme(inventory),
      "utf8",
    ),
  ]);
  console.log("[provenance] Rendered ATTRIBUTION.md and public/earth/README.md");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
