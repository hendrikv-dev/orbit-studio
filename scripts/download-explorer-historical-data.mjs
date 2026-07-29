import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const includeSatcat = !args.includes("--no-satcat");
const includeGpHistory =
  args.includes("--gp-history") || process.env.SPACE_TRACK_INCLUDE_GP_HISTORY === "1";
const includeGcat = args.includes("--gcat") || Boolean(process.env.GCAT_SOURCE_URLS);
const rawDirectory = resolve(
  valueForFlag("--out") ?? process.env.HISTORICAL_RAW_DIR ?? "data/historical-catalog/raw",
);

const spaceTrackBaseUrl = process.env.SPACE_TRACK_BASE_URL ?? "https://www.space-track.org";
const satcatQueryPath =
  process.env.SPACE_TRACK_SATCAT_QUERY_PATH ??
  "/basicspacedata/query/class/satcat/format/json";

function valueForFlag(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileMetadata(path) {
  const buffer = await readFile(path);
  return {
    path,
    byteLength: buffer.byteLength,
    checksum: `sha256:${sha256Buffer(buffer)}`,
  };
}

function cookieHeader(headers) {
  const setCookie =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie")]
        : [];
  return setCookie.map((cookie) => cookie.split(";")[0]).join("; ");
}

function absoluteSpaceTrackUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${spaceTrackBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function spaceTrackLogin() {
  const identity = process.env.SPACE_TRACK_USERNAME;
  const password = process.env.SPACE_TRACK_PASSWORD;
  if (!identity || !password) {
    throw new Error(
      "SPACE_TRACK_USERNAME and SPACE_TRACK_PASSWORD are required for Space-Track acquisition.",
    );
  }

  const body = new URLSearchParams({ identity, password });
  const response = await fetch(`${spaceTrackBaseUrl}/ajaxauth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Space-Track login failed with HTTP ${response.status}.`);
  }

  const cookie = cookieHeader(response.headers);
  if (!cookie) throw new Error("Space-Track login did not return an authentication cookie.");
  return cookie;
}

async function downloadToFile({ url, destinationPath, headers = {}, forceDownload = false }) {
  await mkdir(dirname(destinationPath), { recursive: true });

  if (!forceDownload) {
    try {
      await stat(destinationPath);
      return { ...await fileMetadata(destinationPath), status: "cached" };
    } catch {
      // Continue with download.
    }
  }

  const partialPath = `${destinationPath}.part`;
  let partialSize = 0;
  try {
    partialSize = (await stat(partialPath)).size;
  } catch {
    partialSize = 0;
  }

  const requestHeaders = { ...headers };
  if (partialSize > 0) requestHeaders.Range = `bytes=${partialSize}-`;

  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Download failed for ${url} with HTTP ${response.status}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (partialSize > 0 && response.status === 206) {
    const handle = await open(partialPath, "a");
    await handle.write(buffer);
    await handle.close();
  } else {
    await writeFile(partialPath, buffer);
  }

  await rename(partialPath, destinationPath);
  return { ...await fileMetadata(destinationPath), status: "downloaded" };
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

function gpHistoryQueryPaths() {
  if (process.env.SPACE_TRACK_GP_HISTORY_QUERY_PATH) {
    return [
      {
        path: process.env.SPACE_TRACK_GP_HISTORY_QUERY_PATH,
        fileName: process.env.SPACE_TRACK_GP_HISTORY_FILE ?? "space-track-gp-history.json",
      },
    ];
  }

  const start = process.env.SPACE_TRACK_GP_HISTORY_START;
  const end = process.env.SPACE_TRACK_GP_HISTORY_END;
  if (!start || !end) {
    throw new Error(
      "GP History download requires SPACE_TRACK_GP_HISTORY_QUERY_PATH or SPACE_TRACK_GP_HISTORY_START and SPACE_TRACK_GP_HISTORY_END.",
    );
  }

  const chunkDays = Math.max(1, Number(process.env.SPACE_TRACK_GP_HISTORY_CHUNK_DAYS ?? "30"));
  const paths = [];
  let chunkStart = new Date(`${start}T00:00:00.000Z`);
  const finalEnd = new Date(`${end}T00:00:00.000Z`);

  while (chunkStart <= finalEnd) {
    const chunkEnd = new Date(Math.min(addDays(chunkStart, chunkDays - 1).getTime(), finalEnd.getTime()));
    const range = `${ymd(chunkStart)}--${ymd(chunkEnd)}`;
    const noradFilter = process.env.SPACE_TRACK_GP_HISTORY_NORAD_CAT_ID
      ? `/NORAD_CAT_ID/${encodeURIComponent(process.env.SPACE_TRACK_GP_HISTORY_NORAD_CAT_ID)}`
      : "";
    paths.push({
      path: `/basicspacedata/query/class/gp_history${noradFilter}/EPOCH/${encodeURIComponent(range)}/orderby/NORAD_CAT_ID,EPOCH/format/json`,
      fileName: `space-track-gp-history-${ymd(chunkStart)}_${ymd(chunkEnd)}.json`,
    });
    chunkStart = addDays(chunkEnd, 1);
  }

  return paths;
}

async function downloadSpaceTrackSources() {
  if (!includeSatcat && !includeGpHistory) return [];

  const cookie = await spaceTrackLogin();
  const headers = {
    cookie,
    "user-agent": "Orbit Studio historical catalog acquisition",
  };
  const downloads = [];

  if (includeSatcat) {
    downloads.push({
      id: "space-track-satcat",
      family: "space-track",
      role: "satcat",
      license: "Space-Track account terms",
      url: absoluteSpaceTrackUrl(satcatQueryPath),
      destinationPath: join(rawDirectory, "space-track-satcat.json"),
      headers,
    });
  }

  if (includeGpHistory) {
    for (const query of gpHistoryQueryPaths()) {
      downloads.push({
        id: `space-track-gp-history:${query.fileName}`,
        family: "space-track",
        role: "orbit-history",
        license: "Space-Track account terms",
        url: absoluteSpaceTrackUrl(query.path),
        destinationPath: join(rawDirectory, query.fileName),
        headers,
      });
    }
  }

  return downloads;
}

function gcatDownloads() {
  if (!includeGcat) return [];
  const urls = (process.env.GCAT_SOURCE_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return urls.map((url, index) => {
    const fileName = process.env.GCAT_FILE_NAME ?? `gcat-${index + 1}.txt`;
    return {
      id: `gcat:${fileName}`,
      family: "gcat",
      role: "metadata",
      license: "GCAT redistribution terms must be confirmed before committing artifacts",
      url,
      destinationPath: join(rawDirectory, fileName),
      headers: { "user-agent": "Orbit Studio historical catalog acquisition" },
    };
  });
}

async function main() {
  await mkdir(rawDirectory, { recursive: true });

  const downloads = [
    ...await downloadSpaceTrackSources(),
    ...gcatDownloads(),
  ];

  const manifestEntries = [];
  for (const download of downloads) {
    const result = await downloadToFile({
      url: download.url,
      destinationPath: download.destinationPath,
      headers: download.headers,
      forceDownload: force,
    });
    manifestEntries.push({
      id: download.id,
      family: download.family,
      role: download.role,
      license: download.license,
      url: download.url,
      fileName: download.destinationPath.split("/").pop(),
      byteLength: result.byteLength,
      checksum: result.checksum,
      status: result.status,
    });
    console.log(`${result.status}: ${download.destinationPath}`);
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rawDirectory,
    sources: manifestEntries,
  };
  await writeFile(
    join(rawDirectory, "space-track-download-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  try {
    await unlink(join(rawDirectory, "space-track-download-manifest.json.part"));
  } catch {
    // Best-effort cleanup only.
  }
}
