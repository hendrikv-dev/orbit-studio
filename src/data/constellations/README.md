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

Sky's optional translucent constellation figures are original project-owned
vector paths in `constellationArtwork.ts`. Every control point is a weighted
blend of named BSC5P anchors that already belong to the corresponding
d3-celestial figure, so the artwork follows the same real-star projection in
Point, Explore, and camera modes. The real endpoint stars and conventional line
segments remain the positional authority.

The first reviewed figures are Orion and Aquarius. Their recognisable posture
was informed by, but not traced from or copied from, these public-domain works:

- Alexander Jamieson, *A Celestial Atlas* (1822), Wikimedia Commons / Internet
  Archive file `Celestial Atlas- Alexander Jamieson (1822) (IA
  celestial-atlas).pdf`, retrieved 2026-10-07, SHA-256
  `493008dbe1014485bbb29a089c4e09c7a215f168b6c3c4f7af5b0c941b5c7235`.
- *Urania's Mirror* (c. 1825), Aquarius card, Wikimedia Commons file
  `Aquariusurania.jpg`, retrieved 2026-10-07, SHA-256
  `5c549c0cfe9d2a6e245407b3e1156ce567b634d9da959147bc178082b984bb06`.

Both source-description pages identify the underlying works with Public Domain
Mark 1.0. The downloaded scans are research references only: no scan pixels,
paper, borders, typography, grid, labels, or page decoration are shipped. The
production vectors use one modern pale-line/wash system and are strengthened
only when their constellation is selected; unreviewed constellations continue
to use their real-star figure lines without invented artwork.
