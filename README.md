# Orbit Studio

Orbit Studio is an open-source platform for exploring orbital data and building space simulations. The current release includes two apps:

- **Explorer**: review the publicly available catalog over time, inspect objects, and understand
  catalog sources and historical reconstruction quality.
- **Playground**: change orbital elements and see how each parameter affects an orbit.

## Core Features

- Latest public Earth-orbit catalog visualization with satellite markers, orbit paths, labels, and
  search.
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

On macOS, double-click `START_ORBIT_STUDIO.command`. It starts the local server and opens the Orbit
Studio homepage. Keep the Terminal window open while using the app.

For manual development, use Node.js 24 or 25 and npm 11.11 or later:

```sh
npm ci
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
is evidence, not authority. See `AGENTS.md` for the complete precedence order. Future maintainers and
automated agents should also read [`docs/MAINTAINER_HANDOFF.md`](docs/MAINTAINER_HANDOFF.md).

## Data Commands

The public build uses the verified Orbit Studio Satellite Source of Truth v1.0.0 package. Its
canonical query authority is `data/satellite-source-of-truth/data/orbit-studio-satellites.sqlite`,
built from the immutable GCAT `satcat` snapshot dated 2026-06-27 under CC BY 4.0. It covers 69,703
source records, annual period-end history from 1957 through the partial 2026 snapshot, and 33,489
latest Earth-object members across payload, rocket-body, component, and debris classes.

```sh
npm run satellites:verify
npm run satellites:build
```

The first command independently verifies every package checksum, schema, count, and deterministic
reconstruction row, then byte-checks the generated browser artifact. The second regenerates that
artifact from the canonical SQLite database. Generated angles are stable package/export outputs;
the browser does not invent random or hashed orbits. Rows without a physically valid source
perigee/apogee/inclination envelope remain catalog-only. Reconstructed positions are educational,
not live tracking, observed positions, or exact historical fixes.

The public runtime has no CelesTrak or Space-Track acquisition mode and does not load ignored local
catalogs. Adding another catalog authority requires a new explicit architecture and provenance
decision.

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

## Source use and proposed changes

The source may be inspected, adapted, forked, and used as a foundation for other projects under the
MIT License. The official Orbit Studio repository, roadmap, releases, and brand remain
maintainer-controlled. Issues and pull requests are proposals and may be accepted, revised, or
declined. Read `CONTRIBUTING.md`, `AGENTS.md`, `docs/ORBIT_CONSTITUTION.md`, and
`docs/MAINTAINER_HANDOFF.md` before proposing a change.

## Donation link

Orbit Studio sends donations directly to a hosted payment provider; it does not collect payment
details. Set `VITE_SUPPORT_URL` in the deployment environment to a verified Stripe Payment Link,
Ko-fi, Open Collective, or enabled GitHub Sponsors destination. The Support and Donate actions are
hidden when the variable is unset, so the public build never ships a dead or invented payment link.
See `.env.example`.

## License

Source code is released under the MIT License. See `LICENSE`.

The MIT license applies to Orbit Studio's original source code, not to third-party material governed
by separate terms. Required attribution, rights bases, restrictions, and inclusion decisions are in
`ATTRIBUTION.md`, `THIRD_PARTY_NOTICES.md`, and `provenance/inventory.json`. Locally acquired current
or historical catalogs are not part of the public release.

## Use Orbit Studio as a website

Orbit Studio is a browser application. Open the hosted site, then choose **Explorer** or **Playground** from the homepage.

### Explorer

Use Explorer to search the public orbital catalog, select an object, change the historical date, control playback, and inspect the displayed orbit and source-backed metadata. On phones and narrow tablets, use the bottom dock to open Explore, Display, Orbit, and Playback sheets. Each sheet has one mobile-only drag handle and can be dismissed by dragging downward or tapping the handle.

Historical positions may be reconstructed from the best available public data rather than directly observed at every date. Orbit Studio communicates the available reconstruction and provenance rather than presenting all positions as equally verified. It is an educational visualization, not a live operational tracking service.

### Playground

Use Playground to add satellites and change altitude, eccentricity, inclination, RAAN, argument of periapsis, and true anomaly. The visualization updates as values change. Playback controls support pause, forward or reverse time, and selectable speed. On mobile, Orbit and Playback open as bottom sheets; drag handles are not shown on desktop.

### Run the website locally

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production-equivalent local build:

```bash
npm run build
npm run preview
```

## Data access and API status

Orbit Studio does not currently operate a hosted REST API. The website uses a generated static catalog artifact. Treating an internal build asset as a stable API is not supported because its deployed filename and schema may change between releases.

For programmatic use, build the repository and read the generated catalog at:

```text
src/data/generated/satelliteCatalog.web.json
```

JavaScript:

```js
import catalog from "./src/data/generated/satelliteCatalog.web.json" with { type: "json" };
console.log(catalog);
```

Python:

```python
import json
from pathlib import Path

catalog = json.loads(
    Path("src/data/generated/satelliteCatalog.web.json").read_text()
)
print(catalog.keys())
```

Before relying on the data, review `docs/sources.md`, `ATTRIBUTION.md`, and the source-of-truth package manifest. A future public API should be versioned under `/api/v1`, publish an OpenAPI schema, and define filtering, pagination, caching, provenance, reconstruction quality, and deprecation rules before it is advertised as stable.
