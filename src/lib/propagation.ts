import { ecefToGeodetic, eciToEcef } from "../physics/coordinates";
import {
  altitudeKm,
  orbitalPeriodSeconds,
  propagateTwoBody,
  speedKmS,
} from "../physics/kepler";
import { tleToCartesian } from "../physics/tle";
import type { CartesianState, GroundTrackPoint } from "../physics/types";
import type { SatelliteModel } from "./scenario";

export interface SatelliteReadouts {
  altitudeKm: number;
  velocityKmS: number;
  periodMinutes: number;
  inclinationDeg: number;
  eccentricity: number;
  latitudeDeg: number;
  longitudeDeg: number;
  propagationMode: string;
}

export function isRenderableCartesianState(state: CartesianState): boolean {
  return (
    Number.isFinite(Date.parse(state.epoch)) &&
    state.positionKm.length === 3 &&
    state.velocityKmS.length === 3 &&
    state.positionKm.every(Number.isFinite) &&
    state.velocityKmS.every(Number.isFinite) &&
    Math.hypot(...state.positionKm) > 0 &&
    Math.hypot(...state.velocityKmS) > 0
  );
}

export function propagateSatellite(satellite: SatelliteModel, targetDate: Date): CartesianState {
  if (satellite.propagationMode === "sgp4" && satellite.tle) {
    return tleToCartesian(satellite.tle, targetDate);
  }

  return propagateTwoBody(satellite.keplerian, targetDate);
}

export function getSatelliteReadouts(
  satellite: SatelliteModel,
  targetDate: Date,
): SatelliteReadouts {
  const state = propagateSatellite(satellite, targetDate);
  const geodetic = ecefToGeodetic(eciToEcef(state, targetDate));

  return {
    altitudeKm: altitudeKm(state),
    velocityKmS: speedKmS(state),
    periodMinutes: orbitalPeriodSeconds(satellite.keplerian.semiMajorAxisKm) / 60,
    inclinationDeg: satellite.keplerian.inclinationDeg,
    eccentricity: satellite.keplerian.eccentricity,
    latitudeDeg: geodetic.latitudeDeg,
    longitudeDeg: geodetic.longitudeDeg,
    propagationMode: satellite.propagationMode,
  };
}

export function sampleSatelliteGroundTrack(
  satellite: SatelliteModel,
  startDate: Date,
  durationSeconds: number,
  sampleCount: number,
): GroundTrackPoint[] {
  const points: GroundTrackPoint[] = [];
  const count = Math.max(2, sampleCount);

  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1);
    const date = new Date(startDate.getTime() + durationSeconds * ratio * 1000);
    const state = propagateSatellite(satellite, date);
    points.push({
      ...ecefToGeodetic(eciToEcef(state, date)),
      time: date.toISOString(),
    });
  }

  return points;
}
