import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  daysBetween,
  describeDate,
  isSupportedDate,
  shiftDate,
  type LocalDate,
} from "../../data/tracker/skyContext";
import { TrackerCalendar } from "./TrackerCalendar";
import { useDismissableSurface } from "../../data/tracker/dismissable";

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
 * ## Why it names the day again
 *
 * It used to show a bare date, deliberately: saying "Tonight" here put the word
 * three centimetres from the `Tonight | Upcoming` tabs, where a reader could
 * not tell which control it belonged to and the arrows implied — wrongly — that
 * Upcoming was one step to the right of Tonight.
 *
 * Those tabs are gone. Time is a parameter of the map now, not a destination,
 * and with nothing left to collide with, the relative word is simply the most
 * useful thing the control can say: "Today · 28 Aug 2026" answers both which
 * night this is and where it sits relative to now, which a bare date does not.
 *
 * ## Why the date itself opens a calendar
 *
 * The arrows serve the common case — one night either way — and only that case:
 * an eclipse eleven months out is three hundred and thirty clicks away. This
 * used to hand that job to a native `<input type="date">`, which does open a
 * real calendar and opens a different one on every platform, drawn by the
 * operating system in the middle of a dark map.
 *
 * The date is now a button, and it opens Tracker's own month. Everything else
 * about the control is unchanged: the arrows, the way back to today, and the
 * compact reading of which night is on screen.
 */

interface Props {
  /** The date on screen. */
  date: LocalDate;
  /** Today in the observer's own zone, so "Today" means their today. */
  today: LocalDate;
  /** The observer's zone, so a calendar mark lands on the night they'd name. */
  timeZone: string | null;
  onSelect: (date: LocalDate) => void;
}

export function TrackerDate({ date, today, timeZone, onSelect }: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const closeCalendar = useCallback(() => setCalendarOpen(false), []);
  // While the month is open, a click on the map closes it rather than moving
  // the reader's observing location.
  useDismissableSurface(calendarOpen, closeCalendar);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const description = useMemo(() => describeDate(date, today), [date, today]);
  const isToday = date === today;

  /**
   * The night, named the way somebody would say it out loud.
   *
   * The relative word only appears for the three days it is genuinely clearer
   * than the date; past that, "in 9 days" is arithmetic the reader has to
   * reverse, and the date itself is the plainer answer. The year is always
   * carried because this control reaches decades either way.
   */
  const shortDate = useMemo(() => {
    const [year, month, day] = date.split("-").map(Number);
    const formatted = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(year, month - 1, day));
    const offset = daysBetween(today, date);
    const relative =
      offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday" : null;
    return relative ? `${relative} · ${formatted}` : formatted;
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

      {/* The date is the control. Its accessible name says both what it shows
          and what pressing it does, because the visible text alone reads as a
          label rather than a button. */}
      <button
        ref={triggerRef}
        type="button"
        className="tk-date-field"
        aria-haspopup="dialog"
        aria-expanded={calendarOpen}
        onClick={() => setCalendarOpen((open) => !open)}
      >
        <CalendarDays size={14} aria-hidden />
        <span className="tk-visually-hidden">Choose a night — showing </span>
        <span className="tk-date-label">{shortDate}</span>
      </button>

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

      {calendarOpen ? (
        <TrackerCalendar
          date={date}
          today={today}
          timeZone={timeZone}
          onSelect={onSelect}
          onClose={() => setCalendarOpen(false)}
          returnFocusTo={triggerRef}
        />
      ) : null}
    </div>
  );
}
