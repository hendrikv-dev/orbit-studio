# Codex Contract: Orbit Studio Satellite Data

This file is binding project guidance for any agent changing Orbit Studio's catalog or timeline behavior.

## Single source of truth

Use `data/orbit-studio-satellites.sqlite`.

Do not create a second “temporary,” “sample,” “release,” “current,” or “historical” satellite database. Do not copy records into hand-maintained TypeScript/JSON fixtures except as generated build outputs that retain source identifiers and provenance.

## Required query paths

- Default public Earth population:
  `SELECT * FROM snapshot_present_earth_objects`
- Only spacecraft/payloads:
  add `WHERE object_class = 'payload'`
- Population for a historical year:
  join `objects` to `yearly_presence` by `jcat`, filter `year`, and use `present_at_period_end` or `present_any_time_during_period` deliberately.
- Rendering inputs:
  use `reconstruction_candidates`; never invent a second reconstruction algorithm in UI code.
- Annual counts:
  use `data/yearly_summary.csv` or aggregate `yearly_presence`.

## Data meanings that must not be changed

- `snapshot_present` means no recorded end/descent date in the packaged snapshot.
- It does not mean active, transmitting, tracked live, or operational.
- `object_class = payload` is the spacecraft/satellite subset.
- Reconstructed orbital angles are deterministic educational values.
- Source-backed membership and orbit shape must remain separate from reconstructed angles.
- UI copy must never call reconstructed positions “live,” “exact,” or “observed.”

## Forbidden substitutions

Do not use any of the following as a bundled public authority without a new reviewed provenance decision:

- CelesTrak snapshot data
- Space-Track responses
- legacy Hipparcos-derived files
- application fixtures
- six-object or similarly tiny “reference” catalogs
- randomly generated satellite clouds
- stale generated files detached from their raw snapshot

Optional runtime acquisition can be implemented separately, but it must not overwrite this packaged source of truth.

## Change protocol

A catalog change is valid only when all of these change together:

1. A new immutable file under `raw/`
2. Updated normalized/derived data built by `scripts/build.py`
3. Updated `manifest.json`
4. Updated `CHECKSUMS.sha256`
5. Passing `scripts/verify.py`
6. Explicit review of record counts, class counts, year coverage, and rendering population
7. Attribution retained

Never delete an older raw snapshot solely because a new one exists. Never rewrite derived outputs manually.

## Product acceptance floor

A release is invalid if the default Earth view is visually empty or reduced to a handful of curated objects while this package contains tens of thousands of eligible public records.

Tests must validate:

- meaningful default population size;
- payload, rocket-body, component, and debris coverage;
- deterministic reconstruction;
- year-by-year membership;
- explicit provenance labels;
- visible default rendering, not merely nonzero scene objects.
