#!/usr/bin/env node
/**
 * The light-pollution archive's delivery: check it, publish it, prove it.
 *
 * ## Why the archive is not a static asset
 *
 * It is 47.8 MB of numeric radiance. Cloudflare Pages refuses single assets
 * over 25 MiB, and even where a host accepts it, shipping it inside the
 * deployment bundle means every deploy re-uploads a file that changes once a
 * year. It belongs in object storage, addressed by a versioned name, cached
 * forever, and read a few kilobytes at a time.
 *
 * The reader's browser already asks for it that way: the index names a byte
 * offset and length for every tile that exists, and the map fetches exactly
 * those ranges. That behaviour is unchanged by where the object lives, which is
 * the whole reason this move is a configuration change rather than a rewrite.
 *
 * ## What this script does
 *
 *   --check              the local archive is internally consistent (default)
 *   --steps              the exact commands to publish it, with real values
 *   --verify <base-url>  a published archive is correct, reachable and ranged
 *
 * It deliberately does not hold credentials or call the Cloudflare API. The
 * upload is two `wrangler` commands a maintainer runs against their own
 * account; what a script can usefully do is prove the file is right before it
 * goes and prove it arrived intact afterwards, and that is what this does.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARCHIVE_DIR = path.join(projectRoot, "public/tracker");
const INDEX_NAME = "light-pollution-v21-2024.json";

/** The bucket and prefix the documented steps use; only names, never secrets. */
const BUCKET = "orbit-studio-data";
const PREFIX = "tracker";

function say(ok, message) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${message}`);
  return ok;
}

async function sha256OfFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function readIndex() {
  const indexPath = path.join(ARCHIVE_DIR, INDEX_NAME);
  const header = JSON.parse(await readFile(indexPath, "utf8"));
  return { header, indexPath, blobPath: path.join(ARCHIVE_DIR, header.blob) };
}

/**
 * Everything that can be known without a network: the index parses, the blob is
 * the length the index claims, no tile range runs off the end, and the bytes
 * hash to the digest recorded when the archive was built.
 */
async function check() {
  console.log("Local archive");
  const { header, blobPath } = await readIndex();
  let ok = true;

  ok = say(header.format === "tracker-light-pollution/1", `format ${header.format}`) && ok;
  ok = say(typeof header.blob === "string", `blob named ${header.blob}`) && ok;

  const size = (await stat(blobPath)).size;
  ok = say(size === header.bytes, `blob is ${size} bytes, as the index says`) && ok;

  const entries = Object.entries(header.index);
  ok = say(entries.length === header.tiles, `${entries.length} tiles, as the index says`) && ok;

  let covered = 0;
  let overrun = null;
  for (const [key, [offset, length]] of entries) {
    covered += length;
    if (offset + length > size) overrun = key;
  }
  ok = say(overrun === null, overrun ? `tile ${overrun} runs past the end` : "every tile range lies inside the blob") && ok;
  ok = say(covered === size, `the tiles account for all ${size} bytes with none spare`) && ok;

  if (header.blobSha256) {
    const digest = await sha256OfFile(blobPath);
    ok = say(digest === header.blobSha256, `sha256 matches the recorded digest (${digest.slice(0, 12)}…)`) && ok;
  } else {
    say(false, "the index records no blobSha256 — rebuild with scripts/build-light-pollution-tiles.py");
    ok = false;
  }

  return ok;
}

/** The commands to run, with this archive's real names and sizes filled in. */
async function steps() {
  const { header, indexPath, blobPath } = await readIndex();
  const blobSize = (await stat(blobPath)).size;
  const indexSize = (await stat(indexPath)).size;
  const base = `https://<your-r2-public-domain>/${PREFIX}/`;

  console.log(`
Publishing the archive to Cloudflare R2
=======================================

Two objects, ${(blobSize / 1e6).toFixed(1)} MB and ${(indexSize / 1e6).toFixed(2)} MB, uploaded once per
data release. Their names carry the product version and composite year, so a
new year is a new object and these URLs never need to change or be purged.

1. Create the bucket (once)

   npx wrangler r2 bucket create ${BUCKET}

2. Upload both objects, immutable and correctly typed

   npx wrangler r2 object put ${BUCKET}/${PREFIX}/${header.blob} \\
     --file public/tracker/${header.blob} \\
     --content-type application/octet-stream \\
     --cache-control "public, max-age=31536000, immutable"

   npx wrangler r2 object put ${BUCKET}/${PREFIX}/${INDEX_NAME} \\
     --file public/tracker/${INDEX_NAME} \\
     --content-type application/json \\
     --cache-control "public, max-age=31536000, immutable"

3. Give the bucket a public address

   Either enable the managed r2.dev subdomain, or — better for production —
   connect a custom domain in the bucket's Settings. Both serve HTTP range
   requests; neither needs a credential in the client, because these objects
   are public read-only data.

4. Allow the browser to read ranges cross-origin

   R2 → your bucket → Settings → CORS policy. Range requests need the request
   header allowed *and* Content-Range exposed, or the browser will make the
   request and then hide the answer:

   [
     {
       "AllowedOrigins": ["https://<your-site-domain>"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["Range"],
       "ExposeHeaders": ["Content-Range", "Content-Length", "ETag", "Accept-Ranges"],
       "MaxAgeSeconds": 86400
     }
   ]

5. Point the build at it

   VITE_LIGHT_POLLUTION_BASE=${base}

   Set it in the Pages project's build environment. Unset, the app reads the
   copy in public/tracker/, which is what development uses.

6. Prove it

   node scripts/deploy/light-pollution-archive.mjs --verify ${base}

Nothing above is run by this script and no credential is read by it: the
upload happens under the maintainer's own Cloudflare account.
`);
  return true;
}

/**
 * The published copy, checked the way the browser will use it.
 *
 * A HEAD is not enough. What actually breaks in this setup is ranged reads —
 * a host that answers 200 with the whole 47 MB body instead of 206 with the
 * requested slice, or a CORS policy that omits Content-Range so the browser
 * discards a correct response. So this asks for one real tile's bytes and
 * compares them, byte for byte, with the local copy.
 */
async function verify(base) {
  console.log(`Published archive at ${base}`);
  const root = base.endsWith("/") ? base : `${base}/`;
  const { header: local, blobPath } = await readIndex();
  let ok = true;

  const indexResponse = await fetch(new URL(INDEX_NAME, root));
  ok = say(indexResponse.ok, `index responds ${indexResponse.status}`) && ok;
  if (!indexResponse.ok) return false;
  const remote = await indexResponse.json();
  ok = say(remote.blobSha256 === local.blobSha256, "the published index describes the same archive") && ok;

  const blobUrl = new URL(remote.blob, new URL(INDEX_NAME, root));
  const head = await fetch(blobUrl, { method: "HEAD" });
  ok = say(head.ok, `blob responds ${head.status}`) && ok;
  ok = say(
    head.headers.get("accept-ranges") === "bytes",
    `advertises byte ranges (accept-ranges: ${head.headers.get("accept-ranges") ?? "absent"})`,
  ) && ok;
  ok = say(
    Number(head.headers.get("content-length")) === remote.bytes,
    "is the length the index claims",
  ) && ok;
  const cache = head.headers.get("cache-control") ?? "";
  ok = say(/immutable|max-age=\d{7,}/.test(cache), `is cacheable (${cache || "no cache-control"})`) && ok;

  // A real tile, chosen from the middle of the archive rather than the first
  // byte, because an offset of zero is the one range a broken host gets right.
  const keys = Object.keys(remote.index);
  const key = keys[Math.floor(keys.length / 2)];
  const [offset, length] = remote.index[key];
  const ranged = await fetch(blobUrl, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
  ok = say(
    ranged.status === 206,
    ranged.status === 206
      ? `a ranged read of tile ${key} answers 206 Partial Content`
      : `a ranged read of tile ${key} answered ${ranged.status}, not 206 — the whole ${(remote.bytes / 1e6).toFixed(1)} MB would be fetched for every tile`,
  ) && ok;
  ok = say(
    (ranged.headers.get("access-control-expose-headers") ?? "").toLowerCase().includes("content-range"),
    "and exposes Content-Range to the browser",
  ) && ok;

  const served = Buffer.from(await ranged.arrayBuffer());
  const expected = Buffer.alloc(length);
  const handle = await (await import("node:fs/promises")).open(blobPath, "r");
  await handle.read(expected, 0, length, offset);
  await handle.close();
  ok = say(served.equals(expected), `and returns exactly the ${length} bytes the local archive holds`) && ok;

  return ok;
}

const [command = "--check", argument] = process.argv.slice(2);
let ok;
if (command === "--steps") ok = await steps();
else if (command === "--verify") {
  if (!argument) {
    console.error("--verify needs the archive's public base URL");
    process.exit(2);
  }
  ok = await verify(argument);
} else ok = await check();

if (!ok) {
  console.log("\nFAILED");
  process.exitCode = 1;
} else if (command !== "--steps") {
  console.log("\nPASS");
}
