import { degreesToRadians, radiansToDegrees } from "./constants";
import { eciToEcef, geodeticToEcef } from "./coordinates";
import type { CartesianState, GeodeticPosition, Vector3Tuple } from "./types";
import { dot, magnitude, subtract } from "./vector";

export interface GroundStationLike {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeMeters: number;
  minimumElevationDeg: number;
  antennaRangeKm?: number | null;
}

export interface ContactState {
  inContact: boolean;
  rangeKm: number;
  azimuthDeg: number;
  elevationDeg: number;
  stationEcefKm: Vector3Tuple;
  satelliteEcefKm: Vector3Tuple;
}

function normalizeAzimuth(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function localAxes(latitudeDeg: number, longitudeDeg: number): {
  east: Vector3Tuple;
  north: Vector3Tuple;
  up: Vector3Tuple;
} {
  const lat = degreesToRadians(latitudeDeg);
  const lon = degreesToRadians(longitudeDeg);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  return {
    east: [-sinLon, cosLon, 0],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    up: [cosLat * cosLon, cosLat * sinLon, sinLat],
  };
}

export function groundStationGeodetic(station: GroundStationLike): GeodeticPosition {
  return {
    latitudeDeg: station.latitudeDeg,
    longitudeDeg: station.longitudeDeg,
    altitudeKm: station.altitudeMeters / 1000,
  };
}

export function computeGroundContact(
  satelliteState: CartesianState,
  station: GroundStationLike,
  date: Date,
): ContactState {
  const stationEcefKm = geodeticToEcef(groundStationGeodetic(station));
  const satelliteEcefKm = eciToEcef(satelliteState, date);
  const rho = subtract(satelliteEcefKm, stationEcefKm);
  const rangeKm = magnitude(rho);
  const axes = localAxes(station.latitudeDeg, station.longitudeDeg);
  const east = dot(rho, axes.east);
  const north = dot(rho, axes.north);
  const up = dot(rho, axes.up);
  const elevationDeg = radiansToDegrees(Math.asin(up / rangeKm));
  const azimuthDeg = normalizeAzimuth(radiansToDegrees(Math.atan2(east, north)));
  const rangeAllowed = !station.antennaRangeKm || rangeKm <= station.antennaRangeKm;

  return {
    inContact: elevationDeg >= station.minimumElevationDeg && rangeAllowed,
    rangeKm,
    azimuthDeg,
    elevationDeg,
    stationEcefKm,
    satelliteEcefKm,
  };
}

export function sensorFootprintAngularRadiusDeg(
  altitudeKm: number,
  halfAngleDeg: number,
): number {
  if (!Number.isFinite(altitudeKm) || altitudeKm <= 0 || halfAngleDeg <= 0) {
    return 0;
  }

  // Simple nadir-pointing conic approximation, capped to avoid pretending precision at limb.
  return Math.min(85, (altitudeKm / 6378.137) * halfAngleDeg);
}
