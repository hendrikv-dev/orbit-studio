# Changelog

All notable changes to Orbit Studio will be documented in this file.

The project uses a lightweight changelog format inspired by Keep a Changelog.

## Unreleased

### Tracker navigation and map corrections
- **Back no longer leaves Tracker.** Navigation lived in seven `useState` calls
  across three components and touched the browser's history not at all, so the
  whole application occupied one history entry: opening Upcoming, an event and
  its map and then pressing Back returned to the Orbit Studio homepage, because
  that genuinely was the previous entry. Location is now one object encoded in
  the URL, meaningful steps push entries, and Back and Forward work because they
  are the browser's own mechanism rather than an imitation of it. Filters, the
  List/Calendar mode and the calendar month are written into the current entry
  instead of pushing new ones, so returning to a list restores the list the
  reader had rather than resetting it.
- **`Open full map` did nothing.** It was wired to `onOpenFullMap={() => {}}`
  on both eclipse maps — a literal no-op behind a control that looked live. It
  now opens an expanded geographic map: a wider extent at a finer sampling step
  (19,350 cells against the card's 2,130), not the same card enlarged.
- **`View visibility map` opened the wrong tool.** On a lunar eclipse it opened
  the altitude-and-bearing chart, because the overlay chose by what geometry
  happened to exist rather than by what the control promised. The action's own
  kind now decides, and the sky chart has its own control, `Where to look`.
- **The lunar-eclipse map was drawn from a five-degree raster** of sampled
  altitudes, which rendered a smooth boundary as a staircase of blocks whose
  edges were artefacts of the sampling. It is now the real structure: the
  sub-lunar point and the cap of the Earth that can see the Moon, whose measured
  radius comes out near 89.6° once parallax and refraction are accounted for.
  Regions distinguish seeing all of it from the Moon rising or setting part-way
  through, boundaries are drawn as the horizon curves at first and last contact,
  and the reader's own circumstances quote the crossing time.
- **Aurora stopped disappearing on quiet nights.** The entry was listed only
  when the field was active, so a reader who wanted to know about aurora was
  shown nothing — indistinguishable from Tracker being unable to say. It is now
  always present where there is a dark sky, ranked below anything actually
  happening, and states the real outlook. In Upcoming, an empty aurora list
  explains the three-day forecast horizon and offers a route to tonight rather
  than reading as an absence.

### Tracker correctness pass

- **The eclipse centre line is now the shadow axis.** It was derived by
  hill-climbing on obscuration, which is invalid for exactly the eclipses it
  matters for: inside the umbra of a total eclipse obscuration is 1 everywhere,
  a flat optimum two hundred kilometres wide, so the optimiser stopped wherever
  it happened to arrive. `shadowAxisPoint` intersects the Sun-Moon axis with the
  Earth ellipsoid and reproduces Astronomy Engine's own greatest-eclipse
  coordinates to under a metre. Path limits are measured by bisection outward
  from the axis, giving a totality band 261 km wide at greatest eclipse for
  2 August 2027 against a published 258 km.
- **"Maximum here" is no longer the start of totality.** Local circumstances
  took the first sample reaching peak obscuration, which for a total eclipse is
  second contact — up to three minutes early, on the one event people set an
  alarm for. Maximum is now the instant of least angular separation, found by
  golden section, with all four contacts by bisection and the central duration
  reported. Luxor: 6m 25s against a published 6m 23s, maximum midway between the
  contacts rather than at the first of them.
- **A stale aurora nowcast is no longer actionable.** Freshness is read from the
  product's own forecast time — fresh, ageing, stale, unavailable. Once stale,
  the outlook, the probability, the nearby suggestion and the ranking weight are
  all withdrawn rather than qualified with a warning under a confident
  recommendation. What NOAA last reported is kept in a separate field and shown
  as history.
- **The aurora card no longer labels a night "Best window".** A half-hour
  nowcast was being stretched across eight hours of astronomical darkness. The
  first metric is now the interval the source covers; darkness moves to the
  supporting line as the precondition it is.
- **Weather for aurora is sampled at the moment being assessed**, not at the
  start of darkness.
- **The aurora ranking transformation is declared as Tracker's.**
  `auroraRankingStrength` replaces an inline `probability / 55` that had no
  stated reasoning and no test, while the documentation claimed NOAA's figure
  was never rescaled into a Tracker judgement. It returns `editorial: true` with
  a basis string and stated anchors.
- **List and Calendar are two renderings of one array.** They ran separate
  pipelines, so solar eclipses existed in one and not the other and the aurora
  filter could be selected in a view that could never contain one.
  `buildUpcomingEvents` is now the only place an upcoming event is created.
- **Upcoming excludes events that have finished**, judged on the end rather than
  the start so an event already under way is kept.
- **The forecast horizon has a lower bound.** `daysAhead <= 7` is satisfied by
  every negative number, so a date in the past entered the branch that looks for
  a forecast. Past events now read "Not recorded" rather than borrowing a live
  sample.
- **The smoke card is backed by a real source.** It read "Not reported"
  everywhere, permanently, while holding a quarter of the conditions row.
  Aerosol optical depth from Open-Meteo's air-quality API (CAMS) now drives it,
  quoted as magnitudes of extinction, and folded into sky access. Surface
  particulate is labelled as a ground measurement rather than as transparency.
- **One document heading per page.** The event name was a second `<h1>`
  competing with the category heading; it is an `<h2>` with unchanged styling.
- **Mobile ranked rows keep every decision variable.** They dropped the
  observing window and the visibility and kept the state label — what and
  roughly what kind, without when or whether it is worth it.
- Aurora's "not overhead" no longer reads as "not visible": strong aurora can
  show low on the horizon from outside the modelled oval, and the copy says so.
- **An expired nowcast map is drawn as history.** The words withdrew their
  conclusion and the map went on painting the same saturated oval underneath
  them. A picture is a claim, and the bright one is what a reader believes. The
  field is still shown — what NOAA last published is worth seeing — at a fifth
  of its strength, titled "Aurora nowcast — expired", with the drill-in saying
  the same thing.


- Rebuilt Tracker around one universal event page. Heading, a two-thirds hero, a one-third
  visualization slot, four condition cards and ranked rows now hold the same positions for every
  phenomenon; a phenomenon supplies content for those slots and cannot introduce a layout.
  `scripts/verify/tracker-walkthrough.mjs` measures the geometry of the aurora and eclipse pages
  against the meteor page and fails on any drift.
- Added real solar-eclipse geometry: global eclipse search, per-observer circumstances, a traced
  central line and a sampled coverage field, all computed from the ephemeris. Checked against the
  published path of the 2 August 2027 total eclipse. The mandatory solar-viewing safety notice,
  which previously had nothing to set it, is now set by every solar event.
- Added aurora from NOAA's Space Weather Prediction Center: the OVATION nowcast drawn as a regional
  forecast map, and the three-day planetary K-index for anything beyond it. The three horizons —
  nowcast, short range, and nothing at all — are kept separate and stated. Corrects the earlier
  conclusion in `docs/TRACKER_V1_STATUS.md` that aurora could not be served without a paid backend.
- Reduced Tracker's temporal navigation to Tonight and Upcoming. "Now" is gone, because Tracker
  already knows the time, and Calendar became a representation inside Upcoming rather than a fourth
  destination. Selecting any event, from either, opens the same universal page.
- Replaced the ranked cards with compact rows, moved the full sky map and the full forecast map
  behind hero actions as drill-ins, and lifted the single-screen constraint that had the
  recommendation competing with the evidence for viewport height.
- Made absent weather render as absent: a date beyond the forecast horizon reads "Forecast closer
  to date" on cloud, smoke and temperature while still answering moonlight, which is geometry.
- Fixed the Tracker wordmark rendering in its light-ground variant on the always-dark shell for
  readers whose system prefers light interfaces.

- Integrated the approved homepage into the full platform: centered-Earth Explorer and Playground previews, side-by-side environment cards, concise platform copy, factual source-access language, and a hosted-provider donation CTA controlled by `VITE_SUPPORT_URL`.
- Removed the obsolete homepage preview assets superseded by the approved captures.
- Removed ignored local-only acquisition files and obsolete intermediate historical-catalog outputs from the handoff archive; the verified source-of-truth package and active browser derivative remain.
- Simplified the platform homepage around a single “Welcome to Orbit Studio” heading, removed repeated explanatory copy, replaced the narrow image crops with wide current-app captures, and removed image hover zoom and overlay effects.
- Hardened cross-app navigation and Playground initialization: shared menu labels now remain visible in Explorer, every Playground entry starts from `Satellite 1`, and each Playground session remounts the scene to prevent stale or blank renderer state.
- Removed obsolete embedded review ZIP handoffs from the distributable tree and added maintainer and release-checklist documentation for future contributors and agents.

- Added the Orbit Studio platform homepage with approved brand assets and real app previews, plus a shared Explorer/Playground app menu and interface-visibility behavior.
- Standardized app navigation around Orbit Studio Home, Explorer, Playground, Hide interface, and GitHub; restored the active app label and removed context-dependent header actions.
- Kept Playground independent from Explorer catalog selection, retained the neutral `Satellite 1` default, and widened the initial orbital camera framing.
- Replaced the bounded GCAT sample with the verified CC BY 4.0 Orbit Studio Satellite Source of
  Truth v1.0.0 package: 69,703 source records, 1957–2026 annual history, 33,489 latest Earth members,
  deterministic generated reconstruction inputs, and one canonical SQLite authority.
- Removed the obsolete CelesTrak/local override and legacy historical-import authorities, routed
  Explorer through the complete generated GCAT web derivative, added component coverage and
  separate curated-reference provenance, and raised renderer/review regression gates to the
  canonical population.
- Refined Explorer around educational discovery collections, constellation-first exploration,
  lightweight keyboard search, progressive-disclosure details, and clearer display settings.
- Replaced speed-starved catalog propagation windows with latency-aware predictive horizons,
  preserved warm worker/geometry state across equivalent resets, made render-buffer lag observable,
  added moving-playback review coverage, prepared invariant two-body terms once per worker request,
  reserved main-thread capacity, prewarmed the maximum supported speed, invalidated staged future
  horizons on backward resets, added a bounded exact prepared-state fallback for high-speed
  replacement horizons, and clarified annual GCAT reconstruction limits.
- Established the dedicated Orbit Studio release-source boundary, pinned toolchain, CI validation,
  source-identified review artifacts, and clean-candidate verification gate.
- Prepared repository metadata, documentation, ignore rules, and license for an initial public
  GitHub release.
- Added public contribution guidance.
- Established one checksum-backed provenance inventory, generated attribution and dependency
  notices, source/deployment bundle auditing, and CI enforcement for third-party material.
- Prevented concurrent review runs from deleting or mixing deterministic evidence through an
  exclusive, tested process lock, and synchronized review actions with asynchronous panel focus
  restoration while retaining catalog provenance on every captured state.
- Removed the uncleared bundled CelesTrak current snapshot and legacy review evidence derived from
  it; added an explicit ignored local-acquisition mode and an honestly labeled public
  latest-catalog experience.
- Added reachable-history rejection for prohibited blobs and excluded evidence, corrected the
  independently verified former snapshot checksum, and added verified tracked-`HEAD` source
  archive generation so private working-directory files cannot enter a release package.

## 0.2.3

- Isolated Explorer and Playground into separate simulation-store instances.
- Prevented Explorer catalog objects from appearing in Playground without an explicit future import workflow.
- Added Safari page-restoration repair and Playground isolation regression coverage.
