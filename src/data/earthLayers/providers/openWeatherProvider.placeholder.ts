import type { EarthLayerDescriptor, EarthLayerProvider } from "../earthLayerTypes";

export const openWeatherProviderPlaceholder: EarthLayerProvider = {
  id: "openweather-placeholder",
  name: "OpenWeather Layers",
  source: "https://openweathermap.org/api",
  attribution: "OpenWeather weather map layers. Requires an API key; disabled by default.",
  getLayers: (): EarthLayerDescriptor[] => [
    {
      id: "openweather-clouds-placeholder",
      name: "OpenWeather Clouds",
      source: "https://openweathermap.org/api",
      timestamp: null,
      imageryType: "weather-data",
      supportsTransparentOverlay: true,
      attribution: "OpenWeather. Requires API key.",
      enabled: false,
      opacity: 0,
      refreshIntervalMs: null,
      status: "idle",
      fallbackState: "Disabled until an API key is configured.",
      message: "Requires API key",
    },
  ],
};
