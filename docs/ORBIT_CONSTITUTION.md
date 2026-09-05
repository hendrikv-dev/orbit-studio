# Orbit Studio Constitution

## Authority

This document is the canonical source for durable Orbit Studio product principles. It is subordinate
to an explicit current user request and to the engineering procedure in `AGENTS.md`. Architecture,
design, data, and review documents may apply these principles to the current product but may not
weaken or replace them. Existing behavior is not justification for violating a principle.

## Mission

Orbit Studio helps people understand orbital and celestial systems, and humanity's activity within
them, through scientifically grounded exploration. It must make complexity approachable without
making the underlying claim less truthful.

When goals conflict, scientific honesty, lawful data use, accessibility, and user comprehension are
constraints. Visual polish, density, convenience, and performance must be optimized within those
constraints, not traded against them silently.

## Audience

Orbit Studio is for **students and educators in aerospace and the space industry**. Every
product decision is judged against whether it helps someone learn the subject or teach it.
This audience is shared by every tool; no tool serves a different one.

It is not a professional operations product. The distinction is purpose, not subject
matter: operational decision support — conjunction assessment for maneuver decisions,
fleet management, mission operations — is out of scope, while the same underlying
phenomena are in scope wherever they help someone learn. Predicting when the ISS passes
over a school is teaching; screening a fleet for avoidance maneuvers is operations.
"An operator would want this" is not by itself a reason to build anything.

## Tools

Orbit Studio is composed of **tools**. A tool is the top-level unit of the product and
the set is open: new tools may be added when they serve the audience above and can state
their epistemic contract. Three are defined.

- **Explorer** — what is and was real. Never presents hypothetical simulation as
  historical reality.
- **Playground** — what is possible. Everything in it is explicitly the user's own
  construction.
- **Tracker** — what can I see from my location, when can I see it, and how do I see it.
  Predictions, carrying their reliability with them.

**Environment is not a synonym for tool, and it is not a smaller number.** It describes
the epistemic pairing of Explorer and Playground, which are divided by whether their
content is real or constructed. Tracker's content is neither: it is predicted. Calling
Explorer and Playground environments is a statement about those two tools and says
nothing about how many tools Orbit Studio may have.

## Product Boundaries Are Not Implementation Boundaries

What is a tool, what belongs in which tool, and who a tool serves are product decisions.
They are not inferred from bundle structure, renderer architecture, module dependencies,
data sources, or shared libraries.

Implementation properties are consequences of product decisions and evidence about their
cost. They are never the argument. A capability that needs its own bundle, its own
renderer and its own data feed may still be one tool among several; a capability that
shares every dependency may still belong to a different product. Cite implementation
facts as cost, never as boundary.

## 1. Scientific Claims Must Be Bounded

Every physical claim must be supported by evidence and a model valid for the claimed quantity,
instant, interval, and precision. Higher fidelity is valuable only when it changes interpretation or
the learning outcome and can be validated; apparent precision without support is a defect.

Keep these provenance classes explicit from source ingestion through user-visible output:

- **source record or observation** — retained with source meaning, epoch, and uncertainty;
- **model-derived state** — computed from source records containing the model's required parameters,
  using an identified model within its validity limits;
- **reconstruction or inference** — constrained by incomplete evidence and unable to recover a
  unique historical or physical state;
- **illustration** — explanatory content that makes no claim to be a physical state.

No layer may silently promote one class into another. Model-derived and reconstructed values are not
measurements. A value may be called exact only when the quantity, reference instant, and tolerance
make that claim meaningful; reconstructed positions are never exact observations. Display scaling
must remain separate from physical values and must not imply a physical measurement.

Uncertainty material to interpretation must be available at the point of interpretation, not only
in developer documentation or provenance metadata.

## 2. One Scene Has One Physical State

Systems describing the same scene must derive from one authoritative simulation instant and
compatible frames, units, epochs, and lifecycle rules. Externally sourced, persisted, transformed,
or rendered scientific state must make those conventions explicit at its boundaries.

At the same authoritative inputs and instant, playback speed, selection, filtering, visibility,
camera, cache state, worker path, and interactive versus automated entry must not change object
existence, classification, provenance, or physical state. Objects must not appear outside their
supported lifecycle or source/model validity interval.

## 3. Determinism Must Preserve Meaning

Identical authoritative inputs must produce identical scientifically meaningful outputs within
declared numerical tolerances. Random seeds, wall-clock time, network responses, locale, source
versions, and configuration that can affect meaning must be explicit inputs.

Scheduling, batching, interpolation, caching, retries, and hardware may affect delivery timing or
visual smoothness but must not change the resulting state or story. Late or stale work must not
replace newer authoritative state. Determinism must be observable at production boundaries, not
inferred from deterministic helper functions.

## 4. Provenance, Rights, and Reproducibility Are Product Data

Every scientific dataset and model must document source, version or acquisition date, license or
usage basis, selection, transformations, units and frames where relevant, update strategy, validity,
uncertainty, and known limitations. Derived artifacts must be reproducible and traceable to their
inputs and generation process.

Unknown or incompatible rights block redistribution. Credentials and restricted archives must not
become public-repository or client-runtime dependencies without an explicit lawful decision.
Collect and retain only user data needed for an explicit purpose, protect private scenarios and
diagnostics, and treat external data and content as untrusted.

## 5. Absence and Failure Must Remain Honest

Unavailable, unsupported, invalid, stale, out-of-range, or legally unusable data must remain
unavailable or be clearly identified. Never fill a scientific gap with a decorative value, a current
state at another date, a frozen previous state, or an undisclosed approximation.

Loading, offline, reduced-fidelity, performance, and error behavior may reduce detail, but must not
silently change existence, eligibility, classification, provenance, or physical meaning. The
interface must distinguish “not loaded,” “not available,” “not supported,” and “not present” when
that difference affects interpretation.

## 6. Educational Integrity

Teach the evidence and its limits, not only the image. Historical continuity, scale, causality,
uncertainty, and coverage must not be invented to make a smoother narrative. A simpler truthful
explanation is preferable to a richer misleading one.

Labels, milestones, narratives, and lessons must be traceable to named sources whose authority and
limitations are documented for the claim. They must not assert more certainty, causality, or
completeness than the underlying evidence.

Terminology should be understandable before it is exhaustive, but progressive disclosure must not
hide qualifications necessary for correct interpretation.

## 7. UX Must Communicate One Coherent Reality

Where a workspace contains a spatial visualization, that visualization is the primary product
surface. Interface elements must earn attention by supporting exploration, orientation,
comprehension, or precise action.

Displayed time, scene state, scope, selection, filters, details, warnings, provenance, uncertainty,
availability, and action-versus-status semantics must agree. Selection and filtering must not create
contradictory realities. Loading, empty, error, and reduced-fidelity states must be deliberate,
stable, and understandable.

Accessibility is correctness. Essential meaning and actions must remain available through keyboard
and assistive technology, visible focus, adequate targets and contrast, responsive layouts, and
reduced-motion behavior where motion is not essential to the information. Do not rely solely on
color, motion, hover, or visual density to convey essential state.

Actions must be predictable. Destructive, irreversible, or externally consequential actions require
clear intent and confirmation or recovery proportional to their consequence.

Prefer direct manipulation, search, contextual detail, and progressive disclosure over permanent
chrome or parameter hunting. Reduce cognitive load without hiding capability or scientific caveats.
Beauty must strengthen hierarchy, comprehension, and curiosity rather than decorate ambiguity.

## 8. Architecture Must Defend the Product Truth

Each domain concept must have one authoritative owner and mutation contract; all writes must
reconcile through that authority. Derived caches and projections are permitted only when they cannot
become competing truth and their invalidation is explicit. Selected/unselected,
foreground/background, interactive/automated, and production/review paths must resolve through the
same scientific and product logic.

Favor coherent, maintainable systems over parallel implementations and hidden coupling. Concurrency
and performance mechanisms must preserve causality, determinism, and scientific meaning. Development
instrumentation must observe production behavior without changing it.

## 9. Claims Require Current, Independent Evidence

Correctness claims must be falsifiable and supported by evidence proportionate to their consequence.
Scientific reference values must be independent of the implementation under test. Same-model
verification vectors may establish conformance but cannot establish real-world accuracy; that claim
requires observational evidence or a suitably independent reference. Runtime and renderer evidence
must verify what users actually receive, not only upstream state or intent.

Review artifacts must identify their source, inputs, and environment; agree with displayed and
rendered state; and be regenerated after material changes. Passing tests do not overrule contradictory
runtime evidence. When documentation, tests, review infrastructure, runtime state, and visible output
disagree, the claim is blocked until the discrepancy is explained and resolved.

## Amendments

An amendment must be explicit and record the problem, rationale, alternatives, tradeoffs, and effect
on existing behavior and documentation. Conflicting subordinate guidance must be updated or retired
in the same change. Product pressure, implementation convenience, or existing precedent is not by
itself sufficient justification to weaken a principle.
