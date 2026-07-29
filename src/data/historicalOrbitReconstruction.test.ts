import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { propagateTwoBody } from "../physics/kepler";
import type { ExplorerHistoricalCatalogObject } from "./explorerHistoricalCatalog";
import { reconstructHistoricalOrbitState } from "./historicalOrbitReconstruction";

const source = {
  sourceId: "gcat:test",
  sourceFamily: "gcat" as const,
  sourceFile: "gcat-satcat.tsv",
  recordId: "S00002",
};

function fixture(id = "sputnik-1"): ExplorerHistoricalCatalogObject {
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
    },
    sources: [source],
  };
}

describe("historical orbit reconstruction", () => {
  it("is deterministic and retains explicit provenance", () => {
    const first = reconstructHistoricalOrbitState(fixture());
    const second = reconstructHistoricalOrbitState(fixture());

    expect(first).toEqual(second);
    expect(first?.stateKind).toBe("reconstructed");
    expect(first?.reconstruction?.method).toBe("metadata-constrained-keplerian-v1");
    expect(first?.reconstruction?.synthesizedFields).toEqual([
      "raanDeg",
      "argumentOfPeriapsisDeg",
      "trueAnomalyDeg",
    ]);
  });

  it("honors source perigee, apogee, inclination, and regime constraints", () => {
    const state = reconstructHistoricalOrbitState(fixture())!;
    const orbit = state.orbit!;
    const semiMajorRadiusKm = EARTH_RADIUS_KM + orbit.altitudeKm;
    const perigeeAltitudeKm = semiMajorRadiusKm * (1 - orbit.eccentricity) - EARTH_RADIUS_KM;
    const apogeeAltitudeKm = semiMajorRadiusKm * (1 + orbit.eccentricity) - EARTH_RADIUS_KM;

    expect(perigeeAltitudeKm).toBeCloseTo(214, 8);
    expect(apogeeAltitudeKm).toBeCloseTo(938, 8);
    expect(orbit.inclinationDeg).toBe(65.1);
    expect(state.reconstruction?.regime).toBe("LLEO/I");
  });

  it("shares a launch-family plane while maintaining stable object phase", () => {
    const first = reconstructHistoricalOrbitState(fixture("sputnik-1"))!;
    const sibling = reconstructHistoricalOrbitState(fixture("sputnik-stage"))!;

    expect(first.orbit?.raanDeg).toBe(sibling.orbit?.raanDeg);
    expect(first.orbit?.trueAnomalyDeg).not.toBe(sibling.orbit?.trueAnomalyDeg);
  });

  it("propagates continuously from its stable launch epoch", () => {
    const orbit = reconstructHistoricalOrbitState(fixture())!.orbit!;
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
    expect(reconstructHistoricalOrbitState(object)).toBeUndefined();
  });
});
