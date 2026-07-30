# Current Architecture Decisions

This file records active product-specific architecture decisions. It is subordinate to
`docs/ORBIT_CONSTITUTION.md`; engineering changes follow `AGENTS.md`. When a decision changes, record
the supersession rather than leaving contradictory active guidance.

## Earth Rendering — Active

Use the verified NASA Blue Marble surface texture on one Earth sphere with the locally vendored
Natural Earth 110m coastline overlay and generated fallbacks for asset-load failure. Earth
orientation and illumination derive from the shared celestial time and frame system.

Reason: recognizable geography supports orientation and education, while one sphere keeps the scene
coherent and efficient. Provenance and correct texture/frame alignment are more important than a
particular photorealistic or vector aesthetic.

This supersedes the earlier vector-only Earth texture decision. Asset provenance is documented in
`docs/sources.md`; frame and time behavior is documented in
`docs/celestial-accuracy-foundation.md`.

## Redistribution Provenance — Active

`provenance/inventory.json` is the sole machine-readable authority for project-controlled
third-party material. It owns source identity, checksums, transformations, rights evidence,
attribution, separate source/deployment redistribution decisions, and release inclusion.
`ATTRIBUTION.md` and the Earth asset notice are deterministic generated views. Dependency notices
are separately generated from `package-lock.json`, the dependency source of truth; no competing
hand-maintained dependency manifest exists.

The public build uses the verified Orbit Studio Satellite Source of Truth v1.0.0 SQLite database as
its single latest-public and historical membership authority. The database is built from the
immutable GCAT `satcat` snapshot dated 2026-06-27 under CC BY 4.0. A deterministic generated browser
artifact contains all supported Earth-associated payload, rocket-body, component, and debris rows;
it is a derived view, not a second database.

Missing angular elements are generated once by the package/export contract and disclosed; source
identity, annual/latest membership, lifecycle, orbit epoch, perigee, apogee, and inclination remain
separate from those generated values. Physically invalid envelopes remain catalog-only. CelesTrak
and Space-Track runtime/import authorities, the prior bounded GCAT sample, and optional local build
overrides are removed. Vite writes `orbit-release.json` into the bundle, and provenance validation
requires `release-public-gcat`.

Reason: public availability and technical access do not prove redistribution permission. Unknown
rights are resolved by exclusion while preserving an understandable, scientifically honest
first-run experience. A future redistribution grant would require an intentional inventory,
architecture, documentation, fixture, and validation update.

## Explorer — Active

Explorer observes the orbital environment and its source-limited history. It must distinguish
source records, model-derived states, reconstructions, and unavailable physical states. It should
not become a scenario editor, database table, or mission-design workspace.

Explorer discovery collections are deterministic derived indexes over the active catalog snapshot.
They may reorder or group records for educational relevance, but they do not own identity, lifecycle,
simulation eligibility, or rendering state. Complete Catalog preserves access to the full active
snapshot. Constellations are first-class selectable catalog entities whose members remain
individually searchable.

## Playground — Active

Playground is for manipulating understandable orbital scenarios. It starts simply and reveals
complexity progressively rather than duplicating Explorer's catalog workflow.

## Future Systems — Direction, Not Commitment

Mission Design, Scenarios, Library/Encyclopedia, rockets, lunar or Mars missions, and
FreeFlyer/STK-class workflows are possible future systems. They are not authorization to expand the
scope of current tasks.
