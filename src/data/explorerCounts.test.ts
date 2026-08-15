import { describe, expect, it } from "vitest";
import { currentExplorerSnapshot, explorerSnapshotView } from "./explorerCatalog";
import { explorerCountBreakdown, explorerCountReconciliation } from "./explorerCounts";

const view = explorerSnapshotView(currentExplorerSnapshot);
const counts = explorerCountBreakdown(view);

describe("explorer population totals", () => {
  it("reports the three numbers the interface shows", () => {
    expect(counts.catalogObjects).toBe(33489);
    expect(counts.plottable).toBe(33474);
    expect(counts.withReconstructedOrbit).toBe(33468);
  });

  it("accounts for every difference between them", () => {
    // The guard against drift: if a rebuild changes these sets, the arithmetic
    // fails here rather than the interface quietly showing unexplained totals.
    expect(counts.catalogObjects).toBe(counts.withReconstructedOrbit + counts.catalogOnly);
    expect(counts.plottable).toBe(counts.withReconstructedOrbit + counts.curatedReference);
  });

  it("has no negative or impossible components", () => {
    expect(counts.catalogOnly).toBeGreaterThanOrEqual(0);
    expect(counts.curatedReference).toBeGreaterThanOrEqual(0);
    expect(counts.withReconstructedOrbit).toBeLessThanOrEqual(counts.catalogObjects);
  });

  it("names both reasons the totals differ", () => {
    const sentence = explorerCountReconciliation(counts)!;
    expect(sentence).toContain("21");
    expect(sentence).toContain("6");
    expect(sentence).toMatch(/cannot be drawn/);
    expect(sentence).toMatch(/not GCAT catalog members/);
  });

  it("says nothing when the totals agree", () => {
    expect(
      explorerCountReconciliation({
        catalogObjects: 10,
        withReconstructedOrbit: 10,
        catalogOnly: 0,
        curatedReference: 0,
        plottable: 10,
      }),
    ).toBeNull();
  });

  it("reads correctly in the singular", () => {
    const sentence = explorerCountReconciliation({
      catalogObjects: 2,
      withReconstructedOrbit: 1,
      catalogOnly: 1,
      curatedReference: 1,
      plottable: 2,
    })!;
    expect(sentence).toContain("object has");
    expect(sentence).toContain("orbit is");
  });
});
