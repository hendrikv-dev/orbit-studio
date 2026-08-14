#!/usr/bin/env python3
"""Generate Orbit Studio's compact web catalog from the canonical SQLite database.

The installed GCAT package remains the only membership and orbital-shape authority.
This script emits a deterministic browser-oriented derivative; it does not ingest
another catalog and it never mutates package data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = REPOSITORY_ROOT / "data" / "satellite-source-of-truth"
DATABASE_PATH = PACKAGE_ROOT / "data" / "orbit-studio-satellites.sqlite"
PACKAGE_MANIFEST_PATH = PACKAGE_ROOT / "manifest.json"
PACKAGE_VERIFY_PATH = PACKAGE_ROOT / "scripts" / "verify.py"
DEFAULT_OUTPUT_PATH = (
    REPOSITORY_ROOT / "src" / "data" / "generated" / "satelliteCatalog.web.json"
)

EARTH_RADIUS_KM = 6378.137
RECONSTRUCTION_VERSION = "orbit-studio-gcat-reconstruction-v1"
EXPORT_VERSION = "orbit-studio-satellite-web-export-v1"
SUPPORTED_CLASSES = ("payload", "rocket_body", "component", "debris")
CLASS_CODES = {
    "payload": "P",
    "rocket_body": "R",
    "component": "C",
    "debris": "D",
}
ROW_SCHEMA = [
    "jcat",
    "satcatNumber",
    "name",
    "payloadName",
    "alternateNamesRaw",
    "objectClassCode",
    "ownerCode",
    "statusRaw",
    "presentAtPeriodEndStartYear",
    "presentAtPeriodEndEndYear",
    "launchDateIso",
    "separationDateIso",
    "decayDateIso",
    "sourceOrbitEpochIso",
    "sourcePerigeeKm",
    "sourceApogeeKm",
    "sourceInclinationDeg",
    "raanDegReconstructed",
    "argumentOfPerigeeDegReconstructed",
    "meanAnomalyDegReconstructed",
    # Fragmentation linkage. GCAT carries an authoritative Parent for every
    # debris and component row; it is exported only when it resolves to another
    # row in this same export, so a consumer never holds a dangling reference.
    "parentJcat",
    "separationDatePrecision",
    "separationDateUncertain",
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def deterministic_angles(jcat: str) -> tuple[float, float, float]:
    digest = hashlib.sha256(
        f"{RECONSTRUCTION_VERSION}:{jcat}".encode("utf-8"),
    ).digest()
    scale = float(2**64)
    return (
        int.from_bytes(digest[0:8], "big") / scale * 360.0,
        int.from_bytes(digest[8:16], "big") / scale * 360.0,
        int.from_bytes(digest[16:24], "big") / scale * 360.0,
    )


def reconstruction_eligible(
    perigee_km: float | None,
    apogee_km: float | None,
    inclination_deg: float | None,
) -> bool:
    if perigee_km is None or apogee_km is None or inclination_deg is None:
        return False
    lower_apsis = min(perigee_km, apogee_km)
    upper_apsis = max(perigee_km, apogee_km)
    periapsis_radius = EARTH_RADIUS_KM + lower_apsis
    apoapsis_radius = EARTH_RADIUS_KM + upper_apsis
    if not (
        math.isfinite(periapsis_radius)
        and math.isfinite(apoapsis_radius)
        and math.isfinite(inclination_deg)
    ):
        return False
    semi_major_axis = (periapsis_radius + apoapsis_radius) / 2.0
    eccentricity = (
        (apoapsis_radius - periapsis_radius)
        / (apoapsis_radius + periapsis_radius)
    )
    return (
        semi_major_axis > EARTH_RADIUS_KM
        and 0 <= eccentricity < 1
        and 0 <= inclination_deg <= 180
    )


def verified_package_manifest() -> dict[str, Any]:
    verification = subprocess.run(
        [sys.executable, str(PACKAGE_VERIFY_PATH)],
        cwd=PACKAGE_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if verification.returncode != 0:
        raise RuntimeError(
            "Canonical satellite package verification failed.\n"
            f"{verification.stdout}{verification.stderr}"
        )

    manifest = json.loads(PACKAGE_MANIFEST_PATH.read_text(encoding="utf-8"))
    database_entry = manifest["artifacts"]["data/orbit-studio-satellites.sqlite"]
    actual_database_sha = sha256_file(DATABASE_PATH)
    if actual_database_sha != database_entry["sha256"]:
        raise RuntimeError(
            "Canonical SQLite checksum changed after package verification: "
            f"{actual_database_sha} != {database_entry['sha256']}"
        )
    return manifest


def presence_ranges(connection: sqlite3.Connection) -> dict[str, tuple[int, int]]:
    rows = connection.execute(
        """
        SELECT
            y.jcat,
            MIN(y.year) AS first_year,
            MAX(y.year) AS last_year,
            COUNT(*) AS year_count
        FROM yearly_presence y
        JOIN objects o USING (jcat)
        WHERE (
                (y.year < 2026 AND y.present_at_period_end = 1)
                OR
                (y.year = 2026 AND o.snapshot_earth_present = 1)
              )
          AND o.primary_body = 'Earth'
          AND o.object_class IN ('payload', 'rocket_body', 'component', 'debris')
        GROUP BY y.jcat
        ORDER BY y.jcat
        """
    ).fetchall()

    ranges: dict[str, tuple[int, int]] = {}
    for jcat, first_year, last_year, year_count in rows:
        if year_count != last_year - first_year + 1:
            raise RuntimeError(
                f"Non-contiguous period-end membership for {jcat}: "
                f"{first_year}-{last_year} contains {year_count} rows."
            )
        ranges[jcat] = (first_year, last_year)
    return ranges


def annual_rows(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for year in range(1957, 2027):
        if year == 2026:
            membership_clause = "y.year = ? AND o.snapshot_earth_present = 1"
            parameters: tuple[Any, ...] = (year,)
        else:
            membership_clause = "y.year = ? AND y.present_at_period_end = 1"
            parameters = (year,)

        members = connection.execute(
            f"""
            SELECT
                o.object_class,
                o.perigee_km,
                o.apogee_km,
                o.inclination_deg
            FROM yearly_presence y
            JOIN objects o USING (jcat)
            WHERE {membership_clause}
              AND o.primary_body = 'Earth'
              AND o.object_class IN ('payload', 'rocket_body', 'component', 'debris')
            """,
            parameters,
        ).fetchall()
        class_counts = Counter(member[0] for member in members)
        reconstructed_class_counts = Counter(
            object_class
            for object_class, perigee, apogee, inclination in members
            if reconstruction_eligible(perigee, apogee, inclination)
        )
        reconstruction_count = sum(
            reconstruction_eligible(perigee, apogee, inclination)
            for _, perigee, apogee, inclination in members
        )
        total = sum(class_counts.values())
        period_end_date = "2026-06-27" if year == 2026 else f"{year:04d}-12-31"
        results.append(
            {
                "year": year,
                "periodEndDate": period_end_date,
                "isPartialYear": year == 2026,
                "membershipCount": total,
                "reconstructedStateCount": reconstruction_count,
                "catalogOnlyCount": total - reconstruction_count,
                "classCounts": {
                    object_class: class_counts.get(object_class, 0)
                    for object_class in SUPPORTED_CLASSES
                },
                "reconstructedClassCounts": {
                    object_class: reconstructed_class_counts.get(object_class, 0)
                    for object_class in SUPPORTED_CLASSES
                },
                "catalogOnlyClassCounts": {
                    object_class:
                        class_counts.get(object_class, 0)
                        - reconstructed_class_counts.get(object_class, 0)
                    for object_class in SUPPORTED_CLASSES
                },
            }
        )
    return results


def web_rows(
    connection: sqlite3.Connection,
    ranges: dict[str, tuple[int, int]],
) -> tuple[list[list[Any]], dict[str, int]]:
    query_rows = connection.execute(
        """
        SELECT
            o.jcat,
            o.satcat_number,
            COALESCE(NULLIF(o.name, ''), NULLIF(o.payload_name, ''), o.jcat),
            o.payload_name,
            o.alternate_names_raw,
            o.object_class,
            o.owner_code,
            o.status_raw,
            o.launch_date_iso,
            o.separation_date_iso,
            o.decay_date_iso,
            o.orbit_epoch_iso,
            o.perigee_km,
            o.apogee_km,
            o.inclination_deg,
            r.raan_deg_reconstructed,
            r.argument_of_perigee_deg_reconstructed,
            r.mean_anomaly_deg_reconstructed,
            NULLIF(TRIM(COALESCE(s.parent, '')), '-'),
            o.separation_date_precision,
            o.separation_date_uncertain
        FROM objects o
        LEFT JOIN reconstruction_parameters r USING (jcat)
        LEFT JOIN source_rows s USING (jcat)
        WHERE o.primary_body = 'Earth'
          AND o.object_class IN ('payload', 'rocket_body', 'component', 'debris')
        ORDER BY o.jcat
        """
    ).fetchall()

    latest_package_angles = 0
    historical_derived_angles = 0
    catalog_only = 0
    class_counts: Counter[str] = Counter()
    rows: list[list[Any]] = []

    for (
        jcat,
        satcat_number,
        name,
        payload_name,
        alternate_names_raw,
        object_class,
        owner_code,
        status_raw,
        launch_date_iso,
        separation_date_iso,
        decay_date_iso,
        orbit_epoch_iso,
        perigee_km,
        apogee_km,
        inclination_deg,
        package_raan,
        package_argument_of_perigee,
        package_mean_anomaly,
        parent_jcat,
        separation_date_precision,
        separation_date_uncertain,
    ) in query_rows:
        class_counts[object_class] += 1
        first_year, last_year = ranges.get(jcat, (None, None))
        eligible = reconstruction_eligible(perigee_km, apogee_km, inclination_deg)

        if eligible:
            computed_angles = deterministic_angles(jcat)
            package_angles = (
                package_raan,
                package_argument_of_perigee,
                package_mean_anomaly,
            )
            if package_raan is not None:
                if any(
                    not math.isclose(actual, expected, rel_tol=0, abs_tol=1e-12)
                    for actual, expected in zip(package_angles, computed_angles, strict=True)
                ):
                    raise RuntimeError(
                        f"Package reconstruction angles disagree with its contract for {jcat}."
                    )
                angles = package_angles
                latest_package_angles += 1
            else:
                angles = computed_angles
                historical_derived_angles += 1
        else:
            angles = (None, None, None)
            catalog_only += 1

        rows.append(
            [
                jcat,
                satcat_number,
                name,
                payload_name,
                alternate_names_raw,
                CLASS_CODES[object_class],
                owner_code,
                status_raw,
                first_year,
                last_year,
                launch_date_iso,
                separation_date_iso,
                decay_date_iso,
                orbit_epoch_iso,
                perigee_km,
                apogee_km,
                inclination_deg,
                *angles,
                parent_jcat,
                separation_date_precision,
                1 if separation_date_uncertain else 0,
            ]
        )

    # A parent is only useful if the consumer can look it up. Drop references to
    # rows outside this export rather than shipping a link that resolves to
    # nothing, and count what survives so the loss is visible rather than
    # discovered later.
    parent_index = ROW_SCHEMA.index("parentJcat")
    class_index = ROW_SCHEMA.index("objectClassCode")
    known = {row[0] for row in rows}
    declared_parent = 0
    resolved_parent = 0
    resolved_debris_parent = 0
    for row in rows:
        if not row[parent_index]:
            continue
        declared_parent += 1
        if row[parent_index] in known:
            resolved_parent += 1
            if row[class_index] == CLASS_CODES["debris"]:
                resolved_debris_parent += 1
        else:
            row[parent_index] = None

    return rows, {
        "earthAssociatedSupportedClassCount": len(rows),
        "declaredParentCount": declared_parent,
        "resolvedParentCount": resolved_parent,
        "resolvedDebrisParentCount": resolved_debris_parent,
        "latestPackageReconstructionParameterCount": latest_package_angles,
        "historicalReconstructionParameterCount": historical_derived_angles,
        "allHistoryReconstructionParameterCount":
            latest_package_angles + historical_derived_angles,
        "allHistoryCatalogOnlyCount": catalog_only,
        "payloadCount": class_counts["payload"],
        "rocketBodyCount": class_counts["rocket_body"],
        "componentCount": class_counts["component"],
        "debrisCount": class_counts["debris"],
    }


def build_artifact() -> dict[str, Any]:
    package_manifest = verified_package_manifest()
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        connection.execute("PRAGMA query_only=ON")
        ranges = presence_ranges(connection)
        periods = annual_rows(connection)
        rows, all_history_counts = web_rows(connection, ranges)
    finally:
        connection.close()

    latest_period = periods[-1]
    package_counts = package_manifest["counts"]
    expected_latest = package_counts["snapshot_present_earth_count"]
    if latest_period["membershipCount"] != expected_latest:
        raise RuntimeError(
            "2026 supported-class period-end membership does not reconcile to "
            f"snapshot_present_earth_objects: {latest_period['membershipCount']} "
            f"!= {expected_latest}"
        )
    if (
        latest_period["reconstructedStateCount"]
        + latest_period["catalogOnlyCount"]
        != expected_latest
    ):
        raise RuntimeError("Latest reconstruction and catalog-only counts do not reconcile.")

    raw_entry = package_manifest["artifacts"]["raw/gcat-satcat-2026-06-27.tsv"]
    database_entry = package_manifest["artifacts"][
        "data/orbit-studio-satellites.sqlite"
    ]
    source_fingerprint = (
        f"{EXPORT_VERSION}:raw-{raw_entry['sha256']}:db-{database_entry['sha256']}"
    )

    return {
        "schemaVersion": 1,
        "exportVersion": EXPORT_VERSION,
        "sourceFingerprint": source_fingerprint,
        "authority": {
            "canonicalDatabase":
                "data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite",
            "immutableSnapshot":
                "data/satellite-source-of-truth/raw/gcat-satcat-2026-06-27.tsv",
            "packageManifest": "data/satellite-source-of-truth/manifest.json",
            "generator": "scripts/build-satellite-web-catalog.py",
        },
        "source": {
            "id": "gcat:satcat:2026-06-27",
            "name": "General Catalog of Artificial Space Objects (GCAT)",
            "publisher": "Jonathan C. McDowell",
            "catalog": "Standard Satellite Catalog (satcat)",
            "snapshotUpdatedAt": package_manifest["upstream"]["source_header"],
            "snapshotTimestampIso": package_manifest["package"][
                "snapshot_updated_at"
            ],
            "sourceUrl": package_manifest["upstream"]["url"],
            "homepage": package_manifest["upstream"]["homepage"],
            "license": package_manifest["upstream"]["license"],
            "attribution": package_manifest["upstream"]["required_attribution"],
            "rawSha256": raw_entry["sha256"],
            "databaseSha256": database_entry["sha256"],
        },
        "semantics": {
            "membership": "GCAT source-backed catalog membership",
            "primaryTimelineQuestion":
                "present_at_period_end for completed years; snapshot_present_earth_objects "
                "for the partial 2026 package snapshot",
            "partialPeriodReconciliation":
                "The raw 2026 yearly table has two additional interval-anomaly/future-end "
                "rows. The package contract requires snapshot_present_earth_objects for the "
                "latest public view, so those rows remain excluded from partial-2026 membership.",
            "snapshotPresent":
                "No recorded GCAT descent/end date; not operational or live status.",
            "orbitShape": "GCAT canonical perigee, apogee, and inclination",
            "orbitalAngles": "deterministic educational reconstruction",
            "positionAccuracy": "not live; not observational; reconstructed",
            "reconstructionVersion": RECONSTRUCTION_VERSION,
            "reconstructionEpoch":
                "The selected annual period end anchors the reconstructed phase.",
            "catalogOnlyRule":
                "Rows with missing or physically unusable source orbital parameters remain "
                "catalog-only. This includes zero-altitude package reconstruction rows that "
                "cannot satisfy Orbit Studio's above-Earth two-body invariant.",
        },
        "yearRange": [1957, 2026],
        "partialFinalPeriod": {
            "year": 2026,
            "periodEndDate": "2026-06-27",
            "isPartialYear": True,
        },
        "counts": {
            "sourceRecordCount": package_counts["source_record_count"],
            "latestEarthMembershipCount": latest_period["membershipCount"],
            "latestExactStateCount": 0,
            "latestReconstructedStateCount": latest_period[
                "reconstructedStateCount"
            ],
            "latestCatalogOnlyCount": latest_period["catalogOnlyCount"],
            "latestPackageDeclaredReconstructionCandidateCount":
                package_counts["reconstruction_candidate_count"],
            "latestClassCounts": latest_period["classCounts"],
            "latestRenderableClassCounts": latest_period[
                "reconstructedClassCounts"
            ],
            "latestCatalogOnlyClassCounts": latest_period[
                "catalogOnlyClassCounts"
            ],
            **all_history_counts,
        },
        "rowSchema": ROW_SCHEMA,
        "periods": periods,
        "rows": rows,
    }


def serialized_artifact() -> bytes:
    return (
        json.dumps(
            build_artifact(),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Build the deterministic web catalog from Orbit Studio's canonical "
            "satellite SQLite database."
        )
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail unless the existing output exactly matches a clean generation.",
    )
    args = parser.parse_args()

    output_path = args.output.resolve()
    artifact_bytes = serialized_artifact()
    artifact_sha = hashlib.sha256(artifact_bytes).hexdigest()

    if args.check:
        if not output_path.is_file():
            raise SystemExit(f"Generated web catalog is missing: {output_path}")
        existing_bytes = output_path.read_bytes()
        if existing_bytes != artifact_bytes:
            raise SystemExit(
                "Generated web catalog is stale or nondeterministic: "
                f"{hashlib.sha256(existing_bytes).hexdigest()} != {artifact_sha}"
            )
        print(
            f"Satellite web catalog verified: {output_path} "
            f"({len(artifact_bytes):,} bytes, sha256 {artifact_sha})"
        )
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(artifact_bytes)
    print(
        f"Wrote satellite web catalog: {output_path} "
        f"({len(artifact_bytes):,} bytes, sha256 {artifact_sha})"
    )


if __name__ == "__main__":
    main()
