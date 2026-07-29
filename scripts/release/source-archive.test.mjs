import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSourceArchive,
  validateSourceArchiveEntries,
} from "./source-archive.mjs";

function git(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function fixtureInventory(prohibitedSha256 = "0".repeat(64)) {
  return {
    controls: {
      projectMetadataPaths: [],
      firstPartyArtifacts: [],
      trackedArtifactExtensionsRequiringClassification: [".json"],
      prohibitedHistoricalChecksums: [{
        sha256: prohibitedSha256,
        description: "Synthetic prohibited fixture",
      }],
      sourceArchive: {
        outputDirectory: "release-artifacts",
        filenamePrefix: "orbit-studio-source",
        prohibitedPaths: [],
        prohibitedPathPrefixes: [
          ".git/",
          "data/generated/",
          "data/local-only/",
          "dist/",
          "evidence/",
          "node_modules/",
          "review/",
          "screenshots/",
        ],
        allowedPaths: [
          "data/historical-catalog/raw/",
          "data/historical-catalog/raw/.gitkeep",
        ],
        prohibitedBasenames: [".DS_Store", "credentials.json"],
        prohibitedExtensions: [".key", ".pem"],
      },
    },
    items: [],
  };
}

describe("release source archive", () => {
  it("rejects prohibited paths, prohibited hashes, and unexpected entries", () => {
    const prohibitedContent = Buffer.from("synthetic private acquisition\n");
    const prohibitedSha256 = createHash("sha256")
      .update(prohibitedContent)
      .digest("hex");
    const prefix = "orbit-studio-source-test/";
    const result = validateSourceArchiveEntries({
      entries: [
        {
          path: `${prefix}.git/`,
          kind: "directory",
          content: Buffer.alloc(0),
        },
        {
          path: `${prefix}safe.js`,
          kind: "file",
          content: Buffer.from("export const safe = true;\n"),
        },
        {
          path: `${prefix}data/local-only/private.json`,
          kind: "file",
          content: prohibitedContent,
        },
      ],
      expectedEntries: [{
        path: "safe.js",
        kind: "file",
        content: Buffer.from("export const expected = true;\n"),
      }],
      prefix,
      inventory: fixtureInventory(prohibitedSha256),
    });

    expect(result.failures).toContain("archive-prohibited-prefix:.git/");
    expect(result.failures).toContain("archive-entry-unexpected:.git/");
    expect(result.failures).toContain("archive-entry-content-mismatch:safe.js");
    expect(result.failures).toContain(
      "archive-prohibited-prefix:data/local-only/private.json",
    );
    expect(result.failures).toContain(
      `archive-prohibited-hash:data/local-only/private.json:${prohibitedSha256}`,
    );
    expect(result.failures).toContain(
      "archive-artifact-unclassified:data/local-only/private.json",
    );
    expect(result.failures).toContain(
      "archive-entry-unexpected:data/local-only/private.json",
    );
  });

  it("archives tracked HEAD files while leaving ignored local acquisitions outside", async () => {
    const repositoryRoot = await mkdtemp(
      path.join(os.tmpdir(), "orbit-source-archive-"),
    );

    try {
      git(repositoryRoot, ["init", "--initial-branch=main"]);
      git(repositoryRoot, ["config", "user.name", "Orbit Studio Test"]);
      git(repositoryRoot, ["config", "user.email", "orbit-test@example.invalid"]);
      await writeFile(
        path.join(repositoryRoot, ".gitignore"),
        "data/local-only/**\nrelease-artifacts/\n",
      );
      await writeFile(
        path.join(repositoryRoot, "safe.js"),
        "export const safe = true;\n",
      );
      git(repositoryRoot, ["add", "."]);
      git(repositoryRoot, ["commit", "-m", "safe source"]);

      await mkdir(path.join(repositoryRoot, "data/local-only"), { recursive: true });
      await writeFile(
        path.join(repositoryRoot, "data/local-only/private.json"),
        '{"private":true}\n',
      );

      const result = await createSourceArchive({
        repositoryRoot,
        inventory: fixtureInventory(),
      });
      expect(result.failures).toEqual([]);
      expect(result.paths).toEqual([".gitignore", "safe.js"]);
      expect(result.paths).not.toContain("data/local-only/private.json");
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });
});
