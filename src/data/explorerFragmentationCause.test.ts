import { describe, expect, it } from "vitest";
import { explorerHistoricalCatalog } from "./explorerHistoricalCatalog";
import { explorerFragmentationEvents } from "./explorerFragmentation";
import {
  fragmentationCauseCoverage,
  fragmentationCauseFor,
  fragmentationCauseReference,
  isCollision,
} from "./explorerFragmentationCause";

const events = explorerFragmentationEvents(explorerHistoricalCatalog.objects);
const named = (name: string) => events.find((event) => event.parentName === name)!;

describe("assessed fragmentation cause", () => {
  it("attributes the curated reference rather than the catalog", () => {
    expect(fragmentationCauseReference.provenanceKind).toBe("curated-reference");
    expect(fragmentationCauseReference.reportNumber).toBe("NASA/TP-20220019160");
    expect(fragmentationCauseReference.url).toContain("orbitaldebris.jsc.nasa.gov");
  });

  it("names the two ASAT tests as deliberate collisions", () => {
    for (const name of ["Feng Yun 1C", "Kosmos-1408"]) {
      const cause = fragmentationCauseFor(named(name));
      expect(cause.standing).toBe("assessed");
      expect(cause.cause).toBe("COLLISION, DELIBERATE");
      expect(isCollision(cause)).toBe(true);
    }
  });

  it("names the 2009 event as an accidental collision on both sides", () => {
    for (const name of ["Iridium 33", "Kosmos-2251"]) {
      const cause = fragmentationCauseFor(named(name));
      expect(cause.cause).toBe("COLLISION, ACCIDENTAL");
    }
  });

  it("keeps an investigated-but-undetermined cause distinct from an unassessed one", () => {
    // NOAA 16 is assessed by the reference and the finding is UNKNOWN.
    const noaa = fragmentationCauseFor(named("NOAA 16"));
    expect(noaa.standing).toBe("assessed-unknown");
    expect(noaa.cause).toBeUndefined();

    // The Long March 6A upper stages postdate the edition entirely.
    const recent = fragmentationCauseFor(named("CZ-6A Y21 Stage 2"));
    expect(recent.standing).toBe("unassessed");
    expect(recent.note).toContain("postdates");
  });

  it("never claims a cause for an event outside the reference", () => {
    const unassessed = events.filter(
      (event) => fragmentationCauseFor(event).standing === "unassessed",
    );
    expect(unassessed.length).toBeGreaterThan(0);
    for (const event of unassessed.slice(0, 100)) {
      expect(fragmentationCauseFor(event).cause).toBeUndefined();
    }
  });

  it("covers most of the debris population despite covering few events", () => {
    const { matchedFragmentCount, catalogFragmentCount, matchedEventCount } =
      fragmentationCauseCoverage;
    // Few events, most fragments: the assessed events are the large ones.
    expect(matchedEventCount / fragmentationCauseCoverage.catalogEventCount).toBeLessThan(0.3);
    expect(matchedFragmentCount / catalogFragmentCount).toBeGreaterThan(0.75);
  });

  it("gives every standing a label a reader can act on", () => {
    for (const event of events.slice(0, 300)) {
      const cause = fragmentationCauseFor(event);
      expect(cause.label.length).toBeGreaterThan(10);
    }
  });
});
