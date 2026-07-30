import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const scriptPath = resolve(projectRoot, "scripts/build-satellite-web-catalog.py");
const trackedArtifactPath = resolve(
  projectRoot,
  "src/data/generated/satelliteCatalog.web.json",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

describe("canonical satellite web export", () => {
  it("rebuilds deterministically from the verified SQLite authority", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbit-satellite-export-"));
    const generatedPath = join(directory, "satelliteCatalog.web.json");

    try {
      const build = spawnSync(
        "python3",
        [scriptPath, "--output", generatedPath],
        {
          cwd: projectRoot,
          encoding: "utf8",
          timeout: 180_000,
        },
      );
      expect(
        build.status,
        `${build.stdout}\n${build.stderr}`,
      ).toBe(0);

      const [generated, tracked] = await Promise.all([
        readFile(generatedPath),
        readFile(trackedArtifactPath),
      ]);
      expect(sha256(generated)).toBe(sha256(tracked));

      const artifact = JSON.parse(generated.toString("utf8"));
      expect(artifact.counts.sourceRecordCount).toBe(69_703);
      expect(artifact.counts.latestEarthMembershipCount).toBe(33_489);
      expect(artifact.counts.latestReconstructedStateCount).toBe(33_468);
      expect(artifact.counts.latestCatalogOnlyCount).toBe(21);
      expect(artifact.counts.latestClassCounts).toEqual({
        component: 1_345,
        debris: 11_277,
        payload: 18_842,
        rocket_body: 2_025,
      });
      expect(artifact.periods.map((period) => period.year)).toEqual(
        Array.from({ length: 70 }, (_, index) => 1957 + index),
      );
      expect(artifact.periods.at(-1)).toMatchObject({
        isPartialYear: true,
        periodEndDate: "2026-06-27",
      });
      expect(artifact.semantics.positionAccuracy).toBe(
        "not live; not observational; reconstructed",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
