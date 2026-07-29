# Codebase Guide

This file is a current navigation aid, not an engineering workflow. Follow `AGENTS.md` for required
investigation, planning, validation, self-review, and completion behavior.

Known active areas from current repo review:

- Explorer UI: src/components/explorer/ExplorerView.tsx
- Explorer catalog authority and snapshot lifecycle: src/data/explorerCatalog.ts
- Explorer discovery collections and search ranking: src/data/explorerDiscovery.ts
- Explorer educational content and featured priority: src/data/explorerEducation.ts
- Active Earth renderer: src/rendering/Earth.tsx
- Earth texture support: src/rendering/earthTextures.ts
- Explorer satellite points: src/rendering/ExplorerSatellitePoints.tsx
- Catalog propagation horizon policy: src/rendering/catalogPropagation.ts
- Deterministic Explorer review scenario: scripts/review/scenarios/explorer.mjs
- Main styles: src/styles/app.css

The paths above can drift. Confirm active imports before relying on them, avoid modifying inactive
legacy paths, and update this guide when ownership materially changes. Reusable rendering logic
should remain isolated and easy to find rather than being duplicated in UI-specific paths.
