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
   * The current location, readable without going through React state.
   *
   * `navigate` needs to know where it is starting from *and* write to the
   * history stack, and those two must happen exactly once per call. Keeping the
   * location in a ref alongside the state is what makes that possible — see the
   * comment on `navigate` for why doing it inside the state updater was wrong.
   */
  const current = useRef(location);
  current.current = location;

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
      current.current = next;
      setLocation(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback(
    (next: Partial<TrackerLocation>, options?: { replace?: boolean }) => {
      /**
       * ## Why the history write is out here rather than in the updater
       *
       * It used to live inside `setLocation(current => …)`, which reads as the
       * natural place for it: the updater already has the previous location, so
       * merging and pushing in one step avoids a stale closure.
       *
       * It is also a side effect inside a function React is explicitly allowed
       * to call more than once. StrictMode does exactly that in development to
       * surface impure updaters, so every navigation pushed **two** history
       * entries — confirmed in the browser: one click on "View visibility map"
       * took `history.length` from 7 to 9. The reader's first Back press then
       * appeared to do nothing, because it was consuming a duplicate of the
       * entry they were already on, and the second took them somewhere they had
       * not expected. Under concurrent rendering the same hazard exists in
       * production; StrictMode only made it reproducible.
       *
       * So the merge reads the ref, the history write happens once, and
       * `setLocation` is handed a plain value with nothing to re-run.
       */
      const from = current.current;
      const merged: TrackerLocation = { ...from, ...next };
      if (sameTrackerLocation(from, merged)) return;

      const push = options?.replace ? false : isNavigationStep(from, merged);
      const search = trackerLocationToSearch(merged);
      if (push) {
        window.history.pushState({ tracker: merged }, "", search);
        depth.current += 1;
      } else {
        window.history.replaceState({ tracker: merged }, "", search);
      }
      // Kept in step immediately: two `navigate` calls in one event handler
      // would otherwise both merge from the same stale `from`.
      current.current = merged;
      setLocation(merged);
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
