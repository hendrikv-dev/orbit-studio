import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSourceArchive,
  expectedContentArgs,
  isGitLfsPointer,
  validateSourceArchiveEntries,
} from "./source-archive.mjs";

/** A Git LFS pointer, in the shape git-lfs actually writes one. */
const LFS_POINTER = Buffer.from(
  "version https://git-lfs.github.com/spec/v1\n" +
    `oid sha256:${"7".repeat(64)}\n` +
    "size 124649472\n",
);

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

/**
 * Filtered paths, which is what Git LFS is.
 *
 * `git archive` runs the smudge side of a `filter` attribute, so a filtered
 * path is materialised into the archive. Verification that read the raw object
 * instead got the stored form back and reported every such path as
 * `archive-entry-content-mismatch` — which is exactly what happened to the
 * satellite authority, a 134-byte pointer being compared against the 124 MB
 * database the archive correctly contained.
 *
 * Reproduced here with a plain Git filter rather than git-lfs: the mechanism
 * that broke is the attribute, not the tool, and a test that needed git-lfs
 * installed would be skipped exactly where it matters.
 */
describe("release source archive with filtered paths", () => {
  it("expects the materialised content that git archive writes, not the stored blob", async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "orbit-archive-filter-"));

    try {
      git(repositoryRoot, ["init", "--initial-branch=main"]);
      git(repositoryRoot, ["config", "user.name", "Orbit Studio Test"]);
      git(repositoryRoot, ["config", "user.email", "orbit-test@example.invalid"]);
      // Stored one way, checked out another — the shape of an LFS pointer.
      git(repositoryRoot, ["config", "filter.stand-in.clean", "sed s/PAYLOAD/STAND-IN/"]);
      git(repositoryRoot, ["config", "filter.stand-in.smudge", "sed s/STAND-IN/PAYLOAD/"]);
      await writeFile(path.join(repositoryRoot, ".gitattributes"), "big.bin filter=stand-in\n");
      await writeFile(path.join(repositoryRoot, ".gitignore"), "release-artifacts/\n");
      await writeFile(path.join(repositoryRoot, "big.bin"), "PAYLOAD the real bytes\n");
      await writeFile(path.join(repositoryRoot, "plain.js"), "export const plain = true;\n");
      git(repositoryRoot, ["add", "."]);
      git(repositoryRoot, ["commit", "-m", "filtered source"]);

      // The stored blob really is the stand-in, so the archive and the raw
      // object genuinely differ — without that this test would pass vacuously.
      const stored = git(repositoryRoot, ["cat-file", "blob", "HEAD:big.bin"]);
      expect(stored).toContain("STAND-IN");

      const result = await createSourceArchive({
        repositoryRoot,
        inventory: fixtureInventory(),
      });
      expect(result.failures).toEqual([]);
      expect(result.paths).toContain("big.bin");
      expect(result.paths).toContain("plain.js");
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it("reads a filtered file through the checkout conversion and a symlink raw", () => {
    expect(expectedContentArgs("file", "data/authority.sqlite", "abc123")).toEqual([
      "cat-file",
      "--filters",
      "--path=data/authority.sqlite",
      "abc123",
    ]);
    expect(expectedContentArgs("symlink", "link", "def456")).toEqual([
      "cat-file",
      "blob",
      "def456",
    ]);
  });
});

/**
 * The failure the content comparison cannot see.
 *
 * Where git-lfs is not installed, `git archive` writes the pointer and the
 * verification reads that same pointer back, so the two agree and a tarball
 * that cannot rebuild the product passes as faithful. This is the check that
 * the tree the archive matches was actually resolved.
 */
describe("release source archive LFS pointer detection", () => {
  it("recognises a pointer", () => {
    expect(isGitLfsPointer(LFS_POINTER)).toBe(true);
  });

  it("does not mistake ordinary content for one", () => {
    expect(isGitLfsPointer(Buffer.from("SQLite format 3\u0000"))).toBe(false);
    expect(isGitLfsPointer(Buffer.from(""))).toBe(false);
    expect(isGitLfsPointer(Buffer.from("export const x = 1;\n"))).toBe(false);
  });

  it("does not mistake prose about the format for one", () => {
    expect(isGitLfsPointer(Buffer.from(
      "The archive must never contain version https://git-lfs.github.com/spec/v1 entries.\n",
    ))).toBe(false);
  });

  it("does not accept a truncated or malformed pointer as a real file", () => {
    expect(isGitLfsPointer(Buffer.from("version https://git-lfs.github.com/spec/v1\n"))).toBe(false);
  });

  it("fails an archive that shipped a pointer instead of the file", () => {
    const entry = {
      path: "orbit-studio-source-abc/data/authority.sqlite",
      kind: "file",
      content: LFS_POINTER,
    };
    const { failures } = validateSourceArchiveEntries({
      entries: [entry],
      expectedEntries: [{
        path: "data/authority.sqlite",
        kind: "file",
        content: LFS_POINTER,
      }],
      prefix: "orbit-studio-source-abc/",
      inventory: fixtureInventory(),
    });
    // The content comparison is satisfied — both sides are the pointer — and
    // the archive is still broken.
    expect(failures).not.toContain("archive-entry-content-mismatch:data/authority.sqlite");
    expect(failures).toContain("archive-entry-lfs-pointer:data/authority.sqlite");
  });

  it("passes an archive that shipped the resolved file", () => {
    const content = Buffer.from("SQLite format 3\u0000 real bytes");
    const { failures } = validateSourceArchiveEntries({
      entries: [{
        path: "orbit-studio-source-abc/data/authority.sqlite",
        kind: "file",
        content,
      }],
      expectedEntries: [{ path: "data/authority.sqlite", kind: "file", content }],
      prefix: "orbit-studio-source-abc/",
      inventory: fixtureInventory(),
    });
    expect(failures).toEqual([]);
  });
});
