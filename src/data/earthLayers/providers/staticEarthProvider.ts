import type { EarthLayerDescriptor, EarthLayerProvider } from "../earthLayerTypes";

export const STATIC_EARTH_ASSETS = {
  base: {
    id: "nasa-blue-marble-january-5400",
    name: "NASA Blue Marble January Surface",
    textureUrl: "/earth/nasa-blue-marble-january-5400.jpg",
    textureUrls: {
      low: "/earth/nasa-blue-marble-january-5400.jpg",
      medium: "/earth/nasa-blue-marble-january-5400.jpg",
      high: "/earth/nasa-blue-marble-january-5400.jpg",
    },
    sourceUrl: "https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/",
    sourceAssetUrl: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/january/world.topo.bathy.200401.3x5400x2700.jpg",
    attribution: "NASA Blue Marble: Next Generation. NASA should be acknowledged as the source; no endorsement implied.",
  },
  cloudComposite: {
    id: "generated-earth-clouds",
    name: "Generated Cloud Reference Layer",
    textureUrl: "/placeholders/earth-clouds.svg",
    sourceUrl: "public/placeholders/earth-clouds.svg",
    sourceAssetUrl: "public/placeholders/earth-clouds.svg",
    attribution: "Project-authored generated placeholder.",
  },
  nightLights: {
    id: "generated-earth-night",
    name: "Generated Night Reference Layer",
    textureUrl: "/placeholders/earth-night.svg",
    sourceUrl: "public/placeholders/earth-night.svg",
    sourceAssetUrl: "public/placeholders/earth-night.svg",
    attribution: "Project-authored generated placeholder.",
  },
} as const;

export function createStaticEarthLayerDescriptors(): EarthLayerDescriptor[] {
  return [
    {
      id: STATIC_EARTH_ASSETS.base.id,
      name: STATIC_EARTH_ASSETS.base.name,
      source: STATIC_EARTH_ASSETS.base.sourceUrl,
      timestamp: "2004-07-01",
      imageryType: "surface-texture",
      supportsTransparentOverlay: false,
      textureUrl: STATIC_EARTH_ASSETS.base.textureUrl,
      attribution: STATIC_EARTH_ASSETS.base.attribution,
      enabled: true,
      opacity: 1,
      refreshIntervalMs: null,
      status: "loaded",
    },
    {
      id: STATIC_EARTH_ASSETS.cloudComposite.id,
      name: STATIC_EARTH_ASSETS.cloudComposite.name,
      source: STATIC_EARTH_ASSETS.cloudComposite.sourceUrl,
      timestamp: "2002-06-01",
      imageryType: "cloud-mask",
      supportsTransparentOverlay: true,
      textureUrl: STATIC_EARTH_ASSETS.cloudComposite.textureUrl,
      attribution: STATIC_EARTH_ASSETS.cloudComposite.attribution,
      enabled: true,
      opacity: 0.16,
      refreshIntervalMs: null,
      status: "loaded",
      fallbackState: "Used whenever live cloud imagery is unavailable.",
    },
    {
      id: STATIC_EARTH_ASSETS.nightLights.id,
      name: STATIC_EARTH_ASSETS.nightLights.name,
      source: STATIC_EARTH_ASSETS.nightLights.sourceUrl,
      timestamp: "2012-10-23",
      imageryType: "night-lights",
      supportsTransparentOverlay: true,
      textureUrl: STATIC_EARTH_ASSETS.nightLights.textureUrl,
      attribution: STATIC_EARTH_ASSETS.nightLights.attribution,
      enabled: true,
      opacity: 0.88,
      refreshIntervalMs: null,
      status: "loaded",
    },
  ];
}

export const staticEarthProvider: EarthLayerProvider = {
  id: "static-earth",
  name: "Public Earth Reference Layers",
  source: "NASA Blue Marble and Orbit Studio generated fallback layers",
  attribution: "NASA Blue Marble: Next Generation for the public surface map; project-authored generated fallback cloud and night layers.",
  getLayers: createStaticEarthLayerDescriptors,
};
