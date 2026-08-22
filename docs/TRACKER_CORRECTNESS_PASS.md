# Tracker correctness pass — engineering handoff

A review of the universal event interface found that the layout was right and
several of the numbers inside it were not. This records what was wrong, why it
was wrong, what each number now means, and how it was checked. The visual and
structural baseline is unchanged: nothing here moves a region, renames a page,
or alters the information architecture.

The governing rule for the whole pass: **never state more than the source or the
calculation actually supports.** A plausible-looking answer is not evidence, and
a passing unit test is not evidence when the assertion encodes the wrong idea.

---

## 1. What changed

### Eclipse geometry

| | Before | After |
|---|---|---|
| Centre line | Hill-climb on obscuration | `shadowAxisPoint` — Sun–Moon axis ∩ Earth ellipsoid |
| Path limits | Not computed; band drawn at a fixed width | `centralHalfWidthKm`, measured by bisection perpendicular to the track |
| Maximum eclipse | First sample reaching peak obscuration | Instant of least angular separation, by golden section |
| Contacts | Not reported | C1–C4 by bisection, plus central duration |

### Aurora

| | Before | After |
|---|---|---|
| Stale nowcast | Warned about, then used anyway | `auroraFreshness` → fresh / aging / stale / unavailable; stale withdraws the outlook, the probability, the nearby suggestion and the ranking weight |
| First metric | "Best window" over all of astronomical darkness | "Nowcast covers" / "Forecast for" / "Expired" — the interval the source actually covers |
| Weather sample | Taken at the start of darkness | Taken at the instant being assessed |
| Ranking weight | Inline `probability / 55` | `auroraRankingStrength`, with stated anchors and `editorial: true` |
| Outside the oval | Read as "not visible" | Says the oval is elsewhere, and stops there |

### Upcoming

| | Before | After |
|---|---|---|
| Data model | List and Calendar each generated their own events | `buildUpcomingEvents` is the single generator; both views render the same array |
| Past events | Included | Excluded on `endUtc`, so an event under way is kept |
| Forecast horizon | `daysAhead <= 7`, satisfied by every past date | Bounded at both ends; past events read "Not recorded" |

### Conditions

| | Before | After |
|---|---|---|
| Smoke card | "Not reported", permanently, in a quarter of the row | Aerosol optical depth (Open-Meteo / CAMS) as magnitudes of extinction, folded into sky access |
| Snapshot matching | Nearest sample at any distance | 90-minute limit, and a NaN guard |

### Semantics

- One `<h1>` per document: the event name is now an `<h2>`, styled identically.
- Mobile ranked rows keep the observing window and the visibility judgement.
- An expired nowcast map is drawn at a fifth strength and titled as expired, so
  the picture withdraws when the words do.

---

## 2. Root causes

**The eclipse centre line was a flat optimum.** Obscuration inside the umbra of
a total eclipse is exactly 1 across the entire band. Maximising it therefore has
no unique answer — a two-hundred-kilometre plateau — and the optimiser returned
wherever it first arrived. The result was labelled "the centre line", and a
distance to it was quoted. The failure is instructive because the output looked
correct: the point was always inside the path.

**"Maximum here" was second contact.** Local circumstances scanned samples for
the first to reach peak obscuration. For a partial eclipse that is nearly right.
For a total eclipse peak obscuration is reached at C2 and held until C3, so the
reported maximum was the *start* of totality — up to three minutes early on the
one event for which people set an alarm.

**Staleness was presented rather than obeyed.** Freshness was computed and shown,
but every downstream consumer — outlook, probability, nearby suggestion, ranking
weight — read the same fields regardless. The interface warned and then acted as
though it had not.

**"Best window" conflated two different quantities.** Astronomical darkness is
computed geometry, good for a century. The OVATION nowcast is good for about
half an hour. Labelling darkness as the aurora's best window borrowed the
certainty of the first for the second.

**Two pipelines, one promised model.** List and Calendar each built their own
events, so the two disagreed about which eclipses exist, and the category filter
offered aurora in a view that structurally could not contain one.

**A one-sided bound.** `daysAhead <= 7` is true for every negative number, so
past dates entered the branch that looks for a forecast sample and silently
borrowed a live one.

---

## 3. What each number is

The pass found three different kinds of value presented in one voice. The
distinction is now maintained in code, not only in copy.

| Kind | Examples | How it is marked |
|---|---|---|
| **Directly sourced** | NOAA probability of visible aurora; cloud cover; aerosol optical depth | Attributed to the provider by name where shown, and in the conditions caption |
| **Derived by calculation** | Eclipse contacts, axis, path width, obscuration; Moon phase and altitude; meteor rates; rise, set and culmination | Stated as computed on the device; eclipse geometry is validated against published circumstances |
| **Tracker's editorial judgement** | Ranked order; recommendation wording; aurora ranking weight; observing-quality bands | `auroraRankingStrength` returns `editorial: true` with a basis string; the ranking's gates and caps are named in `opportunity.ts` |

The specific inconsistency this table exists to prevent: `probability / 55` was
applied inline to NOAA's figure and fed into cross-phenomenon ranking, while the
documentation stated that NOAA's probability was never rescaled into a Tracker
judgement. It was. The transformation is now named, anchored, tested and
declared.

---

## 4. Verification

Run in this order, on an otherwise idle machine, against the production build.

### 1. Unit and integration tests

```
npm test
```

```
Test Files  85 passed (85)
     Tests  687 passed (687)
  Duration  120.13s
```

Exit 0.

Run as a single invocation. The previous package reported a green suite on
evidence that contained a full-suite timeout and a later isolated pass; that is
not repeated here — this is one process, one exit code.

New and changed coverage, by the defect each test exists for:

| File | Tests | What it pins |
|---|---|---|
| `solarEclipse.test.ts` | 27 | Axis against Astronomy Engine's own greatest-eclipse position to four decimals; the band centred on the axis; 2027 path width 230–285 km; maximum later than C2 by more than 60 s; on-centre, off-centre and outside-path circumstances |
| `aurora.test.ts` | 25 | The full freshness matrix, including the boundary at the grace limit; every ranking anchor and the Kp cap; that a stale grid yields no outlook, no probability and no nearby suggestion |
| `conditionCards.test.ts` | 21 | Eight horizon boundary cases either side of both ends; that a past event reads "Not recorded" rather than borrowing a sample |
| `upcomingEvents.test.ts` | 19 | One list, two renderings; that an event under way is kept and a finished one is dropped |
| `airQuality.test.ts` | 14 | Optical depth to magnitudes; the 45-minute merge tolerance; that an unmatched hour stays null rather than defaulting to clean |
| `eventPresentation.test.ts` | 13 | The first aurora metric names the source's own interval; the eclipse card quotes a central duration |

### 2. Production build

```
npm run build
```

Exit 0. `tsc --noEmit` runs first, so this is also the type check. The Tracker
entry is 491 kB (161 kB gzipped) and does not pull the 17 MB Explorer chunk —
the split that keeps Tracker loadable on a phone is intact.

### 3. Provenance and licences

```
npm run provenance:validate
npm run licenses:validate
```

Licences pass: 301 lockfile packages, digest `8bcfca5b…`.

**Provenance validation fails, and failed before this pass.** To establish that
rather than assert it, HEAD was checked out into a separate worktree, built
there, and validated:

```
git worktree add --detach /tmp/baseline HEAD && cd /tmp/baseline && npx vite build && node scripts/provenance/validate-provenance.mjs
```

Baseline: 53 failures. After this pass: **the same 53** — none added, none
resolved. They are stale recorded checksums (`package-lock.json`,
`explorerCatalog.ts`, `scenario.ts`, `geocoding.ts`, `weatherProviders.ts`),
unclassified brand and font artifacts, two unreviewed hosts in generated notice
files, and three items whose rights verification is unresolved.

Two of those are Tracker's (`tracker-place-search-adapter`,
`tracker-weather-forecast-adapters`) and are deliberately left alone: refreshing
a recorded checksum asserts that someone re-audited the content behind it, and
marking rights "verified" asserts a licence review. Neither happened here, and
rubber-stamping either would be the same category of error this pass exists to
correct.

What this pass did change in provenance:

- `src/data/tracker/aurora.ts` — its recorded checksum was refreshed, because
  this pass changed the file.
- The NOAA restriction note said the published probability "must be attributed
  to NOAA and never rescaled into a Tracker judgement", which the ranking
  contradicted. It now says any percentage shown must be NOAA's unmodified
  figure, and that a value Tracker derives from it may not be presented as a
  probability or as NOAA's — which is what the code now does.

### 4. Accessibility

```
npm run a11y:verify
```

PASS. No WCAG 2.1 AA violations across 18 states, and the place picker is
keyboard operable. States include the entry screen, the picker open, a
recommendation with all detail expanded, Upcoming as List and as Calendar,
Calendar with an event selected, three phone states, 320 CSS pixels, and
reduced motion.

### 5. Chrome, on the production build

```
npm run tracker:walkthrough
```

```
142 passed, 0 failed, 0 not applicable
```

Exit 0.

This drives the built bundle in Chromium and asserts against the live DOM. What
it covers, beyond the geometry contract:

- **Universal geometry** on every phenomenon page: the category heading, a hero
  at two thirds of the row (measured 0.683), a visualization in the fixed slot,
  exactly four condition cards, exactly three metrics, one or two pills, a
  ranked list.
- **Layout drift** — every region on the eclipse and aurora pages starts at the
  same x and has the same width as the meteor page, to the pixel
  (`28/1456`, `28/983`, `1027/457`).
- **Category parity** between List and Calendar across all seven filters, from
  one generated array.
- **The corrected eclipse path**, from inside it: seeded at Luxor, the page for
  2 August 2027 draws the measured umbral band, states 262 km, and quotes
  6m 25s of totality against a published 6m 23s and 258 km.
- **Four aurora states**, with both the feed and the clock pinned. Pinning the
  clock is what makes this a test rather than a lottery: before darkness the
  instant being assessed is outside the nowcast horizon, so the aurora card
  correctly does not exist, and the checks used to abstain depending on the hour.
- **Past events** absent from Upcoming, and the reminder `.ics` parsed rather
  than counted.

### Two defects the browser found

**One was mine, in the harness.** A check asserted that an expired nowcast does
not lead the ranking, and read the ranking *after* opening the aurora page — but
an event page puts the event you are looking at first in its own ranked list, so
it re-opened aurora and reported a defect the product did not have. Verified
directly: with an expired grid the hero is Saturn and aurora sits fourth. The
check now reads the ranking on arrival.

**One was real.** The card withdrew its conclusion in words — "Current auroral
conditions are unavailable" — while the map underneath went on painting the same
saturated oval at full strength. A picture is a claim, and the bright one is what
a reader believes. The field is still drawn, because what NOAA last published is
worth seeing, but at 0.22 opacity, titled "Aurora nowcast — expired", with the
drill-in saying the same. Both the title and the opacity are now asserted.

### Screenshots

In `screenshots/tracker-universal/`:

| File | What it shows |
|---|---|
| `04-meteors-tonight.png` | Meteors — the master layout |
| `08-eclipse-solar.png` | Partial solar eclipse from Portland — no central path, because a partial eclipse has none |
| `15-eclipse-total.png` | Total solar eclipse from Luxor — the corrected axis, the measured band, 6m 25s |
| `09-eclipse-lunar.png` | Lunar eclipse — no track drawn |
| `10-aurora-tonight.png` | Aurora, fresh nowcast |
| `14-aurora-stale.png` | Aurora, expired — the withdrawn field |
| `06-upcoming-list.png` | Upcoming as a list |
| `07-upcoming-calendar.png` | The same range as a calendar |
| `13-mobile-tonight.png` | Tonight on a phone |
| `00-layout-comparison.png` | The three phenomena side by side |


---

## 5. Known limitations

- **No aurora viewline.** OVATION gives the probability of aurora *overhead*.
  Aurora is regularly seen low on the horizon from well outside the oval. NOAA
  publishes a viewline product that answers this directly; until it is read, the
  copy says the oval is elsewhere and stops short of saying nothing is visible.
- **Light pollution is not modelled.** A city centre and a dark-sky site with
  the same forecast receive the same judgement.
- **Aerosol optical depth is a forecast**, on the same horizon as the weather,
  and CAMS resolves smoke plumes coarsely. It is quoted as extinction in
  magnitudes, which is what it means, and not as a visibility guarantee.
- **Eclipse path limits are umbral only.** The band drawn is the central path.
  Penumbral limits — where the eclipse is partial at all — are not traced.
- **The nowcast horizon makes the aurora page time-dependent.** Before darkness
  begins, the instant being assessed is hours outside the nowcast's validity, so
  Tracker falls back to the three-day K-index and offers no nowcast card. This
  is correct, and it means the aurora path cannot be exercised from an arbitrary
  location at an arbitrary hour — the browser walkthrough pins both the clock
  and the feed to reach it.
