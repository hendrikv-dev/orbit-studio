import { describe, expect, it } from "vitest";
import { currentExplorerSnapshot, explorerSnapshotView } from "./explorerCatalog";
import {
  explorerEntryMatchesFilters,
  explorerFilterChangeShouldReframe,
  explorerFilterConflict,
  type ExplorerRegimeFilter,
} from "./explorerFilters";

describe("Explorer filter and selected-object semantics", () => {
  const hubble = explorerSnapshotView(currentExplorerSnapshot).byId.get("explorer-hubble")!;
  const regimes: ExplorerRegimeFilter[] = ["all", "leo", "meo", "geo", "heo"];

  it("classifies Hubble consistently across every orbit regime", () => {
    expect(regimes.map((regime) => explorerEntryMatchesFilters(hubble, regime, new Set()))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(explorerFilterConflict(hubble, "all", new Set())).toBeNull();
    expect(explorerFilterConflict(hubble, "leo", new Set())).toBeNull();
    expect(explorerFilterConflict(hubble, "meo", new Set())).toEqual({
      objectType: false,
      regime: true,
    });
  });

  it("derives constellation regimes from their architecture shells", () => {
    const view = explorerSnapshotView(currentExplorerSnapshot);
    const starlink = view.byId.get("explorer-starlink-constellation")!;
    const gps = view.byId.get("explorer-gps-constellation")!;

    expect(explorerEntryMatchesFilters(starlink, "leo", new Set())).toBe(true);
    expect(explorerEntryMatchesFilters(starlink, "meo", new Set())).toBe(false);
    expect(explorerFilterConflict(starlink, "leo", new Set())).toBeNull();

    expect(explorerEntryMatchesFilters(gps, "meo", new Set())).toBe(true);
    expect(explorerEntryMatchesFilters(gps, "leo", new Set())).toBe(false);
  });

  it("reports only applicable object-type conflicts", () => {
    expect(explorerFilterConflict(hubble, "all", new Set(["payloads"]))).toBeNull();
    expect(explorerFilterConflict(hubble, "all", new Set(["debris"]))).toEqual({
      objectType: true,
      regime: false,
    });
    expect(explorerFilterConflict(hubble, "geo", new Set(["debris"]))).toEqual({
      objectType: true,
      regime: true,
    });
  });

  it("does not request a camera reframe for filter changes while an object is selected", () => {
    expect(explorerFilterChangeShouldReframe("explorer-hubble")).toBe(false);
    expect(explorerFilterChangeShouldReframe(null)).toBe(true);
  });
});
