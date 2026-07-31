import { Vector3 } from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import type { ExplorerFocusPreset } from "../data/explorerVisuals";
import type { CameraFocusFrame } from "./CameraRig";

export const CATALOG_ONLY_EARTH_FRAMING_RADIUS_KM = EARTH_RADIUS_KM * 1.38;

export function isCatalogOnlyExplorerScene({
  scaleCatalogRendering,
  satelliteCount,
}: {
  scaleCatalogRendering: boolean;
  satelliteCount: number;
}): boolean {
  return scaleCatalogRendering && satelliteCount === 0;
}

export function createCatalogOnlyEarthFocusFrame({
  simulationEpoch,
  focusPreset,
  requestKey,
  viewDirection,
}: {
  simulationEpoch: string;
  focusPreset?: ExplorerFocusPreset;
  requestKey: number;
  viewDirection: Vector3;
}): CameraFocusFrame {
  return {
    key: `catalog-only-earth:${focusPreset ?? "default"}:${simulationEpoch}:${requestKey}`,
    target: new Vector3(),
    framingRadiusKm: CATALOG_ONLY_EARTH_FRAMING_RADIUS_KM,
    viewDirection: viewDirection.clone().normalize(),
  };
}
