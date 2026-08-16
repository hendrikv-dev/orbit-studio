/**
 * Finding a place to observe from.
 *
 * The location contract asks for an address, a campground, a park, a trailhead
 * or a city — the places people actually go to look at the sky — with a pin as
 * the fallback for somewhere too remote to be in any database. It also requires
 * the provider to stay swappable and to cost nothing on the free path, which is
 * the same rule the weather adapters follow and the same type that enforces it.
 *
 * Photon is used because it needs no key, sends permissive CORS headers, and
 * indexes OpenStreetMap's `tourism=camp_site`, `leisure=park` and
 * `highway=trailhead` tags — a search for "yosemite valley campground" returns
 * the campground rather than the nearest city, which is the whole requirement.
 *
 * No metered geocoder is here, and none may be added to the free path. The
 * router below enforces that the same way the weather one does.
 */

export interface PlaceResult {
  id: string;
  /** What to show: "Yosemite Valley Backpacker Campground". */
  name: string;
  /** Enough to tell two similarly named places apart: county, region, country. */
  context: string;
  latitude: number;
  longitude: number;
  /** camp_site, park, peak, city… used only to pick an icon and to sort. */
  kind: string | null;
}

export interface GeocodingSourceInfo {
  id: string;
  name: string;
  attribution: string;
  cost: "public-no-fee" | "cost-bearing";
}

export interface GeocodingAdapter {
  source: GeocodingSourceInfo;
  search(query: string, signal?: AbortSignal): Promise<PlaceResult[]>;
}

/**
 * Places worth observing from, ranked above administrative noise.
 *
 * A search for a national park should not put a hotel of the same name first,
 * and a campsite search should not be buried under street addresses. Photon
 * ranks by its own relevance; this nudges the categories an observer means.
 */
const KIND_PRIORITY: Record<string, number> = {
  camp_site: 0,
  caravan_site: 0,
  wilderness_hut: 0,
  park: 1,
  national_park: 1,
  nature_reserve: 1,
  protected_area: 1,
  peak: 1,
  viewpoint: 1,
  trailhead: 1,
  city: 2,
  town: 2,
  village: 2,
  hamlet: 2,
};

function contextOf(properties: Record<string, unknown>): string {
  const parts = [
    properties.district,
    properties.city,
    properties.county,
    properties.state,
    properties.country,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    // A place whose name is also its city should not read "Tromsø, Tromsø".
    .filter((part, index, all) => all.indexOf(part) === index && part !== properties.name);
  return parts.slice(0, 3).join(", ");
}

export const photonAdapter: GeocodingAdapter = {
  source: {
    id: "photon",
    name: "Photon (OpenStreetMap)",
    attribution: "Place search © OpenStreetMap contributors, ODbL. Geocoding by Photon.",
    cost: "public-no-fee",
  },
  async search(query, signal) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Place search responded ${response.status}`);
    const body = await response.json();
    const features: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] =
      body?.features ?? [];

    return features
      .filter((feature) => typeof feature.properties?.name === "string")
      .map((feature, index) => {
        const properties = feature.properties;
        const kind = typeof properties.osm_value === "string" ? properties.osm_value : null;
        return {
          id: `${properties.osm_type ?? "x"}${properties.osm_id ?? index}`,
          name: String(properties.name),
          context: contextOf(properties),
          // GeoJSON is [longitude, latitude], which is the reverse of every
          // other coordinate in this codebase and the easiest thing here to
          // get backwards.
          longitude: feature.geometry.coordinates[0],
          latitude: feature.geometry.coordinates[1],
          kind,
        };
      })
      .map((place, index) => ({ place, index }))
      .sort((a, b) => {
        const rank = (entry: typeof a) => KIND_PRIORITY[entry.place.kind ?? ""] ?? 3;
        return rank(a) - rank(b) || a.index - b.index;
      })
      .map((entry) => entry.place);
  },
};

export const GEOCODING_ADAPTERS: GeocodingAdapter[] = [photonAdapter];

/**
 * The geocoder for the free path.
 *
 * Same enforcement as the weather router: a cost-bearing provider is never
 * returned unless explicitly allowed, so the rule is checked by the code rather
 * than remembered by whoever adds the next adapter.
 */
export function geocoderFor(allowCostBearing = false): GeocodingAdapter | null {
  return (
    GEOCODING_ADAPTERS.find(
      (adapter) => allowCostBearing || adapter.source.cost === "public-no-fee",
    ) ?? null
  );
}

/** A coordinate pair typed into the pin fallback, or null where it is not one. */
export function parseCoordinates(input: string): { latitude: number; longitude: number } | null {
  const match = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(input);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}
