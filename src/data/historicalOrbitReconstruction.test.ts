import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { propagateTwoBody } from "../physics/kepler";
import {
  explorerHistoricalCatalog,
  type ExplorerHistoricalCatalogObject,
} from "./explorerHistoricalCatalog";
import { reconstructHistoricalOrbitState } from "./historicalOrbitReconstruction";

const source = {
  sourceId: "gcat:test",
  sourceFamily: "gcat" as const,
  sourceFile: "gcat-satcat-2026-06-27.tsv",
  recordId: "S00002",
};

const fixedTimestamp = "1957-12-31T12:00:00.000Z";

function fixture(
  id = "sputnik-1",
  reconstructedAngles = {
    raanDeg: 118,
    argumentOfPeriapsisDeg: 58,
    meanAnomalyDeg: 42,
  },
): ExplorerHistoricalCatalogObject {
  return {
    id,
    catalogNumber: id === "sputnik-1" ? "2" : "3",
    name: id,
    launchDate: "1957-10-04T19:28:34.000Z",
    owner: "OKB1",
    objectType: "PAYLOAD",
    orbitalSummary: {
      sourceEpoch: "1957-10-04T00:00:00.000Z",
      perigeeAltitudeKm: 214,
      apogeeAltitudeKm: 938,
      inclinationDeg: 65.1,
      regime: "LLEO/I",
      sourceId: source.sourceId,
      sourceFile: source.sourceFile,
      recordId: source.recordId,
      reconstructionVersion: "orbit-studio-gcat-reconstruction-v1",
      raanDegReconstructed: reconstructedAngles.raanDeg,
      argumentOfPeriapsisDegReconstructed:
        reconstructedAngles.argumentOfPeriapsisDeg,
      meanAnomalyDegReconstructed: reconstructedAngles.meanAnomalyDeg,
    },
    sources: [source],
  };
}

describe("historical orbit reconstruction", () => {
  it("is deterministic and retains explicit provenance", () => {
    const first = reconstructHistoricalOrbitState(fixture(), fixedTimestamp);
    const second = reconstructHistoricalOrbitState(fixture(), fixedTimestamp);

    expect(first).toEqual(second);
    expect(first?.stateKind).toBe("reconstructed");
    expect(first?.epoch).toBe(fixedTimestamp);
    expect(first?.reconstruction?.method).toBe("orbit-studio-gcat-reconstruction-v1");
    expect(first?.reconstruction?.synthesizedFields).toEqual([
      "raanDeg",
      "argumentOfPeriapsisDeg",
      "trueAnomalyDeg",
    ]);
  });

  it("reconstructs tracked GCAT source records identically at a fixed timestamp", () => {
    const sourceObjects = explorerHistoricalCatalog.objects
      .filter((object) => object.orbitalSummary && object.launchDate)
      .slice(0, 24);
    const fixedTimestamp = new Date("2026-06-27T12:00:00.000Z");

    expect(sourceObjects).toHaveLength(24);
    for (const sourceObject of sourceObjects) {
      const firstObject = JSON.parse(JSON.stringify(sourceObject)) as ExplorerHistoricalCatalogObject;
      const secondObject = JSON.parse(JSON.stringify(sourceObject)) as ExplorerHistoricalCatalogObject;
      const first = reconstructHistoricalOrbitState(firstObject, fixedTimestamp.toISOString());
      const second = reconstructHistoricalOrbitState(secondObject, fixedTimestamp.toISOString());

      expect(first, sourceObject.id).toEqual(second);
      expect(first?.orbit, sourceObject.id).toBeDefined();
      expect(
        propagateTwoBody({
          semiMajorAxisKm: EARTH_RADIUS_KM + first!.orbit!.altitudeKm,
          eccentricity: first!.orbit!.eccentricity,
          inclinationDeg: first!.orbit!.inclinationDeg,
          raanDeg: first!.orbit!.raanDeg,
          argumentOfPeriapsisDeg: first!.orbit!.argumentOfPeriapsisDeg,
          trueAnomalyDeg: first!.orbit!.trueAnomalyDeg,
          epoch: first!.orbit!.epoch,
        }, fixedTimestamp),
        sourceObject.id,
      ).toEqual(
        propagateTwoBody({
          semiMajorAxisKm: EARTH_RADIUS_KM + second!.orbit!.altitudeKm,
          eccentricity: second!.orbit!.eccentricity,
          inclinationDeg: second!.orbit!.inclinationDeg,
          raanDeg: second!.orbit!.raanDeg,
          argumentOfPeriapsisDeg: second!.orbit!.argumentOfPeriapsisDeg,
          trueAnomalyDeg: second!.orbit!.trueAnomalyDeg,
          epoch: second!.orbit!.epoch,
        }, fixedTimestamp),
      );
    }
  });

  it("honors source perigee, apogee, inclination, and regime constraints", () => {
    const state = reconstructHistoricalOrbitState(fixture(), fixedTimestamp)!;
    const orbit = state.orbit!;
    const semiMajorRadiusKm = EARTH_RADIUS_KM + orbit.altitudeKm;
    const perigeeAltitudeKm = semiMajorRadiusKm * (1 - orbit.eccentricity) - EARTH_RADIUS_KM;
    const apogeeAltitudeKm = semiMajorRadiusKm * (1 + orbit.eccentricity) - EARTH_RADIUS_KM;

    expect(perigeeAltitudeKm).toBeCloseTo(214, 8);
    expect(apogeeAltitudeKm).toBeCloseTo(938, 8);
    expect(orbit.inclinationDeg).toBe(65.1);
    expect(state.reconstruction?.regime).toBe("LLEO/I");
  });

  it("uses the package-provided deterministic angles without a browser-side hash", () => {
    const first = reconstructHistoricalOrbitState(
      fixture("sputnik-1"),
      fixedTimestamp,
    )!;
    const sibling = reconstructHistoricalOrbitState(
      fixture("sputnik-stage", {
        raanDeg: 211,
        argumentOfPeriapsisDeg: 93,
        meanAnomalyDeg: 177,
      }),
      fixedTimestamp,
    )!;

    expect(first.orbit?.raanDeg).toBe(118);
    expect(first.orbit?.argumentOfPeriapsisDeg).toBe(58);
    expect(sibling.orbit?.raanDeg).toBe(211);
    expect(sibling.orbit?.argumentOfPeriapsisDeg).toBe(93);
    expect(first.orbit?.trueAnomalyDeg).not.toBe(sibling.orbit?.trueAnomalyDeg);
  });

  it("propagates continuously from the selected period-end epoch", () => {
    const orbit = reconstructHistoricalOrbitState(fixture(), fixedTimestamp)!.orbit!;
    const initial = propagateTwoBody({
      semiMajorAxisKm: EARTH_RADIUS_KM + orbit.altitudeKm,
      eccentricity: orbit.eccentricity,
      inclinationDeg: orbit.inclinationDeg,
      raanDeg: orbit.raanDeg,
      argumentOfPeriapsisDeg: orbit.argumentOfPeriapsisDeg,
      trueAnomalyDeg: orbit.trueAnomalyDeg,
      epoch: orbit.epoch,
    }, new Date(orbit.epoch));
    const later = propagateTwoBody({
      semiMajorAxisKm: EARTH_RADIUS_KM + orbit.altitudeKm,
      eccentricity: orbit.eccentricity,
      inclinationDeg: orbit.inclinationDeg,
      raanDeg: orbit.raanDeg,
      argumentOfPeriapsisDeg: orbit.argumentOfPeriapsisDeg,
      trueAnomalyDeg: orbit.trueAnomalyDeg,
      epoch: orbit.epoch,
    }, new Date(Date.parse(orbit.epoch) + 1_000));

    expect(Math.hypot(
      later.positionKm[0] - initial.positionKm[0],
      later.positionKm[1] - initial.positionKm[1],
      later.positionKm[2] - initial.positionKm[2],
    )).toBeGreaterThan(1);
  });

  it("does not reconstruct unconstrained records", () => {
    const object = fixture();
    delete object.orbitalSummary;
    expect(reconstructHistoricalOrbitState(object, fixedTimestamp)).toBeUndefined();
  });

  it("keeps physically invalid source envelopes catalog-only", () => {
    const object = fixture();
    object.orbitalSummary = {
      ...object.orbitalSummary!,
      perigeeAltitudeKm: 0,
      apogeeAltitudeKm: 0,
    };

    expect(reconstructHistoricalOrbitState(object, fixedTimestamp)).toBeUndefined();
  });
});
