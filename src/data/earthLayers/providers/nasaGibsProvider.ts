import type { EarthLayerDescriptor, EarthLayerProvider, EarthLayerStatus } from "../earthLayerTypes";

export const NASA_GIBS_WMS_ENDPOINT =
  "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

export const NASA_GIBS_WMTS_TILE_TEMPLATE =
  "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{time}/{matrixSet}/{z}/{y}/{x}.{format}";

export const NASA_GIBS_KNOWN_SAFE_DATE = "2021-09-21";

export const NASA_GIBS_LAYER_CANDIDATES = [
  {
    id: "MODIS_Terra_CorrectedReflectance_TrueColor",
    name: "MODIS Terra Corrected Reflectance True Color",
    format: "image/jpeg",
    matrixSet: "250m",
    imageryType: "true-color-overlay",
    supportsTransparentOverlay: false,
  },
  {
    id: "MODIS_Aqua_CorrectedReflectance_TrueColor",
    name: "MODIS Aqua Corrected Reflectance True Color",
    format: "image/jpeg",
    matrixSet: "250m",
    imageryType: "true-color-overlay",
    supportsTransparentOverlay: false,
  },
  {
    id: "MODIS_Terra_Water_Vapor_5km_Day",
    name: "MODIS Terra Water Vapor",
    format: "image/png",
    matrixSet: "2km",
    imageryType: "weather-data",
    supportsTransparentOverlay: true,
  },
  {
    id: "OMI_Aerosol_Index",
    name: "OMI Aerosol Index",
    format: "image/png",
    matrixSet: "2km",
    imageryType: "weather-data",
    supportsTransparentOverlay: true,
  },
] as const;

interface NasaGibsLayerOptions {
  layerId?: string;
  timestamp?: string;
  opacity?: number;
  enabled?: boolean;
  status?: EarthLayerStatus;
  message?: string;
  width?: number;
  height?: number;
}

export function dateForNearRealTimeGibs(now = new Date()): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - 2);
  return date.toISOString().slice(0, 10);
}

export function buildNasaGibsWmsTextureUrl({
  layerId = "MODIS_Terra_CorrectedReflectance_TrueColor",
  timestamp = NASA_GIBS_KNOWN_SAFE_DATE,
  width = 2048,
  height = 1024,
}: NasaGibsLayerOptions = {}): string {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layerId,
    STYLES: "",
    FORMAT: layerId.includes("CorrectedReflectance") ? "image/jpeg" : "image/png",
    TRANSPARENT: "true",
    CRS: "EPSG:4326",
    BBOX: "-90,-180,90,180",
    WIDTH: String(width),
    HEIGHT: String(height),
    TIME: timestamp,
  });

  return `${NASA_GIBS_WMS_ENDPOINT}?${params.toString()}`;
}

export function createNasaGibsLayerDescriptor(
  options: NasaGibsLayerOptions = {},
): EarthLayerDescriptor {
  const layerId = options.layerId ?? "MODIS_Terra_CorrectedReflectance_TrueColor";
  const candidate = NASA_GIBS_LAYER_CANDIDATES.find((layer) => layer.id === layerId);
  const timestamp = options.timestamp ?? NASA_GIBS_KNOWN_SAFE_DATE;
  const matrixSet = candidate?.matrixSet ?? "250m";
  const format = candidate?.format === "image/png" ? "png" : "jpg";

  return {
    id: "nasa-gibs-atmosphere",
    name: candidate?.name ?? "NASA GIBS Atmosphere Layer",
    source: NASA_GIBS_WMS_ENDPOINT,
    timestamp,
    imageryType: candidate?.imageryType ?? "true-color-overlay",
    supportsTransparentOverlay: candidate?.supportsTransparentOverlay ?? false,
    textureUrl: buildNasaGibsWmsTextureUrl({
      layerId,
      timestamp,
      width: options.width,
      height: options.height,
    }),
    tileUrlTemplate: NASA_GIBS_WMTS_TILE_TEMPLATE.replace("{layer}", layerId)
      .replace("{time}", timestamp)
      .replace("{matrixSet}", matrixSet)
      .replace("{format}", format),
    attribution:
      "NASA Global Imagery Browse Services (GIBS), Earthdata. Public WMS/WMTS imagery access.",
    enabled: options.enabled ?? false,
    opacity: options.opacity ?? 0.35,
    refreshIntervalMs: 6 * 60 * 60 * 1000,
    status: options.status ?? "idle",
    fallbackState: "If this layer fails or is not cloud-mask-safe, Orbit Studio keeps the static NASA cloud layer.",
    message:
      options.message ??
      "NASA GIBS true-color overlay. This is not treated as a transparent cloud mask.",
  };
}

export function createNasaGibsProvider(
  options: NasaGibsLayerOptions = {},
): EarthLayerProvider {
  return {
    id: "nasa-gibs",
    name: "NASA GIBS",
    source: NASA_GIBS_WMS_ENDPOINT,
    attribution: "NASA Global Imagery Browse Services (GIBS), Earthdata.",
    getLayers: () => [createNasaGibsLayerDescriptor(options)],
  };
}
