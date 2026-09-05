import { useCallback, useEffect, useRef, useState } from "react";
import {
  isMapNavigationStep,
  mapLocationToSearch,
  parseMapLocation,
  sameMapLocation,
  type TrackerMapLocation,
} from "../../data/tracker/mapNavigation";
import { loadConfirmedPlace } from "../../data/tracker/trackerPersistence";

/**
 * The map's position in the browser's history.
 *
 * ## Why this is not `useTrackerHistory` with a different type
 *
 * The page-based hook pushes on every meaningful change, because in a product
 * made of pages every meaningful change *is* a page. A map has a second kind of
 * state that changes constantly and is meaningful anyway — where the reader is
 * looking — and pushing that would fill the back stack with hundreds of entries
 * from one drag.
 *
 * So this hook has two verbs rather than one:
 *
 *   `navigate` — a decision. Pushes, and Back undoes it.
 *   `settle`   — a viewport. Replaces, so the current entry keeps up with what
 *                is on screen without becoming another thing to go back through.
 *
 * The consequence is the behaviour the brief asks for: drill into an event,
 * press Back, and the map returns to the viewport that was on screen when you
 * left — because the entry you are returning to was kept current by `settle`,
 * not frozen at the moment the pin was dropped.
 *
 * ## The double-push hazard, which cost a day once
 *
 * The write happens outside `setLocation`'s updater, and it must. React is
 * allowed to call an updater more than once, StrictMode does exactly that in
 * development, and a `pushState` inside one therefore ran twice — every
 * navigation added two entries and the reader's first Back appeared to do
 * nothing. The merge reads a ref, the history write happens once, and
 * `setLocation` receives a plain value with nothing to re-run.
 */
export interface TrackerMapHistory {
  location: TrackerMapLocation;
  /** A deliberate change. Pushes a history entry. */
  navigate: (next: Partial<TrackerMapLocation>) => void;
  /**
   * The viewport catching up with the screen. Replaces the current entry.
   *
   * Separate from `navigate` so a caller cannot accidentally push a pan: there
   * is no flag to get wrong, only two differently named functions.
   */
  settle: (next: Partial<TrackerMapLocation>) => void;
  /** Step back, or fall back to a replace where there is nothing of ours behind. */
  back: (fallback?: Partial<TrackerMapLocation>) => void;
  /**
   * Go to a remembered map state, whatever has happened since.
   *
   * Not a step backwards. "Back to the map" is a named destination — the map
   * the reader left — and implementing it as `history.back()` made it mean
   * "undo one thing", which is a different promise and a wrong one: change the
   * date on an event page, press Back to the map, and you arrived at the same
   * event page with yesterday's date. Every entry laid down since the drill-in
   * is simply not on the way to anywhere.
   */
  returnTo: (state: TrackerMapLocation) => void;
  /** How many entries of our own are behind the current one. */
  depth: number;
}

export function useTrackerMapHistory(): TrackerMapHistory {
  const [location, setLocation] = useState<TrackerMapLocation>(() => {
    if (typeof window === "undefined") return parseMapLocation("");
    const fromUrl = parseMapLocation(window.location.search);
    if (fromUrl.pin) return fromUrl;
    /**
     * Open where the reader was, at a scale they can work at.
     *
     * A whole-world view is the right default for somebody Tracker knows
     * nothing about and the wrong one for everybody else — the task is local
     * observing, and starting three zoom levels away from the answer makes the
     * reader do the product's work. The URL still wins where it says anything,
     * so a shared link is never overridden by whoever opens it.
     */
    const stored = loadConfirmedPlace();
    if (!stored) return fromUrl;
    return {
      ...fromUrl,
      pin: { latitudeDeg: stored.latitude, longitudeDeg: stored.longitude },
      centre: { latitudeDeg: stored.latitude, longitudeDeg: stored.longitude },
      // Far enough out to compare somewhere darker an hour away, close enough
      // that the reader recognises where they are: roughly 300 km across a
      // desktop viewport, which is about an evening's drive in each direction.
      zoom: 8,
    };
  });

  const current = useRef(location);
  current.current = location;

  /**
   * How deep into our own history we are.
   *
   * `history.length` counts the whole tab, including whatever the reader was
   * doing before Tracker, so it cannot answer "is there a Tracker state behind
   * me". This counts only the entries this hook pushed, which is what decides
   * whether Back stays inside Tracker or leaves it.
   */
  const depth = useRef(0);
  const [depthState, setDepthState] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // The first entry carries the parsed state, so a reload or a Forward into
    // it restores the map rather than the bare default.
    window.history.replaceState(
      { trackerMap: current.current },
      "",
      mapLocationToSearch(current.current),
    );

    function onPopState(event: PopStateEvent) {
      const state = (event.state as { trackerMap?: TrackerMapLocation } | null)?.trackerMap;
      // Falling back to the URL keeps a hand-edited address resolving to
      // something coherent rather than to whatever was last in memory.
      const next = state ?? parseMapLocation(window.location.search);
      depth.current = Math.max(0, depth.current - 1);
      setDepthState(depth.current);
      current.current = next;
      setLocation(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const write = useCallback((merged: TrackerMapLocation, push: boolean) => {
    const search = mapLocationToSearch(merged);
    if (push) {
      window.history.pushState({ trackerMap: merged }, "", search);
      depth.current += 1;
      setDepthState(depth.current);
    } else {
      window.history.replaceState({ trackerMap: merged }, "", search);
    }
    // Kept in step immediately: two calls in one event handler would otherwise
    // both merge from the same stale value.
    current.current = merged;
    setLocation(merged);
  }, []);

  const navigate = useCallback(
    (next: Partial<TrackerMapLocation>) => {
      const from = current.current;
      const merged: TrackerMapLocation = { ...from, ...next };
      if (sameMapLocation(from, merged)) return;
      write(merged, isMapNavigationStep(from, merged));
    },
    [write],
  );

  const settle = useCallback(
    (next: Partial<TrackerMapLocation>) => {
      const from = current.current;
      const merged: TrackerMapLocation = { ...from, ...next };
      if (sameMapLocation(from, merged)) return;
      write(merged, false);
    },
    [write],
  );

  const back = useCallback(
    (fallback?: Partial<TrackerMapLocation>) => {
      // Only step back into an entry this hook pushed. Below that, Back would
      // leave Tracker, and a control inside the product should not do that —
      // the browser's own Back still can, which is the reader's decision rather
      // than a button's.
      if (depth.current > 0) {
        window.history.back();
        return;
      }
      if (fallback) {
        const merged = { ...current.current, ...fallback };
        if (!sameMapLocation(current.current, merged)) write(merged, false);
      }
    },
    [write],
  );

  const returnTo = useCallback(
    (state: TrackerMapLocation) => {
      if (sameMapLocation(current.current, state)) return;
      // Pushed, not replaced: the event page the reader just left is still
      // somewhere they might want Forward to take them back to.
      write(state, true);
    },
    [write],
  );

  return { location, navigate, settle, back, returnTo, depth: depthState };
}
