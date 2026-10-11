# Tracker deep-sky showpieces

The same 26 stable identities are normalized offline from the small
`permissive-snapshot.json`. `npm run deepsky:build` has no network or fallback
catalog input. `node scripts/build-deep-sky-showpieces.mjs --check` verifies bytes.

Twenty Messier entries use NASA HEASARC's Messier TDAT (2022-02-03 revision),
retrieved 2026-10-10: J2000 RA/Dec degrees, integrated visual magnitude and maximum
reported angular dimension in arcminutes. Approximate-magnitude flags are retained.
Six non-Messier positions and four cluster V magnitudes use exact CC0 Wikidata
structured claims, with J2000 epoch, V-band qualifier, revisions and references.
NGC7009 magnitude 8.0 and NGC6543 magnitude 8.2 use NASA Hubble Caldwell 55/6.
Stellar-catalog photometry is not substituted for nebular brightness.

Original project-authored observing descriptions, stable names/designations and
editorial taxonomy remain. Equipment uses V <= 4.5 eyes; V <= 7 binoculars; otherwise
telescope. No tier changed. Major axis is null for the six non-Messier entries and
M16: no verified permissive directly applicable value was established. M16's
HEASARC diameter describes its cluster rather than the selected Eagle Nebula.

Unknown extent produces no extent advisory, extent-based ranking adjustment or
42-arcminute fallback. Sky's existing screen-space marker is independent of physical
size; zero finder radius accompanies null size, not a measured point object.
Known sizes retain the existing minimum selection allowance. More details labels
unknown angular size Unavailable. No astronomy/pose/navigation rewrite is included.

Per-field sources/claims/checksums are in the snapshot. Whole-artifact checksums
and rights decisions are in `provenance/inventory.json`; see `RIGHTS.md`.
Updates require a reviewed snapshot and full release gates. Every numerical and
behavioral difference is documented externally. Catalog centres and diameters have
different source definitions; this pass does not validate physical camera AR.
