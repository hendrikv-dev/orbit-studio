import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM, radiansToDegrees } from "../physics/constants";
import {
  eciToEcef,
  greenwichMeanSiderealTimeRad,
} from "../physics/coordinates";
import { GEO_VALIDATION_POINTS } from "./geoValidation";
import {
  ecefToEarthFixedThreeVector,
  eciToThreeVector,
  latLonToThreeVector,
} from "./coordinates";
import { Vector3 } from "three";

function normalizeLongitude(longitudeDeg: number): number {
  return ((longitudeDeg + 540) % 360) - 180;
}

function vectorToLatLon(vector: ReturnType<typeof latLonToThreeVector>) {
  const radius = vector.length();
  const latitudeDeg = radiansToDegrees(Math.asin(vector.y / radius));
  const longitudeDeg = normalizeLongitude(-radiansToDegrees(Math.atan2(vector.z, vector.x)));

  return { latitudeDeg, longitudeDeg };
}

describe("latLonToThreeVector", () => {
  it("matches the rendered Earth texture orientation", () => {
    const greenwich = latLonToThreeVector({ latitudeDeg: 0, longitudeDeg: 0 }, EARTH_RADIUS_KM);
    const west90 = latLonToThreeVector({ latitudeDeg: 0, longitudeDeg: -90 }, EARTH_RADIUS_KM);
    const east90 = latLonToThreeVector({ latitudeDeg: 0, longitudeDeg: 90 }, EARTH_RADIUS_KM);
    const northPole = latLonToThreeVector({ latitudeDeg: 90, longitudeDeg: 0 }, EARTH_RADIUS_KM);

    expect(greenwich.x).toBeCloseTo(EARTH_RADIUS_KM, 8);
    expect(greenwich.y).toBeCloseTo(0, 8);
    expect(greenwich.z).toBeCloseTo(0, 8);

    expect(west90.x).toBeCloseTo(0, 8);
    expect(west90.y).toBeCloseTo(0, 8);
    expect(west90.z).toBeCloseTo(EARTH_RADIUS_KM, 8);

    expect(east90.x).toBeCloseTo(0, 8);
    expect(east90.y).toBeCloseTo(0, 8);
    expect(east90.z).toBeCloseTo(-EARTH_RADIUS_KM, 8);

    expect(northPole.x).toBeCloseTo(0, 8);
    expect(northPole.y).toBeCloseTo(EARTH_RADIUS_KM, 8);
    expect(northPole.z).toBeCloseTo(0, 8);
  });

  it("round-trips known city and DSN validation coordinates", () => {
    GEO_VALIDATION_POINTS.forEach((point) => {
      const vector = latLonToThreeVector(point, EARTH_RADIUS_KM);
      const roundTrip = vectorToLatLon(vector);

      expect(roundTrip.latitudeDeg).toBeCloseTo(point.latitudeDeg, 8);
      expect(roundTrip.longitudeDeg).toBeCloseTo(point.longitudeDeg, 8);
    });
  });

  it("places Portland and Goldstone on the west-longitude side of the rendered Earth", () => {
    const portland = latLonToThreeVector(
      { latitudeDeg: 45.5152, longitudeDeg: -122.6784 },
      EARTH_RADIUS_KM,
    );
    const goldstone = latLonToThreeVector(
      { latitudeDeg: 35.4267, longitudeDeg: -116.89 },
      EARTH_RADIUS_KM,
    );

    expect(portland.z).toBeGreaterThan(0);
    expect(goldstone.z).toBeGreaterThan(0);
    expect(portland.y).toBeGreaterThan(0);
    expect(goldstone.y).toBeGreaterThan(0);
  });
});

describe("ecefToEarthFixedThreeVector", () => {
  it("places the subsatellite point directly beneath the inertial spacecraft", () => {
    const date = new Date("2026-06-20T18:00:00.000Z");
    const positionEciKm: [number, number, number] = [6_480, 1_720, 2_230];
    const earthRotation = greenwichMeanSiderealTimeRad(date);
    const surfaceWorld = ecefToEarthFixedThreeVector(
      eciToEcef(positionEciKm, date),
      EARTH_RADIUS_KM,
    )
      .applyAxisAngle(new Vector3(0, 1, 0), earthRotation)
      .normalize();
    const spacecraftDirection = eciToThreeVector(positionEciKm).normalize();

    expect(surfaceWorld.x).toBeCloseTo(spacecraftDirection.x, 8);
    expect(surfaceWorld.y).toBeCloseTo(spacecraftDirection.y, 8);
    expect(surfaceWorld.z).toBeCloseTo(spacecraftDirection.z, 8);
  });
});
