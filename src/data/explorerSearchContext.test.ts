import { describe, expect, it } from "vitest";
import { currentExplorerSnapshot, explorerSnapshotView } from "./explorerCatalog";
import type { ExplorerCatalogEntry } from "./explorerCatalog";
import { historicalOnlyMatches, searchResultDetail } from "./explorerSearchContext";

const presentIds = new Set(
  explorerSnapshotView(currentExplorerSnapshot).records.map((record) => record.id),
);

describe("distinguishing rows that share a name", () => {
  it("gives a detail for a catalog object", () => {
    const view = explorerSnapshotView(currentExplorerSnapshot);
    const debris = (view.records as ExplorerCatalogEntry[]).find(
      (record) => record.name.startsWith("deb Kosmos-2251"),
    )!;
    const detail = searchResultDetail(debris);
    expect(detail).toBeTruthy();
    expect(detail).toMatch(/#\d+/);
  });

  it("distinguishes two fragments of the same break-up", () => {
    const view = explorerSnapshotView(currentExplorerSnapshot);
    const fragments = (view.records as ExplorerCatalogEntry[])
      .filter((record) => record.name.startsWith("deb Kosmos-2251"))
      .slice(0, 6);
    expect(fragments.length).toBeGreaterThan(1);
    // Same name, so the detail is the only thing telling them apart.
    expect(new Set(fragments.map((f) => f.name)).size).toBe(1);
    const details = fragments.map(searchResultDetail);
    expect(new Set(details).size).toBe(details.length);
  });
});

describe("objects that decayed out of the snapshot", () => {
  it("explains a famous satellite that is no longer present", () => {
    // Kosmos-2251 decayed on 2009-02-10 in the collision with Iridium 33, so a
    // present-day snapshot correctly contains only its debris.
    const matches = historicalOnlyMatches("Kosmos-2251", presentIds);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("Kosmos-2251");
    expect(matches[0].lastPresentYear).toBe(2008);
    expect(matches[0].decayDate?.slice(0, 10)).toBe("2009-02-10");
  });

  it("finds the other side of the same collision", () => {
    const matches = historicalOnlyMatches("Iridium 33", presentIds);
    expect(matches[0]?.lastPresentYear).toBe(2008);
  });

  it("says nothing about an object that is still in orbit", () => {
    expect(historicalOnlyMatches("International Space Station", presentIds)).toEqual([]);
  });

  it("ignores a partial name rather than surfacing noise", () => {
    // A substring rule would return a decayed object for almost any query.
    expect(historicalOnlyMatches("Kosmos", presentIds)).toEqual([]);
    expect(historicalOnlyMatches("de", presentIds)).toEqual([]);
  });

  it("caps what it returns", () => {
    expect(historicalOnlyMatches("Kosmos-2251", presentIds, 1).length).toBeLessThanOrEqual(1);
  });
});
