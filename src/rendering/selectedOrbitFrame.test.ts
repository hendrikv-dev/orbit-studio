import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { createSatellite } from "../lib/scenario";
import { createSelectedOrbitFrame } from "./selectedOrbitFrame";

function satelliteAt(
  name: string,
  semiMajorAxisKm: number,
  eccentricity: number,
  inclinationDeg: number,
) {
  const epoch = new Date("2026-01-01T00:00:00.000Z");
  return createSatellite(name, epoch, {
    id: name,
    keplerian: {
      semiMajorAxisKm,
      eccentricity,
      inclinationDeg,
      raanDeg: 40,
      argumentOfPeriapsisDeg: 25,
      trueAnomalyDeg: 10,
      epoch: epoch.toISOString(),
    },
  });
}

describe("SelectedOrbitFrame", () => {
  it("keeps LEO Earth-centric while widening GPS framing", () => {
    const iss = createSelectedOrbitFrame(satelliteAt("iss", EARTH_RADIUS_KM + 420, 0.0005, 51.64));
    const gps = createSelectedOrbitFrame(satelliteAt("gps", 26560, 0.009, 55));

    expect(iss.orbitClass).toBe("LEO");
    expect(iss.target.length()).toBeLessThan(10);
    expect(gps.orbitClass).toBe("MEO");
    expect(gps.cameraDistanceKm).toBeGreaterThan(iss.cameraDistanceKm * 3);
  });

  it("fits a high-eccentricity Molniya orbit and shifts framing toward its bounds", () => {
    const molniya = createSelectedOrbitFrame(satelliteAt("molniya", 26600, 0.74, 63.4));

    expect(molniya.orbitClass).toBe("Molniya");
    expect(molniya.apogeeAltitudeKm).toBeGreaterThan(39000);
    expect(molniya.target.length()).toBeGreaterThan(EARTH_RADIUS_KM);
    expect(molniya.cameraDistanceKm).toBeGreaterThan(molniya.framingRadiusKm);
    expect(molniya.samplePoints.every((point) =>
      point.distanceTo(molniya.target) <= molniya.framingRadiusKm + 1,
    )).toBe(true);
  });

  it("classifies and fits GEO, GTO, and generic high Earth orbits", () => {
    const geo = createSelectedOrbitFrame(satelliteAt("geo", 42164, 0.001, 0.05));
    const gto = createSelectedOrbitFrame(satelliteAt("gto", 24500, 0.72, 27));
    const heo = createSelectedOrbitFrame(satelliteAt("heo", 52000, 0.12, 38));

    expect(geo.orbitClass).toBe("GEO");
    expect(gto.orbitClass).toBe("GTO");
    expect(heo.orbitClass).toBe("HEO");

    for (const frame of [geo, gto, heo]) {
      expect(frame.samplePoints.every((point) =>
        point.distanceTo(frame.target) <= frame.framingRadiusKm + 1,
      )).toBe(true);
    }
  });

  it("uses a cinematic oblique direction instead of a perpendicular orbit-plane view", () => {
    const frame = createSelectedOrbitFrame(satelliteAt("gps", 26560, 0.009, 55));
    const planeNormal = frame.samplePoints[0]
      .clone()
      .cross(frame.samplePoints[90])
      .normalize();
    const alignment = Math.abs(frame.viewDirection.dot(planeNormal));

    expect(alignment).toBeGreaterThan(0.5);
    expect(alignment).toBeLessThan(0.99);
    expect(frame.viewDirection.dot(frame.samplePoints[10])).toBeGreaterThan(0);
  });
});
