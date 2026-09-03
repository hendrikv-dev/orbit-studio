# Orbit Studio Source Notes

Orbit Studio's active Earth rendering path uses a verified NASA Blue Marble surface texture with a
subtle locally vendored Natural Earth 110m vector coastline overlay. Generated Earth textures remain
fallbacks for environments that cannot load public image assets.

## Earth Texture Source

- Surface texture: NASA Blue Marble: Next Generation, Base Map with Topography and Bathymetry,
  January.
- Bundled file: `public/earth/nasa-blue-marble-january-5400.jpg`.
- Source page:
  https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
- Source asset:
  https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/january/world.topo.bathy.200401.3x5400x2700.jpg
- Processing: downloaded on 2026-07-04 with `curl -L`; no resizing, cropping, color editing, or
  recompression.
- Land source: Natural Earth 110m land GeoJSON, vendored at
  `src/data/natural-earth/ne_110m_land.geojson.json`.
- Runtime fallback texture generation: `src/rendering/proceduralTextureFallbacks.ts`.
- Active Earth sphere: `src/rendering/Earth.tsx`.

Legacy NASA raster assets remain ignored under `data/local-only/earth/` when present because those
copies did not preserve exact source-page URLs and processing history. Do not restore them directly;
source replacements from official pages and update `provenance/inventory.json`, then regenerate the
notices.

## Legacy Atmosphere Data Hooks

`src/data/earthLayers/providers/nasaGibsProvider.ts` defines a NASA GIBS WMS/WMTS provider for
near-real-time imagery. These providers are retained as inactive legacy hooks and are not consumed
by the active Explorer/Playground renderer. MODIS corrected-reflectance true-color layers were
previously treated as data overlays rather than transparent cloud masks.

`src/data/earthLayers/providers/openWeatherProvider.placeholder.ts` is intentionally disabled and
contains no API key. OpenWeather cloud, precipitation, pressure, temperature, and wind overlays can
be added later once the user provides credentials.

NOAA GOES and NASA SatCORPS global mosaic data may be useful for higher-fidelity cloud/weather
animation later, especially for animated operational weather layers. They are not implemented in
the Explorer/Playground renderer.

Tracker does use GOES, and not as imagery: `netlify/functions/goes-cloud-mask.mts` reads the ABI
Level-2 Clear Sky Mask through Unidata's THREDDS server, and `src/data/tracker/cloudObservation.ts`
presents it as the per-pixel classification it is. See the `noaa-goes-clear-sky-mask` entry in
`provenance/inventory.json` for the rights basis and the restrictions that come with it.

Bundled ground station entries are approximate Deep Space Network demo stations. They are included
only to exercise editing, contact analysis, and coverage visualization workflows.

The Playground sample catalog layer is deliberately small and bundled.

The public Explorer build deliberately contains no CelesTrak GP or Space-Track response records.
Its single satellite authority is the verified Orbit Studio Satellite Source of Truth v1.0.0
package under `data/satellite-source-of-truth/`, built from Jonathan McDowell's GCAT `satcat`
snapshot dated 2026-06-27 and licensed CC BY 4.0.

The canonical query database is
`data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite`. The immutable upstream
evidence is `data/satellite-source-of-truth/raw/gcat-satcat-2026-06-27.tsv`. The package also
contains normalized exchange data, 1957–2026 annual membership, reconstruction candidates, quality
issues, schemas, build tools, provenance, and exact checksums.

`scripts/build-satellite-web-catalog.py` verifies that package and produces the only browser
derivative, `src/data/generated/satelliteCatalog.web.json`. It contains every Earth-associated GCAT
payload, rocket body, component, and debris record needed for the supported history—not a bounded
sample. Completed years deliberately use `present_at_period_end`; the final 2026 period is partial
and deliberately uses `snapshot_present_earth_objects`.

Source identity, classification, lifecycle membership, orbit epoch, perigee, apogee, and inclination
remain source-backed fields. Missing angular elements are deterministic package/export
reconstructions keyed by JCAT identity. The browser only converts the reconstructed mean anomaly to
the true anomaly used by the shared propagator. It must not describe reconstructed states as live,
observed, current tracking, or exact historical positions.

The latest snapshot contains 33,489 source-backed Earth-object members: 33,468 with physically valid
educational reconstructions and 21 catalog-only rows. The broad supported history contains 69,620
Earth-associated four-class records, 69,376 reconstruction-capable rows, and 244 catalog-only rows.
Package verification is `npm run satellites:verify`; deterministic regeneration is
`npm run satellites:build`.

## Provenance Authority

Exact source URLs, publishers, immutable identifiers or snapshot dates, checksums, processing,
rights evidence, attribution, source/deployment decisions, and Release 1.0 inclusion status are
recorded only in `provenance/inventory.json`. `ATTRIBUTION.md` and this directory's Earth notice are
generated views. Do not hand-edit them.

Run `npm run provenance:generate` after an intentional inventory update and
`npm run provenance:validate` after building. The validator audits the actual tracked and
non-ignored untracked current source, the actual Vite output, checksums, prohibited local paths,
attribution parity, and dependency notices. Ignored private acquisitions are intentionally outside
the current-tree audit. Run `npm run history:validate` for publishable ancestry and
`npm run source:archive` for a verified tracked-`HEAD` source package.

## Star Field

Public builds use the magnitude-limited authentic catalog in
`src/data/stars/hygBrightStars.v41.json`, generated from HYG Database v4.1. The runtime file contains
all 1,839 non-Sun records with apparent visual magnitude `V <= 5.1`; it does not mix in procedural
or fictional filler stars. The source fields include J2000 coordinates, magnitude, B-V color index,
Cartesian position, and space velocity for proper-motion updates in the inertial EQJ frame.

- Upstream: HYG Database v4.1 by David Nash
- Source: <https://github.com/astronexus/HYG-Database>
- License: Creative Commons Attribution-ShareAlike 4.0 International
- Local generation and field documentation: `src/data/stars/README.md`
- Generation script: `scripts/build-hyg-bright-stars.mjs`
- Bundled license copy: `src/data/stars/LICENSE-CC-BY-SA-4.0.txt`
