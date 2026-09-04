import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { bundlePathPatterns, matchesBundlePattern } from "./validate-provenance.mjs";

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inventoryPath = path.join(projectRoot, "provenance/inventory.json");

/**
 * Run the real validator against the real tree.
 *
 * Slower than testing a pure function, and the only way to check the thing that
 * actually matters: what the build does when something is wrong. Each case
 * perturbs the tree, runs it, and puts the tree back.
 */
async function validate(inventoryOverride) {
  try {
    const { stdout } = await run("node", ["scripts/provenance/validate-provenance.mjs"], {
      cwd: projectRoot,
      maxBuffer: 1 << 24,
      env: inventoryOverride
        ? { ...process.env, ORBIT_PROVENANCE_INVENTORY: inventoryOverride }
        : process.env,
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.code ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/**
 * A deliberately broken copy of the inventory, written somewhere harmless.
 *
 * The audit has to run against the real tree and the real bundle, so these
 * cases cannot be pure functions — but they must not edit the committed
 * inventory to do it. Other tests read that file while these run, and an
 * interrupted run would leave it mangled.
 */
async function brokenInventory(mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), "provenance-"));
  restore.push(() => rm(directory, { recursive: true, force: true }));
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  mutate(inventory);
  const file = path.join(directory, "inventory.json");
  await writeFile(file, `${JSON.stringify(inventory, null, 2)}\n`);
  return file;
}

const restore = [];
afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
});

describe("the accepted-findings baseline", { timeout: 120_000 }, () => {
  it("passes on the tree as it stands", async () => {
    const { code, output } = await validate();
    expect(output).toContain("[provenance:accepted] 5 known findings");
    expect(code).toBe(0);
  });

  /**
   * The point of the baseline is that it excuses exactly what was written down
   * and nothing else. A finding nobody accepted still has to stop the build.
   */
  it("still fails on a finding nobody accepted", async () => {
    const stray = path.join(projectRoot, "public/brand/zz-provenance-test.png");
    await copyFile(path.join(projectRoot, "public/brand/orbit-studio-icon.png"), stray);
    restore.push(() => rm(stray, { force: true }));
    const { code, output } = await validate();
    expect(output).toContain("tracked-artifact-unclassified:public/brand/zz-provenance-test.png");
    expect(code).toBe(1);
  });

  /**
   * And an excuse cannot outlive the thing it excused: fix the obligation and
   * the build asks for the entry to be deleted, rather than carrying it for
   * years as a fact about nothing.
   */
  it("fails when an accepted finding no longer occurs", async () => {
    const broken = await brokenInventory((inventory) => {
      inventory.controls.acceptedProvenanceFindings.push({
        finding: "included-item-rights-unresolved:no-such-item",
        acceptedOn: "2026-01-01",
        reason: "not a real finding",
      });
    });
    const { code, output } = await validate(broken);
    expect(output).toContain(
      "accepted-finding-no-longer-occurs:included-item-rights-unresolved:no-such-item",
    );
    expect(code).toBe(1);
  });

  it("does not accept a finding by prefix or near miss", async () => {
    const broken = await brokenInventory((inventory) => {
      inventory.controls.acceptedProvenanceFindings =
        inventory.controls.acceptedProvenanceFindings.map((entry) => ({
          ...entry,
          finding: `${entry.finding}-and-then-some`,
        }));
    });
    const { code, output } = await validate(broken);
    expect(output).toContain("included-item-rights-unresolved:tracker-basemap-tiles");
    expect(code).toBe(1);
  });
});

describe("artifacts delivered from somewhere else", { timeout: 120_000 }, () => {
  /**
   * The VIIRS archive is gitignored and served from R2. Claiming it as a
   * repository path made a clean checkout look like a repository missing one of
   * its own files, which is what failed every CI run.
   */
  it("does not require an externally delivered artifact to be present", async () => {
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    const item = inventory.items.find((entry) => entry.id === "tracker-light-pollution-viirs");
    expect(item.externallyDeliveredPaths).toEqual([
      "public/tracker/light-pollution-v21-2024.bin",
    ]);
    expect(item.repositoryPaths).not.toContain("public/tracker/light-pollution-v21-2024.bin");
    expect(item.productionBundlePaths).not.toContain("tracker/light-pollution-v21-2024.bin");
  });

  /** The claim has to be true, or it is just a way to skip a committed file. */
  it("fails when an externally delivered path is actually tracked", async () => {
    const broken = await brokenInventory((inventory) => {
      const item = inventory.items.find((entry) => entry.id === "tracker-light-pollution-viirs");
      item.externallyDeliveredPaths = ["public/tracker/light-pollution-v21-2024.json"];
    });
    const { code, output } = await validate(broken);
    expect(output).toContain(
      "externally-delivered-artifact-is-tracked:public/tracker/light-pollution-v21-2024.json",
    );
    expect(code).toBe(1);
  });
});

describe("bundle paths claimed by pattern", { timeout: 120_000 }, () => {
  it("matches a content-hashed font", () => {
    expect(
      matchesBundlePattern("assets/space-mono-latin-400-normal-Rg4St2Dn.woff2", "assets/space-mono-*.woff2"),
    ).toBe(true);
  });

  it("does not let a pattern cross a directory boundary", () => {
    expect(matchesBundlePattern("assets/deep/space-mono-x.woff2", "assets/space-mono-*.woff2")).toBe(false);
  });

  it("distinguishes the two font formats", () => {
    expect(matchesBundlePattern("assets/space-mono-a.woff", "assets/space-mono-*.woff2")).toBe(false);
    expect(matchesBundlePattern("assets/space-mono-a.woff", "assets/space-mono-*.woff")).toBe(true);
  });

  it("collects every pattern the inventory claims", async () => {
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    const patterns = bundlePathPatterns(inventory);
    expect(patterns).toContain("assets/ibm-plex-sans-*.woff2");
    expect(patterns.every((pattern) => pattern.includes("*"))).toBe(true);
  });

  /** A pattern that matches nothing means the artifact left the bundle. */
  it("fails when a claimed pattern matches nothing", async () => {
    const broken = await brokenInventory((inventory) => {
      const fonts = inventory.items.find((entry) => entry.id === "webfont-typefaces-ofl");
      fonts.productionBundlePaths.push("assets/no-such-font-*.woff2");
    });
    const { code, output } = await validate(broken);
    expect(output).toContain("required-bundle-pattern-unmatched:assets/no-such-font-*.woff2");
    expect(code).toBe(1);
  });
});
