# Tracker experience gap report

Audit of the running production build at `localhost:4173`, 2026-08-19, viewport
1568 × 856, location Wood Village, Oregon. Every observation below was taken
from the rendered application, not from reading components. Measured values are
quoted.

The question this report asks is not "is the forecast correct" but "does this
feel like it understands why somebody cares".

---

## 1. Current strengths worth preserving

**The meteor treatment is the bar, and it is genuinely good.** Measured:

    stage ............ 578 px
    video ............ 445 px, playing (paused=false, t=6.0s)
    honesty tag ...... "Not tonight's sky"
    ribbon ........... "12:40 AM–4:40 AM is the window worth going out for —
                        improving through the night. The Moon is up early and
                        washes out the faint ones."

That ribbon sentence is the single best piece of writing in the product. It
answers when, which direction the night is trending, and what is working against
you, in one line, without a chart. It is worth treating as the template for
every other phenomenon's summary.

Also worth keeping:

- Real footage with verified provenance, labelled as representative rather than
  passed off as tonight's sky.
- Recommendation and conditions as separate vocabularies.
- The notability layer, which keeps ordinary nights out of the diary.
- Human-readable direction — "Face south", "about halfway up the sky" — with
  degrees demoted to secondary.

## 2. Where Tracker currently feels generic

### 2.1 It forgets you completely

Verified: Tracker writes **nothing** to `localStorage`, `sessionStorage` or
cookies. The keys present on the origin belong to an unrelated app.

Consequences that matter for this brief specifically:

- Location is re-entered on every visit. A product whose central promise is
  "your sky" asks who you are every single time.
- "I saw it" is forgotten immediately, so the one act of participation the
  product invites leaves no trace.
- §6 (following a phenomenon) and §7 (personal rarity) have **no foundation to
  build on**. They are not UI work; they need persistence first.

This is the single highest-leverage gap in the report.

### 2.2 Planets and the Moon have no imagery at all

Verified on Saturn: the ESA/Hubble portrait is in the DOM and
`display: none`, because a rule I added reads
`@media (max-height: 860px)` and the viewport is **856 px**.

    .tk-observe-media   display: none, imgH 0
    viewport height     856

That rule was added to make Tonight fit one screen, on the reasoning that the
portrait could yield first because losing it costs context rather than the
answer. The consequence is worse than intended: **on an ordinary laptop, every
planet and the Moon show no imagery whatsoever.** 856 px is the common case, not
an edge case.

So the phenomena where "what will I actually see" matters most — where the gap
between a Hubble portrait and a small telescope's view is the entire lesson —
currently show nothing.

### 2.3 The verdict does not discriminate

Both Saturn and the meteors returned **"Good if you're already outside"** in the
same session. Two very different propositions — a steady planet visible for five
hours, and a sporadic shower improving towards dawn — carry identical wording.
A judgement that lands on the same phrase for everything is not yet judgement.

### 2.4 The eclipse never says whether you can see it

Upcoming/Highlights renders the 27 August partial lunar eclipse well: 445 px of
real ESO imagery, a clear "why it matters" line, three facts. But:

    why ....... "Visible only from part of the world, and only for these few hours."
    facts ..... Best around 9:12 PM · Needs Eyes only · From here east-southeast

It says the event is visible *from part of the world* and never says whether
this location is in that part. For an eclipse — the phenomenon where geography
decides everything — that is the central question going unanswered.

### 2.5 The finder is empty

Saturn's finder occupies 397 px to say "Face south" and place one dot. It is
honest and legible, and it does not yet earn the space. This is already tracked
as a blocker; it belongs here too because it is the visual centre of every
planet and Moon recommendation.

## 3. Highest-value location-specific presentation

Ordered by how much meaning each adds per word:

| Today | Could be |
|---|---|
| "Visible only from part of the world" | "68% of the Moon in shadow from Wood Village, highest at 9:12 PM" |
| "A quiet sky: one every 10 minutes" | "About one every 10 minutes from here once the Moon sets at 11:20" |
| "Face south" | "Face south, over the rooftops — Saturn clears 40° by midnight" |
| "Eclipse · Thu, Aug 27" | "Your next total solar eclipse here: 2045. This one is partial." |
| generic rarity | "Next eclipse visible from here after this one: January 2029" |

The last two are directly computable today: `astronomy-engine`'s
`NextLocalSolarEclipse` already answers "next eclipse visible here", and the
discovery pass confirmed the next one from this location is **2029-01-14**,
while the next global eclipse is **2027-02-06**. That two-year gap is exactly
the kind of locally meaningful rarity §7 asks for, and it needs no new
dependency.

## 4. Media by phenomenon

| Phenomenon | Today | Gap |
|---|---|---|
| Meteors | Real CC0 footage, 445 px, playing, labelled | None. This is the reference. |
| Planets | Hubble portrait present but `display:none` below 860 px | Restore it, and pair it with a realistic-appearance counterpart — the whole point is the contrast |
| Moon | Same suppression | Phase-accurate rendering exists in `TrackerScene`; it is being hidden |
| Eclipse | Real ESO imagery in Highlights only | Nothing in Tonight; no totality-vs-partial comparison |
| Aurora | None | Not implemented at all |

The most valuable media addition is **not more spectacle**. It is the
side-by-side that stops a Hubble image from implying an eyepiece view — which
the PRD already demands and which no current screen delivers.

## 5. Curiosity paths

The product currently answers the first question and stops. Natural next
questions, and where they belong:

- *Why isn't it total here?* → beside the obscuration figure, once eclipses exist
  in Tonight
- *Where is totality?* → the map, entered from the eclipse card
- *When is the next one here?* → computable now, no map needed
- *How much is the Moon hurting this?* → the ribbon already says it for meteors;
  generalise that sentence
- *What will I actually see?* → the realistic-appearance counterpart above

Deliberately **not** an FAQ block. Each is one line or one control at the point
where the question arises.

## 6. Anticipation and lifecycle

Nothing in the product distinguishes an eclipse three months out from a
conjunction next Tuesday. Both are strip entries with a date.

The notability layer already knows which is which — `NotableKind` separates
`eclipse` from `conjunction` — so the data to differentiate exists and is unused
in presentation. Lifecycle stages (months out → hours out) should be driven by
that existing classification rather than a new system, and each stage should
only show what its data supports: no cloud forecast three months out.

## 7. Lightweight personalisation

Blocked on §2.1. Nothing can be followed by a product that does not remember
anything. Once persistence exists, the cheapest honest version is:

- remember the location (already the biggest win on its own)
- remember "I saw it" as a personal record
- follow a phenomenon type, stored locally, no account
- keep exceptional events unfiltered regardless of stated interest

No profiling infrastructure. Local storage, visible, clearable.

## 8. Realistic-view and simulation

Worth doing for planets and the Moon, where expectation and imagery diverge
most, and worth **not** doing for aurora, where a forecast cannot honestly
predict naked-eye appearance. Any simulated view must be labelled as simulation
in the interface, not only in provenance.

## 9. After the event

Lowest priority of the twelve. Tracker cannot yet remember that you saw
something, so "what happened" has nothing to attach to. Revisit after §2.1.

## 10. Reusable assets already present

- `astronomy-engine` — next-eclipse-here, already a dependency, unused for this
- `TrackerScene` — phase-accurate Moon and planet portraits, currently hidden
- `TrackerExperience` — media component with provenance, reduced-motion and
  fallback already solved; needs only more verified assets
- The ESO/NASA stills already vendored with provenance
- `experienceFor()` — a per-phenomenon media registry with exactly one entry

The media architecture is done. It is starved of assets, not of design.

## 11. Proposed PRD additions

1. Location is remembered until changed; "your sky" is a persistent concept.
2. Every phenomenon states its relationship to the user's location, or states
   plainly that it is not visible from there.
3. Imagery is never suppressed to make a layout fit; if it does not fit, the
   composition changes.
4. Where imagery differs from naked-eye appearance, both are shown.
5. Rarity is stated locally or not at all.

## 12. Recommended order

Ranked by value against effort, with reuse noted.

| # | Change | Value | Effort | Reuse |
|---|---|---|---|---|
| 1 | Persist location and seen-state | Very high | Low | Plain localStorage |
| 2 | Restore planet/Moon imagery; fix the 860 px suppression | High | Low | `TrackerScene` exists |
| 3 | "Next eclipse visible from here" | High | Low | `astronomy-engine` |
| 4 | Location-specific eclipse copy (obscuration from here) | High | Medium | `astronomy-engine` |
| 5 | Differentiate the verdict wording | Medium | Low | `verdictFor` exists |
| 6 | Realistic-appearance counterpart for planets | High | Medium | Needs assets |
| 7 | Finish the finder | Medium | Medium | Already a tracked blocker |
| 8 | Lifecycle staging for notable events | Medium | Medium | `NotableKind` exists |
| 9 | Following a phenomenon | Medium | Medium | Depends on 1 |
| 10 | Post-event recall | Low | Medium | Depends on 1 |

Items 1–3 are all low effort, use only what is already in the tree, and address
the three most-generic aspects of the product. They are the recommended start.
