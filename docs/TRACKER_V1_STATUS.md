# Tracker V1 — implementation status

Measured against `TRACKER_V1_PRD.md`, which is the authority. That document is
kept verbatim as received; this one records what has been built against it and,
more usefully, what has not.

## Acceptance criteria

| | Criterion | Status |
|---|---|---|
| **A1** | Zero-input launch | **Met.** Geolocation is requested once on arrival; a refusal falls through to presets and manual coordinates on the same screen. Nothing is asked about equipment, camping, interests or experience. |
| **A2** | Dark-location behaviour | **Partly met.** Ranking responds to *astronomical* darkness — latitude, season, Moon, twilight depth — with no mode to select. It does not respond to light pollution, because no light-pollution dataset ships. A city and a campsite at the same latitude currently rank identically, which is the half of A2 that is missing. |
| **A3** | Telescope opportunity | **Met.** Saturn's rings and Jupiter's moons appear with the requirement marked in the ranked list itself, before the user opens anything. Selecting one gives general guidance. No instrument is assumed and none is asked for. |
| **A4** | Immediate satellite pass | **Not met.** No satellite passes. See below. |
| **A5** | Meteor season | **Met.** Every active shower plus the sporadic background, combined into a rate for the observer's own sky, with a chart of how it changes across the night and a recommended time. The zenithal hourly rate is never presented as a personal count. |
| **A6** | Aurora near the horizon | **Not met.** No aurora. See below. |
| **A7** | Weak night | **Met.** On a night with nothing strong the hero is either an honest ordinary target or empty; there is no floor-filling promotion, and the empty state says so plainly. |
| **A8** | Paid service boundary | **Met, trivially.** Everything is computed on the device. There is no account, no backend and no request of any kind, so no user can receive a service that costs anything. The reminder path is a calendar file generated in the browser. |

## The two Confirmed requirements that are not met

**Satellite and ISS passes (§7.1) and aurora (§7.3).** Both are Confirmed V1 in
the PRD. Neither is built, and neither can be built from what ships in the
bundle:

- A pass prediction needs orbital elements no more than a few hours old. The two
  sources are CelesTrak, whose terms require a caching proxy and forbid direct
  browser fetching at scale, and Space-Track, which prohibits redistribution to
  third parties. Both routes therefore require a backend.
- Aurora needs a nowcast — NOAA's OVATION product refreshes every five minutes
  and has a useful horizon of thirty to ninety minutes. Nothing about tonight's
  aurora can be computed from geometry.

That collides with §10's cost rule, which is the thing worth a decision rather
than a workaround: **a backend costs money, and the cost rule says anything that
costs the developer money is available only to a paying user.** So the two
phenomena the PRD is most specific about are the two that cannot be free. The
options are to serve them only to paying users, to accept a fixed unmonetised
cost, or to defer them — and that is a product decision, not one to be settled
by an implementation choice.

Nothing has been faked in the meantime. There is no placeholder pass list and no
seasonal aurora likelihood standing in for a nowcast, because §11 forbids
presenting a fallback as a current observation.

## Also not built

- **Now, Upcoming and Calendar** as distinct time perspectives (§3). Tonight is
  built and is the flagship; a date control reaches other nights. The navigation
  model between them is listed as an open decision, so nothing was invented.
- **Eclipses of the Sun**, comets, Milky Way and zodiacal light (§7.5). Lunar
  eclipses are in. The safety mechanism required by §9 for solar viewing exists
  and renders above all other guidance, unsuppressed, but nothing currently sets
  it — the first solar event added must.
- **Push, email and SMS reminders** (§10). Calendar export is the free path;
  everything else costs per message.

## Where the numbers are weakest

Ranked by how much they could mislead someone:

1. **Light pollution is not modelled at all.** The meteor rate is a ceiling for a
   genuinely dark sky. A suburban observer will see a fraction of it. This is
   stated in the interface as a missing input rather than assumed away, but it is
   the largest gap between the estimate and any particular evening.
2. **Cloud is not modelled.** Same treatment, same reason.
3. **Peak widths in the shower catalogue are editorial**, not IMO values, and are
   labelled as such in `src/data/tracker/meteorShowers.ts`. They were tuned so
   the activity profile reproduces the published curves; that tuning is the
   evidence for them, and it is not the same as a source.
4. **The moonlight and twilight penalties are calibrations**, fitted to stated
   anchors rather than taken from a published photometric model. The anchors are
   asserted in the tests so a later change has to face them.
5. **Rights for the meteor dataset are unregistered.** The parameters were
   transcribed rather than retrieved, so there is no upstream artifact to
   checksum and no licence was read. `provenance/inventory.json` records this as
   `unresolved`, and provenance validation fails on it deliberately. Resolving it
   means retrieving the IAU MDC and IMO lists from their publication URLs under
   their stated terms.

## Ranking quality

There is no ground truth for "worth observing" and no audience large enough for
analytics to arbitrate. The ranking has been checked by reading its output on
real nights across four locations and a full year, and by asserting the rules
that V1 §4 states as prohibitions. It has not been validated against anyone's
actual experience of going outside, and it should not be described as though it
has.
