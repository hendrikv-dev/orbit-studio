import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditLfsAssets,
  IMPLAUSIBLE_BYTES,
  POINTER_MAGIC,
  readLfsPaths,
  readPointer,
} from "./lfs-assets.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TRACKED = "data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite";

/**
 * The pointer git actually stores for the satellite authority, read out of the
 * object database rather than typed out here.
 *
 * Using the real blob is the point: this is byte for byte what a checkout
 * without `lfs: true` leaves on disk, which is what CI was testing against.
 * The working copy is never touched — the fixture is written into a temporary
 * directory, so a failure here cannot cost anyone a 124 MB re-download.
 */
const realPointer = execFileSync("git", ["cat-file", "blob", `HEAD:${TRACKED}`], {
  cwd: projectRoot,
  encoding: "utf8",
  maxBuffer: 1 << 20,
});

const made = [];
async function treeOf({ gitattributes, files = {} }) {
  const root = await mkdtemp(path.join(tmpdir(), "lfs-assets-"));
  made.push(root);
  if (gitattributes !== undefined) await writeFile(path.join(root, ".gitattributes"), gitattributes);
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(root, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(made.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const ATTRIBUTES = `${TRACKED} filter=lfs diff=lfs merge=lfs -text\n`;

describe("the pointer this exists to catch", () => {
  it("is what git stores for the satellite authority", () => {
    expect(realPointer.startsWith(POINTER_MAGIC)).toBe(true);
    expect(Buffer.byteLength(realPointer)).toBe(134);
    expect(realPointer).toContain("size 124649472");
  });

  it("is recognised as a pointer, and reports what it stands for", async () => {
    const root = await treeOf({ gitattributes: ATTRIBUTES, files: { [TRACKED]: realPointer } });
    const found = await readPointer(path.join(root, TRACKED));
    expect(found).toEqual({
      declaredBytes: 124649472,
      oid: "70b7e9cbc06180960f931edef7533b2bc04426b7e6a42576d3b5eb3e20ee82e4",
    });
  });

  /** The exact CI state: checkout without `lfs: true`. */
  it("fails the audit, naming the cause rather than the symptom", async () => {
    const root = await treeOf({ gitattributes: ATTRIBUTES, files: { [TRACKED]: realPointer } });
    const findings = await auditLfsAssets(root);
    expect(findings).toEqual([
      {
        kind: "pointer",
        entry: TRACKED,
        detail:
          "Git LFS object was not materialised: this is the 134-byte pointer, " +
          "not the 124649472 bytes it stands for",
      },
    ]);
  });
});

describe("a materialised checkout", () => {
  it("passes when the file is real content", async () => {
    const root = await treeOf({
      gitattributes: ATTRIBUTES,
      files: { [TRACKED]: Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4096)]) },
    });
    expect(await auditLfsAssets(root)).toEqual([{ relative: TRACKED, bytes: 4112 }]);
  });

  /* The real working copy, not a fixture: whatever else this suite proves, the
     checkout it runs in has to be a good one. */
  it("passes against this repository's own working tree", async () => {
    const result = await auditLfsAssets(projectRoot);
    expect(result).toEqual([{ relative: TRACKED, bytes: 124649472 }]);
  });

  it("is not fooled by content that merely mentions the spec later on", async () => {
    const body = `SQLite format 3\0${"x".repeat(2000)}${POINTER_MAGIC}\n`;
    const root = await treeOf({ gitattributes: ATTRIBUTES, files: { [TRACKED]: body } });
    const result = await auditLfsAssets(root);
    expect(result[0]).toHaveProperty("bytes");
  });
});

describe("the other ways a checkout goes wrong", () => {
  it("reports a file that is not there at all", async () => {
    const root = await treeOf({ gitattributes: ATTRIBUTES });
    const [finding] = await auditLfsAssets(root);
    expect(finding.kind).toBe("missing");
  });

  it("reports content too small to be real, pointer or not", async () => {
    const root = await treeOf({ gitattributes: ATTRIBUTES, files: { [TRACKED]: "SQLite format 3\0" } });
    const [finding] = await auditLfsAssets(root);
    expect(finding.kind).toBe("implausible");
    expect(IMPLAUSIBLE_BYTES).toBeGreaterThan(Buffer.byteLength(realPointer));
  });

  it("says so when it has nothing to guard", async () => {
    const root = await treeOf({ gitattributes: "*.png binary\n" });
    const [finding] = await auditLfsAssets(root);
    expect(finding.kind).toBe("nothing-tracked");
  });

  it("says so when there is no .gitattributes", async () => {
    const root = await treeOf({});
    const [finding] = await auditLfsAssets(root);
    expect(finding.kind).toBe("no-gitattributes");
  });
});

describe("reading .gitattributes", () => {
  it("finds this repository's tracked path", async () => {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path.join(projectRoot, ".gitattributes"), "utf8");
    expect(readLfsPaths(text)).toEqual([TRACKED]);
  });

  it("takes only the lines routed through the LFS filter", () => {
    expect(
      readLfsPaths("# a comment\n*.png binary\na.bin filter=lfs diff=lfs merge=lfs -text\n\nb.txt text\n"),
    ).toEqual(["a.bin"]);
  });

  /* `filter=lfsomething` is a different filter, and matching it loosely would
     put this check in charge of files nobody routed through LFS. */
  it("does not match a filter that merely starts with lfs", () => {
    expect(readLfsPaths("a.bin filter=lfsx diff=lfsx\n")).toEqual([]);
  });
});
