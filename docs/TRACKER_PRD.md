# Tracker — Product Requirements

## Status and authority

Draft for implementation planning. Subordinate to `ORBIT_CONSTITUTION.md`; where this
document and the Constitution disagree, the Constitution wins. Written after the
feasibility spike (`?spike=tracker`, commit `f8d389d`), and several requirements below
exist because that spike contradicted an earlier estimate.

**Tracker is an Orbit Studio tool, alongside Explorer and Playground.** It serves the
same audience as every other tool: students and educators in aerospace and the space
industry. The three tools divide by the question they answer — Explorer for what is and
was real, Playground for what is possible, Tracker for what can I see from my location,
when can I see it, and how do I see it.

Two earlier drafts of this section were wrong, in opposite directions: the first called
Tracker a third *environment*, the second called it a separate *product* serving a
different audience. The second error came from reasoning backwards out of implementation
— Tracker needs its own bundle, its own renderer and its own feeds, and I read those as
a product boundary. They are costs, not boundaries. The Constitution now states this
directly under *Product Boundaries Are Not Implementation Boundaries*, and R7 below is
retained as an engineering requirement with no bearing on what Tracker is.

It is not yet built. Nothing here authorises the live-data phases; those have their own
gates.

---

## 1. What Tracker is for

**Given my location and time, rank what is realistically worth seeing, and explain when
to look, where to look, how to see it, why it is happening, and how reliable the
prediction is.**

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

### Scope

Tracker's subject matter, independent of what any phase ships:

- satellite visibility, including the ISS and Starlink trains
- meteor showers
- aurora
- solar and lunar eclipses
- Moon phases and notable lunar events
- planetary conjunctions and oppositions
- other observable celestial phenomena worth going outside for

Phasing below decides the order these arrive in. It does not narrow this list.

### Differentiation

Orbit Studio cannot win on event coverage. Stellarium, Time and Date, Sky Tonight and
others are mature, free, and comprehensive. Two things are genuinely underserved and both
are things this codebase is already unusually good at:

1. **Explaining why something is observable** — why a radiant climbing matters, why this
   object never rises from your latitude, why tonight is better than tomorrow.
2. **Stating how much to trust each claim** — the difference between an eclipse computed
   to the second and an aurora forecast good for ninety minutes.

If a phase of work does not advance one of those two, it is not advancing Tracker.

---

## 2. Why Tracker is its own tool

Not because of how it is built — see the Constitution on implementation boundaries — but
because it answers a question the other two tools cannot hold.

**Epistemic contract.** Explorer's rule is that nothing hypothetical may be presented as
historical reality, which forbids an aurora forecast outright. Playground's rule is that
everything in it is the user's own construction, which misrepresents a forecast in the
other direction. A prediction with irreducible uncertainty fits neither. Tracker's
contract is that its content is predicted and carries its reliability with it, and that
contract is the tool's organising principle rather than a feature inside it.

**Frame of reference.** Explorer and Playground are geocentric: the user looks at orbits
from outside. Tracker is topocentric: the user stands somewhere and looks up. Same
audience, same subject, different vantage — and the vantage is the whole point of the
question Tracker answers.

**Teaching value.** For a student, Tracker is the tool that connects the other two to the
sky over their head. Explorer says the ISS is real and in a 420 km orbit at 51.6°;
Playground says what happens if you change that; Tracker says it crosses your sky at
21:14 tonight, 68° up in the south-west, bright enough to see from a city, and here is
why it is lit while you are in darkness. That link is the reason it belongs in Orbit
Studio rather than beside it.

---

## 3. The evidence model

Every claim Tracker makes carries two **independent** properties. They are independent
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
  inputs' classes and stated horizons. Where it is not meaningful, Tracker states the
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

`Tracker` with four views over one event system:

| View | Question |
|---|---|
| **Now** | What is visible from here at this moment? |
| **Tonight** | What is worth going outside for tonight? |
| **Upcoming** | What is coming in the next weeks? |
| **Calendar** | Where is everything, laid out by date? *(deferred past phase 1)* |

`Tonight` is the flagship. `Now · Tonight · Upcoming` covers the initial jobs and is the
phase 1 view set. **`Calendar` is deferred**: it is another projection of the same event
system rather than new capability, and it should earn inclusion later rather than consume
design effort because it is the conventional thing to build.

- **R4.1 — "Tonight" is a location-derived observation period, not a calendar day.** It
  spans the current or next local evening through the following morning: from the start
  of the observer's evening twilight to the end of their morning twilight. It is never
  midnight-to-midnight, and it is never assumed to be sunset-to-sunrise, because the
  useful boundary depends on the event — a bright planet is visible in civil twilight, a
  meteor shower needs astronomical darkness, and a partial solar eclipse happens in
  daylight.
- **R4.2** — Each event carries its **own** observable window inside that period,
  computed from the darkness it actually requires. The period frames the view; it does
  not clip an event that is best seen outside it.
- **R4.3** — The definition must hold at the edges, and these are specified rather than
  left to emerge:
  - **After midnight.** At 01:00 local, "tonight" still means the evening that has just
    passed and the morning to come, not the next evening.
  - **Timezone and DST.** The period is derived from the observer's location and local
    civil time, including the day a DST transition lengthens or shortens.
  - **Polar day.** Where astronomical twilight never ends, the period exists but the
    darkness-dependent events in it are correctly ranked as unobservable, with the
    reason stated. The view is not empty and does not error.
  - **Polar night.** Where the Sun never rises, the period is the full local day and
    darkness is not the limiting factor.
  - **Pre-dawn events.** An event at 04:30 belongs to the night that is ending, not the
    one beginning that evening.

One naming note, since the scope is broader than the name suggests: satellite tracking is
one part of Tracker among many, and most of the content — eclipses, showers, aurora,
lunar events, conjunctions — is not tracking in the orbital sense. The name is settled;
the interface should not let it narrow what users expect to find.

---

## 5. Phase 1 — deterministic Tracker

Phase 1 ships with **no backend, no live feed, no account, and no notification**. It is an
increment, not a validation experiment: at current audience size there is no usage
threshold that would honestly change the plan, so none is claimed. The feasibility spike
tested the technical assumptions; market demand is not being tested here.

### In scope

- Location and time — see R5.8
- Solar and lunar eclipses, with local circumstances
- Moon phase, illumination, rise/set
- Planetary positions, conjunctions, oppositions
- Twilight and darkness windows
- Meteor shower dates and radiant geometry, from the vendored stream catalog (**R9.1–R9.4**), with rate treated per **R3.2**
- Topocentric sky view: horizon, alt-azimuth placement, bright stars
- **Event ranking and its explanation** — the centrepiece

### Explicitly out of scope in phase 1

Satellite passes, aurora, cloud cover, comet brightness, notifications, accounts, and any
network request whatsoever. Phase 1 ships vendored data but makes no runtime request.

### Location

- **R5.8 — Location is manual entry or permission-based device geolocation, held in
  memory only.** No account, no server-side storage, and no persistence between sessions
  in phase 1. Orbit Studio currently collects no user data at all; that property is spent
  deliberately or not at all.

### The ranking function

The one component with no reference implementation, and the actual work of phase 1.

- **R5.1** — Ranking uses a **common observability framework plus phenomenon-specific
  factors**, and every input applies only where it is physically relevant. A universal
  input list would be wrong: Moon interference dominates a meteor shower and is
  meaningless for a solar eclipse, and darkness is a requirement for one and an
  impossibility for the other.

  *Common dimensions, applicable to every event:*
  - **Local visibility** — is it above the horizon from here at all, and for how long
  - **Geometry** — maximum altitude reached, direction, whether the horizon is clear
    enough at that bearing
  - **Timing** — when the observable window falls, and whether it is a reasonable hour
  - **Rarity** — how often this is available from this location

  *Phenomenon-specific dimensions, applied only to the event types they govern:*
  - meteor showers — radiant altitude, expected rate, Moon phase and Moon altitude
    during the peak window, darkness
  - satellite passes — magnitude, whether the spacecraft is sunlit while the observer is
    in darkness, angular rate, culmination altitude
  - solar eclipses — magnitude or obscuration, path proximity, Sun altitude
  - lunar eclipses — umbral depth, Moon altitude, darkness not required
  - aurora — geomagnetic activity, observer magnetic latitude, darkness, horizon to the
    pole-facing direction
  - conjunctions — angular separation, both objects' magnitudes, twilight conditions

  A phenomenon that is not in the list above must define its own dimensions before it
  ships. Silently ranking it on the common dimensions alone is a defect.
- **R5.2** — Every rank is explainable in terms of its inputs, and the explanation is
  generated from the same values the rank used. A ranking whose explanation is written
  separately will drift from it.
- **R5.3** — Ranking must degrade honestly: where an input is unavailable, the item is
  ranked without it and says so, rather than being dropped or silently scored as average.
- **R5.4** — Rarity must not dominate. A once-a-decade event low on the horizon in
  daylight is not worth going outside for, and a ranking that says otherwise is wrong.

### Observation guidance

Ranking says whether to go outside. Guidance is the other half of Tracker's stated job —
*how do I see it* — and is a requirement, not supplementary educational material.

- **R5.5** — Every supported event type provides observation guidance covering each of
  the following that applies to it. An item that cannot answer an applicable field states
  that, rather than omitting it silently:
  - **equipment** — naked eye, binoculars, or telescope, and what each adds
  - **direction and elevation** — where to face and how high to look
  - **when to start looking** — including any lead time before the event itself
  - **duration and motion** — how long it lasts and whether it moves visibly
  - **horizon requirements** — how low a horizon is needed in the relevant direction
  - **darkness and light-pollution sensitivity** — whether it survives a city sky
  - **Moon interference** — where the Moon is and whether it will wash the event out
  - **dark adaptation** — where it materially changes what is seen
  - **technique** — anything event-specific, such as using averted vision, or watching
    away from the radiant rather than at it
- **R5.6** — **Safety instructions are mandatory where applicable and cannot be
  suppressed by layout, ranking or truncation.** Solar observation is the governing case:
  any event involving the Sun states the eye-damage risk and the required filtration
  before any other guidance, including partial phases of a total eclipse and the moments
  either side of totality.

### Explanation

- **R5.7** — Every event type supports two distinct explanations, because they answer
  different questions and one does not imply the other:
  - **Phenomenon** — why this kind of event happens at all, independent of the observer
  - **Tonight** — why it is visible from this location at this time

  For an ISS pass: the phenomenon is what an orbital pass is; the tonight explanation is
  why the spacecraft is sunlit while the observer is already in darkness. For the
  Perseids: the phenomenon is Earth crossing a meteoroid stream left by comet
  109P/Swift-Tuttle; the tonight explanation is radiant altitude, darkness and Moon
  conditions.

  This requirement is where Tracker is an Orbit Studio tool rather than a better events
  list. An implementation that ships ranking and guidance without both explanations has
  built the astronomy app, not the teaching tool.

---

## 6. Later phases

Each is a separate decision, in this order, and none is authorised by this document.

| Phase | Adds | Gate |
|---|---|---|
| 2 | Live orbital-state pipeline | Justified by **Explorer** alone — replaces the reconstructed RAAN/argP/mean-anomaly that currently constrain ground tracks, coverage and constellation views. Cheapest way to acquire operational discipline, because it makes no *time-critical* observation promise — nothing yet claims "the ISS appears at 21:14:32". The correctness obligation is real from the moment Explorer renders those states. Serves both tools, so it is built as a library with its own contract rather than inside either. |
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

These are engineering costs and constraints. None of them bears on what Tracker *is* or
who it serves; a tool that needs its own bundle, renderer and feeds is still one tool
among several.

- **R7.1 — Tracker must not share a bundle entry with the satellite catalog.** Measured:
  a page drawing one SVG, mounted inside `App` with an early return, transferred 31 MB in
  dev because the early return still evaluates `App`'s whole import graph — the 17 MB
  catalog, drei, and a star catalog. Mounted at the entry instead, the same page
  transferred 1.8 MB. In production the split is `App` at 4,374 KB gzipped against an
  entry of 46 KB plus astronomy at 24 KB and stars at 117 KB. **An observer page costs
  roughly 187 KB against 4,374 KB.** Cheap to honour now, expensive once more code
  assumes otherwise. A shared entry point would make Tracker unusable on a phone; it
  would not make it a different product.

- **R7.2 — Tracker extends `src/astronomy/`; it does not sit beside it.** The codebase
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

**Phase 1 requires no live or runtime external data source.** It does have a vendored one:
Astronomy Engine computes positions and circumstances but does not know that the Perseids
exist, so the meteor stream catalog is static data that ships with the app. The rest of
this table is recorded so later phases inherit the constraints rather than rediscovering
them.

### The phase 1 vendored dataset

- **R9.1** — Meteor stream elements are vendored, not fetched, and are treated as a
  `catalog` evidence class per **§3** — a source record with its own epoch, not an
  analytic result.
- **R9.2** — The dataset is the **IAU Meteor Data Center** established-shower list, with
  the **IMO** working list of visual shower parameters for peak dates and nominal rates.
  Both are pinned to a dated snapshot, checksummed, and registered in
  `provenance/inventory.json` with rights basis and attribution, in the same manner as
  GCAT and the NASA fragmentation reference.
- **R9.3** — Snapshot policy: the vendored copy is replaced deliberately, never
  automatically, and the replacement records what changed. Shower parameters drift as
  streams are re-observed, so a silent update would move ranking outputs with no visible
  cause.
- **R9.4** — **Provenance and evidence class are different things, and a shower carries
  several of each.** Coming from an authoritative static table does not make a value an
  analytic certainty, and one uncertain attribute does not make the whole object a
  forecast. Within a single shower:
  - stream identity and orbital elements — `catalog`, from the IAU MDC snapshot
  - radiant position and peak date — `analytic`, computed for the observer and year
  - radiant altitude, darkness and Moon conditions tonight — `analytic`
  - nominal ZHR — `forecast`, regardless of arriving in a catalog
  - outburst prediction — `forecast`, with a wider horizon than the nominal rate

  Classifying the shower object as `forecast` because one attribute is would recreate at
  the object level exactly the collapse **R3.2** exists to prevent.

| Source | Use | Terms that matter |
|---|---|---|
| Astronomy Engine | Analytic astronomy | MIT; already vendored |
| HYG v4.1 | Star field | Already vendored and attributed |
| IAU MDC + IMO | Meteor stream elements (**phase 1**) | Vendored static snapshot, not fetched. Pinned, checksummed and registered in provenance; attribution required. See R9.1–R9.4 |
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
- **Two streams, one developer.** Tracker and the Explorer/Playground stream are
  independent in dependencies but not in attention. Only one runs at a time.
- **Open** — how location is obtained and whether it is ever persisted. Orbit Studio
  currently collects no user data at all, which is a property worth spending deliberately
  rather than incidentally. Phase 1 can operate with location held in memory only.
- **Open** — whether `Calendar` earns its place in phase 1 or is deferred. It is the view
  most similar to what already exists elsewhere.

---

## 11. Settled, and how later phases are judged

**The orbital-element pipeline is shared Orbit Studio infrastructure.** Neither Explorer
nor Tracker owns it. The first approved use case funds and drives its implementation;
after that both consume the same authoritative interface, and neither may fork it or
reach around it.

**Phases 2–5 stay gated individually.** This document does not justify them and is not
required to. Each is approved on its own when it is proposed, against one criterion:
**does the capability materially help a student understand or experience the phenomenon.**
Engagement is not the test. Neither is completeness, nor the fact that a phase was listed
here.
