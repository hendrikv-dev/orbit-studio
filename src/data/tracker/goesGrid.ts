/**
 * The GOES-R ABI fixed grid, and what its cloud mask means.
 *
 * ## Why this is shared
 *
 * Two things have to agree about which pixel covers a place: the proxy that
 * asks NOAA for it, and the map that draws the answer. If they each carried
 * their own geolocation they would disagree at the edges of pixels, which is
 * exactly where a cloud boundary is. So the arithmetic lives here and both
 * import it, and the constants come from the granule rather than from memory —
 * GOES-East and GOES-West sit over different longitudes and the grid has been
 * changed before.
 *
 * ## The projection
 *
 * Geostationary: the satellite sees the Earth as a disc and addresses it by two
 * scan angles rather than by a map projection. Converting a latitude and
 * longitude into a pixel is the standard inverse from the GOES-R Product User
 * Guide, and it can fail — a point over the horizon from the spacecraft has no
 * pixel at all, which is a real answer and not an error.
 */

export interface FixedGrid {
  /** Sub-satellite longitude, in degrees. */
  originLongitudeDeg: number;
  /** Height of the satellite above the ellipsoid, in metres. */
  perspectiveHeightM: number;
  semiMajorM: number;
  semiMinorM: number;
  /** Scan angle of column zero, in radians, and the step between columns. */
  xOffsetRad: number;
  xScaleRad: number;
  /** The same down the rows. Negative, because row zero is the top. */
  yOffsetRad: number;
  yScaleRad: number;
  columns: number;
  rows: number;
}

export interface GridCell {
  column: number;
  row: number;
}

const DEG = Math.PI / 180;

/**
 * Which pixel covers this place, or null where the spacecraft cannot see it.
 *
 * The visibility test is the one from the Product User Guide and it matters:
 * without it the arithmetic returns a perfectly plausible pixel for somewhere
 * over the horizon, on the far side of the Earth from the satellite.
 */
export function cellFor(grid: FixedGrid, latitudeDeg: number, longitudeDeg: number): GridCell | null {
  const H = grid.perspectiveHeightM + grid.semiMajorM;
  const req = grid.semiMajorM;
  const rpol = grid.semiMinorM;
  const e2 = (req * req - rpol * rpol) / (req * req);

  const latitude = latitudeDeg * DEG;
  const difference = (longitudeDeg - grid.originLongitudeDeg) * DEG;
  // Geocentric latitude, which is what the geometry below is in terms of.
  const geocentric = Math.atan(((rpol * rpol) / (req * req)) * Math.tan(latitude));
  const rc = rpol / Math.sqrt(1 - e2 * Math.cos(geocentric) * Math.cos(geocentric));

  const sx = H - rc * Math.cos(geocentric) * Math.cos(difference);
  const sy = -rc * Math.cos(geocentric) * Math.sin(difference);
  const sz = rc * Math.sin(geocentric);

  // Over the horizon from the spacecraft: there is no pixel, not a wrong one.
  if (H * (H - sx) < sy * sy + ((req * req) / (rpol * rpol)) * sz * sz) return null;

  // Sweep angle axis "x", which is what every ABI product uses.
  const y = Math.atan(sz / sx);
  const x = Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz));

  const column = Math.round((x - grid.xOffsetRad) / grid.xScaleRad);
  const row = Math.round((y - grid.yOffsetRad) / grid.yScaleRad);
  if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) return null;
  return { column, row };
}

/** Where a pixel's centre actually is, which is what the map draws it at. */
export function placeOf(grid: FixedGrid, cell: GridCell): { latitudeDeg: number; longitudeDeg: number } | null {
  const H = grid.perspectiveHeightM + grid.semiMajorM;
  const req = grid.semiMajorM;
  const rpol = grid.semiMinorM;

  const x = grid.xOffsetRad + cell.column * grid.xScaleRad;
  const y = grid.yOffsetRad + cell.row * grid.yScaleRad;

  const sinx = Math.sin(x);
  const cosx = Math.cos(x);
  const siny = Math.sin(y);
  const cosy = Math.cos(y);

  const a = sinx * sinx + cosx * cosx * (cosy * cosy + ((req * req) / (rpol * rpol)) * siny * siny);
  const b = -2 * H * cosx * cosy;
  const c = H * H - req * req;
  const discriminant = b * b - 4 * a * c;
  // The ray misses the Earth: this pixel is looking at space.
  if (discriminant < 0) return null;

  const rs = (-b - Math.sqrt(discriminant)) / (2 * a);
  const sx = rs * cosx * cosy;
  const sy = -rs * sinx;
  const sz = rs * cosx * siny;

  const latitude = Math.atan(((req * req) / (rpol * rpol)) * (sz / Math.sqrt((H - sx) * (H - sx) + sy * sy)));
  const longitude = grid.originLongitudeDeg * DEG - Math.atan(sy / (H - sx));
  return { latitudeDeg: latitude / DEG, longitudeDeg: longitude / DEG };
}

/* ------------------------------------------------------------ semantics */

/**
 * The four-level mask, in the product's own words.
 *
 * `flag_meanings` on the variable reads "clear probably_clear probably_cloudy
 * cloudy", and the file carries a definition for each: a pixel is *probably*
 * clear when nothing was detected but a neighbour was cloudy, and *probably*
 * cloudy when cloud was detected next to a clear neighbour — the two edge cases
 * either side of a cloud boundary. That is why they are categories and not a
 * percentage: they describe the confidence of a per-pixel decision, not how
 * much of the sky is covered.
 */
export type CloudCategory = "clear" | "probably_clear" | "probably_cloudy" | "cloudy";

export const CLOUD_CATEGORIES: readonly CloudCategory[] = [
  "clear",
  "probably_clear",
  "probably_cloudy",
  "cloudy",
];

export const CLOUD_CATEGORY_LABEL: Record<CloudCategory, string> = {
  clear: "Clear",
  probably_clear: "Probably clear",
  probably_cloudy: "Probably cloudy",
  cloudy: "Cloudy",
};

export function categoryOf(value: number | null | undefined): CloudCategory | null {
  if (value === null || value === undefined) return null;
  return CLOUD_CATEGORIES[value] ?? null;
}

/**
 * The quality flag, which decides whether a pixel is worth reporting at all.
 *
 * `flag_meanings` reads "good_quality_qf bad_quality_qf space_qf spare spare
 * spare degraded_quality_qf". Anything that is not good or degraded is not a
 * measurement of cloud: `space_qf` is the pixel looking past the limb of the
 * Earth, and treating that as clear sky would paint the ocean beyond the
 * horizon a confident green.
 */
export type CloudQuality = "good" | "degraded" | "unusable";

export function qualityOf(value: number | null | undefined): CloudQuality {
  if (value === 0) return "good";
  if (value === 6) return "degraded";
  return "unusable";
}

/**
 * The published probability, scaled out of its integer storage.
 *
 * `Cloud_Probabilities` is a uint16 with `scale_factor` 1.5261e-05 and a fill
 * value of 65535. It is the probability that *this pixel* is cloudy — not the
 * fraction of the sky that is covered — so it may be shown as a confidence and
 * must never be presented as cloud cover.
 */
export const CLOUD_PROBABILITY_FILL = 65535;

export function probabilityOf(raw: number | null | undefined, scale: number): number | null {
  if (raw === null || raw === undefined || raw === CLOUD_PROBABILITY_FILL) return null;
  const value = raw * scale;
  return value >= 0 && value <= 1 ? value : null;
}
