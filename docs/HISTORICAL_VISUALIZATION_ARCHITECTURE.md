# Historical Visualization Architecture

## One authority, one runtime path

The canonical satellite authority is the verified SQLite database at
`data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite`. The tracked compact browser
derivative is `src/data/generated/satelliteCatalog.web.json`. No bounded sample, optional local
override, current GP feed, or second historical database participates in the Explorer runtime.

`explorerHistoricalCatalog.ts` adapts the generated rows into the stable catalog/query interfaces.
`explorerHistoricalPipeline.ts` resolves annual membership and state availability.
`explorerCatalog.ts` adds presentation metadata, filtering, discovery, and Scenario conversion.
Every renderable state then follows the ordinary shared propagation, worker, point-cloud, selection,
diagnostics, and review path.

## Annual membership

The package covers 1957–2026. Completed years mean present at calendar-year end. The final 2026
snapshot is partial through `2026-06-27T22:13:02Z` and uses the package's explicit latest
Earth-object view. The timeline exposes these discrete annual states; it does not interpolate
membership or pretend an annual row is a sub-day launch/decay observation.

The package's membership ranges are contiguous for all exported Earth-associated supported-class
objects. The exporter refuses to collapse non-contiguous annual rows into a range.

## State resolution

Resolution order is:

1. a source state if a future approved package supplies one;
2. a deterministic educational reconstruction when the source provides a physically valid
   perigee, apogee, and inclination envelope;
3. catalog-only when those constraints are missing or invalid.

Current package history contains no exact/source Cartesian or complete angular state. All 69,376
renderable supported-history rows are classified `reconstructed-historical`; 244 remain
catalog-only. The latest snapshot contains 33,468 reconstructed states and 21 catalog-only members.

## Reconstruction

The package contract defines:

```text
SHA-256("orbit-studio-gcat-reconstruction-v1:" + JCAT)
```

as the deterministic source for the three unavailable angular elements. The package provides those
values for its latest reconstruction candidates. The repository export verifies them exactly and
applies the same documented algorithm once, during generation, for earlier supported rows. The
browser never hashes an identity or generates random angles.

Runtime derives semi-major axis and eccentricity from the source perigee/apogee radii, preserves
source inclination, converts the generated mean anomaly to true anomaly, and anchors the resulting
state at the selected annual period end. It refuses an orbit whose semi-major axis does not exceed
Earth radius. Reconstruction communicates source-backed orbit shape and population structure, not
historical longitude, node, phase, apsidal orientation, or an observed fix.

## Curated presentation

Curated names, aliases, educational summaries, discovery collections, and constellation mappings
are presentation views. Matching SATCAT identities can receive a recognizable product name without
changing source membership or orbital constraints.

A separately classified six-object `curated-reference` layer keeps especially important current
objects and orbit concepts discoverable when the package's event-based lifecycle semantics do not
retain them in latest membership. These rows are excluded from GCAT membership/reconstruction
counts and never injected into historical snapshots.

## Rendering and diagnostics

Resolved satellites become ordinary Scenario satellites and use the existing two-body propagator,
prepared worker horizons, Hermite interpolation, point-cloud/L0D path, selected-object renderer,
and orbit path sampling. Preparing a worker orbit caches only invariant terms from the same
two-body equations; direct equivalence tests compare its state vectors with the unprepared
Keplerian composition. Horizons are prewarmed for 2,500× so changing playback speed cannot inherit
a shorter low-speed buffer. During a backward reset, a future-only staged horizon is discarded. If
the replacement horizon is not ready when high-speed playback begins, the point cloud temporarily
evaluates the same prepared two-body model at the authoritative UTC rather than freezing an old GPU
buffer. Lower speeds keep the lighter worker/interpolation path.

The renderer reports:

- authoritative and buffered simulation UTC;
- queue, GPU, rendered, and screen-visible counts;
- reconstructed, curated-reference, exact, nearest-source, and current-source provenance counts;
- a deterministic position-buffer digest;
- camera state.

Review cross-checks these diagnostics with catalog state and screenshot marker pixels. A nonzero
scene count alone cannot satisfy the default-population gate.

## Scientific boundary

GCAT and the package establish catalog membership and source orbital-envelope fields within their
documented limits. The reconstruction is deterministic and constrained, but not observational
ephemeris. Nothing in the default view is live tracking. Annual membership is not proof of
operational status, and a package snapshot is not proof that every real-world object is present.

Exact historical positions would require a separately licensed and independently validated
source-state archive. Adding one must preserve this resolver order and provenance classification;
it must not create a parallel renderer or overwrite the canonical membership authority.
