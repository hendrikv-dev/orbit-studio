import { describe, expect, it } from "vitest";
import { fieldRuns, runsPath } from "./mapField";

/**
 * The contract these protect.
 *
 * Run-length encoding a field is a drawing optimisation, and a drawing
 * optimisation that changes what is drawn is a correctness bug wearing a
 * performance costume. So the assertions are almost all about equivalence: the
 * runs must cover exactly the cells the grid classified, in the same bands, and
 * must never bridge a gap in the sampling.
 *
 * The one performance assertion is on the *shape* of the output rather than on
 * a clock, because the defect this replaced was structural — sixteen thousand
 * SVG nodes — and node count is the thing that does not vary with the machine.
 */

/** A row-major grid, the way both eclipse fields emit one. */
function grid(rows: string[], stepDeg = 1) {
  const cells: { latitudeDeg: number; longitudeDeg: number; band: string }[] = [];
  rows.forEach((row, rowIndex) => {
    [...row].forEach((band, columnIndex) => {
      cells.push({
        latitudeDeg: rowIndex * stepDeg,
        longitudeDeg: columnIndex * stepDeg,
        band,
      });
    });
  });
  return cells;
}

const bandOf = (cell: { band: string }) => (cell.band === "." ? null : cell.band);

describe("merging a sampled field into runs", () => {
  it("collapses a stretch of one band into a single run", () => {
    const runs = fieldRuns(grid(["aaaaa"]), 1, bandOf);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      band: "a",
      latitudeDeg: 0,
      westLongitudeDeg: 0,
      eastLongitudeDeg: 4,
      cells: 5,
    });
  });

  it("breaks a run where the band changes", () => {
    const runs = fieldRuns(grid(["aabbb"]), 1, bandOf);
    expect(runs.map((run) => [run.band, run.cells])).toEqual([
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("never spans a row boundary, even when the bands match", () => {
    // Two rows of the same band are two rectangles, not one — a run is
    // horizontal by construction, and merging across rows would paint a
    // rectangle over cells that were never classified.
    const runs = fieldRuns(grid(["aa", "aa"]), 1, bandOf);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.latitudeDeg)).toEqual([0, 1]);
  });

  it("never bridges a gap in the sampling", () => {
    // The undrawn cell is a hole in the field. A run that closed over it would
    // assert visibility where the grid found none, which is the one thing a
    // drawing optimisation may not do.
    const runs = fieldRuns(grid(["aa.aa"]), 1, bandOf);
    expect(runs.map((run) => [run.westLongitudeDeg, run.eastLongitudeDeg])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it("emits nothing for a field with no drawable cells", () => {
    expect(fieldRuns(grid(["....."]), 1, bandOf)).toEqual([]);
  });

  it("covers exactly the cells the grid classified", () => {
    // The equivalence that matters: every drawable cell belongs to exactly one
    // run, and no run contains a cell that was not drawable.
    const cells = grid(["aab.bb", "..ccc.", "aaaaaa"]);
    const runs = fieldRuns(cells, 1, bandOf);
    const covered = new Set<string>();
    for (const run of runs) {
      for (let lon = run.westLongitudeDeg; lon <= run.eastLongitudeDeg; lon += 1) {
        const key = `${run.latitudeDeg}:${lon}`;
        expect(covered.has(key)).toBe(false);
        covered.add(key);
        const cell = cells.find(
          (entry) => entry.latitudeDeg === run.latitudeDeg && entry.longitudeDeg === lon,
        );
        expect(cell?.band).toBe(run.band);
      }
    }
    const drawable = cells.filter((cell) => bandOf(cell) !== null);
    expect(covered.size).toBe(drawable.length);
  });

  it("tolerates the drift of a grid built by repeated addition", () => {
    // Both generators walk `for (lat = south; lat <= north; lat += step)`, so
    // longitudes accumulate floating-point error. A strict equality test would
    // break the run somewhere in the middle of a hemisphere.
    const cells: { latitudeDeg: number; longitudeDeg: number; band: string }[] = [];
    let lon = -175;
    for (let index = 0; index < 60; index += 1) {
      cells.push({ latitudeDeg: 0, longitudeDeg: lon, band: "a" });
      lon += 1.4;
    }
    expect(fieldRuns(cells, 1.4, bandOf)).toHaveLength(1);
  });

  it("turns a realistic field into a handful of runs rather than thousands", () => {
    // The shape of the original defect. A hemisphere at 1.4° is about thirty
    // thousand cells and was thirty thousand SVG rectangles; banded fields
    // encode to a couple of runs per row.
    const rows: string[] = [];
    for (let row = 0; row < 120; row += 1) {
      rows.push("a".repeat(80) + "b".repeat(80) + ".".repeat(90));
    }
    const cells = grid(rows);
    const runs = fieldRuns(cells, 1, bandOf);
    expect(cells.length).toBeGreaterThan(29_000);
    expect(runs.length).toBe(240);
  });
});

describe("drawing the runs", () => {
  const projection = { x: (lon: number) => lon * 10, y: (lat: number) => 100 - lat * 10 };

  it("draws only the band it was asked for", () => {
    const runs = fieldRuns(grid(["aabb"]), 1, bandOf);
    const a = runsPath(runs, "a", 1, projection, 0);
    const b = runsPath(runs, "b", 1, projection, 0);
    expect(a.match(/M/g)).toHaveLength(1);
    expect(b.match(/M/g)).toHaveLength(1);
    expect(a).not.toBe(b);
  });

  it("puts the rectangle's edges at the cells' edges, not their centres", () => {
    // A one-cell run at longitude 0, step 1, spans −0.5 to +0.5 in longitude
    // and +0.5 to −0.5 in latitude. This projection puts north at the smaller
    // y, so the subpath starts at the north-west corner and closes clockwise.
    const runs = fieldRuns(grid(["a"]), 1, bandOf);
    expect(runsPath(runs, "a", 1, projection, 0)).toBe("M-5.0 95.0H5.0V105.0H-5.0Z");
  });

  it("returns an empty string for a band with no runs", () => {
    expect(runsPath(fieldRuns(grid(["aa"]), 1, bandOf), "z", 1, projection)).toBe("");
  });

  it("puts the north edge above the south edge whichever way the projection runs", () => {
    const flipped = { x: (lon: number) => lon * 10, y: (lat: number) => lat * 10 };
    const runs = fieldRuns(grid(["a"]), 1, bandOf);
    for (const projected of [projection, flipped]) {
      const d = runsPath(runs, "a", 1, projected, 0);
      const [, top, bottom] = /V?(-?\d+\.\d)H.*?V(-?\d+\.\d)/.exec(d) ?? [];
      expect(Number(bottom)).toBeGreaterThan(Number(top));
    }
  });
});
