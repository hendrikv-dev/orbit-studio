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
