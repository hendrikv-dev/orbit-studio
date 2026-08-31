#!/usr/bin/env python3
"""
Build Tracker's light-pollution tile archive from EOG VIIRS Nighttime Lights.

## Why this exists

Tracker used to ship a single 2048x966 PNG derived from NASA's Black Marble
*rendered image* — about 14 km per pixel. At that resolution the layer could
place a metropolitan glow and nothing smaller: Bend, Oregon, a city of a hundred
thousand people, did not register at all and was reported to the reader as dark.
For a product whose whole job is to answer "what can I see from *here*", a
light-pollution layer that cannot resolve a city is not a coarse answer, it is a
wrong one.

This script replaces that with the measured quantity at its native resolution:
EOG's Annual VIIRS Nighttime Lights V2.1, 15 arc-seconds (~500 m), carried as
radiance rather than as a picture of radiance.

## What it produces

A single sparse archive plus its index, both under `public/tracker/`:

  * `light-pollution-v21-2024.bin`   — concatenated PNG tiles, end to end
  * `light-pollution-v21-2024.json`  — header and tile index

Tiles are Web Mercator XYZ, 256px, zoom 0 to 8. Zoom 8 is 611 m per pixel at the
equator and about 430 m at 45 degrees, which is where the source's own 15
arc-second grid lands — going further would store interpolation, not data.

Only tiles containing light exist. A missing tile means "no artificial light
here", which is true of most of the planet: 2.6% of valid source pixels carry
any light at all, so a dense pyramid would be almost entirely zeros.

## The encoding

Each tile is an 8-bit RGB PNG carrying the source integer split across two
channels: red is the high byte, green the low, blue unused. Decoding is
`(R * 256 + G) / 10` and gives back radiance in nW/cm2/sr exactly — no lossy
remapping sits between the published measurement and what Tracker reads, so the
interpretation lives in code where it can be read and argued with.

The split is not for compression; 16-bit greyscale is in fact 8% smaller here,
and was the first version of this file. It is because a browser cannot read one
back. Decoding a tile at runtime means `createImageBitmap` and a 2D canvas, and
a canvas is 8 bits per channel: a 16-bit PNG drawn to one is silently truncated,
which would quietly halve the precision of every reading. Two 8-bit channels
survive that round trip untouched, which is the same reason Terrarium elevation
tiles encode the way they do.

## Running it

    python3 -m venv .venv && .venv/bin/pip install rasterio numpy pillow
    .venv/bin/python scripts/build-light-pollution-tiles.py --source <VNL.tif>

The source GeoTIFF is not vendored: it is 61 MB and the archive is derived from
it. `--source` accepts the file documented in provenance/inventory.json under
`tracker-light-pollution-viirs`.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import struct
import sys
from pathlib import Path

try:
    import numpy as np
    import rasterio
    from PIL import Image
except ImportError:  # pragma: no cover - a setup problem, not a logic one
    sys.exit("needs rasterio, numpy and pillow: see the module docstring")

TILE_SIZE = 256
MAX_ZOOM = 8
MERCATOR_LIMIT = 85.0511287798066

# Below this the source is recording noise rather than settlement lighting, and
# a tile of it costs bytes to say "almost nothing". EOG's own masked product
# already removes the background; this only drops tiles whose entire content is
# under a twentieth of a nW, which no band distinguishes.
EMPTY_TILE_MAX = 0.05


def mercator_y(latitude_deg: float) -> float:
    r = math.radians(max(-MERCATOR_LIMIT, min(MERCATOR_LIMIT, latitude_deg)))
    return math.log(math.tan(math.pi / 4 + r / 2))


def tile_latitudes(z: int, y: int) -> np.ndarray:
    """Latitude of each pixel-centre row in a tile, in degrees."""
    n = 2 ** z
    north = math.pi * (1 - 2 * y / n)
    south = math.pi * (1 - 2 * (y + 1) / n)
    rows = north + (south - north) * (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE
    return np.degrees(2 * np.arctan(np.exp(rows)) - math.pi / 2)


def tile_longitudes(z: int, x: int) -> np.ndarray:
    n = 2 ** z
    west = x / n * 360 - 180
    east = (x + 1) / n * 360 - 180
    return west + (east - west) * (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE


def lit_tiles_at_max_zoom(src, decimate: int = 8) -> set[tuple[int, int]]:
    """
    Which zoom-8 tiles contain any light.

    Found from a max-pooled mask rather than the full raster, because the only
    question here is emptiness and a factor-of-eight reduction still puts about
    forty samples across a zoom-8 tile.
    """
    height, width = src.height // decimate, src.width // decimate
    lit = np.zeros((height, width), dtype=bool)
    strip = decimate * 64
    for top in range(0, height * decimate, strip):
        rows = min(strip, height * decimate - top)
        if rows < decimate:
            break
        block = src.read(1, window=rasterio.windows.Window(0, top, width * decimate, rows))
        block = np.where(block == src.nodata, 0, block)
        block = block[: (rows // decimate) * decimate, : width * decimate]
        pooled = block.reshape(rows // decimate, decimate, width, decimate).max(axis=(1, 3))
        lit[top // decimate : top // decimate + pooled.shape[0]] |= pooled > EMPTY_TILE_MAX * 10

    ys, xs = np.nonzero(lit)
    bounds = src.bounds
    lon = bounds.left + (xs + 0.5) * (bounds.right - bounds.left) / width
    lat = bounds.top - (ys + 0.5) * (bounds.top - bounds.bottom) / height
    keep = np.abs(lat) < MERCATOR_LIMIT
    lon, lat = lon[keep], lat[keep]

    n = 2 ** MAX_ZOOM
    tx = np.clip(((lon + 180) / 360 * n).astype(np.int64), 0, n - 1)
    ty_norm = (1 - np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) / np.pi) / 2
    ty = np.clip((ty_norm * n).astype(np.int64), 0, n - 1)
    # A decimated cell can sit just inside a neighbouring tile, so include the
    # immediate neighbours: a spurious empty tile is dropped later anyway, and a
    # missing one would be a hole in a city.
    out: set[tuple[int, int]] = set()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for a, b in zip(tx + dx, ty + dy):
                if 0 <= a < n and 0 <= b < n:
                    out.add((int(a), int(b)))
    return out


def tile_latitude_edges(z: int, y: int) -> np.ndarray:
    n = 2 ** z
    north = math.pi * (1 - 2 * y / n)
    south = math.pi * (1 - 2 * (y + 1) / n)
    edges = north + (south - north) * np.arange(TILE_SIZE + 1) / TILE_SIZE
    return np.degrees(2 * np.arctan(np.exp(edges)) - math.pi / 2)


def tile_longitude_edges(z: int, x: int) -> np.ndarray:
    n = 2 ** z
    west = x / n * 360 - 180
    east = (x + 1) / n * 360 - 180
    return west + (east - west) * np.arange(TILE_SIZE + 1) / TILE_SIZE


def render_max_zoom_tile(src, x: int, y: int) -> np.ndarray | None:
    """
    One zoom-8 tile, as the mean source radiance inside each output pixel.

    Nearest-neighbour was the first version of this and it was wrong in a way
    worth recording. A Mercator pixel at this zoom is about 430 m across at 45
    degrees while the source grid is 463 m north-south and 327 m east-west
    there, so the two grids never line up; picking the single nearest source
    pixel therefore reports whichever neighbour happens to be closest to the
    output centre. In flat terrain that is invisible, but across a city's
    gradient it is not: central Portland measures 9.7 nW in the source and its
    neighbour measures 14.4, and nearest-neighbour returned the neighbour.

    Averaging the source pixels that fall inside each output pixel is both the
    right answer for a radiance and a stable one — it does not move when the two
    grids drift against each other. It is computed from a summed-area table, so
    the cost is one addition per output pixel rather than one read per source
    pixel. Where an output pixel is finer than the source, the box collapses to
    a single cell and the result is that cell's value.
    """
    lat_edges = tile_latitude_edges(MAX_ZOOM, y)
    lon_edges = tile_longitude_edges(MAX_ZOOM, x)
    bounds, transform = src.bounds, src.transform

    cols = (lon_edges - bounds.left) / transform.a
    rows = (lat_edges - bounds.top) / transform.e
    c_lo = np.clip(np.floor(cols[:-1]).astype(np.int64), 0, src.width)
    c_hi = np.clip(np.ceil(cols[1:]).astype(np.int64), 0, src.width)
    r_lo = np.clip(np.floor(rows[:-1]).astype(np.int64), 0, src.height)
    r_hi = np.clip(np.ceil(rows[1:]).astype(np.int64), 0, src.height)
    c_hi = np.maximum(c_hi, c_lo + 1)
    r_hi = np.maximum(r_hi, r_lo + 1)

    valid_c = c_lo < src.width
    valid_r = r_lo < src.height
    if not valid_c.any() or not valid_r.any():
        return None

    c0, c1 = int(c_lo[valid_c].min()), int(min(src.width, c_hi[valid_c].max()))
    r0, r1 = int(r_lo[valid_r].min()), int(min(src.height, r_hi[valid_r].max()))
    if c1 <= c0 or r1 <= r0:
        return None

    patch = src.read(1, window=rasterio.windows.Window(c0, r0, c1 - c0, r1 - r0))
    patch = np.where(patch == src.nodata, 0, patch)
    patch = np.clip(patch, 0, 32767).astype(np.float64)

    # Summed-area table, padded so a box sum is four lookups with no branching.
    sat = np.zeros((patch.shape[0] + 1, patch.shape[1] + 1), dtype=np.float64)
    np.cumsum(np.cumsum(patch, axis=0), axis=1, out=sat[1:, 1:])

    rl = np.clip(r_lo - r0, 0, patch.shape[0])
    rh = np.clip(r_hi - r0, 0, patch.shape[0])
    cl = np.clip(c_lo - c0, 0, patch.shape[1])
    ch = np.clip(c_hi - c0, 0, patch.shape[1])

    total = (
        sat[np.ix_(rh, ch)] - sat[np.ix_(rl, ch)] - sat[np.ix_(rh, cl)] + sat[np.ix_(rl, cl)]
    )
    count = np.outer(rh - rl, ch - cl)
    tile = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.uint16)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(count > 0, total / np.maximum(count, 1), 0.0)
    inside = np.outer(valid_r, valid_c)
    tile[inside] = np.clip(np.rint(mean[inside]), 0, 65535).astype(np.uint16)
    return tile


def downsample(children: dict[tuple[int, int], np.ndarray], x: int, y: int) -> np.ndarray | None:
    """
    A parent tile, as the area mean of its four children.

    Mean rather than maximum because the stored quantity is radiance, and the
    average radiance over a wider pixel is what a wider pixel means. Using the
    maximum would keep small towns visible when zoomed out, which looks better
    and would be a different quantity than the one this file claims to hold.
    """
    quad = np.zeros((TILE_SIZE * 2, TILE_SIZE * 2), dtype=np.uint32)
    found = False
    for dx in (0, 1):
        for dy in (0, 1):
            child = children.get((2 * x + dx, 2 * y + dy))
            if child is None:
                continue
            found = True
            quad[dy * TILE_SIZE : (dy + 1) * TILE_SIZE, dx * TILE_SIZE : (dx + 1) * TILE_SIZE] = child
    if not found:
        return None
    mean = quad.reshape(TILE_SIZE, 2, TILE_SIZE, 2).mean(axis=(1, 3))
    return np.clip(np.rint(mean), 0, 65535).astype(np.uint16)


def encode(tile: np.ndarray) -> bytes:
    rgb = np.zeros((*tile.shape, 3), dtype=np.uint8)
    rgb[..., 0] = (tile >> 8).astype(np.uint8)
    rgb[..., 1] = (tile & 0xFF).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="EOG VNL annual GeoTIFF")
    parser.add_argument("--out", type=Path, default=Path("public/tracker"))
    parser.add_argument("--name", default="light-pollution-v21-2024")
    args = parser.parse_args()

    src = rasterio.open(args.source)
    if src.crs.to_epsg() != 4326:
        return print("source must be EPSG:4326") or 1

    print(f"source {src.width}x{src.height} at {src.res[0]*3600:.1f} arcsec")
    print("finding tiles that contain light ...")
    wanted = lit_tiles_at_max_zoom(src)
    print(f"  {len(wanted)} candidate tiles at zoom {MAX_ZOOM}")

    levels: dict[int, dict[tuple[int, int], np.ndarray]] = {MAX_ZOOM: {}}
    for index, (x, y) in enumerate(sorted(wanted), 1):
        if index % 2000 == 0:
            print(f"  rendered {index}/{len(wanted)}")
        tile = render_max_zoom_tile(src, x, y)
        if tile is None or tile.max() <= EMPTY_TILE_MAX * 10:
            continue
        levels[MAX_ZOOM][(x, y)] = tile
    print(f"  {len(levels[MAX_ZOOM])} non-empty at zoom {MAX_ZOOM}")

    for z in range(MAX_ZOOM - 1, -1, -1):
        children = levels[z + 1]
        parents: dict[tuple[int, int], np.ndarray] = {}
        for cx, cy in children:
            parents.setdefault((cx // 2, cy // 2), None)  # type: ignore[arg-type]
        for key in list(parents):
            tile = downsample(children, *key)
            if tile is not None and tile.max() > 0:
                parents[key] = tile
            else:
                del parents[key]
        levels[z] = parents  # type: ignore[assignment]
        print(f"  zoom {z}: {len(parents)} tiles")

    args.out.mkdir(parents=True, exist_ok=True)
    blob_path = args.out / f"{args.name}.bin"
    index_path = args.out / f"{args.name}.json"

    index: dict[str, list[int]] = {}
    offset = 0
    digest = hashlib.sha256()
    with blob_path.open("wb") as blob:
        for z in range(0, MAX_ZOOM + 1):
            for (x, y), tile in sorted(levels[z].items()):
                data = encode(tile)
                blob.write(data)
                digest.update(data)
                index[f"{z}/{x}/{y}"] = [offset, len(data)]
                offset += len(data)

    header = {
        "format": "tracker-light-pollution/1",
        "tileSize": TILE_SIZE,
        "maxZoom": MAX_ZOOM,
        "encoding": "rgb8-hi-lo-png",
        "unit": "nW/cm2/sr",
        "scale": 10,
        "blob": f"{args.name}.bin",
        # The blob's own checksum, so a copy served from object storage can be
        # proved identical to the one this script wrote. Tiles are emitted in a
        # fixed order from a sorted key list, so the same source produces the
        # same bytes and therefore the same digest.
        "blobSha256": digest.hexdigest(),
        "bytes": offset,
        "tiles": len(index),
        "source": {
            "product": "EOG Annual VIIRS Nighttime Lights V2.1, average, 2024",
            "resolutionArcseconds": 15,
            "citation": "Elvidge, C. D., Zhizhin, M., Ghosh, T., Hsu, F. C., & Taneja, J. (2021). "
            "Annual time series of global VIIRS nighttime lights derived from monthly averages: "
            "2012 to 2019. Remote Sensing, 13(5), 922.",
            "licence": "CC BY 4.0",
        },
        "index": index,
    }
    index_path.write_text(json.dumps(header, separators=(",", ":")))
    print(f"\nwrote {blob_path} ({offset/1e6:.1f} MB, {len(index)} tiles)")
    print(f"wrote {index_path} ({index_path.stat().st_size/1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
