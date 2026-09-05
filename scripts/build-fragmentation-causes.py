#!/usr/bin/env python3
"""Join NASA's assessed break-up causes onto GCAT fragmentation events.

GCAT records who fragmented and when, but never why. This joins the curated
NASA reference (see data/fragmentation-causes/PROVENANCE.md) onto the events the
web catalog already describes, keyed on NORAD catalogue number and exact
break-up date so a parent that broke up more than once cannot inherit the wrong
event's cause.

The output carries only the cause. Fragment counts always come from GCAT: the
reference's own counts are correct for December 2022 and would contradict the
catalog snapshot.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CAUSE_CSV = REPO_ROOT / "data/fragmentation-causes/nasa-hoosf-16e-causes.csv"
CATALOG = REPO_ROOT / "src/data/generated/satelliteCatalog.web.json"
OUTPUT = REPO_ROOT / "src/data/generated/fragmentationCauses.json"

REFERENCE = {
    "id": "nasa-hoosf-16e",
    "title": "History of On-orbit Satellite Fragmentations, 16th Edition",
    "reportNumber": "NASA/TP-20220019160",
    "publisher": "NASA Orbital Debris Program Office",
    "published": "2022-12",
    "url": "https://orbitaldebris.jsc.nasa.gov/library/hoosf_16e.pdf",
    "rights": (
        "Work of the U.S. Government prepared by NASA; not subject to copyright "
        "protection in the United States."
    ),
    "provenanceKind": "curated-reference",
    # The reference predates later break-ups; anything after this is unassessed
    # rather than uncaused, and the interface must say so.
    "assessmentCutoff": "2022-12",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    causes = list(csv.DictReader(CAUSE_CSV.open(encoding="utf-8")))
    by_key = {
        (row["noradCatalogNumber"].lstrip("0"), row["breakupDateUtc"]): row
        for row in causes
    }

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    index = {name: position for position, name in enumerate(catalog["rowSchema"])}
    rows = catalog["rows"]
    by_jcat = {row[index["jcat"]]: row for row in rows}

    events: dict[tuple[str, str], int] = {}
    for row in rows:
        if row[index["objectClassCode"]] != "D":
            continue
        parent = row[index["parentJcat"]]
        separation = row[index["separationDateIso"]]
        if not parent or not separation:
            continue
        events[(parent, separation)] = events.get((parent, separation), 0) + 1

    assessed: dict[str, str] = {}
    matched_fragments = 0
    for (parent, separation), fragment_count in events.items():
        parent_row = by_jcat.get(parent)
        if parent_row is None:
            continue
        catalog_number = parent_row[index["satcatNumber"]]
        if not (catalog_number and catalog_number.isdigit()):
            continue
        match = by_key.get((catalog_number.lstrip("0"), separation[:10]))
        if match is None:
            continue
        assessed[f"{parent}@{separation}"] = match["assessedCause"]
        matched_fragments += fragment_count

    total_fragments = sum(events.values())
    artifact = {
        "schemaVersion": 1,
        "reference": REFERENCE,
        "sourceFingerprint": sha256_file(CAUSE_CSV),
        "coverage": {
            "referenceEventCount": len(causes),
            "catalogEventCount": len(events),
            "matchedEventCount": len(assessed),
            "catalogFragmentCount": total_fragments,
            "matchedFragmentCount": matched_fragments,
        },
        # Keyed exactly as explorerFragmentation builds its event ids.
        "causeByEventId": dict(sorted(assessed.items())),
    }
    OUTPUT.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUTPUT.relative_to(REPO_ROOT)}: "
        f"{len(assessed)}/{len(events)} events assessed, "
        f"{matched_fragments:,}/{total_fragments:,} fragments "
        f"({matched_fragments / total_fragments * 100:.1f}%)"
    )


if __name__ == "__main__":
    main()
