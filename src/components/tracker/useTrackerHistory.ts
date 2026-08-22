import { useCallback, useEffect, useRef, useState } from "react";
import {
  isNavigationStep,
  parseTrackerLocation,
  sameTrackerLocation,
  trackerLocationToSearch,
  type TrackerLocation,
} from "../../data/tracker/trackerNavigation";

/**
 * The browser's history, as Tracker's navigation.
 *
 * This is deliberately thin. It does not implement Back — the browser already
 * has Back, and the reason Back was broken is that Tracker never told it
 * anything. So the hook's whole job is to keep three things in agreement: the
 * React state, the address bar, and the history stack.
 *
 * ## Why not intercept Back
 *
 * The tempting fix is a `beforeunload` or a popstate handler that pushes a
 * replacement entry so the reader can never leave. That produces a page that
 * cannot be escaped with the browser's own control, which is worse than the
 * bug: the reader loses a guarantee the browser makes on every other site. The
 * history here reflects the navigation that actually happened, so leaving
 * Tracker at the end of it is correct and is what the reader asked for.
 */
export interface TrackerHistory {
  location: TrackerLocation;
  /**
   * Move to a new location.
   *
   * Pushes when the change is navigation and replaces when it is a change to
   * the current page's own state, which is decided by `isNavigationStep` rather
   * than by each call site — so a new caller cannot accidentally start
   * generating history noise.
   */
  navigate: (next: Partial<TrackerLocation>, options?: { replace?: boolean }) => void;
  /**
   * Step back one entry, the way the browser's own button does.
   *
   * Used by in-app back controls so that "Back to Upcoming" and the browser's
   * Back are the same movement rather than two histories that drift apart.
   * Falls back to a push when there is nothing of Tracker's behind us — a
   * reader who opened an event URL directly has no Tracker entry to return to,
   * and sending them back would take them off the site.
   */
  back: (fallback: Partial<TrackerLocation>) => void;
}

export function useTrackerHistory(): TrackerHistory {
  const [location, setLocation] = useState<TrackerLocation>(() =>
    typeof window === "undefined"
      ? parseTrackerLocation("")
      : parseTrackerLocation(window.location.search),
  );

  /**
   * How many entries of our own are behind the current one.
   *
   * Needed because `history.length` counts the whole tab, including whatever
   * the reader was doing before they arrived. Only entries this session pushed
   * are ours to step back through.
   */
  const depth = useRef(0);

  // The first entry has to carry Tracker state too, or returning to it through
  // Back arrives at an entry whose state is null and the location has to be
  // re-derived from a URL that may predate this session.
  useEffect(() => {
    window.history.replaceState(
      { tracker: location },
      "",
      trackerLocationToSearch(location),
    );
    // Once, for the entry we arrived on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      const state = (event.state as { tracker?: TrackerLocation } | null)?.tracker;
      // The URL is the fallback rather than the primary source: an entry pushed
      // by this session always carries state, and reading the URL as well means
      // a hand-edited address still resolves to something coherent.
      const next = state ?? parseTrackerLocation(window.location.search);
      depth.current = Math.max(0, depth.current - 1);
      setLocation(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback(
    (next: Partial<TrackerLocation>, options?: { replace?: boolean }) => {
      setLocation((current) => {
        const merged: TrackerLocation = { ...current, ...next };
        if (sameTrackerLocation(current, merged)) return current;

        const push = options?.replace ? false : isNavigationStep(current, merged);
        const search = trackerLocationToSearch(merged);
        if (push) {
          window.history.pushState({ tracker: merged }, "", search);
          depth.current += 1;
        } else {
          window.history.replaceState({ tracker: merged }, "", search);
        }
        return merged;
      });
    },
    [],
  );

  const back = useCallback(
    (fallback: Partial<TrackerLocation>) => {
      if (depth.current > 0) {
        // `popstate` does the state update, so this must not also set it —
        // doing both moved two entries for one press.
        window.history.back();
        return;
      }
      navigate(fallback, { replace: true });
    },
    [navigate],
  );

  return { location, navigate, back };
}
