# Automated UX Review Pipeline

Orbit Studio's review pipeline produces a deterministic, machine-readable review package from the
production build. It is development infrastructure for UX, historical timeline, scientific
correctness, and regression review. It is not a replacement for the unit test suite or a performance
benchmark.

## Run the review

Install the Playwright Chromium browser once after installing dependencies:

```sh
npx playwright install chromium
```

FFmpeg must be available on `PATH` to create the required H.264 MP4. Set `FFMPEG_PATH` when the
binary is installed elsewhere.

```sh
npm run review
```

The command builds the production application, launches an isolated Vite preview, runs every
registered scenario in headless Chromium, writes the review package, closes Chromium and the preview
server, and exits. It does not require an existing development server or human input.

The runner holds an exclusive `.orbit-review.lock/` while it owns the shared `review/` output.
A concurrent invocation fails before cleanup so it cannot remove or mix another run's evidence. If
a terminated process leaves the ignored lock behind, first verify that no review process is active,
then remove only `.orbit-review.lock/` before retrying.

## Review package

The generated `review/` directory is intentionally ignored by Git and contains:

```text
review/
  ATTRIBUTION.md
  THIRD_PARTY_NOTICES.md
  review.json
  REVIEW_NOTES.md
  timeline.mp4
  timeline.csv
  provenance/
    inventory.json
  screenshots/
    startup.webp
    explore-featured.webp
    explore-constellations.webp
    selected-starlink-overview.webp
    selected-starlink-data.webp
    display-settings.webp
    search-jwst.webp
    selected-jwst-overview.webp
    selected-jwst-data.webp
    1957.webp
    1965.webp
    1980.webp
    1990.webp
    2000.webp
    2015.webp
    current.webp
    leo.webp
    geo.webp
    milestone-1957.webp
    milestone-1961.webp
    milestone-1969.webp
    milestone-1978.webp
    milestone-1990.webp
    milestone-1998.webp
    milestone-2015.webp
    milestone-2019.webp
```

`review.json` is populated through the opt-in application review bridge, not OCR. Each captured state
records the canonical simulation UTC, selected timeline UTC and year, alignment status, complete
catalog and rendered-object counts, source-record orbit coverage, category counts, selected object,
query, active discovery collection, active filters, playback state, and screenshot path. Review
schema 5 also records the actual
renderer queue, GPU point count, rendered provenance counts, camera state, position-buffer digest,
screen-visible count, actual GPU-buffer UTC and lag, and warning state. Dataset versions, the Git revision, dirty state, viewport,
scenario registry, milestone validation, five-speed determinism results, and browser diagnostics are
recorded at the package level.

Schema 3 added a `source` identity containing the repository boundary, commit, dirty-state count,
tracked and included source-file counts, and a SHA-256 digest of the final non-ignored source tree.
The digest identifies dirty or untracked content that a commit alone cannot describe.

Schema 4 adds moving-playback evidence at every supported speed. It records sampled authoritative
and renderer UTCs, buffer lag, GPU-facing position digests, population counts, and observed clock
rate so an advancing clock with a frozen or stale render buffer cannot pass.

Schema 5 adds the current-catalog mode and record count and copies the exact authoritative
provenance inventory, project attribution, and locked-dependency notices used by the production
build into the review package.

`timeline.csv` is sampled at four states per second from the same deterministic frame sequence used
to encode `timeline.mp4`. Its first row is the first video frame and its last row is the final frame.
It records simulation time, selected year, catalog membership, visible population, source-record
coverage, reconstructed states, catalog-only members, GPU/rendered/visible counts, warning state, and
the position-buffer digest without inspecting pixels. The schema field
`exactOrbitStateCount` retains its legacy name for compatibility; it counts non-reconstructed source
records and is not a claim of exact physical position.

Review mode is enabled only by `?review=1`. Public release mode pins Current to the documented
2026-07-18 representative-orbit reference date and pauses playback before the scenario loads, which
makes screenshots and state metadata reproducible. It explicitly records zero locally acquired
current catalog records. Normal Explorer startup and playback behavior are unchanged. A release
review must not use `ORBIT_CURRENT_CATALOG_MODE=local`.

## Scenario architecture

The runner in `scripts/review/run-review.mjs` owns the invariant pipeline: build, preview lifecycle,
browser configuration, state settling, WebP capture, MP4 encoding, metadata generation, and cleanup.
Workspace-specific behavior lives in `scripts/review/scenarios/`.

A scenario exports:

- `id` and `title`;
- the three generated review-note lists;
- `run(tools)` for deterministic states and screenshots;
- optionally `recordTimeline(tools)` for the standard short clip.

Scenario tools include `capture`, `captureTimelineFrame`, `clearReviewContext`, `setTimelineYear`,
`setTimelineSnapshot`, `setPlaybackSpeed`, `samplePlaybackMotion`, `setRegimeFilter`, `waitForState`, `readReviewState`, and
the Playwright `page`. Prefer application-bridge actions for exact temporal
states and product locators for the interaction being reviewed. Never derive metadata from pixels.

The Explorer scenario visits every declared historical milestone. It fails when resolver counts do
not match the point-renderer queue, GPU buffer, or provenance counts; when a populated milestone has
no camera-visible instance; when warning state disagrees; or when 1×, 10×, 100×, 1000×, and 2500×
produce different scene signatures at the same UTC. It also plays the production clock at every
supported speed and samples the actual GPU-facing position digest and buffer UTC. Frozen motion,
clock-rate disagreement, population loss, or a stale buffer beyond the declared wall-time allowance
fails review. Because the renderer publishes diagnostics every 500 ms, the 4-second moving interval
requires at least four samples and three distinct coherent GPU-buffer digests; the initial sample is
expected to precede the first diagnostic refresh. This moving test covers failures that fixed-time
determinism cannot detect.

The Explorer interaction scenario also opens Featured Objects and Major Constellations, selects
Starlink as a system, exercises both detail tabs, opens the reorganized Display panel, and repeats
the search-to-details flow for Webb. These captures prevent a scientifically consistent scene from
masking regressions in discovery, selection, progressive disclosure, or settings organization.

## Evolving the review with future prompts

Every feature prompt that changes a reviewed workflow must update the matching scenario in the same
change. A prompt adding a new workspace such as Moon Explorer should require the implementer to:

1. Expose a serializable, opt-in review state and deterministic actions from the application.
2. Add `scripts/review/scenarios/moon-explorer.mjs` without changing the runner.
3. Declare stable capture IDs, the scripted sequence, and generated-note content in that module.
4. Register the module in `scripts/review/scenarios/index.mjs`.
5. Add any new artifact contract to this document and run `npm run review` end to end.

Use stable accessible selectors. Wait on application state rather than arbitrary delays before
capturing. Keep the scenario deterministic: fixed inputs, fixed timestamps, fixed viewport, no mouse
movement, no wall-clock-dependent assertions, and no network-only fixture dependency.

## Engineering lifecycle integration

`AGENTS.md` alone defines when this pipeline is a completion gate and what other evidence is
required. This document defines how the pipeline works; a successful run is never sufficient on its
own.

The generated package must contain every declared artifact, identify the final build under review,
and agree with visible runtime and renderer state. Any changed reviewed workflow must be represented
by an updated or new deterministic scenario. A package generated before the final material change is
stale and must not be used as completion evidence.

For a release candidate, run `npm run release:verify` after `npm run review`. It rejects a repository
boundary other than the dedicated Orbit Studio root, dirty or untracked source, an unavailable or
mismatched revision, source-digest drift, missing review artifacts, failed milestone or determinism
validations, missing scenarios or states, browser warnings or errors, missing provenance artifacts,
or notices that differ from the committed release source.
