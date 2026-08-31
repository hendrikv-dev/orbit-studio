import { describe, expect, it } from "vitest";
import {
  apparentAngleDeg,
  assessTerrain,
  horizonAlongBearing,
  roundedHorizon,
  sampleDistances,
} from "./terrainHorizon";
import { destination, distanceM } from "./geodesy";
import { crossings } from "./eventTerrain";

const OBSERVER = { latitudeDeg: 45.5, longitudeDeg: -122.7, elevationM: 100 };

/** Ground everywhere at one height. */
const flatAt = (elevationM: number) => () => elevationM;

/**
 * A ridge of a given height, `atKm` away on `bearingDeg`.
 *
 * Built from real geodesic positions rather than from a grid, so the fixture
 * exercises the same coordinate maths the live path does.
 *
 * Deliberately narrow. A wide band of high ground has its *near* edge much
 * closer than its centre, and the steepest angle comes from there — a four
 * kilometre ridge "at five kilometres" actually starts at three and subtends
 * thirteen degrees rather than nine. That is correct behaviour and a misleading
 * fixture, so the crest is kept thin enough that `atKm` means what it says.
 */
function ridge(bearingDeg: number, atKm: number, heightM: number, widthKm = 0.6) {
  const crest = destination(
    OBSERVER.latitudeDeg,
    OBSERVER.longitudeDeg,
    atKm * 1000,
    bearingDeg,
  );
  return (latitudeDeg: number, longitudeDeg: number): number => {
    const away =
      distanceM(latitudeDeg, longitudeDeg, crest.latitudeDeg, crest.longitudeDeg) / 1000;
    return away <= widthKm ? heightM : 50;
  };
}

describe("the terrain horizon", () => {
  it("puts most of its samples close in, where hills matter", () => {
    const distances = sampleDistances();
    expect(distances[0]).toBeLessThan(50);
    expect(distances[distances.length - 1]).toBeLessThanOrEqual(60_000);
    const within10km = distances.filter((d) => d <= 10_000).length;
    expect(within10km / distances.length).toBeGreaterThan(0.4);
  });

  it("accounts for the Earth's curvature over a long sightline", () => {
    // Ground level with the observer, forty kilometres away, is well below the
    // horizontal — flat geometry would call it zero.
    const angle = apparentAngleDeg(0, 40_000);
    expect(angle).toBeLessThan(-0.1);
    expect(angle).toBeGreaterThan(-0.35);
    // Close in, curvature is negligible and the angle is essentially flat.
    expect(apparentAngleDeg(0, 200)).toBeCloseTo(0, 2);
  });

  /* --- the cases §41 asks for -------------------------------------------- */

  it("flat terrain below the observer: a target well up is clear", () => {
    const horizon = horizonAlongBearing(OBSERVER, 135, flatAt(50));
    expect(horizon.sampled).toBeGreaterThan(10);
    expect(horizon.angleDeg).toBeLessThan(0);
    expect(assessTerrain(horizon, 30).verdict).toBe("clear");
  });

  it("a ridge higher than the target blocks it", () => {
    // 900 m of hill five kilometres away is about nine degrees up.
    const horizon = horizonAlongBearing(OBSERVER, 135, ridge(135, 5, 900));
    expect(roundedHorizon(horizon.angleDeg)).toBeGreaterThan(7);
    expect(assessTerrain(horizon, 4).verdict).toBe("blocked");
    expect(assessTerrain(horizon, 30).verdict).toBe("clear");
  });

  it("gives different answers on different bearings from the same place", () => {
    const dem = ridge(135, 5, 900);
    const southEast = horizonAlongBearing(OBSERVER, 135, dem);
    const northWest = horizonAlongBearing(OBSERVER, 315, dem);
    expect(assessTerrain(southEast, 4).verdict).toBe("blocked");
    expect(assessTerrain(northWest, 4).verdict).toBe("clear");
  });

  it("reports how far away the blocking ground is", () => {
    const horizon = horizonAlongBearing(OBSERVER, 90, ridge(90, 12, 1400));
    const assessment = assessTerrain(horizon, 3);
    expect(assessment.verdict).toBe("blocked");
    expect(assessment.ridgeDistanceKm).toBeGreaterThan(10);
    expect(assessment.ridgeDistanceKm).toBeLessThan(14);
  });

  it("says unknown rather than assuming flat when the DEM has nothing", () => {
    const horizon = horizonAlongBearing(OBSERVER, 90, () => null);
    expect(horizon.sampled).toBe(0);
    const assessment = assessTerrain(horizon, 5);
    expect(assessment.verdict).toBe("unknown");
    expect(assessment.horizonDeg).toBeNull();
  });

  it("is honest rather than binary when the target sits on the horizon", () => {
    const horizon = horizonAlongBearing(OBSERVER, 180, ridge(180, 6, 700));
    // Exactly at the computed horizon: the answer is that it is too close to call.
    expect(assessTerrain(horizon, horizon.angleDeg).verdict).toBe("marginal");
    // And just outside the uncertainty it commits.
    expect(assessTerrain(horizon, horizon.angleDeg + horizon.uncertaintyDeg * 2).verdict).toBe(
      "clear",
    );
    expect(assessTerrain(horizon, horizon.angleDeg - horizon.uncertaintyDeg * 2).verdict).toBe(
      "blocked",
    );
  });

  it("carries an uncertainty that grows with distance", () => {
    const near = horizonAlongBearing(OBSERVER, 45, ridge(45, 2, 400));
    const far = horizonAlongBearing(OBSERVER, 45, ridge(45, 40, 2500));
    expect(near.uncertaintyDeg).toBeGreaterThan(0);
    expect(far.uncertaintyDeg).toBeGreaterThan(0);
    // The same vertical error subtends a smaller angle further away, so the
    // stated uncertainty must fall rather than being a constant.
    expect(far.uncertaintyDeg).toBeLessThan(near.uncertaintyDeg);
  });

  it("does not invent precision", () => {
    expect(roundedHorizon(4.37)).toBe(4.5);
    expect(roundedHorizon(4.1)).toBe(4);
    expect(roundedHorizon(-0.26)).toBe(-0.5);
  });

  it("gives the same answer either side of the antimeridian", () => {
    const east = { latitudeDeg: 0, longitudeDeg: 179.95, elevationM: 0 };
    const dem = (lat: number, lon: number) => {
      // A ridge just east of the seam, expressed in canonical coordinates.
      const wrapped = ((lon + 540) % 360) - 180;
      return Math.abs(wrapped - (-179.9)) < 0.1 && Math.abs(lat) < 0.1 ? 800 : 0;
    };
    const across = horizonAlongBearing(east, 90, dem, 30_000);
    expect(across.sampled).toBeGreaterThan(0);
    expect(across.angleDeg).toBeGreaterThan(1);
  });
});

describe("crossing the terrain horizon", () => {
  /** A target climbing from below a five-degree ridge to well above it. */
  const rising = Array.from({ length: 13 }, (_, index) => ({
    atUtc: new Date(Date.UTC(2026, 7, 29, 22 + Math.floor(index / 4), (index % 4) * 15)).toISOString(),
    azimuthDeg: 135,
    altitudeDeg: index,
  }));

  it("says when a rising target clears terrain", () => {
    const { clearsAtUtc, dropsAtUtc } = crossings(rising, () => 5);
    expect(clearsAtUtc).not.toBeNull();
    expect(dropsAtUtc).toBeNull();
    // It crosses between the 5° and 6° samples.
    expect(new Date(clearsAtUtc!).getUTCHours()).toBe(23);
    expect(new Date(clearsAtUtc!).getUTCMinutes()).toBe(30);
  });

  it("says when a setting target drops behind terrain", () => {
    const setting = [...rising].reverse().map((point, index) => ({
      ...point,
      atUtc: rising[index].atUtc,
    }));
    const { clearsAtUtc, dropsAtUtc } = crossings(setting, () => 5);
    expect(dropsAtUtc).not.toBeNull();
    expect(clearsAtUtc).toBeNull();
  });

  it("reports neither when the target never crosses", () => {
    expect(crossings(rising, () => -5)).toEqual({ clearsAtUtc: null, dropsAtUtc: null });
    expect(crossings(rising, () => 90)).toEqual({ clearsAtUtc: null, dropsAtUtc: null });
  });

  it("uses the horizon for the bearing the object is actually on", () => {
    // Clear to the east, blocked to the west; the object swings from one to the
    // other while holding altitude, so terrain takes it even as it does not set.
    const swinging = [90, 135, 180, 225, 270].map((azimuthDeg, index) => ({
      atUtc: new Date(Date.UTC(2026, 7, 29, 22 + index)).toISOString(),
      azimuthDeg,
      altitudeDeg: 10,
    }));
    const { dropsAtUtc } = crossings(swinging, (bearing) => (bearing >= 225 ? 20 : 2));
    expect(dropsAtUtc).not.toBeNull();
    expect(new Date(dropsAtUtc!).getUTCHours()).toBe(1);
  });

  it("skips bearings with no terrain data rather than treating them as flat", () => {
    const { clearsAtUtc } = crossings(rising, (bearing) => (bearing === 135 ? null : 5));
    expect(clearsAtUtc).toBeNull();
  });
});
