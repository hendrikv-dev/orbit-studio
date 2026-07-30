#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

DEFAULT_URL = "https://planet4589.org/space/gcat/tsv/cat/satcat.tsv"

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download a new official GCAT satcat snapshot without overwriting prior snapshots."
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--no-build", action="store_true")
    args = parser.parse_args()

    root = args.root.resolve()
    raw_dir = root / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    request = urllib.request.Request(
        args.url,
        headers={"User-Agent": "Orbit-Studio-GCAT-Updater/1.0 (+open-source educational use)"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()

    text = data.decode("utf-8")
    lines = text.splitlines()
    if not lines or not lines[0].startswith("#JCAT\t"):
        raise SystemExit("Downloaded file does not have the expected GCAT #JCAT TSV header.")
    updated_line = next((line for line in lines[1:6] if line.startswith("# Updated ")), "")
    match = re.search(r"Updated\s+(\d{4})\s+([A-Za-z]{3})\s+(\d{1,2})", updated_line)
    if not match:
        raise SystemExit("Downloaded file does not have a parseable # Updated line.")

    months = {"Jan":"01","Feb":"02","Mar":"03","Apr":"04","May":"05","Jun":"06",
              "Jul":"07","Aug":"08","Sep":"09","Oct":"10","Nov":"11","Dec":"12"}
    date = f"{match.group(1)}-{months[match.group(2)]}-{int(match.group(3)):02d}"
    destination = raw_dir / f"gcat-satcat-{date}.tsv"
    if destination.exists():
        if destination.read_bytes() != data:
            raise SystemExit(f"{destination} exists but differs. Refusing to overwrite a versioned snapshot.")
        print(f"Snapshot already present and identical: {destination}")
    else:
        destination.write_bytes(data)
        print(f"Saved immutable snapshot: {destination}")

    record_count = sum(1 for line in lines if line and not line.startswith("#"))
    if record_count < 50000:
        raise SystemExit(f"Downloaded snapshot has only {record_count:,} records; refusing to build.")

    if not args.no_build:
        subprocess.run(
            [
                sys.executable,
                str(root / "scripts" / "build.py"),
                "--input",
                str(destination),
                "--root",
                str(root),
                "--source-url",
                args.url,
            ],
            check=True,
        )
        print("Rebuilt derived artifacts. Review manifest and counts, regenerate CHECKSUMS.sha256, then run verify.py.")

if __name__ == "__main__":
    main()
