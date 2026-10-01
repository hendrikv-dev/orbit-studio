# Tracker spatial system — dependency discovery and reuse matrix

Working notes for the spatial intelligence brief. Every licence, version and
activity date below was checked against the registry or the repository on
2026-08-18, not recalled. Where a claim was verified by running code, the output
is quoted.

The purpose of this document is to keep the choices auditable: what was
evaluated, what it already solves, and what Tracker would still have to build.

---

## Correction to a previous conclusion

An earlier note in this project claimed eclipse path generation was "genuine new
work" on the grounds that `astronomy-engine` returns only the point of greatest
eclipse. That reasoning was wrong — it established a gap in the *current
dependency*, not a gap in the *ecosystem*, and those are different questions.

`@astronomy-bundle/solar-eclipse` (MIT, zero dependencies, published 2026-07-26)
computes eclipse geometry from Besselian elements and ships a catalogue of them.
Verified by execution:

    2026-08-12 eclipse
      type ................. total, saros 126
      greatest eclipse ..... 65.22 N, -25.24 E   (off western Iceland — correct)
      central line ......... 582 points, Siberia (75.17 N, 113.49 E)
                             to the Mediterranean (38.70 N, 5.33 E)
      umbra polygon ........ 1242 points
      penumbra polygon ..... 1131 points
      local (Burgos) ....... total, obscuration 1.000, centre duration 103.9 s,
                             first contact 17:33:23 UTC
      local (Reykjavik) .... total, obscuration 1.000, centre duration 58.7 s
      local (Wood Village) . throws "No solar eclipse visible at this location"

Those match published circumstances for that eclipse, and the Oregon case is a
correct answer rather than a failure. Eclipse path geometry is therefore
**reuse, not new work**.

Two things found while verifying, both worth knowing before integrating:

- `getUmbraPathWidth()` returns **metres**, despite the name implying kilometres
  (293601 for a ~294 km path). Wrap it; do not pass it through.
- `getLocalEclipse(location)` takes a single object, not `(lat, lon)`. Passing
  two numbers throws the same "not visible" error as a genuinely invisible
  eclipse, so a careless integration cannot tell a bad call from a real answer.
  The adapter must construct the argument in one place.

---

## The overlap that needs a decision

Tracker now has two libraries able to answer "when is the next eclipse":

| | `astronomy-engine` (already a dependency) | `@astronomy-bundle/solar-eclipse` (candidate) |
|---|---|---|
| Next eclipse globally | `NextGlobalSolarEclipse` | catalogue enumeration |
| Next eclipse **here** | `NextLocalSolarEclipse(observer)` | per-date `getLocalEclipse` |
| Local circumstances | contact times, altitude, obscuration | contact times, magnitude, obscuration, duration |
| Path geometry | **none** | central line, umbra/penumbra polygons, limits |

The brief warns against two libraries solving one problem, and this is that case.
They are complementary in capability but overlapping in fact: **both can compute
an eclipse time, and independent implementations will not agree to the second.**

Tracker's own rule is that the map, the recommendation card, the local
calculation and the travel optimiser must never disagree. So the integration
must nominate a single authority per quantity rather than using whichever is
convenient at each call site — the same discipline that already governs
`chooseHero` and the window formatting.

Proposed split, to be confirmed:

- `astronomy-engine` stays authoritative for **event discovery and timing**,
  because it is already woven through ranking, observation periods and the
  schedule layer, and changing that would be a rewrite of working code.
- `@astronomy-bundle/solar-eclipse` is used **only for geometry** — path
  polygons, central line, path width — and for nothing that produces a time
  shown beside a recommendation.
- A cross-validation test asserts the two agree on peak time to within a stated
  tolerance for a set of known eclipses, and fails if they drift.

---

## Reuse matrix

### 1. Map renderer

| Candidate | Version / activity | Licence | Verdict |
|---|---|---|---|
| **MapLibre GL JS** | 6.4.1, published 2026-08-18; 11.4k stars; not archived | BSD-3-Clause (verified in `LICENSE.txt`, "Copyright (c) 2023, MapLibre contributors") | **Selected candidate** |
| OpenLayers | 10.10.0, 2026-07-27 | BSD-2-Clause | Credible; heavier API, weaker vector-tile/WebGL story for animated fields |
| Leaflet | 1.9.4, **published 2023-05-18** | BSD-2-Clause | Rejected: raster-first, no native vector tiles, three years since release |
| deck.gl | 9.3.10, 2026-08-11 | MIT | Not an alternative — an overlay layer engine. Possible *complement* for animated forecast fields if MapLibre's own layers prove insufficient |

MapLibre's licence history matters and checks out: it is the community fork
taken from Mapbox GL JS **before** the BSL relicence, and the current LICENSE is
plain BSD-3. No account, no token, no SDK terms.

Still Tracker's to build: the layer semantics, the legend, hover/tap readouts,
and the accessible text equivalents. The renderer supplies none of that meaning.

### 2. Basemap data

| Candidate | Licence | Verdict |
|---|---|---|
| **PMTiles** | Reference implementations BSD-3; **the specification itself is public domain / CC0** (verified in `LICENSE`) | **Selected candidate** |

A single-file archive served from project-controlled static storage or CDN
satisfies the stated posture exactly: self-hostable, no vendor account, no
mandatory third-party tile API, and not an attempt to bundle the world into the
app. Underlying OpenStreetMap data carries ODbL attribution, which Tracker
already handles for Photon geocoding — the same obligation, already met.

### 3. Astronomy overlays

| Capability | Source | Status |
|---|---|---|
| Eclipse path, limits, central line, shadow outline | `@astronomy-bundle/solar-eclipse` | Reuse (verified above) |
| Eclipse discovery and timing | `astronomy-engine` | Already present |
| Satellite/ISS pass geometry | `satellite.js` | Already present |
| Aurora field | NOAA SWPC OVATION | **Not yet investigated** |
| Meteor viewing potential | Tracker's own model | Tracker-specific by design |

### 4. Routing and isochrones

| Candidate | Activity | Licence | Isochrones |
|---|---|---|---|
| **Valhalla** | pushed 2026-08-19; 6.1k stars | **MIT** (verified: `LICENSE.md` → `COPYING`, "The MIT License (MIT)") | **Yes — documented `isochrone` API in core** |
| OSRM | pushed 2026-08-17; 8.0k stars | BSD-2-Clause | No isochrone endpoint in the documented API (matrix only) |
| GraphHopper | pushed 2026-08-15; 6.6k stars | Apache-2.0 | Yes |

Valhalla leads on the specific capability the travel optimiser needs — search
reachable area *by drive time*, not by radius.

**This is where the brief collides with the product's existing constraints, and
the conflict is real rather than a detail:**

All three are **servers**. Tracker today is a client-side application with no
backend, and the PRD carries a hard cost rule — anything that costs the
developer money is paid-users-only. Real drive-time isochrones therefore cannot
be a free, client-side capability. The options are a hosted Valhalla instance
(infrastructure cost, so paid-tier under the existing rule), an optional
third-party adapter (conflicts with vendor independence unless strictly
optional), or straight-line distance with the limitation stated in the interface
— which the brief already anticipates and permits.

This needs a product decision before any travel-optimiser code is written.

### 5. Geocoding

Tracker **already** uses Photon (Komoot) over OpenStreetMap, with attribution
and debouncing in place. No new dependency. Adding a second geocoder would be
exactly the duplication the brief warns against.

### 6. Environmental overlays

Cloud is already integrated through the existing provider-neutral weather
adapters. Smoke and light pollution are **not yet investigated** and should not
be assumed available.

---

## What Tracker still owns

Everything that makes the product itself, and nothing that a map library does:

- how opportunities are ranked, and how nights are compared against each other
- how travel value is judged, including the ability to conclude "stay here"
- how uncertainty is separated into astronomical, forecast, modelled and derived
- how conflicting evidence is explained rather than collapsed into a score
- the Tonight / Upcoming model the maps have to fit inside

---

## Open items, explicitly not yet investigated

Stated plainly so nothing here reads as more complete than it is:

- NOAA SWPC OVATION ingestion, coverage, cadence and licensing
- smoke and light-pollution sources
- geospatial interpolation and contour generation for probability fields
- bundle-size measurement for MapLibre + PMTiles against Tracker's budget
- accessibility behaviour of MapLibre's controls under the existing axe gate

---

# Second discovery pass — 2026-08-19

Corrections and closures. Everything here was measured or fetched, not recalled.

## Correction 1 — client-side routing exists

The earlier claim that every credible isochrone engine requires a server was
wrong. `omt-router` does car routing and isoline/reachability computation in the
browser from OpenMapTiles vector tiles.

    omt-router     1.0.4     published 2026-06-02   (first release 2026-05-25)
    licence        AGPL-3.0-only
    repository     github.com/AbelVM/omt-router — 33 stars, 3 open issues
    dependencies   @mapbox/vector-tile, d3-tricontour, kdbush, pbf, rbush

**But it is not selectable, and the blocker is licensing rather than quality.**
Tracker is MIT — confirmed in both `LICENSE` ("MIT License, Copyright (c) 2026
Orbit Studio contributors") and `package.json`. AGPL-3.0-only is a strong
copyleft: bundling it into the client bundle and serving that bundle to visitors
is distribution, so the copyleft attaches to the combined work and §13 adds a
network-use source obligation. Tracker could not remain MIT.

That is a project licensing decision, not an engineering one, so the performance
matrix (30-minute through 4-hour reachability, tile transfer, graph build time,
worker memory, cancellation, partial tiles) was **not** run. Running it would
spend real effort on a component that cannot ship under the current licence.
If the project is willing to relicense to AGPL-3.0, that testing becomes worth
doing and the finding reverses.

Its dependency list is still useful as a signpost: it demonstrates that vector
tiles already carrying the basemap can also carry a routable graph, which is the
architectural question worth keeping open regardless of this particular package.

**Routing remains unresolved.** Valhalla (MIT, native isochrones) is the mature
fallback. A permissively licensed client-side engine has not yet been found.

## Correction 2 — "server" does not imply "paid"

The earlier note slid from *this needs a backend* to *this must be paid-tier*,
which conflates four separate things:

1. fixed project infrastructure (a Valhalla instance, tile hosting)
2. marginal per-request cost
3. commercial third-party API cost
4. optional paid services

Only (3) is inherently a vendor bill. The basemap already implies (1) whichever
routing path is chosen, so backend execution on its own cannot draw the
free/paid boundary. The cost rule still applies, but it has to be applied to
actual marginal cost rather than to architecture.

## Correction 3 — the eclipse geometry is on an unstable branch

The stability risk was real and is worse than "recent". The repository README's
opening line reads:

> **Work in progress.** This is the next major version of astronomy-bundle and
> is not yet stable. If you are looking for the current stable release, see the
> README (version 7.7.7).

|                    | stable `astronomy-bundle@7.7.7` | `@astronomy-bundle/solar-eclipse@9.38.0` |
|--------------------|---------------------------------|------------------------------------------|
| Published          | 2024-04-15                      | 2026-07-26                               |
| Stability          | stable                          | explicitly "not yet stable"              |
| Local circumstances| yes                             | yes (verified)                           |
| **Path geometry**  | **no mentions in README**       | **yes (verified)**                       |

So the capability that justified calling this reuse exists **only** on the
unstable line. That does not reverse the finding — the code ran and produced
values matching published circumstances — but it changes the risk.

**A licensing gap compounds it.** npm metadata declares MIT, but:

- there is **no licence file in the repository root** (checked the tree), and
- **no licence file ships inside the package** (checked the installed tree).

The sole assertion is a metadata string. Tracker's own gate already demanded a
checksummed upstream licence file as evidence for one missing field on
`webgl-constants`; accepting an unsubstantiated claim on a dependency doing
scientific calculation would be a weaker standard than the project already
holds itself to. Resolving this — upstream issue, PR adding a LICENSE, or
vendoring with documented provenance — should precede adoption.

## Closed: contour and interpolation

| Package | Licence | Fit |
|---|---|---|
| **d3-contour** 4.0.2 | ISC | Marching squares on **gridded** data — correct for OVATION |
| d3-tricontour 1.1.0 | ISC | Contours from **scattered** data — not needed if the source is a grid |
| rbush 4.0.1 / kdbush 4.1.0 | MIT / ISC | Spatial indexing if hit-testing needs it |

## Closed: NOAA OVATION

Fetched live from `services.swpc.noaa.gov/json/ovation_aurora_latest.json`:

    payload            0.88 MB
    points             65,160  → exactly 360 x 181, a regular 1-degree grid
    format             [lon, lat, aurora%]
    observation time   2026-08-19T13:10Z
    forecast time      2026-08-19T13:59Z   (~49 minutes ahead)

Consequences:

- The grid is regular, so **d3-contour** applies and d3-tricontour is unnecessary.
- 0.88 MB per fetch is heavy for mobile and needs downsampling or caching.
- The forecast timestamp is exposed, which satisfies the data-age requirement.
- **It is a single frame, not a time series.** The brief's time scrubber and
  forecast animation are *not* supported by this endpoint. Frame sequences would
  need a different product or accumulation over time — an open question, not a
  solved one.
- NOAA/SWPC output is US Government work and therefore public domain.

## Closed: MapLibre bundle cost

Measured from the installed package, excluding type definitions and source maps:

    maplibre-gl.mjs           554 KB raw    138 KB gzip
    maplibre-gl-shared.mjs    471 KB raw    130 KB gzip
    maplibre-gl-worker.mjs     18 KB raw      6 KB gzip
    maplibre-gl.css            81 KB raw     10 KB gzip
    ----------------------------------------------------
    runtime total           ~1043 KB raw   ~274 KB gzip  (+10 KB CSS)

For scale, from the current production build:

    TrackerApp chunk          398 KB raw    131 KB gzip

MapLibre is therefore roughly **twice Tracker's entire current chunk**, gzipped.
That is affordable only because it is dynamically importable: a map is needed
only when a map is opened, so it should never enter the Tonight or Upcoming
initial load. Tracker already code-splits this way — Explorer sits in its own
16.5 MB chunk and never reaches Tracker users.

## Still open

- MapLibre control accessibility under the existing axe gate — **not tested**
- smoke data source — **not investigated**
- light-pollution data source — **not investigated**
- meteor viewing-potential inputs beyond what Tracker already computes
- client-side routing under a permissive licence — **no candidate found**
