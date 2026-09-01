# Which licence applies to what

This repository does not have one licence. It has two, plus the licences of the
third-party material it incorporates, and this file is the authority on which
applies where. `LICENSE` and `LICENSE-TRACKER` are the terms themselves; this is
the map.

## The default: MIT

Everything in this repository is offered under the MIT License in `LICENSE`
**except** the paths listed under Tracker below. That includes Orbit Studio
Explorer, Orbit Studio Playground, the shared application shell, the build and
verification tooling, and the provenance system.

## Tracker: all rights reserved

These paths are covered by `LICENSE-TRACKER` instead:

```
src/components/tracker/**
src/data/tracker/**
src/styles/tracker/**          (if present)
scripts/verify/tracker-*.mjs
scripts/build-light-pollution-tiles.py
scripts/deploy/light-pollution-archive.mjs
docs/TRACKER_*.md
docs/LIGHT_POLLUTION_DELIVERY.md
public/tracker/**
```

Tracker's styles currently live inside the shared `src/styles/app.css` rather
than in a directory of their own. That file stays under MIT: splitting a
stylesheet along a licence boundary would be a worse outcome than the ambiguity
it removes, and the rules in it are not the part of Tracker worth reserving.

## What this does not do

**It does not relicense anything already published.** Versions of these files
published under the MIT License remain available under the MIT License, on the
terms they were published under, at the commits where they were published.
Nothing here withdraws a permission already granted. This licence change is not
retroactive: the boundary applies from the commit that introduced this file
forward.

**It does not touch third-party material.** Everything Orbit Studio
incorporates keeps its own licence and its own required attribution, whatever
directory it sits in. `THIRD_PARTY_NOTICES.md` lists the dependencies,
`ATTRIBUTION.md` and `provenance/inventory.json` cover the data and imagery, and
none of that is affected by anything in this file. In particular, the map tiles,
the terrain, the VIIRS night-lights archive, the photography and the astronomy
library are all governed by their own terms and must keep their credit lines
wherever Tracker displays them.

**It does not change how the product presents itself.** Explorer and Playground
are open source and say so. Tracker is presented as Tracker — with no badge, no
"proprietary" label, and no marketing built around the distinction.

## Copyright

Copyright © 2026 Hendrik Verweij, who is the sole author of the code in this
repository at the time of writing. The MIT header names "Orbit Studio
contributors" because a project that accepts contributions should; it does not
imply that any third party holds copyright in the Tracker code covered here.
