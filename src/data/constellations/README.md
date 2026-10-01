# Constellation figure lines

`constellationLines.d3Celestial.json` contains the conventional constellation
line figures published with d3-celestial. These are orientation aids, not IAU
constellation boundaries and not astronomical object positions.

- Source: d3-celestial by Olaf Frohn.
- Upstream file: `data/constellations.lines.json`.
- Immutable source commit: `7e720a3de062059d4c5400a379146a601d9010e0` (2022-07-05).
- Retrieved: 2026-09-30.
- Upstream SHA-256: `294f66bef5d5cf50b1e17f16d2efa1d97a15131612c68dd935adef6e7373e13c`.
- Coordinate frame: J2000 right ascension in degrees and declination in degrees.
- Runtime use: `constellationFigureStars.bsc5p.json` maps all 893 endpoints to
  real BSC5P HR stars within 0.008397°, then those stars use the same proper-motion,
  observer, UTC, ENU-vector and stabilized-pose pipeline as the rest of Sky.
- Endpoint mapping SHA-256: `3f10ef82946b55c9efd9b6f4ac8a34e634c2b75552ec806040b6dcd09f47b442`.
- License: BSD 3-Clause; see `LICENSE-BSD-3-CLAUSE.txt`.

The production star population remains the separately documented BSC5P
subset. This file contributes only conventional figure segments and never
replaces the star catalogue, the target catalogue, or the application clock.
