# NASA meteor replacement ledger

Source parent: `302a8c88c46f3236dbe3649d3004c9b50670f473`. Frozen baseline and approved deep-sky worktree remain unchanged. This is a separate replacement, not Tracker extraction.

This is the implementation-time ledger, not a claim of completed release verification.
The final requirement statuses, exact source identity and actual command outcomes belong
to the append-only external replacement/commit review package. Pending cells below must
be closed there before this replacement is reported complete.

Affected classes: scientific frames/time, data/licensing, derived generation, runtime event/ranking/rendering regression, documentation. No product architecture, equipment, camera, satellite, or UI redesign.

| Requirement | Implementation / intended invariant | Validation | Status |
|---|---|---|---|
| Twelve identities and consumed fields | NASA-only normalized input; omit unused parent/IAU number | Identity/schema/source row checks | Pending |
| Explicit J2000 anchors | CP 2011 Table 1, PDF p22 / printed p10, all 12 rows; preserve corresponding J2000 solar longitude | Direct PDF inspection; coordinate tests | Source inspected |
| 2026 timing and ZHR | Forecast Table 3, PDF p8, seven current showers; handbook/overview calendar peaks for remaining five | Published instants/date comparisons | Pending |
| Activity bounds | Handbook Table 2 / overview p17 dates -> 2026 Astronomy Engine solar longitude; inclusive last calendar day | Deterministic generation/boundary tests | Pending |
| Population/speed | MEO methods Tables 2/3 and handbook Table 2; preserve speed reference semantics | Per-row comparison | Pending |
| Editorial widths | Retain first-party coarse widths separately; do not adopt radar profile coefficients or claim NASA sourcing | Model parameter documentation/tests | Pending |
| Correct radiant transforms | Fixed EQJ/ECL drift from published anchor, then EQJ/EQD; no of-date Ecliptic result treated as fixed ECL | Anchor, drift, horizon, renderer-path tests | Pending |
| Remove old source/fallback | Remove transcription and unresolved inventory/exception; no generator/runtime reads of old values | Repository/bundle search; provenance checks | Pending |
| Behavior equivalence | Same rate/recommendation/event/Sky APIs, apart from documented source-backed values and frame correction | Focused/full tests; browser review/screenshots | Pending |
| Final release | Full tests, type/build, accessibility, licensing/provenance/history/source/release checks | Final-source external logs/package | Pending |
| Exact commit and clean tree | Commit-specific inspected review package; unchanged baseline tag | Git/source identity | Pending |

Risk/rollback: source values are not observational accuracy claims. Calendar-only peaks are normalized to noon UTC, not invented minute-precision forecasts. Outside 2026 the fixed annual profile remains a typical recurrence approximation, not an annual outburst forecast. Revert the replacement commit if rejected; do not silently reinstate legacy values as an operational fallback.

Investigation found `Ecliptic(EQJ)` returns true ecliptic of date, contrary to the existing J2000 comment. The narrow correction uses the explicit fixed J2000 rotation. Source anchors must not be reassigned to newer peak dates. NASA CP Table 1 supplies both solar longitude and radiant in J2000; the former is retained as its own anchor rather than confused with apparent-of-date peak longitude.

No physical-phone evidence is available; this data replacement makes no camera registration/AR accuracy claim.
