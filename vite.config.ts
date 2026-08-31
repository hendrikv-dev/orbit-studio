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
  /**
   * MapLibre ships its tile decoder as a separate worker entry and loads it by
   * URL. Vite's dependency pre-bundler rewrites that URL into `.vite/deps/` but
   * does not emit the worker there, so it 404s, no tile is ever decoded, and
   * the map renders as an empty dark rectangle with no error — the style, the
   * sprites and the TileJSON all load, which is what makes it look fine until
   * you notice nothing is drawn.
   *
   * Leaving the package unbundled keeps the worker resolving against the real
   * files. Production builds go through Rollup, which handles the worker
   * correctly on its own; this is a development-server concern only.
   */
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  /**
   * MapLibre's worker is an ES module and imports a shared chunk. Bundled as a
   * classic worker it loses the import; built as an ES module worker it keeps
   * it, which is the difference between a map that loads tiles and one that
   * silently never finishes.
   */
  worker: {
    format: "es",
  },
  plugins: [
    react(),
    releaseNoticesPlugin(),
  ],
});
