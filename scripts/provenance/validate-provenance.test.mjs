import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { existingCurrentTreePaths } from "./validate-provenance.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ),
  );
});

describe("current-tree provenance path resolution", () => {
  it("audits present files while excluding a tracked path deleted in the working tree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orbit-provenance-tree-"));
    temporaryRoots.push(root);
    await writeFile(path.join(root, "retained.json"), "{}\n");

    await expect(
      existingCurrentTreePaths(
        ["deleted.json", "retained.json"],
        root,
      ),
    ).resolves.toEqual(["retained.json"]);
  });
});
