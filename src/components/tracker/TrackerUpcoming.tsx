import { useState } from "react";
import type { PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";
import { TrackerCurated } from "./TrackerCurated";
import { TrackerMonth } from "./TrackerMonth";

/**
 * Future planning, in two ways of looking at the same thing.
 *
 * Curated asks which event is worth planning around; Calendar asks what falls
 * on which date. Both are driven by one notability layer, so a date marked in
 * the month is a date Curated would feature — they cannot disagree about what
 * matters.
 *
 * This component used to render the future-night list itself and grew a mode
 * switch around it, which left the old feed as the substance of both modes.
 * The list is gone; this is now only the frame and the switch.
 */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
}

export function TrackerUpcoming({ place, clock }: Props) {
  const [mode, setMode] = useState<"curated" | "calendar">("curated");

  return (
    <section className="tk-view tk-upcoming" aria-label="Upcoming">
      {/* One heading for the view. Calendar used to bring its own, so the mode
          switch produced two stacked page titles. */}
      <div className="tk-upcoming-bar">
        <div>
          <h1 className="tk-upcoming-title">
            {mode === "curated" ? "Worth planning for" : "The month ahead"}
          </h1>
          <p className="tk-upcoming-lede">
            {mode === "curated"
              ? `The next month from ${place.name}, by significance.`
              : `Marked dates are the ones worth knowing about from ${place.name}.`}
          </p>
        </div>
        <div className="tk-mode" role="tablist" aria-label="How to browse">
          {(["curated", "calendar"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={mode === entry}
              className="tk-mode-item"
              onClick={() => setMode(entry)}
            >
              {entry === "curated" ? "Curated" : "Calendar"}
            </button>
          ))}
        </div>
      </div>

      {mode === "curated" ? (
        <TrackerCurated place={place} clock={clock} />
      ) : (
        <TrackerMonth place={place} clock={clock} />
      )}
    </section>
  );
}
