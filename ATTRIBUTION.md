# Attribution and Third-Party Material

<!-- Generated from provenance/inventory.json. Do not edit by hand. -->

Orbit Studio source code is MIT-licensed. Third-party data, imagery, generated subsets,
scientific reference outputs, and dependency code remain governed by their recorded terms.

## CelesTrak current General Perturbations data

- Inventory ID: `celestrak-current-gp-local-acquisition`
- Category: current-orbital-data
- Release status: local-only
- Release 1.0 included: no
- Publisher or rights holder: CelesTrak / Dr. T.S. Kelso
- Version or snapshot: Live service; no release snapshot retained in public source
- Authoritative source: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- Authoritative source: https://celestrak.org/NORAD/elements/gp.php
- Rights basis: CelesTrak's official usage policy permits documented consumer acquisition and requires rate-conscious caching behavior, but no authoritative grant was found for committing, deploying, or redistributing snapshots or transformed records.
- Rights evidence: https://celestrak.org/usage-policy.php
- Rights evidence: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- Attribution: CelesTrak / Dr. T.S. Kelso.
- Public source redistribution: unresolved
- Public deployment redistribution: unresolved
- Modification status: unresolved-for-redistribution
- Repository paths: none
- Production paths: none
- Restrictions and notes: Excluded from public source, tests, review fixtures, and production deployment. Local users must acquire it directly and must not publish the resulting snapshot without separate permission.

## ESA/Hubble planetary portraits used as Tracker hero photography

- Inventory ID: `esa-hubble-planetary-photography`
- Category: planetary-photography
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: ESA/Hubble and NASA
- Version or snapshot: Public release images, retrieved 2026-08-16
- Retrieval date: 2026-08-16
- Authoritative source: https://esahubble.org/images/
- Authoritative source: https://esahubble.org/images/
- Rights basis: Creative Commons Attribution 4.0 International (CC BY 4.0). ESA/Hubble releases its public images under CC BY 4.0, requiring the credit to be clearly and visibly presented with the wording unaltered. The ESA/Hubble logo is excluded and is not used.
- Rights evidence: https://esahubble.org/copyright/
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Attribution: ESA/Hubble and NASA. Full per-image credits are rendered on each image in the interface.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/sky/esahubble-heic1917a-saturn.webp`, `public/sky/esahubble-heic2017a-jupiter-and-europa.webp`, `public/sky/esahubble-heic1609a-mars.webp`
- Production paths: `sky/esahubble-heic1917a-saturn.webp`, `sky/esahubble-heic2017a-jupiter-and-europa.webp`, `sky/esahubble-heic1609a-mars.webp`
- Restrictions and notes: The per-image credit must remain rendered on the image itself. Both publishers require the credit to be clearly and visibly presented and not hidden or separated from the material, so moving it behind a disclosure control, a tooltip or a separate credits page would breach the licence. Each image must also keep the perception classification and, where the picture differs from the naked-eye view, the sentence saying how.

## ESO public image releases used as Tracker hero photography

- Inventory ID: `eso-night-sky-photography`
- Category: night-sky-photography
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: European Southern Observatory
- Version or snapshot: Public release images, retrieved 2026-08-16
- Retrieval date: 2026-08-16
- Authoritative source: https://www.eso.org/public/images/
- Authoritative source: https://www.eso.org/public/images/
- Rights basis: Creative Commons Attribution 4.0 International (CC BY 4.0). ESO releases its public images under CC BY 4.0 as a blanket policy, on condition that the full credit is presented clearly and visibly to all users and is not hidden or disassociated from the image. The ESO logo is excluded from the licence and is not used.
- Rights evidence: https://www.eso.org/public/copyright/
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Attribution: ESO. Individual photographer credits are rendered on each image in the interface.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/sky/eso-potw1033a-perseid-in-a-dark-sky.webp`, `public/sky/eso-potw1033a-night-sky-detail.webp`, `public/sky/eso-potw2136a-eclipsed-moon-at-paranal.webp`, `public/sky/eso-potw2031a-moon-and-venus-at-dusk.webp`
- Production paths: `sky/eso-potw1033a-perseid-in-a-dark-sky.webp`, `sky/eso-potw1033a-night-sky-detail.webp`, `sky/eso-potw2136a-eclipsed-moon-at-paranal.webp`, `sky/eso-potw2031a-moon-and-venus-at-dusk.webp`
- Restrictions and notes: The per-image credit must remain rendered on the image itself. Both publishers require the credit to be clearly and visibly presented and not hidden or separated from the material, so moving it behind a disclosure control, a tooltip or a separate credits page would breach the licence. Each image must also keep the perception classification and, where the picture differs from the naked-eye view, the sentence saying how.

## Orbit Studio Satellite Source of Truth v1.0.0 from GCAT satcat

- Inventory ID: `gcat-satellite-source-of-truth-2026-06-27`
- Category: current-and-historical-space-object-data
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Jonathan C. McDowell
- Version or snapshot: Package 1.0.0; GCAT satcat source header updated 2026-06-27 22:13:02 UTC
- Retrieval date: 2026-07-29
- Authoritative source: https://planet4589.org/space/gcat/
- Authoritative source: https://planet4589.org/space/gcat/tsv/cat/satcat.tsv
- Rights basis: Creative Commons Attribution 4.0 International (CC BY 4.0); GCAT expressly permits reproduction with citation.
- Rights evidence: https://planet4589.org/space/gcat/
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Attribution: Data from GCAT (J. McDowell, planet4589.org/space/gcat).
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `data/satellite-source-of-truth/CHECKSUMS.sha256`, `data/satellite-source-of-truth/CODEX.md`, `data/satellite-source-of-truth/README.md`, `data/satellite-source-of-truth/data/objects.csv.gz`, `data/satellite-source-of-truth/data/objects.ndjson.gz`, `data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite`, `data/satellite-source-of-truth/data/overview.json`, `data/satellite-source-of-truth/data/quality_issues.csv`, `data/satellite-source-of-truth/data/reconstruction_candidates.csv.gz`, `data/satellite-source-of-truth/data/snapshot_present_earth_objects.csv.gz`, `data/satellite-source-of-truth/data/yearly_object_presence.csv.gz`, `data/satellite-source-of-truth/data/yearly_summary.csv`, `data/satellite-source-of-truth/data/yearly_summary.json`, `data/satellite-source-of-truth/docs/DATA_DICTIONARY.md`, `data/satellite-source-of-truth/docs/INTEGRATION.md`, `data/satellite-source-of-truth/docs/PROVENANCE.md`, `data/satellite-source-of-truth/docs/RECONSTRUCTION.md`, `data/satellite-source-of-truth/docs/SCHEMA.sql`, `data/satellite-source-of-truth/licenses/GCAT-CC-BY-4.0.md`, `data/satellite-source-of-truth/manifest.json`, `data/satellite-source-of-truth/provenance.json`, `data/satellite-source-of-truth/queries/examples.sql`, `data/satellite-source-of-truth/raw/gcat-satcat-2026-06-27.tsv`, `data/satellite-source-of-truth/scripts/build.py`, `data/satellite-source-of-truth/scripts/update_from_gcat.py`, `data/satellite-source-of-truth/scripts/verify.py`, `src/data/generated/satelliteCatalog.web.json`
- Production paths: `assets/index-*.js`
- Restrictions and notes: This is the complete packaged GCAT Earth-object membership for the supported four classes at the dated snapshot, not proof of operational status or observational completeness. Preserve attribution, source/reconstruction separation, partial-2026 semantics, catalog-only rows, package checksums, and the prohibition on live/exact wording.

## GitHub-authored Actions used by release validation

- Inventory ID: `github-actions-release-validation-dependencies`
- Category: ci-action-dependencies
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: GitHub, Inc. and contributors
- Version or snapshot: checkout 11d5960a326750d5838078e36cf38b85af677262; setup-node 49933ea5288caeca8642d1e84afbd3f7d6820020; upload-artifact ea165f8d65b6e75b540449e92b4886f43607fa02
- Retrieval date: 2026-07-25
- Authoritative source: https://github.com/actions
- Rights basis: Each referenced GitHub-maintained Action is published under the MIT License at the pinned commit.
- Rights evidence: https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/LICENSE
- Rights evidence: https://github.com/actions/setup-node/blob/49933ea5288caeca8642d1e84afbd3f7d6820020/LICENSE
- Rights evidence: https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/LICENSE
- Attribution: GitHub Actions: checkout, setup-node, and upload-artifact; each MIT-licensed by GitHub, Inc. and contributors.
- Public source redistribution: source-safe-reference-only
- Public deployment redistribution: not-in-production-bundle
- Modification status: not-modified
- Repository paths: `.github/workflows/release-validation.yml`
- Production paths: none
- Restrictions and notes: Action revisions must remain commit-pinned. Updating a commit requires an intentional inventory checksum, version, and rights-evidence update.

## HYG Database v4.1

- Inventory ID: `hyg-database-v4-1-bright-stars`
- Category: astronomical-catalog-data
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: David Nash / Astronomy Nexus
- Version or snapshot: v4.1 at commit 3bf37f4b2d5460e1278286320d1d62fab9b493c1 (2024-08-17)
- Retrieval date: 2026-07-25
- Authoritative source: https://github.com/astronexus/HYG-Database
- Authoritative source: https://raw.githubusercontent.com/astronexus/HYG-Database/3bf37f4b2d5460e1278286320d1d62fab9b493c1/hyg/CURRENT/hygdata_v41.csv
- Rights basis: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
- Rights evidence: https://github.com/astronexus/HYG-Database/blob/3bf37f4b2d5460e1278286320d1d62fab9b493c1/LICENSE
- Rights evidence: https://creativecommons.org/licenses/by-sa/4.0/
- Attribution: HYG Database v4.1 by David Nash / Astronomy Nexus, licensed CC BY-SA 4.0; Orbit Studio magnitude-limited transformed subset.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-share-alike
- Repository paths: `src/data/stars/hygBrightStars.v41.json`, `src/data/stars/LICENSE-CC-BY-SA-4.0.txt`
- Production paths: `assets/index-*.js`
- Restrictions and notes: The transformed subset remains under CC BY-SA 4.0; retain attribution, license link, and change description.

## NASA/JPL Horizons DE441 and U.S. Naval Observatory Astronomical Applications API reference results

- Inventory ID: `jpl-horizons-usno-validation-fixture`
- Category: scientific-reference-fixture
- Release status: retained-test-only
- Release 1.0 included: yes
- Publisher or rights holder: NASA/JPL Solar System Dynamics and U.S. Naval Observatory
- Version or snapshot: Horizons API 1.3 / DE441; USNO Astronomical Applications API 4.0.1
- Retrieval date: 2026-07-18
- Authoritative source: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- Rights basis: NASA science data is reusable under NASA science-data policy unless marked otherwise; the USNO API expressly supports results embedded in web and mobile applications. No restrictive marking appeared in the returned factual results.
- Rights evidence: https://science.data.nasa.gov/about/license
- Rights evidence: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- Rights evidence: https://aa.usno.navy.mil/data/api.html
- Attribution: NASA/JPL Horizons DE441 and U.S. Naval Observatory Astronomical Applications Department.
- Public source redistribution: source-safe
- Public deployment redistribution: not-in-production-bundle
- Modification status: factual-output-transformation-permitted
- Repository paths: `src/astronomy/reference/jplHorizonsUsnoReference.json`
- Production paths: none
- Restrictions and notes: The fixture verifies model agreement at declared instants; it does not transfer JPL or USNO endorsement.

## Former Hipparcos-derived TypeScript star subset

- Inventory ID: `legacy-hipparcos-derived-star-file`
- Category: excluded-astronomical-catalog-data
- Release status: excluded
- Release 1.0 included: no
- Publisher or rights holder: ESA Hipparcos mission / CDS VizieR
- Version or snapshot: Former local adapted file; exact source query and redistribution evidence were not retained
- Authoritative source: https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239
- Rights basis: Exact provenance and redistribution permission for the former adapted file were not established.
- Rights evidence: https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239
- Attribution: Not applicable because the material is excluded.
- Public source redistribution: unresolved
- Public deployment redistribution: unresolved
- Modification status: unresolved
- Repository paths: none
- Production paths: none
- Restrictions and notes: Do not restore the former derived file without exact source, license, checksum, and processing evidence.

## Previously tracked screenshots and evidence generated from the unresolved CelesTrak snapshot

- Inventory ID: `legacy-review-evidence-with-unresolved-current-data`
- Category: generated-review-evidence
- Release status: excluded
- Release 1.0 included: no
- Publisher or rights holder: Orbit Studio
- Version or snapshot: Pre-provenance Release 1 review artifacts
- Rights basis: The images are project-generated but visually derive from an orbital dataset whose public redistribution basis was not verified.
- Attribution: Not applicable because the artifacts are excluded.
- Public source redistribution: unresolved
- Public deployment redistribution: unresolved
- Modification status: not-applicable
- Repository paths: none
- Production paths: none
- Restrictions and notes: Tracked evidence/ and screenshots/ artifacts are removed. Fresh ignored review output is generated from the release-safe production bundle and includes the current notices.

## IMO working list of visual meteor showers, with stream identity and numbering from the IAU Meteor Data Center list of established showers

- Inventory ID: `meteor-stream-parameters-2026-08-16`
- Category: meteor-stream-parameters
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: International Meteor Organization; IAU Meteor Data Center
- Version or snapshot: Transcribed working-list parameters, snapshot dated 2026-08-16
- Retrieval date: 2026-08-16
- Authoritative source: https://www.ta3.sk/IAUC22DB/MDC2007/
- Authoritative source: https://www.imo.net/resources/calendar/
- Rights basis: Not established by this entry. The individual parameters are measurements of natural phenomena and are widely reproduced across published sources, but no licence grant was retrieved for the IMO working list or the IAU MDC list, and neither publisher's terms were read as part of this transcription. Resolving this means retrieving each list from its publication URL under its stated terms, checksumming the retrieved artifact, and recording the licence found there.
- Rights evidence: https://www.imo.net/resources/calendar/
- Rights evidence: https://www.ta3.sk/IAUC22DB/MDC2007/
- Attribution: Meteor stream parameters after the IMO working list of visual meteor showers and the IAU Meteor Data Center list of established showers.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `src/data/tracker/meteorShowers.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: Nominal zenithal hourly rates are reference values for a stream at maximum under a 6.5-magnitude sky, not a prediction of any observer's count, and must never be presented as one. The editorial peak widths must stay labelled as editorial. The rights basis above is unresolved and this entry must not be marked verified until an artifact is retrieved and checksummed.

## Blue Marble: Next Generation with Topography and Bathymetry, January

- Inventory ID: `nasa-blue-marble-january-2004`
- Category: image-texture
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: NASA Earth Observatory
- Version or snapshot: January 2004, 5400 x 2700 JPEG
- Retrieval date: 2026-07-04
- Authoritative source: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
- Authoritative source: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/january/world.topo.bathy.200401.3x5400x2700.jpg
- Rights basis: NASA Images and Media Usage Guidelines; unmarked NASA content may be used factually for educational or informational computer simulations and web pages.
- Rights evidence: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Rights evidence: https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy
- Attribution: NASA Blue Marble: Next Generation. NASA is acknowledged as the source; no endorsement is implied.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-for-factual-educational-or-informational-use
- Repository paths: `public/earth/nasa-blue-marble-january-5400.jpg`
- Production paths: `earth/nasa-blue-marble-january-5400.jpg`
- Restrictions and notes: Do not imply NASA endorsement; re-check if a future replacement carries a third-party copyright notice, logo, or identifiable-person restriction.

## NASA Global Imagery Browse Services

- Inventory ID: `nasa-gibs-external-provider`
- Category: runtime-external-service
- Release status: external-acquisition-disabled
- Release 1.0 included: yes
- Publisher or rights holder: NASA Earthdata / ESDIS
- Version or snapshot: WMS and WMTS service descriptors; disabled by default
- Authoritative source: https://www.earthdata.nasa.gov/about/esdis/eosdis/gibs
- Rights basis: NASA Earthdata policy states that unmarked NASA-led mission data are CC0 and that ESDIS content may be used factually with NASA acknowledgment.
- Rights evidence: https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy
- Attribution: NASA Global Imagery Browse Services (GIBS), Earthdata.
- Public source redistribution: not-applicable-external-service
- Public deployment redistribution: not-bundled
- Modification status: service-output-subject-to-layer-metadata
- Repository paths: none
- Production paths: none
- Restrictions and notes: Future enabled layers must preserve product-specific metadata, attribution, and any marked restriction.

## History of On-orbit Satellite Fragmentations, 16th Edition (NASA/TP-20220019160)

- Inventory ID: `nasa-hoosf-16e-fragmentation-causes`
- Category: current-and-historical-space-object-data
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: NASA Orbital Debris Program Office, Lyndon B. Johnson Space Center
- Version or snapshot: 16th Edition, December 2022
- Retrieval date: 2026-08-13
- Authoritative source: https://orbitaldebris.jsc.nasa.gov/library/
- Authoritative source: https://orbitaldebris.jsc.nasa.gov/library/hoosf_16e.pdf
- Rights basis: Work of the U.S. Government prepared by NASA; not subject to copyright protection in the United States (17 U.S.C. 105). Factual cause assessments only.
- Rights evidence: https://orbitaldebris.jsc.nasa.gov/library/
- Rights evidence: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Attribution: Fragmentation cause assessments from NASA Orbital Debris Program Office, History of On-orbit Satellite Fragmentations, 16th Edition (NASA/TP-20220019160).
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `data/fragmentation-causes/PROVENANCE.md`, `data/fragmentation-causes/nasa-hoosf-16e-causes.csv`, `scripts/build-fragmentation-causes.py`, `src/data/generated/fragmentationCauses.json`
- Production paths: `assets/index-*.js`
- Restrictions and notes: This is the complete packaged GCAT Earth-object membership for the supported four classes at the dated snapshot, not proof of operational status or observational completeness. Preserve attribution, source/reconstruction separation, partial-2026 semantics, catalog-only rows, package checksums, and the prohibition on live/exact wording.

## NASA Image and Video Library mission media

- Inventory ID: `nasa-images-explorer-remote-media`
- Category: runtime-external-images
- Release status: external-acquisition
- Release 1.0 included: yes
- Publisher or rights holder: NASA
- Version or snapshot: Four immutable NASA Image Library identifiers
- Retrieval date: 2026-07-25
- Authoritative source: https://images.nasa.gov/
- Rights basis: NASA Images and Media Usage Guidelines for factual educational or informational web use; identifiers were checked against official NASA Image Library metadata.
- Rights evidence: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Rights evidence: https://images.nasa.gov/
- Attribution: NASA/JSC; NASA/GSFC; NASA/JPL-Caltech, as identified per image.
- Public source redistribution: not-applicable-external-acquisition
- Public deployment redistribution: not-bundled-runtime-fetch-permitted
- Modification status: not-modified
- Repository paths: none
- Production paths: none
- Restrictions and notes: No NASA logos or identifiable-person promotional use; no endorsement. Remote availability is not guaranteed.

## CGI Moon Kit: LROC WAC Color Mosaic

- Inventory ID: `nasa-svs-lroc-color-moon-1k`
- Category: image-texture
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: NASA Scientific Visualization Studio
- Version or snapshot: SVS visualization 4720, 1K color texture, published 2019-09-06
- Retrieval date: 2026-07-25
- Authoritative source: https://svs.gsfc.nasa.gov/4720/
- Authoritative source: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg
- Rights basis: NASA Images and Media Usage Guidelines; NASA SVS supplies an explicit credit request and identifies the contributing data.
- Rights evidence: https://svs.gsfc.nasa.gov/4720/
- Rights evidence: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Attribution: NASA's Scientific Visualization Studio; visualization by Ernie Wright (USRA), science by Noah Petro (NASA/GSFC), using LROC WAC data collected by Arizona State University.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-for-factual-educational-or-informational-use
- Repository paths: `public/moon/nasa-lroc-color-1k.jpg`
- Production paths: `moon/nasa-lroc-color-1k.jpg`, `assets/TrackerApp-*.js`
- Restrictions and notes: Display-optimized texture, not a precision lunar cartography product; no NASA endorsement implied.

## Natural Earth 1:110m Land GeoJSON

- Inventory ID: `natural-earth-110m-land`
- Category: geographic-boundary-data
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Natural Earth, Tom Patterson, Nathaniel Vaughn Kelso, and contributors
- Version or snapshot: natural-earth-vector commit 693f11422f4e08d2da4566b854dda53eb7c39fb3 (2018-06-01)
- Retrieval date: 2026-07-25
- Authoritative source: https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/
- Authoritative source: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/693f11422f4e08d2da4566b854dda53eb7c39fb3/geojson/ne_110m_land.geojson
- Rights basis: Natural Earth states that all versions of its raster and vector map data are public domain and may be modified and electronically disseminated.
- Rights evidence: https://www.naturalearthdata.com/about/terms-of-use/
- Attribution: Made with Natural Earth.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted
- Repository paths: `src/data/natural-earth/ne_110m_land.geojson.json`
- Production paths: `assets/index-*.js`
- Restrictions and notes: Natural Earth does not require attribution; Orbit Studio includes the recommended citation.

## npm dependency graph

- Inventory ID: `npm-lockfile-dependencies`
- Category: software-dependencies
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Individual package authors and rights holders
- Version or snapshot: package-lock.json lockfileVersion 3, 281 package entries
- Retrieval date: 2026-07-25
- Authoritative source: https://registry.npmjs.org/
- Rights basis: Locked packages declare MIT, ISC, BSD-3-Clause, Apache-2.0, or CC-BY-4.0; webgl-constants@1.1.1 is MIT per its upstream LICENSE.
- Rights evidence: https://github.com/TimvanScherpenzeel/webgl-constants/blob/3ed05e37a29cc15cc1f612913723a4c39f808d9d/LICENSE
- Attribution: See THIRD_PARTY_NOTICES.md for the lockfile-derived package inventory and notices.
- Public source redistribution: source-safe-lockfile-only
- Public deployment redistribution: deployment-safe-with-notices
- Modification status: per-package-license
- Repository paths: `package-lock.json`
- Production paths: `assets/*.js`, `assets/*.css`
- Restrictions and notes: node_modules is excluded. Dependency changes require an intentional lockfile and notice update.

## OpenWeather API placeholder

- Inventory ID: `openweather-placeholder-no-data`
- Category: disabled-external-service-placeholder
- Release status: placeholder-only
- Release 1.0 included: no
- Publisher or rights holder: OpenWeather Ltd.
- Version or snapshot: No API product, key, response, icon, or map tile acquired
- Authoritative source: https://openweathermap.org/api
- Rights basis: No third-party material is included. Future acquisition or activation requires review of the selected OpenWeather product terms.
- Rights evidence: https://openweathermap.org/api
- Attribution: OpenWeather, if a future user configures the service.
- Public source redistribution: not-applicable-no-material
- Public deployment redistribution: not-applicable-no-material
- Modification status: not-applicable
- Repository paths: none
- Production paths: none
- Restrictions and notes: No key, data, image, icon, or tile may be committed or deployed without a new provenance entry and rights review.

## Orbit Studio curated Explorer educational reference compilation

- Inventory ID: `orbit-studio-curated-explorer-reference-data`
- Category: project-authored-curated-reference-data
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Orbit Studio
- Version or snapshot: Release 1.0 curated reference definitions audited 2026-07-25
- Retrieval date: 2026-07-25
- Authoritative source: https://github.com/hendrikv-dev/orbit-studio
- Rights basis: First-party Orbit Studio-authored compilation and expression; no third-party file, image, passage, catalog snapshot, or operational ephemeris is incorporated.
- Rights evidence: https://www.gps.gov/systems/gps/space/
- Rights evidence: https://www.esa.int/Applications/Satellite_navigation/Galileo/Galileo_satellites
- Rights evidence: https://www.nasa.gov/directorates/somd/space-communications-navigation-program/dsn-complexes/
- Rights evidence: https://www.nesdis.noaa.gov/our-satellites/currently-flying
- Rights evidence: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Attribution: Orbit Studio-authored educational compilation. NASA/JPL, GPS.gov, ESA, NOAA NESDIS, and the linked mission publishers are acknowledged as factual reference publishers; no endorsement is implied.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted
- Repository paths: `src/data/explorerCatalog.ts`, `src/data/explorerConstellationArchitecture.ts`, `src/data/explorerEducation.ts`, `src/lib/scenario.ts`
- Production paths: `assets/index-*.js`
- Restrictions and notes: Representative and simplified educational data are not operational catalog membership, measured current positions, precise geographic boundaries, or complete constellation inventories. Population and architecture summaries are approximate and time-sensitive.

## Orbit Studio Tracker imagery policy and lunar phase composite

- Inventory ID: `orbit-studio-tracker-scene-artwork`
- Category: first-party-illustration
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Orbit Studio
- Version or snapshot: Vector scenes drawn for the Tracker presentation rebuild, 2026-08-16
- Retrieval date: 2026-08-16
- Rights basis: Original code and the lunar composite are this project's own work under the repository's MIT licence. The photographs it displays are third-party and registered separately under eso-night-sky-photography and esa-hubble-planetary-photography; the lunar surface is the separately registered NASA LROC mosaic.
- Rights evidence: https://github.com/hendrikv-dev/orbit-studio
- Attribution: Scene artwork by Orbit Studio. Lunar surface: NASA's Scientific Visualization Studio (LROC WAC mosaic).
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted
- Repository paths: `src/components/tracker/TrackerScene.tsx`, `src/data/tracker/imagery.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: Every image must keep an ImageryClass and must render it, and every third-party image must render its credit on the image itself. Any future image must be registered with its own source, licence, credit and perception classification before it ships.

## Space-Track.org authenticated catalog and GP history services

- Inventory ID: `space-track-authenticated-local-acquisition`
- Category: historical-and-current-orbital-data
- Release status: local-only
- Release 1.0 included: no
- Publisher or rights holder: United States Space Force / Space-Track.org
- Version or snapshot: Authenticated live service; no response data retained in public source
- Authoritative source: https://www.space-track.org/documentation
- Rights basis: Use is governed by the authenticated Space-Track user agreement and source-specific terms. This audit does not infer public redistribution permission.
- Rights evidence: https://www.space-track.org/documentation
- Attribution: Space-Track.org / United States Space Force.
- Public source redistribution: unresolved
- Public deployment redistribution: unresolved
- Modification status: unresolved-for-redistribution
- Repository paths: none
- Production paths: none
- Restrictions and notes: Authenticated acquisitions and credentials remain ignored and local only. Public inclusion requires a separate evidence-backed decision.

## Open-Meteo Air Quality API (Copernicus Atmosphere Monitoring Service)

- Inventory ID: `tracker-aerosol-air-quality`
- Category: runtime-air-quality
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Open-Meteo, serving Copernicus Atmosphere Monitoring Service model output
- Version or snapshot: Runtime API, not a pinned snapshot; hourly aerosol_optical_depth and pm2_5
- Retrieval date: 2026-08-21
- Authoritative source: https://open-meteo.com/en/docs/air-quality-api
- Authoritative source: https://air-quality-api.open-meteo.com/v1/air-quality
- Rights basis: Open-Meteo publishes its APIs for free non-commercial use without an API key and licenses the data under CC BY 4.0. The underlying model output is the Copernicus Atmosphere Monitoring Service, whose data are available under the Copernicus licence permitting free use and redistribution with attribution. The endpoint sends access-control-allow-origin: *, so direct browser use is the intended access pattern.
- Rights evidence: https://open-meteo.com/en/features
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Rights evidence: https://atmosphere.copernicus.eu/
- Attribution: Aerosol and particulate data from Open-Meteo, derived from the Copernicus Atmosphere Monitoring Service, licensed CC BY 4.0. Rendered in the Tracker conditions caption and in the data-and-privacy panel.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `src/data/tracker/airQuality.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: Attribution must remain visible wherever aerosol figures are shown. Optical depth must not be presented as a smoke concentration, and surface particulate must not be presented as sky transparency. Caching must stay keyed by model cell and never by user. If Orbit Studio ever becomes commercial, Open-Meteo’s non-commercial terms must be re-reviewed before this remains on the free path.

## NOAA SWPC OVATION aurora nowcast and planetary K-index products

- Inventory ID: `tracker-aurora-space-weather`
- Category: runtime-space-weather
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: NOAA Space Weather Prediction Center
- Version or snapshot: Runtime API, not a pinned snapshot; ovation_aurora_latest.json, noaa-planetary-k-index-forecast.json, planetary_k_index_1m.json
- Retrieval date: 2026-08-21
- Authoritative source: https://www.swpc.noaa.gov/products/aurora-30-minute-forecast
- Authoritative source: https://services.swpc.noaa.gov/json/ovation_aurora_latest.json
- Rights basis: Works of the United States government prepared by NOAA employees in the course of their duties are not subject to domestic copyright. NOAA’s data policy and the SWPC service terms permit free use and redistribution of these products with acknowledgment. The endpoints send access-control-allow-origin: * and a one-minute cache header, so direct browser use is the intended access pattern and no proxy or key is required.
- Rights evidence: https://www.swpc.noaa.gov/content/data-access
- Rights evidence: https://www.nesdis.noaa.gov/about/data-and-information-policy
- Rights evidence: https://www.spaceweather.gov/
- Attribution: Aurora nowcast (OVATION) and planetary K-index from the NOAA Space Weather Prediction Center (public domain). Rendered in the Tracker conditions caption and in the data-and-privacy panel.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted
- Repository paths: `src/data/tracker/aurora.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: NOAA acknowledgment must remain visible wherever aurora figures are shown, and no endorsement may be implied. Any percentage shown must be NOAA's published figure, unmodified and attributed; a value Tracker derives from it may not be presented as a probability or as NOAA's. Nothing beyond the three-day K-index horizon may be presented as a forecast. If the operator ever adds a proxy, its caching must respect the one-minute publication cadence.

## Photon geocoder over OpenStreetMap data

- Inventory ID: `tracker-place-search-adapter`
- Category: runtime-place-search
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Komoot GmbH (service); OpenStreetMap contributors (data)
- Version or snapshot: Runtime API, not a pinned snapshot; queried per search
- Retrieval date: 2026-08-16
- Authoritative source: https://photon.komoot.io/
- Authoritative source: https://photon.komoot.io/api/
- Rights basis: The underlying data is OpenStreetMap under ODbL 1.0 and attribution is rendered in the Tracker sources detail, so redistribution of results is not in question. What is unresolved is production reliance on a courtesy public endpoint: no usage agreement has been sought with the instance operator, and a product sending real traffic to a free community service should either have one or run its own. Resolving it means either an agreement, a self-hosted Photon, or a paid provider — and the last of those is barred from the free path by the cost rule.
- Rights evidence: https://photon.komoot.io/
- Rights evidence: https://www.openstreetmap.org/copyright
- Rights evidence: https://opendatacommons.org/licenses/odbl/1-0/
- Attribution: Place search © OpenStreetMap contributors, ODbL 1.0. Geocoding by Photon.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `src/data/tracker/geocoding.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: OpenStreetMap attribution must remain visible. Searches must stay debounced and must not carry a user identifier. No cost-bearing geocoder may be added to the free path. This entry must not be marked verified until production use of the endpoint is put on a footing the operator has agreed to.

## MET Norway Locationforecast 2.0 and the US National Weather Service API

- Inventory ID: `tracker-weather-forecast-adapters`
- Category: runtime-weather-forecast
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Norwegian Meteorological Institute; NOAA National Weather Service
- Version or snapshot: Runtime API, not a pinned snapshot; queried live per observing location
- Retrieval date: 2026-08-16
- Authoritative source: https://docs.api.met.no/doc/locationforecast/HowTO.html
- Authoritative source: https://api.met.no/weatherapi/locationforecast/2.0/
- Rights basis: MET Norway Locationforecast is published under CC BY 4.0 and the National Weather Service API is US Government work in the public domain, so redistribution of the *data* is not in question. What is unresolved is compliance with the providers' identification requirement: both ask a caller to send a User-Agent identifying the application, and a browser cannot — User-Agent is a forbidden header name in the Fetch standard, so the browser discards it and sends its own. Verified empirically against an echo service. Resolving this means routing through a caching proxy that can set the header, which is a server and therefore a running cost.
- Rights evidence: https://api.met.no/doc/TermsOfService
- Rights evidence: https://www.weather.gov/documentation/services-web-api
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Attribution: Weather data from MET Norway, licensed CC BY 4.0. Forecast data from the US National Weather Service (public domain). Both attributions are rendered in the Tracker conditions detail.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `src/data/tracker/weatherProviders.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: Attribution must remain visible in the conditions detail. Caching must stay keyed by grid cell and never by user. The identification gap above must not be marked resolved until requests carry an identifying User-Agent. No cost-bearing weather or geocoding provider may be added to the free path.

## Vanguard 1 example from Python-SGP4 package metadata, based on Vallado et al. AIAA-2006-6753

- Inventory ID: `vallado-python-sgp4-reference-vector`
- Category: adapted-code-and-verification-vector
- Release status: retained-test-only
- Release 1.0 included: yes
- Publisher or rights holder: Brandon Rhodes; reference implementation lineage credited to David A. Vallado and coauthors
- Version or snapshot: Example reproduced in satellite.js 5.0.0 ORIGINAL-PKG-INFO from Python-SGP4 1.1
- Retrieval date: 2026-07-18
- Authoritative source: https://github.com/brandon-rhodes/python-sgp4
- Rights basis: Python-SGP4 and satellite.js publish the relevant package material under the MIT License.
- Rights evidence: https://github.com/brandon-rhodes/python-sgp4/blob/master/LICENSE
- Rights evidence: https://github.com/shashwatak/satellite-js/blob/v5.0.0/LICENSE.md
- Attribution: Vallado et al., AIAA-2006-6753; example reproduced by Python-SGP4 and satellite.js under MIT terms.
- Public source redistribution: source-safe
- Public deployment redistribution: not-in-production-bundle
- Modification status: permitted
- Repository paths: `scripts/report-orbital-population-validation.ts`, `src/rendering/catalogPopulationValidation.test.ts`, `src/rendering/catalogMotion.test.ts`, `src/rendering/orbitPathSampling.test.ts`
- Production paths: none
- Restrictions and notes: Retain attribution and dependency MIT notices.

## Perseiden.Echtzeit.2020-08-12.webm

- Inventory ID: `wikimedia-perseid-realtime-footage`
- Category: experiential-motion-media
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Wikimedia Commons
- Version or snapshot: Natural-speed historical Perseid footage recorded 2020-08-12, 1920×1080, retrieved 2026-08-18
- Retrieval date: 2026-08-18
- Authoritative source: https://commons.wikimedia.org/wiki/File:Perseiden.Echtzeit.2020-08-12.webm
- Authoritative source: https://upload.wikimedia.org/wikipedia/commons/d/d9/Perseiden.Echtzeit.2020-08-12.webm
- Rights basis: Creative Commons Zero 1.0 Universal public-domain dedication. The author has waived copyright and neighbouring rights worldwide, so no permission or attribution is legally required. Attribution is rendered anyway: the reader is being shown someone else's night, and saying whose is a matter of honesty rather than compliance.
- Rights evidence: https://commons.wikimedia.org/wiki/File:Perseiden.Echtzeit.2020-08-12.webm
- Rights evidence: https://creativecommons.org/publicdomain/zero/1.0/
- Attribution: Bautsch, via Wikimedia Commons. CC0 1.0.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted
- Repository paths: `public/media/perseids-realtime-bautsch-cc0.webm`, `public/media/perseids-realtime-bautsch-cc0-poster.webp`
- Production paths: `media/perseids-realtime-bautsch-cc0.webm`, `media/perseids-realtime-bautsch-cc0-poster.webp`
- Restrictions and notes: This is representative historical footage of the phenomenon, not a recording of the reader's sky. The interface must retain its representative claim, historical capture date, and naked-eye/natural-speed context. Presenting it as a live view, a forecast, or a depiction of tonight from the reader's location would be a factual claim the product cannot support.

## Software dependencies

The complete lockfile-derived dependency inventory and runtime notice texts are in
`THIRD_PARTY_NOTICES.md`. `node_modules` is not part of the repository or release package.
