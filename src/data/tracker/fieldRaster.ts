/**
 * Continuous geographic fields, drawn as images rather than as polygons.
 *
 * ## Why one primitive
 *
 * Aurora probability, eclipse coverage, lunar visibility and meteor potential
 * are all the same shape of thing: a value sampled on a coarse latitude and
 * longitude grid, to be shown as a continuous surface. Drawn as one polygon per
 * cell they are tens of thousands of features with hard edges the underlying
 * quantity does not have; drawn as one image they are a single texture the
 * renderer scales for free.
 *
 * ## What smoothing does and does not claim
 *
 * Interpolation between published cells never produces a value outside the
 * range of the cells around it, and no code reads a number back out of this
 * image. Every panel reading is computed at the exact coordinate from the same
 * model that produced the grid. The picture is smoothed; the claim is not.
 *
 * ## Why the image is written in Mercator
 *
 * MapLibre maps an image source linearly between its corner coordinates in
 * *projected* space. A canvas written with latitude proportional to row would
 * be stretched wrongly towards the poles — by tens of degrees at high latitude,
 * which for an auroral oval is the whole subject.
 */

export const MERCATOR_LIMIT_DEG = 85.0511287798066;

export function mercatorY(latitudeDeg: number): number {
  const φ = (latitudeDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + φ / 2));
}

export function inverseMercatorY(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

/** A colour, or null where there is nothing to say about this point. */
export type FieldColour = [number, number, number, number] | null;

export interface FieldRasterOptions {
  width?: number;
  height?: number;
  /**
   * Fade the top and bottom edges of the image out over this many pixels.
   *
   * Mercator cannot show the poles, so an image that carries real data all the
   * way to its own edge ends in a dead-straight horizontal line at 85°. That
   * line is an artefact of the projection and reads as a boundary in the data,
   * which is exactly the wrong thing for a field whose subject — the auroral
   * oval — lives up there. Fading says "the map ends here" instead.
   */
  poleFadePx?: number;
}

/**
 * Render a sampled field to a data URL.
 *
 * `sample` is called per pixel with a real latitude and longitude and should
 * interpolate its own grid; returning null leaves the pixel transparent, which
 * is how a field says "no data here" rather than "zero here".
 */
export function rasteriseField(
  sample: (latitudeDeg: number, longitudeDeg: number) => FieldColour,
  { width = 1024, height = 512, poleFadePx = 10 }: FieldRasterOptions = {},
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(width, height);
  const topY = mercatorY(MERCATOR_LIMIT_DEG);
  const bottomY = mercatorY(-MERCATOR_LIMIT_DEG);

  for (let row = 0; row < height; row += 1) {
    const y = topY + ((bottomY - topY) * (row + 0.5)) / height;
    const latitudeDeg = inverseMercatorY(y);
    const edgeFade =
      poleFadePx <= 0
        ? 1
        : Math.min(1, Math.min(row, height - 1 - row) / poleFadePx);
    for (let column = 0; column < width; column += 1) {
      const longitudeDeg = -180 + (360 * (column + 0.5)) / width;
      const colour = sample(latitudeDeg, longitudeDeg);
      const offset = (row * width + column) * 4;
      if (!colour) {
        image.data[offset + 3] = 0;
        continue;
      }
      image.data[offset] = colour[0];
      image.data[offset + 1] = colour[1];
      image.data[offset + 2] = colour[2];
      image.data[offset + 3] = Math.round(colour[3] * edgeFade);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Bilinear interpolation over a regular grid, wrapping in longitude.
 *
 * `at` returns the published value for a whole-degree cell. Wrapping matters:
 * without it the seam at ±180 gets a column of cells interpolated against
 * nothing, which is a visible vertical line straight down a field that has no
 * such feature.
 */
export function bilinear(
  at: (latitudeDeg: number, longitudeDeg: number) => number,
  latitudeDeg: number,
  longitudeDeg: number,
  stepDeg = 1,
): number {
  const lat0 = Math.floor(latitudeDeg / stepDeg) * stepDeg;
  const lon0 = Math.floor(longitudeDeg / stepDeg) * stepDeg;
  const fLat = (latitudeDeg - lat0) / stepDeg;
  const fLon = (longitudeDeg - lon0) / stepDeg;
  const v00 = at(lat0, lon0);
  const v10 = at(lat0, lon0 + stepDeg);
  const v01 = at(lat0 + stepDeg, lon0);
  const v11 = at(lat0 + stepDeg, lon0 + stepDeg);
  const top = v00 + (v10 - v00) * fLon;
  const bottom = v01 + (v11 - v01) * fLon;
  return top + (bottom - top) * fLat;
}

/** The world's corners, which is the extent every one of these fields covers. */
export const FIELD_BOUNDS: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [-180, MERCATOR_LIMIT_DEG],
  [180, MERCATOR_LIMIT_DEG],
  [180, -MERCATOR_LIMIT_DEG],
  [-180, -MERCATOR_LIMIT_DEG],
];


/* ------------------------------------------------------- as map tiles ---- */

/**
 * The same fields, served to MapLibre as raster tiles.
 *
 * ## Why not one image
 *
 * An image source is the obvious way to put a global field on a map and it has
 * one disqualifying limitation: it renders only in the canonical world. With
 * world copies on — which Tracker needs, because the Pacific is one place — the
 * basemap repeats east and west and the overlay does not, so panning past the
 * antimeridian showed geography with no aurora, no twilight and no eclipse over
 * it. Adding copies of the source at ±360 does not help; they load and are
 * never drawn.
 *
 * Raster *tiles* repeat, because wrapping is what tile coordinates do. So the
 * field is served through a custom protocol instead: MapLibre asks for
 * `z/x/y` like any other raster source, and the handler renders that tile from
 * the sampler. Tiles are cached by the renderer, only visible ones are ever
 * asked for, and the whole thing is MapLibre-native rather than a second
 * drawing system bolted alongside it.
 */

export const FIELD_PROTOCOL = "trackerfield";

/** Registered samplers, by the key their tile URLs carry. */
const FIELDS = new Map<string, (latitudeDeg: number, longitudeDeg: number) => FieldColour>();

/**
 * Fields that come as tiles rather than as a function of position.
 *
 * Every other field here is a formula — twilight, an aurora nowcast, an
 * eclipse's coverage — evaluated per pixel at whatever resolution the tile
 * needs. Light pollution is not a formula, it is 15 arc-second measurements in
 * an archive, and a synchronous `sample(lat, lon)` cannot go and fetch them.
 *
 * So a tile field renders a whole tile at once and may await. It uses the same
 * protocol, the same raster source and the same palette treatment as the
 * others; only the way it gets its numbers differs.
 */
const TILE_FIELDS = new Map<
  string,
  (z: number, x: number, y: number) => Promise<Uint8ClampedArray<ArrayBuffer> | null>
>();

export function setTileField(
  key: string,
  render: (z: number, x: number, y: number) => Promise<Uint8ClampedArray<ArrayBuffer> | null>,
): number {
  TILE_FIELDS.set(key, render);
  const version = (VERSIONS.get(key) ?? 0) + 1;
  VERSIONS.set(key, version);
  return version;
}

/** Bumped whenever a field's data changes, to bust the renderer's tile cache. */
const VERSIONS = new Map<string, number>();

export function setField(
  key: string,
  sample: (latitudeDeg: number, longitudeDeg: number) => FieldColour,
): number {
  FIELDS.set(key, sample);
  const version = (VERSIONS.get(key) ?? 0) + 1;
  VERSIONS.set(key, version);
  return version;
}

export function clearFieldSampler(key: string) {
  FIELDS.delete(key);
  TILE_FIELDS.delete(key);
}

/** The URL template a raster source uses for a field. */
export function fieldTileUrl(key: string, version: number): string {
  return `${FIELD_PROTOCOL}://${key}/${version}/{z}/{x}/{y}`;
}

const TILE_SIZE = 256;

/** Web Mercator tile bounds, as the latitudes and longitudes they cover. */
function tileBounds(z: number, x: number, y: number) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northY = Math.PI * (1 - (2 * y) / n);
  const southY = Math.PI * (1 - (2 * (y + 1)) / n);
  return { west, east, northY, southY };
}

/**
 * Render one tile of a registered field.
 *
 * Exported for the protocol handler and for tests, which is the only reason it
 * is not a closure: a tile renderer that cannot be called directly can only be
 * checked through a live map.
 */
export async function renderFieldTile(
  key: string,
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer | null> {
  const sample = FIELDS.get(key);
  const tiled = TILE_FIELDS.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  if (tiled) {
    const pixels = await tiled(z, x, y);
    // Null is "nothing here", which for a sparse archive is the common case and
    // is drawn as a fully transparent tile rather than as an error.
    if (pixels) {
      context.putImageData(new ImageData(pixels, TILE_SIZE, TILE_SIZE), 0, 0);
    }
  } else if (sample) {
    const image = context.createImageData(TILE_SIZE, TILE_SIZE);
    const { west, east, northY, southY } = tileBounds(z, x, y);
    for (let row = 0; row < TILE_SIZE; row += 1) {
      const mercY = northY + ((southY - northY) * (row + 0.5)) / TILE_SIZE;
      // The same inverse the image path uses, expressed for a tile's own span.
      const latitudeDeg = ((2 * Math.atan(Math.exp(mercY)) - Math.PI / 2) * 180) / Math.PI;
      for (let column = 0; column < TILE_SIZE; column += 1) {
        const longitudeDeg = west + ((east - west) * (column + 0.5)) / TILE_SIZE;
        // Wrapped, because a tile east of the antimeridian carries a longitude
        // past 180 and every sampler is written in ordinary coordinates.
        const wrapped = ((longitudeDeg + 540) % 360) - 180;
        const colour = sample(latitudeDeg, wrapped);
        const offset = (row * TILE_SIZE + column) * 4;
        if (!colour) {
          image.data[offset + 3] = 0;
          continue;
        }
        image.data[offset] = colour[0];
        image.data[offset + 1] = colour[1];
        image.data[offset + 2] = colour[2];
        image.data[offset + 3] = colour[3];
      }
    }
    context.putImageData(image, 0, 0);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? blob.arrayBuffer() : null;
}

/** Wire the protocol into MapLibre. Safe to call more than once. */
let registered = false;
export function registerFieldProtocol(
  addProtocol: (
    scheme: string,
    handler: (params: { url: string }) => Promise<{ data: ArrayBuffer | null }>,
  ) => void,
) {
  if (registered) return;
  registered = true;
  addProtocol(FIELD_PROTOCOL, async ({ url }) => {
    // trackerfield://<key>/<version>/<z>/<x>/<y>
    const parts = url.replace(`${FIELD_PROTOCOL}://`, "").split("/");
    const key = parts[0];
    const [z, x, y] = parts.slice(2).map(Number);
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) return { data: null };
    return { data: await renderFieldTile(key, z, x, y) };
  });
}
