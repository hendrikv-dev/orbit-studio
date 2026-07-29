import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from '@vitejs/plugin-react';

const releaseCatalogPath = resolve("src/data/explorerCelestrakCatalog.records.json");
const localCatalogPath = resolve(
  "data/local-only/celestrak/explorerCelestrakCatalog.records.json",
);
const currentCatalogBuildMode = process.env.ORBIT_CURRENT_CATALOG_MODE ?? "release";

function localCurrentCatalogPlugin(mode: string): Plugin {
  if (!["release", "local"].includes(mode)) {
    throw new Error(
      `Unsupported ORBIT_CURRENT_CATALOG_MODE=${mode}; expected "release" or "local".`,
    );
  }

  if (mode === "release") {
    return { name: "orbit-current-catalog-release-mode" };
  }

  if (!existsSync(localCatalogPath)) {
    throw new Error(
      "ORBIT_CURRENT_CATALOG_MODE=local requires " +
        "data/local-only/celestrak/explorerCelestrakCatalog.records.json. " +
        "Run npm run catalog:sync first.",
    );
  }

  return {
    name: "orbit-current-catalog-local-mode",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        importer?.endsWith("/src/data/explorerCelestrakCatalog.ts") &&
        resolve(importer, "..", source) === releaseCatalogPath
      ) {
        return localCatalogPath;
      }
      return null;
    },
  };
}

function releaseNoticesPlugin(mode: string): Plugin {
  return {
    name: "orbit-release-notices",
    writeBundle(options) {
      const outputDirectory = resolve(String(options.dir ?? "dist"));
      const provenanceDirectory = resolve(outputDirectory, "provenance");
      mkdirSync(provenanceDirectory, { recursive: true });
      copyFileSync(resolve("ATTRIBUTION.md"), resolve(outputDirectory, "ATTRIBUTION.md"));
      copyFileSync(
        resolve("THIRD_PARTY_NOTICES.md"),
        resolve(outputDirectory, "THIRD_PARTY_NOTICES.md"),
      );
      copyFileSync(
        resolve("provenance/inventory.json"),
        resolve(provenanceDirectory, "inventory.json"),
      );
      writeFileSync(
        resolve(outputDirectory, "orbit-release.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          currentCatalogMode: mode,
        }, null, 2)}\n`,
        "utf8",
      );
    },
  };
}

export default defineConfig({
  plugins: [
    localCurrentCatalogPlugin(currentCatalogBuildMode),
    react(),
    releaseNoticesPlugin(currentCatalogBuildMode),
  ],
});
