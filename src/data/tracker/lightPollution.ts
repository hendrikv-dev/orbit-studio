/**
 * Artificial night-time light, read from EOG's VIIRS composite at its own
 * resolution.
 *
 * ## What this measures, and what it does not
 *
 * The quantity is upward radiance in nW/cm²/sr: how much light the VIIRS
 * day-night band sees coming off the ground, averaged over a year of cloud-free
 * night-time passes. It is a measurement of the ground, taken from orbit.
 *
 * It is emphatically **not** a sky-brightness model. Turning upward radiance
 * into what a person standing there can see overhead requires modelling how
 * that light scatters through the atmosphere above them, which depends on
 * aerosol load, humidity, altitude and the light's spectrum and angle. Tracker
 * has no such model, so it does not produce a Bortle class, an SQM reading, or
 * a limiting magnitude, and it does not tell anyone which objects they will be
 * able to see. Those are all claims about the sky; this is a fact about the
 * ground, and the bands below say so in those terms.
 *
 * ## Why this file was rewritten
 *
 * It used to derive a relative index from NASA's Black Marble *rendered image*
 * at 2048×966 — roughly 14 km per pixel. Two things were wrong with that. The
 * derivation read colour rather than radiance and inverted at the top of its
 * range, so saturated city centres reported zero. And even once fixed, 14 km is
 * coarser than a city: Bend, Oregon, population 100,000, occupied no pixel of
 * its own and was reported as dark. A light-pollution layer that cannot resolve
 * a city is not giving a coarse answer to "what can I see from here", it is
 * giving a wrong one.
 *
 * What replaces it is the measurement itself at 15 arc-seconds — about 500 m —
 * carried as radiance in a tile archive, so nothing between the published
 * product and the reader's screen has to guess.
 */

/** Where the vendored archive and its index live, relative to the site root. */
export const LIGHT_POLLUTION_INDEX = "/tracker/light-pollution-v21-2024.json";

/**
 * The credit the map shows while this layer is on.
 *
 * A condition of the data's CC BY 4.0 licence rather than a courtesy, which is
 * why it names the group and links their product page rather than saying
 * "satellite data". It is attached to the layer's own source, so it appears
 * when the reader turns the layer on and goes when they turn it off.
 */
export const LIGHT_POLLUTION_ATTRIBUTION =
  'Night lights <a href="https://eogdata.mines.edu/products/vnl/" target="_blank" rel="noopener">© Earth Observation Group, Colorado School of Mines</a> (VIIRS VNL V2.1, CC BY 4.0)';

/** Radiance below this is indistinguishable from the composite's noise floor. */
export const DETECTION_FLOOR = 0.25;

interface ArchiveHeader {
  tileSize: number;
  maxZoom: number;
  scale: number;
  blob: string;
  index: Record<string, [number, number]>;
}

export interface LightPollutionArchive {
  readonly tileSize: number;
  readonly maxZoom: number;
  /** Decoded radiance for one tile, or null where the archive holds none. */
  tile: (z: number, x: number, y: number) => Promise<Float32Array | null>;
  /** Radiance at a point, from the finest tile that covers it. */
  at: (latitudeDeg: number, longitudeDeg: number) => Promise<number>;
}

const MERCATOR_LIMIT = 85.0511287798066;

/** Normalised Web Mercator coordinates, both in 0–1. */
function project(latitudeDeg: number, longitudeDeg: number): { x: number; y: number } {
  const lat = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, latitudeDeg));
  const lon = ((longitudeDeg + 540) % 360) - 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { x: (lon + 180) / 360, y: (1 - merc / Math.PI) / 2 };
}

/**
 * Open the archive: fetch its index once, then serve tiles by range request.
 *
 * The index is about 400 KB and names every tile that exists. Holding it means
 * a tile that is *absent* costs nothing to discover — and most of the planet is
 * absent, because only 2.6% of the source's valid pixels carry any light. A
 * missing tile is therefore an answer, not a failure: it means no artificial
 * light was detected anywhere in it.
 */
export async function loadLightPollution(
  indexUrl = LIGHT_POLLUTION_INDEX,
): Promise<LightPollutionArchive> {
  const response = await fetch(indexUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`light pollution index ${response.status}`);
  const header = (await response.json()) as ArchiveHeader;
  const blobUrl = new URL(header.blob, new URL(indexUrl, location.href)).toString();

  /**
   * Decoded tiles, kept for the session.
   *
   * Bounded because a reader who pans across a continent at zoom 8 can touch a
   * lot of tiles, and each decodes to 256 KB of Float32. Two hundred is roughly
   * four screenfuls, which covers panning back and forth over one region
   * without re-fetching.
   */
  const cache = new Map<string, Promise<Float32Array | null>>();
  const LIMIT = 200;

  const tile = (z: number, x: number, y: number): Promise<Float32Array | null> => {
    const key = `${z}/${x}/${y}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const entry = header.index[key];
    if (!entry) return Promise.resolve(null);

    const pending = (async () => {
      try {
        const [offset, length] = entry;
        const tileResponse = await fetch(blobUrl, {
          headers: { Range: `bytes=${offset}-${offset + length - 1}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (!tileResponse.ok) return null;
        const bitmap = await createImageBitmap(await tileResponse.blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        const values = new Float32Array(canvas.width * canvas.height);
        for (let index = 0; index < values.length; index += 1) {
          // Red is the high byte, green the low; see the build script for why
          // the value is split rather than stored as a single 16-bit channel.
          values[index] = (data[index * 4] * 256 + data[index * 4 + 1]) / header.scale;
        }
        return values;
      } catch {
        // A tile that failed to load is unknown, not dark, so it must not stay
        // cached as a zero for the rest of the session.
        cache.delete(key);
        return null;
      }
    })();

    if (cache.size >= LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, pending);
    return pending;
  };

  return {
    tileSize: header.tileSize,
    maxZoom: header.maxZoom,
    tile,
    /**
     * Always read at the archive's finest zoom, whatever the map is showing.
     *
     * The reading is about the place, not about the view. Sampling at the
     * display zoom would make a town's reading change as the reader zoomed out
     * of it, which is exactly the failure the coarse composite produced.
     */
    at: async (latitudeDeg, longitudeDeg) => {
      const z = header.maxZoom;
      const n = 2 ** z;
      const { x, y } = project(latitudeDeg, longitudeDeg);
      const fx = x * n;
      const fy = y * n;
      const grid = await tile(z, Math.floor(fx), Math.floor(fy));
      if (!grid) return 0;
      const size = header.tileSize;
      const px = Math.min(size - 1, Math.floor((fx % 1) * size));
      const py = Math.min(size - 1, Math.floor((fy % 1) * size));
      return grid[py * size + px] ?? 0;
    },
  };
}

/**
 * The bands, and why they are where they are.
 *
 * Radiance here spans four orders of magnitude — the detection floor is a
 * quarter of a nW/cm²/sr and a city core reaches several thousand — so the
 * bands step by factors of four rather than by equal increments. Equal steps on
 * a quantity like this would put every inhabited place on Earth in one band and
 * leave four bands describing city centres.
 *
 * The boundaries are round numbers on that log scale, chosen before looking at
 * where any particular town fell, and they are stated here so the classification
 * can be checked rather than trusted: 0.25, 1, 4, 16 and 64 nW/cm²/sr.
 *
 * The wording describes how much light there is, not what kind of place it is.
 * An earlier draft named settlement types — "a town or a city's outskirts" —
 * and put downtown Portland in it at 12.3 nW, which is a claim about land use
 * that a radiance cannot support. What the number supports is a comparison of
 * brightness, so that is what the words do.
 *
 * None of it says what will be visible overhead either. That would need a
 * sky-brightness model Tracker does not have, and the difference matters: the
 * same radiance under dry desert air and under humid coastal air produce
 * noticeably different skies.
 */
export interface LightPollutionBand {
  id: string;
  label: string;
  detail: string;
}

const BANDS: { min: number; band: LightPollutionBand }[] = [
  {
    min: 64,
    band: {
      id: "very-high",
      label: "Very high",
      detail: "Among the brightest ground the satellite records anywhere.",
    },
  },
  {
    min: 16,
    band: {
      id: "high",
      label: "High",
      detail: "Dense, continuous lighting at the level of a major city's core.",
    },
  },
  {
    min: 4,
    band: {
      id: "moderate",
      label: "Moderate",
      detail: "Substantial continuous lighting, across a city or a large town.",
    },
  },
  {
    min: 1,
    band: {
      id: "low",
      label: "Low",
      detail: "Scattered or peripheral lighting, well below a city's core.",
    },
  },
  {
    min: DETECTION_FLOOR,
    band: {
      id: "very-low",
      label: "Very low",
      detail: "Barely above the detection floor: isolated or intermittent light.",
    },
  },
];

const UNLIT: LightPollutionBand = {
  id: "none",
  label: "No detected light",
  detail: "The satellite records no artificial light on the ground here.",
};

/** Which band a radiance falls in. Deterministic, and the boundaries are above. */
export function describeLightPollution(radiance: number): LightPollutionBand {
  for (const { min, band } of BANDS) if (radiance >= min) return band;
  return UNLIT;
}

/**
 * Where a radiance sits on the drawn ramp, from 0 to 1.
 *
 * Logarithmic for the same reason the bands are, and anchored to the same two
 * numbers: the detection floor is the bottom of the ramp and the top band's
 * threshold is the top of it. Everything brighter than that clamps, because the
 * difference between a bright city and a very bright one is not something the
 * reader needs the map to distinguish.
 */
export function lightPollutionRamp(radiance: number): number {
  if (radiance < DETECTION_FLOOR) return 0;
  const span = Math.log(64 / DETECTION_FLOOR);
  return Math.min(1, Math.log(radiance / DETECTION_FLOOR) / span);
}
