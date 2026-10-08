import { describe, expect, it } from "vitest";
import { currentExplorerSnapshot, explorerSnapshotView } from "./explorerCatalog";
import type { ExplorerCatalogEntry } from "./explorerCatalog";
import {
  elementProvenanceLabel,
  explorerElementProvenance,
} from "./explorerElementProvenance";

describe("orbital element provenance", () => {
  it("never reports a catalog angle as sourced", () => {
    // latestExactStateCount is zero in the export: nothing here has an observed
    // angle, so no availability may produce a bare, unqualified RAAN.
    for (const availability of [
      "reconstructed-historical-orbit",
      "nearest-historical-orbit",
      "exact-historical-orbit",
      "curated-reference-orbit",
      "current-representative-orbit",
      "catalog-only",
      undefined,
    ] as const) {
      expect(explorerElementProvenance(availability).angles).not.toBe("sourced");
    }
  });

  it("keeps the sourced shape distinct from the generated angles", () => {
    const gcat = explorerElementProvenance("reconstructed-historical-orbit");
    expect(gcat.shape).toBe("sourced");
    expect(gcat.angles).toBe("reconstructed");
    expect(elementProvenanceLabel(gcat.shape)).toBeNull();
    expect(elementProvenanceLabel(gcat.angles)).toBe("reconstructed");
  });

  it("treats an unknown availability as reconstructed rather than measured", () => {
    // Failing open here would mean a new availability value silently presents
    // fabricated angles as fact.
    expect(explorerElementProvenance(undefined).angles).toBe("reconstructed");
  });

  it("describes every case in terms a reader can act on", () => {
    for (const availability of [
      "reconstructed-historical-orbit",
      "curated-reference-orbit",
      "catalog-only",
    ] as const) {
      const note = explorerElementProvenance(availability).note;
      expect(note.length).toBeGreaterThan(40);
      expect(note).toMatch(/angle|orbit/i);
    }
  });

  it("covers every object in the shipped snapshot", () => {
    const view = explorerSnapshotView(currentExplorerSnapshot);
    const seen = new Set<string>();
    for (const record of view.records as ExplorerCatalogEntry[]) {
      const provenance = explorerElementProvenance(record.orbitAvailability);
      expect(provenance.note.length).toBeGreaterThan(0);
      seen.add(provenance.angles);
    }
    // The snapshot is overwhelmingly reconstructed; if that ever stops being
    // true the interface copy needs revisiting rather than silently changing.
    expect(seen.has("reconstructed")).toBe(true);
    expect(seen.has("sourced")).toBe(false);
  });
});
