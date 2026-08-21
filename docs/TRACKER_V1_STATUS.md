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
| **A6** | Aurora near the horizon | **Met, within the only horizon that exists.** NOAA's OVATION nowcast and three-day planetary K-index are read directly from the SWPC public endpoints, and aurora is ranked, mapped and explained like any other phenomenon. What is not offered is a long-range aurora forecast, because no such product exists anywhere. See below. |
| **A7** | Weak night | **Met.** On a night with nothing strong the hero is either an honest ordinary target or empty; there is no floor-filling promotion, and the empty state says so plainly. |
| **A8** | Paid service boundary | **Met, trivially.** Everything is computed on the device. There is no account, no backend and no request of any kind, so no user can receive a service that costs anything. The reminder path is a calendar file generated in the browser. |

## Aurora: built, and the earlier reasoning corrected

This document previously recorded aurora as unbuildable, on the grounds that a
nowcast needs a feed, a feed needs a caching proxy, and a proxy is a backend
somebody pays for. **That reasoning was wrong for aurora**, and the correction is
worth stating plainly because it was load-bearing.

NOAA's Space Weather Prediction Center publishes the OVATION aurora nowcast and
the planetary K-index as static JSON on a public CDN, with
`access-control-allow-origin: *` and a one-minute cache header, as works of the
United States government in the public domain. There is no key, no registration,
no rate agreement and no identification requirement — the constraint that makes
the *weather* providers awkward does not apply here. A browser fetches them
directly at no cost to anybody, which is what Tracker now does.

What is built is exactly what those products support, in three separated bands:

- **Nowcast.** NOAA's own probability of visible aurora at the observer's
  location, drawn as a regional map with the observer marked, and labelled with
  its issue time. Valid for roughly half an hour.
- **Short range.** The three-day K-index forecast, which supports "a G2 storm is
  forecast for Thursday night" and nothing spatial.
- **Beyond three days.** Nothing. The interface says so.

The one honest gap is imagery: there is no rights-cleared aurora photograph in
the asset set, so the aurora hero is a drawing whose intensity comes from the
same nowcast figure the page quotes, labelled as a forecast visualisation.

## The Confirmed requirement that is still not met

**Satellite and ISS passes (§7.1).** A pass prediction needs orbital elements no
more than a few hours old. The two sources are CelesTrak, whose terms require a
caching proxy and forbid direct browser fetching at scale, and Space-Track,
which prohibits redistribution to third parties. Both routes require a backend,
and a backend costs money — which collides with §10's rule that anything costing
the developer money is available only to a paying user. That remains a product
decision rather than an implementation one.

Nothing has been faked in the meantime. There is no placeholder pass list,
because §11 forbids presenting a fallback as a current observation.

## Also not built

- **Comets, Milky Way and zodiacal light** (§7.5). No brightness model and no
  event source for any of them.
- **Push, email and SMS reminders** (§10). Calendar export is the free path;
  everything else costs per message.

## Since built

- **Eclipses of the Sun** (§7.5). Global eclipse search, per-observer
  circumstances, a traced central line and a sampled coverage field, all from the
  ephemeris rather than from a published map. The §9 safety mechanism — which
  existed with nothing setting it — is now set by every solar event, and renders
  above all other guidance, unsuppressed.
- **Tonight and Upcoming** as the two time perspectives (§3), with Calendar as a
  representation inside Upcoming rather than a fourth destination. "Now" was
  removed: Tracker already knows the time, and asking the reader to choose
  between Now and Tonight was asking them to do the product's job.

## Where the numbers are weakest

Ranked by how much they could mislead someone:

0. **Aurora is a forecast, not a computation, and a short one.** Everything else
   in Tracker is as good a century out as it is tonight. The aurora nowcast is
   good for about half an hour and the K-index for three days, and the interface
   states which of the two it is using every time it speaks.
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

---

# Presentation rebuild — implementation status

The calculations were not touched. The ranking, the meteor model, the weather
decision model, the centralised selection rules and the two deliberately
unresolved provenance entries are all as they were; what changed is what the
reader meets first.

## Acceptance gate

| | Requirement | Status |
|---|---|---|
| 1 | First screen dominated by phenomenon-specific imagery | **Met.** Full-bleed scene per phenomenon, distinct for meteors, Moon, eclipse, each planet, conjunctions and a plain night sky. |
| 2 | A nontechnical reader understands the action in five seconds | **Met.** "Saturn / Best chance 12:30–4:45 AM / Clear · 78°F / Face south. A minute to find it. No equipment needed." |
| 3 | Primary times local, not UTC | **Met**, with one caveat below. |
| 4 | Current location and address/campsite selection | **Met.** Device location, and a search that finds campgrounds, parks and trailheads, with a coordinate pin as the remote fallback. |
| 5 | Condition iconography and event-time temperature | **Met.** Seven states plus an explicit unknown, each a different glyph shape. |
| 6 | Image-led, visually distinct ranked cards | **Met.** |
| 7 | Chart and coordinates no longer dominant | **Met.** Both are behind "How this was worked out". |
| 8 | No infrastructure explanation in the interface | **Met.** The server-cost paragraph is gone from the page; it survives here and in provenance. |
| 9 | Full desktop viewport used intentionally | **Met.** The scene takes the width; the panel is a column over its left at ≥900px. |
| 10 | Feels like an invitation | Judgement, not a check — but "The orange one. Obviously coloured once you spot it, even from a city." is the register throughout. |

## Imagery: licensed photography

The hero and card imagery is photography, sourced under licences that permit
this use and registered with verified rights. An earlier version drew every
scene as vector art; that was honest and it was flat, and a product whose whole
purpose is to get somebody outside cannot afford to look like a diagram.

| Scene | Photograph | Credit | Licence |
|---|---|---|---|
| Meteors, welcome | The 2010 Perseids over the VLT | ESO/S. Guisard | CC BY 4.0 |
| Lunar eclipse | Eclipsed Moon at Paranal | Y. Beletsky (LCO)/ESO | CC BY 4.0 |
| Conjunctions, Venus, default | Spheres on Spheres | Y. Beletsky (LCO)/ESO | CC BY 4.0 |
| Saturn | Latest Saturn Portrait | NASA, ESA, A. Simon (GSFC), M. H. Wong (UC Berkeley) | CC BY 4.0 |
| Jupiter | Jupiter and Europa, August 2020 | NASA, ESA, A. Simon, M. H. Wong and the OPAL team | CC BY 4.0 |
| Mars | Mars in opposition 2016 | NASA, ESA, Hubble Heritage Team (STScI/AURA), J. Bell, M. Wolff | CC BY 4.0 |
| The Moon | NASA LROC WAC mosaic, lit for tonight's phase | NASA's Scientific Visualization Studio | NASA media guidelines |

ESO and ESA/Hubble both release their public images under CC BY 4.0 as a
blanket policy. Total weight of the seven images is 428 KB.

**The credit is rendered on the image, and that is a licence term rather than a
design choice.** Both publishers require it to be presented clearly and visibly
and not hidden or separated from the material, so it cannot move behind a
disclosure control.

The Moon is the one composite, and deliberately so: a stock photograph of a full
Moon on a night the Moon is a crescent is a lie the reader can check by looking
up. It draws the real LROC surface with tonight's actual terminator over it.

**The honesty problem a beautiful photograph creates** is handled by the same
classification system as before, now doing more work. A Hubble portrait of
Saturn is the exact case the specification warns about, so it is labelled a
space-telescope image and carries the sentence that says a garden telescope
shows a small pale oval. The picture may be beautiful; the expectation has to be
true.

Two treatments, because the two kinds of picture behave differently in a frame:
a landscape under the sky fills it, and a planet on black must not be cropped or
Saturn loses its rings — so it floats on a dark ground, screen-blended so the
black field disappears into it.

## Local time is now exact

Resolved from coordinates to an IANA zone with `@photostructure/tz-lookup`
(CC0, ~73 KB), so `Intl` handles daylight saving and every political oddity.

This closes what was recorded here as a known defect. The offset used to be
derived from longitude — how zones were laid out, not how they ended up — and
was wrong wherever politics beat geography. Asserted against the exact cases
that failed:

| Place | Zone | Was |
|---|---|---|
| Mumbai | `Asia/Kolkata` | half an hour out |
| Madrid | `Europe/Madrid` | an hour out |
| Leeds, London | `Europe/London` | no daylight saving |
| Joshua Tree | `America/Los_Angeles` | no daylight saving |
| Tromsø, Sydney | `Europe/Oslo`, `Australia/Sydney` | — |

The dataset is lossily compressed, so a point within a few hundred metres of a
zone boundary can resolve to its neighbour. Where no zone is recorded at all the
longitude fallback remains, flagged approximate in the detail.

## Found by looking, during this phase

- The scene was drawn in a square viewBox, so its intrinsic aspect ratio made
  the hero **1792 pixels tall** on a wide screen, pushed every word below the
  fold and rendered the stars as coin-sized discs.
- The Moon's terminator sweep flags were inverted: a four-day-old crescent drew
  as a gibbous, directly under a caption reading "a waxing crescent". Now
  asserted for all four cases, and still the one composite in the set.
- The first crop of the Perseid photograph cut out the meteor — the one thing
  the picture is named for.
- The Hubble portraits are objects on a black field, so a plain image put a
  visible black rectangle inside every card until they were screen-blended.
- The credit was positioned against the hero rather than the picture, so it
  floated over the copy the moment the phone layout stopped overlaying them.
- Overlaying the panel on the image works on a desktop and fails on a phone,
  where the panel is most of the viewport and the subject ended up behind the
  headline. The phone layout stacks instead.
- Consolidating Saturn and Saturn's rings into one card raised planet spectacle
  enough to call Jupiter on an ordinary March evening "exceptional" — caught by
  a test written in the previous phase for exactly that overclaiming.
- The browser offered the reader's own saved postal address in the place search.

---

# Location onboarding — the reported failure, and what it was

Both halves were reproduced in the production build in Chrome before anything
was changed, and both had a single cause each.

## A full street address returned "Nothing found"

`geocoding.ts` kept only results carrying a `name`. **A street address has no
name** — Photon returns houses with `housenumber` and `street` and nothing else.

Measured against the live API:

| Query | Photon returned | The filter kept | The interface said |
|---|---|---|---|
| `16 Ash Grove, Leeds` | 2 correct houses | 0 | "Nothing found" |
| `1247 Elmwood Avenue, Buffalo` | 8 | 8, all nearby *named* POIs | the wrong place |

That one filter produced both reported symptoms: the empty state, and the
resolution to something near the address instead of the address. Results are now
labelled from `housenumber` + `street` where there is no name, tagged
**Address**, and carry the postcode so two close matches can be told apart. A
query beginning with a house number is treated as an address lookup, so the
observer-category boost can no longer float a park above the address typed.

## "Use my current location" did nothing

The permission was already `denied` in this Chrome. **Chrome does not re-prompt
after a block**, so `getCurrentPosition` invoked its error callback immediately;
the single error path set the state to denied, which is what it already was; and
nothing changed on screen. The button was not broken so much as mute.

`src/lib/geolocation.ts` now separates the states and, crucially, asks the
Permissions API *before* asking for a position — so a browser that cannot prompt
says so instead of pretending a request is about to happen.

| State | What the reader gets |
|---|---|
| Prompting | "Waiting for your browser…", control disabled |
| Locating | "Finding you…", control disabled |
| Granted | The place, its accuracy and its coordinates, to confirm |
| Denied | Named steps for **this** browser, plus the search leading the panel |
| Unavailable | Says it is the device, offers Try again |
| Timeout | Says it took too long, offers Try again |
| Unsupported | Says why, including an insecure page |

Recovery text is per browser because the control is somewhere different in each
and is not in the page at all. Where the browser has blocked the site, the
search field moves to the top of the panel: leading with a control that cannot
work, above three paragraphs explaining why, is what made the original feel
broken.

## The selected place is now confirmed

Nothing is computed until the reader agrees. Choosing a result shows its name,
context and coordinates with **Yes, use this** / **Choose another**. A geocoder
returns what is near what was typed; only the reader knows whether that is where
they will be standing, and the silent wrong-place resolution is exactly what was
reported.

## Found while verifying, not by tests

- The panel opened downward from a trigger low in the hero, putting its own
  results below the fold with nothing able to scroll to them. It opens upward
  there now and is height-capped everywhere.
- With no viewing window at all — the case where the weather is *worst* — the
  conclusion sentence was built from an empty condition label and read
  "Excellent in itself, but skies make it a gamble".
- Fixing that exposed the next layer: `Rain or snow` is written to sit beside a
  temperature and reads as nonsense with a noun after it. Conditions now carry a
  separate noun phrase for sentences.

## What was verified how

The denied path was exercised against this Chrome's real blocked permission.
Prompting, locating, granted, timeout and unavailable were driven through the
real interface with the browser API stubbed, because a browser will not produce
a timeout or a hardware failure on request, and the permission cannot be reset
from the page.

---

# UX audit, and what was done about it

Audited with axe-core 4.10.2 in the production build, plus DOM and CSS
introspection for the things automated checks cannot infer. Worth recording that
axe found only one violation type on its own: custom widgets defeat automated
checking, and the most serious problems below are the ones it could not see.

## What was wrong

**The place picker was not operable without a mouse.** No combobox role, no
accessible name (the placeholder was doing that job, which it cannot), no
`aria-expanded` or `aria-activedescendant`, results appearing with no live
region, no arrow-key navigation, Escape doing nothing. WCAG 4.1.2, 2.1.1, 2.4.3.

**No focus indicator on the ranked cards.** A global input reset had set
`outline: none` and nothing replaced it. WCAG 2.4.7.

**Six colour-contrast violations**, all from `opacity: 0.62` on "already set"
cards: body text at 4.39:1 and the time at 3.28:1 against 4.5:1. WCAG 1.4.3.

**No async state at all** — a ~300 ms assertion of "Conditions unavailable"
while the forecast was still in flight.

Plus: the image credit was a 160×12 px target (WCAG 2.5.8), reduced motion was
honoured nowhere in the tracker, there was no skip link, and every view had the
same `document.title`.

## What replaced it, rather than being written again

| Problem | Resource | Licence |
|---|---|---|
| Combobox, focus, Escape, announcements, popover placement | react-aria-components | Apache-2.0 |
| Loading, error, retry, caching | @tanstack/react-query | MIT |
| Coordinates to IANA time zone | @photostructure/tz-lookup | CC0-1.0 |
| Icons — already a dependency, 22 hand-drawn paths removed | lucide-react | ISC |

Two licences had to be added to the supported set, each with its reason
recorded: **0BSD** (tslib, under react-aria) and **CC0-1.0** (tz-lookup). Both
are more permissive than MIT, which was already allowed.

Cost: the Tracker bundle went from 40 kB to 386 kB, 129 kB gzipped. Against
Explorer's 17 MB that is affordable, and it buys onboarding that works without a
mouse and times that are right.

## Fixed in the token pass

- Focus rings on everything interactive, including React Aria's own
  `data-focus-visible` state.
- "Already set" cards de-emphasised through the image at 45% rather than the
  whole card, so text stays at full contrast. Verified by forcing the state onto
  a live card and re-running axe: zero violations.
- Credit link padded to a 149×27 target.
- `prefers-reduced-motion` and `prefers-contrast` both honoured.
- A skip link to the ranked list, and a title that names tonight's
  recommendation.

## The accessibility gate

`npm run a11y:verify` runs in CI, against the production build served by
`vite preview`. It does two different jobs, because they catch different things:

1. **axe-core** across ten states — welcome, picker open with results, place
   confirmation, recommendation, recommendation with every disclosure open, a
   ranked card forced into its "already set" styling, and the same journey again
   at phone width. States matter as much as pages: every violation the original
   audit found lived in the *loaded* view, and every picker failure lived in its
   *open* state, so checking the first screen would have passed a broken
   product.
2. **Explicit interaction assertions** on what was actually broken — combobox
   role, an accessible name that is not the placeholder, `aria-activedescendant`
   moving on arrow keys and pointing at a real option, Enter reaching the
   confirmation, Escape closing and returning focus to the trigger, and a page
   title that names the recommendation.

**Proven to fail, not just to pass.** Both original bugs were reintroduced and
the gate caught them: the `opacity: 0.62` contrast regression (3 nodes, serious)
and the missing accessible name. Worth noting which caught which — axe found the
contrast, and axe did *not* find the missing name. The explicit assertion did.
That is the argument for the second layer.

**No network.** The geocoder and forecast are stubbed at the browser level, so
the gate cannot go red because a free service had a bad afternoon, and CI puts
no traffic on services this project is a guest of. Verified by running it with
no network reachable: passes. The geocoder fixture deliberately includes a
nameless street address — the case that used to be discarded.

`MPL-2.0` had to be accepted for axe-core. Rather than widening the licence set,
the gate now distinguishes development-only licences: MPL's obligations attach
to distributing the covered files, and a package that only tests the build is
never distributed. A runtime dependency arriving under MPL-2.0 still fails.

## Still open

- The ranked list and the hero are one system, but there is no way back to the
  hero from a card except selecting it.
- Now, Upcoming and Calendar are still not built.
- Satellite passes and aurora remain absent, waiting on the server-cost
  decision, as do the three unresolved provenance entries.

## Ranking quality

There is no ground truth for "worth observing" and no audience large enough for
analytics to arbitrate. The ranking has been checked by reading its output on
real nights across four locations and a full year, and by asserting the rules
that V1 §4 states as prohibitions. It has not been validated against anyone's
actual experience of going outside, and it should not be described as though it
has.
