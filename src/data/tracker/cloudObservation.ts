import {
  categoryOf,
  cellFor,
  probabilityOf,
  qualityOf,
  type CloudCategory,
  type FixedGrid,
} from "./goesGrid";

/**
 * What the satellite actually saw, as NOAA classified it.
 *
 * ## Why this is categorical
 *
 * The product is a per-pixel decision with four levels — clear, probably clear,
 * probably cloudy, cloudy — where the two "probably" levels describe pixels at
 * the edge of a cloud rather than a partly cloudy sky. It also carries a
 * probability, but that is the probability *this pixel is cloudy*, not the
 * fraction of the sky that is covered. Neither is a percentage of cloud cover,
 * and Tracker does not turn them into one.
 *
 * ## Why nothing here is interpolated
 *
 * A classification cannot be averaged. Halfway between "clear" and "cloudy" is
 * not "half cloudy", it is a pixel boundary, and a value invented between two
 * of them would be a measurement nobody made. So a reading is the pixel that
 * covers the place, taken at native resolution, and the field is drawn from the
 * pixels themselves. The map may smooth how they look; it never smooths what
 * they say.
 */

const ENDPOINT = "/api/goes-cloud-mask";

export interface ObservedHead {
  satellite: string;
  platform: string;
  scene: string;
  product: string;
  resolution: string;
  observedUtc: string;
  probabilityScale: number;
}

export interface ObservedReading extends ObservedHead {
  category: CloudCategory;
  /** Probability that this pixel is cloudy, 0–1. Never a sky-cover fraction. */
  probability: number | null;
  quality: "good" | "degraded";
  cell: { column: number; row: number };
}

export interface ObservedField extends ObservedHead {
  grid: FixedGrid;
  window: { row0: number; row1: number; column0: number; column1: number; stride: number };
  width: number;
  height: number;
  acm: number[];
  dqf: number[];
  cloudProbabilityRaw: number[];
}

/** Why there is nothing to show, in terms the interface can repeat. */
export type ObservedFailure =
  | { kind: "uncovered" }
  | { kind: "unreachable" }
  | { kind: "unusable" };

export type Observed<T> = { ok: true; value: T } | ({ ok: false } & ObservedFailure);

async function ask(query: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${ENDPOINT}?${query}`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The times the satellite has images for, so a timeline can be built without
 * fetching any of them.
 */
export async function fetchObservationTimes(
  latitudeDeg: number,
  longitudeDeg: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const body = await ask(`frames=1&at=${latitudeDeg},${longitudeDeg}`, signal);
  const times = body?.times;
  return Array.isArray(times) ? (times as string[]) : [];
}

/** The native pixel over a place. Never subsampled, whatever the map is doing. */
export async function fetchObservedAt(
  latitudeDeg: number,
  longitudeDeg: number,
  atUtc: string | null,
  signal?: AbortSignal,
): Promise<Observed<ObservedReading>> {
  const body = await ask(
    `at=${latitudeDeg.toFixed(4)},${longitudeDeg.toFixed(4)}${atUtc ? `&time=${encodeURIComponent(atUtc)}` : ""}`,
    signal,
  );
  if (!body) return { ok: false, kind: "unreachable" };
  if (body.covered !== true) return { ok: false, kind: "uncovered" };

  const category = categoryOf(body.acm as number);
  const quality = qualityOf(body.dqf as number);
  // A pixel the product itself calls unusable is not a cloud measurement: it is
  // most often the view running off the limb of the Earth, and reporting that
  // as clear sky would paint the ocean beyond the horizon a confident green.
  if (!category || quality === "unusable") return { ok: false, kind: "unusable" };

  return {
    ok: true,
    value: {
      ...(body as unknown as ObservedHead),
      category,
      quality,
      probability: probabilityOf(
        body.cloudProbabilityRaw as number,
        body.probabilityScale as number,
      ),
      cell: body.cell as { column: number; row: number },
    },
  };
}

export interface FieldRequest {
  south: number;
  west: number;
  north: number;
  east: number;
  /**
   * How many cells across the reply may be.
   *
   * The proxy answers at native resolution whenever the window fits inside
   * this, and otherwise skips pixels — never averages them — so asking for more
   * is asking for finer real data rather than for a sharper rendering of the
   * same.
   */
  cells: number;
}

export async function fetchObservedField(
  request: FieldRequest,
  atUtc: string | null,
  signal?: AbortSignal,
): Promise<Observed<ObservedField>> {
  const bbox = [request.south, request.west, request.north, request.east]
    .map((value) => value.toFixed(3))
    .join(",");
  const body = await ask(
    `bbox=${bbox}&cells=${request.cells}${atUtc ? `&time=${encodeURIComponent(atUtc)}` : ""}`,
    signal,
  );
  if (!body) return { ok: false, kind: "unreachable" };
  if (body.covered !== true) return { ok: false, kind: "uncovered" };
  return { ok: true, value: body as unknown as ObservedField };
}

/**
 * The classification at a place, read out of a field.
 *
 * Nearest pixel, deliberately. There is no interpolation between categories
 * because there is nothing between them: a value halfway from clear to cloudy
 * is a pixel boundary, not a half-covered sky, and inventing one would be a
 * measurement nobody made.
 *
 * Used for drawing. A reading the reader is shown comes from `fetchObservedAt`,
 * at native resolution, whatever stride the map happens to be drawn at.
 */
export function observedAt(
  field: ObservedField,
  latitudeDeg: number,
  longitudeDeg: number,
): { category: CloudCategory; probability: number | null } | null {
  const cell = cellFor(field.grid, latitudeDeg, longitudeDeg);
  if (!cell) return null;
  const { window, width, height } = field;
  const column = Math.round((cell.column - window.column0) / window.stride);
  const row = Math.round((cell.row - window.row0) / window.stride);
  if (column < 0 || column >= width || row < 0 || row >= height) return null;
  const index = row * width + column;
  const category = categoryOf(field.acm[index]);
  if (!category || qualityOf(field.dqf[index]) === "unusable") return null;
  return {
    category,
    probability: probabilityOf(field.cloudProbabilityRaw[index], field.probabilityScale),
  };
}

/**
 * How far apart the samples in a field actually are, in kilometres.
 *
 * Quoted so the interface can say what it is showing rather than implying the
 * colour under a pin is a measurement of that exact spot. Two kilometres at
 * nadir is the product's own figure; a stride multiplies it.
 */
export function sampleSpacingKm(field: ObservedField): number {
  const nadir = Number.parseFloat(field.resolution) || 2;
  return nadir * field.window.stride;
}
