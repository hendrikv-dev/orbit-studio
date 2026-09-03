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

## CelesTrak General Perturbations (GP) and Supplemental GP (SupGP) element sets

- Inventory ID: `celestrak-satellite-orbits-runtime`
- Category: runtime-external-service
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: CelesTrak / Dr. T.S. Kelso
- Version or snapshot: Live service; no snapshot retained in this repository
- Authoritative source: https://celestrak.org/NORAD/documentation/sup-gp-queries.php
- Authoritative source: https://celestrak.org/NORAD/elements/supplemental/
- Rights basis: CelesTrak's usage policy permits documented consumer acquisition subject to stated rate limits and error handling. It grants nothing about redistribution, which is why nothing is redistributed.
- Rights evidence: https://celestrak.org/usage-policy.php
- Rights evidence: https://celestrak.org/NORAD/documentation/sup-gp-queries.php
- Attribution: Orbital element sets from CelesTrak (Dr. T.S. Kelso); the ISS ephemeris is derived from NASA's published trajectory and a Starlink stack vector from SpaceX's published state vector.
- Public source redistribution: not-applicable-external-service
- Public deployment redistribution: not-bundled
- Modification status: not-applicable-external-service
- Repository paths: `src/data/tracker/satelliteSources.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: The two-hour cache and the stop-on-error behaviour are licence-adjacent conditions of use, not performance choices, and must not be relaxed. No response may be committed to the repository or bundled into a deployment.

## ESA/Hubble deep-sky photographs used as Tracker hero imagery

- Inventory ID: `esa-hubble-deep-sky-photography`
- Category: deep-sky-photography
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: ESA/Hubble and NASA
- Version or snapshot: Public release images, retrieved 2026-09-01
- Retrieval date: 2026-09-01
- Authoritative source: https://esahubble.org/images/
- Authoritative source: https://esahubble.org/images/
- Rights basis: Creative Commons Attribution 4.0 International (CC BY 4.0). ESA/Hubble releases its public images under CC BY 4.0, requiring the credit to be clearly and visibly presented with the wording unaltered. The ESA/Hubble logo is excluded and is not used.
- Rights evidence: https://esahubble.org/copyright/
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Attribution: ESA/Hubble and NASA. Full per-image credits are rendered on each image in the interface.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/sky/esahubble-heic0401e-m81-thumb.webp`, `public/sky/esahubble-heic0401e-m81.webp`, `public/sky/esahubble-heic0414b-ngc6543-thumb.webp`, `public/sky/esahubble-heic0414b-ngc6543.webp`, `public/sky/esahubble-heic0506a-m51-thumb.webp`, `public/sky/esahubble-heic0506a-m51.webp`, `public/sky/esahubble-heic0515a-m1-thumb.webp`, `public/sky/esahubble-heic0515a-m1.webp`, `public/sky/esahubble-heic0604a-m82-thumb.webp`, `public/sky/esahubble-heic0604a-m82.webp`, `public/sky/esahubble-heic1310a-m57-thumb.webp`, `public/sky/esahubble-heic1310a-m57.webp`, `public/sky/esahubble-heic1321b-m15-thumb.webp`, `public/sky/esahubble-heic1321b-m15.webp`, `public/sky/esahubble-opo0328a-m104-thumb.webp`, `public/sky/esahubble-opo0328a-m104.webp`, `public/sky/esahubble-potw1514a-m22-thumb.webp`, `public/sky/esahubble-potw1514a-m22.webp`
- Production paths: `sky/esahubble-heic0401e-m81-thumb.webp`, `sky/esahubble-heic0401e-m81.webp`, `sky/esahubble-heic0414b-ngc6543-thumb.webp`, `sky/esahubble-heic0414b-ngc6543.webp`, `sky/esahubble-heic0506a-m51-thumb.webp`, `sky/esahubble-heic0506a-m51.webp`, `sky/esahubble-heic0515a-m1-thumb.webp`, `sky/esahubble-heic0515a-m1.webp`, `sky/esahubble-heic0604a-m82-thumb.webp`, `sky/esahubble-heic0604a-m82.webp`, `sky/esahubble-heic1310a-m57-thumb.webp`, `sky/esahubble-heic1310a-m57.webp`, `sky/esahubble-heic1321b-m15-thumb.webp`, `sky/esahubble-heic1321b-m15.webp`, `sky/esahubble-opo0328a-m104-thumb.webp`, `sky/esahubble-opo0328a-m104.webp`, `sky/esahubble-potw1514a-m22-thumb.webp`, `sky/esahubble-potw1514a-m22.webp`
- Restrictions and notes: The per-image credit must remain rendered on the image itself; the publisher requires it to be clearly and visibly presented rather than hidden behind a disclosure control. Each image must keep its perception classification and the sentence saying how the eye differs from the photograph.

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

## ESO deep-sky photographs used as Tracker hero imagery

- Inventory ID: `eso-deep-sky-photography`
- Category: deep-sky-photography
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: ESO
- Version or snapshot: Public release images, retrieved 2026-09-01
- Retrieval date: 2026-09-01
- Authoritative source: https://www.eso.org/public/images/
- Authoritative source: https://www.eso.org/public/images/
- Rights basis: Creative Commons Attribution 4.0 International (CC BY 4.0). ESO releases its public images under CC BY 4.0, requiring the credit to be clearly and visibly presented.
- Rights evidence: https://www.eso.org/public/outreach/copyright/
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Attribution: ESO. Full per-image credits are rendered on each image in the interface.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/sky/eso-eso1103a-m42-thumb.webp`, `public/sky/eso-eso1103a-m42.webp`, `public/sky/eso-eso1403a-m8-thumb.webp`, `public/sky/eso-eso1403a-m8.webp`, `public/sky/eso-eso1406a-m7-thumb.webp`, `public/sky/eso-eso1406a-m7.webp`
- Production paths: `sky/eso-eso1103a-m42-thumb.webp`, `sky/eso-eso1103a-m42.webp`, `sky/eso-eso1403a-m8-thumb.webp`, `sky/eso-eso1403a-m8.webp`, `sky/eso-eso1406a-m7-thumb.webp`, `sky/eso-eso1406a-m7.webp`
- Restrictions and notes: The per-image credit must remain rendered on the image itself; the publisher requires it to be clearly and visibly presented rather than hidden behind a disclosure control. Each image must keep its perception classification and the sentence saying how the eye differs from the photograph.

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

## The Brightness of Starlink Mini Satellites During Orbit-Raising

- Inventory ID: `mallama-starlink-orbit-raising-brightness`
- Category: scientific-reference-output
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Mallama, A., Cole, R. E., Respler, J., Harrington, S., Lee, R. and Worley, A. (2024)
- Version or snapshot: arXiv:2405.12007v1, 2024-05-20
- Retrieval date: 2026-09-02
- Authoritative source: https://arxiv.org/abs/2405.12007
- Authoritative source: https://arxiv.org/abs/2405.12007
- Rights basis: Measured quantities reported in a published study are facts, cited here with full attribution. No expressive content from the paper is reproduced.
- Rights evidence: https://arxiv.org/abs/2405.12007
- Attribution: Starlink orbit-raising brightness from Mallama et al. (2024), arXiv:2405.12007.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: quoted-values-only
- Repository paths: none
- Production paths: none
- Restrictions and notes: The citation must remain with the values. The figures describe a population and must not be presented as a prediction for an individual pass.

## Quicksat intrinsic magnitude file (qs.mag)

- Inventory ID: `mccants-quicksat-intrinsic-magnitudes`
- Category: astronomical-catalog-data
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Mike McCants
- Version or snapshot: Published 2020-09-14, SHA-256 3f3f507014a047b6319813e73e818f065a029355c37a4b4e644213408f6a70a9
- Retrieval date: 2026-09-02
- Authoritative source: https://mmccants.org/programs/
- Authoritative source: https://mmccants.org/programs/qsmag.zip
- Rights basis: Individual measured magnitudes are facts rather than expressive content, and Tracker quotes one of them with attribution rather than reproducing the compilation. The file is not committed, bundled or redistributed.
- Rights evidence: https://mmccants.org/programs/
- Attribution: Standard magnitude from Mike McCants' Quicksat intrinsic magnitude file (qs.mag), 14 September 2020.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: quoted-value-only
- Repository paths: `scripts/build-satellite-brightness.mjs`, `src/data/satellites/brightness.json`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: Only the specific values Tracker uses may be quoted, with attribution. The compilation must not be committed or redistributed, and the pinned checksum must not be updated without reviewing what changed.

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
- Version or snapshot: GOES-East and GOES-West ABI Band 13 clean infrared; queried for its timestamp only
- Authoritative source: https://www.earthdata.nasa.gov/about/esdis/eosdis/gibs
- Rights basis: NASA Earthdata policy states that unmarked NASA-led mission data are CC0 and that ESDIS content may be used factually with NASA acknowledgment.
- Rights evidence: https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy
- Attribution: Cloud observation times from NASA Global Imagery Browse Services (GIBS), GOES ABI.
- Public source redistribution: not-applicable-external-service
- Public deployment redistribution: not-bundled
- Modification status: service-output-subject-to-layer-metadata
- Repository paths: none
- Production paths: none
- Restrictions and notes: Any future use must carry the product's own metadata and must not present a brightness temperature as a cloud fraction.

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

## NASA Photojournal PIA23791, Venus from Mariner 10

- Inventory ID: `nasa-photojournal-venus`
- Category: planetary-photography
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: NASA/JPL-Caltech
- Version or snapshot: Public release images, retrieved 2026-09-01
- Retrieval date: 2026-09-01
- Authoritative source: https://photojournal.jpl.nasa.gov/catalog/PIA23791
- Authoritative source: https://photojournal.jpl.nasa.gov/catalog/PIA23791
- Rights basis: NASA Images and Media Usage Guidelines. NASA content is generally not copyrighted and may be used for informational purposes; the credit line is retained and no endorsement is implied.
- Rights evidence: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Attribution: NASA/JPL-Caltech. The per-image credit is rendered on the image in the interface.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/sky/nasa-PIA23791-planet-venus-thumb.webp`, `public/sky/nasa-PIA23791-planet-venus.webp`
- Production paths: `sky/nasa-PIA23791-planet-venus-thumb.webp`, `sky/nasa-PIA23791-planet-venus.webp`
- Restrictions and notes: The per-image credit must remain rendered on the image itself; the publisher requires it to be clearly and visibly presented rather than hidden behind a disclosure control. Each image must keep its perception classification and the sentence saying how the eye differs from the photograph.

## NASA Image and Video Library photograph of the International Space Station

- Inventory ID: `nasa-spacecraft-photography`
- Category: spacecraft-photography
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: NASA
- Version or snapshot: iss066e081189, photographed 8 November 2021 from Crew Dragon Endeavour
- Retrieval date: 2026-09-02
- Authoritative source: https://images.nasa.gov/
- Authoritative source: https://images.nasa.gov/details/iss066e081189
- Rights basis: NASA Images and Media Usage Guidelines. NASA content is generally not copyrighted and may be used for informational purposes with the credit retained and no implication of endorsement.
- Rights evidence: https://www.nasa.gov/nasa-brand-center/images-and-media/
- Attribution: NASA.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/sky/nasaimages-iss066e081189-satellite-iss-thumb.webp`, `public/sky/nasaimages-iss066e081189-satellite-iss.webp`
- Production paths: `sky/nasaimages-iss066e081189-satellite-iss-thumb.webp`, `sky/nasaimages-iss066e081189-satellite-iss.webp`
- Restrictions and notes: The credit must remain rendered on the image, and the perception classification and eye-expectation sentence must remain with it.

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

## Natural Earth 1:110m cultural and physical vectors: land boundaries, state and province lines, lakes, and populated places

- Inventory ID: `natural-earth-110m-reference-layers`
- Category: geographic-boundary-data
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Natural Earth, Tom Patterson, Nathaniel Vaughn Kelso, and contributors
- Version or snapshot: 110m cultural and physical vectors, trimmed for the eclipse map's reference geography
- Retrieval date: 2026-08-28
- Authoritative source: https://www.naturalearthdata.com/downloads/110m-cultural-vectors/
- Authoritative source: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
- Rights basis: Natural Earth states that all versions of its raster and vector map data are public domain and may be modified and electronically disseminated.
- Rights evidence: https://www.naturalearthdata.com/about/terms-of-use/
- Attribution: Made with Natural Earth.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted
- Repository paths: `src/data/natural-earth/ne_110m_admin_0_boundary_lines_land.json`, `src/data/natural-earth/ne_110m_admin_1_states_provinces_lines.json`, `src/data/natural-earth/ne_110m_lakes.json`, `src/data/natural-earth/ne_110m_places.json`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: Natural Earth does not require attribution; Orbit Studio includes the recommended citation.

## GOES-R ABI Level-2 Clear Sky Mask (ABI-L2-ACMC), by way of Unidata's THREDDS server

- Inventory ID: `noaa-goes-clear-sky-mask`
- Category: runtime-external-service
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: NOAA NESDIS; redistributed by UCAR/Unidata
- Version or snapshot: ABI-L2-ACMC-M6, CONUS scene, five-minute cadence
- Retrieval date: 2026-09-03
- Authoritative source: https://www.goes-r.gov/products/baseline-clear-sky-mask.html
- Authoritative source: https://thredds.ucar.edu/thredds/catalog/satellite/goes/east/products/CloudMask/CONUS/current/catalog.html
- Rights basis: GOES-R products are US Government works in the public domain. Unidata distributes them for research and education and asks that the service not be scraped; requests are subset to the pixels needed and cached rather than bulk-downloaded.
- Rights evidence: https://www.goes-r.gov/products/baseline-clear-sky-mask.html
- Rights evidence: https://www.unidata.ucar.edu/software/tds/
- Rights evidence: https://www.unidata.ucar.edu/legal/
- Attribution: Cloud observations from the NOAA GOES-R ABI clear-sky mask, served by UCAR/Unidata.
- Public source redistribution: not-applicable-external-service
- Public deployment redistribution: not-bundled
- Modification status: values-passed-through-unaltered
- Repository paths: `netlify/functions/goes-cloud-mask.mts`, `src/data/tracker/cloudObservation.ts`, `src/data/tracker/cloudSuitability.ts`, `src/data/tracker/goesGrid.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: Requests must stay subset and cached rather than bulk. The classification must be presented as a classification: it may not be converted into a cloud-cover percentage, and the cloud probability may not be presented as sky cover.

## NSF NOIRLab deep-sky photographs used as Tracker hero imagery

- Inventory ID: `noirlab-deep-sky-photography`
- Category: deep-sky-photography
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: NSF NOIRLab/AURA
- Version or snapshot: Public release images, retrieved 2026-09-01
- Retrieval date: 2026-09-01
- Authoritative source: https://noirlab.edu/public/images/
- Authoritative source: https://noirlab.edu/public/images/
- Rights basis: Creative Commons Attribution 4.0 International (CC BY 4.0). NOIRLab releases its public images under CC BY 4.0, requiring the credit to be clearly and visibly presented.
- Rights evidence: https://noirlab.edu/public/copyright/
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Attribution: NSF NOIRLab/NSF/AURA. Full per-image credits are rendered on each image in the interface.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/sky/noirlab-noao-02211-ngc7009-thumb.webp`, `public/sky/noirlab-noao-02211-ngc7009.webp`, `public/sky/noirlab-noao-02464-ngc457-thumb.webp`, `public/sky/noirlab-noao-02464-ngc457.webp`, `public/sky/noirlab-noao-02637-m6-thumb.webp`, `public/sky/noirlab-noao-02637-m6.webp`, `public/sky/noirlab-noao-04086-m16-thumb.webp`, `public/sky/noirlab-noao-04086-m16.webp`, `public/sky/noirlab-noao-hcper-double-cluster-thumb.webp`, `public/sky/noirlab-noao-hcper-double-cluster.webp`, `public/sky/noirlab-noao-m13kpno4m-m13-thumb.webp`, `public/sky/noirlab-noao-m13kpno4m-m13.webp`, `public/sky/noirlab-noao-m27-kpno-mayall-4-m-m27-thumb.webp`, `public/sky/noirlab-noao-m27-kpno-mayall-4-m-m27.webp`, `public/sky/noirlab-noao-m35-m35-thumb.webp`, `public/sky/noirlab-noao-m35-m35.webp`, `public/sky/noirlab-noao-m44bash-m44-thumb.webp`, `public/sky/noirlab-noao-m44bash-m44.webp`, `public/sky/noirlab-noao-m45-m45-thumb.webp`, `public/sky/noirlab-noao-m45-m45.webp`, `public/sky/noirlab-noao-m92-m92-thumb.webp`, `public/sky/noirlab-noao-m92-m92.webp`, `public/sky/noirlab-noao0001a-m31-thumb.webp`, `public/sky/noirlab-noao0001a-m31.webp`, `public/sky/noirlab-noirlab2206b-satellite-train-thumb.webp`, `public/sky/noirlab-noirlab2206b-satellite-train.webp`, `scripts/build-tracker-imagery.mjs`, `src/data/tracker/heroImagery.json`
- Production paths: `assets/TrackerApp-*.js`, `sky/noirlab-noao-02211-ngc7009-thumb.webp`, `sky/noirlab-noao-02211-ngc7009.webp`, `sky/noirlab-noao-02464-ngc457-thumb.webp`, `sky/noirlab-noao-02464-ngc457.webp`, `sky/noirlab-noao-02637-m6-thumb.webp`, `sky/noirlab-noao-02637-m6.webp`, `sky/noirlab-noao-04086-m16-thumb.webp`, `sky/noirlab-noao-04086-m16.webp`, `sky/noirlab-noao-hcper-double-cluster-thumb.webp`, `sky/noirlab-noao-hcper-double-cluster.webp`, `sky/noirlab-noao-m13kpno4m-m13-thumb.webp`, `sky/noirlab-noao-m13kpno4m-m13.webp`, `sky/noirlab-noao-m27-kpno-mayall-4-m-m27-thumb.webp`, `sky/noirlab-noao-m27-kpno-mayall-4-m-m27.webp`, `sky/noirlab-noao-m35-m35-thumb.webp`, `sky/noirlab-noao-m35-m35.webp`, `sky/noirlab-noao-m44bash-m44-thumb.webp`, `sky/noirlab-noao-m44bash-m44.webp`, `sky/noirlab-noao-m45-m45-thumb.webp`, `sky/noirlab-noao-m45-m45.webp`, `sky/noirlab-noao-m92-m92-thumb.webp`, `sky/noirlab-noao-m92-m92.webp`, `sky/noirlab-noao0001a-m31-thumb.webp`, `sky/noirlab-noao0001a-m31.webp`, `sky/noirlab-noirlab2206b-satellite-train-thumb.webp`, `sky/noirlab-noirlab2206b-satellite-train.webp`
- Restrictions and notes: The per-image credit must remain rendered on the image itself; the publisher requires it to be clearly and visibly presented rather than hidden behind a disclosure control. Each image must keep its perception classification and the sentence saying how the eye differs from the photograph.

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

## OpenNGC

- Inventory ID: `openngc-deep-sky-showpieces`
- Category: astronomical-catalog-data
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Mattia Verga
- Version or snapshot: master, database_files/NGC.csv and database_files/addendum.csv
- Retrieval date: 2026-09-01
- Authoritative source: https://github.com/mattiaverga/OpenNGC
- Authoritative source: https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv
- Rights basis: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
- Rights evidence: https://github.com/mattiaverga/OpenNGC#license
- Rights evidence: https://creativecommons.org/licenses/by-sa/4.0/
- Attribution: OpenNGC by Mattia Verga, licensed CC BY-SA 4.0; Orbit Studio curated twenty-six-object subset with derived equipment tiers.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-share-alike
- Repository paths: `src/data/deep-sky/showpieces.json`, `src/data/deep-sky/LICENSE-CC-BY-SA-4.0.txt`, `src/data/deep-sky/README.md`, `scripts/build-deep-sky-showpieces.mjs`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: The curated subset remains under CC BY-SA 4.0; retain attribution, licence link and change description. Kept outside the paths reserved in LICENSES.md so that a share-alike dataset is not swept into an all-rights-reserved boundary.

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

## Screenshots and renders of Orbit Studio's own interfaces, framed for the homepage product list

- Inventory ID: `orbit-studio-home-product-imagery`
- Category: image-texture
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Orbit Studio (this project)
- Version or snapshot: Regenerated 2026-08-30 for the vertical product-row layout
- Retrieval date: 2026-08-30
- Authoritative source: https://github.com/hendrikv-dev/orbit-studio
- Authoritative source: https://github.com/hendrikv-dev/orbit-studio
- Rights basis: The imagery is this project's own output and is redistributed under the project's licence. The third-party data visible inside tracker-home.webp is open and permits the rendering and redistribution of derived map images with attribution, which is recorded above and rendered live in Tracker; the Earth texture in the other two is NASA imagery, which is not subject to copyright in the United States.
- Rights evidence: https://www.openstreetmap.org/copyright
- Rights evidence: https://opendatacommons.org/licenses/odbl/1-0/
- Rights evidence: https://mapterhorn.com/attribution
- Rights evidence: https://visibleearth.nasa.gov/collection/1484/blue-marble
- Attribution: Orbit Studio. Tracker's map contains OpenStreetMap data via OpenFreeMap and OpenMapTiles, and terrain from Mapterhorn.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/home/tracker-home.webp`, `public/home/explorer-home.webp`, `public/home/playground-home.webp`
- Production paths: `home/tracker-home.webp`, `home/explorer-home.webp`, `home/playground-home.webp`
- Restrictions and notes: If the Tracker screenshot is replaced, the replacement inherits the same basemap and terrain attributions for as long as it shows rendered map data.

## Orbit Studio satellite pass prediction and naked-eye screening

- Inventory ID: `orbit-studio-satellite-pass-prediction`
- Category: orbit-studio-original-work
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Orbit Studio
- Version or snapshot: Written for this repository
- Authoritative source: https://github.com/hendrikv-dev/orbit-studio
- Authoritative source: https://github.com/hendrikv-dev/orbit-studio
- Rights basis: Original work in this repository, governed by its own licence.
- Rights evidence: https://github.com/hendrikv-dev/orbit-studio
- Attribution: Orbit Studio.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted
- Repository paths: `src/data/tracker/satelliteVisibility.ts`, `src/data/tracker/satellites.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: None.

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
- Version or snapshot: Runtime API, not a pinned snapshot; hourly aerosol_optical_depth and pm2_5, requested with past_days=1 and forecast_days=3
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
- Restrictions and notes: NOAA acknowledgment must remain visible wherever aurora figures are shown, and no endorsement may be implied. Any percentage shown must be NOAA's published figure, unmodified and attributed; a value Tracker derives from it may not be presented as a probability or as NOAA's. Nothing beyond the three-day K-index horizon may be presented as a forecast. If the operator ever adds a proxy, its caching must respect the one-minute publication cadence. The derived horizon-visibility angle and look direction are Tracker's own geometry, not a NOAA product, and must not be presented as NOAA's viewline.

## OpenFreeMap public vector tile service, serving the OpenMapTiles schema over OpenStreetMap data

- Inventory ID: `tracker-basemap-tiles`
- Category: runtime-external-service
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: OpenFreeMap (service); OpenMapTiles (schema); OpenStreetMap contributors (data)
- Version or snapshot: Runtime tile service, not a pinned snapshot; style and tiles fetched per session
- Retrieval date: 2026-08-28
- Authoritative source: https://openfreemap.org/
- Authoritative source: https://tiles.openfreemap.org/styles/dark
- Rights basis: The underlying data is OpenStreetMap under ODbL 1.0 and the OpenMapTiles schema and OpenFreeMap's own stack are openly licensed, so rendering and redistribution of map images are not in question, and the required attribution is rendered in the map's attribution control. What is unresolved is exactly what is unresolved for place search: production reliance on a courtesy public endpoint with no usage agreement. Resolving it means serving our own tiles, which is the recorded plan rather than an aspiration.
- Rights evidence: https://openfreemap.org/
- Rights evidence: https://github.com/hyperknot/openfreemap/blob/main/LICENSE
- Rights evidence: https://openmaptiles.org/
- Rights evidence: https://www.openstreetmap.org/copyright
- Rights evidence: https://opendatacommons.org/licenses/odbl/1-0/
- Attribution: © OpenStreetMap contributors · OpenFreeMap · OpenMapTiles.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `src/data/tracker/basemapSource.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: The OpenStreetMap, OpenFreeMap and OpenMapTiles attribution must remain visible on the map. This entry must not be marked verified while the public instance is the tile source: it is a development and prototyping source, and shipping it as the permanent one was explicitly ruled out.

## Open-Meteo Forecast API cloud cover, from NOAA HRRR and the best available global model

- Inventory ID: `tracker-cloud-forecast`
- Category: runtime-weather-forecast
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Open-Meteo, from NOAA NCEP (HRRR) and the global models Open-Meteo selects
- Version or snapshot: Live service; no snapshot retained
- Authoritative source: https://open-meteo.com/en/docs
- Authoritative source: https://api.open-meteo.com/v1/forecast
- Rights basis: Open-Meteo publishes its APIs for free non-commercial use without an API key and licenses the data under CC BY 4.0. HRRR is a NOAA product in the public domain.
- Rights evidence: https://open-meteo.com/en/license
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Rights evidence: https://rapidrefresh.noaa.gov/hrrr/
- Attribution: Cloud forecast from Open-Meteo, licensed CC BY 4.0, using NOAA's HRRR model where it applies.
- Public source redistribution: not-applicable-external-service
- Public deployment redistribution: not-bundled
- Modification status: permitted-with-attribution
- Repository paths: `src/data/tracker/cloud.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: The attribution must remain with the layer. The model that actually answered must be named in the reading rather than assumed to be HRRR.

## Earth Observation Group Annual VIIRS Nighttime Lights V2.1, annual average, 2024, 15 arc-second

- Inventory ID: `tracker-light-pollution-viirs`
- Category: scientific-dataset
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Earth Observation Group, Payne Institute for Public Policy, Colorado School of Mines (data); obtained through the OpenLandMap redistribution on Zenodo (T. Hengl), record 17294744
- Version or snapshot: nightlights.average_viirs.v21_m_500m_s_20240101_20241231_go_epsg4326_v20250904.tif
- Retrieval date: 2026-08-30
- Authoritative source: https://eogdata.mines.edu/products/vnl/
- Authoritative source: https://zenodo.org/records/17294744
- Rights basis: The Zenodo record carries CC BY 4.0 and the underlying EOG VIIRS Nighttime Lights products are released under CC BY 4.0. Attribution is required and is satisfied two ways: the map's attribution control names the Earth Observation Group, and the archive's own index file carries the Elvidge et al. (2021) citation the publisher asks for. Redistribution of a derived, resampled product is permitted with that attribution.
- Rights evidence: https://zenodo.org/records/17294744
- Rights evidence: https://eogdata.mines.edu/products/vnl/
- Rights evidence: https://creativecommons.org/licenses/by/4.0/
- Rights evidence: https://doi.org/10.3390/rs13050922
- Attribution: Night-time lights: Earth Observation Group, Colorado School of Mines - Annual VIIRS Nighttime Lights V2.1 (Elvidge, Zhizhin, Ghosh, Hsu & Taneja 2021), CC BY 4.0.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `public/tracker/light-pollution-v21-2024.bin`, `public/tracker/light-pollution-v21-2024.json`, `scripts/build-light-pollution-tiles.py`, `src/data/tracker/lightPollution.ts`
- Production paths: `tracker/light-pollution-v21-2024.bin`, `tracker/light-pollution-v21-2024.json`
- Restrictions and notes: The Earth Observation Group credit and the Elvidge et al. (2021) citation must remain, both being conditions of CC BY 4.0. The value must not be presented as a Bortle class, an SQM reading, a limiting magnitude, or as a prediction of what will be visible overhead.

## MapLibre GL JS, an open-source WebGL renderer for vector map tiles

- Inventory ID: `tracker-map-renderer`
- Category: software-dependencies
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: MapLibre contributors
- Version or snapshot: 6.6.0, from the npm registry and pinned in package-lock.json
- Retrieval date: 2026-08-28
- Authoritative source: https://github.com/maplibre/maplibre-gl-js
- Authoritative source: https://maplibre.org/
- Rights basis: MapLibre GL JS is published under the 3-Clause BSD licence, which permits use, modification and redistribution in source and binary form with the copyright notice and disclaimer retained. The notice travels in the bundled licence banner and in THIRD_PARTY_NOTICES.md.
- Rights evidence: https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt
- Rights evidence: https://opensource.org/license/bsd-3-clause
- Attribution: Map rendering by MapLibre GL JS, 3-Clause BSD.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `src/components/tracker/map/TrackerMapCanvas.tsx`
- Production paths: `assets/TrackerApp-*.js`, `assets/maplibre-gl-worker-*.js`
- Restrictions and notes: The BSD copyright notice and disclaimer must remain in the distributed bundle and in THIRD_PARTY_NOTICES.md.

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

## Mapterhorn public terrain tiles, Terrarium-encoded elevation built from 148 open elevation datasets

- Inventory ID: `tracker-terrain-elevation`
- Category: runtime-external-service
- Release status: retained
- Release 1.0 included: yes
- Publisher or rights holder: Mapterhorn (tile build and service); the 148 national, regional and agency producers listed at mapterhorn.com/attribution (data)
- Version or snapshot: Runtime tile service, not a pinned snapshot; TileJSON read per session, tiles fetched on demand
- Retrieval date: 2026-08-30
- Authoritative source: https://mapterhorn.com/attribution
- Authoritative source: https://tiles.mapterhorn.com/tilejson.json
- Rights basis: Mapterhorn's own code is BSD-3-Clause and its published source catalogue lists 148 datasets, every one of them open: 37 CC BY 4.0, 34 US Government public domain, 21 Licence Ouverte 2.0, the Copernicus full, free and open licence, and the remainder open government or CC0/CC-BY variants. Nothing in the catalogue is non-commercial, share-alike or research-only, so drawing and redistributing derived map images is not in question. Most of those licences do require attribution and no map corner can carry 148 credits; the publisher's own mechanism, which those licences accept, is a link to the full list, and Tracker's attribution control renders that link. What is unresolved is the same thing that is unresolved for the basemap and for place search: production reliance on a free public endpoint with no usage agreement, on a service that is measurably rate-limited.
- Rights evidence: https://mapterhorn.com/attribution
- Rights evidence: https://download.mapterhorn.com/attribution.json
- Rights evidence: https://github.com/mapterhorn/mapterhorn/blob/main/LICENSE
- Rights evidence: https://www.usgs.gov/3d-elevation-program
- Rights evidence: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- Attribution: Terrain © Mapterhorn, from USGS 3DEP, Copernicus DEM and other open elevation sources, linked to the full source list at mapterhorn.com/attribution.
- Public source redistribution: source-safe
- Public deployment redistribution: deployment-safe
- Modification status: permitted-with-attribution
- Repository paths: `src/data/tracker/terrainSource.ts`, `src/data/tracker/terrainHorizon.ts`, `src/data/tracker/demService.ts`, `src/data/tracker/eventTerrain.ts`, `src/data/tracker/geodesy.ts`
- Production paths: `assets/TrackerApp-*.js`
- Restrictions and notes: The Mapterhorn credit must remain a live link to mapterhorn.com/attribution: that link is what satisfies the attribution terms of the CC BY and open-government datasets underneath, and replacing it with plain text would leave those credits undischarged. This entry must not be marked verified while the public instance is the tile source.

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
