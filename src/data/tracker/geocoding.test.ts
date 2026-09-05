import { afterEach, describe, expect, it, vi } from "vitest";
import { geocoderFor, parseCoordinates, photonAdapter } from "./geocoding";

afterEach(() => vi.unstubAllGlobals());

const feature = (properties: Record<string, unknown>, lon = -1.44, lat = 53.81) => ({
  properties,
  geometry: { coordinates: [lon, lat] },
});

function stub(features: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features }) }),
  );
}

describe("street addresses", () => {
  it("does not present similar streets as an exact numbered address", async () => {
    stub([
      feature({ osm_id: 1, housenumber: "16", street: "Ash Tree Grove", city: "Leeds", postcode: "LS14 5LT", osm_value: "house" }),
      feature({ osm_id: 2, housenumber: "16", street: "Ashton Grove", city: "Leeds", postcode: "LS8 5BR", osm_value: "house" }),
    ]);
    const results = await photonAdapter.search("16 Ash Grove, Leeds");
    expect(results).toEqual([]);
  });

  it("carries enough context to tell two close matches apart", async () => {
    stub([
      feature({ osm_id: 1, housenumber: "16", street: "Ash Tree Grove", city: "Leeds", postcode: "LS14 5LT" }),
    ]);
    const [result] = await photonAdapter.search("16 Ash Tree Grove, Leeds");
    expect(result.context).toMatch(/LS14 5LT/);
    expect(result.context).toMatch(/Leeds/);
  });

  it("accepts only the matching number and street for a full address", async () => {
    stub([
      feature({ osm_id: 1, name: "Roundhay Park", city: "Leeds", osm_value: "park" }),
      feature({ osm_id: 2, housenumber: "16", street: "Ash Tree Grove", city: "Leeds", osm_value: "house" }),
    ]);
    const results = await photonAdapter.search("16 Ash Tree Grove, Leeds");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("16 Ash Tree Grove");
    expect(results[0].matchPrecision).toBe("exact-address");
  });

  it("keeps a named landmark when its structured address matches exactly", async () => {
    stub([
      feature({
        osm_id: 3,
        name: "Empire State Building",
        housenumber: "350",
        street: "5th Avenue",
        city: "New York",
        postcode: "10118",
        osm_value: "attraction",
      }),
    ]);
    const results = await photonAdapter.search("350 5th Avenue, New York, NY 10118");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Empire State Building");
    expect(results[0].matchPrecision).toBe("exact-address");
  });

  it("still favours places worth observing from when no house number is typed", async () => {
    stub([
      feature({ osm_id: 1, name: "Leeds", osm_value: "city" }),
      feature({ osm_id: 2, name: "Hollingworth Lake Campsite", osm_value: "camp_site" }),
    ]);
    const results = await photonAdapter.search("leeds campsite");
    expect(results[0].name).toBe("Hollingworth Lake Campsite");
  });

  it("drops only what it genuinely cannot label", async () => {
    stub([feature({ osm_id: 1, osm_value: "yes" }), feature({ osm_id: 2, name: "Somewhere" })]);
    const results = await photonAdapter.search("something");
    expect(results.map((entry) => entry.name)).toEqual(["Somewhere"]);
  });
});

describe("the pin fallback", () => {
  it("reads a coordinate pair without contacting anyone", () => {
    expect(parseCoordinates("53.8192, -1.4409")).toEqual({ latitude: 53.8192, longitude: -1.4409 });
    expect(parseCoordinates("-33.87 151.21")).toEqual({ latitude: -33.87, longitude: 151.21 });
  });

  it("rejects things that are not coordinates", () => {
    expect(parseCoordinates("16 Ash Grove")).toBeNull();
    expect(parseCoordinates("95, 200")).toBeNull();
  });
});

describe("the cost boundary", () => {
  it("never returns a cost-bearing geocoder on the free path", () => {
    expect(geocoderFor()?.source.cost).toBe("public-no-fee");
  });
});
