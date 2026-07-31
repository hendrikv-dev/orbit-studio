export type {
  EarthCloudMode,
  EarthLayerDescriptor,
  EarthLayerProvider,
  EarthLayerStatus,
} from "./earthLayerTypes";
export {
  STATIC_EARTH_ASSETS,
  createStaticEarthLayerDescriptors,
  staticEarthProvider,
} from "./providers/staticEarthProvider";
export {
  NASA_GIBS_KNOWN_SAFE_DATE,
  NASA_GIBS_LAYER_CANDIDATES,
  buildNasaGibsWmsTextureUrl,
  createNasaGibsLayerDescriptor,
  createNasaGibsProvider,
  dateForNearRealTimeGibs,
} from "./providers/nasaGibsProvider";
export { openWeatherProviderPlaceholder } from "./providers/openWeatherProvider.placeholder";
