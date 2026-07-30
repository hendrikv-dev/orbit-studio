#!/usr/bin/env python3
from __future__ import annotations

import csv
import gzip
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def fail(message: str) -> None:
    raise SystemExit(f"VERIFY FAILED: {message}")

manifest_path = ROOT / "manifest.json"
if not manifest_path.exists():
    fail("manifest.json is missing.")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

for relative, expected in manifest["artifacts"].items():
    path = ROOT / relative
    if not path.is_file():
        fail(f"Missing manifest artifact: {relative}")
    actual_size = path.stat().st_size
    actual_sha = sha256_file(path)
    if actual_size != expected["bytes"]:
        fail(f"Size mismatch for {relative}: {actual_size} != {expected['bytes']}")
    if actual_sha != expected["sha256"]:
        fail(f"Checksum mismatch for {relative}: {actual_sha} != {expected['sha256']}")

checksums_path = ROOT / "CHECKSUMS.sha256"
if checksums_path.exists():
    for line in checksums_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        expected, relative = line.split("  ", 1)
        path = ROOT / relative
        if not path.is_file():
            fail(f"CHECKSUMS entry is missing: {relative}")
        actual = sha256_file(path)
        if actual != expected:
            fail(f"CHECKSUMS mismatch for {relative}")

for path in ROOT.rglob("*"):
    if path.is_file():
        lowered = str(path.relative_to(ROOT)).lower()
        if "celestrak" in lowered or "space-track" in lowered or "spacetrack" in lowered:
            fail(f"Prohibited bundled source/path found: {path.relative_to(ROOT)}")
        if any(part in {".git", "node_modules", "local-only", "__pycache__"} for part in path.parts):
            fail(f"Unsafe package path found: {path.relative_to(ROOT)}")

overview = json.loads((ROOT / "data" / "overview.json").read_text(encoding="utf-8"))
db_path = ROOT / "data" / "orbit-studio-satellites.sqlite"
conn = sqlite3.connect(db_path)
if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
    fail("SQLite integrity_check failed.")

checks = {
    "source_record_count": conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0],
    "yearly_presence_row_count": conn.execute("SELECT COUNT(*) FROM yearly_presence").fetchone()[0],
    "reconstruction_candidate_count": conn.execute("SELECT COUNT(*) FROM reconstruction_parameters").fetchone()[0],
    "snapshot_present_earth_count": conn.execute("SELECT COUNT(*) FROM snapshot_present_earth_objects").fetchone()[0],
}
for key, actual in checks.items():
    expected = overview[key]
    if actual != expected:
        fail(f"Database count mismatch for {key}: {actual} != {expected}")

duplicate_count = conn.execute(
    "SELECT COUNT(*) FROM (SELECT jcat FROM objects GROUP BY jcat HAVING COUNT(*) > 1)"
).fetchone()[0]
if duplicate_count:
    fail(f"Duplicate JCAT identifiers found: {duplicate_count}")

min_year, max_year = conn.execute("SELECT MIN(year), MAX(year) FROM yearly_presence").fetchone()
if [min_year, max_year] != overview["year_range"]:
    fail(f"Year range mismatch: {[min_year, max_year]} != {overview['year_range']}")

bad_provenance = conn.execute("""
    SELECT COUNT(*) FROM reconstruction_parameters
    WHERE position_accuracy <> 'not live; not observational; reconstructed'
       OR orbital_angles_provenance <> 'deterministic educational reconstruction'
""").fetchone()[0]
if bad_provenance:
    fail(f"Reconstruction provenance violations: {bad_provenance}")

class_counts = dict(conn.execute(
    "SELECT object_class, COUNT(*) FROM objects GROUP BY object_class ORDER BY object_class"
).fetchall())
if class_counts != overview["class_counts"]:
    fail(f"Class counts mismatch: {class_counts} != {overview['class_counts']}")

conn.close()
print("Verification passed.")
print(json.dumps({
    "source_records": overview["source_record_count"],
    "snapshot_present_earth_objects": overview["snapshot_present_earth_count"],
    "reconstruction_candidates": overview["reconstruction_candidate_count"],
    "yearly_presence_rows": overview["yearly_presence_row_count"],
    "year_range": overview["year_range"],
    "snapshot_updated_at": overview["source_snapshot_updated_at"],
}, indent=2))
