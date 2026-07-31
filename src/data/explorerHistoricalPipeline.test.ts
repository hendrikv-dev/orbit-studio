import { describe, expect, it } from "vitest";
import type {
  ExplorerHistoricalCatalogDataset,
  ExplorerHistoricalCatalogObject,
  ExplorerHistoricalOrbitState,
  ExplorerHistoricalSourceAttribution,
} from "./explorerHistoricalCatalog";
import {
  createHistoricalCatalogIndex,
  historicalObjectExistsOnDate,
  queryHistoricalCatalog,
} from "./explorerHistoricalPipeline";

const source: ExplorerHistoricalSourceAttribution = {
  sourceId: "space-track:test-satcat",
  sourceFamily: "space-track",
  sourceFile: "test-satcat.csv",
};

function object(
  patch: Partial<ExplorerHistoricalCatalogObject> & Pick<ExplorerHistoricalCatalogObject, "id" | "name">,
): ExplorerHistoricalCatalogObject {
  return {
    catalogNumber: patch.id.replace(/^satcat-/, ""),
    objectType: "Payload",
    owner: "Test operator",
    sources: [source],
    ...patch,
  };
}

function orbitState(
  patch: Partial<ExplorerHistoricalOrbitState> & Pick<ExplorerHistoricalOrbitState, "id" | "objectId" | "epoch">,
): ExplorerHistoricalOrbitState {
  return {
    catalogNumber: patch.objectId?.replace(/^satcat-/, ""),
    tle: {
      name: patch.objectId ?? patch.id,
      line1: "1 00001U 57001A   57277.81150463  .00000023  00000+0  00000+0 0  9991",
      line2: "2 00001  65.1000 118.0000 0520000  58.0000  42.0000 14.00000000    01",
    },
    orbit: {
      altitudeKm: 577,
      eccentricity: 0.052,
      inclinationDeg: 65.1,
      raanDeg: 118,
      argumentOfPeriapsisDeg: 58,
      trueAnomalyDeg: 42,
      epoch: patch.epoch,
    },
    sources: [source],
    ...patch,
  };
}

const fixture: ExplorerHistoricalCatalogDataset = {
  schemaVersion: 1,
  generatedAt: "2026-06-30T00:00:00.000Z",
  sourceFiles: [
    {
      id: source.sourceId,
      family: source.sourceFamily,
      fileName: source.sourceFile,
      importedAt: "2026-06-30T00:00:00.000Z",
      recordCount: 8,
    },
  ],
  objects: [
    object({
      id: "satcat-1",
      name: "Sputnik 1",
      launchDate: "1957-10-04T19:28:34.000Z",
      decayDate: "1958-01-04T00:00:00.000Z",
    }),
    object({
      id: "satcat-65001",
      name: "1965 Catalog Only",
      launchDate: "1965-03-01T00:00:00.000Z",
    }),
    object({
      id: "satcat-65002",
      name: "1965 Reconstructed",
      launchDate: "1965-03-01T00:00:00.000Z",
      orbitalSummary: {
        perigeeAltitudeKm: 400,
        apogeeAltitudeKm: 600,
        inclinationDeg: 51.6,
        regime: "LEO",
        sourceId: source.sourceId,
        sourceFile: source.sourceFile,
        recordId: "S65002",
        reconstructionVersion: "orbit-studio-gcat-reconstruction-v1",
        raanDegReconstructed: 118,
        argumentOfPeriapsisDegReconstructed: 58,
        meanAnomalyDegReconstructed: 42,
      },
    }),
    object({
      id: "satcat-25544",
      name: "International Space Station",
      launchDate: "1998-11-20T11:40:00.000Z",
    }),
    object({
      id: "satcat-50463",
      name: "James Webb Space Telescope",
      launchDate: "2021-12-25T12:20:00.000Z",
    }),
    object({
      id: "satcat-90000",
      name: "Unknown Launch Date",
    }),
    object({
      id: "satcat-70000",
      name: "Reentered Test Object",
      launchDate: "1960-01-01T00:00:00.000Z",
      reentryDate: "1960-02-01T00:00:00.000Z",
    }),
    object({
      id: "satcat-70001",
      name: "Future Orbit State Test Object",
      launchDate: "1960-01-01T00:00:00.000Z",
    }),
  ],
  orbitStates: [
    orbitState({
      id: "satcat-1:1957-10-04",
      objectId: "satcat-1",
      epoch: "1957-10-04T20:00:00.000Z",
    }),
    orbitState({
      id: "satcat-25544:1998-11-20",
      objectId: "satcat-25544",
      epoch: "1998-11-20T12:00:00.000Z",
    }),
    orbitState({
      id: "satcat-70001:1966-01-01",
      objectId: "satcat-70001",
      epoch: "1966-01-01T00:00:00.000Z",
    }),
  ],
};

const index = createHistoricalCatalogIndex(fixture);

describe("Explorer historical catalog pipeline", () => {
  it("reconstructs membership from lifecycle only", () => {
    expect(queryHistoricalCatalog(index, "1956-01-01T00:00:00.000Z").objects).toHaveLength(0);

    const firstDay = queryHistoricalCatalog(index, "1957-10-04T21:00:00.000Z");
    expect(firstDay.objects.map((item) => item.object.name)).toEqual(["Sputnik 1"]);

    const mid1965 = queryHistoricalCatalog(index, "1965-06-01T00:00:00.000Z");
    const mid1965Names = mid1965.objects.map((item) => item.object.name);
    expect(mid1965Names).toContain("1965 Catalog Only");
    expect(mid1965Names).toContain("1965 Reconstructed");
    expect(mid1965Names).toContain("Future Orbit State Test Object");
    expect(mid1965Names).not.toContain("International Space Station");
    expect(mid1965Names).not.toContain("James Webb Space Telescope");
  });

  it("adds ISS only after launch and excludes later launches from 2020", () => {
    expect(
      queryHistoricalCatalog(index, "1998-11-20T10:00:00.000Z")
        .objects.some((item) => item.object.name === "International Space Station"),
    ).toBe(false);

    expect(
      queryHistoricalCatalog(index, "1998-11-20T13:00:00.000Z")
        .objects.some((item) => item.object.name === "International Space Station"),
    ).toBe(true);

    const world2020 = queryHistoricalCatalog(index, "2020-01-01T00:00:00.000Z");
    expect(world2020.objects.some((item) => item.object.name === "James Webb Space Telescope")).toBe(false);
  });

  it("removes decayed or reentered objects and never includes unknown launch dates", () => {
    expect(
      historicalObjectExistsOnDate(
        fixture.objects.find((item) => item.id === "satcat-70000")!,
        "1960-03-01T00:00:00.000Z",
      ),
    ).toBe(false);

    const world = queryHistoricalCatalog(index, "2020-01-01T00:00:00.000Z");
    expect(world.objects.some((item) => item.object.name === "Unknown Launch Date")).toBe(false);
    expect(world.objects.some((item) => item.object.name === "Reentered Test Object")).toBe(false);
  });

  it("reports orbit availability without rendering fake orbits", () => {
    const firstDay = queryHistoricalCatalog(index, "1957-10-04T21:00:00.000Z");
    expect(firstDay.renderableObjects.map((item) => item.object.name)).toEqual(["Sputnik 1"]);
    expect(firstDay.byObjectId.get("satcat-1")?.orbitAvailability).toBe("exact-historical-orbit");

    const mid1965 = queryHistoricalCatalog(index, "1965-06-01T00:00:00.000Z");
    expect(mid1965.catalogOnlyObjects.map((item) => item.object.name)).toContain("1965 Catalog Only");
    expect(mid1965.catalogOnlyObjects.map((item) => item.object.name)).toContain(
      "Future Orbit State Test Object",
    );
    expect(mid1965.renderableObjects.map((item) => item.object.name)).not.toContain(
      "Future Orbit State Test Object",
    );
    expect(mid1965.byObjectId.get("satcat-65002")?.orbitAvailability)
      .toBe("reconstructed-historical-orbit");
    expect(mid1965.reconstructedOrbitStateCount).toBe(1);
    expect(mid1965.exactOrbitStateCount).toBe(0);
  });
});
