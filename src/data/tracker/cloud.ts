/**
 * Cloud, which is the difference between a good night and staying in.
 *
 * ## Two sources, and they are not the same claim
 *
 * **What the sky is doing** comes from GOES, as NOAA's own classification
 * rather than as a picture. The clear-sky mask decides, per two-kilometre
 * pixel, whether it is clear, probably clear, probably cloudy or cloudy, every
 * five minutes, day and night. That lives in `cloudObservation.ts`.
 *
 * An earlier version of this file used the infrared imagery instead and only
 * for its timestamp, because brightness temperature is not a cloud mask — warm
 * ground and low stratus overlap in it. That was the right call about the
 * imagery and the wrong product: the classification exists, and it is what a
 * reader is actually asking about.
 *
 * **What the sky will do** comes from a numerical forecast — HRRR over the
 * United States, where it is the highest-resolution model there is, and the
 * best available global model elsewhere. That is numbers, sampled on a lattice
 * across the view and drawn through Tracker's own field pipeline.
 *
 * ## The rule about pixels
 *
 * The reading at the reader's own place, and anything a recommendation is
 * calculated from, comes from the numbers. Never from a rendered tile. Reading
 * a colour back out of an image and calling the result a cloud percentage is
 * how a product ends up quoting a legend to itself — and it is the specific
 * failure this module is arranged to make impossible: the sampler behind the
 * field on the map and the sampler behind the reading in the panel are the same
 * function over the same values.
 */

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

/* ------------------------------------------------------------- observed */

/**
 * How old an observation may be before the interface says so.
 *
 * The CONUS scene is scanned every five minutes. Fifteen is three scans missed,
 * which means something is wrong upstream rather than that the reader caught
 * the gap between two images — and cloud a quarter of an hour old has moved far
 * enough that presenting it as "now" is a claim Tracker cannot support.
 *
 * The observation itself lives in `cloudObservation.ts`, which reads NOAA's
 * clear-sky mask through the proxy. What used to be here was a satellite
 * *image* — infrared brightness — kept only so the interface could say when
 * somebody last looked. There is a classification now, so the image is gone.
 */
export const OBSERVATION_STALE_MINUTES = 15;

/* ------------------------------------------------------------- forecast */

export interface CloudForecast {
  /** The model that answered, named because the reader is owed it. */
  model: string;
  /** The hour these values are for. */
  validUtc: string;
  latitudes: number[];
  longitudes: number[];
  /** Percent, row-major over latitudes then longitudes. */
  values: (number | null)[];
}

export interface Bounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

/**
 * Where HRRR can answer.
 *
 * Its domain is the contiguous United States and a margin around it. Asking it
 * about anywhere else returns nothing, so the model is chosen by the view
 * rather than requested everywhere and hoped for.
 */
export function withinHrrr(bounds: Bounds): boolean {
  return (
    bounds.south > 21 && bounds.north < 53 && bounds.west > -135 && bounds.east < -60
  );
}

/**
 * A lattice over the view, coarse on purpose.
 *
 * Twelve by eight is ninety-six points, which is one request of about thirty
 * kilobytes and enough to show where the edge of a cloud sheet is. Finer would
 * be a bigger claim than an hourly forecast can support and a larger share of
 * somebody else's free service than a map pan is worth.
 */
export const GRID_COLUMNS = 12;
export const GRID_ROWS = 8;

export function latticeFor(bounds: Bounds): { latitudes: number[]; longitudes: number[] } {
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    latitudes.push(bounds.south + ((bounds.north - bounds.south) * (row + 0.5)) / GRID_ROWS);
  }
  for (let column = 0; column < GRID_COLUMNS; column += 1) {
    longitudes.push(bounds.west + ((bounds.east - bounds.west) * (column + 0.5)) / GRID_COLUMNS);
  }
  return { latitudes, longitudes };
}

/**
 * Bilinear over the lattice, and nothing outside it.
 *
 * The lattice covers the view it was fetched for. Clamping to its edge instead
 * would draw the outermost row across everything beyond — flat bands running to
 * the edge of the map, indistinguishable from a forecast, made of a value
 * nobody asked the model about. Half a cell of tolerance, because the samples
 * are cell centres and the cells they stand for reach half a step further.
 */
export function cloudAt(forecast: CloudForecast, latitudeDeg: number, longitudeDeg: number): number | null {
  const { latitudes, longitudes, values } = forecast;
  if (latitudes.length < 2 || longitudes.length < 2) return null;
  const outside = (axis: number[], value: number) => {
    const step = Math.abs(axis[1] - axis[0]) / 2;
    return value < axis[0] - step || value > axis[axis.length - 1] + step;
  };
  if (outside(latitudes, latitudeDeg) || outside(longitudes, longitudeDeg)) return null;
  const place = (axis: number[], value: number) => {
    const step = axis[1] - axis[0];
    const at = (value - axis[0]) / step;
    const low = Math.max(0, Math.min(axis.length - 2, Math.floor(at)));
    return { low, fraction: Math.max(0, Math.min(1, at - low)) };
  };
  const row = place(latitudes, latitudeDeg);
  const column = place(longitudes, longitudeDeg);
  const read = (r: number, c: number) => values[r * longitudes.length + c];
  const corners = [
    read(row.low, column.low),
    read(row.low, column.low + 1),
    read(row.low + 1, column.low),
    read(row.low + 1, column.low + 1),
  ];
  if (corners.some((corner) => corner === null || corner === undefined)) return null;
  const [a, b, c, d] = corners as number[];
  const top = a + (b - a) * column.fraction;
  const bottom = c + (d - c) * column.fraction;
  return top + (bottom - top) * row.fraction;
}

/** The hour a forecast is asked for, since the models are hourly. */
export function forecastHour(atUtc: string): string {
  const at = new Date(atUtc);
  at.setUTCMinutes(0, 0, 0);
  return at.toISOString().slice(0, 16);
}

export async function fetchCloudForecast(
  bounds: Bounds,
  atUtc: string,
  signal?: AbortSignal,
): Promise<CloudForecast | null> {
  const { latitudes, longitudes } = latticeFor(bounds);
  const hour = forecastHour(atUtc);
  const points: [number, number][] = [];
  for (const latitude of latitudes) {
    for (const longitude of longitudes) points.push([latitude, longitude]);
  }

  const hrrr = withinHrrr(bounds);
  const query = new URLSearchParams({
    latitude: points.map(([latitude]) => latitude.toFixed(3)).join(","),
    longitude: points.map(([, longitude]) => longitude.toFixed(3)).join(","),
    hourly: "cloud_cover",
    start_hour: hour,
    end_hour: hour,
  });
  // Named explicitly inside its domain, so the page can say HRRR and mean it.
  if (hrrr) query.set("models", "ncep_hrrr_conus");

  try {
    const response = await fetch(`${OPEN_METEO}?${query}`, { signal });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    const entries = Array.isArray(body) ? body : [body];
    if (entries.length !== points.length) return null;
    const values = entries.map((entry) => {
      const hourly = (entry as { hourly?: { cloud_cover?: (number | null)[] } }).hourly;
      const value = hourly?.cloud_cover?.[0];
      return typeof value === "number" ? value : null;
    });
    // A grid of nulls is not a forecast; it is a service that answered without
    // saying anything, and the layer has to be able to tell the difference.
    if (values.every((value) => value === null)) return null;
    return {
      model: hrrr ? "NOAA HRRR" : "Open-Meteo best available",
      validUtc: `${hour}:00Z`,
      latitudes,
      longitudes,
      values,
    };
  } catch {
    return null;
  }
}
