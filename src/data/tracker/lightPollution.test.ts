import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DETECTION_FLOOR,
  describeLightPollution,
  lightPollutionRamp,
  loadLightPollution,
} from "./lightPollution";

/**
 * The archive client, against a deterministic range-capable fake.
 *
 * ## Why this is a fake rather than the real object
 *
 * The archive is 47.8 MB and, in production, lives in an R2 bucket. A test that
 * fetched it would be slow, would depend on somebody's Cloudflare account
 * staying funded, and would go red for reasons that have nothing to do with
 * this code. What has to be true of the client is testable without any of that:
 * that it asks for exactly the bytes the index names, that it decodes them the
 * way the build script encoded them, that an absent tile costs no request, and
 * that a failure is a failure rather than a zero.
 *
 * So the server is a function over a byte array, and it honours `Range` the way
 * R2 does — 206 with the requested slice — while recording every request. The
 * checks about the *deployed* object (206 rather than 200, `Content-Range`
 * exposed to the browser, CORS, immutability) belong to
 * `scripts/deploy/light-pollution-archive.mjs --verify`, because they are facts
 * about a bucket's configuration and cannot be asserted from here.
 */

const TILE_SIZE = 2;
const SCALE = 10;

/** One tile's worth of pixels, as the encoder writes them: red hi, green lo. */
function encodeTile(values: number[]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    const raw = Math.round(value * SCALE);
    pixels[index * 4] = Math.floor(raw / 256);
    pixels[index * 4 + 1] = raw % 256;
    pixels[index * 4 + 3] = 255;
  });
  return pixels;
}

/**
 * A fixture archive: a blob of "PNGs" and an index naming each one's slice.
 *
 * The tile payloads are not real PNGs — decoding one would need a codec and a
 * canvas, neither of which exists in this environment, and neither of which is
 * this client's code. Each payload is a distinct marker, and the fake
 * `createImageBitmap` below maps a marker back to the pixels it stands for,
 * which is exactly the boundary the browser would cross.
 */
function buildArchive() {
  const tiles: { key: string; values: number[] }[] = [
    { key: "8/40/91", values: [0.5, 2.5, 12, 240] },
    { key: "8/40/92", values: [0, 0.1, 1, 6553.5] },
    { key: "7/20/44", values: [1, 1, 1, 1] },
  ];

  const parts: Uint8Array[] = [];
  const index: Record<string, [number, number]> = {};
  const pixelsFor = new Map<string, Uint8ClampedArray>();
  let offset = 0;

  tiles.forEach((tile, position) => {
    // A payload whose length differs per tile, so a client that ignored the
    // recorded length and guessed a fixed stride would be caught.
    const payload = new Uint8Array(8 + position * 3).fill(position + 1);
    parts.push(payload);
    index[tile.key] = [offset, payload.length];
    pixelsFor.set(String(position + 1), encodeTile(tile.values));
    offset += payload.length;
  });

  const blob = new Uint8Array(offset);
  let cursor = 0;
  for (const part of parts) {
    blob.set(part, cursor);
    cursor += part.length;
  }

  return {
    blob,
    pixelsFor,
    header: {
      format: "tracker-light-pollution/1",
      tileSize: TILE_SIZE,
      maxZoom: 8,
      encoding: "rgb8-hi-lo-png",
      scale: SCALE,
      blob: "fixture.bin",
      bytes: offset,
      tiles: tiles.length,
      index,
    },
  };
}

interface Recorded {
  url: string;
  range: string | null;
}

/**
 * Install the browser surface the client uses: fetch, canvas, and a location to
 * resolve the blob's relative name against.
 */
function install(
  archive: ReturnType<typeof buildArchive>,
  overrides: { indexStatus?: number; blobStatus?: number; failWith?: Error } = {},
) {
  const requests: Recorded[] = [];

  const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
    requests.push({ url: String(url), range });
    if (overrides.failWith) throw overrides.failWith;

    if (String(url).endsWith(".json")) {
      const status = overrides.indexStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => archive.header,
      } as unknown as Response;
    }

    const status = overrides.blobStatus ?? 206;
    const match = /bytes=(\d+)-(\d+)/.exec(range ?? "");
    const slice = match
      ? archive.blob.slice(Number(match[1]), Number(match[2]) + 1)
      : archive.blob;
    return {
      ok: status >= 200 && status < 300,
      status,
      blob: async () => slice,
    } as unknown as Response;
  });

  vi.stubGlobal("fetch", fetchStub);
  vi.stubGlobal("location", { href: "https://example.invalid/map" });
  // The bitmap stands for its payload; the first byte identifies which tile.
  vi.stubGlobal("createImageBitmap", async (payload: Uint8Array) => ({
    marker: String(payload[0]),
    width: TILE_SIZE,
    height: TILE_SIZE,
    close() {},
  }));
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => {
        let drawn: string | null = null;
        return {
          drawImage: (bitmap: { marker: string }) => {
            drawn = bitmap.marker;
          },
          getImageData: () => ({
            data: archive.pixelsFor.get(drawn ?? "") ?? new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4),
          }),
        };
      },
    }),
  });

  return { requests, fetchStub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the light-pollution archive client", () => {
  it("reads the index once and resolves the blob beside it", async () => {
    const archive = buildArchive();
    const { requests } = install(archive);

    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    expect(opened.tileSize).toBe(TILE_SIZE);
    expect(opened.maxZoom).toBe(8);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://example.invalid/tracker/index.json");

    await opened.tile(8, 40, 91);
    // Relative to the index, not to the page: this is what lets the archive
    // move to a bucket without the client knowing.
    expect(requests[1].url).toBe("https://example.invalid/tracker/fixture.bin");
  });

  it("asks for exactly the byte interval the index names", async () => {
    const archive = buildArchive();
    const { requests } = install(archive);
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    await opened.tile(8, 40, 92);

    const [offset, length] = archive.header.index["8/40/92"];
    expect(requests[1].range).toBe(`bytes=${offset}-${offset + length - 1}`);
  });

  it("decodes the hi/lo encoding back into radiance", async () => {
    const archive = buildArchive();
    install(archive);
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    const tile = await opened.tile(8, 40, 91);

    expect(Array.from(tile!)).toEqual([0.5, 2.5, 12, 240]);
  });

  it("carries the full range of the encoding without clipping", async () => {
    const archive = buildArchive();
    install(archive);
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    const tile = await opened.tile(8, 40, 92);

    // 65535/10 is the largest value the two bytes can hold, and a city core
    // reaches several thousand, so the top of the range has to survive intact.
    expect(tile![3]).toBe(6553.5);
    expect(tile![0]).toBe(0);
  });

  it("keeps a decoded tile rather than fetching it again", async () => {
    const archive = buildArchive();
    const { requests } = install(archive);
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    await opened.tile(8, 40, 91);
    await opened.tile(8, 40, 91);

    expect(requests.filter((request) => request.range !== null)).toHaveLength(1);
  });

  it("answers an absent tile without asking for it", async () => {
    const archive = buildArchive();
    const { requests } = install(archive);
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    // Most of the planet is absent from the archive, because most of it has no
    // detected light. That has to be free, not a request that 404s.
    expect(await opened.tile(8, 1, 1)).toBeNull();
    expect(requests.filter((request) => request.range !== null)).toHaveLength(0);
  });

  it("refuses to open when the index cannot be read", async () => {
    const archive = buildArchive();
    install(archive, { indexStatus: 404 });

    await expect(loadLightPollution("https://example.invalid/tracker/index.json")).rejects.toThrow(
      /404/,
    );
  });

  it("refuses an archive whose format it does not understand", async () => {
    const archive = buildArchive();
    archive.header.format = "tracker-light-pollution/2";
    install(archive);

    // Not a hypothetical: the encoding, the scale and the offset semantics are
    // all agreements between this file and the build script, and none of them
    // is visible in the numbers. A format bump has to stop the client rather
    // than let it decode a later layout into plausible wrong radiances.
    await expect(loadLightPollution("https://example.invalid/tracker/index.json")).rejects.toThrow(
      /format tracker-light-pollution\/2/,
    );
  });

  it("refuses to open when the network fails outright", async () => {
    const archive = buildArchive();
    install(archive, { failWith: new TypeError("Failed to fetch") });

    await expect(loadLightPollution("https://example.invalid/tracker/index.json")).rejects.toThrow(
      /Failed to fetch/,
    );
  });

  /**
   * A tile that failed is unknown, not dark.
   *
   * The distinction is the whole point of this layer: a zero here would be
   * rendered as "no artificial light detected", which is a measurement, and
   * a dropped request is not one. It must also not stay cached as a zero, or
   * one bad moment would fix that answer for the rest of the session.
   */
  it("does not remember a failed tile as darkness", async () => {
    const archive = buildArchive();
    const { requests } = install(archive, { blobStatus: 500 });
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    expect(await opened.tile(8, 40, 91)).toBeNull();
    expect(await opened.tile(8, 40, 91)).toBeNull();
    expect(requests.filter((request) => request.range !== null)).toHaveLength(2);
  });

  it("reads a point at the archive's finest zoom, whatever the map is showing", async () => {
    const archive = buildArchive();
    const { requests } = install(archive);
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    // 8/40/91 is the zoom-8 tile Troutdale, Oregon falls in.
    await opened.at(45.54, -122.4);

    const [offset] = archive.header.index["8/40/91"];
    expect(requests[1].range?.startsWith(`bytes=${offset}-`)).toBe(true);
  });

  it("gives the same reading for a longitude and its wrapped copy", async () => {
    const archive = buildArchive();
    install(archive);
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    const here = await opened.at(45.54, -122.4);
    const wrapped = await opened.at(45.54, -122.4 + 360);
    const wrappedTwice = await opened.at(45.54, -122.4 - 360);

    expect(wrapped).toBe(here);
    expect(wrappedTwice).toBe(here);
  });

  it("reads zero where the archive holds nothing, and says so in words", async () => {
    const archive = buildArchive();
    install(archive);
    const opened = await loadLightPollution("https://example.invalid/tracker/index.json");

    const remote = await opened.at(-40, 20);

    expect(remote).toBe(0);
    expect(describeLightPollution(remote).label).toBe("No detected light");
  });
});

describe("the ramp the map and the legend share", () => {
  it("starts at the detection floor and saturates at the top band", () => {
    expect(lightPollutionRamp(DETECTION_FLOOR / 2)).toBe(0);
    expect(lightPollutionRamp(DETECTION_FLOOR)).toBe(0);
    expect(lightPollutionRamp(64)).toBe(1);
    expect(lightPollutionRamp(6000)).toBe(1);
  });

  /**
   * The legend draws its ticks at the band thresholds, so the ramp and the
   * bands have to agree about where those thresholds fall. They step by factors
   * of four across a logarithmic ramp, which is why the ticks come out evenly
   * spaced — and that even spacing is what this asserts.
   */
  it("places the band thresholds evenly, because they are all one factor apart", () => {
    const stops = [DETECTION_FLOOR, 1, 4, 16, 64].map(lightPollutionRamp);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index] - stops[index - 1]).toBeCloseTo(0.25, 6);
    }
  });

  it("names each band from the radiance alone", () => {
    expect(describeLightPollution(0).label).toBe("No detected light");
    expect(describeLightPollution(0.3).label).toBe("Very low");
    expect(describeLightPollution(2).label).toBe("Low");
    expect(describeLightPollution(8).label).toBe("Moderate");
    expect(describeLightPollution(30).label).toBe("High");
    expect(describeLightPollution(200).label).toBe("Very high");
  });
});
