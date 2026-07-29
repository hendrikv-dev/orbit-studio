import { describe, expect, it } from "vitest";
import { DEG_TO_RAD } from "./constants";
import { subsolarPoint, sunDirectionEcef } from "./time";

function surfaceNormalEcef(latitudeDeg: number, longitudeDeg: number): [number, number, number] {
  const latitude = latitudeDeg * DEG_TO_RAD;
  const longitude = longitudeDeg * DEG_TO_RAD;
  const cosLatitude = Math.cos(latitude);

  return [
    cosLatitude * Math.cos(longitude),
    cosLatitude * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("solar time geometry", () => {
  it("moves Greenwich from night side to day side as UTC time advances", () => {
    const midnight = sunDirectionEcef("2026-03-20T00:00:00.000Z");
    const noon = sunDirectionEcef("2026-03-20T12:00:00.000Z");

    expect(midnight[0]).toBeLessThan(-0.85);
    expect(noon[0]).toBeGreaterThan(0.85);
  });

  it("keeps the equinox subsolar latitude near the equator", () => {
    const point = subsolarPoint("2026-03-20T12:00:00.000Z");

    expect(Math.abs(point.latitudeDeg)).toBeLessThan(1);
  });

  it("puts Portland in daylight and Tokyo at night for a June morning in Pacific time", () => {
    const sun = sunDirectionEcef("2026-06-02T15:13:00.000Z");
    const portland = surfaceNormalEcef(45.5152, -122.6784);
    const tokyo = surfaceNormalEcef(35.6764, 139.65);

    expect(dot(sun, portland)).toBeGreaterThan(0.35);
    expect(dot(sun, tokyo)).toBeLessThan(-0.45);
  });
});
