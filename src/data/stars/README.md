# Orbit Studio star catalog

`hygBrightStars.v41.json` is generated from the HYG Database v4.1 `hyg/CURRENT/hygdata_v41.csv` file.

- Source: HYG Database v4.1 by David Nash, assembled from Hipparcos, Yale Bright Star, and Gliese source catalogs.
- Selection: every non-Sun row with apparent visual magnitude `mag <= 5.1`; no synthetic filler is added.
- Reference frame and epoch: J2000 mean equator and equinox (EQJ), epoch J2000.0.
- Stored fields: HYG identifier, Hipparcos identifier when available, name, J2000 right ascension/declination, apparent magnitude, B-V color index, Cartesian position and space velocity, and constellation abbreviation.
- Runtime update: Cartesian position is advanced by the catalog space velocity from J2000.0 to the selected UTC-derived Julian epoch, then normalized. This retains proper motion from the HYG source without changing the inertial EQJ frame.
- Generation: run `node scripts/build-hyg-bright-stars.mjs /path/to/hygdata_v41.csv`.

HYG data is distributed separately under Creative Commons Attribution-ShareAlike 4.0 International. See `LICENSE-CC-BY-SA-4.0.txt` and preserve attribution when redistributing the generated file.
