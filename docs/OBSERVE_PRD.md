# Observe — Product Requirements

## Status and authority

Draft for implementation planning. Subordinate to `ORBIT_CONSTITUTION.md`; where this
document and the Constitution disagree, the Constitution wins. Written after the
feasibility spike (`?spike=observe`, commit `f8d389d`), and several requirements below
exist because that spike contradicted an earlier estimate.

Observe is the third Orbit Studio environment, alongside Explorer and Playground. It is
not yet built. Nothing here authorises the live-data phases; those have their own gates.

---

## 1. What Observe is for

**Given my location and time, identify and rank the celestial events actually worth
observing, explain why, and communicate how reliable that assessment is.**

That sentence is the product. Eclipses, Moon phases, planetary positions and meteor
showers are *inputs to it*, not the deliverable. A view that lists what is happening,
sorted by date, is a calendar; several free products already do that well and Orbit
Studio has no reason to build another.

The primary surface is therefore a ranked list:

```
Worth observing
1. Total lunar eclipse ............... Exceptional
2. Perseids .......................... Very good
3. Jupiter–Moon conjunction .......... Fair
```

Opening an entry explains the ranking — maximum altitude, darkness, Moon interference,
expected brightness or activity, duration, viewing direction, rarity. **The explanation
is not a detail view; it is the second half of the product.** A rank without a reason is
an opinion.

### Differentiation

Orbit Studio cannot win on event coverage. Stellarium, Time and Date, Sky Tonight and
others are mature, free, and comprehensive. Two things are genuinely underserved and both
are things this codebase is already unusually good at:

1. **Explaining why something is observable** — why a radiant climbing matters, why this
   object never rises from your latitude, why tonight is better than tomorrow.
2. **Stating how much to trust each claim** — the difference between an eclipse computed
   to the second and an aurora forecast good for ninety minutes.

If a phase of work does not advance one of those two, it is not advancing Observe.

---

## 2. Why this is an environment and not a feature

Explorer and Playground are divided by the epistemic status of their content: Explorer is
what is and was real, Playground is what is deliberately hypothetical. Neither contract
can hold forecast data.

- Explorer's rule — never present hypothetical simulation as historical reality — forbids
  an aurora forecast outright.
- Playground's rule — everything here is invented — misrepresents it in the other
  direction.

A model prediction with irreducible uncertainty is a third category, and it needs a home
whose contract is built around uncertainty rather than one that tolerates it. That is the
argument for Observe, and it carries a consequence: **uncertainty communication is
Observe's organising principle, not a feature within it.**

Deterministic content — eclipses, Moon phase, planetary positions, satellite passes —
lives in Observe for the user's convenience, because the observer job spans both. It does
not live there for architectural reasons.

---

## 3. The evidence model

Every claim Observe makes carries two **independent** properties. They are independent
because a real-time measurement can still be highly uncertain and an analytic prediction
can be extremely precise; collapsing them would make "live" a synonym for "certain".

### Axis 1 — Evidence class (where the claim comes from)

| Class | Meaning | Examples |
|---|---|---|
| `analytic` | Computed from an identified model within its validity limits | Eclipse circumstances, Moon phase, rise/set, planetary positions |
| `catalog` | A retained source record with its own epoch and meaning | Star positions, meteor stream elements, orbital elements |
| `forecast` | Model output with irreducible uncertainty and a stated horizon | Aurora, cloud cover, meteor outburst rates |
| `measurement` | A live observation, with its own error and latency | Solar-wind readings, current geomagnetic indices |

### Axis 2 — User state (what the user can do about it)

| State | Meaning |
|---|---|
| `upcoming` | Known in advance; plan around it |
| `watch` | Conditions may develop; check back |
| `now` | Happening or imminent; act |

### Requirements

- **R3.1** — Evidence class is **derived from an item's inputs**, never hand-assigned per
  event. A claim built from a forecast input is `forecast` regardless of how it is
  presented.
- **R3.2** — A single event may carry **different evidence classes for different
  attributes**. A meteor shower's date and radiant are `analytic`; its expected rate is
  `forecast`; an outburst prediction is `forecast` with a wider horizon. These must never
  be rendered as one implied certainty. This requirement is the reason the model exists.
- **R3.3** — Confidence, where it is scientifically meaningful, is computed from the
  inputs' classes and stated horizons. Where it is not meaningful, Observe states the
  limitation instead of inventing a number.
- **R3.4** — The mapping from inputs to evidence class is **validated in CI**, in the same
  manner as `provenance:validate` and `licenses:validate`. An item whose class cannot be
  derived fails the build rather than defaulting.
- **R3.5** — Forecast items state their **useful horizon** alongside the value. Aurora's
  is roughly 30–90 minutes (NOAA SWPC OVATION, driven by upstream solar-wind
  measurements); the three-day outlook is a geomagnetic-activity estimate and must not be
  presented as a local visibility claim.

---

## 4. Structure

`Observe` with four views over one event system:

| View | Question |
|---|---|
| **Now** | What is visible from here at this moment? |
| **Tonight** | What is worth going outside for tonight? |
| **Upcoming** | What is coming in the next weeks? |
| **Calendar** | Where is everything, laid out by date? |

`Tonight` is the flagship. `Calendar` is another projection of the same event system, not
a separate feature, and is deliberately last in prominence.

Observe is **not** named Tracker. Satellite tracking is the smallest and least
differentiated part of the scope, and the name would misdescribe four fifths of the
content. It is not named Tonight either — solar eclipses are daytime events, passes are
often pre-dawn, and space weather has no clock.

---

## 5. Phase 1 — deterministic Observe

Phase 1 ships with **no backend, no live feed, no account, and no notification**. It is an
increment, not a validation experiment: at current audience size there is no usage
threshold that would honestly change the plan, so none is claimed. The feasibility spike
tested the technical assumptions; market demand is not being tested here.

### In scope

- Location (manual entry and, with permission, device geolocation) and time
- Solar and lunar eclipses, with local circumstances
- Moon phase, illumination, rise/set
- Planetary positions, conjunctions, oppositions
- Twilight and darkness windows
- Meteor shower dates and radiant geometry, with rate treated per **R3.2**
- Topocentric sky view: horizon, alt-azimuth placement, bright stars
- **Event ranking and its explanation** — the centrepiece

### Explicitly out of scope in phase 1

Satellite passes, aurora, cloud cover, comet brightness, notifications, accounts, and any
network request whatsoever.

### The ranking function

The one component with no reference implementation, and the actual work of phase 1.

- **R5.1** — Ranking inputs are, at minimum: maximum altitude during the visible window,
  darkness at that time, Moon interference, event duration, expected brightness or
  activity, and rarity.
- **R5.2** — Every rank is explainable in terms of its inputs, and the explanation is
  generated from the same values the rank used. A ranking whose explanation is written
  separately will drift from it.
- **R5.3** — Ranking must degrade honestly: where an input is unavailable, the item is
  ranked without it and says so, rather than being dropped or silently scored as average.
- **R5.4** — Rarity must not dominate. A once-a-decade event low on the horizon in
  daylight is not worth going outside for, and a ranking that says otherwise is wrong.

---

## 6. Later phases

Each is a separate decision, in this order, and none is authorised by this document.

| Phase | Adds | Gate |
|---|---|---|
| 2 | Live orbital-state pipeline | Justified by **Explorer** alone — replaces the reconstructed RAAN/argP/mean-anomaly that currently constrain ground tracks, coverage and constellation views. Cheapest way to acquire ops discipline: no user-facing correctness promise. |
| 3 | Satellite and ISS passes | Nearly free once 2 and phase 1 exist |
| 4 | Forecast synthesis — aurora, cloud cover | Requires phase 2's operational muscle |
| 5 | Alerts and notifications | Accounts, push, stored location, privacy obligations; hardest to reverse |

Phase 5 carries the largest commitment in the whole plan. Aurora's ~90-minute useful
horizon means the flagship synthesis — "tonight is unusually good *and* the aurora is
active" — is inherently a **notification product, not a planning product**. That should be
accepted explicitly when phase 5 is decided, not discovered during it.

---

## 7. Architecture constraints

These come from the spike and are requirements, not suggestions.

- **R7.1 — Observe must not share a bundle entry with the satellite catalog.** Measured:
  a page drawing one SVG, mounted inside `App` with an early return, transferred 31 MB in
  dev because the early return still evaluates `App`'s whole import graph — the 17 MB
  catalog, drei, and a star catalog. Mounted at the entry instead, the same page
  transferred 1.8 MB. In production the split is `App` at 4,374 KB gzipped against an
  entry of 46 KB plus astronomy at 24 KB and stars at 117 KB. **An observer page costs
  roughly 187 KB against 4,374 KB.** This is cheap to honour now and expensive after two
  more products assume otherwise.

- **R7.2 — Observe extends `src/astronomy/`; it does not sit beside it.** The codebase
  already declares `CELESTIAL_MODEL_ID = "Astronomy Engine 2.1.19"`, a validated range of
  1600–2200 enforced by throwing, EQJ/ECEF/scene frame conversions, UTC/UT1/TT handling
  with a delta-T model, and a JPL Horizons DE441 + USNO reference fixture. The
  Constitution forbids parallel resolvers that can produce different truths. The spike
  itself violated this — it called `Horizon()` directly and parsed time with `new Date()`,
  bypassing `parseCanonicalSimulationTime()` and its range check. Production code must not.

- **R7.3 — The topocentric layer is the genuine new astronomy work.** `src/astronomy/` is
  geocentric throughout; there is no `Observer` or `Horizon` usage anywhere in the
  codebase. Observer position, refraction handling and alt-azimuth conversion belong in a
  new module under `src/astronomy/`, sharing the existing time scales and frames.

- **R7.4 — No new rendering stack.** The spike drew a horizon, altitude rings, cardinals,
  seven bodies, 133 catalogued stars and a trajectory in roughly 200 lines of plain SVG.
  A three.js sky dome is not required for phase 1, and my earlier estimate that the
  renderer would be the largest phase-1 item was wrong.

- **R7.5 — Reuse the existing star catalog.** `src/data/stars/hygBrightStars.v41.json`
  ships 1,839 stars with right ascension, declination, magnitude, colour index and
  constellation, already declared in `celestialFrames.ts` as `HYG Database v4.1` at
  J2000/EQJ. It reaches a sky view through the same conversion as the planets. No new
  asset, no new attribution.

---

## 8. Accuracy and validation

- **R8.1** — Extend `src/astronomy/reference/jplHorizonsUsnoReference.json` with
  topocentric cases (rise/set and alt-azimuth for known observers and instants) rather
  than inventing a second validation mechanism.
- **R8.2** — Published eclipse circumstances are quoted in **TD**; users need UT or local
  time, and ΔT is about 69 seconds and drifting. During the spike this cost an hour
  chasing a "70-second error" that was a TD/UT1 confusion. Any eclipse feature states its
  time scale explicitly, in code and in the interface.
- **R8.3** — A sky chart is viewed **looking up**: with north at the top, east is on the
  **left**, mirrored relative to a map. The spike's first projection got this wrong while
  carrying a comment warning about it. Validate handedness against a known body and a
  compass bearing, in a test.

Measured accuracy of the existing model, against published values: greatest eclipse to
1.6 s (2024-04-08) and 1.1 s (2017-08-21), sub-solar point to ~0.01°, and Greenwich
sunrise/sunset to the minute. Sufficient for every phase-1 claim.

**Cost of the astronomy layer: zero.** `astronomy-engine` is already a declared dependency
of this project — an earlier note in the spike commit describing it as a 24 KB addition
was wrong; 24 KB is the size of a chunk the app already ships.

---

## 9. Data sources

Phase 1 requires **none**. Recorded here so later phases inherit the constraints rather
than rediscovering them.

| Source | Use | Terms that matter |
|---|---|---|
| Astronomy Engine | Analytic astronomy | MIT; already vendored |
| HYG v4.1 | Star field | Already vendored and attributed |
| IMO / IAU MDC | Meteor stream elements | Static table; attribution required |
| CelesTrak | Orbital elements (phase 3) | GP data no more than once per 2-hour cycle; stop on any non-200 and escalate; IP blocking for abuse; caching proxy expected — **this alone forecloses direct browser fetches and therefore requires a backend** |
| Space-Track | Orbital elements (alternative) | Redistribution to third parties prohibited without express approval (Public Law 108-136 §913). Compute from it; do not mirror it |
| NOAA SWPC | Aurora (phase 4) | US Government, public domain; OVATION refreshed every 5 min, useful horizon 30–90 min |
| Open-Meteo | Cloud cover (phase 4) | CC BY 4.0 with visible credit; free tier 10,000 calls/day and 600/min — reached at roughly 3,000–5,000 daily users; commercial use by arrangement |

---

## 10. Risks and open questions

- **The deterministic phase ships the commoditised half.** Eclipses and Moon phases exist
  in every planetarium app; the differentiated capability is the live synthesis deferred
  to phases 4–5. This sequencing is deliberate and its cost is accepted: it buys the
  topocentric layer and the ranking function cheaply, and both are prerequisites anyway.
  It remains the strongest argument against this plan.
- **Ranking quality is unproven and unprovable at current scale.** There is no ground truth
  for "worth observing" and no audience large enough for analytics to arbitrate. Expect to
  tune it by judgement, and say so rather than implying it is measured.
- **Two streams, one developer.** Observe and the Explorer/Playground stream are
  independent in dependencies but not in attention. Only one runs at a time.
- **Open** — how location is obtained and whether it is ever persisted. Orbit Studio
  currently collects no user data at all, which is a property worth spending deliberately
  rather than incidentally. Phase 1 can operate with location held in memory only.
- **Open** — whether `Calendar` earns its place in phase 1 or is deferred. It is the view
  most similar to what already exists elsewhere.

---

## 11. Deliberately not decided here

The overall product goal — reach versus depth — remains open, and it determines whether
phases 2–5 are worth their operational cost. Phase 1 is defensible under either answer,
which is part of why it is first.
