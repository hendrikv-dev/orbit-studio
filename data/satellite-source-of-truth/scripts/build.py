#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

EARTH_RADIUS_KM = 6378.137
EARTH_MU_KM3_S2 = 398600.4418
RECONSTRUCTION_VERSION = "orbit-studio-gcat-reconstruction-v1"
PACKAGE_VERSION = "1.0.0"
MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}
CLASS_MAP = {
    "P": "payload",
    "R": "rocket_body",
    "C": "component",
    "D": "debris",
    "Z": "spurious",
}
SUMMARY_CLASSES = ["all", "payload", "rocket_body", "component", "debris", "unknown", "spurious"]

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def clean(value: Any) -> str:
    return str(value or "").strip()

def blankish(value: Any) -> bool:
    return clean(value) in {"", "-"}

def parse_number(value: Any) -> float | None:
    raw = clean(value)
    if raw in {"", "-"}:
        return None
    raw = re.sub(r"[?~<>]", "", raw).strip()
    try:
        result = float(raw)
    except ValueError:
        return None
    return result if math.isfinite(result) else None

def parse_year(value: Any) -> int | None:
    match = re.match(r"^\s*(\d{4})", str(value or ""))
    return int(match.group(1)) if match else None

def parse_vague_date(value: Any) -> dict[str, Any]:
    raw = clean(value)
    result = {
        "raw": raw,
        "iso": None,
        "year": None,
        "precision": "missing",
        "uncertain": False,
    }
    if raw in {"", "-"}:
        return result

    result["uncertain"] = any(marker in raw for marker in ("?", "~", "<", ">"))
    normalized = re.sub(r"[?~<>]", "", raw).strip()
    year_match = re.match(r"^(\d{4})", normalized)
    if not year_match:
        result["precision"] = "unparsed"
        return result

    year = int(year_match.group(1))
    result["year"] = year
    result["precision"] = "year"
    result["iso"] = f"{year:04d}"

    full_match = re.match(
        r"^(\d{4})\s+([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{2})(\d{2})(?::?(\d{2}))?)?",
        normalized,
    )
    if full_match and full_match.group(2) in MONTHS:
        month = MONTHS[full_match.group(2)]
        day = int(full_match.group(3))
        hour = full_match.group(4)
        minute = full_match.group(5)
        second = full_match.group(6)
        result["precision"] = "day"
        result["iso"] = f"{year:04d}-{month:02d}-{day:02d}"
        if hour is not None and minute is not None:
            result["precision"] = "minute" if second is None else "second"
            result["iso"] += f"T{int(hour):02d}:{int(minute):02d}:{int(second or 0):02d}Z"
        return result

    month_match = re.match(r"^(\d{4})\s+([A-Za-z]{3})", normalized)
    if month_match and month_match.group(2) in MONTHS:
        month = MONTHS[month_match.group(2)]
        result["precision"] = "month"
        result["iso"] = f"{year:04d}-{month:02d}"
        return result

    quarter_match = re.match(r"^(\d{4})\s+Q([1-4])", normalized)
    if quarter_match:
        result["precision"] = "quarter"
        result["iso"] = f"{year:04d}-Q{quarter_match.group(2)}"
    return result

def normalize_satcat(value: Any) -> str | None:
    raw = clean(value)
    if not raw or raw == "-":
        return None
    if raw.isdigit():
        return str(int(raw))
    return raw

def classify(type_raw: Any) -> str:
    code = clean(type_raw)[:1]
    return CLASS_MAP.get(code, "unknown")

def deterministic_angles(jcat: str) -> tuple[float, float, float, str]:
    key = f"{RECONSTRUCTION_VERSION}:{jcat}".encode("utf-8")
    digest = hashlib.sha256(key).digest()
    scale = float(2**64)
    raan = int.from_bytes(digest[0:8], "big") / scale * 360.0
    arg_perigee = int.from_bytes(digest[8:16], "big") / scale * 360.0
    mean_anomaly = int.from_bytes(digest[16:24], "big") / scale * 360.0
    seed = digest.hex()
    return raan, arg_perigee, mean_anomaly, seed

def snake_case(name: str) -> str:
    name = name.replace("#", "")
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    name = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_").lower()
    return name or "field"

def open_gzip_text(path: Path):
    raw = path.open("wb")
    gz = gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0)
    text = io.TextIOWrapper(gz, encoding="utf-8", newline="")
    return raw, gz, text

def write_csv_gz(path: Path, fieldnames: list[str], rows: Iterable[dict[str, Any]]) -> None:
    raw, gz, text = open_gzip_text(path)
    try:
        writer = csv.DictWriter(text, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    finally:
        text.flush()
        text.detach()
        gz.close()
        raw.close()

def write_jsonl_gz(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    raw, gz, text = open_gzip_text(path)
    try:
        for row in rows:
            text.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    finally:
        text.flush()
        text.detach()
        gz.close()
        raw.close()

def load_source(path: Path) -> tuple[list[str], list[dict[str, str]], str]:
    raw_lines = path.read_text(encoding="utf-8").splitlines()
    if not raw_lines or not raw_lines[0].startswith("#JCAT\t"):
        raise ValueError("GCAT input does not begin with the expected #JCAT TSV header.")

    source_fields = raw_lines[0].lstrip("#").split("\t")
    updated_line = next((line for line in raw_lines[1:6] if line.startswith("# Updated ")), "")
    if not updated_line:
        raise ValueError("GCAT input is missing its # Updated provenance line.")

    data_lines = [line for line in raw_lines[1:] if line and not line.startswith("#")]
    reader = csv.DictReader(data_lines, fieldnames=source_fields, delimiter="\t")
    rows = list(reader)
    if len(rows) < 50000:
        raise ValueError(f"GCAT input unexpectedly contains only {len(rows):,} records.")
    return source_fields, rows, updated_line

def updated_line_to_iso(updated_line: str) -> str:
    # Example: "# Updated 2026 Jun 27 2213:02"
    match = re.search(r"Updated\s+(\d{4})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2})(\d{2}):(\d{2})", updated_line)
    if not match or match.group(2) not in MONTHS:
        raise ValueError(f"Could not parse GCAT update line: {updated_line}")
    year = int(match.group(1))
    month = MONTHS[match.group(2)]
    day = int(match.group(3))
    hour = int(match.group(4))
    minute = int(match.group(5))
    second = int(match.group(6))
    return f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}Z"

def normalize_rows(source_fields: list[str], source_rows: list[dict[str, str]], snapshot_iso: str):
    snapshot_year = int(snapshot_iso[:4])
    normalized: list[dict[str, Any]] = []
    quality_issues: list[dict[str, Any]] = []
    reconstruction_rows: list[dict[str, Any]] = []

    for source_index, row in enumerate(source_rows, start=1):
        jcat = clean(row.get("JCAT"))
        if not jcat:
            quality_issues.append({
                "jcat": None,
                "issue_code": "missing_jcat",
                "details": f"Source row {source_index} has no JCAT identifier.",
            })
            continue

        launch = parse_vague_date(row.get("LDate"))
        separation = parse_vague_date(row.get("SDate"))
        decay = parse_vague_date(row.get("DDate"))
        orbit_epoch = parse_vague_date(row.get("ODate"))

        launch_year = launch["year"]
        separation_year = separation["year"]
        decay_year_source = decay["year"]
        interval_start_year = separation_year or launch_year
        interval_end_year = decay_year_source
        interval_anomaly = None

        if interval_start_year is None:
            interval_anomaly = "missing_start_year"
            quality_issues.append({
                "jcat": jcat,
                "issue_code": "missing_start_year",
                "details": f"No parseable LDate or SDate: LDate={launch['raw']!r}; SDate={separation['raw']!r}",
            })
        elif interval_end_year is not None and interval_end_year < interval_start_year:
            if launch_year is not None and interval_end_year >= launch_year:
                interval_anomaly = "separation_after_recorded_end_used_launch_year"
                interval_start_year = launch_year
            else:
                interval_anomaly = "recorded_end_before_start_ignored_for_presence"
                interval_end_year = None
            quality_issues.append({
                "jcat": jcat,
                "issue_code": interval_anomaly,
                "details": (
                    f"LDate={launch['raw']!r}; SDate={separation['raw']!r}; "
                    f"DDate={decay['raw']!r}"
                ),
            })

        object_class = classify(row.get("Type"))
        perigee = parse_number(row.get("Perigee"))
        apogee = parse_number(row.get("Apogee"))
        inclination = parse_number(row.get("Inc"))
        primary_body = clean(row.get("Primary")) or None
        snapshot_present = decay_year_source is None
        snapshot_earth_present = snapshot_present and primary_body == "Earth"
        reconstruction_candidate = (
            snapshot_earth_present
            and object_class in {"payload", "rocket_body", "component", "debris"}
            and perigee is not None
            and apogee is not None
            and inclination is not None
        )

        source_row = "\t".join(str(row.get(field, "")) for field in source_fields)
        source_row_sha = sha256_bytes(source_row.encode("utf-8"))

        normalized_row = {
            "jcat": jcat,
            "satcat_number": normalize_satcat(row.get("Satcat")),
            "launch_tag": clean(row.get("Launch_Tag")) or None,
            "piece": clean(row.get("Piece")) or None,
            "object_class": object_class,
            "type_raw": clean(row.get("Type")) or None,
            "name": clean(row.get("Name")) or None,
            "payload_name": clean(row.get("PLName")) or None,
            "launch_date_raw": launch["raw"] or None,
            "launch_date_iso": launch["iso"],
            "launch_date_precision": launch["precision"],
            "launch_date_uncertain": int(launch["uncertain"]),
            "launch_year": launch_year,
            "separation_date_raw": separation["raw"] or None,
            "separation_date_iso": separation["iso"],
            "separation_date_precision": separation["precision"],
            "separation_date_uncertain": int(separation["uncertain"]),
            "separation_year": separation_year,
            "appearance_year": interval_start_year,
            "decay_date_raw": decay["raw"] or None,
            "decay_date_iso": decay["iso"],
            "decay_date_precision": decay["precision"],
            "decay_date_uncertain": int(decay["uncertain"]),
            "decay_year": decay_year_source,
            "interval_end_year": interval_end_year,
            "interval_anomaly": interval_anomaly,
            "primary_body": primary_body,
            "status_raw": clean(row.get("Status")) or None,
            "destination_raw": clean(row.get("Dest")) or None,
            "owner_code": clean(row.get("Owner")) or None,
            "state_code": clean(row.get("State")) or None,
            "manufacturer": clean(row.get("Manufacturer")) or None,
            "bus": clean(row.get("Bus")) or None,
            "motor": clean(row.get("Motor")) or None,
            "mass_kg": parse_number(row.get("Mass")),
            "dry_mass_kg": parse_number(row.get("DryMass")),
            "total_mass_kg": parse_number(row.get("TotMass")),
            "length_m": parse_number(row.get("Length")),
            "diameter_m": parse_number(row.get("Diameter")),
            "span_m": parse_number(row.get("Span")),
            "shape_raw": clean(row.get("Shape")) or None,
            "orbit_epoch_raw": orbit_epoch["raw"] or None,
            "orbit_epoch_iso": orbit_epoch["iso"],
            "orbit_epoch_precision": orbit_epoch["precision"],
            "orbit_epoch_uncertain": int(orbit_epoch["uncertain"]),
            "perigee_km": perigee,
            "apogee_km": apogee,
            "inclination_deg": inclination,
            "orbit_class_raw": clean(row.get("OpOrbit")) or None,
            "orbit_quality_raw": clean(row.get("OQUAL")) or None,
            "alternate_names_raw": clean(row.get("AltNames")) or None,
            "snapshot_present": int(snapshot_present),
            "snapshot_earth_present": int(snapshot_earth_present),
            "reconstruction_candidate": int(reconstruction_candidate),
            "source_snapshot_updated_at": snapshot_iso,
            "source_row_number": source_index + 2,
            "source_row_sha256": source_row_sha,
        }
        normalized.append(normalized_row)

        if reconstruction_candidate:
            rp = EARTH_RADIUS_KM + perigee
            ra = EARTH_RADIUS_KM + apogee
            if ra < rp:
                rp, ra = ra, rp
                quality_issues.append({
                    "jcat": jcat,
                    "issue_code": "apogee_below_perigee_swapped_for_reconstruction",
                    "details": f"Perigee={perigee}; Apogee={apogee}",
                })
            semi_major = (rp + ra) / 2.0
            eccentricity = (ra - rp) / (ra + rp) if (ra + rp) else 0.0
            period_minutes = (2.0 * math.pi * math.sqrt((semi_major**3) / EARTH_MU_KM3_S2)) / 60.0
            raan, argp, mean_anomaly, seed = deterministic_angles(jcat)
            reconstruction_rows.append({
                "jcat": jcat,
                "satcat_number": normalized_row["satcat_number"],
                "name": normalized_row["name"],
                "object_class": object_class,
                "source_perigee_km": perigee,
                "source_apogee_km": apogee,
                "source_inclination_deg": inclination,
                "source_orbit_epoch_raw": normalized_row["orbit_epoch_raw"],
                "semi_major_axis_km": semi_major,
                "eccentricity": eccentricity,
                "inclination_deg": inclination,
                "raan_deg_reconstructed": raan,
                "argument_of_perigee_deg_reconstructed": argp,
                "mean_anomaly_deg_reconstructed": mean_anomaly,
                "estimated_period_minutes": period_minutes,
                "deterministic_seed_sha256": seed,
                "membership_provenance": "GCAT source-backed catalog membership",
                "orbit_shape_provenance": "GCAT canonical perigee/apogee/inclination",
                "orbital_angles_provenance": "deterministic educational reconstruction",
                "position_accuracy": "not live; not observational; reconstructed",
                "reconstruction_version": RECONSTRUCTION_VERSION,
            })

    return normalized, quality_issues, reconstruction_rows

def build_yearly_presence(normalized: list[dict[str, Any]], snapshot_iso: str):
    snapshot_year = int(snapshot_iso[:4])
    snapshot_date = snapshot_iso[:10]
    rows: list[dict[str, Any]] = []
    summary = defaultdict(lambda: {
        "appeared_count": 0,
        "ended_count": 0,
        "present_any_time_count": 0,
        "present_at_period_end_count": 0,
    })

    for obj in normalized:
        start = obj["appearance_year"]
        if start is None or start > snapshot_year:
            continue

        end = obj["interval_end_year"]
        last_year = min(end if end is not None else snapshot_year, snapshot_year)
        if last_year < start:
            continue

        for year in range(start, last_year + 1):
            ended = int(end is not None and year == end)
            appeared = int(year == start)
            present_at_end = int(end is None or year < end)
            row = {
                "year": year,
                "period_end_date": snapshot_date if year == snapshot_year else f"{year:04d}-12-31",
                "is_partial_year": int(year == snapshot_year),
                "jcat": obj["jcat"],
                "object_class": obj["object_class"],
                "appeared_during_period": appeared,
                "ended_during_period": ended,
                "present_any_time_during_period": 1,
                "present_at_period_end": present_at_end,
            }
            rows.append(row)

            for category in ("all", obj["object_class"]):
                bucket = summary[(year, category)]
                bucket["appeared_count"] += appeared
                bucket["ended_count"] += ended
                bucket["present_any_time_count"] += 1
                bucket["present_at_period_end_count"] += present_at_end

    summary_rows = []
    for year in range(1957, snapshot_year + 1):
        for category in SUMMARY_CLASSES:
            bucket = summary[(year, category)]
            summary_rows.append({
                "year": year,
                "period_end_date": snapshot_date if year == snapshot_year else f"{year:04d}-12-31",
                "is_partial_year": int(year == snapshot_year),
                "object_class": category,
                **bucket,
            })
    return rows, summary_rows

def create_database(
    db_path: Path,
    source_fields: list[str],
    source_rows: list[dict[str, str]],
    normalized: list[dict[str, Any]],
    yearly_rows: list[dict[str, Any]],
    reconstruction_rows: list[dict[str, Any]],
    quality_issues: list[dict[str, Any]],
    metadata: dict[str, Any],
) -> None:
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA foreign_keys=ON")

    conn.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.executemany(
        "INSERT INTO metadata(key, value) VALUES (?, ?)",
        [(key, json.dumps(value, ensure_ascii=False, sort_keys=True) if not isinstance(value, str) else value)
         for key, value in metadata.items()],
    )

    source_columns = []
    used = set()
    for field in source_fields:
        col = snake_case(field)
        base = col
        index = 2
        while col in used:
            col = f"{base}_{index}"
            index += 1
        used.add(col)
        source_columns.append(col)

    source_defs = ", ".join(f'"{col}" TEXT' for col in source_columns)
    conn.execute(f'CREATE TABLE source_rows ({source_defs}, PRIMARY KEY ("{source_columns[0]}")) WITHOUT ROWID')
    source_insert = f'INSERT INTO source_rows VALUES ({",".join("?" for _ in source_columns)})'
    conn.executemany(
        source_insert,
        [[row.get(field, "") for field in source_fields] for row in source_rows],
    )

    conn.execute("""
        CREATE TABLE objects (
            jcat TEXT PRIMARY KEY,
            satcat_number TEXT,
            launch_tag TEXT,
            piece TEXT,
            object_class TEXT NOT NULL CHECK(object_class IN ('payload','rocket_body','component','debris','unknown','spurious')),
            type_raw TEXT,
            name TEXT,
            payload_name TEXT,
            launch_date_raw TEXT,
            launch_date_iso TEXT,
            launch_date_precision TEXT,
            launch_date_uncertain INTEGER NOT NULL,
            launch_year INTEGER,
            separation_date_raw TEXT,
            separation_date_iso TEXT,
            separation_date_precision TEXT,
            separation_date_uncertain INTEGER NOT NULL,
            separation_year INTEGER,
            appearance_year INTEGER,
            decay_date_raw TEXT,
            decay_date_iso TEXT,
            decay_date_precision TEXT,
            decay_date_uncertain INTEGER NOT NULL,
            decay_year INTEGER,
            interval_end_year INTEGER,
            interval_anomaly TEXT,
            primary_body TEXT,
            status_raw TEXT,
            destination_raw TEXT,
            owner_code TEXT,
            state_code TEXT,
            manufacturer TEXT,
            bus TEXT,
            motor TEXT,
            mass_kg REAL,
            dry_mass_kg REAL,
            total_mass_kg REAL,
            length_m REAL,
            diameter_m REAL,
            span_m REAL,
            shape_raw TEXT,
            orbit_epoch_raw TEXT,
            orbit_epoch_iso TEXT,
            orbit_epoch_precision TEXT,
            orbit_epoch_uncertain INTEGER NOT NULL,
            perigee_km REAL,
            apogee_km REAL,
            inclination_deg REAL,
            orbit_class_raw TEXT,
            orbit_quality_raw TEXT,
            alternate_names_raw TEXT,
            snapshot_present INTEGER NOT NULL,
            snapshot_earth_present INTEGER NOT NULL,
            reconstruction_candidate INTEGER NOT NULL,
            source_snapshot_updated_at TEXT NOT NULL,
            source_row_number INTEGER NOT NULL,
            source_row_sha256 TEXT NOT NULL,
            FOREIGN KEY(jcat) REFERENCES source_rows(jcat)
        ) WITHOUT ROWID
    """)

    object_fields = list(normalized[0].keys())
    insert_objects = f'INSERT INTO objects ({",".join(object_fields)}) VALUES ({",".join("?" for _ in object_fields)})'
    conn.executemany(insert_objects, [[row[field] for field in object_fields] for row in normalized])

    conn.execute("""
        CREATE TABLE yearly_presence (
            year INTEGER NOT NULL,
            period_end_date TEXT NOT NULL,
            is_partial_year INTEGER NOT NULL,
            jcat TEXT NOT NULL,
            object_class TEXT NOT NULL,
            appeared_during_period INTEGER NOT NULL,
            ended_during_period INTEGER NOT NULL,
            present_any_time_during_period INTEGER NOT NULL,
            present_at_period_end INTEGER NOT NULL,
            PRIMARY KEY(year, jcat),
            FOREIGN KEY(jcat) REFERENCES objects(jcat)
        ) WITHOUT ROWID
    """)
    year_fields = list(yearly_rows[0].keys())
    insert_years = f'INSERT INTO yearly_presence ({",".join(year_fields)}) VALUES ({",".join("?" for _ in year_fields)})'
    conn.executemany(insert_years, [[row[field] for field in year_fields] for row in yearly_rows])

    conn.execute("""
        CREATE TABLE reconstruction_parameters (
            jcat TEXT PRIMARY KEY,
            satcat_number TEXT,
            name TEXT,
            object_class TEXT NOT NULL,
            source_perigee_km REAL NOT NULL,
            source_apogee_km REAL NOT NULL,
            source_inclination_deg REAL NOT NULL,
            source_orbit_epoch_raw TEXT,
            semi_major_axis_km REAL NOT NULL,
            eccentricity REAL NOT NULL,
            inclination_deg REAL NOT NULL,
            raan_deg_reconstructed REAL NOT NULL,
            argument_of_perigee_deg_reconstructed REAL NOT NULL,
            mean_anomaly_deg_reconstructed REAL NOT NULL,
            estimated_period_minutes REAL NOT NULL,
            deterministic_seed_sha256 TEXT NOT NULL,
            membership_provenance TEXT NOT NULL,
            orbit_shape_provenance TEXT NOT NULL,
            orbital_angles_provenance TEXT NOT NULL,
            position_accuracy TEXT NOT NULL,
            reconstruction_version TEXT NOT NULL,
            FOREIGN KEY(jcat) REFERENCES objects(jcat)
        ) WITHOUT ROWID
    """)
    recon_fields = list(reconstruction_rows[0].keys())
    insert_recon = f'INSERT INTO reconstruction_parameters ({",".join(recon_fields)}) VALUES ({",".join("?" for _ in recon_fields)})'
    conn.executemany(insert_recon, [[row[field] for field in recon_fields] for row in reconstruction_rows])

    conn.execute("""
        CREATE TABLE quality_issues (
            issue_id INTEGER PRIMARY KEY,
            jcat TEXT,
            issue_code TEXT NOT NULL,
            details TEXT NOT NULL
        )
    """)
    conn.executemany(
        "INSERT INTO quality_issues(jcat, issue_code, details) VALUES (?, ?, ?)",
        [(row.get("jcat"), row["issue_code"], row["details"]) for row in quality_issues],
    )

    conn.executescript("""
        CREATE INDEX idx_objects_satcat ON objects(satcat_number);
        CREATE INDEX idx_objects_launch_year ON objects(launch_year);
        CREATE INDEX idx_objects_decay_year ON objects(decay_year);
        CREATE INDEX idx_objects_class ON objects(object_class);
        CREATE INDEX idx_objects_snapshot_earth ON objects(snapshot_earth_present, object_class);
        CREATE INDEX idx_yearly_presence_jcat ON yearly_presence(jcat);
        CREATE INDEX idx_yearly_presence_class_year ON yearly_presence(year, object_class);

        CREATE VIEW snapshot_present_objects AS
        SELECT * FROM objects WHERE snapshot_present = 1 AND object_class <> 'spurious';

        CREATE VIEW snapshot_present_earth_objects AS
        SELECT * FROM objects
        WHERE snapshot_earth_present = 1 AND object_class <> 'spurious';

        CREATE VIEW payloads AS
        SELECT * FROM objects WHERE object_class = 'payload';

        CREATE VIEW reconstruction_candidates AS
        SELECT
            o.*,
            r.semi_major_axis_km,
            r.eccentricity,
            r.raan_deg_reconstructed,
            r.argument_of_perigee_deg_reconstructed,
            r.mean_anomaly_deg_reconstructed,
            r.estimated_period_minutes,
            r.deterministic_seed_sha256,
            r.membership_provenance,
            r.orbit_shape_provenance,
            r.orbital_angles_provenance,
            r.position_accuracy,
            r.reconstruction_version
        FROM objects o
        JOIN reconstruction_parameters r USING (jcat)
        WHERE o.reconstruction_candidate = 1;

        CREATE VIEW yearly_totals AS
        SELECT
            year,
            period_end_date,
            is_partial_year,
            object_class,
            SUM(appeared_during_period) AS appeared_count,
            SUM(ended_during_period) AS ended_count,
            SUM(present_any_time_during_period) AS present_any_time_count,
            SUM(present_at_period_end) AS present_at_period_end_count
        FROM yearly_presence
        GROUP BY year, period_end_date, is_partial_year, object_class;
    """)

    conn.execute("ANALYZE")
    conn.commit()
    conn.execute("VACUUM")
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise RuntimeError(f"SQLite integrity check failed: {integrity}")
    conn.close()

def main() -> None:
    parser = argparse.ArgumentParser(description="Build Orbit Studio's canonical GCAT satellite data package.")
    parser.add_argument("--input", required=True, type=Path, help="Versioned GCAT satcat TSV snapshot.")
    parser.add_argument("--root", default=Path("."), type=Path, help="Package root.")
    parser.add_argument(
        "--source-url",
        default="https://planet4589.org/space/gcat/tsv/cat/satcat.tsv",
        help="Authoritative upstream source URL.",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    source_fields, source_rows, updated_line = load_source(args.input)
    snapshot_iso = updated_line_to_iso(updated_line)
    normalized, quality_issues, reconstruction_rows = normalize_rows(source_fields, source_rows, snapshot_iso)
    yearly_rows, yearly_summary = build_yearly_presence(normalized, snapshot_iso)

    object_fields = list(normalized[0].keys())
    year_fields = list(yearly_rows[0].keys())
    recon_fields = list(reconstruction_rows[0].keys())

    write_csv_gz(data_dir / "objects.csv.gz", object_fields, normalized)
    write_jsonl_gz(data_dir / "objects.ndjson.gz", normalized)
    write_csv_gz(data_dir / "yearly_object_presence.csv.gz", year_fields, yearly_rows)
    write_csv_gz(data_dir / "reconstruction_candidates.csv.gz", recon_fields, reconstruction_rows)

    current_earth = [row for row in normalized if row["snapshot_earth_present"] and row["object_class"] != "spurious"]
    write_csv_gz(data_dir / "snapshot_present_earth_objects.csv.gz", object_fields, current_earth)

    with (data_dir / "yearly_summary.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(yearly_summary[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(yearly_summary)

    class_counts = Counter(row["object_class"] for row in normalized)
    snapshot_class_counts = Counter(
        row["object_class"] for row in normalized if row["snapshot_present"]
    )
    earth_snapshot_class_counts = Counter(
        row["object_class"] for row in normalized if row["snapshot_earth_present"]
    )

    overview = {
        "package_version": PACKAGE_VERSION,
        "source": "GCAT Standard Satellite Catalog",
        "source_url": args.source_url,
        "source_snapshot_updated_at": snapshot_iso,
        "source_record_count": len(normalized),
        "source_fields": source_fields,
        "class_counts": dict(sorted(class_counts.items())),
        "snapshot_present_no_recorded_end_count": sum(row["snapshot_present"] for row in normalized),
        "snapshot_present_no_recorded_end_class_counts": dict(sorted(snapshot_class_counts.items())),
        "snapshot_present_earth_count": sum(row["snapshot_earth_present"] for row in normalized),
        "snapshot_present_earth_class_counts": dict(sorted(earth_snapshot_class_counts.items())),
        "reconstruction_candidate_count": len(reconstruction_rows),
        "yearly_presence_row_count": len(yearly_rows),
        "year_range": [1957, int(snapshot_iso[:4])],
        "partial_final_year": True,
        "partial_final_year_end_date": snapshot_iso[:10],
        "quality_issue_count": len(quality_issues),
        "date_interval_anomaly_count": sum(1 for row in normalized if row["interval_anomaly"]),
        "terminology": {
            "payload": "Satellite or spacecraft payload.",
            "rocket_body": "Rocket stage.",
            "component": "Separated functional or structural component.",
            "debris": "Fragment or debris object.",
            "snapshot_present": "No recorded descent/end date in this source snapshot; not equivalent to operationally active.",
        },
    }
    (data_dir / "overview.json").write_text(
        json.dumps(overview, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (data_dir / "yearly_summary.json").write_text(
        json.dumps({
            "source_snapshot_updated_at": snapshot_iso,
            "rows": yearly_summary,
        }, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    with (data_dir / "quality_issues.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["jcat", "issue_code", "details"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(quality_issues)

    metadata = {
        "package_version": PACKAGE_VERSION,
        "source_name": "General Catalog of Artificial Space Objects (GCAT) — Standard Satellite Catalog",
        "source_url": args.source_url,
        "source_snapshot_updated_at": snapshot_iso,
        "source_license": "CC BY 4.0",
        "source_attribution": "Data from GCAT (J. McDowell, planet4589.org/space/gcat)",
        "source_record_count": len(normalized),
        "yearly_presence_row_count": len(yearly_rows),
        "reconstruction_candidate_count": len(reconstruction_rows),
        "reconstruction_version": RECONSTRUCTION_VERSION,
    }
    create_database(
        data_dir / "orbit-studio-satellites.sqlite",
        source_fields,
        source_rows,
        normalized,
        yearly_rows,
        reconstruction_rows,
        quality_issues,
        metadata,
    )

    artifacts = [
        args.input,
        data_dir / "objects.csv.gz",
        data_dir / "objects.ndjson.gz",
        data_dir / "snapshot_present_earth_objects.csv.gz",
        data_dir / "yearly_object_presence.csv.gz",
        data_dir / "yearly_summary.csv",
        data_dir / "yearly_summary.json",
        data_dir / "reconstruction_candidates.csv.gz",
        data_dir / "quality_issues.csv",
        data_dir / "overview.json",
        data_dir / "orbit-studio-satellites.sqlite",
    ]
    manifest = {
        "package": {
            "name": "Orbit Studio Satellite Source of Truth",
            "version": PACKAGE_VERSION,
            "snapshot_updated_at": snapshot_iso,
        },
        "upstream": {
            "name": "General Catalog of Artificial Space Objects (GCAT)",
            "author": "Jonathan C. McDowell",
            "catalog": "Standard Satellite Catalog (satcat)",
            "url": args.source_url,
            "homepage": "https://planet4589.org/space/gcat/",
            "license": "CC BY 4.0",
            "required_attribution": "Data from GCAT (J. McDowell, planet4589.org/space/gcat)",
            "source_header": updated_line,
        },
        "counts": overview,
        "artifacts": {
            str(path.relative_to(root)): {
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
            for path in artifacts
        },
        "authority": {
            "immutable_upstream_snapshot": str(args.input.relative_to(root)),
            "canonical_query_database": "data/orbit-studio-satellites.sqlite",
            "canonical_normalized_exchange": "data/objects.csv.gz",
            "canonical_yearly_history": "data/yearly_object_presence.csv.gz",
            "canonical_yearly_summary": "data/yearly_summary.csv",
            "canonical_rendering_input": "data/reconstruction_candidates.csv.gz",
        },
        "excluded_as_authority": [
            "CelesTrak snapshots",
            "Space-Track responses",
            "application fixtures",
            "small samples",
            "ad hoc generated catalogs",
        ],
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )

if __name__ == "__main__":
    main()
