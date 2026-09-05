import { TERRAIN } from "./terrainSource";

/**
 * Elevation samples, fetched and decoded from Mapterhorn's DEM tiles.
 *
 * ## Why this exists rather than reading the rendered map
 *
 * MapLibre can be asked the elevation under a point, and the answer is only as
 * good as what is currently loaded for the current viewport. A horizon looks
 * sixty kilometres in a direction the reader may not be looking at, at a zoom
 * they are not at. Querying the rendered surface would give a terrain profile
 * that changed when the map moved, which is not a property terrain has.
 *
 * So the analytical path fetches its own tiles, decodes them, and caches them.
 * It shares nothing with the display terrain except the source.
 *
 * ## Why not maplibre-contour
 *
 * It is a good library for what it is for — generating contour lines — and
 * carries a worker, a tile cache and a Terrarium decoder to get there. Tracker
 * needs the decoder and the cache and nothing else, and Terrarium decoding is
 * one line. Taking the library would mean a dependency, its provenance, and a
 * contour engine nothing calls, to avoid writing about eighty lines. The
 * decision is recorded here rather than left implicit.
 *
 * ## Terrarium
 *
 *     elevation = (R * 256 + G + B / 256) − 32768   metres
 *
 * Exact, not approximate: the encoding is a fixed-point representation and
 * every byte carries signal.
 */

const TILE_PIXELS = 512;

interface DecodedTile {
  /** Elevation per pixel, row-major, metres. */
  data: Float32Array;
  size: number;
}

/** In-flight and completed tiles, keyed `z/x/y`. */
const cache = new Map<string, Promise<DecodedTile | null>>();

/**
 * How many tiles to keep.
 *
 * A horizon looks across roughly a degree, which is a handful of tiles at the
 * zoom this reads. Two hundred covers several selected locations without the
 * decoded arrays adding up to anything a browser minds — each is a megabyte,
 * so this is a deliberate ceiling rather than an accident.
 */
const CACHE_LIMIT = 200;

function evictIfNeeded() {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

async function loadTile(z: number, x: number, y: number): Promise<DecodedTile | null> {
  const key = `${z}/${x}/${y}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<DecodedTile | null> => {
    const url = TERRAIN.tileUrl
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    try {
      /**
       * Bounded, because an unanswered tile must not hang the card.
       *
       * Without this, one slow or stalled request left the expanded card saying
       * "checking the terrain horizon" for as long as the reader was willing to
       * look at it — a worse outcome than saying the terrain is unknown, which
       * is at least true and takes eight seconds to establish.
       */
      /**
       * Twenty seconds, because a sightline is megabytes.
       *
       * A single tile answers in under half a second; twenty of them, queued
       * behind the browser's per-host connection limit, do not. At eight
       * seconds the tail of the batch timed out every time and the card
       * reported no terrain data for ground that had loaded perfectly well —
       * a bound tight enough to manufacture the failure it was meant to report.
       */
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return null;
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const elevations = new Float32Array(canvas.width * canvas.height);
      for (let index = 0; index < elevations.length; index += 1) {
        elevations[index] =
          data[index * 4] * 256 + data[index * 4 + 1] + data[index * 4 + 2] / 256 - 32768;
      }
      return { data: elevations, size: canvas.width };
    } catch {
      // A tile that times out must not stay cached as a failure for the whole
      // session: the next attempt should be allowed to succeed. And a tile that
      // will not load is a missing sample, not a zero — everything downstream
      // distinguishes the two.
      cache.delete(key);
      return null;
    }
  })();

  cache.set(key, promise);
  evictIfNeeded();
  return promise;
}

function tileOf(latitudeDeg: number, longitudeDeg: number, zoom: number) {
  const n = 2 ** zoom;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitudeDeg));
  // Wrapped first, so a bearing that ran past the antimeridian addresses the
  // tile that actually holds that ground rather than one off the end.
  const lon = ((longitudeDeg + 540) % 360) - 180;
  const xFloat = ((lon + 180) / 360) * n;
  const yFloat =
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return {
    x: Math.min(n - 1, Math.max(0, Math.floor(xFloat))),
    y: Math.min(n - 1, Math.max(0, Math.floor(yFloat))),
    fx: xFloat - Math.floor(xFloat),
    fy: yFloat - Math.floor(yFloat),
  };
}

export interface ElevationReader {
  /** Metres above sea level, or null where the DEM has nothing. */
  at: (latitudeDeg: number, longitudeDeg: number) => number | null;
  /** How many of the requested tiles actually loaded. */
  loaded: number;
  requested: number;
}

/**
 * Fetch every tile a set of points needs, then hand back a synchronous reader.
 *
 * Two phases on purpose. The horizon algorithm is synchronous and testable with
 * a plain function; making it await per sample would turn a tight loop into
 * hundreds of promises and would interleave network latency with arithmetic.
 * So the caller says which points it will want, this fetches the distinct tiles
 * behind them in parallel, and the algorithm then runs against memory.
 */
export async function readElevations(
  points: { latitudeDeg: number; longitudeDeg: number }[],
  zoom = TERRAIN.maxZoom,
  signal?: AbortSignal,
): Promise<ElevationReader> {
  const needed = new Map<string, { z: number; x: number; y: number }>();
  for (const point of points) {
    const { x, y } = tileOf(point.latitudeDeg, point.longitudeDeg, zoom);
    needed.set(`${zoom}/${x}/${y}`, { z: zoom, x, y });
  }

  /**
   * A few at a time, not all at once.
   *
   * A sightline needs a couple of dozen tiles and firing every fetch and decode
   * together does not make them arrive sooner: the browser caps connections per
   * host anyway, and the simultaneous `createImageBitmap` calls behind them
   * were enough to stall the whole batch — the requests went out, and the
   * promises never came back. Six in flight keeps the pipe full and the decoder
   * out of trouble.
   */
  const tiles = new Map<string, DecodedTile | null>();
  const queue = [...needed.entries()];
  /**
   * Four, measured against the service rather than picked.
   *
   * Mapterhorn's public tiles are a quarter of a megabyte each and it throttles
   * under load: twenty-one at once returned eleven inside twenty seconds. Four
   * keeps every request answered.
   */
  const CONCURRENCY = 4;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next || signal?.aborted) return;
        const [key, { z, x, y }] = next;
        tiles.set(key, await loadTile(z, x, y));
      }
    }),
  );

  const loaded = [...tiles.values()].filter(Boolean).length;

  return {
    requested: needed.size,
    loaded,
    at(latitudeDeg, longitudeDeg) {
      const { x, y, fx, fy } = tileOf(latitudeDeg, longitudeDeg, zoom);
      const tile = tiles.get(`${zoom}/${x}/${y}`);
      if (!tile) return null;
      const size = tile.size || TILE_PIXELS;
      const column = Math.min(size - 1, Math.max(0, Math.floor(fx * size)));
      const row = Math.min(size - 1, Math.max(0, Math.floor(fy * size)));
      const value = tile.data[row * size + column];
      // Terrarium's floor is −32768; anything at it is nodata rather than a
      // trench thirty kilometres deep.
      return Number.isFinite(value) && value > -20000 ? value : null;
    },
  };
}

/** Drop everything cached. Used by tests, and when the source changes. */
export function clearDemCache() {
  cache.clear();
}
