# Tracker media inventory

Status: Phase 2 inventory, 2026-08-20. The machine-readable source, licence,
processing, checksum, and release record remains `provenance/inventory.json`.
This document records the product meaning of each asset; it does not replace
that provenance authority.

## Media claims

- **Representative** illustrates a kind of phenomenon. It may be another date,
  location, or occurrence and must not imply the observer's present sky.
- **Historical/event-specific** is tied to a named past occurrence, with its
  capture date and source where known. It remains historical, never live.
- **Live** is reserved for a functioning current feed with an identified
  provider, location, status, timestamp semantics, and usage basis. Tracker has
  no live media in Phase 2.

The implementation separately records origin (`historical-capture`,
`current-model`, or `live-feed`) and expected visual mode (`naked-eye`,
`binoculars`, `telescope`, `long-exposure`, or `processed`). A current model is
not a live camera.

## Shipping inventory

| Phenomenon / use | Asset | Claim and origin | Source / creator | Licence or usage basis | Expected visual mode | Appropriateness and remaining need |
| --- | --- | --- | --- | --- | --- | --- |
| Meteors, still | `public/sky/eso-potw1033a-perseid-in-a-dark-sky.webp` | Representative; historical capture (2010) | ESO release `potw1033a`; S. Guisard | CC BY 4.0 | Long exposure | Appropriate with the rendered warning that a town shows fewer stars and a meteor lasts about a second. A dated still of the active occurrence is not available. |
| Meteors, motion | `public/media/perseids-realtime-bautsch-cc0.webm` and poster | Representative; historical capture (2020-08-12) | Bautsch, Wikimedia Commons, `Perseiden.Echtzeit.2020-08-12.webm` | CC0 1.0 | Naked-eye / natural-speed footage | Appropriate as historical representative footage. “Echtzeit” describes natural playback speed in the source filename; it is not a current feed. UI and alt text say historical, never live or tonight. No other verified shower motion is shipped. |
| Moon / Venus pairing and Venus fallback | `public/sky/eso-potw2031a-moon-and-venus-at-dusk.webp` | Representative; historical capture (2020) | ESO release `potw2031a`; Y. Beletsky (LCO)/ESO | CC BY 4.0 | Naked eye, photographed with enhanced twilight colour | Appropriate for pairings and Venus when the explicit eye-expectation sentence is present. It is not used for a generic quiet night. Other conjunction geometries need their own future representative assets. |
| Quiet clear-night fallback | `public/sky/eso-potw1033a-night-sky-detail.webp` | Representative; historical capture (2010) | ESO release `potw1033a`; S. Guisard | CC BY 4.0 | Long exposure | Appropriate only as a general clear-sky example with location/light-pollution caveat. It replaces the misleading Moon–Venus fallback. |
| Lunar eclipse | `public/sky/eso-potw2136a-eclipsed-moon-at-paranal.webp` | Representative; historical capture (2021) | ESO release `potw2136a`; Y. Beletsky (LCO)/ESO | CC BY 4.0 | Long exposure | Appropriate with the rendered note that the eye sees a dimmer, browner Moon. No event-specific image for a future eclipse is implied. |
| Current lunar phase composite | `public/moon/nasa-lroc-color-1k.jpg` plus `TrackerScene` phase mask | Event-specific model; current model | NASA SVS CGI Moon Kit; Ernie Wright (USRA), Noah Petro (NASA/GSFC), LROC WAC data from ASU | NASA Images and Media Usage Guidelines | Binoculars | Appropriate: the real mosaic is shaded with the recommendation's actual phase geometry. It is a model, not a live or local photograph. The UI explains naked-eye detail limits. |
| Saturn | `public/sky/esahubble-heic1917a-saturn.webp` | Representative; historical capture (2019) | NASA/ESA Hubble; A. Simon and M. H. Wong | CC BY 4.0 | Processed space-telescope image | Appropriate only with the rendered telescope-image label and eye/garden-telescope comparison. A realistic small-aperture eyepiece reference remains desirable. |
| Jupiter | `public/sky/esahubble-heic2017a-jupiter-and-europa.webp` | Representative; historical capture (2020) | NASA/ESA Hubble; A. Simon, M. H. Wong, OPAL team | CC BY 4.0 | Processed space-telescope image | Appropriate with the rendered naked-eye/binocular/telescope distinction. A realistic small-aperture eyepiece reference remains desirable. |
| Mars | `public/sky/esahubble-heic1609a-mars.webp` | Representative; historical capture (2016) | NASA/ESA Hubble; Hubble Heritage Team, J. Bell, M. Wolff | CC BY 4.0 | Processed space-telescope image | Appropriate with the rendered explanation that the eye sees an orange point and a garden telescope a small disc. A realistic small-aperture eyepiece reference remains desirable. |

Every third-party image retains a visible per-image credit and its source link.
The source crops, conversions, and exact checksums are recorded in
`provenance/inventory.json` under `eso-night-sky-photography`,
`esa-hubble-planetary-photography`, `wikimedia-perseid-realtime-footage`, and
`nasa-svs-lroc-color-moon-1k`.

## Category coverage and gaps

| Category | Planning support | Media status |
| --- | --- | --- |
| Meteors | Supported | Still and one verified historical natural-speed Perseid clip. |
| Moon | Supported | Event-specific current phase model plus representative eclipse photography. |
| Planets | Supported | Representative processed Hubble portraits for Mars, Jupiter, Saturn; Venus uses a representative naked-eye pairing. Other modeled planets use the honest clear-night fallback. |
| Conjunctions / pairings | Supported | One representative Moon–Venus photograph; not event-specific. |
| Lunar eclipses | Supported subset | Representative historical eclipse photograph. |
| Aurora | Not yet supported | No selectable category and no media shipped. |
| Comets | Not yet supported | No selectable category and no media shipped. |
| Occultations | Not yet supported | No selectable category and no media shipped. |
| Satellites / ISS | Not yet supported | No selectable category, tracking promise, or media shipped. |

## Live feeds

No live-feed research or integration was performed in Phase 2. Live cameras are
optional, and adding one without event/location coupling, reliable status and
timestamp semantics, uptime behavior, and a verified redistribution/embedding
basis would make Tracker less truthful. Candidate research remains a separate,
explicitly scoped task; Tracker does not scrape or silently proxy third-party
camera feeds.
