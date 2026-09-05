import { cellFor, type FixedGrid } from "../../src/data/tracker/goesGrid.ts";

/**
 * NOAA's cloud classification, subset to what was asked for.
 *
 * ## Why this exists at all
 *
 * The GOES cloud mask is distributed two ways and each is missing the half a
 * browser needs. The raw netCDF on object storage sets permissive CORS headers
 * but is HDF5, so reading one pixel means parsing fractal heaps and chunk
 * indexes in the client. The THREDDS server will subset it — a constrained DAP4
 * request for a handful of pixels comes back in a few kilobytes — and sends no
 * CORS headers at all, so a browser cannot read the reply.
 *
 * This closes that gap and nothing else. It asks for exactly the pixels the
 * caller asked for, decodes the reply, and hands back the values NOAA
 * published. It does not resample, average, smooth, or reinterpret them.
 *
 * ## What it will not do
 *
 * **Downsample a reading.** A request for a place returns the native pixel
 * covering that place, with the classification, the probability, the quality
 * flag and the observation time as distributed.
 *
 * **Average for the map.** A request for an area is subsampled by stride when
 * the pixels are finer than anything that could be drawn — every value returned
 * is still a real pixel NOAA published, never a mean of several. As the caller
 * zooms in the stride falls to one, and beyond that there is nothing finer to
 * ask for.
 */

const THREDDS = "https://thredds.ucar.edu/thredds";

/** GOES-West is nearer the sub-point for anything west of about 105° W. */
export function satelliteFor(longitudeDeg: number): "east" | "west" {
  const lon = ((((longitudeDeg + 180) % 360) + 360) % 360) - 180;
  return lon <= -105 || lon > 155 ? "west" : "east";
}

interface Granule {
  path: string;
  /** From the file name: the start of the scan, to the tenth of a second. */
  startedUtc: string;
}

/**
 * The scan start encoded in every ABI file name.
 *
 * `s20262460726172` is year 2026, day 246, 07:26:17.2 UTC. Taking it from the
 * name rather than from inside the file means the catalogue alone is enough to
 * choose a granule, which is one request instead of one per candidate.
 */
export function startedAt(name: string): string | null {
  const match = /_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)/.exec(name);
  if (!match) return null;
  const [, year, day, hour, minute, second, tenth] = match;
  const at = new Date(Date.UTC(Number(year), 0, 1, Number(hour), Number(minute), Number(second)));
  at.setUTCDate(at.getUTCDate() + Number(day) - 1);
  at.setUTCMilliseconds(Number(tenth) * 100);
  return at.toISOString();
}

async function catalogue(satellite: "east" | "west"): Promise<Granule[]> {
  const url = `${THREDDS}/catalog/satellite/goes/${satellite}/products/CloudMask/CONUS/current/catalog.xml`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`catalogue ${response.status}`);
  const body = await response.text();
  const granules: Granule[] = [];
  for (const match of body.matchAll(/urlPath="([^"]+)"/g)) {
    const path = match[1];
    const startedUtc = startedAt(path.split("/").pop() ?? "");
    if (startedUtc) granules.push({ path, startedUtc });
  }
  granules.sort((a, b) => a.startedUtc.localeCompare(b.startedUtc));
  return granules;
}

/* ------------------------------------------------------------------ DMR */

export interface Metadata {
  grid: FixedGrid;
  probabilityScale: number;
  observedUtc: string;
  platform: string;
  scene: string;
  resolution: string;
}

const attribute = (scope: string, name: string): string | null => {
  const match = new RegExp(
    `<Attribute name="${name}"[^>]*>\\s*<Value value="([^"]*)"`,
    "s",
  ).exec(scope);
  return match ? match[1] : null;
};

function variable(dmr: string, name: string): string {
  const match = new RegExp(`<(\\w+) name="${name}">(.*?)</\\1>`, "s").exec(dmr);
  return match ? match[2] : "";
}

/**
 * Every constant this needs, taken from the granule rather than remembered.
 *
 * GOES-East and GOES-West sit over different longitudes, the scene windows
 * differ, and the grid has been redefined before. Reading it each time costs
 * one request per granule and removes a whole class of silently-wrong answers.
 */
export function readMetadata(dmr: string): Metadata {
  const projection = variable(dmr, "goes_imager_projection");
  const x = variable(dmr, "x");
  const y = variable(dmr, "y");
  const dimension = (name: string) => {
    const match = new RegExp(`<Dimension name="${name}" size="(\\d+)"`).exec(dmr);
    return match ? Number(match[1]) : 0;
  };
  const probability = variable(dmr, "Cloud_Probabilities");

  return {
    grid: {
      originLongitudeDeg: Number(attribute(projection, "longitude_of_projection_origin")),
      perspectiveHeightM: Number(attribute(projection, "perspective_point_height")),
      semiMajorM: Number(attribute(projection, "semi_major_axis")),
      semiMinorM: Number(attribute(projection, "semi_minor_axis")),
      xOffsetRad: Number(attribute(x, "add_offset")),
      xScaleRad: Number(attribute(x, "scale_factor")),
      yOffsetRad: Number(attribute(y, "add_offset")),
      yScaleRad: Number(attribute(y, "scale_factor")),
      columns: dimension("x"),
      rows: dimension("y"),
    },
    probabilityScale: Number(attribute(probability, "scale_factor")),
    observedUtc: attribute(dmr, "time_coverage_start") ?? "",
    platform: attribute(dmr, "platform_ID") ?? "",
    scene: attribute(dmr, "scene_id") ?? "",
    resolution: attribute(dmr, "spatial_resolution") ?? "",
  };
}

/** Warm invocations reuse a granule's metadata; a granule never changes. */
const metadataCache = new Map<string, Metadata>();

async function metadataFor(path: string): Promise<Metadata> {
  const cached = metadataCache.get(path);
  if (cached) return cached;
  const response = await fetch(`${THREDDS}/dap4/${path}.dmr.xml`);
  if (!response.ok) throw new Error(`metadata ${response.status}`);
  const read = readMetadata(await response.text());
  if (metadataCache.size > 32) metadataCache.clear();
  metadataCache.set(path, read);
  return read;
}

/* ----------------------------------------------------------------- DAP4 */

/**
 * The response is a run of chunks: one byte of flags, three of length, then the
 * body. The first carries the DMR; the rest are the values, little-endian
 * unless the flags say otherwise.
 */
export function chunks(buffer: Uint8Array): { dmr: string; data: Uint8Array; bigEndian: boolean } {
  let at = 0;
  let dmr = "";
  const parts: Uint8Array[] = [];
  let bigEndian = false;
  while (at + 4 <= buffer.length) {
    const flags = buffer[at];
    const length = (buffer[at + 1] << 16) | (buffer[at + 2] << 8) | buffer[at + 3];
    at += 4;
    const body = buffer.subarray(at, at + length);
    at += length;
    if (flags & 0x04) dmr = new TextDecoder().decode(body);
    else {
      parts.push(body);
      if (flags & 0x02) bigEndian = true;
    }
    if (flags & 0x01) break;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const data = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return { dmr, data, bigEndian };
}

interface Window {
  row0: number;
  row1: number;
  column0: number;
  column1: number;
  stride: number;
}

function sizeOf(window: Window) {
  return {
    height: Math.floor((window.row1 - window.row0) / window.stride) + 1,
    width: Math.floor((window.column1 - window.column0) / window.stride) + 1,
  };
}

async function values(path: string, window: Window) {
  const range = (from: number, to: number) => `[${from}:${window.stride}:${to}]`;
  const span = `${range(window.row0, window.row1)}${range(window.column0, window.column1)}`;
  const ce = ["/ACM", "/Cloud_Probabilities", "/DQF"].map((name) => `${name}${span}`).join(";");
  const response = await fetch(`${THREDDS}/dap4/${path}.dap?dap4.ce=${encodeURIComponent(ce)}`);
  if (!response.ok) throw new Error(`values ${response.status}`);
  const { data, bigEndian } = chunks(new Uint8Array(await response.arrayBuffer()));

  const { width, height } = sizeOf(window);
  const count = width * height;
  if (data.length < count * 4) throw new Error("short response");
  const acm = Array.from(data.subarray(0, count));
  const view = new DataView(data.buffer, data.byteOffset + count, count * 2);
  const probability = Array.from({ length: count }, (_, index) =>
    view.getUint16(index * 2, !bigEndian),
  );
  const dqf = Array.from(data.subarray(count * 3, count * 4));
  return { acm, probability, dqf, width, height };
}

/**
 * Map over a list a few at a time, keeping the order of the results.
 *
 * Exported because the batching is the part that has to be right: it is what
 * keeps a series request from turning into two dozen simultaneous hits on
 * somebody else's free service.
 */
export async function inBatches<T, R>(
  items: readonly T[],
  width: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += width) {
    results.push(...(await Promise.all(items.slice(start, start + width).map(run))));
  }
  return results;
}

/* ----------------------------------------------------------------- entry */

/**
 * How fine to ask, given how much of the world is on screen.
 *
 * Stride one wherever the window is small enough to return whole; otherwise the
 * smallest stride that keeps the reply to the requested number of cells. Every
 * value is still a pixel NOAA published — a stride skips pixels, it does not
 * average them, so nothing local is smeared into a mean before it arrives.
 */
export function strideFor(rows: number, columns: number, cells: number): number {
  let stride = 1;
  while (Math.ceil(rows / stride) * Math.ceil(columns / stride) > cells * cells) stride += 1;
  return stride;
}

export default async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        // One scan every five minutes, so a minute of caching is a free
        // request saved and never a stale frame.
        "cache-control": "public, max-age=60",
      },
    });

  try {
    const at = url.searchParams.get("at");
    const bbox = url.searchParams.get("bbox");
    const wanted = url.searchParams.get("time");

    const longitude = at
      ? Number(at.split(",")[1])
      : bbox
        ? (Number(bbox.split(",")[1]) + Number(bbox.split(",")[3])) / 2
        : NaN;
    if (!Number.isFinite(longitude)) return json({ error: "at or bbox is required" }, 400);

    const satellite = satelliteFor(longitude);
    const granules = await catalogue(satellite);
    if (granules.length === 0) return json({ error: "no granules published" }, 502);

    if (url.searchParams.get("frames") === "1") {
      // The observation times themselves, so a timeline can be built without
      // fetching any of them.
      return json({
        satellite: satellite === "east" ? "GOES-East" : "GOES-West",
        times: granules.map((granule) => granule.startedUtc),
      });
    }

    const granule = wanted
      ? granules.reduce((best, candidate) =>
          Math.abs(Date.parse(candidate.startedUtc) - Date.parse(wanted)) <
          Math.abs(Date.parse(best.startedUtc) - Date.parse(wanted))
            ? candidate
            : best,
        )
      : granules[granules.length - 1];

    const meta = await metadataFor(granule.path);
    const head = {
      satellite: satellite === "east" ? "GOES-East" : "GOES-West",
      platform: meta.platform,
      scene: meta.scene,
      product: "ABI-L2-ACMC (Clear Sky Mask)",
      resolution: meta.resolution,
      observedUtc: meta.observedUtc || granule.startedUtc,
      probabilityScale: meta.probabilityScale,
    };

    if (at && url.searchParams.get("series") === "1") {
      const [latitude, longitudeDeg] = at.split(",").map(Number);
      /**
       * One place, several observation times, in one request.
       *
       * The warning layer needs persistence — whether cloud stayed rather than
       * whether it was there in the frame the reader happened to load — and
       * that means several granules. Asking for them one at a time would be a
       * round trip each, so the walk over granules happens here, where they are
       * already catalogued and the DAP4 subsets are a few bytes apiece.
       *
       * Bounded on purpose. Each frame is two upstream fetches, and a function
       * that walks an unbounded catalogue is a timeout waiting for a quiet day.
       */
      const count = Math.min(12, Math.max(1, Number(url.searchParams.get("count")) || 6));
      const chosen = granules.slice(-count);
      /**
       * Three at a time, not all at once.
       *
       * Each frame is two upstream requests, so a `Promise.all` over a dozen
       * granules is two dozen simultaneous hits on a free academic service —
       * which is what Unidata's usage policy asks consumers not to do, and what
       * this repository's own provenance entry promises we will not. Three
       * keeps the walk to a couple of seconds without ever looking like a
       * crawler.
       */
      const frames = await inBatches(chosen, 3, async (candidate) => {
        try {
          const meta = await metadataFor(candidate.path);
          const cell = cellFor(meta.grid, latitude, longitudeDeg);
          if (!cell) return { observedUtc: meta.observedUtc || candidate.startedUtc, covered: false };
          const read = await values(candidate.path, {
            row0: cell.row,
            row1: cell.row,
            column0: cell.column,
            column1: cell.column,
            stride: 1,
          });
          return {
            observedUtc: meta.observedUtc || candidate.startedUtc,
            covered: true,
            cell,
            acm: read.acm[0],
            cloudProbabilityRaw: read.probability[0],
            dqf: read.dqf[0],
            probabilityScale: meta.probabilityScale,
          };
        } catch {
          // One granule failing is a gap in the series, not the end of it:
          // the timeline can show a hole where a scan is missing, and a
          // warning built on the rest is still worth more than none.
          return null;
        }
      });
      const meta = await metadataFor(chosen[chosen.length - 1].path);
      return json({
        satellite: satellite === "east" ? "GOES-East" : "GOES-West",
        platform: meta.platform,
        scene: meta.scene,
        product: "ABI-L2-ACMC (Clear Sky Mask)",
        resolution: meta.resolution,
        probabilityScale: meta.probabilityScale,
        frames: frames.filter(Boolean),
      });
    }

    if (at) {
      const [latitude, longitudeDeg] = at.split(",").map(Number);
      const cell = cellFor(meta.grid, latitude, longitudeDeg);
      if (!cell) return json({ ...head, covered: false }, 200);
      // Native resolution, always: a reading is never subsampled.
      const read = await values(granule.path, {
        row0: cell.row,
        row1: cell.row,
        column0: cell.column,
        column1: cell.column,
        stride: 1,
      });
      return json({
        ...head,
        covered: true,
        cell,
        acm: read.acm[0],
        cloudProbabilityRaw: read.probability[0],
        dqf: read.dqf[0],
      });
    }

    const [south, west, north, east] = bbox!.split(",").map(Number);
    /**
     * The part of the view this scene actually covers, not all or nothing.
     *
     * A CONUS scene is a window on the disc, so a map showing the whole country
     * and some ocean either side has corners outside it. Requiring all four to
     * resolve reported the continental view as uncovered — which is the one
     * view a reader is most likely to start from. Sampling a grid of points
     * across the box and keeping the ones that land inside gives the covered
     * sub-region, and the caller is told which region it got.
     */
    const probes: { row: number; column: number }[] = [];
    for (let a = 0; a <= 4; a += 1) {
      for (let b = 0; b <= 4; b += 1) {
        const cell = cellFor(
          meta.grid,
          south + ((north - south) * a) / 4,
          west + ((east - west) * b) / 4,
        );
        if (cell) probes.push(cell);
      }
    }
    if (probes.length === 0) return json({ ...head, covered: false }, 200);

    const rows = probes.map((probe) => probe.row);
    const columns = probes.map((probe) => probe.column);
    const window: Window = {
      row0: Math.max(0, Math.min(...rows)),
      row1: Math.min(meta.grid.rows - 1, Math.max(...rows)),
      column0: Math.max(0, Math.min(...columns)),
      column1: Math.min(meta.grid.columns - 1, Math.max(...columns)),
      stride: 1,
    };
    const cells = Math.max(16, Math.min(220, Number(url.searchParams.get("cells")) || 120));
    window.stride = strideFor(
      window.row1 - window.row0 + 1,
      window.column1 - window.column0 + 1,
      cells,
    );
    const read = await values(granule.path, window);
    return json({
      ...head,
      covered: true,
      grid: meta.grid,
      window,
      width: read.width,
      height: read.height,
      acm: read.acm,
      cloudProbabilityRaw: read.probability,
      dqf: read.dqf,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "unavailable" }, 502);
  }
};

export const config = { path: "/api/goes-cloud-mask" };
