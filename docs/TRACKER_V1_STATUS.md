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

---

# Weather-aware visibility — implementation status

Measured against `Tracker_Weather_Visibility_Next_Step.md`.

## Acceptance criteria

| | Criterion | Status |
|---|---|---|
| 1 | Continue with device location after permission | **Met.** |
| 2 | Find an address, campground, park or place | **Not met.** No place search. See below. |
| 3 | Pin or coordinates resolve a remote location | **Met.** Latitude/longitude entry resolves anywhere. |
| 4 | A selected place persists until explicitly changed | **Met.** Nothing re-reads the device location after the first attempt. |
| 5 | Times, ranking, visuals, conditions and reminders all use the selected location | **Partly met.** All of them use the selected location. All of them are in UTC rather than the selected place's local time. See below. |
| 6 | Changing cloud or smoke changes the window and may change the ranking | **Met**, and tested both ways. |
| 7 | Phenomenon-first, no weather dashboard | **Met.** One chip and one line; the phenomenon still owns the screen. |
| 8 | A clear interval after the peak is recommended over the peak | **Met.** This is the criterion the whole decision model exists for, and it is asserted directly. |
| 9 | Condition icon, accessible label, event-time temperature, and the time they apply to | **Met.** |
| 10 | Short, actionable, phenomenon-tied explanation | **Met.** |
| 11 | Poor conditions stay passive, no scolding | **Met**, and asserted — the action line is checked against a list of discouraging phrasings. |
| 12 | Smoke visually distinct; "clear but smoky" representable | **Met** in the model, the vocabulary and the icons. No smoke data is fetched, so nothing currently triggers it. |
| 13 | Rare events stay discoverable behind cloud | **Met.** Sky access is capped at a quarter of an item's strength, which cannot bury a rare event. |
| 14 | No exact probability | **Met.** Bands only, and a test asserts no percentage appears in the result. |
| 15 | No free-user request reaches a paid or metered provider | **Met**, enforced by the router rather than by convention, and tested. |
| 16 | Provider failure degrades to an unadjusted recommendation | **Met.** The phenomenon still ranks and the details say conditions were unavailable. |
| 17 | Still requires only location | **Met.** No weather or smoke preferences were added. |

## The identification problem

Both preferred no-fee sources require a `User-Agent` identifying the calling
application. **A browser cannot send one.** It is a forbidden header name in the
Fetch standard, so the browser discards whatever is set and sends its own.
Verified against an echo service from the app's own page:

```
fetch(url, { headers: { "User-Agent": "orbit-studio-tracker/0.2" } })
→ received: "Mozilla/5.0 (Linux; Android 14; Pixel 8) … Chrome/148"
```

The requests succeed — both APIs send permissive CORS headers and returned 200 —
so this is a terms question rather than a technical one, and it is the
operator's to answer. The clean resolution is a caching proxy, which also
satisfies the caching both providers ask for. A proxy is a server, a server is a
running cost, and the cost rule then applies. It is the same collision the
satellite and aurora requirements run into, arriving from a different direction.

Shipped as direct browser calls in the meantime, with the constraint stated in
the interface's own conditions detail rather than only here.

## Also not built

- **Place search (criterion 2).** Presets and coordinates only. Every free
  geocoder carries the same identification and rate-limit constraints as the
  weather sources, so this lands on the same proxy decision. The adapter shape
  is not yet written, so nothing is prejudged.
- **Local time (criterion 5).** Everything is UTC. Converting to the *selected*
  place's local time — not the device's — needs a coordinate-to-timezone lookup,
  which is either a vendored boundary dataset or another metered provider. This
  is the most user-visible gap in the weather step: planning a trip to Tromsø
  and reading times in UTC is a real cost.
- **Smoke.** The snapshot carries column and surface smoke, the model uses both,
  the vocabulary and icons express them, and no adapter fills them. HRRR-Smoke
  and CAMS are raw-model ingestion rather than point APIs, which is a pipeline
  rather than an adapter. Missing smoke reads as unknown, never as clean air.
- **Reminders that respond to conditions.** The calendar file is written once
  and cannot be updated when the forecast changes. Doing that needs something
  watching on the user's behalf, which is a backend, which is the cost rule
  again.

## Found by running it in a real browser

Five defects that the tests did not catch, because the tests asserted the rules
and these were all cases the rules did not reach:

1. **The recommendation pointed into the past.** The observation period runs
   sunset to sunrise, so Sydney at 03:15 local is correctly placed in the night
   that is ending — but the best moment of that night was five hours behind.
   Venus was being recommended for 17:41 the previous evening, and no forecast
   existed for it either, because forecasts do not cover the past.
2. **"Already set" and "rained off" were the same state.** Both produced no
   window, and an opportunity with no window silently fell back to advertising
   its own best moment, which is how the above surfaced. They are now different
   states with different words, and something that has set is kept in the list
   but cannot lead.
3. **The hero rule was reimplemented at the call site and broke.** Excluding
   what had already set left the interface picking "the first promotable one",
   which handed the hero to Saturn's rings while Saturn — naked eye, same band —
   sat directly beneath it. The rule now lives in one function.
4. **An unfetched forecast rendered a sun icon** beside the words "conditions
   unavailable", because the fallback reported `clear`. Absence is now its own
   state.
5. **The detail panel listed cloud cover as not taken into account**, on a page
   that visibly accounts for it. True of the meteor rate, false of the product.

Two smaller ones: the coordinate fields stayed on London while the Sydney chip
was lit, and a 1.7° Moon–Venus conjunction came out "exceptional" — the word
reserved for a total lunar eclipse, for something that happens most months.

## Where the weather numbers are weakest

- The sky-access curves and the transparency demands are judgement, fitted to
  nothing. This is exactly why the output is a band and why criterion 14 exists.
- `movedByWeather` triggers on a shift of more than half an hour, which is a
  threshold rather than a finding.
- Fog arrives from MET Norway as an area fraction and is converted to a nominal
  visibility so the shared model can read it. The conversion is a judgement in
  the adapter, and it is the only place a provider's value is reinterpreted
  rather than renamed.

## Ranking quality

There is no ground truth for "worth observing" and no audience large enough for
analytics to arbitrate. The ranking has been checked by reading its output on
real nights across four locations and a full year, and by asserting the rules
that V1 §4 states as prohibitions. It has not been validated against anyone's
actual experience of going outside, and it should not be described as though it
has.
