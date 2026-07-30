# Orbit Studio mobile interface pass

This patch focuses on the deployed Explorer mobile experience without changing catalog, renderer, physics, or environment isolation logic.

## Changes

- Replaces the competing mobile floating controls with one persistent four-action dock: Orbit, Display, Explore, Playback.
- Converts Explorer panels into consistent bottom sheets with safe-area padding and drag handles.
- Makes search expand into a full-screen mobile search surface.
- Keeps the visualization dominant and moves the globe slightly upward.
- Compacts the timeline and removes duplicated playback/speed controls from the default canvas view.
- Preserves the existing desktop and tablet-landscape interface above 820 px.

## Verification

Run `./VERIFY_MOBILE_UI.command`, then test at minimum:

- iPhone portrait in Safari and Chrome.
- Search open, type, choose result, dismiss keyboard.
- Open and dismiss each dock surface.
- Swipe down on sheets.
- Rotate to landscape and back.
- Explorer timeline scrubbing.
- App ellipsis menu while another sheet is open.
- Playground still initializes with Satellite 1.
