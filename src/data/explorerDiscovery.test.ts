import { describe, expect, it } from "vitest";
import {
  currentExplorerSnapshot,
  explorerSnapshotView,
  filterExplorerCatalogSnapshot,
} from "./explorerCatalog";
import {
  explorerDiscoveryCollectionIds,
  explorerEntriesForDiscoveryCollection,
  prioritizeExplorerSearchResults,
} from "./explorerDiscovery";

const current = explorerSnapshotView(currentExplorerSnapshot);

function search(query: string) {
  return prioritizeExplorerSearchResults(
    filterExplorerCatalogSnapshot(current, {
      query,
      categoryId: "all",
      status: "all",
      operator: "all",
      constellationId: "all",
    }),
    query,
  );
}

describe("Explorer discovery information architecture", () => {
  it("derives every collection from the selected snapshot without introducing records", () => {
    const currentIds = new Set(current.records.map((entry) => entry.id));

    explorerDiscoveryCollectionIds.forEach((collectionId) => {
      explorerEntriesForDiscoveryCollection(current.records, collectionId).forEach((entry) => {
        expect(currentIds.has(entry.id)).toBe(true);
      });
    });

    expect(
      explorerEntriesForDiscoveryCollection(current.records, "complete-catalog"),
    ).toEqual(current.records);
  });

  it("prioritizes recognizable educational objects without hiding the complete catalog", () => {
    const featured = explorerEntriesForDiscoveryCollection(current.records, "featured");
    const featuredIds = featured.map((entry) => entry.id);

    expect(featuredIds.slice(0, 3)).toEqual([
      "explorer-iss",
      "explorer-hubble",
      "explorer-jwst",
    ]);
    expect(featuredIds).toEqual(expect.arrayContaining([
      "explorer-starlink-constellation",
      "explorer-gps-constellation",
      "explorer-apollo-program",
      "explorer-voyager-1",
    ]));
    expect(featured.some((entry) => entry.categoryId === "debris")).toBe(false);
  });

  it("treats orbital systems as first-class constellation results", () => {
    const constellations = explorerEntriesForDiscoveryCollection(
      current.records,
      "constellations",
    );
    const constellationIds = constellations.map((entry) => entry.id);

    expect(constellations.every((entry) => entry.selectionKind === "constellation")).toBe(true);
    expect(constellationIds).toEqual(expect.arrayContaining([
      "explorer-starlink-constellation",
      "explorer-gps-constellation",
      "explorer-galileo-constellation",
      "explorer-beidou-constellation",
      "explorer-oneweb-constellation",
      "explorer-iridium-constellation",
    ]));
  });

  it("organizes navigation, Earth observation, and human spaceflight by meaning", () => {
    const navigationIds = explorerEntriesForDiscoveryCollection(
      current.records,
      "navigation",
    ).map((entry) => entry.id);
    const earthObservationIds = explorerEntriesForDiscoveryCollection(
      current.records,
      "earth-observation",
    ).map((entry) => entry.id);
    const humanNames = explorerEntriesForDiscoveryCollection(
      current.records,
      "human-spaceflight",
    ).map((entry) => entry.name);

    expect(navigationIds).toEqual(expect.arrayContaining([
      "explorer-gps-constellation",
      "explorer-galileo-constellation",
      "explorer-beidou-constellation",
    ]));
    expect(earthObservationIds).toEqual(expect.arrayContaining([
      "explorer-noaa-constellation",
      "explorer-sentinel-constellation",
    ]));
    expect(humanNames).toContain("International Space Station");
    expect(humanNames).toContain("Apollo Program");
  });
});

describe("Explorer discovery search ranking", () => {
  it("ranks constellation entities above individual members", () => {
    expect(search("Starlink")[0]?.id).toBe("explorer-starlink-constellation");
    expect(search("GPS")[0]?.id).toBe("explorer-gps-constellation");
    expect(search("Galileo")[0]?.id).toBe("explorer-galileo-constellation");
    expect(search("BeiDou")[0]?.id).toBe("explorer-beidou-constellation");
  });

  it("uses identity metadata for recognized individual objects", () => {
    expect(search("ISS")[0]?.id).toBe("explorer-iss");
    expect(search("ISS").slice(0, 10).some((entry) => entry.name === "ISS (NAUKA)")).toBe(false);
    expect(search("Hubble")[0]?.id).toBe("explorer-hubble");
    expect(search("JWST")[0]?.id).toBe("explorer-jwst");
    expect(search("Tiangong")).toHaveLength(0);
  });
});
