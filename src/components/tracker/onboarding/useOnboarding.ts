import { useCallback, useEffect, useState } from "react";
import type { CalloutStep } from "./TrackerCallout";

/**
 * Which tours a reader has seen, and whether one is running.
 *
 * ## Why completion is per-tour rather than one flag
 *
 * The first-run tour is four stops about the shell. The point of building this
 * as a mechanism rather than a script is that Tracker can later explain one
 * thing, once, at the moment it first becomes relevant — the first time an
 * eclipse overlay appears, say. Those are separate pieces of teaching with
 * separate completions, and a single "onboarded" flag could not express that.
 */

const STORAGE_KEY = "orbit-studio:tracker:tours:v1";

function seen(): Record<string, true> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    // A browser that refuses storage gets the tour every time, which is a much
    // better failure than an exception on load.
    return {};
  }
}

function remember(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...seen(), [id]: true }));
  } catch {
    /* as above */
  }
}

export interface Tour {
  id: string;
  steps: CalloutStep[];
}

export interface Onboarding {
  step: CalloutStep | null;
  index: number;
  total: number;
  next: () => void;
  back: () => void;
  close: () => void;
  /** Start a tour if its id has not been completed. */
  offer: (tour: Tour) => void;
  /** Start a tour whether or not it has been seen, for a "show me again". */
  replay: (tour: Tour) => void;
  hasSeen: (id: string) => boolean;
}

export function useOnboarding(): Onboarding {
  const [tour, setTour] = useState<Tour | null>(null);
  const [index, setIndex] = useState(0);

  /**
   * Only steps whose anchor is actually on screen.
   *
   * A callout pointing at a control that is not rendered would be a bubble over
   * nothing. Recomputed as the tour advances, so a step whose anchor appears
   * part-way through — the rail, once a place is chosen — is included the
   * moment it exists rather than skipped for ever.
   */
  const steps = (tour?.steps ?? []).filter(
    (step) => typeof document !== "undefined" && document.querySelector(step.anchor),
  );

  const finish = useCallback(() => {
    if (tour) remember(tour.id);
    setTour(null);
    setIndex(0);
  }, [tour]);

  const next = useCallback(() => {
    setIndex((current) => {
      if (current + 1 >= steps.length) {
        finish();
        return 0;
      }
      return current + 1;
    });
  }, [finish, steps.length]);

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  useEffect(() => {
    if (tour && steps.length === 0) finish();
  }, [finish, steps.length, tour]);

  return {
    step: steps[Math.min(index, Math.max(0, steps.length - 1))] ?? null,
    index: Math.min(index, Math.max(0, steps.length - 1)),
    total: steps.length,
    next,
    back,
    close: finish,
    offer: (candidate) => {
      if (seen()[candidate.id]) return;
      setTour(candidate);
      setIndex(0);
    },
    replay: (candidate) => {
      setTour(candidate);
      setIndex(0);
    },
    hasSeen: (id) => Boolean(seen()[id]),
  };
}
