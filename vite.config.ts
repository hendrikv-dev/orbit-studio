import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from '@vitejs/plugin-react';

function releaseNoticesPlugin(): Plugin {
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
          currentCatalogMode: "release-public-gcat",
          satelliteAuthority:
            "data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite",
        }, null, 2)}\n`,
        "utf8",
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    releaseNoticesPlugin(),
  ],
});
