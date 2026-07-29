import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditReachableHistory } from "./reachable-history.mjs";

function git(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function fixtureInventory(prohibitedSha256) {
  return {
    controls: {
      prohibitedHistoricalChecksums: [{
        sha256: prohibitedSha256,
        description: "Synthetic prohibited fixture",
      }],
      prohibitedReachableHistoryPathPrefixes: [
        "data/local-only/",
        "evidence/",
        "screenshots/",
      ],
      allowedReachableHistoryPaths: [],
    },
  };
}

describe("reachable release history", () => {
  it("detects a deleted prohibited blob and passes a clean rewritten root", async () => {
    const repositoryRoot = await mkdtemp(
      path.join(os.tmpdir(), "orbit-history-audit-"),
    );
    const prohibitedContent = Buffer.from(
      '[{"fixture":"synthetic restricted catalog record"}]\n',
    );
    const prohibitedSha256 = createHash("sha256")
      .update(prohibitedContent)
      .digest("hex");

    try {
      git(repositoryRoot, ["init", "--initial-branch=main"]);
      git(repositoryRoot, ["config", "user.name", "Orbit Studio Test"]);
      git(repositoryRoot, ["config", "user.email", "orbit-test@example.invalid"]);
      await mkdir(path.join(repositoryRoot, "src/data"), { recursive: true });
      await mkdir(path.join(repositoryRoot, "evidence"), { recursive: true });
      await writeFile(
        path.join(repositoryRoot, "src/data/restricted.records.json"),
        prohibitedContent,
      );
      await writeFile(
        path.join(repositoryRoot, "evidence/derived-screenshot.txt"),
        "synthetic evidence derived from the prohibited fixture\n",
      );
      git(repositoryRoot, ["add", "."]);
      git(repositoryRoot, ["commit", "-m", "add prohibited fixture"]);

      await unlink(path.join(repositoryRoot, "src/data/restricted.records.json"));
      await unlink(path.join(repositoryRoot, "evidence/derived-screenshot.txt"));
      await writeFile(path.join(repositoryRoot, "safe.txt"), "safe final tree\n");
      git(repositoryRoot, ["add", "-A"]);
      git(repositoryRoot, ["commit", "-m", "delete prohibited fixture"]);

      const inventory = fixtureInventory(prohibitedSha256);
      const unsafe = await auditReachableHistory({
        repositoryRoot,
        inventory,
      });
      expect(unsafe.failures).toContain(
        `prohibited-reachable-history-hash:${prohibitedSha256}`,
      );
      expect(unsafe.failures).toContain(
        "prohibited-reachable-history-path:evidence/derived-screenshot.txt",
      );

      const cleanTree = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
      const cleanCommit = git(repositoryRoot, [
        "commit-tree",
        cleanTree,
        "-m",
        "clean rewritten root",
      ]);
      const clean = await auditReachableHistory({
        repositoryRoot,
        revision: cleanCommit,
        inventory,
      });
      expect(clean.failures).toEqual([]);
      expect(clean.commitCount).toBe(1);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });
});
