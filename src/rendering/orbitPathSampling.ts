import { Vector3 } from "three";
import { orbitalPeriodSeconds } from "../physics/kepler";
import type { SatelliteModel } from "../lib/scenario";
import { isRenderableCartesianState, propagateSatellite } from "../lib/propagation";
import { eciToThreeVector } from "./coordinates";

export function normalizedOrbitPathSampleCount(sampleCount: number): number {
  const finiteCount = Number.isFinite(sampleCount) ? Math.max(2, Math.round(sampleCount)) : 360;
  return finiteCount % 2 === 0 ? finiteCount : finiteCount + 1;
}

export function propagatedThreePosition(satellite: SatelliteModel, date: Date): Vector3 {
  const state = propagateSatellite(satellite, date);
  if (!isRenderableCartesianState(state)) {
    throw new Error("Invalid propagated orbit path state");
  }
  return eciToThreeVector(state.positionKm);
}

export function samplePropagatedOrbitPath(
  satellite: SatelliteModel,
  centerDate: Date,
  sampleCount = 360,
): Vector3[] {
  const count = normalizedOrbitPathSampleCount(sampleCount);
  const centerMs = centerDate.getTime();

  if (!Number.isFinite(centerMs)) {
    throw new Error("Invalid orbit path sample date");
  }

  const periodMs = orbitalPeriodSeconds(satellite.keplerian.semiMajorAxisKm) * 1000;

  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    throw new Error("Invalid orbit path period");
  }

  const startMs = centerMs - periodMs / 2;

  return Array.from({ length: count + 1 }, (_, index) =>
    propagatedThreePosition(
      satellite,
      new Date(startMs + (periodMs * index) / count),
    ),
  );
}
