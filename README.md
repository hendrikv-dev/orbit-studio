# Orbit Studio

Orbit Studio is an interactive Earth-orbit visualization app for exploring satellite catalogs,
historical orbital membership, and simple orbital scenarios in the browser.

The app has two primary modes:

- **Explorer**: browse the catalog, scrub through historical timeline dates, inspect objects, and
  compare catalog membership, orbit visualizations, labels, statistics, and search results.
- **Playground**: build and adjust small orbital scenarios, edit satellites, inspect coverage, and
  experiment with playback in a controlled sandbox.

## Core Features

- Current Earth-orbit visualization with satellite markers, orbit paths, labels, and search.
- Historical catalog timeline driven by generated catalog artifacts.
- Date-filtered Explorer catalog, search, inspector, statistics, and renderer membership.
- Playground scenario editing for satellites, ground stations, regions, sensors, and playback.
- Three.js Earth renderer with star field, reference grids, coverage overlays, and optional visual
  diagnostics.
- Data validation commands for historical catalog import, validation, and coverage reporting.

## Tech Stack

- React 18
- TypeScript
- Vite
- Three.js with React Three Fiber and Drei
- Zustand
- Vitest
- satellite.js

## Getting Started

Orbit Studio uses Node.js `24.18.0` and npm `11.16.0`. With `nvm`, select the committed runtime and
install the locked dependency tree:

```sh
nvm use
npm ci
```

Run the local development server:

```sh
npm run dev
```

Build for production:

```sh
npm run build
```

Run tests:

```sh
npm test
```

Generate the deterministic UX review package:

```sh
npm run review
```

This builds and launches the production app, executes the standardized Explorer walkthrough, and
writes machine-readable state, WebP screenshots, review notes, a synchronized timeline CSV, and a short timeline MP4 to
`review/`. See [`docs/UX_REVIEW_PIPELINE.md`](docs/UX_REVIEW_PIPELINE.md) for prerequisites, the
artifact contract, and scenario extension guidance.

For a committed release candidate, verify that the review package was generated from the clean
authoritative source revision:

```sh
npm run release:verify
```

This final gate intentionally fails on a dirty tree, an untracked source tree, a mismatched review
package, missing artifacts, failed deterministic validations, browser diagnostics, or prohibited
material reachable through the branch history.

Create the redistribution-safe source archive from tracked `HEAD` contents:

```sh
npm run source:archive
```

The command uses `git archive`, verifies the actual generated archive against the exact `HEAD`
tree, and writes an ignored `release-artifacts/orbit-studio-source-<commit>.tar.gz`. Do not package
Orbit Studio by zipping the working directory: a private checkout may legitimately contain ignored
acquisitions, generated data, dependencies, review output, caches, or credentials that are not part
of the public source.

## Operating Framework

- The explicit current user request has highest authority.
- [`AGENTS.md`](AGENTS.md) is the canonical engineering procedure and completion standard.
- [`docs/ORBIT_CONSTITUTION.md`](docs/ORBIT_CONSTITUTION.md) is the canonical product-principles
  document, subordinate to the current request and `AGENTS.md`.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) contains repository setup and contribution-specific guidance.

Other documents describe current architecture, data, or review procedures. Existing implementation
is evidence, not authority. See `AGENTS.md` for the complete precedence order.

## Data Commands

The public build uses a small project-authored current-orbit reference scenario, a bounded
GCAT-derived historical membership and orbital-summary sample, and verified redistributable Earth,
Moon, boundary, and star assets. It does not bundle a current CelesTrak GP snapshot. Historical
records without a suitable source orbital record use explicitly identified, metadata-constrained
educational reconstructions when perigee, apogee, and inclination are available; unconstrained
records remain catalog-only. Historical source acquisition requires authorized source access. Do
not commit raw source archives, credentials, or generated local catalogs.

```sh
npm run data:download
npm run data:import
npm run data:validate
npm run data:coverage
```

For private local evaluation, current CelesTrak records can be acquired directly from the publisher:

```sh
npm run catalog:sync
ORBIT_CURRENT_CATALOG_MODE=local npm run dev
```

The acquisition command writes records and a receipt under ignored
`data/local-only/celestrak/`. The release build mode never reads that directory. A private local
production build may opt in with `ORBIT_CURRENT_CATALOG_MODE=local npm run build`, but
`npm run provenance:validate` intentionally rejects that bundle for redistribution. The former
`--write-runtime` path is disabled.

Historical import commands write generated third-party data under ignored `data/generated/` paths.
Source-backed runtime artifacts remain private unless their redistribution basis is separately
verified and added to the authoritative provenance inventory.

The public GCAT historical sample can be regenerated from a local GCAT raw file with:

```sh
node scripts/build-public-gcat-historical-sample.mjs
```

Validate the repository, production bundle, generated attribution, and locked dependency licenses:

```sh
npm run provenance:validate
npm run licenses:validate
npm run history:validate
npm run source:archive
```

[`provenance/inventory.json`](provenance/inventory.json) is the sole machine-readable authority for
project-controlled third-party material. [`ATTRIBUTION.md`](ATTRIBUTION.md) and the Earth asset
notice are generated from it. [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) is generated from
`package-lock.json`, which is the dependency-license source of truth. See
[`docs/PROVENANCE.md`](docs/PROVENANCE.md) for the audit and update procedure.

## Project Structure

```txt
src/
  components/       React UI components for Explorer, Playground, and shared panels
  data/             Catalog artifacts, source notes, and generated runtime data
  lib/              Scenario construction and app-level helpers
  physics/          Orbital math, propagation, coordinates, and coverage utilities
  rendering/        Three.js and React Three Fiber scene components
  state/            Simulation store and scenario subscriptions
  styles/           Main application stylesheet
scripts/            Data import, validation, profiling, verification, and UX review scripts
docs/               Architecture notes, data pipeline notes, and review guidance
public/             Static assets served by Vite
```

## Roadmap

- Add licensed historical orbit-state ingestion and rendering.
- Continue improving mobile interaction polish.
- Expand validation around historical data milestones and runtime consistency.
- Add optional live data providers for space weather, Earth imagery, and catalog updates.
- Keep renderer performance predictable as catalog density grows.

## Contributing

Contributions are welcome. Read `CONTRIBUTING.md`, `AGENTS.md`, and
`docs/ORBIT_CONSTITUTION.md` before opening a pull request.

## License

Source code is released under the MIT License. See `LICENSE`.

The MIT license applies to Orbit Studio's original source code, not to third-party material governed
by separate terms. Required attribution, rights bases, restrictions, and inclusion decisions are in
`ATTRIBUTION.md`, `THIRD_PARTY_NOTICES.md`, and `provenance/inventory.json`. Locally acquired current
or historical catalogs are not part of the public release.
