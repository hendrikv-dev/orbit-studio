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
  /** What to show: "Yosemite Valley Campground", or "16 Ash Tree Grove". */
  name: string;
  /** Enough to tell two similarly named places apart: county, region, country. */
  context: string;
  latitude: number;
  longitude: number;
  /** camp_site, park, peak, city… used only to pick an icon and to sort. */
  kind: string | null;
  /** True where this is a street address rather than a named place. */
  isAddress: boolean;
  /** How closely the result matches the requested place/address. */
  matchPrecision: "exact-address" | "place";
}

export interface GeocodingSourceInfo {
  id: string;
  name: string;
  attribution: string;
  cost: "public-no-fee" | "cost-bearing";
}

/**
 * What a point on the map turns out to be.
 *
 * Deliberately not a `PlaceResult`. A search result is a place the reader asked
 * for by name and can be selected; this is a description of somewhere they
 * pointed at, which may be the middle of an ocean. The two are used
 * differently and separating them keeps a reverse lookup from being fed back
 * into the search list as though the reader had chosen it.
 */
export interface PlaceContext {
  /** "Mount Hood", "Portland". Null when nothing recognisable is near. */
  name: string | null;
  /** "Hood River County, Oregon". Empty when the source offers none. */
  context: string;
  /** How far the named thing is from the point asked about, in km. */
  distanceKm: number | null;
}

export interface GeocodingAdapter {
  source: GeocodingSourceInfo;
  search(query: string, signal?: AbortSignal): Promise<PlaceResult[]>;
  /**
   * What is at a point.
   *
   * Optional: an adapter that cannot answer simply does not, and the interface
   * falls back to coordinates rather than to a guess.
   */
  reverse?(
    latitudeDeg: number,
    longitudeDeg: number,
    signal?: AbortSignal,
  ): Promise<PlaceContext | null>;
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

/**
 * A label for a result that has no name.
 *
 * **A street address is not a named place.** Photon returns houses with
 * `housenumber` and `street` and no `name` at all, so requiring a name threw
 * every address away — "16 Ash Grove, Leeds" returned two correct houses and
 * the interface reported "Nothing found", while queries that happened to sit
 * near a named building resolved to the building instead of the address. That
 * one filter produced both halves of the reported fault.
 */
function labelFor(properties: Record<string, unknown>): { label: string; isAddress: boolean } {
  const name = typeof properties.name === "string" ? properties.name.trim() : "";
  if (name) return { label: name, isAddress: false };

  const houseNumber = typeof properties.housenumber === "string" ? properties.housenumber : "";
  const street = typeof properties.street === "string" ? properties.street : "";
  if (street) {
    return { label: [houseNumber, street].filter(Boolean).join(" "), isAddress: true };
  }
  // A postcode or a locality with nothing else is still somewhere to stand.
  const fallback = ["postcode", "city", "county", "state"]
    .map((key) => (typeof properties[key] === "string" ? (properties[key] as string) : ""))
    .find(Boolean);
  return { label: fallback ?? "", isAddress: Boolean(fallback) };
}

/** Leading house number in a query, which signals the reader wants an address. */
function queriedHouseNumber(query: string): string | null {
  return /^\s*(\d+[a-z]?)\b/i.exec(query)?.[1]?.toLowerCase() ?? null;
}

function normaliseStreet(value: string): string {
  return value
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Street portion before the first comma in a numbered address query. */
function queriedStreet(query: string): string | null {
  if (!queriedHouseNumber(query)) return null;
  const first = query.split(",", 1)[0] ?? "";
  const street = first.replace(/^\s*\d+[a-z]?\s+/i, "").trim();
  return street ? normaliseStreet(street) : null;
}

function contextOf(properties: Record<string, unknown>, label: string): string {
  const parts = [
    properties.postcode,
    properties.district,
    properties.city,
    properties.county,
    properties.state,
    properties.country,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    // A place whose name is also its city should not read "Tromsø, Tromsø".
    .filter((part, index, all) => all.indexOf(part) === index && part !== label);
  return parts.slice(0, 4).join(", ");
}

export const photonAdapter: GeocodingAdapter = {
  source: {
    id: "photon",
    name: "Photon (OpenStreetMap)",
    attribution: "Place search © OpenStreetMap contributors, ODbL. Geocoding by Photon.",
    cost: "public-no-fee",
  },
  async search(query, signal) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=12`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Place search responded ${response.status}`);
    const body = await response.json();
    const features: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] =
      body?.features ?? [];

    const wantedNumber = queriedHouseNumber(query);
    const wantedStreet = queriedStreet(query);

    const places = features
      .map((feature, index) => {
        const properties = feature.properties;
        const { label, isAddress } = labelFor(properties);
        if (!label) return null;
        const kind = typeof properties.osm_value === "string" ? properties.osm_value : null;
        const houseNumber =
          typeof properties.housenumber === "string" ? properties.housenumber.toLowerCase() : null;
        const street = typeof properties.street === "string" ? normaliseStreet(properties.street) : null;
        const exactAddress =
          wantedNumber !== null &&
          wantedStreet !== null &&
          houseNumber === wantedNumber &&
          street === wantedStreet;
        return {
          place: {
            id: `${properties.osm_type ?? "x"}${properties.osm_id ?? index}`,
            name: label,
            context: contextOf(properties, label),
            // GeoJSON is [longitude, latitude], the reverse of every other
            // coordinate in this codebase and the easiest thing here to invert.
            longitude: feature.geometry.coordinates[0],
            latitude: feature.geometry.coordinates[1],
            kind,
            isAddress,
            matchPrecision: exactAddress ? "exact-address" : "place",
          } satisfies PlaceResult,
          index,
          exactAddress,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      // A full numbered address is an identity claim, not a similarity search.
      // Never offer the right number on the wrong street as if it were exact.
      .filter((entry) => wantedNumber === null || entry.exactAddress);

    return places
      .sort((a, b) => {
        // A query that starts with a house number is an address lookup, and the
        // observer-category nudge below would otherwise float a park above the
        // very address that was typed.
        if (wantedNumber === null) {
          const rank = (entry: typeof a) => KIND_PRIORITY[entry.place.kind ?? ""] ?? 3;
          const difference = rank(a) - rank(b);
          if (difference !== 0) return difference;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.place)
      .slice(0, 8);
  },

  /**
   * What is at a point on the map.
   *
   * ## Why this exists
   *
   * "45.52° N 122.68° W" is a correct answer to a question nobody asked. A
   * reader who taps the map wants to know they landed near Portland, and
   * coordinates are the fallback for when nothing recognisable is there — not
   * the headline.
   *
   * ## The honesty rule
   *
   * Photon returns the nearest named feature at any distance, so a tap in the
   * middle of the Pacific comes back with an island six hundred kilometres
   * away. The distance is measured and returned, and the caller decides: past a
   * threshold the honest answer is the coordinates, because naming a place that
   * far off would be inventing context rather than resolving it.
   */
  async reverse(latitudeDeg, longitudeDeg, signal) {
    const url =
      `https://photon.komoot.io/reverse?lat=${latitudeDeg.toFixed(4)}` +
      `&lon=${longitudeDeg.toFixed(4)}&limit=1`;
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const body = await response.json();
    const feature = body?.features?.[0];
    if (!feature) return null;
    const properties = feature.properties as Record<string, unknown>;
    const described = describePoint(properties);
    if (!described) return null;
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    return {
      ...described,
      distanceKm: greatCircleKm(latitudeDeg, longitudeDeg, lat, lon),
    };
  },
};

/**
 * Features worth naming a place after.
 *
 * A reverse lookup returns the nearest *object*, and in a city centre that is a
 * bus stop. Naming the reader's location "Southwest Madison & 4th" is precise,
 * useless and slightly absurd — they pointed at Portland.
 *
 * These are the categories where the nearest object genuinely is the best
 * description: you are at Mount Hood, or in Deschutes National Forest, and no
 * administrative name says it better. Everything else falls through to the
 * settlement.
 */
/**
 * Features worth naming a point after, whatever grain the geocoder matched at.
 *
 * These are geography: they are on the map because of what the land is, so the
 * nearest one really is the best answer to "where am I".
 */
const NAMEABLE_FEATURES = new Set([
  "national_park",
  "nature_reserve",
  "protected_area",
  "peak",
  "volcano",
  "glacier",
  "island",
  "islet",
  "forest",
  "wood",
  "beach",
  "bay",
  "cape",
  "desert",
  "valley",
  "ridge",
  "water",
  "lake",
  "reservoir",
]);

/**
 * Features worth naming a point after only when they are not a single property.
 *
 * A campground, a viewpoint or a park can be the landmark that defines a place
 * — or it can be one business with a sign. The geocoder already tells the two
 * apart: it reports the grain it matched at, and `house` means it found an
 * individual address-level object. Naming a rural clearing after the private
 * campground nearest to it is how the panel came to announce "Mountindale Sun
 * Resort" to somebody who had clicked on a hillside.
 */
const NAMEABLE_WHEN_NOT_A_SINGLE_PROPERTY = new Set([
  "park",
  "viewpoint",
  "camp_site",
  "wilderness_hut",
]);
/**
 * What to call a point, at the grain a person would use.
 *
 * Named landmark first where there is one, then the settlement, then the
 * administrative area — because the question behind a reverse lookup is "where
 * am I", and the answer to that is "Portland", not the nearest street furniture.
 *
 * Returns null when nothing above a country is known, which is the honest
 * outcome for the middle of an ocean and is what sends the caller back to
 * coordinates.
 */
function describePoint(
  properties: Record<string, unknown>,
): { name: string; context: string } | null {
  const text = (key: string) =>
    typeof properties[key] === "string" && (properties[key] as string).trim().length > 0
      ? (properties[key] as string).trim()
      : null;

  const value = text("osm_value");
  const name = text("name");
  const city = text("city");
  const county = text("county");
  const state = text("state");
  const country = text("country");
  const district = text("district");
  // How fine a thing the geocoder matched. `house` is an individual property.
  const grain = text("type");

  // A landmark, where the nearest thing really is the best description.
  const namesThePlace =
    name &&
    value &&
    (NAMEABLE_FEATURES.has(value) ||
      (NAMEABLE_WHEN_NOT_A_SINGLE_PROPERTY.has(value) && grain !== "house"));
  if (namesThePlace) {
    return {
      name,
      context: [city, state, country].filter(Boolean).slice(0, 2).join(", "),
    };
  }

  if (city) {
    return {
      name: city,
      // The neighbourhood is worth having where it is known; it is how somebody
      // would actually place a point inside a city they know.
      context: [district, state, country].filter(Boolean).slice(0, 2).join(", "),
    };
  }
  // Out where there is no city, the locality is still the name people use, and
  // it is a great deal more use than a county called Washington in Oregon.
  if (district) return { name: district, context: [county, state].filter(Boolean).slice(0, 2).join(", ") };
  if (county) return { name: county, context: [state, country].filter(Boolean).join(", ") };
  if (state) return { name: state, context: country ?? "" };
  // A country alone is too coarse to be worth showing over the coordinates the
  // reader can already see on the pin.
  return null;
}

/** Straight-line distance between two points, for the honesty rule above. */
function greatCircleKm(
  aLatDeg: number,
  aLonDeg: number,
  bLatDeg: number,
  bLonDeg: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (bLatDeg - aLatDeg) * toRad;
  const dLon = (bLonDeg - aLonDeg) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLatDeg * toRad) * Math.cos(bLatDeg * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
