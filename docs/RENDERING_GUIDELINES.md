# Current Rendering Guidelines

These implementation guidelines describe the active renderer. They are subordinate to the
scientific, UX, accessibility, and evidence principles in `docs/ORBIT_CONSTITUTION.md`.

## Earth

Earth is a quiet but geographically recognizable reference. The active path uses:

- the verified NASA Blue Marble January surface texture;
- a subtle Natural Earth 110m coastline overlay;
- a single Earth sphere;
- locally generated fallback textures when a public asset cannot load.

Source and processing details live in `docs/sources.md`. Time, frame, texture-longitude, and
illumination conventions live in `docs/celestial-accuracy-foundation.md`.

Preserve:

- correct geographic orientation at the canonical simulation timestamp;
- agreement between texture longitude, Earth rotation, Sun direction, and the terminator;
- separation between physical state and display treatment;
- stable fallback dimensions and an explicit reduced-fidelity state where users could otherwise
  misread the scene.

Avoid unverified imagery, arbitrary rotation or longitude offsets, camera-relative celestial light,
or decorative layers that compete with orbital information. Do not change the active Earth source
or visual treatment without updating the architecture decision, provenance, validation, and review
evidence.

## Orbital Objects

Orbital objects and paths are the Explorer's primary information. Rendering should adapt by zoom:

- Far zoom: population and regime structure remain visible.
- Mid zoom: the population remains readable rather than muddy.
- Close zoom: individual objects are crisp and selection is unambiguous.

Selected and unselected representations must resolve through the same physical-state path. Batching,
throttling, interpolation, filtering, and culling may improve performance but must not change the
population or state at an identical simulation instant. Do not solve visibility by globally
enlarging every point or adding labels everywhere.

Worker scheduling must keep a bounded, source-model-derived interpolation segment around the
authoritative frame time. A retained buffer must keep its actual timestamp in diagnostics; it must
never be reported as if it represented a newer simulation instant. Catalog propagation may shard
across the browser's reported hardware concurrency, capped at eight workers so propagation cannot
saturate the main/render thread. Each predictive horizon begins at or before the authoritative
request UTC, retains the fixed validated interpolation segment length, and extends through measured
worker completion plus a forward safety runway. A shard refreshes only when that runway approaches
its measured latency boundary. A result may become active only when it covers the current UTC;
future-only work is staged and expired work is discarded.

Semantically identical catalog resets retain worker and geometry state. Any changed object identity,
propagation mode, TLE, orbital elements, render classification, or relevant point presentation
invalidates that retained state. The per-frame population-position cache is limited to selected
objects that have a detailed marker consumer; allocating cache records for the unselected population
is prohibited. Full-population visibility, provenance, and digest scans are review instrumentation
and run only under the explicit `review=1` bridge; ordinary playback must not pay their frame cost.

## Celestial and Reference Layers

Stars remain in their documented inertial frame. Reference layers, historical reconstructions, and
display-scaled bodies must retain their provenance and must not be visually or semantically promoted
to measured physical truth. Unsupported physical states are omitted rather than frozen or
fabricated.
