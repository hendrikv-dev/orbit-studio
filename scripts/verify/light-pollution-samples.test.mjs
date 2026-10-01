import { existsSync, closeSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * The archive's numbers, at places whose relative brightness is not in doubt.
 *
 * ## Why an ordering test rather than expected values
 *
 * There is no second source to check these radiances against: the archive *is*
 * the measurement, resampled. Asserting "Portland reads 12.3" would only record
 * today's output as tomorrow's expectation, and would go red for a legitimate
 * new composite year.
 *
 * What can be asserted without inventing an authority is the shape of the
 * answer. Manhattan is brighter than downtown Portland, which is brighter than
 * a Portland suburb, which is brighter than a small city two hundred miles
 * inland, which is brighter than a town of three thousand, which is brighter
 * than a mountain in the high desert, which reads nothing at all. That ordering
 * is not a matter of taste, and every bug this pipeline has actually had broke
 * it:
 *
 *   - The first derivation read `(r + g) / 2 − b` from a rendered image, which
 *     is zero for white. Manhattan, London and Tokyo — the brightest ground on
 *     Earth — came back as *unlit*. The Manhattan floor below is that bug's
 *     gravestone.
 *   - The first resampler took a nearest neighbour on a summed grid and
 *     returned the wrong cell: Portland read 9.7 where the source says 14.4.
 *     Ordering plus the zoom-independence check below is what catches that
 *     class.
 *
 * ## Why this can skip
 *
 * The blob is generated data and deliberately not in source control; the
 * repository carries the index, the build script, the source URL and the
 * checksum instead. On a machine that has not built it, this suite has nothing
 * to read and says so rather than failing.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX = path.join(projectRoot, "public/tracker/light-pollution-v21-2024.json");
const BLOB = path.join(projectRoot, "public/tracker/light-pollution-v21-2024.bin");
const present = existsSync(INDEX) && existsSync(BLOB);

/**
 * Enough of a PNG reader for the tiles the build script writes.
 *
 * Eight-bit RGB, every filter type, no interlacing — which is what Pillow emits
 * for these. Node has the inflate; the rest is the per-row filter the format
 * defines. A dependency for this would be a dependency for one test.
 */
function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colourType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || colourType !== 2) throw new Error(`unsupported png ${bitDepth}/${colourType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const current = out.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let index = 0; index < stride; index += 1) {
      const a = index >= bpp ? current[index - bpp] : 0;
      const b = previous[index];
      const c = index >= bpp ? previous[index - bpp] : 0;
      let value = line[index];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      current[index] = value & 0xff;
    }
  }
  return { width, pixels: out };
}

const MERCATOR_LIMIT = 85.0511287798066;

function project(latitudeDeg, longitudeDeg) {
  const lat = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, latitudeDeg));
  const lon = ((longitudeDeg + 540) % 360) - 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { x: (lon + 180) / 360, y: (1 - merc / Math.PI) / 2 };
}

/**
 * The same read the browser client performs, in the same order of operations.
 *
 * Kept deliberately independent of `lightPollution.ts` rather than importing
 * it: that module decodes through a canvas, which does not exist here, and a
 * test that shared the client's arithmetic could not catch the client and the
 * archive drifting apart in the same direction.
 */
function reader() {
  const header = JSON.parse(readFileSync(INDEX, "utf8"));
  const fd = openSync(BLOB, "r");
  const at = (latitudeDeg, longitudeDeg, z = header.maxZoom) => {
    const n = 2 ** z;
    const { x, y } = project(latitudeDeg, longitudeDeg);
    const fx = x * n;
    const fy = y * n;
    const entry = header.index[`${z}/${Math.floor(fx)}/${Math.floor(fy)}`];
    if (!entry) return 0;
    const [offset, length] = entry;
    const bytes = Buffer.alloc(length);
    readSync(fd, bytes, 0, length, offset);
    const { width, pixels } = decodePng(bytes);
    const px = Math.min(header.tileSize - 1, Math.floor((fx % 1) * header.tileSize));
    const py = Math.min(header.tileSize - 1, Math.floor((fy % 1) * header.tileSize));
    const index = (py * width + px) * 3;
    return (pixels[index] * 256 + pixels[index + 1]) / header.scale;
  };
  return { header, at, close: () => closeSync(fd) };
}

/** Ordered brightest to darkest, and not by looking at the archive. */
const PLACES = [
  { name: "Manhattan", lat: 40.758, lon: -73.9855, what: "one of the brightest square kilometres on Earth" },
  { name: "Portland downtown", lat: 45.5152, lon: -122.6784, what: "a city centre of 650,000" },
  { name: "Wood Village", lat: 45.5343, lon: -122.419, what: "a suburb on that city's eastern edge" },
  { name: "Bend", lat: 44.0582, lon: -121.3153, what: "a city of 100,000, two hundred miles inland" },
  { name: "Sisters", lat: 44.2907, lon: -121.5495, what: "a town of three thousand" },
  { name: "Steens Mountain", lat: 42.6383, lon: -118.5772, what: "high desert with no settlement in any direction" },
];

describe.skipIf(!present)("the light-pollution archive at named places", () => {
  it("orders them the way the places themselves are ordered", () => {
    const archive = reader();
    try {
      const values = PLACES.map((place) => ({ ...place, radiance: archive.at(place.lat, place.lon) }));
      for (const value of values) {
        expect(Number.isFinite(value.radiance), `${value.name} is a number`).toBe(true);
        expect(value.radiance, `${value.name} is not negative`).toBeGreaterThanOrEqual(0);
      }
      for (let index = 1; index < values.length; index += 1) {
        const brighter = values[index - 1];
        const dimmer = values[index];
        expect(
          brighter.radiance,
          `${brighter.name} (${brighter.what}) should read brighter than ${dimmer.name} (${dimmer.what}), got ${brighter.radiance} and ${dimmer.radiance}`,
        ).toBeGreaterThan(dimmer.radiance);
      }
    } finally {
      archive.close();
    }
  });

  it("does not report the brightest ground on Earth as unlit", () => {
    const archive = reader();
    try {
      // The old colour-derived index returned zero here, because its formula
      // was zero for white and Manhattan saturates. Any floor well above the
      // detection threshold catches that; forty is chosen to be far below the
      // measured value and far above anything a broken derivation produces.
      expect(archive.at(40.758, -73.9855)).toBeGreaterThan(40);
    } finally {
      archive.close();
    }
  });

  it("reads nothing over open ocean", () => {
    const archive = reader();
    try {
      expect(archive.at(45, -134)).toBe(0);
      expect(archive.at(-40, -120)).toBe(0);
    } finally {
      archive.close();
    }
  });

  /**
   * The reading is about the place, not about the view.
   *
   * At zoom 6 the same downtown pixel is averaged with everything within a few
   * kilometres and reads about half. Sampling at the display zoom would make a
   * town's number change as the reader zoomed out of it — which is exactly the
   * failure the old 14 km composite produced, and the reason `at()` is fixed to
   * the archive's finest level.
   */
  it("gives a coarser answer at a coarser zoom, which is why the client never uses one", () => {
    const archive = reader();
    try {
      const fine = archive.at(45.5152, -122.6784, archive.header.maxZoom);
      const coarse = archive.at(45.5152, -122.6784, 6);
      expect(coarse).toBeLessThan(fine);
      expect(coarse).toBeGreaterThan(0);
    } finally {
      archive.close();
    }
  });

  it("is unchanged by which copy of the world the reader is looking at", () => {
    const archive = reader();
    try {
      for (const place of PLACES) {
        const here = archive.at(place.lat, place.lon);
        expect(archive.at(place.lat, place.lon + 360), `${place.name} east`).toBe(here);
        expect(archive.at(place.lat, place.lon - 360), `${place.name} west`).toBe(here);
      }
    } finally {
      archive.close();
    }
  });

  it("stays inside the range the encoding can carry", () => {
    const archive = reader();
    try {
      // Two bytes over a scale of ten: 6553.5 is the ceiling, and a value at it
      // would mean the encoder clipped rather than measured.
      for (const place of PLACES) {
        expect(archive.at(place.lat, place.lon)).toBeLessThan(6553.5);
      }
    } finally {
      archive.close();
    }
  });
});
