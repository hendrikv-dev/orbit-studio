# Maintainer Handoff

This document records the current product structure and the constraints that future agents and contributors must preserve.

## Product structure

Orbit Studio is the platform. It currently contains two apps:

- **Explorer** reviews the public catalog across time. Historical membership is source-backed; positions may be reconstructed and must remain labeled with their provenance and reconstruction quality.
- **Playground** teaches the six classical orbital elements through direct manipulation of a neutral authored satellite scenario.

Orbit Studio itself is not a third app. The root route is the platform homepage and launches either app.

## Current navigation contract

Explorer and Playground use the same `OrbitAppMenu` component in the same top-right location. The menu must always show:

1. Orbit Studio Home
2. Explorer
3. Playground
4. Hide interface
5. GitHub

The active app remains visible and is marked. Do not add app-specific copies of this menu. When the interface is hidden, a small `Show interface` control remains available and Escape restores the interface.

## Playground initialization contract

Every entry path must produce the same initial Playground state:

- homepage launch;
- Explorer menu launch;
- direct `?app=playground` URL;
- page refresh.

The initial object is **Satellite 1**. Playground must not inherit an Explorer catalog selection. The scene is remounted for each Playground session so stale renderer state cannot produce a blank scene.

## Homepage contract

- Use the approved logo assets from `public/brand/` without redrawing them.
- Use the approved centered-Earth captures from `public/home/explorer-home.webp` and
  `public/home/playground-home.webp`; do not substitute generated UI art or stale full-browser screenshots.
- The platform heading is `Welcome to Orbit Studio`. The short platform description appears once.
- Explorer and Playground are presented side by side on desktop and tablet landscape, with copy on
  the left and a stable image on the right. Phone layouts may stack.
- Each app card explains its own purpose once in plain factual language.
- Preview images use `object-fit: contain`, remain centered, and do not zoom, shift, tint, recrop, or
  gain animated overlays on hover or focus.
- The below-fold About section describes source access without implying shared governance of the
  official repository. Do not advertise speculative future environments as committed roadmap items.
- Donations link directly to a hosted provider through `VITE_SUPPORT_URL`; Orbit Studio does not
  implement an internal support or payment page. Hide the Support and Donate actions when the URL is
  unset rather than inventing a destination.
- Copy is concise and product-specific. Avoid slogans, paired marketing phrases, and repeated summaries.

## Data and educational accuracy

The browser catalog is generated from the repository's verified GCAT source package. Do not describe reconstructed positions as observations, live tracking, or exact historical fixes. Keep source and reconstruction-quality context visible.

## Before changing architecture

Read `AGENTS.md`, `docs/ORBIT_CONSTITUTION.md`, and the relevant data/provenance documentation. Prefer extending the active path over creating parallel components, stores, renderers, or databases. Remove obsolete generated packages rather than carrying them forward in release archives.

## Required validation for UI/navigation work

At minimum:

```sh
npm ci
npm test
npm run build
```

Then verify these runtime paths in a browser:

- root homepage;
- homepage → Explorer;
- homepage → Playground;
- Explorer → Playground through the shared menu;
- Playground → Explorer through the shared menu;
- direct `?app=explorer` and `?app=playground` loads;
- hide/show interface in both apps;
- shared menu labels at desktop, tablet landscape, and mobile widths.

Do not claim release readiness when a runtime path or required check is unverified.
