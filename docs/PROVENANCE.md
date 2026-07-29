# Redistribution and Provenance

## Scope and Authority

`provenance/inventory.json` is Orbit Studio's sole machine-readable authority for
project-controlled third-party datasets, images, textures, remote media, scientific fixtures,
adapted validation code, and excluded or local-only material. It records source and publication
URLs, publisher or rights holder, upstream version or snapshot, retrieval date, original and local
checksums where practical, processing, rights evidence, attribution, modification status, separate
source/deployment redistribution decisions, and Release 1.0 inclusion.

`ATTRIBUTION.md` and `public/earth/README.md` are generated from that inventory. Do not edit them by
hand. `THIRD_PARTY_NOTICES.md` is generated from `package-lock.json`, which is the sole authority for
the installed npm dependency graph. These generated files are views, not competing manifests.

This is an evidence-backed engineering publication review, not a broader legal opinion. Public
availability, a familiar publisher name, a filename, or silence is never treated as a
redistribution grant.

## Release 1.0 Inventory Result

The item-by-item Release 1.0 inventory result is generated as `ATTRIBUTION.md`. It includes retained,
test-only, external-acquisition, local-only, placeholder, and excluded decisions together with
separate source and deployment status. `npm run provenance:validate` checks that generated view
byte-for-byte against `provenance/inventory.json`; this document intentionally does not duplicate
the table as a second hand-maintained inventory.

The inventory also checksum-classifies project-authored JSON and SVG release guards and the
source-embedded Explorer reference compilation. The latter includes curated educational summaries,
representative display geometry, simplified regions, and approximate DSN locations. Its official
fact references and non-operational limitations are recorded without treating it as current
catalog, ephemeris, or boundary data.

## Rights Evidence

The inventory cites the authoritative publisher or upstream license for each retained item:

- NASA Images and Media Usage Guidelines and the official NASA publication page for each NASA
  texture or mission image;
- the NASA Scientific Visualization Studio record and its explicit CGI Moon Kit contributor
  credits;
- Natural Earth's official terms, which expressly permit modification and electronic
  dissemination of its public-domain map data;
- the HYG Database repository's CC BY-SA 4.0 license at the recorded immutable commit;
- GCAT's official publication page and CC BY 4.0 statement;
- NASA/JPL Horizons and U.S. Naval Observatory API documentation for the scientific fixture;
- the upstream Python-SGP4/satellite.js license chain for the adapted Vallado validation vector;
- Orbit Studio authorship plus official NASA/JPL, GPS.gov, ESA, NOAA, and mission references for
  the source-embedded Explorer educational compilation;
- each locked npm package's metadata and installed license or notice text, with a documented
  immutable upstream-license override for the one lock entry that omits its SPDX field.

CelesTrak's official usage policy is evidence for direct acquisition, caching discipline, and
service-use constraints. It does not state a public snapshot or derived-record redistribution
grant. The release decision is therefore an evidence-conservative technical inference: rights are
unresolved, so the records are excluded. It is not a claim that redistribution is prohibited.

Space-Track data is similarly local-only unless an explicit grant covering the intended artifact
and publication mode is supplied. No account terms, credentials, source archives, or generated
private artifacts are redistributed.

## Public and Local Current-Catalog Modes

The default release mode imports `src/data/explorerCelestrakCatalog.records.json`, a checked
project-authored empty array. Explorer shows a small project-authored representative orbit scenario,
labels Current as reference-only, records zero current catalog records in review metadata, and does
not imply current membership or measured position.

`npm run catalog:sync` directly acquires current data into:

```text
data/local-only/celestrak/
  explorerCelestrakCatalog.records.json
  acquisition.provenance.json
```

The receipt records source URLs, source-response or local-input checksums, HTTP metadata or an
identified cache reuse, retrieval time, processing, snapshot date, record count, and transformed
local checksum. Set `ORBIT_CURRENT_CATALOG_MODE=local` to inject those records into a private
development or build session. The path is ignored by Git, `--write-runtime` is disabled, release
review runs only in release mode, and production-bundle validation rejects CelesTrak markers or
unclassified data.

This fallback preserves an understandable first run without fabricating catalog data or presenting
representative elements as equivalent to live records.

## Automated Safeguards

Run:

```sh
npm run provenance:generate
npm run licenses:validate
npm run build
npm run provenance:validate
npm run history:validate
npm run source:archive
```

`provenance:validate` separately reports the current-tree and production-bundle audits. The
current-tree audit covers every tracked file and every non-ignored untracked file. It intentionally
does not inspect ignored private acquisitions: those files may exist in a developer checkout but
are neither tracked source nor approved archive inputs. The current-tree audit fails for:

- an artifact-like tracked or untracked file without a provenance or first-party classification;
- a checksum change to classified source-embedded reference data;
- an included item without verified source and deployed redistribution status;
- a missing or changed local checksum;
- a prohibited local/generated prefix, OS metadata file, former snapshot hash, or legacy review
  artifact;
- an external hostname not acknowledged by the inventory controls;
- stale generated attribution, Earth notice, or dependency notices;
- a missing production build;
- an unclassified image, data, font, model, or other artifact in the actual Vite output;
- an external hostname present only in the production bundle that is not acknowledged by the
  inventory controls;
- a prohibited filename or CelesTrak snapshot marker in the bundle;
- a production `orbit-release.json` that does not explicitly identify release catalog mode;
- a missing or checksum-mismatched bundled asset or notice.

`licenses:validate` traverses every package entry in `package-lock.json`, rejects missing or
unsupported licensing metadata unless an exact reviewed override exists, identifies runtime versus
development packages, and verifies the generated notice byte-for-byte.

`history:validate` enumerates every commit and blob reachable from `HEAD`. It rejects any reachable
blob whose SHA-256 is in `controls.prohibitedHistoricalChecksums`, even if a later commit deleted
the path. It also rejects excluded evidence, screenshots, generated catalogs, local-only
acquisitions, raw acquisitions other than the tracked `.gitkeep`, and review output anywhere in
publishable ancestry. Local reflogs and unreachable checkpoint objects are not branch ancestry and
are not included by `git push` or `git archive`.

`release:verify` invokes the current-tree, production-bundle, dependency-license, and
reachable-history validators. It also requires the final review package to contain the committed
attribution, dependency notices, and provenance inventory.

`source:archive` creates an ignored `.tar.gz` directly from tracked `HEAD` with `git archive`, then
parses and verifies the generated archive. Verification requires an exact entry match with the
`HEAD` tree and rejects prohibited or unexpected paths, unclassified artifacts, credential-like
files, and prohibited content hashes. Ignored working files cannot enter the archive.

CI builds first, then runs the same provenance and dependency-license validators before the wider
release verification and tracked-source archive generation.

## Five Distinct Release Boundaries

1. **Private working directory.** May contain ignored CelesTrak, Space-Track, raw historical,
   generated, review, dependency, cache, or credential files. It is not a redistributable artifact.
2. **Current tracked source tree.** The files selected by Git at `HEAD`; current-tree provenance
   validates their classifications and checksums. Non-ignored untracked files make release source
   identity dirty, while ignored private files remain outside this claim.
3. **Publishable reachable history.** Every commit and blob reachable from the branch tip. Deleting
   a restricted file in the latest tree does not make this history safe.
4. **Redistribution-safe source archive.** The verified `git archive` output containing exactly the
   tracked `HEAD` entries and none of the private working-directory state or Git metadata.
5. **Verified deployment bundle.** The separately audited `dist/` output, including its release
   catalog-mode descriptor, notices, provenance manifest, and approved deployed assets.

Never describe an arbitrary ZIP of the working directory as validated release source. Use
`npm run source:archive`.

## Updating Third-Party Material

1. Start with the original publisher, official dataset documentation, or immutable upstream
   repository license.
2. Record the exact identity, source, rights evidence, required credits, source/deployment
   decisions, processing, and checksums in `provenance/inventory.json`.
3. Choose exclusion or local acquisition when an authoritative redistribution basis is not
   available. Do not infer permission from access or silence.
4. Regenerate notices with `npm run provenance:generate`.
5. Build and run both validators. Inspect the production output rather than assuming imports define
   what shipped.
6. Update deterministic fixtures and review evidence only with material that has the same
   classification and release-safe basis.

Never hand-edit generated notices, commit `node_modules`, or commit files under `data/generated/`,
`data/local-only/`, `evidence/`, `screenshots/`, or `review/`.

## Boundaries of the Release Claim

This provenance pass establishes an evidence-backed redistribution basis for the tracked Release
1.0 source and built application at the recorded inventory versions. It does not establish
scientific completeness of the GCAT sample, observational accuracy of reconstructed history,
permission for a future replacement asset, permission for privately acquired CelesTrak or
Space-Track data, or rights outside the documented uses and restrictions. Those boundaries require
new evidence and an intentional inventory update.
