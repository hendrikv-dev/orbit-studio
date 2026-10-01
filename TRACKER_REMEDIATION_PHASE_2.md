# Orbit Studio Tracker — Remediation Phase 2

Date: 2026-08-20  
Scope: responsive architecture, planning responsiveness, accessibility,
interaction hierarchy, truthful media semantics, and phenomenon discovery
foundations

## Executive result

Tracker Phase 2 is complete for its defined scope. The malformed responsive
CSS boundary is repaired; Tonight, Upcoming, onboarding, and Calendar reflow
intentionally from 320 CSS px through desktop; Calendar becomes a chronological
agenda on phones; future planning runs in a cancellable, cached worker with an
announced progress state; the stale accessibility verifier now exercises the
real product; reminders follow the observing decision and produce calendar
files; media has explicit claim, origin, capture-date, and expected-view
semantics; and supported phenomenon filters contain no dead categories.

This is not a claim that maps, live cameras, or unsupported phenomena are now
implemented. Those remain later, separately scoped product work.

## A. Starting state

- Starting commit: `77aa35ee3472028e82a789e18162d07bb4985c85`
- Starting commit tree: `ba04dcd363d524a3180ca42894ac31865042093b`
- Branch at investigation: `integrate-release-candidate`
- The working tree was already dirty with the uncommitted Phase 1 source and
  report plus unrelated `.claude/` content. That work was preserved; Phase 2
  was implemented on top of it without resetting or claiming it as a clean
  commit.
- Before Phase 2 edits, the focused Phase 1 regression run passed 10 files and
  128 tests. The final full suite passes 79 files and 558 tests, including all
  Phase 1 Moon, eclipse, opposition, environmental evidence, location search,
  persistence, plan-identity, and async-authority tests. No Phase 1 assertion
  was removed or weakened.

Because the tree is dirty, a commit alone does not identify the validated
source. The final material-input manifest digest is
`e203ba83937ec594e00227b8e1a9ba9090a7e8a278b454b90926cb87aea92fee`.
It hashes the sorted per-file SHA-256 records for Tracker source and tests, the
planning worker, Tracker CSS, accessibility verifier, media inventory,
provenance inventory, and generated attribution. High-risk identities include:

| Input / output | SHA-256 |
| --- | --- |
| `src/styles/app.css` | `7b3f1ffa775f5a4270a250ba6985713845d9c5dd9e8fbf770f5e605a8a89f622` |
| `src/components/tracker/TrackerMonth.tsx` | `d1053dc13c06d6155f88441c86cc9d2016a03255e1c5b6e77496b9ad2b923f79` |
| `src/data/tracker/planningClient.ts` | `876d4d442809db947edce6f8083c606e8bce44e4cbf6ce09968c5a755c9ab866` |
| `src/workers/trackerPlanning.worker.ts` | `061b675c444b0a03126f215f6030f486b49a89a1da8082e8c3148d5b9d3e1ae9` |
| `scripts/verify/accessibility.mjs` | `7a14a56ab8689a80d8dd3e4041909902731756caee20069a85fcb7cd1677741d` |
| `src/data/tracker/imagery.ts` | `65f97d9e930bdab1200209b127100d3689caf998dbd67542df041c24dbbdba61` |
| production Tracker bundle | `f07e745867d728a39e4d626dd7d8c00e02cf633b4d66f0e5735182161c5c1b59` |
| production planning worker | `8ab36af842a87dce9359d8f3c7801cd949b555908bf041a49e9d0910d3258525` |
| production Tracker CSS | `cb1d3b870d2b8897165764f4edc99db9141b068a128ef19cde40a47a50126f2c` |

The complete validation identity is in
`tracker-remediation-phase2/evidence/final/validation-summary.json`.

## B. Responsive root cause

The audit's probable cause was confirmed. A missing `}` left the
`@media (min-width: 1180px)` block open near the transition from the Tonight
desktop composition to the night-bar rules. A stray `.tk-tonight >` token then
prefixed the next selector. Vite warned about the unbalanced block, but still
produced CSS; the consequence was worse than a visible syntax error: the late
global Tracker rules, including much of the intended small-screen behavior,
were trapped behind the desktop media condition.

That malformed boundary combined with real layout assumptions:

- the shell hid overflow, so `document.scrollWidth` could look correct while
  header and primary boxes extended more than 160 px beyond a 320/390 px view;
- Tonight preserved a viewport-locked desktop spread below its viable width;
- Upcoming and Calendar retained height and grid constraints appropriate only
  to wide screens;
- header navigation/location controls did not have an explicit phone grid;
- Calendar's seven-column grid and side detail were being treated as the phone
  interaction as well as the desktop interaction;
- media was hidden at a fixed height threshold instead of reflowing.

The missing brace was the causal switch that kept later responsive rules from
applying. Fixing it exposed the remaining intrinsic-size and interaction-model
assumptions, which were then corrected directly.

## C. Responsive changes

- Closed the malformed media block and removed the invalid selector fragment;
  the production build no longer emits the unbalanced-CSS warning.
- Made Tracker and descendants use predictable border-box sizing and zeroable
  grid/flex tracks.
- Below the three-column breakpoint, the active Tracker view becomes the
  vertical scroll owner. Content is reflowed and remains reachable instead of
  being clipped to a desktop one-screen spread.
- Tonight stacks its decision, observing media, alternatives, and unavailable
  context while preserving all useful content. Representative media scales
  with `cover`/`contain` according to its treatment; it is not hidden at an
  arbitrary viewport height.
- At phone widths the header uses a two-row grid: brand/location above and
  equal-width Tonight/Upcoming navigation below. Controls shrink within their
  tracks and retain 44 px targets.
- Upcoming stacks heading, supported-phenomenon filter, tabs, feature content,
  media, and the secondary reminder. Its internal view scrolls vertically.
- Calendar keeps the sparse seven-column month index on tablet/desktop. At
  720 px and below it intentionally hides that visual matrix and exposes a
  chronological agenda with full event names, dates, times, selected state,
  and a detail pane. Multiple events on one date have distinct date+event
  selection identity; the grid announces the count and the detail offers an
  event switcher, so two events can never both masquerade as selected.
- Focus outlines, forced-colors selection outlines, reduced-motion behavior,
  and mobile media/credit wrapping are defined alongside the responsive model.

Production geometry was measured at 320×568, 375×667, 390×844, 430×932,
768×1024, 1024×768, 1280×720, and 1440×900. Every state's document
`scrollWidth` equals its client width. At 320 px the Tonight primary is exactly
320 px wide; Highlights and Calendar are 300 px wide within 10 px gutters; the
desktop Calendar grid is 0 px and the agenda is 300 px. At 768 px and above the
agenda is hidden and the Calendar grid is restored.

## D. Performance profile

The production baseline used Chromium 148 on this Mac with provider traffic
stubbed so network variability could not be mistaken for astronomy/render
cost. Long tasks align with view actions, and the source trace confirmed why:
`TrackerHighlights` called `planNights` and `TrackerMonth` called `planMonth`
inside the render-side memo path. Each mount regenerated 30–31 complete nights,
including astronomy, phenomena, ranking, and sorting, on the main thread.
Switching tabs unmounted the prior view, so “warm” navigation repeated the same
work. Network and media were not the cause; React committed only after the
synchronous plan returned.

| Production workflow | Before | Final | Interpretation |
| --- | ---: | ---: | --- |
| Initial DOM content loaded | 102.6 ms | 113.4 ms | Essentially unchanged; no initial-load performance claim. |
| Confirm coordinates → Tonight | 230.8 ms | 258.4 ms | Same single-night production path; still interactive. |
| Confirm a changed location → new Tonight | not captured | 199.1 ms | New explicit Phase 2 measurement. |
| Select Tonight alternative | 74.0 ms | 97.0 ms | Remains sub-100 ms. |
| Cold Upcoming result ready | 1,033.8 ms frozen | 1,372.6 ms in worker | Total calculation is not faster; the final UI stays responsive and announces progress. |
| Phenomenon filter | not captured | 66.3 ms | Local derived filter; no recomputation stall. |
| Cold Calendar result ready | 899.1 ms frozen | 1,353.8 ms in worker | Total calculation is not faster; it no longer blocks the main thread. |
| Select Calendar event | not captured | 81.6 ms | Includes focus transfer to detail. |
| Next Calendar month ready | 916.3 ms frozen | 1,366.6 ms in worker | Background computation with progress rather than a frozen click. |
| Warm Calendar → Highlights | 883.4 ms | 66.8 ms | 92% lower completion latency through the keyed cache. |
| Warm Highlights → Calendar | 833.6 ms | 83.5 ms | 90% lower completion latency through the keyed cache. |

The important release defect was synchronous unresponsiveness, not merely the
wall-clock time needed to calculate 30 nights. Baseline planning transitions
created 753–966 ms main-thread long tasks. Final planning produces no
seconds-long main-thread task; the largest planning-associated main-thread task
is 72 ms, a 92.5% reduction from 966 ms. The 134 ms maximum in the complete
trace occurs in the location/entry sequence, before the future-planning flow.
Cold worker completion is candidly slower because it includes worker startup,
structured cloning, and progress delivery; that remaining latency is visible,
cancellable work rather than frozen input. No claim is made that the astronomy
calculation itself became faster.

## E. Performance architecture changes

- Added a dedicated Tracker planning worker that calls the same production
  `planNights` and `planMonth` functions used by all other consumers. There is
  no test-only or alternate astronomy model.
- Added progress callbacks at the schedule boundary and an accessible progress
  component with completed/total counts, failure copy, and retry.
- Added an explicit request/response protocol and a cache key containing model
  version, request kind, rounded confirmed coordinates, timezone, date/month,
  and horizon.
- Added a maximum-eight-entry result cache plus shared in-flight work per key.
  Remounting a completed view is a cache hit; two subscribers share work.
- Each hook request owns a request key. Replacement/cancellation removes the
  subscriber; the final subscriber terminates the worker. Late, stale, errored,
  or out-of-order worker messages cannot replace a newer request.
- Worker/client tests prove progress, subscriber sharing, cache hits,
  cancellation, and stale late-result rejection. Schedule tests continue to
  prove the authoritative plan output itself.
- Failure is honest: the view retains an error state and Retry control. It does
  not silently display an older or decorative plan.

## F. Accessibility remediation

Product changes include:

- Calendar uses ordinary labelled buttons and lists rather than an incomplete
  ARIA grid/gridcell hierarchy. Selected state is `aria-pressed`, full event
  names are available, phone ordering is chronological, and selection moves
  focus to the detail region.
- Same-date Calendar events now use date+opportunity identity; the real-browser
  semantic pass caught and removed a state where an eclipse and Full Moon on
  the same date both announced as pressed.
- Upcoming uses a real tablist/tabpanel relationship with `aria-controls` and
  labelled supported-category select.
- Loading exposes an accessible progressbar and live status. Errors expose a
  real retry button.
- Location picker Tab handling now marks the React Aria combobox unfocused
  before native focus advances. This prevents its focus-triggered popup from
  reopening and leaving the next link inside an `aria-hidden` subtree.
- Focus-visible outlines cover buttons, links, selects, inputs, summaries, and
  Calendar detail; forced-colors adds non-colour outlines/borders.
- Interactive targets are at least 44 px on phones. Selected state is not
  conveyed by colour alone.
- Meteor motion respects live changes to `prefers-reduced-motion`; reduced mode
  renders the poster and no autoplaying video.

`npm run a11y:verify` now follows the current structure instead of waiting for
obsolete `.tracker-detail` content. It checks 18 production states: entry,
inline/header picker and confirmation, Tonight, opened details, passed cards,
worker-complete Highlights/Calendar, selected Calendar detail, 390 px versions,
320 px reflow, and reduced motion. Axe reports zero WCAG 2.1 A/AA violations in
those states. Explicit assertions cover keyboard arrows/Enter/Escape/Tab,
focus return, focus visibility, decision-before-reminder order, unsupported
filter options, Calendar focus/selection, phone agenda/grid visibility, and
horizontal clipping.

Additional production evidence covers 320 px reflow (the WCAG 400% reference
width for a 1280 CSS px layout), tablet/720–768 px reflow representative of 200%
zoom, forced-colors, visible focus, and reduced motion. Browser semantic
snapshots confirmed the meteor figure announces “Representative example”,
“Historical capture · 2020-08-12”, and “Naked-eye view”. A live screen reader
session was not performed, so assistive-technology-specific speech output
remains unvalidated; names, roles, relationships, focus transitions, axe, and
accessibility-tree snapshots are the evidence claimed.

The verifier retains one narrowly documented axe substitution for React Aria's
open inline combobox: `aria-hidden-focus` is replaced in that exact transient
state by a behavioral Tab assertion. The rule is enabled in every other state,
and the product bug revealed by that assertion was fixed rather than suppressed.

## G. Interaction hierarchy changes

Every major event presentation now follows the observing decision:

1. phenomenon and significance;
2. local time/direction/equipment/environmental status;
3. realistic naked-eye/binocular/telescope expectation and science detail;
4. media meaning and provenance where media is shown;
5. the secondary `Remind me` action.

Tonight's reminder moved below the realistic expectation, science, and media
context and is visually secondary. Highlights and Calendar now expose the same
decision information before their reminder. Phone layouts preserve this
document order instead of moving the action ahead of the evidence.

## H. Unsupported and inert UI corrections

- Tonight, Highlights, and Calendar `Remind me` controls are working secondary
  actions. They generate an RFC 5545 `.ics` file with event start/end,
  description, and a 20-minute display alarm. No paid delivery service or
  inert button is implied.
- Unsupported Satellite/ISS and aurora functionality is not advertised as
  available and is not selectable in the phenomenon filter.
- The taxonomy records aurora, satellites, comets, and occultations as
  `not-yet` with the missing authority stated, but keeps them out of current
  primary interaction.
- Filtered empty results, worker loading/failure, weather uncertainty, and
  unsupported categories have explicit states. No dead control is used as a
  placeholder.
- No map control or live-camera control was added.

## I. Media model

Tracker now separates the recommendation's current data from the media's claim:

- **Representative** — a photograph or video illustrating the phenomenon in
  general. It may be from another date, location, or occurrence and never
  implies the observer's current sky.
- **Historical/event-specific** — material tied to a named known occurrence,
  with capture date/source where known. Historical remains historical; it is
  not made “live” by natural playback speed.
- **Live** — reserved for a currently functioning feed with identified
  provider, location, status, update semantics, and usage permission. Tracker
  ships no live media in Phase 2.

The data model separately requires `claim`, `origin`, `capturedAt`, and
`expectedMode`. Expected modes distinguish naked eye, binoculars, telescope,
long exposure, and processed imagery. `TrackerScene` and `TrackerExperience`
render those meanings on the media itself alongside visible credit/licence.

The meteor contradiction is fixed at the model boundary. The Perseid clip is a
representative historical capture recorded on 2020-08-12, shown at natural
speed. Alt text calls it historical natural-speed footage; the UI calls it a
representative example and historical capture. It is never “real-time”, “live”,
“tonight's sky”, or the reader's local feed. A generic quiet night now uses a
proper dark-sky photograph rather than misleadingly falling back to the
Moon–Venus pairing.

## J. Media inventory

The complete per-asset product inventory is
`docs/TRACKER_MEDIA_INVENTORY.md`; exact source URLs, transformations,
checksums, rights, and redistribution decisions remain machine-readable in
`provenance/inventory.json` and generated `ATTRIBUTION.md`.

| Coverage | Shipping media | Claim / expected mode | Rights | Remaining need |
| --- | --- | --- | --- | --- |
| Meteors | ESO Perseid still; Bautsch Perseid WebM/poster | Representative historical; long exposure and natural-speed naked-eye context | CC BY 4.0; CC0 1.0 | More verified shower-specific motion |
| Moon | NASA LROC phase composite | Current event model; binocular context | NASA Images and Media Usage Guidelines | None for phase; additional realistic eye references useful |
| Lunar eclipse | ESO Paranal eclipse | Representative historical; long exposure | CC BY 4.0 | No future-event-specific media implied |
| Conjunctions / Venus | ESO Moon–Venus dusk image | Representative historical; naked-eye context | CC BY 4.0 | Other pairing geometries |
| Mars, Jupiter, Saturn | ESA/Hubble portraits | Representative historical; processed space-telescope context | CC BY 4.0 | Small-aperture eyepiece references |
| Quiet fallback | ESO Paranal sky crop | Representative historical; long exposure | CC BY 4.0 | Location/light-pollution-specific media not claimed |
| Aurora, comets, occultations, satellites | None | Not supported/selectable | N/A | Authority and media work remain later scope |

No questionable URL-only asset was added. Every shipping third-party image
retains a visible credit and source link. The provenance inventory hashes for
the changed media policy/render code were updated, Wikimedia source hosts were
registered, and attribution was regenerated.

## K. Live-feed research

No live-feed research or integration was performed. It was optional, and no
candidate was needed to correct an existing flow. Adding a camera without
event/location coupling, reliable uptime/status/timestamp semantics, and a
verified embedding or redistribution basis would weaken the truthfulness this
phase establishes. Candidate research remains a separate task.

## L. Phenomenon-discovery foundation

Added one explicit taxonomy with support state, scope, and selectability:

- supported/selectable: meteor showers, Moon phases, planets, close pairings;
- partial/selectable: lunar eclipses (the modeled subset is labelled);
- not yet/non-selectable: aurora, satellites, comets, occultations.

All current notability kinds map to exactly one selectable category. Upcoming
owns a supported-category filter that applies to Highlights and Calendar while
Tonight remains the local ranked answer. Tests prove there is no selectable
dead category, all modeled kinds are mapped, and satellite/aurora support is
not promised. The taxonomy can later own imagery, educational context,
recommendation logic, expectations, and geographic treatment without replacing
Tonight/Upcoming/Calendar.

No map was built. Eclipse bands, aurora probability, satellite tracks, travel
decisions, legends, time/intensity/uncertainty, and event↔map synchronization
remain preserved Phase 3+ requirements.

## M. Production evidence

Evidence root:

`/Users/hendrik/.codex/visualizations/2026/08/19/01a01c5f-be6a-7410-b4c5-a31a75b9b45e/tracker-remediation-phase2/evidence`

Key artifacts:

- `baseline/production-audit.json` — immutable pre-change Chromium timings,
  long tasks, console, and clipped geometry.
- `final/production-audit.json` — final production navigation/timings, long
  tasks, eight viewport matrices, preference states, and console capture.
- `final/responsive-*-tonight.png`, `*-highlights.png`, and `*-calendar.png` —
  production screenshots at every audited viewport.
- `final/performance-calendar-1440x900.png` — final desktop Calendar.
- `final/preference-reduced-motion-390x844.png` and
  `preference-forced-colors-390x844.png` — preference evidence.
- `final/validation-summary.json` — source/bundle identity and command results.
- `final/webkit-unavailable.json` — exact optional-engine limitation.
- repository `review/` — configured Tracker production review package.

Runtime outcomes:

| Requirement | Final evidence |
| --- | --- |
| Phone reflow | 320/375/390/430: client width equals scroll width in Tonight, Highlights, Calendar; visible boxes stay within viewport. |
| Tablet/desktop | 768/1024/1280/1440 retain usable grid/detail layouts with no horizontal overflow. |
| Calendar mobile model | Phone grid hidden; full-width chronological agenda visible; one event selected; same-date events distinct and switchable. |
| Planning responsiveness | Progress tree observed at 2/30 and 3/31 nights; no seconds-long planning main-thread task; warm transitions 66.8/83.5 ms. |
| Location/initial plan | Coordinate confirmation 258.4 ms; confirmed location replacement 199.1 ms. |
| Event/filter interaction | Tonight event 97.0 ms; phenomenon filter 66.3 ms; Calendar selection/focus 81.6 ms. |
| Keyboard/accessibility | Repaired verifier PASS across 18 states with zero axe violations; semantic snapshots confirm roles/names/selection. |
| Reduced motion | Preference matched; autoplaying video count 0. |
| Forced colors | Preference matched; focused Upcoming control retained a 2 px solid outline. |
| Media | Production meteor state announces representative/historical/naked-eye semantics; Saturn and eclipse states announce representative historical processed/long-exposure semantics. |
| Interaction hierarchy | Accessibility-tree order places expectations and media meaning before `Remind me`; reminder is a working `.ics` download. |
| Unsupported controls | Filter contains no aurora/satellite option; console capture contains no errors or warnings. |

Final commands and outcomes:

| Command | Outcome |
| --- | --- |
| `npm test -- --reporter=dot` | PASS — 79 files, 558 tests, zero failures. No skipped test was reported. |
| `npm run build` | PASS — TypeScript and Vite production build; planning worker emitted. Existing repository large-chunk advisory remains. |
| `npm run a11y:verify` | PASS — 18 production states, zero axe violations, keyboard/reflow/Calendar assertions green. |
| `npm run review -- --scenario tracker` | PASS — production Tracker review package generated. |
| final `phase2-production-audit.mjs --final` | PASS — Chromium 148, all production scenarios and screenshots written, no console messages. |
| `webkit.launch({headless:true})` | UNAVAILABLE — repository-matched WebKit executable is not installed; no WebKit result is claimed. |
| `npm run provenance:generate` | PASS — attribution/notices regenerated from the corrected inventory. |
| `npm run provenance:validate` | FAIL on pre-existing repo-wide rights/checksum/classification debt listed below; no Tracker media source, checksum, or Wikimedia-host failure remains. |

## N. Remaining known issues

- Cold future computation still takes about 1.35–1.37 seconds to finish on the
  measured machine. It is now background, cancellable, cached work with
  progress, not a frozen UI. Further astronomy optimization would need a new
  profile and is not required to remove the Phase 2 release defect.
- Regional eclipse authority still lacks visibility maps/ribbons; aurora,
  satellites, comets, and occultations remain explicitly unsupported. No map
  claim is made.
- Tracker has no live feed. More phenomenon-specific motion and realistic
  amateur-eyepiece media would improve coverage.
- Repository-matched Playwright WebKit is not installed, so the requested
  optional WebKit repetition could not be performed. Chromium production is
  the only browser engine claimed.
- A live screen-reader speech session was not performed; automated semantics,
  accessibility-tree output, keyboard focus, axe, reduced motion, reflow, and
  forced-colors are the bounded accessibility claim.
- The production build retains the repository's existing large-bundle advisory.
- The repo-wide provenance gate remains red on pre-existing/unrelated state:
  unresolved rights entries for the meteor parameters and Phase 1 provider
  adapters; stale checksums for package lock, Explorer reference files, and the
  modified Phase 1 adapters; unclassified pre-existing brand/home/font files;
  `.claude/launch.json`; and unrelated external hosts in generated font notices
  and a Home test. Phase 2's shipping media sources, individual rights,
  checksums, registered Wikimedia hosts, and generated attribution are
  traceable. This report does not claim whole-repository release clearance.

## O. Phase status

Every Phase 2 completion item has implementation and final-source production
evidence: intentional 320–430 px layouts, preserved tablet/desktop behavior,
phone Calendar agenda, corrected malformed CSS architecture, non-blocking
planning with material main-thread and warm-transition improvement, trustworthy
accessibility verification, keyboard/reflow/motion fixes, corrected action
hierarchy, working reminders, removal of unsupported promises, truthful media
semantics/provenance, green Phase 1 contracts, full Tracker/full-repository
tests, production build, Tracker review, and final Chromium runtime checks.

PHASE 2 COMPLETE — READY FOR PHASE 3 REVIEW
