# Historical Visualization Architecture

Orbit Studio distinguishes catalog membership from physical-state provenance. Historical objects
are never treated as exact simply because the product can draw them.

## Resolution order

For each object that exists at the selected UTC, Explorer resolves one of these states:

1. **Source orbit record** — an imported TLE, OMM, GP, or complete element set. TLE/GP records use SGP4;
   complete Keplerian source states use the existing two-body path and retain their source epoch.
2. **Metadata-constrained reconstruction** — a deterministic Keplerian orbit constrained by
   source-reported perigee altitude, apogee altitude, and inclination. RAAN, argument of periapsis,
   and phase are unavailable in GCAT and are deterministically synthesized. They are never described
   as an exact historical fix.
3. **Catalog-only** — lifecycle membership without enough orbital constraints. No marker or orbit is
   rendered.

The runtime availability values are `exact-historical-orbit`, `nearest-historical-orbit`,
`reconstructed-historical-orbit`, and `catalog-only`. The first is a legacy schema token meaning a
source orbit record exists on the same UTC calendar date; it does not mean an exact measured
position at the selected instant or zero uncertainty. User-facing language and reports should call
this class source-record coverage and identify the resulting position as model-derived. Coverage
counts keep these populations separate through the query pipeline, Explorer UI, review bridge,
`review.json`, and `timeline.csv`.

## Runtime truth contract

Resolver eligibility is not treated as proof of rendering. In development and deterministic review
runs, the point renderer publishes its actual queue size, GPU buffer count, valid rendered count,
provenance counts, camera-visible count, camera state, canonical UTC, and position-buffer digest.
The review bridge is ready only after that renderer state matches the selected timeline UTC and
resolved visible population.

Playback speed is excluded from existence, provenance, filtering, render eligibility, and physical
state. Workers predict their completion instant from measured latency and playback speed, then
propagate a UTC-quantized horizon of bounded 240-second Hermite segments around that instant. The
renderer selects only a segment containing the authoritative frame UTC; it never extrapolates.
A pending or expired horizon retains the last verified buffer, but diagnostics retain that buffer's
actual UTC and expose its increasing lag instead of relabeling it as current. Selecting a timeline milestone pauses
playback at the milestone's exact UTC; playback resumes only through the existing play control.

## Reconstruction model

`metadata-constrained-keplerian-v1` derives semi-major axis and eccentricity from source perigee and
apogee radii. Source inclination is preserved exactly. A stable hash supplies the three missing
angular elements. Objects from the same launch family share a deterministic orbital plane, while
each record has a stable phase. The object launch instant is the propagation epoch, making motion
continuous across playback and stable across runs.

This reconstruction communicates orbital population, regime, altitude envelope, inclination, and
lifecycle. It does **not** claim historical longitude, phase, node, or apsidal orientation. GCAT's
source orbital epoch is retained as provenance but is not promoted into an exact state.

## Lifecycle policy

No record appears before its launch time. Known decay and reentry dates remove it after the recorded
event. The timeline begins at Sputnik 1 launch, `1957-10-04T19:28:34Z`. The bundled source reports
orbit insertion at approximately 19:33; the payload and associated upper stage are visible from
launch as explicitly reconstructed educational states. That five-minute interval must not be read
as a measured orbital position.

## Alternatives rejected

- Interpolating Cartesian positions between sparse TLEs is not physically meaningful and creates
  frame and discontinuity problems.
- Unconstrained regime shells fabricate more state than the source provides. Records without the
  three required constraints remain catalog-only.
- A separate historical renderer would duplicate filtering, selection, propagation, and batching.
  Resolved historical states instead enter the normal Scenario model.
- Showing current TLEs at historical dates would be scientifically false and remains prohibited.

## Source and limitations

The bundled public historical sample is derived from Jonathan McDowell's GCAT SATCAT under
CC-BY-4.0. It intentionally samples the larger catalog and is not complete. Archived source GP/TLE
coverage is currently absent from the public artifact; adding licensed historical state archives is
the preferred future improvement. When those records are imported, the same resolver selects them
ahead of reconstruction without changing the rendering architecture.
