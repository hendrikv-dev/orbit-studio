# Orbit Studio Engineering Standard

## Authority and Terms

This file is the canonical engineering procedure for all changes to code, data, documentation,
tooling, dependencies, and generated artifacts.

Instruction precedence is:

1. the explicit current user request;
2. this file;
3. `docs/ORBIT_CONSTITUTION.md`;
4. other repository documentation;
5. the existing implementation.

When authorities conflict, the higher authority controls. Surface the conflict before acting when it
is unclear whether the higher-level instruction intentionally overrides the lower one. Existing code,
tests, reports, and precedent are evidence, never authority.

This file defines decision and completion gates; it cannot prove its own compliance. Compliance is
established only by current evidence produced through these gates.

In this standard:

- **must** denotes a completion gate; it cannot be skipped silently;
- **material** means capable of changing user-visible behavior, scientific meaning, data or license
  status, a public contract, authoritative state, concurrency, security or privacy, supported-scale
  performance, or the validity of evidence;
- **applicable** means required by the request or triggered by a change class in the validation
  matrix below; a gate may be marked not applicable only with a recorded reason;
- **final source** means the exact source tree used to produce evidence, including uncommitted and
  untracked content.

## Gate 1 — Investigate

Do not edit before completing this gate.

1. Read the entire request, this file, the Constitution, and every repository document that governs
   an affected change class.
2. Inspect repository status and preserve unrelated work. Do not erase, rewrite, or claim another
   contributor's changes.
3. Trace every path affected by the request. For runtime behavior, trace the active production path
   from authoritative input and state through caches, workers, transforms, rendering, and
   user-visible output. Identify affected alternate and legacy paths.
4. For a defect, reproduce it and record the initial state, exact steps, expected result, observed
   result, environment, and baseline evidence. If reproduction is blocked, record the attempt and
   reason; an assumed reproduction is not evidence.
5. Identify state ownership, write paths, derived caches, invalidation, asynchronous boundaries,
   failure modes, dependencies, security and privacy boundaries, and likely regressions.
6. For scientific, temporal, or data work, identify source, version, license, acquisition or epoch,
   time scale, units, reference frames, transformations, validity interval, uncertainty, lifecycle,
   and any display-only transformation.

Stop and request direction when progress requires a product decision or material scope expansion not
authorized by the request. Do not disguise a product decision as implementation cleanup.

## Gate 2 — Define the Claim and Plan

Maintain a requirement-to-evidence ledger for the task. It may be in working notes, but before
completion every requirement must map to:

- the intended behavior or invariant;
- the implementation location;
- the validation method;
- current evidence or a blocker;
- final status.

Classify each affected area: documentation, UI/accessibility, rendering, simulation/time/science,
asynchronous/worker, data/licensing, architecture/state ownership, security/privacy, performance, or
build/review tooling. A change may trigger several classes.

For each triggered change class, the plan must cover the applicable root cause or governing
hypothesis, authoritative state and interfaces, migration and removal of superseded paths, failure
behavior, tests, runtime scenarios, deterministic evidence, documentation/provenance changes, and
rollback or honest degradation strategy. Record why an item is not applicable rather than creating
placeholder work. Material assumptions require repository or primary-source support; otherwise they
remain blockers.

Choose the smallest coherent change that resolves the root cause. This means limited scope, not a
minimum diff. Do not preserve duplicate systems with a local patch or start a broad refactor without
an identified boundary, migration, and validation plan.

## Gate 3 — Implement

- Give every domain concept one authoritative owner and mutation contract. All writes must reconcile
  through that authority. Caches, indexes, review bridges, and render buffers are derived views; they
  must be keyed, invalidated, and prevented from becoming competing truth.
- Use the same production logic for selected and unselected, visible and background, interactive and
  automated-review paths. Test-only adapters may observe or drive production state but must not
  replace product logic.
- Remove or disable superseded paths in the same change. If compatibility requires two paths,
  document ownership, precedence, convergence, and removal conditions.
- Keep physical state separate from display scaling and presentation. Preserve provenance and
  uncertainty through data, state, renderer, UI, diagnostics, and review artifacts.
- Treat unsupported, invalid, stale, unavailable, or out-of-range data explicitly. Never substitute
  decorative, current, cached-old, or reconstructed state without the classification and disclosure
  required by the Constitution.
- Version or cancel asynchronous work so stale, duplicated, late, or out-of-order results cannot
  overwrite newer authoritative state. Teardown and restart must not leak work or state.
- Preserve affected accessibility, keyboard, focus, responsive, loading, empty, and failure behavior.
- Treat external input as untrusted. Keep credentials and private data out of source, client bundles,
  logs, review evidence, and generated artifacts.
- Add or update tests, diagnostics, review scenarios, provenance, and documentation with the behavior
  they validate.
- Do not delete, skip, narrow discovery, loosen tolerances, or weaken assertions to make validation
  pass unless the request explicitly changes the requirement and replacement coverage is proved.
- Add dependencies or datasets only after documenting maintenance, source, license or usage basis,
  precision, update strategy, security exposure, and failure behavior.
- Keep dependency manifests and the repository lockfile synchronized through the existing package
  manager; do not hand-edit resolved dependency state.

Scaffolding, disconnected state, a passing helper, or implementation intent is not completion.

## Gate 4 — Validate the Final Source

Run applicable gates after the last material change. Any later material edit invalidates downstream
results. A failed, flaky, timed-out, or skipped required check is a failure, not a pass; rerunning
until green without explaining the cause is prohibited.

### Baseline gates

- Inspect the final diff and status for unintended files, generated output, disabled checks, and
  unrelated changes.
- For code, runtime data, dependency, or tooling changes, run focused tests during iteration and the
  full configured test suite before completion.
- Report all skipped tests. A pre-existing intentional skip may remain only when its condition is
  documented and it does not cover affected behavior; otherwise the missing coverage is a blocker.
- For application code, runtime data, dependencies, or build inputs, run the production build and
  configured type and lint checks.
- If test files, configuration, fixtures, snapshots, scripts, discovery patterns, or skip conditions
  change, compare collected and skipped tests before and after and justify every reduction.
- For documentation-only changes, validate links, commands, authority, terminology, and internal
  consistency. Application test/build gates are not required unless executable examples or data,
  build, test, or review contracts change.
- Run `npm run review` for completed features and changes to reviewed UI, rendering, simulation,
  timeline, catalog, or interaction behavior.

### Change-class validation matrix

| Change class | Required proof |
| --- | --- |
| UI or accessibility | Exercise every affected state in a production build at supported viewport and input modes; verify keyboard order, focus, accessible names/semantics, loading/empty/error states, reduced-motion behavior when animation changes, and browser console. |
| Rendering | Compare authoritative application state, renderer queue/buffers, and actual visible output; test selection, filters, camera, culling, and resource loading where affected. Upstream counts alone are insufficient. |
| Simulation, time, or science | Use fixed boundary and representative instants; verify units, frames, axes, lifecycle, pause/step/scrub/speed behavior, and independent reference values with tolerances chosen and justified before viewing results. Distinguish model agreement from real-world accuracy. |
| Async, worker, or cache | Exercise cold/warm caches, rapid state changes, cancellation, stale and out-of-order responses, restart/teardown, failure recovery, and repeated runs. Prove the final state matches the newest authoritative input. |
| Dataset or licensing | Validate schema, checksums, provenance, license/usage basis, deterministic generation, identities, lifecycle, category and coverage counts, additions/removals, and redistribution status. Compare before and after; unexplained loss blocks completion. |
| Architecture or state ownership | Show the authority and dependency boundaries before and after; prove superseded reads/writes are removed, migrations and compatibility work, and tests exercise the production path rather than a parallel implementation. |
| Security, privacy, or external input | Document trust and data-flow boundaries; exercise malformed and adversarial input, authorization and failure paths where present, secret handling, client/log/artifact exposure, and data minimization. A successful happy path is insufficient. |
| Performance-sensitive path | Test the current production data volume, documented supported limits, and constrained conditions. Record measurements for performance claims and prove optimization does not change eligibility, classification, state, or deterministic output. |
| Build, test, or review tooling | Demonstrate a known failure is detected and a valid case passes. Prove generated evidence comes from the production build and that the tool cannot silently succeed with missing scenarios or artifacts. |

### Scientific independence

Reference values must be independent of the implementation under test. Established verification
vectors for the same named model may prove model conformance; they do not prove real-world accuracy.
Claims about physical accuracy require observational evidence or a suitably independent higher-order
reference. Record source, timestamp/version, frame, units, value, computed value, error, and
predeclared tolerance. Self-consistency, visual plausibility, or two functions sharing a dependency
is not independent validation.

### Evidence validity

Evidence must record the final source identifier, inputs, simulation timestamp, scenario,
environment, expected and observed result, and artifact path; UI and rendering evidence must also
record the viewport. If the tree is dirty or untracked, record that fact and content hashes for
material inputs; a commit identifier alone must not be presented as identifying the build.

Machine-readable state does not prove visible output, and a screenshot does not prove hidden state.
Use both when the claim crosses that boundary. Review infrastructure is part of the system under
test: cross-check it against direct runtime and renderer observations. New console warnings, missing
artifacts, unexplained count differences, or metadata/visual disagreement are failures.

Evidence generated before the final material change, from another build, or under unknown inputs is
stale and must not be used.

## Gate 5 — Stop Conditions and Failure Handling

Do not claim completion while any of the following is true:

- a requirement lacks implementation or valid evidence;
- runtime, renderer, tests, review artifacts, documentation, or reports disagree;
- the defect fix cannot be observed in the affected production path;
- a required check is failing, skipped, flaky, or blocked;
- nondeterminism, a race, stale state, or an unexplained warning remains;
- scientific validity, provenance, lifecycle, uncertainty, or tolerance is unresolved;
- license or redistribution status is unknown for an artifact intended for release;
- a material assumption or product decision remains unresolved;
- a superseded authority path or undocumented compatibility path remains;
- evidence is stale or cannot be tied to the final source.

For an external blocker, exhaust safe in-scope alternatives, then report the exact command or action,
failure, affected requirement, completed work, and missing evidence. A blocker is not a pass. Do not
hide failure by changing assertions, tolerances, fixtures, warnings, filters, or scope.

## Gate 6 — Adversarial Review and Re-engagement

After validation, re-read the request and the requirement-to-evidence ledger. Attempt to falsify each
claim using applicable boundary, unavailable, invalid, failure, alternate-entry, cold/warm,
pause/resume, rapid-transition, concurrency, viewport, keyboard, and reduced-resource cases.

Search the final source for duplicate authorities, stale caches, dead or parallel paths, hidden
fallbacks, unversioned async work, scientific overclaims, UX contradictions, licensing drift, and
validation exclusions. Inspect the final diff and evidence as if reviewing another engineer's work.

If a material issue is found, return to the earliest affected gate. Repeat all invalidated downstream
gates. After the first clean pass, perform a second fresh pass focused on assumptions and ways the
first review could have produced false confidence. Stop only when another pass finds no material
in-scope defect or improvement.

## Gate 7 — Completion and Reporting

Work is complete only when every ledger item passes, every applicable gate passes, runtime behavior
is verified where required, evidence reflects the final source, all stop conditions are cleared, and
remaining limitations are stated without broadening the claim.

Compilation, tests, review artifacts, screenshots, or code inspection alone are never sufficient.

Within the user's requested report format, report files and reasons, exact commands and outcomes,
runtime scenarios, evidence paths, limitations, uncertainties, and blockers. Never claim broader
scientific accuracy, dataset coverage, performance, accessibility, security, or release readiness
than the evidence establishes.

## Changing This Standard

A change to this file must be explicitly in scope. Record the weakness or bypass being addressed,
why the revision is enforceable, process cost introduced or removed, and subordinate documents that
must be reconciled. Stress-test the revised standard against realistic failure scenarios before
accepting it.
