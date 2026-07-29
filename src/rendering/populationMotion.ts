import { Vector3 } from "three";
import type { SatelliteModel } from "../lib/scenario";

interface PopulationScenePosition {
  timeMs: number;
  x: number;
  y: number;
  z: number;
}

const populationScenePositions = new WeakMap<SatelliteModel, PopulationScenePosition>();

export function cachePopulationScenePosition(
  satellite: SatelliteModel,
  timeMs: number,
  x: number,
  y: number,
  z: number,
): void {
  populationScenePositions.set(satellite, { timeMs, x, y, z });
}

export function readPopulationScenePosition(
  satellite: SatelliteModel,
  timeMs: number,
  target: Vector3,
): boolean {
  const cached = populationScenePositions.get(satellite);
  if (!cached || cached.timeMs !== timeMs) return false;
  target.set(cached.x, cached.y, cached.z);
  return true;
}
