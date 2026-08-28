import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import {
  EARLIEST_SUPPORTED_DATE,
  LATEST_SUPPORTED_DATE,
  daysBetween,
  describeDate,
  isSupportedDate,
  shiftDate,
  type LocalDate,
} from "../../data/tracker/skyContext";

/**
 * Which night Tracker is showing.
 *
 * ## Why a calendar rather than modes
 *
 * A date is a date. Tracker opens on today because that is the question people
 * usually have, not because today is a different kind of thing — so there is no
 * Past, no Future and no Archive, only a control that says which night is on
 * screen and lets the reader change it.
 *
 * ## Why it never says "Tonight"
 *
 * It did, and that put `‹ Tonight ›` in the header three centimetres from the
 * `Tonight | Upcoming` tabs. Two controls, the same word, different jobs: one
 * chooses a date and the other chooses between two views. A reader cannot tell
 * from the interface which of them the word belongs to, and the arrows either
 * side of it imply — wrongly — that Upcoming is one step to the right of
 * Tonight.
 *
 * So the date control always shows a date. "Tonight" belongs to the primary
 * navigation and appears in exactly one place.
 *
 * ## Why the year is typed rather than paged
 *
 * Reaching 1999 by clicking a month arrow is three hundred clicks. The control
 * offers a native date field, which every platform already renders as a proper
 * calendar with month and year navigation the reader knows, plus single-day
 * arrows for the common case of nudging one night either way and a way back to
 * today that is always visible when it would do something.
 */

interface Props {
  /** The date on screen. */
  date: LocalDate;
  /** Today in the observer's own zone, so "Today" means their today. */
  today: LocalDate;
  onSelect: (date: LocalDate) => void;
}

export function TrackerDate({ date, today, onSelect }: Props) {
  const [draft, setDraft] = useState(date);
  const description = useMemo(() => describeDate(date, today), [date, today]);
  const isToday = date === today;

  // Always a date, never a mode word. The year is dropped in the current year
  // and kept outside it, because "12 Aug" is unambiguous this year and useless
  // for 1999.
  const shortDate = useMemo(() => {
    const [year, month, day] = date.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    }).format(new Date(year, month - 1, day));
  }, [date, today]);

  // The arrows stop at the edges of what the ephemeris is trusted for rather
  // than walking silently into numbers Tracker will not stand behind.
  const previous = shiftDate(date, -1);
  const next = shiftDate(date, 1);

  return (
    <div className="tk-date" data-today={isToday ? "true" : undefined}>
      <button
        type="button"
        className="tk-date-step"
        onClick={() => onSelect(previous)}
        disabled={!isSupportedDate(previous)}
        aria-label="Previous night"
      >
        <ChevronLeft size={15} aria-hidden />
      </button>

      <label className="tk-date-field">
        {/* The visible text is the reader's language for the night; the input
            underneath is the machine-readable date the platform's own calendar
            edits. Both describe the same value, which is what keeps the
            accessible name and the visible label saying the same thing. */}
        <span className="tk-visually-hidden">Night to display</span>
        <span className="tk-date-label" aria-hidden>
          {shortDate}
        </span>
        <input
          type="date"
          value={draft}
          min={EARLIEST_SUPPORTED_DATE}
          max={LATEST_SUPPORTED_DATE}
          onChange={(event) => {
            setDraft(event.target.value);
            if (isSupportedDate(event.target.value)) onSelect(event.target.value);
          }}
        />
      </label>

      <button
        type="button"
        className="tk-date-step"
        onClick={() => onSelect(next)}
        disabled={!isSupportedDate(next)}
        aria-label="Next night"
      >
        <ChevronRight size={15} aria-hidden />
      </button>

      {/* Only when it would do something. A permanently present "Today" on the
          day it is already showing is a control that does nothing.
      
          "Today", not "Tonight": this resets the date, and the word that names
          the view lives in the primary navigation and nowhere else. */}
      {isToday ? null : (
        <button type="button" className="tk-date-today" onClick={() => onSelect(today)}>
          Today
          <span className="tk-visually-hidden">
            {` — ${Math.abs(daysBetween(today, date))} days from ${description.heading.replace(/^on /, "")}`}
          </span>
        </button>
      )}
    </div>
  );
}
