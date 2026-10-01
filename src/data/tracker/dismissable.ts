import { useEffect } from "react";

/**
 * Which transient surfaces are open, so the map can behave the way menus do.
 *
 * ## The behaviour this fixes
 *
 * Tracker's map turns any click into a new observing location. That is right
 * when the reader is looking at the map, and wrong when they have a menu open:
 * clicking away from an open Find-an-event panel closed the panel *and* moved
 * the pin, so dismissing a menu silently threw away the place the reader had
 * chosen. Every mature interface treats the first click outside an open menu as
 * dismissal and nothing else, and that is the convention the map now follows.
 *
 * ## Why a timestamp and not just a count
 *
 * Each surface already closes itself on an outside `pointerdown`, which fires
 * before `click`. By the time the map's click handler runs, the panel has gone
 * and a simple "is anything open" test would say no — so the map would pick a
 * location after all. The module therefore records *when* the last surface
 * closed, and the map treats a click arriving in the moment after a dismissal
 * as part of that dismissal.
 */

/** The close function of every surface currently open. */
const openSurfaces = new Set<() => void>();

/** When the most recent one closed, for the reason above. */
let closedAt = 0;

/** How long after a dismissal a map click still counts as part of it. */
const DISMISS_GRACE_MS = 350;

/**
 * Register a surface as open for as long as `open` is true.
 *
 * Call it from every transient overlay: the event finder, the layer panel, the
 * month calendar, the app menu. A surface that does not register is a surface
 * whose dismissal still moves the reader's pin.
 */
export function useDismissableSurface(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    openSurfaces.add(close);
    return () => {
      openSurfaces.delete(close);
      closedAt = Date.now();
    };
  }, [open, close]);
}

/**
 * Close whatever is open, and say whether that is all this click should do.
 *
 * The map calls this before turning a click into a location. It *closes* rather
 * than merely reporting, so the map is the thing that dismisses a menu — which
 * is both the convention and a safety property: a surface that forgot to write
 * its own outside-click handler is still closable, instead of staying open and
 * silently disabling map selection for the rest of the session. That is exactly
 * what the event finder did.
 */
export function dismissOpenSurfaces(now = Date.now()): boolean {
  if (openSurfaces.size > 0) {
    for (const close of [...openSurfaces]) close();
    openSurfaces.clear();
    closedAt = now;
    return true;
  }
  // Nothing open now, but something closed a moment ago — on this same click,
  // via its own `pointerdown` handler, which runs first.
  return now - closedAt < DISMISS_GRACE_MS;
}

/** Test seam: forget everything. */
export function resetDismissableState(): void {
  openSurfaces.clear();
  closedAt = 0;
}
