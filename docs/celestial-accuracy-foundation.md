# Celestial accuracy foundation

## Canonical time

Explorer owns one canonical simulation timestamp in `studioPlaybackClock.ts`. The actual system clock is read once by `createDefaultScenario()` to establish the initial UTC instant. Thereafter a monotonic wall clock advances that timestamp while playback is running. Pause, step, scrub, reverse, and speed changes all re-anchor the same timestamp. Invalid timestamps throw; no physical renderer substitutes a decorative date.

Every rendered frame is sampled once by `SceneMotionClock`. `readSceneCelestialState()` memoizes the complete celestial state for that exact frame timestamp, and Earth, Sun, Moon, aurora, star proper motion, diagnostics, and frame-aware labels consume it.

Time scales:

- UTC is the UI and persisted civil timestamp.
- Julian Date UTC is retained for catalog epochs and diagnostics.
- UT1 is required for Earth rotation. Astronomy Engine approximates UT1 as UTC; because UTC is maintained within 0.9 seconds of UT1, that is the dominant stated Earth-longitude limitation. The USNO comparison fixture records the externally computed UT1/GAST reference.
- TT is required by the solar-system ephemeris. Astronomy Engine derives TT from UT with its Espenak/Meeus delta-T model.
- TDB is not exposed by Orbit Studio. Astronomy Engine evaluates the internal planetary ephemeris from TT; no UI value is labeled TDB.

The validated product range is 1600-01-01 through 2200-01-01 UTC. Requests outside that range fail explicitly.

## Frames and axes

The central conversion implementation is `src/astronomy/celestialFrames.ts`.

- Inertial frame: geocentric J2000 mean equator/equinox (EQJ), ICRS-compatible. +X points toward the J2000 equinox, +Y toward right ascension 6h, and +Z toward the north celestial pole. It is right-handed.
- Earth-fixed frame: ECEF. +X is latitude 0°, longitude 0°; +Y is latitude 0°, longitude +90° east; +Z is north. It is right-handed.
- Scene frame: Three.js right-handed Y-up. EQJ maps as `(x, y, z) -> (x, z, -y)`, so scene +X is EQJ +X, scene +Y is celestial north, and scene +Z is EQJ -Y.
- Earth texture/local frame: the public NASA equirectangular texture is north-up. Geographic longitude is east-positive; local +X is Greenwich, local -Z is +90° east, and local +Y is north. Three.js sphere UV orientation and `latLonToThreeVector()` agree with this convention without a texture offset or mirroring correction.
- Earth orientation: ECEF is rotated by Greenwich Apparent Sidereal Time into true equator/equinox of date, then Astronomy Engine’s precession/nutation rotation converts EQD to EQJ, then the single EQJ-to-scene axis map is applied. The resulting quaternion is applied directly; there is no compensating longitude offset.
- Rotation order is therefore `ECEF -> Rz(GAST) -> EQD -> precession/nutation -> EQJ -> scene`.

## Root cause of the prior Earth/Sun defect

The previous path mixed coordinate epochs:

1. `src/physics/time.ts::sunDirectionEci()` produced a low-order solar direction whose longitude followed the equinox of date but labeled it as generic ECI.
2. `src/rendering/Earth.tsx` rotated the Earth with GMST only, treating the resulting of-date axes as the fixed Three.js inertial axes.
3. No precession/nutation transform connected that of-date frame to the J2000 frame used by the scene and star data, and GMST was used where an apparent direction requires GAST.
4. `src/rendering/earthFidelity.test.ts` compared the rendered result with `subsolarPoint()` from the same low-order implementation, so the test proved internal agreement rather than correctness.

At the evidence instant 2026-01-01T13:18:20Z, the former solar vector differs from the JPL ICRF apparent direction by about 21.83 arcminutes. Its low-order subsolar coordinates happened to cancel much of the common of-date frame error, masking the inconsistent inertial orientation. The new implementation uses one externally validated apparent EQJ vector path, one externally validated GAST/precession-nutation orientation, and an independent JPL/USNO fixture.

## Celestial accuracy matrix

| System | Source/model | Epoch/frame | Time scale | Validated range | Precision/limitation | Status |
|---|---|---|---|---|---|---|
| Earth orientation | Astronomy Engine 2.1.19 GAST plus EQD/EQJ precession-nutation | ECEF -> EQD -> EQJ | UT1 approximated by UTC; TT for precession/nutation | 1600–2200 | USNO GAST comparisons <0.02 s; longitude also inherits UT1−UTC, bounded below 0.9 s | Implemented |
| Sun | Astronomy Engine 2.1.19, VSOP87/NOVAS-derived geocentric apparent vector | EQJ/ICRS-compatible J2000 | TT derived from UTC/UT | 1600–2200 | Library documents approximately 1 arcminute; current JPL DE441 matrix is <0.03 arcminute | Implemented |
| Moon | Astronomy Engine 2.1.19 geocentric vector and illumination | EQJ/ICRS-compatible J2000 | TT derived from UTC/UT | 1600–2200 | Current JPL DE441 matrix <0.09 arcminute direction, <50 km range, <0.00005 illuminated fraction | Implemented; display distance is scaled separately |
| Stars | HYG Database v4.1, apparent magnitude <=5.1 | EQJ, epoch J2000.0 | UTC-derived Julian epoch for catalog space velocity | HYG proper-motion field quality is source-dependent | 1,839 authentic records; no synthetic filler; no parallax or radial perspective beyond HYG Cartesian velocity | Implemented |
| Earth-orbit catalog objects | Verified GCAT package membership with source-constrained, deterministic two-body educational reconstructions | Reconstructed inertial elements mapped through shared scene axes | Canonical UTC | Completed years use calendar-period end; the partial latest snapshot is 2026-06-27T22:13:02Z | Membership, lifecycle, orbit epoch, perigee, apogee, and inclination are source-backed. Generated node, apsis, and phase are not observed, live, or exact. The current package contains no exact historical source states | Canonical SQLite package and deterministic browser derivative implemented; CelesTrak and Space-Track authorities absent |
| Historical Earth-orbit objects | Imported historical membership; source orbit records when available; `metadata-constrained-keplerian-v1` otherwise | Source-defined frame or deterministic reconstructed elements mapped through shared scene axes | Selected UTC | Source- and lifecycle-dependent | Source records produce model-derived positions; reconstruction preserves source perigee, apogee, and inclination but does not claim historical phase, longitude, node, or apsidal orientation; unconstrained records remain catalog-only | Implemented with provenance retained through resolver, renderer, UI, and review outputs |

## Independent references and reproducibility

`scripts/fetch-celestial-reference.mjs` records fixed references from NASA/JPL Horizons DE441 and the U.S. Naval Observatory. The committed fixture includes the current-build evidence time, a separately captured current UTC instant, four 2026 seasonal events, one historical time, one future time, four lunar phase events, and historical/future lunar times. Tests compare direction, GAST, subsolar latitude/longitude, the mounted terminator normal, lunar range, phase angle, and illuminated fraction with explicit tolerances.

The fixture is deliberately generated outside the implementation under test. Regeneration requires network access and should be reviewed as a data update.

## Star data and license

The HYG source and selection details are in `src/data/stars/README.md`. The generated subset is an adaptation distributed under CC BY-SA 4.0, with attribution and license notice in `src/data/stars/LICENSE-CC-BY-SA-4.0.txt`. Astronomy Engine is MIT licensed.

## Remaining limitations

- UT1 is approximated by UTC at runtime; sub-arcsecond Earth rotation would require distributing IERS Earth-orientation parameters.
- Polar motion is not modeled.
- Astronomy Engine’s documented approximate precision, not JPL DE441 precision, defines runtime claims.
- Moon libration is not yet applied to the texture orientation; direction, physical distance, phase, and the Sun-relative illuminated side are physical.
- The 1,839-star subset intentionally stops at visual magnitude 5.1. HYG source uncertainties and proper-motion completeness vary by record.
- Historical membership is broader than source-record historical orbit coverage.
  Metadata-constrained reconstructions are rendered only when source perigee, apogee, and
  inclination are available and remain labeled reconstructed; unconstrained positions remain
  catalog-only and are not rendered.
- The public release has no live current catalog. Its verified GCAT package supplies complete
  packaged Earth-object membership for the supported four classes at the dated 2026-06-27 snapshot;
  this is not a claim of exhaustive real-world coverage, operational status, or measured position.
  Displayed reconstructed positions are educational.
- The packaged history contains annual period-end membership, not continuous observational state
  history. Sub-year launch, decay, docking, deployment, or reclassification events cannot be
  inferred from the annual Explorer timeline.
- Exact historical source states are absent from the current package. All renderable package states
  are deterministic reconstructions constrained by source perigee, apogee, and inclination.

## Development diagnostics

In development only, append `?celestialDiagnostics=1` to expose the canonical UTC, Julian UTC/UT1/TT values, GAST, Earth quaternion, Sun EQJ and scene vectors, subsolar coordinates, Moon EQJ and scene vectors, physical/display distance, phase, illuminated fraction, axes, and star catalog identity. A fixed validation instant can be loaded only in development with `&simulationTime=<ISO-8601>` and frozen for visual comparison with `&celestialPaused=1`. None of these query options changes production behavior.
