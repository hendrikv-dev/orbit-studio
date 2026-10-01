# BSC5P bright-star runtime catalogue

`bsc5pBrightStars.json` is a deterministic, magnitude-bearing subset of the
Yale Bright Star Catalog, 5th Revised Edition (Preliminary), acquired from
NASA/GSFC HEASARC's `bsc5p` table.

- Catalogue: Hoffleit & Warren (1991), V/50, 9,110 records.
- HEASARC table: <https://heasarc.gsfc.nasa.gov/W3Browse/catalog/bsc5p.html>
- Acquisition service: <https://heasarc.gsfc.nasa.gov/FTP/heasarc/software/web_batch/browse_extract.pl>
- Retrieved: 2026-09-30.
- Query fields: `name,ra,dec,vmag,bv_color,pmra,pmdec,alt_name`; no positional filter.
- Raw extract SHA-256: `4b7e89fc0f18103683db2f8e66cd2de597b1912d7469f6d44f295c290f4fc1a0`.
- Selection: all rows with a reported visual magnitude `V <= 6.5`. Fourteen rows without a
  reported visual magnitude and 692 fainter rows are excluded, leaving 8,404 stars.
- Runtime output SHA-256: `529702e4a4fdedce2c98c1974f9a35cfdee4a0b33ff83a9c3d1373e6c40ae384`.
- Stored fields: HR identifier, a deliberately small IAU major-name crosswalk, catalogue
  designation, J2000 RA/Dec, V magnitude, B−V colour, proper motion, and computed IAU
  constellation symbol.
- Generation: `node scripts/build-bsc5p-bright-stars.mjs --input /path/to/heasarc-bsc5p.txt`.

Coordinates are advanced from J2000 using the reported annual proper motions, then transformed
through Astronomy Engine for the selected UTC instant and observer. The model does not add
parallax, radial velocity, or a synthetic star population. Production Sky derives luminance from
V magnitude and restrained colour from B−V.

## Use basis

HEASARC's official data policy says its materials are available freely for use and requests an
acknowledgement when the service contributes materially:
<https://heasarc.gsfc.nasa.gov/docs/heasarc/data_policy.html>. The BSC5P table page declares no
additional restriction or share-alike/copyleft term. This is the repository's recorded
commercial-use basis; it is not represented as an SPDX software license. See
`SOURCE-USE-NOTICE.txt` for the local notice and requested acknowledgement.

The 26 common names used for selective labels are the standard names published by the IAU Working
Group on Star Names. They are a hand-curated identity crosswalk only; all astrometry and photometry
comes from BSC5P.
