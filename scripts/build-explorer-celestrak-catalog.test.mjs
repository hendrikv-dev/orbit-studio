import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(projectRoot, "scripts/build-explorer-celestrak-catalog.mjs");
const temporaryRoots = [];

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "orbit-celestrak-local-acquisition-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

describe("local-only current catalog acquisition", () => {
  it("writes transformed records and an explicit local-only receipt outside runtime source", async () => {
    const root = await temporaryRoot();
    const input = path.join(root, "input");
    const output = path.join(root, "local-only");
    await mkdir(input, { recursive: true });

    // Project-authored synthetic GP input: it validates processing and isolation, not CelesTrak data.
    await writeFile(
      path.join(input, "celestrak-stations.json"),
      `${JSON.stringify([{
        OBJECT_NAME: "ORBIT SYNTHETIC TEST OBJECT",
        OBJECT_ID: "2026-001A",
        NORAD_CAT_ID: 60001,
        CLASSIFICATION_TYPE: "U",
        EPOCH: "2026-07-18T12:00:00.000Z",
        MEAN_MOTION: 15.5,
        MEAN_MOTION_DOT: 0,
        MEAN_MOTION_DDOT: 0,
        BSTAR: 0,
        INCLINATION: 51.6,
        RA_OF_ASC_NODE: 30,
        ECCENTRICITY: 0.001,
        ARG_OF_PERICENTER: 12,
        MEAN_ANOMALY: 48,
        EPHEMERIS_TYPE: 0,
        ELEMENT_SET_NO: 1,
        REV_AT_EPOCH: 2,
      }], null, 2)}\n`,
      "utf8",
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, input, output, "--only-group=stations"],
      { cwd: projectRoot },
    );
    const records = JSON.parse(
      await readFile(path.join(output, "explorerCelestrakCatalog.records.json"), "utf8"),
    );
    const receipt = JSON.parse(
      await readFile(path.join(output, "acquisition.provenance.json"), "utf8"),
    );

    expect(stdout).toContain("Generated data is local-only");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "celestrak-60001",
      catalogNumber: "60001",
      name: "ORBIT SYNTHETIC TEST OBJECT",
      sourceGroup: "Space Stations",
    });
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      inclusionStatus: "local-only",
      redistributionStatus: "unresolved-not-for-public-source-or-deployment",
      snapshotDate: "2026-07-18",
      recordCount: 1,
    });
    expect(receipt.localChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(receipt.acquisitionEvents).toEqual([
      expect.objectContaining({
        status: "local-input",
        recordCount: 1,
        sourceChecksum: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
    expect(await readdir(output)).toEqual([
      "acquisition.provenance.json",
      "explorerCelestrakCatalog.records.json",
    ]);
  });

  it("rejects the former runtime-source write path", async () => {
    await expect(
      execFileAsync(process.execPath, [scriptPath, "--write-runtime"], {
        cwd: projectRoot,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("--write-runtime is disabled"),
    });
  });
});
