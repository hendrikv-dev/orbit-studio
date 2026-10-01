# Orbit Studio Tracker — Remediation Phase 1

Date: 2026-08-20  
Scope: scientific correctness, recommendation authority, location/time/persistence authority, and audit-harness hardening

## Executive result

The Phase 1 functional acceptance criteria are implemented and pass their focused tests and production Tracker review. Tracker now uses a single Moon-phase model, explicit eclipse contacts and minutes, physically constrained opposition events, categorical environmental evidence, confirmed-location authority, query-versioned search, keyed plan invalidation, and versioned local persistence of only the confirmed place.

Phase 1 is not declared complete under the repository engineering standard because final validation is not fully clean. The production build exits successfully but reports an unbalanced `@media` rule in pre-existing user-modified `src/styles/app.css`; the full review still stops in unrelated Explorer playback at the pre-existing 1,000× transition; and the configured accessibility verifier stops on a stale selector for a disclosure that was already absent at the starting commit. These are reported rather than hidden or broadened into this Tracker correctness change.

## A. Starting state

- Starting commit: `77aa35ee3472028e82a789e18162d07bb4985c85`
- Starting commit tree: `ba04dcd363d524a3180ca42894ac31865042093b`
- Branch: `integrate-release-candidate`
- Pre-existing working-tree state preserved without edits from this remediation:
  - modified `src/styles/app.css`
  - untracked `.claude/`
- The original audit package and addendum were read and retained as the immutable baseline. Corrected evidence uses new Phase 1 paths rather than replacing contradictory historical traces.

Phase 1 addressed the confirmed audit paths for:

| Finding | Starting reproduction path | Phase 1 disposition |
| --- | --- | --- |
| Wrong Moon phase | astronomy phase angle → `phenomena.ts` classification → cards/Calendar | Fixed at a new authoritative lunar model |
| Eclipse duration off by 60× | Astronomy Engine `sd_*` scalar → inline arithmetic → duration/window | Fixed at the dependency boundary with explicit contacts |
| False planetary opposition | routine planet placement → presentation label | Replaced with physical event generation; impossible cases are unrepresentable |
| Missing weather increases confidence | provider absence/error → empty snapshots → full access/ranking | Replaced with categorical environmental evidence and unknown confidence |
| Stale location result remains selectable | old async query → retained option → confirmed place | Query-version guard plus immediate result invalidation |
| Approximate address treated as identity | detailed input → provider similarity result → confirmed place | Full numbered addresses require matching number and street |
| Recommendation state becomes stale | memoized night plus changing time/location/weather → UI | Explicit plan identity and current-time/provider inputs |
| Reload loses authority | confirmed place lived only in component state | Versioned, minimal local persistence and recomputation |
| Audit package not reproducible | hard-coded user paths and mixed manifest roots | Portable resolution and split manifests |

## B. Root causes

| Defect | Owning layer and root cause |
| --- | --- |
| Moon phase | `phenomena.ts` interpreted a symmetric 0–180° illumination phase angle as a directional 0–360° lunar cycle. Multiple consumers could then restate the wrong semantic result. |
| Lunar eclipse | Astronomy Engine semi-durations, expressed in minutes, crossed the dependency boundary as ambiguous numbers and were multiplied as though they were hours. |
| Opposition/conjunction | A display classification was inferred from ordinary placement instead of a physical event model with body eligibility and angular geometry. |
| Environmental confidence | Missing snapshots were overloaded to mean pending, failed, unsupported, and genuinely unavailable; the scoring fallback could behave as if access were perfect. |
| Location search | Suggestions were not owned by a query identity. New input could leave an older result active, while geocoder similarity was treated as address confirmation. |
| Plan staleness | Location, period, timezone, model version, current time, and provider state did not share one invalidation contract. |
| Persistence | No minimal authoritative record existed; transient plan and weather state had no explicit non-persistence contract. |
| Harness provenance | Scripts embedded machine-specific roots and the packaged manifest mixed in files that were not packaged. Evidence classes were also not consistently distinguished. |

## C. Changes made

### Scientific model

- Added `scientificUnits.ts` with branded constructors and boundary validation for degrees, phase-cycle degrees, altitude, azimuth, angular separation, illumination fraction, minutes, milliseconds, and UTC instants.
- Added `lunarPhase.ts` as the sole classification path from Astronomy Engine's 0–360° `MoonPhase` cycle plus `Illumination.phase_fraction`.
- Added `lunarEclipse.ts` to convert the library's minute semi-durations into penumbral, partial, totality, maximum, and observable-phase structures.
- Added `planetaryEvents.ts` with an explicit superior-planet opposition allowlist, physical event search, and spherical angular separation.
- Updated `phenomena.ts`, opportunity science data, Calendar notability, cards, and detail UI to carry those owned meanings rather than rederive labels.
- Removed the unsupported ISS promotion from Tracker entry copy.

### Environmental authority

- Added `available`, `stale`, `unavailable`, `request-failed`, and `not-supported` evidence states.
- Missing temperature/precipitation values remain `null`; unknown sky remains `unknown`; absent evidence has no numeric access score.
- Provider fallback records attempts, respects abort, and never invents a forecast after failure.
- Ranking, verdict, conclusion, action line, and visible condition state share the same environmental status. Failed or missing data can retain an astronomical opportunity but must disclose that observing conditions are unknown.

### Location, time, plan, and persistence

- Location search uses a request version and abort signal; a new query immediately invalidates prior options.
- Full numbered-address input accepts only a structured result with matching house number and street and labels that match `Exact address`.
- Search input is draft state. Only explicit selection/confirmation changes the observing location.
- Plans are keyed by model version, rounded confirmed coordinates, timezone, and normalized observing-period start. Weather remains separately keyed to provider/location input.
- A minute cadence invalidates current-state projections, while period rollover creates a new plan. Selected detail resets when plan identity changes.
- Reload persistence stores schema version 1 plus confirmed place name/context, coordinates rounded to four decimals, and device-origin flag. It stores no forecast, plan, history, raw accuracy, or transient result. Restored state is visibly identified and all derived data is recomputed.

### Verification infrastructure

- Added a deterministic Tracker production review scenario and `--scenario tracker` support in the review runner.
- Removed user-specific roots and browser paths from audit scripts. Repository root, production URL, and optional browser executables now come from discovery, CLI arguments, or documented environment variables.
- Split packaged-artifact `MANIFEST.sha256` from live-repository `SOURCE_MANIFEST.sha256`. Verification fails on missing, malformed, or mismatched entries.
- Corrected Phase 1 science output uses a new trace, labels independent reference evidence separately from dependency/runtime output, adds opposition evidence, and retains the original trace and Buffalo evidence unchanged.
- Added a severity review that preserves every finding while refining full-address, ISS, reminder, mobile, performance, and accessibility release semantics.

## D. Science contracts

| Quantity | Contract |
| --- | --- |
| UTC instant | ISO-8601 UTC string; never used as a duration |
| Duration | Named minutes at the astronomy boundary; conversion to milliseconds only through a helper |
| Moon cycle | Geocentric Moon-minus-Sun ecliptic longitude in `[0, 360)` |
| Illumination | Apparent illuminated fraction in `[0, 1]`; not used to infer waxing/waning |
| Lunar phase | One classification from the 0–360° cycle, with a declared ±3° principal-phase tolerance |
| Eclipse `sd_*` | Semi-duration in minutes; contacts are `maximum ± semi-duration`; full phase duration is twice the semi-duration |
| Altitude | Degrees in `[-90, 90]` |
| Azimuth | Degrees normalized to `[0, 360)` |
| Angular separation | Great-circle separation in degrees `[0, 180]` |
| Opposition | Earth between Sun and a supported superior planet; only Mars, Jupiter, and Saturn are representable in Tracker Phase 1 |
| Conjunction | A generated close pairing carrying actual spherical separation, not a decorative label |

Tracker computes Moon altitude at eclipse contacts and suppresses an eclipse if no contact is above the local horizon. The UI states that contacts are global model-derived circumstances, local altitude is checked, and no regional visibility map is provided.

## E. State and authority contract

The recommendation's authoritative location is the confirmed place, never the search field or an unconfirmed provider result. A search result belongs to the exact request version that produced it. Superseded location and weather work is aborted or isolated under a different query key and cannot update the newer plan.

The astronomical plan identity is:

`model version | confirmed latitude | confirmed longitude | timezone | observing-period start`

The observing-period start is normalized to whole-second precision for stable identity across reloads; the underlying astronomy timestamps retain their full precision. Current time, environmental query state, and forecast freshness are explicit projection inputs. A changed plan identity clears selected derived UI state. Calendar → Tonight and reload both return to data computed from the current authority set.

## F. Environmental-confidence contract

- `available`: usable current forecast; environment may improve or reduce the combined recommendation.
- `stale`: usable but explicitly old forecast; state remains stale in copy and evidence.
- `unavailable`: no usable forecast yet or returned; astronomical facts may remain, observing confidence is unknown.
- `request-failed`: eligible provider attempts failed; the UI says conditions are unknown/check before going.
- `not-supported`: no eligible provider; the UI does not imply a failed provider or known conditions.

Unknown environmental evidence has `access: null` and band `unknown`. It cannot rank higher than the same astronomical opportunity under verified clear conditions, cannot produce `Exceptional` or `Worth going out for`, and cannot be described as if the sky was checked.

## G. Tests added and updated

| Contract / prior failure | Deterministic coverage |
| --- | --- |
| All eight lunar phases and audited August 2026 waning case | `lunarPhase.test.ts`; production schedule/Calendar assertion; independent USNO comparison in the Phase 1 science trace |
| Eclipse semi-duration units, contact order, partial duration, profile/ranking propagation | `lunarEclipse.test.ts`; audited 2026-08-28 NASA vector in science trace |
| Valid Jupiter opposition, impossible Venus case, conjunction, angular separation, Calendar presentation | `planetaryEvents.test.ts` |
| Missing/failed/stale environmental evidence and no confidence inversion | `conditions.test.ts`, `opportunity.test.ts`, `weatherProviders.test.ts` |
| Provider fallback, null fields, abort/failure behavior | `weatherProviders.test.ts` |
| Exact numbered address, approximate mismatch, coordinate input | `geocoding.test.ts` |
| Location/timezone/period/model plan invalidation and same-night identity stability | `schedule.test.ts` |
| Minimal schema, rounding, invalid schema rejection, restored marker | `trackerPersistence.test.ts` |
| Exact address, stale/no-result query, failed weather, false opposition absence, changed/restored plan identity | `scripts/review/scenarios/tracker.mjs` plus its state validator test |

Final full-suite result: 76 test files, 548 tests passed, zero skips reported.

## H. Production verification

| Scenario | Before | Final production result |
| --- | --- | --- |
| Audited August 2026 Moon | Wrong phase/direction | Joshua Tree 2026-08-06 is `Waning Crescent`, 45% computed illumination; independent USNO reference says `Waning Crescent`, 42% |
| 2026-08-28 lunar eclipse | Impossible multi-day duration | Maximum `04:12:49Z`; partial contacts `02:33:23Z–05:52:14Z`; displayed 199 minutes versus NASA 198-minute reference |
| Venus opposition | Venus could be labelled Opposition | No Venus opposition object or Calendar label; Jupiter 2026-01-10 remains a valid opposition |
| Failed weather | Could receive favorable access/copy | Deterministic UI state is `request-failed`, sky is unknown, and copy says to check conditions before going |
| Full address | Similarity could silently stand in for identity | `350 5th Avenue, New York, NY 10118` is accepted only with matching number/street and shown as `Exact address` |
| Stale search | Old result remained selectable after no-result query | New nonsense query shows zero options and an explicit no-match state |
| Location replacement | Derived plan could refer to old coordinates | New confirmation changes the keyed identity; superseded request/result cannot become authority |
| Reload | Location disappeared or identity drifted | Confirmed place displays `Restored`; two reloads produced identical plan identity `phase-1-2026-08-19|45.515200|-122.678400|America/Los_Angeles|2026-08-20T03:11:12.000Z` |
| Calendar eclipse detail | Duration/classification not trustworthy | Chrome production UI shows Partial lunar eclipse, ordered contact labels, maximum, and 199-minute visible phase; no Venus opposition |

Chrome baseline viewport was 1440×900. WebKit automation was attempted for the state/location-critical desktop subset but the repository-matched WebKit binary was not installed. No WebKit or mobile remediation claim is made.

## I. Evidence

- `tracker-audit-addendum/evidence/traces/science-validation-phase1.json` — independent USNO/NASA references separated from production/dependency observations.
- `tracker-audit-addendum/evidence/phase1/chrome-production-phase1.json` — final Chrome state, stable reload identity, Calendar classification.
- `tracker-audit-addendum/evidence/phase1/chrome-final-restored.png` — confirmed restored location and Tonight production state.
- `tracker-audit-addendum/evidence/phase1/chrome-calendar-eclipse-final.png` — corrected eclipse contacts/duration and classification.
- `tracker-audit-addendum/evidence/phase1/validation-summary.json` — exact validation outcomes and blockers.
- `tracker-audit-addendum/evidence/phase1/webkit-unavailable.json` — optional-engine availability result.
- `review/` — final deterministic Tracker-only production review package after rerun.
- `SOURCE_MANIFEST.sha256` and `MANIFEST.sha256` — final source and packaged-artifact identity.

## J. Remaining known issues

These confirmed audit findings remain for later phases and are not claimed fixed:

- mobile layout/clipping and comprehensive responsive behavior;
- severe supported-scale synchronous planning stalls and broader performance architecture;
- Calendar ARIA grid hierarchy and broad accessibility remediation;
- inert secondary reminder controls and reminder redesign;
- regional eclipse/aurora maps, visibility ribbons, phenomenon-browser work, and media redesign;
- broad Calendar redesign;
- the pre-existing unbalanced `@media (min-width: 1180px)` rule in user-modified `src/styles/app.css`;
- the pre-existing full-review Explorer 1,000× playback transition timeout;
- the pre-existing accessibility verifier's obsolete `.tracker-detail > button` step.

The unsupported ISS promotional row was removed because leaving a materially false capability statement would violate Phase 1's trust objective; no ISS functionality was added.

## K. Audit-harness corrections and rerun contract

From the repository root, with `EVIDENCE` pointing to `tracker-audit-addendum/evidence`:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4174
node "$EVIDENCE/browser-audit.mjs" --repo . --base-url 'http://127.0.0.1:4174/?app=tracker'
node "$EVIDENCE/chrome-states-audit.mjs" --repo . --base-url 'http://127.0.0.1:4174/?app=tracker'
node --experimental-strip-types --loader "$EVIDENCE/ts-resolve-loader.mjs" "$EVIDENCE/science-audit.ts" --repo .
node "$EVIDENCE/generate-manifest.mjs" --repo .
node "$EVIDENCE/verify-manifest.mjs" --repo .
```

`--repo` can be replaced with `TRACKER_REPO_ROOT`; `--base-url` can be replaced with `TRACKER_BASE_URL`. Optional browser executables use `TRACKER_CHROME_EXECUTABLE` and `TRACKER_WEBKIT_EXECUTABLE`. Outputs resolve from the script location. Missing source/artifact files fail verification; they are never ignored.

## L. Validation and release status

| Command | Outcome |
| --- | --- |
| `npm test -- --reporter=dot` | PASS — 76 files, 548 tests |
| `npm run build` | EXIT 0 — production build produced; CSS syntax and large-chunk warnings remain |
| `npm run review -- --scenario tracker` | PASS — Tracker Phase 1 review package generated |
| `npm run review` | FAIL — unrelated Explorer scenario times out after setting 1,000× while playback remains stopped |
| `npm run a11y:verify` | FAIL — stale pre-existing `.tracker-detail > button` selector times out |
| WebKit Phase 1 subset | UNAVAILABLE — matching Playwright WebKit executable is not installed |
| `git diff --check` | PASS |

The known Moon, eclipse, planetary, environmental, stale-search, confirmed-location, async authority, deterministic reload, portable-harness, and explicit-manifest criteria all have implementation and focused evidence. Release status remains incomplete solely because the repository-wide final-source validation gates above are not clean and fixing unrelated Explorer, broad accessibility tooling, or the user's pre-existing stylesheet would exceed this authorized Phase 1 scope.

PHASE 1 INCOMPLETE
