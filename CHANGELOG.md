# Changelog

All notable changes to Orbit Studio will be documented in this file.

The project uses a lightweight changelog format inspired by Keep a Changelog.

## Unreleased

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
