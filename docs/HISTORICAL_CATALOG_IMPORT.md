# Explorer Historical Data Pipeline

Orbit Explorer never parses raw SATCAT, GCAT, or GP History files in the browser. Runtime code
consumes only deterministic artifacts generated at build time:

`src/data/historical/explorerHistoricalCatalog.normalized.json`

Repository builds ship a bounded GCAT-derived public sample in this location so the public app can
demonstrate timeline behavior without redistributing full SATCAT/CelesTrak-derived membership.
Source-backed builds are produced locally from authorized source archives and may present historical
catalog membership as complete when validation passes.

## Build Modes

Source-backed complete-membership build:

- Space-Track SATCAT source artifact is present.
- Required validation has zero errors.
- Every catalog object used for historical membership has a launch date.
- `runtimeArtifacts.coverageManifest.completeMembership` is `true`.

Repository/demo build:

- Required SATCAT artifact is absent.
- The normalized artifact records `historicalMembership: "blocked-missing-satcat"`.
- Explorer must not claim historical completeness.
- A CC-BY GCAT-derived public sample may be bundled for public timeline/catalog demonstration.
- Full generated artifacts stay under ignored `data/generated/historical/` unless a private build
  explicitly opts into `--write-runtime`.

## Runtime Architecture

Historical source acquisition

Raw archives

Normalization

Validation

Canonical historical database

Indexed runtime artifacts

Historical query engine

Renderer/UI

All historical reconstruction continues to flow through `getHistoricalCatalog(selectedDate)` in
`src/data/explorerCatalog.ts`, which delegates membership and orbit availability to
`src/data/explorerHistoricalPipeline.ts`.

## Commands

Download authorized raw sources:

```sh
npm run data:download
```

Import and generate deterministic runtime artifacts:

```sh
npm run data:import
```

By default this writes to ignored `data/generated/historical/explorerHistoricalCatalog.normalized.json`.
Use `npm run data:import -- --write-runtime` only for private local builds after reviewing
redistribution terms, and do not commit full generated artifacts unless redistribution is confirmed.

Validate the normalized artifact:

```sh
npm run data:validate
```

Report coverage:

```sh
npm run data:coverage
```

Legacy alias:

```sh
npm run catalog:historical
```

## Space-Track Acquisition

Credentials are read only from environment variables:

```sh
SPACE_TRACK_USERNAME=...
SPACE_TRACK_PASSWORD=...
```

Never commit credentials. Credentials are required only for build-time acquisition and are never
required at application runtime.

Default SATCAT query:

```txt
/basicspacedata/query/class/satcat/format/json
```

Override when needed:

```sh
SPACE_TRACK_SATCAT_QUERY_PATH=/basicspacedata/query/class/satcat/format/json
```

GP History acquisition is optional until historical orbit rendering is being built:

```sh
SPACE_TRACK_INCLUDE_GP_HISTORY=1
SPACE_TRACK_GP_HISTORY_START=1957-10-04
SPACE_TRACK_GP_HISTORY_END=1957-10-31
SPACE_TRACK_GP_HISTORY_CHUNK_DAYS=7
```

Or provide a Space-Track query directly:

```sh
SPACE_TRACK_GP_HISTORY_QUERY_PATH=/basicspacedata/query/class/gp_history/...
```

The downloader writes cached raw archives to:

```sh
data/historical-catalog/raw/
```

Use `--force` to replace cached files:

```sh
node scripts/download-explorer-historical-data.mjs --force
```

Raw archives and download manifests are ignored by git.

## GCAT Acquisition

GCAT is optional supplemental metadata. It must not replace SATCAT as the historical membership
authority.

Configure explicit GCAT URLs when local redistribution terms have been reviewed:

```sh
GCAT_SOURCE_URLS=https://example.invalid/gcat-source.tsv npm run data:download -- --gcat
```

GCAT fields can enrich names, aliases, mission metadata, object type labels, ownership labels, and
orbital-summary constraints. Perigee, apogee, and inclination may support an explicitly identified
educational reconstruction; they never become an exact historical position.

## Source Authority

| Dataset | Source | Purpose | Runtime role | Required |
| --- | --- | --- | --- | --- |
| SATCAT | Space-Track | Historical membership, lifecycle, identity, ownership, object type | Catalog membership authority | Yes |
| GP History | Space-Track | Historical orbit states and nearest-epoch lookup | Optional orbit rendering source | Required for full historical orbit rendering |
| Current GP | CelesTrak | Optional privately acquired current-day orbital state | Current view only; local mode only | No for the public release |
| GCAT | Jonathan McDowell GCAT | Supplemental metadata, lifecycle, and orbital envelopes | Metadata-constrained reconstruction when required fields exist | No |

Current CelesTrak GP must never reconstruct historical membership or historical orbits.

## Artifact Contract

The importer writes schema version 2:

```json
{
  "schemaVersion": 2,
  "generatedAt": "deterministic timestamp",
  "importVersion": "explorer-historical-import-v3",
  "sourceFingerprint": "sha256:...",
  "importStatus": {},
  "validation": {},
  "sourceFiles": [],
  "objects": [],
  "orbitStates": [],
  "runtimeArtifacts": {}
}
```

Runtime artifacts include:

- `objectIndex`
- `identityIndex`
- `launchIndex`
- `decayIndex`
- `orbitStateIndex`
- `coverageManifest`
- `sourceManifest`

Each artifact includes schema version, generated timestamp, import version, source fingerprint,
record counts, validation summary, and source checksums when available.

The same raw input produces the same normalized output. `SOURCE_DATE_EPOCH` may be set when a
specific deterministic timestamp is required.

## Canonical Identity

The importer creates one canonical object per logical object. Merge order:

1. NORAD catalog number
2. International designator / COSPAR id
3. Source record id
4. Normalized name, only as a last resort

Examples:

- `object-norad-25544`
- `object-intl-1998-067a`
- `object-source-...`

All source-specific identifiers are retained as aliases and provenance.

## Merge Policy

Field reconciliation is policy-driven:

| Field class | Preferred source | Fallback sources | Conflict handling |
| --- | --- | --- | --- |
| Lifecycle | Space-Track SATCAT | Equivalent authoritative catalog only | Validation error |
| Identity | Space-Track SATCAT | GCAT aliases, future source ids | Merge aliases, report duplicate identities |
| Ownership | Space-Track SATCAT | GCAT | Warning on conflict |
| Object type | Space-Track SATCAT | GCAT | Warning on conflict |
| Names/aliases | GCAT or SATCAT | Any source | Preserve alternates and provenance |
| Orbit states | Space-Track GP History | Historical GP/TLE/OMM archives | Never use current GP |

No field uses first-non-empty-wins semantics.

## Validation

Validated cases include:

- missing required SATCAT
- missing launch dates
- duplicate NORAD ids
- duplicate COSPAR ids
- conflicting launch, decay, or reentry dates
- conflicting ownership
- conflicting object types
- missing required identifiers
- missing object types
- invalid chronology
- invalid identifiers
- conflicting metadata

Validation issues are written into the artifact and surfaced by:

```sh
npm run data:validate
```

Complete-membership milestone checks run only when the artifact is SATCAT-backed and
validation-clean.

Vitest also includes `src/data/explorerHistoricalSourceBacked.integration.test.ts`. That suite is
skipped for repository/demo artifacts and runs only when
`runtimeArtifacts.coverageManifest.completeMembership` is `true`.

## Historical Membership

Membership depends only on lifecycle:

```txt
launchDate <= selectedDate
AND
decayDate/reentryDate is empty or >= selectedDate
```

Objects with unknown launch dates never appear in historical membership. Renderer code must not
participate in membership decisions.

## Historical Orbit Query

Historical orbit availability is independent from catalog completeness:

```txt
selectedDate + canonicalObjectId -> nearest valid GP History epoch -> orbit state
```

If no suitable source historical orbit record exists, Explorer may resolve a deterministic
reconstruction only when source perigee, apogee, and inclination constrain it. The state remains
marked reconstructed through the runtime and review outputs. Without those constraints, Explorer
retains catalog membership, searchability, and metadata but renders no physical marker.

## Licensing And Redistribution

See `provenance/inventory.json` for authoritative inclusion decisions and `ATTRIBUTION.md` for its
generated human-readable notice.

Space-Track data is governed by Space-Track account and redistribution terms. Do not commit raw
Space-Track exports unless the project has explicit permission to redistribute them.

GCAT is licensed under Creative Commons Attribution 4.0 International (CC-BY-4.0). Cite GCAT when
bundling raw GCAT files or normalized supplemental metadata.

CelesTrak current GP redistribution remains unresolved because the official usage policy does not
state a public snapshot or derived-record redistribution grant. The public repository and production
bundle therefore exclude those records. `npm run catalog:sync` is an explicit private local
acquisition path; its output and receipt remain under ignored `data/local-only/celestrak/`. Current
GP remains current-only.

The repository intentionally ignores:

```txt
data/historical-catalog/raw/**
data/historical-catalog/cache/**
data/generated/**
data/local-only/**
```

## Performance Notes

The normalized JSON artifact is suitable for SATCAT-scale catalog membership. GP History can be
multi-GB and should move to chunked/indexed storage before full historical orbit rendering. The
artifact model already separates `orbitStateIndex` from catalog membership so this can happen
without renderer changes.
