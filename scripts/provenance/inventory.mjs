import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDirectory, "../..");
export const inventoryPath = path.join(projectRoot, "provenance/inventory.json");

/**
 * The inventory, from the repository or from wherever the caller points.
 *
 * `ORBIT_PROVENANCE_INVENTORY` exists for the validator's own tests, which have
 * to run the real audit against deliberately broken inventories. Without it
 * they would have to edit the committed file and put it back, which is not safe
 * while other tests are running beside them and leaves a mangled inventory
 * behind if a run is interrupted.
 */
export async function readInventory(root = projectRoot) {
  const override = process.env.ORBIT_PROVENANCE_INVENTORY;
  const file = override
    ? path.resolve(override)
    : path.join(root, "provenance/inventory.json");
  return JSON.parse(await readFile(file, "utf8"));
}

function sourceLinks(item) {
  const source = item.originalSource ?? {};
  return [source.publicationUrl, source.url].filter(Boolean);
}

export function renderAttribution(inventory) {
  const lines = [
    "# Attribution and Third-Party Material",
    "",
    "<!-- Generated from provenance/inventory.json. Do not edit by hand. -->",
    "",
    "Orbit Studio source code is MIT-licensed. Third-party data, imagery, generated subsets,",
    "scientific reference outputs, and dependency code remain governed by their recorded terms.",
    "",
  ];

  for (const item of inventory.items) {
    const included = item.release.release1Included;
    lines.push(`## ${item.originalSource.title}`, "");
    lines.push(`- Inventory ID: \`${item.id}\``);
    lines.push(`- Category: ${item.category}`);
    lines.push(`- Release status: ${item.release.inclusionStatus}`);
    lines.push(`- Release 1.0 included: ${included ? "yes" : "no"}`);
    lines.push(`- Publisher or rights holder: ${item.originalSource.publisher}`);
    lines.push(`- Version or snapshot: ${item.originalSource.version}`);
    if (item.originalSource.retrievedAt) {
      lines.push(`- Retrieval date: ${item.originalSource.retrievedAt}`);
    }
    for (const sourceUrl of sourceLinks(item)) {
      lines.push(`- Authoritative source: ${sourceUrl}`);
    }
    lines.push(`- Rights basis: ${item.rights.licenseOrBasis}`);
    for (const evidenceUrl of item.rights.evidenceUrls) {
      lines.push(`- Rights evidence: ${evidenceUrl}`);
    }
    lines.push(`- Attribution: ${item.rights.attribution}`);
    lines.push(`- Public source redistribution: ${item.rights.sourceRedistribution}`);
    lines.push(`- Public deployment redistribution: ${item.rights.deployedRedistribution}`);
    lines.push(`- Modification status: ${item.rights.modification}`);
    if (item.repositoryPaths.length > 0) {
      lines.push(`- Repository paths: ${item.repositoryPaths.map((value) => `\`${value}\``).join(", ")}`);
    } else {
      lines.push("- Repository paths: none");
    }
    if (item.productionBundlePaths.length > 0) {
      lines.push(
        `- Production paths: ${item.productionBundlePaths.map((value) => `\`${value}\``).join(", ")}`,
      );
    } else {
      lines.push("- Production paths: none");
    }
    lines.push(`- Restrictions and notes: ${item.release.restrictions}`, "");
  }

  lines.push(
    "## Software dependencies",
    "",
    "The complete lockfile-derived dependency inventory and runtime notice texts are in",
    "`THIRD_PARTY_NOTICES.md`. `node_modules` is not part of the repository or release package.",
    "",
  );

  return lines.join("\n");
}

export function renderEarthReadme(inventory) {
  const earth = inventory.items.find((item) => item.id === "nasa-blue-marble-january-2004");
  if (!earth) throw new Error("Missing NASA Blue Marble provenance item.");

  return `# Public Earth Textures

<!-- Generated from provenance/inventory.json. Do not edit by hand. -->

Orbit Studio ships only Earth imagery with recorded source URLs, exact checksums, and a verified
redistribution basis.

## \`nasa-blue-marble-january-5400.jpg\`

- Source: ${earth.originalSource.publicationUrl}
- Original asset: ${earth.originalSource.url}
- Publisher: ${earth.originalSource.publisher}
- Version: ${earth.originalSource.version}
- Retrieval date: ${earth.originalSource.retrievedAt}
- Original and local SHA-256: \`${earth.originalSource.originalSha256}\`
- Processing: ${earth.processing.join(" ")}
- Rights basis: ${earth.rights.licenseOrBasis}
- Attribution: ${earth.rights.attribution}

Cloud and night-light textures use project-authored SVG placeholders. No other Earth image is
included in the public source or production bundle.
`;
}
