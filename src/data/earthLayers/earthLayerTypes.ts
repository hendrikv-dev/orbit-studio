export type EarthLayerStatus = "idle" | "loading" | "loaded" | "error";

export type EarthCloudMode = "off" | "static" | "live-nasa-gibs";

export interface EarthLayerDescriptor {
  id: string;
  name: string;
  source: string;
  timestamp: string | null;
  imageryType: "surface-texture" | "cloud-mask" | "night-lights" | "true-color-overlay" | "weather-data";
  supportsTransparentOverlay: boolean;
  textureUrl?: string;
  tileUrlTemplate?: string;
  attribution: string;
  enabled: boolean;
  opacity: number;
  refreshIntervalMs: number | null;
  status: EarthLayerStatus;
  fallbackState?: string;
  message?: string;
}

export interface EarthLayerProvider {
  id: string;
  name: string;
  source: string;
  attribution: string;
  getLayers: () => EarthLayerDescriptor[];
}
