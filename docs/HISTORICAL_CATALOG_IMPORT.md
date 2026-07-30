# Canonical Satellite Catalog Package

## Authority

Orbit Studio ships exactly one current-and-historical satellite/object database:

```text
data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite
```

It belongs to the verified Orbit Studio Satellite Source of Truth v1.0.0 package. The immutable
upstream evidence is:

```text
data/satellite-source-of-truth/raw/gcat-satcat-2026-06-27.tsv
```

The source is Jonathan C. McDowell's General Catalog of Artificial Space Objects (GCAT), Standard
Satellite Catalog (`satcat`), source header updated `2026-06-27T22:13:02Z`. GCAT is licensed CC BY
4.0. Required attribution is:

> Data from GCAT (J. McDowell, planet4589.org/space/gcat)

Exact source, package, artifact, rights, and checksum evidence lives in
`provenance/inventory.json`. This document describes scientific and runtime semantics; it is not a
second provenance manifest.

## Package contents

The package preserves:

- 69,703 normalized GCAT source records;
- payload, rocket-body, component, debris, spurious, and unknown source classifications;
- 1957–2026 annual presence, with 2026 partial through June 27;
- 33,489 latest Earth-object members in the four rendered/cataloged classes;
- source identity, names, aliases, owner/status, lifecycle, orbit epoch, perigee, apogee, and
  inclination;
- deterministic reconstruction candidates and package-specified generated angular elements;
- a quality-issue ledger and explicit date-interval anomalies;
- the schema, build/update scripts, package manifest, provenance, and exact checksums.

Run the package verifier directly or through npm:

```sh
python3 data/satellite-source-of-truth/scripts/verify.py
npm run satellites:verify
```

Both must pass before a catalog change is accepted.

## Browser export

The SQLite database remains the source of truth. The browser consumes one deterministic derivative:

```text
src/data/generated/satelliteCatalog.web.json
```

Generate it with:

```sh
npm run satellites:build
```

The generator:

1. runs the package verifier;
2. validates the database and immutable raw checksum against the package manifest;
3. queries every Earth-associated payload, rocket body, component, and debris record;
4. preserves stable JCAT and available SATCAT identifiers;
5. records annual membership ranges, classification, lifecycle, and orbital constraints;
6. verifies package-provided reconstruction angles;
7. applies the same documented SHA-256 reconstruction formula to historical rows that predate the
   package's latest reconstruction-candidate table;
8. writes canonical counts, source identity, processing notes, and data semantics into the artifact;
9. produces byte-identical output for identical inputs.

`scripts/build-satellite-web-catalog.test.mjs` generates into a temporary directory and compares
the bytes with the tracked artifact.

## Membership semantics

Completed years use `yearly_presence.present_at_period_end = 1`. The selected Explorer timestamp is
the corresponding December 31 period end. This is annual membership evidence, not sub-day event
timing.

The partial 2026 period uses the package-required `snapshot_present_earth_objects` view at
`2026-06-27T22:13:02Z`. Two rows differ from the generic partial-year `present_at_period_end`
calculation because of recorded interval anomalies. The exporter documents and validates this
reconciliation rather than silently choosing one count.

Membership means the source/package says an object belongs in that annual snapshot. It does not
mean a payload is operational, transmitting, observed at the displayed position, or tracked live.

## State classification

Orbit Studio keeps four concepts separate:

1. **Source-backed membership** — identity, class, and annual/latest inclusion come from GCAT and
   the verified package.
2. **Source-provided orbital constraints** — orbit epoch, perigee, apogee, and inclination remain
   source fields.
3. **Reconstructed educational state** — missing RAAN, argument of periapsis, and mean anomaly are
   stable deterministic package/export outputs. Runtime converts mean anomaly to true anomaly and
   uses the shared two-body propagator.
4. **Catalog-only** — a source member with missing or physically invalid orbital constraints. It
   remains searchable and inspectable but receives no marker or fabricated orbit.

The latest membership contains 33,468 reconstructed renderable states and 21 catalog-only rows.
Across the supported Earth-associated four-class history there are 69,376 reconstruction-capable
rows and 244 catalog-only rows. The 21 latest zero/invalid-envelope cases are not made renderable by
weakening the physical invariant that semi-major axis must exceed Earth radius.

Reconstructed states must never be labeled live, observed, exact, or current tracking.

## Presentation-only references

Curated Explorer records provide recognizable names, educational summaries, discovery ordering,
constellation associations, and a small set of explicitly project-authored reference orbits.
They are a derived presentation layer, never membership authority.

The latest GCAT membership semantics do not retain Hubble after its deployment event or Zarya after
its initial ISS docking event. Orbit Studio therefore keeps their recognizable current Explorer
entries as `curated-reference-orbit`, separately counted from GCAT membership and reconstructed
states. Historical views do not inject that current presentation fallback.

## Updating

A package update is valid only when all of these move together:

1. a new immutable file under `data/satellite-source-of-truth/raw/`;
2. regenerated package products from `scripts/build.py`;
3. updated package `manifest.json`, `provenance.json`, and `CHECKSUMS.sha256`;
4. passing package verification;
5. regenerated browser artifact;
6. reviewed membership, class, reconstruction, catalog-only, and quality counts;
7. updated `provenance/inventory.json`, generated attribution, tests, review thresholds, and docs;
8. production build, review, release verification, and archive verification.

Do not introduce a second sample, local override, current feed, hidden fallback, random cloud, or
hand-maintained satellite database. CelesTrak snapshots and Space-Track responses remain excluded
unless a future explicit, evidence-backed architecture and redistribution decision replaces this
contract.
