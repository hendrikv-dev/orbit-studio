# Orbit Studio Satellite Source of Truth

This package is the canonical, redistribution-safe satellite/object database for Orbit Studio.

It contains a versioned snapshot of Jonathan C. McDowell's **General Catalog of Artificial Space Objects (GCAT)** Standard Satellite Catalog and deterministic derived products. GCAT is published under **CC BY 4.0**.

## Snapshot

- Upstream catalog: GCAT `satcat`
- Upstream update timestamp: `2026-06-27T22:13:02Z`
- Historical records: **69,703**
- Payload records: **27,572**
- Rocket-body records: **6,285**
- Component records: **7,920**
- Debris records: **27,843**
- Objects with no recorded descent/end date: **33,546**
- Earth-associated objects with no recorded descent/end date: **33,489**
- Current Earth reconstruction candidates: **33,489**
- Year coverage: **1957–2026**
- 2026 coverage ends at the snapshot date, not December 31.

“Satellite” is often used informally for every cataloged object. This package uses `object_class` to distinguish payloads, rocket bodies, components, and debris. Filter `object_class = 'payload'` when the product specifically means spacecraft/satellites.

## Authority order

1. **Immutable upstream evidence:** `raw/gcat-satcat-2026-06-27.tsv`
2. **Canonical application/query layer:** `data/orbit-studio-satellites.sqlite`
3. **Canonical normalized exchange:** `data/objects.csv.gz`
4. **Canonical year-by-year history:** `data/yearly_object_presence.csv.gz`
5. **Canonical annual summary:** `data/yearly_summary.csv`
6. **Canonical rendering/reconstruction input:** `data/reconstruction_candidates.csv.gz`
7. **Machine-readable provenance and checksums:** `manifest.json` and `CHECKSUMS.sha256`

Generated files must never be hand-edited. Rebuild them from a versioned raw GCAT snapshot.

## Start here

```bash
python scripts/verify.py
sqlite3 data/orbit-studio-satellites.sqlite < queries/examples.sql
```

For Codex, read `CODEX.md` before changing any catalog, import, historical timeline, or rendering code.

## Important semantics

- `snapshot_present = 1` means GCAT has no recorded descent/end date in this snapshot. It does **not** prove that a payload is operationally active.
- GCAT perigee, apogee, inclination, and orbit epoch are source-backed catalog fields.
- The reconstruction file derives missing orbital angles deterministically from JCAT identifiers.
- Reconstructed positions are educational estimates—not live, observed, or precise historical positions.
- Annual membership is based on the best parseable appearance/separation year and recorded descent year.
- Vague or uncertain dates are preserved in raw form and marked with precision/uncertainty fields.
- The 2026 annual period is partial through `2026-06-27`.

## Updating

Run:

```bash
python scripts/update_from_gcat.py
```

The updater saves a new versioned snapshot and refuses to overwrite a differing prior snapshot. After an update:

1. Review upstream release notes and license.
2. Run the build.
3. Regenerate `CHECKSUMS.sha256`.
4. Run `python scripts/verify.py`.
5. Review count and schema changes.
6. Commit the new raw snapshot, generated outputs, manifest, and checksums together.

Do not silently replace this database with CelesTrak, Space-Track, an application fixture, a small sample, or a generated point cloud.
