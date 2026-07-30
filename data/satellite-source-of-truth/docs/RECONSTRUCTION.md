# Reconstruction Contract

Orbit Studio needs a visible orbital population even when complete propagatable element sets are unavailable.

This package provides one deterministic reconstruction row for each eligible Earth-associated object with:

- source-backed GCAT membership;
- source-backed canonical perigee;
- source-backed canonical apogee;
- source-backed inclination;
- deterministic project-authored RAAN;
- deterministic project-authored argument of perigee;
- deterministic project-authored mean anomaly.

The angle seed is:

`SHA-256("orbit-studio-gcat-reconstruction-v1:" + JCAT)`

Three non-overlapping 64-bit words are mapped uniformly to `[0, 360)`.

## Rules

- Never label these positions live, observed, exact, or TLE-derived.
- Never regenerate angles with `Math.random()` or a different hash namespace.
- Identical JCAT identifiers must produce identical reconstructed geometry across clean builds and platforms.
- Source fields and reconstructed fields must remain separately named.
- A future exact-orbit source may supersede reconstruction for an individual object, but provenance must identify the change per object.
