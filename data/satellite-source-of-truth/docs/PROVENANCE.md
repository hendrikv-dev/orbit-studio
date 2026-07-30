# Provenance and Licensing

## Upstream authority

General Catalog of Artificial Space Objects (GCAT)  
Author: Jonathan C. McDowell  
Homepage: https://planet4589.org/space/gcat/  
Snapshot endpoint: https://planet4589.org/space/gcat/tsv/cat/satcat.tsv  
License: Creative Commons Attribution 4.0 International (CC BY 4.0)

Required attribution:

> Data from GCAT (J. McDowell, planet4589.org/space/gcat)

The immutable source snapshot in this package preserves the upstream header and update timestamp.

## Transformations

The package:

- preserves the full raw GCAT `satcat` TSV;
- normalizes identifiers, dates, numeric values, and object classes;
- preserves raw date strings and uncertainty markers;
- derives year-by-year membership from appearance/separation and descent years;
- derives deterministic orbital angles from JCAT identifiers;
- computes semi-major axis, eccentricity, and approximate period from source-backed perigee/apogee;
- records all transformations and checksums.

## Excluded sources

No CelesTrak snapshot or Space-Track response is included. Those sources are not required for this package and are not permitted to replace its bundled authority without a separate rights and provenance review.

## Accuracy boundary

GCAT's catalog membership and supplied fields are source-backed. Deterministic reconstruction fields are project-authored educational derivatives. They are not observational ephemerides and must remain labeled accordingly.
