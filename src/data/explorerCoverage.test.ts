import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  angularSeparationDeg,
  coverageEnvelope,
  estimateStationAccess,
  groundTrackLatitudeLimitDeg,
  longitudeDriftPerRevolutionDeg,
  normalizeLongitudeDeg,
  orbitalPeriodMinutes,
  revolutionsPerDay,
  splitTrackAtDateline,
  stationIsReachable,
  visibilityAngularRadiusDeg,
  type CoverageStation,
  type SubSatellitePoint,
} from "./explorerCoverage";

const iss = { semiMajorAltitudeKm: 420, eccentricity: 0.0004, inclinationDeg: 51.6 };
const sso = { semiMajorAltitudeKm: 700, eccentricity: 0.001, inclinationDeg: 98.2 };
const geo = { semiMajorAltitudeKm: 35786, eccentricity: 0.0002, inclinationDeg: 0.05 };

const svalbard: CoverageStation = {
  id: "svalbard", name: "Svalbard",
  latitudeDeg: 78.23, longitudeDeg: 15.39, minimumElevationDeg: 5,
};
const goldstone: CoverageStation = {
  id: "goldstone", name: "Goldstone",
  latitudeDeg: 35.25, longitudeDeg: -116.79, minimumElevationDeg: 10,
};

/** Reconstructed-phase stand-in: a circular track advancing in argument of latitude. */
function syntheticTrack(
  shape: { semiMajorAltitudeKm: number; inclinationDeg: number },
  startPhaseDeg: number,
  hours = 24,
  stepSeconds = 30,
): SubSatellitePoint[] {
  const period = orbitalPeriodMinutes(shape.semiMajorAltitudeKm) * 60;
  const inclination = (shape.inclinationDeg * Math.PI) / 180;
  const points: SubSatellitePoint[] = [];
  const total = (hours * 3600) / stepSeconds;
  for (let step = 0; step <= total; step += 1) {
    const t = step * stepSeconds;
    const u = ((startPhaseDeg * Math.PI) / 180) + (2 * Math.PI * t) / period;
    const latitude = Math.asin(Math.sin(inclination) * Math.sin(u));
    const rawLongitude =
      Math.atan2(Math.cos(inclination) * Math.sin(u), Math.cos(u)) - (2 * Math.PI * t) / 86164.1;
    points.push({
      latitudeDeg: (latitude * 180) / Math.PI,
      longitudeDeg: normalizeLongitudeDeg((rawLongitude * 180) / Math.PI),
      altitudeKm: shape.semiMajorAltitudeKm,
      timeMs: t * 1000,
    });
  }
  return points;
}

describe("explorer coverage geometry", () => {
  it("derives the visibility radius from altitude and the elevation mask", () => {
    // At the horizon the cap is the full geometric limb.
    const horizon = visibilityAngularRadiusDeg(420, 0);
    expect(horizon).toBeCloseTo(
      (Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + 420)) * 180) / Math.PI,
      6,
    );
    // A stricter mask always shrinks it.
    expect(visibilityAngularRadiusDeg(420, 10)).toBeLessThan(horizon);
    // Higher orbits see more.
    expect(visibilityAngularRadiusDeg(35786, 5)).toBeGreaterThan(visibilityAngularRadiusDeg(700, 5));
    expect(visibilityAngularRadiusDeg(0, 5)).toBe(0);
  });

  it("limits ground-track latitude to inclination, mirrored for retrograde orbits", () => {
    expect(groundTrackLatitudeLimitDeg(51.6)).toBeCloseTo(51.6, 6);
    expect(groundTrackLatitudeLimitDeg(98.2)).toBeCloseTo(81.8, 6);
    expect(groundTrackLatitudeLimitDeg(0)).toBe(0);
  });

  it("reports a coverage band wider than the track itself", () => {
    const envelope = coverageEnvelope(iss, 5);
    expect(envelope.trackLimitDeg).toBeCloseTo(51.6, 6);
    expect(envelope.coveredLimitDeg).toBeGreaterThan(envelope.trackLimitDeg);
    expect(envelope.surfaceFraction).toBeGreaterThan(0.7);
    expect(envelope.surfaceFraction).toBeLessThanOrEqual(1);
    // A GEO satellite's sub-point never leaves the equator but it still sees a lot.
    expect(coverageEnvelope(geo, 5).trackLimitDeg).toBeLessThan(1);
    expect(coverageEnvelope(geo, 5).coveredLimitDeg).toBeGreaterThan(70);
  });

  it("matches known orbital periods", () => {
    expect(orbitalPeriodMinutes(420)).toBeCloseTo(92.8, 0);
    expect(orbitalPeriodMinutes(35786)).toBeCloseTo(1436, 0);
    expect(revolutionsPerDay(420)).toBeCloseTo(15.5, 0);
    // Each LEO revolution lands well west of the previous one.
    expect(longitudeDriftPerRevolutionDeg(420)).toBeLessThan(-22);
    expect(longitudeDriftPerRevolutionDeg(420)).toBeGreaterThan(-24);
  });

  it("decides station reachability from geometry alone", () => {
    // The ISS never reaches Svalbard's latitude, and 420 km does not close a 26 deg gap.
    expect(stationIsReachable(svalbard, iss)).toBe(false);
    expect(stationIsReachable(goldstone, iss)).toBe(true);
    // A near-polar orbit does reach Svalbard.
    expect(stationIsReachable(svalbard, sso)).toBe(true);
  });

  it("measures great-circle separation", () => {
    expect(angularSeparationDeg(0, 0, 0, 90)).toBeCloseTo(90, 6);
    expect(angularSeparationDeg(90, 0, -90, 0)).toBeCloseTo(180, 6);
    expect(angularSeparationDeg(35, -116, 35, -116)).toBeCloseTo(0, 6);
  });

  it("keeps daily access rate stable across starting phases", () => {
    // This is the claim that makes the statistic publishable while the phase
    // itself is reconstructed: the rate must not depend on where we start.
    const rates = [0, 45, 90, 135, 180, 225, 270, 315].map(
      (phase) => estimateStationAccess(goldstone, sso, syntheticTrack(sso, phase)).accessesPerDay,
    );
    const mean = rates.reduce((sum, value) => sum + value, 0) / rates.length;
    const spread = Math.max(...rates) - Math.min(...rates);
    expect(mean).toBeGreaterThan(0);
    // Spread across all starting phases stays a small share of the mean.
    expect(spread / mean).toBeLessThan(0.35);
  });

  it("reports no access for a station the orbit cannot reach", () => {
    const access = estimateStationAccess(svalbard, iss, syntheticTrack(iss, 0));
    expect(access.reachable).toBe(false);
    expect(access.accessesPerDay).toBe(0);
    expect(access.visibleFraction).toBe(0);
  });

  it("splits the track so it never wraps across the map", () => {
    const track: SubSatellitePoint[] = [
      { latitudeDeg: 0, longitudeDeg: 170, altitudeKm: 400, timeMs: 0 },
      { latitudeDeg: 1, longitudeDeg: 179, altitudeKm: 400, timeMs: 1000 },
      { latitudeDeg: 2, longitudeDeg: -178, altitudeKm: 400, timeMs: 2000 },
      { latitudeDeg: 3, longitudeDeg: -170, altitudeKm: 400, timeMs: 3000 },
    ];
    const segments = splitTrackAtDateline(track);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(2);
    for (const segment of segments) {
      for (let index = 1; index < segment.length; index += 1) {
        expect(Math.abs(segment[index].longitudeDeg - segment[index - 1].longitudeDeg)).toBeLessThan(180);
      }
    }
  });

  it("normalizes longitude into the map range", () => {
    expect(normalizeLongitudeDeg(190)).toBeCloseTo(-170, 6);
    expect(normalizeLongitudeDeg(-190)).toBeCloseTo(170, 6);
    expect(normalizeLongitudeDeg(45)).toBeCloseTo(45, 6);
  });
});
