/**
 * Turning a sampled field into something a browser can draw.
 *
 * ## The defect this exists to fix
 *
 * Both eclipse maps sampled a grid and then drew one `<rect>` per cell. At the
 * card's resolution that is a few thousand rectangles and nobody notices. At the
 * expanded map's — a hemisphere at 1.4°, or a coverage field at 0.9° — it is
 * tens of thousands, and the numbers stopped being theoretical:
 *
 *   opening the expanded lunar map     2793 ms, 16 283 <rect> nodes
 *   closing and opening it again      15 427 ms
 *
 * Measured in the production build at a 375px viewport. The astronomy behind
 * that map takes 43 ms. Every remaining second was React building sixteen
 * thousand vnodes, the browser building sixteen thousand SVG nodes, and an SVG
 * filter being asked to rasterise all of them — and then doing it again on
 * every pan frame, because the field is a render prop and re-runs whenever the
 * viewport state changes.
 *
 * ## What this does instead
 *
 * The grid is row-major and each row is mostly long stretches of one band, so
 * the cells run-length encode almost perfectly: a horizontal run becomes one
 * rectangle instead of two hundred. Three bands over a hemisphere collapse from
 * sixteen thousand nodes to a few hundred subpaths inside three `<path>`
 * elements.
 *
 * ## What this deliberately does not do
 *
 * It does not change a single cell. The input grid, its resolution, its
 * classification and its boundaries are exactly what they were — this is a
 * different way of *drawing* the same field, which is why it cannot trade
 * geographic correctness for speed. The dashed horizon curves are still drawn
 * from `capOutline`, and the fill they bound is still the sampled grid.
 */

export interface FieldCell {
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface FieldRun<Band extends string> {
  band: Band;
  latitudeDeg: number;
  /** Centre longitude of the westmost cell in the run. */
  westLongitudeDeg: number;
  /** Centre longitude of the eastmost cell in the run. */
  eastLongitudeDeg: number;
  /** How many cells the run covers. Carried for tests and for diagnostics. */
  cells: number;
}

/**
 * Merge a row-major grid into horizontal runs of equal band.
 *
 * `bandOf` returns null for a cell that should not be drawn at all — the
 * "nothing here" case both maps already had — and a run never spans one.
 *
 * A run is broken whenever the latitude changes or the longitude does not
 * continue by one step. The second test is what keeps this honest about the
 * input: the generators here emit ascending row-major grids, but a run that
 * silently bridged a gap would paint over a hole in the sampling, so the gap is
 * checked rather than assumed. The tolerance is a twentieth of a step, which is
 * far below any real spacing and far above floating-point drift from repeated
 * addition.
 */
export function fieldRuns<Cell extends FieldCell, Band extends string>(
  cells: readonly Cell[],
  stepDeg: number,
  bandOf: (cell: Cell) => Band | null,
): FieldRun<Band>[] {
  const runs: FieldRun<Band>[] = [];
  const tolerance = stepDeg / 20;
  let open: FieldRun<Band> | null = null;

  for (const cell of cells) {
    const band = bandOf(cell);
    const continues =
      open !== null &&
      open.band === band &&
      open.latitudeDeg === cell.latitudeDeg &&
      Math.abs(cell.longitudeDeg - open.eastLongitudeDeg - stepDeg) <= tolerance;

    if (continues) {
      open!.eastLongitudeDeg = cell.longitudeDeg;
      open!.cells += 1;
      continue;
    }

    if (open) runs.push(open);
    open =
      band === null
        ? null
        : {
            band,
            latitudeDeg: cell.latitudeDeg,
            westLongitudeDeg: cell.longitudeDeg,
            eastLongitudeDeg: cell.longitudeDeg,
            cells: 1,
          };
  }
  if (open) runs.push(open);
  return runs;
}

/**
 * The runs of one band as a single SVG path.
 *
 * Each run is an axis-aligned rectangle, so the subpath is four commands and a
 * close. The half-step padding puts the rectangle's edges where the cell's
 * edges are rather than at its centre, which is what the per-cell rectangles
 * did; `bleed` reproduces the one-pixel overlap they used, so rows still meet
 * without a hairline of background showing between them.
 */
export function runsPath<Band extends string>(
  runs: readonly FieldRun<Band>[],
  band: Band,
  stepDeg: number,
  projection: { x: (longitudeDeg: number) => number; y: (latitudeDeg: number) => number },
  bleed = 0.5,
): string {
  const half = stepDeg / 2;
  const parts: string[] = [];
  for (const run of runs) {
    if (run.band !== band) continue;
    const x0 = projection.x(run.westLongitudeDeg - half) - bleed;
    const x1 = projection.x(run.eastLongitudeDeg + half) + bleed;
    // Latitude increases upward and screen y increases downward, so the north
    // edge is the smaller y. Taking min/max rather than assuming the sign keeps
    // this correct for a projection that ever flips.
    const yA = projection.y(run.latitudeDeg + half);
    const yB = projection.y(run.latitudeDeg - half);
    const top = Math.min(yA, yB) - bleed;
    const bottom = Math.max(yA, yB) + bleed;
    parts.push(
      `M${x0.toFixed(1)} ${top.toFixed(1)}H${x1.toFixed(1)}V${bottom.toFixed(1)}H${x0.toFixed(1)}Z`,
    );
  }
  return parts.join("");
}
