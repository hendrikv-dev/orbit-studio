/**
 * Did Git LFS actually hand over the files, or just the notes promising them?
 *
 * ## Why this exists
 *
 * `data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite` is the
 * satellite authority: 124,649,472 bytes of SQLite, tracked through Git LFS.
 * What git stores in its place is a 134-byte pointer:
 *
 *   version https://git-lfs.github.com/spec/v1
 *   oid sha256:70b7e9cbc06180960f931edef7533b2bc04426b7e6a42576d3b5eb3e20ee82e4
 *   size 124649472
 *
 * `actions/checkout` does not fetch LFS content unless asked — its `lfs` input
 * defaults to false — so CI was checking out the pointer and running the whole
 * suite against it. The failure surfaced several minutes later, inside the
 * catalogue verification, as:
 *
 *   VERIFY FAILED: Size mismatch for data/orbit-studio-satellites.sqlite:
 *   134 != 124649472
 *
 * which is a true sentence about a database that was never there, and reads
 * like a corrupt authority rather than a checkout that skipped a step.
 *
 * ## What this is, and is not
 *
 * This is a diagnosis, not a verification. `data/satellite-source-of-truth/
 * scripts/verify.py` already checks every artefact's size and SHA-256 against
 * `manifest.json` and `CHECKSUMS.sha256`, and that remains the authority on
 * whether the database is the right database. This only answers the question
 * that has to be answered first, and answers it in seconds rather than minutes:
 * is the file the content, or the pointer to it?
 *
 * The paths come from `.gitattributes` rather than being listed here, so an
 * asset that becomes LFS-tracked later is covered the day it is tracked.
 */
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The first line of every pointer file, from the Git LFS spec. */
export const POINTER_MAGIC = "version https://git-lfs.github.com/spec/v1";

/**
 * Small enough that nothing real is this size.
 *
 * A pointer is around 130 bytes. The floor is deliberately far above that and
 * far below any asset worth tracking in LFS, so it catches a truncated or empty
 * materialisation without pretending to know how big any particular file is —
 * that is the manifest's job.
 */
export const IMPLAUSIBLE_BYTES = 1024;

/** Every path `.gitattributes` routes through the LFS filter. */
export function readLfsPaths(gitattributes) {
  const paths = [];
  for (const raw of gitattributes.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!/(^|\s)filter=lfs(\s|$)/.test(line)) continue;
    /* The pattern is the first field; the attributes follow it. Quoted paths
       are a git-attributes feature this repository does not use, but stripping
       the quotes costs nothing and avoids a silently missed file. */
    const pattern = line.split(/\s+/)[0].replace(/^"(.*)"$/, "$1");
    if (pattern) paths.push(pattern);
  }
  return paths;
}

/** Is this file the pointer rather than the thing pointed at? */
export async function readPointer(filePath) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(POINTER_MAGIC.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < POINTER_MAGIC.length) return null;
    if (buffer.toString("utf8") !== POINTER_MAGIC) return null;
  } finally {
    await handle.close();
  }
  /* It is a pointer, so it is small and worth reading whole: the size it
     declares is what the error message should quote. */
  const text = await readFile(filePath, "utf8");
  const size = text.match(/^size (\d+)$/m);
  const oid = text.match(/^oid sha256:([0-9a-f]{64})$/m);
  return { declaredBytes: size ? Number(size[1]) : null, oid: oid ? oid[1] : null };
}

/** What is wrong with the LFS assets under `root`, as sentences about CI. */
export async function auditLfsAssets(root) {
  const gitattributes = await readFile(path.join(root, ".gitattributes"), "utf8").catch(() => null);
  if (gitattributes === null) {
    return [{ kind: "no-gitattributes", entry: ".gitattributes", detail: "cannot tell which files are LFS-tracked" }];
  }

  const tracked = readLfsPaths(gitattributes);
  if (tracked.length === 0) {
    return [{ kind: "nothing-tracked", entry: ".gitattributes", detail: "no path is routed through the LFS filter, so this check has nothing to stand guard over" }];
  }

  const findings = [];
  const materialised = [];
  for (const relative of tracked) {
    const full = path.join(root, relative);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) {
      findings.push({ kind: "missing", entry: relative, detail: "the file is not in the working tree at all" });
      continue;
    }

    const pointer = await readPointer(full);
    if (pointer) {
      findings.push({
        kind: "pointer",
        entry: relative,
        detail:
          `Git LFS object was not materialised: this is the ${info.size}-byte pointer, ` +
          `not the ${pointer.declaredBytes ?? "?"} bytes it stands for`,
      });
      continue;
    }

    if (info.size < IMPLAUSIBLE_BYTES) {
      findings.push({
        kind: "implausible",
        entry: relative,
        detail: `${info.size} bytes is too small to be the real asset, though it is not a pointer either`,
      });
      continue;
    }

    materialised.push({ relative, bytes: info.size });
  }

  return findings.length > 0 ? findings : materialised;
}

async function main() {
  const result = await auditLfsAssets(projectRoot);
  const ok = result.every((entry) => "bytes" in entry);
  if (ok) {
    console.log(
      `[lfs] PASS ${result.length} tracked ${result.length === 1 ? "asset" : "assets"} materialised: ` +
        result.map((e) => `${e.relative} (${e.bytes.toLocaleString("en-US")} bytes)`).join(", "),
    );
    return;
  }

  console.error("[lfs] Git LFS content is missing from this checkout:");
  for (const finding of result) console.error(`- ${finding.kind}:${finding.entry} — ${finding.detail}`);
  console.error(
    "\nIn CI, `actions/checkout` needs `lfs: true`; its `lfs` input defaults to false. " +
      "Locally, `git lfs pull` materialises them. The catalogue verification that runs later " +
      "would report this as a size or checksum mismatch against manifest.json, which describes " +
      "the symptom rather than the cause.",
  );
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
