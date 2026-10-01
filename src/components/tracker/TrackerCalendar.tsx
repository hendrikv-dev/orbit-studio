import { ChevronLeft, ChevronRight, Eclipse, Moon, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  clampToMonth,
  monthGrid,
  monthIsReachable,
  monthOf,
  moveFocus,
  shiftMonth,
  type LocalMonth,
} from "../../data/tracker/calendarMonth";
import { isSupportedDate, type LocalDate } from "../../data/tracker/skyContext";
import {
  describeMarkers,
  markersForRange,
  type MarkerKind,
} from "../../data/tracker/calendarMarkers";

/**
 * One month, opened from the date itself.
 *
 * ## Why this exists
 *
 * The date control had two arrows and a native `<input type="date">`. The
 * arrows are right for the common case — one night either way — but they are
 * the only case they serve: reaching an eclipse eleven months out is three
 * hundred and thirty clicks. The native input does open a real calendar, and it
 * is a different calendar on every platform, styled by the operating system,
 * dropped into the middle of a dark map.
 *
 * So the date opens a month. Not a Calendar destination, not a scheduling view
 * with events drawn on it — Tracker already has the rail and the event search
 * for finding things. This answers exactly one question: which night.
 *
 * ## What it does not do
 *
 * It does not show what is happening on each day. A calendar with events on it
 * is a second discovery system competing with the rail, and it would have to
 * compute an entire month of ephemerides to fill itself in.
 */

interface Props {
  date: LocalDate;
  today: LocalDate;
  onSelect: (date: LocalDate) => void;
  onClose: () => void;
  /** The observer's zone, so a mark lands on the night they would call it. */
  timeZone: string | null;
  /** The control that opened this, so focus can be handed back to it. */
  returnFocusTo: React.RefObject<HTMLElement | null>;
}

/**
 * The mark for each kind, at the smallest size that still reads as itself.
 *
 * Glyphs rather than coloured dots: three dots would need a legend, and a
 * calendar small enough to be useful has no room for one. These are recognisable
 * without being told what they mean.
 */
const MARKS: Record<MarkerKind, typeof Eclipse> = {
  "solar-eclipse": Eclipse,
  "lunar-eclipse": Moon,
  "meteor-shower": Sparkles,
};

/** The locale's own first weekday, so columns sit where the reader expects. */
function firstWeekday(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      weekInfo?: { firstDay?: number };
      getWeekInfo?: () => { firstDay?: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    // The spec numbers Monday 1 through Sunday 7; the grid uses Sunday 0.
    if (info?.firstDay) return info.firstDay % 7;
  } catch {
    // Older engines have no week info. Sunday is the safer default: it is what
    // an unlabelled grid is most often assumed to be in the absence of one.
  }
  return 0;
}

export function TrackerCalendar({ date, today, onSelect, onClose, timeZone, returnFocusTo }: Props) {
  const weekStartsOn = useMemo(firstWeekday, []);
  const [month, setMonth] = useState<LocalMonth>(() => monthOf(date));
  /**
   * The day the keyboard is on, which is not the day that is chosen.
   *
   * A calendar that selected on arrow-press would recompute the whole sky for
   * every keystroke on the way to the date the reader actually wants. Focus
   * moves freely; Enter or Space commits.
   */
  const [focused, setFocused] = useState<LocalDate>(date);
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const positioned = position !== null;
  /**
   * Set when a key moved the focused day, so the effect below knows to move
   * real DOM focus with it.
   *
   * Without this, arrowing after pressing a month button left focus on that
   * button while the highlight walked the grid — and Enter then re-pressed the
   * month button instead of choosing the day under the highlight.
   */
  const keyboardMoved = useRef(false);

  const cells = useMemo(() => monthGrid(month, weekStartsOn), [month, weekStartsOn]);

  /**
   * Computed once per displayed month, over the whole grid rather than the
   * month, so the borrowed days at either end are marked too — a reader looking
   * at the end of July for an eclipse on 2 August should see it there.
   */
  const marks = useMemo(
    () => markersForRange(cells[0].date, cells[cells.length - 1].date, timeZone),
    [cells, timeZone],
  );

  const weekdayNames = useMemo(() => {
    // Formatted in UTC because the sample dates below are UTC midnights: in a
    // negative-offset zone the local formatter renders each one as the previous
    // day, and the whole header comes out shifted — Sat Sun Mon over a grid
    // that starts on Sunday.
    const format = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
    const long = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, index) => {
      // 2024-01-07 is a Sunday, so this walks the week from the locale's start.
      const day = new Date(Date.UTC(2024, 0, 7 + ((weekStartsOn + index) % 7)));
      return { short: format.format(day), long: long.format(day) };
    });
  }, [weekStartsOn]);

  const monthLabel = useMemo(() => {
    const [year, index] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
      new Date(year, index - 1, 1),
    );
  }, [month]);

  const dayLabel = useMemo(() => new Intl.DateTimeFormat(undefined, { dateStyle: "full" }), []);

  /**
   * The grid follows the focused day only when that day leaves the grid.
   *
   * Not when it leaves the *month*: the grid shows 42 days, so the last row of
   * September already contains the first of October. Repaging on the month
   * boundary re-rendered the whole grid under a button that had just been
   * focused, which destroyed it and dropped focus to the document body — the
   * highlight kept moving and the keyboard stopped working.
   */
  useEffect(() => {
    if (cells.some((cell) => cell.date === focused)) return;
    setMonth(monthOf(focused));
  }, [cells, focused]);

  /**
   * Focus lands in the grid on open, and returns to the trigger on close, so a
   * keyboard reader is never dropped at the top of the document.
   *
   * Deliberately after the panel has been placed: focusing it while it was
   * still `visibility: hidden` silently did nothing, which left Escape with no
   * handler in the focus path and the calendar impossible to close by keyboard.
   */
  useLayoutEffect(() => {
    if (!positioned) return;
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [positioned]);

  useLayoutEffect(() => () => returnFocusTo.current?.focus(), [returnFocusTo]);

  /**
   * Keep real focus on the highlighted day as the reader arrows across the grid.
   *
   * The flag is only cleared once the cell has actually been found. A key that
   * moves focus out of the displayed month runs this effect before the month
   * has changed, so the cell does not exist yet — clearing the flag there lost
   * focus to `body`, and the next Enter did nothing at all. Leaving it set lets
   * the effect run again when the new month renders.
   */
  useEffect(() => {
    if (!keyboardMoved.current) return;
    const cell = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`);
    if (!cell) return;
    keyboardMoved.current = false;
    cell.focus();
  }, [focused, month]);

  /**
   * Positioned from measurements, in a portal on the document body.
   *
   * It cannot simply be absolutely positioned inside the date control: the map
   * top bar carries a `backdrop-filter`, and a filtered ancestor becomes the
   * containing block for `position: fixed` descendants. The panel resolved
   * against the bar instead of the viewport and rendered off the top of a
   * phone screen with only its last row showing.
   *
   * So it lives on the body and is placed against the trigger's own rectangle,
   * flipped above when there is no room below and clamped to the viewport on
   * both axes.
   */
  useLayoutEffect(() => {
    const place = () => {
      const anchor = returnFocusTo.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const margin = 10;
      const below = anchor.bottom + margin;
      const above = anchor.top - panel.height - margin;
      const top =
        below + panel.height <= window.innerHeight - margin || above < margin ? below : above;
      const left = anchor.left + anchor.width / 2 - panel.width / 2;
      setPosition({
        left: Math.max(margin, Math.min(left, window.innerWidth - panel.width - margin)),
        top: Math.max(margin, Math.min(top, window.innerHeight - panel.height - margin)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [returnFocusTo, month]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (returnFocusTo.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose, returnFocusTo]);

  const page = (delta: number) => {
    const next = shiftMonth(month, delta);
    if (!monthIsReachable(next)) return;
    setMonth(next);
    // Carry the focused day into the new month so the keyboard stays oriented.
    setFocused(clampToMonth(next, Number(focused.slice(8))));
  };

  const commit = (value: LocalDate) => {
    if (!isSupportedDate(value)) return;
    onSelect(value);
    onClose();
  };

  return createPortal(
    <div
      ref={panelRef}
      className="tk-cal"
      /*
        Placed by the layout effect below, which runs before paint — so the
        pre-measurement values are never seen. They are real coordinates rather
        than `visibility: hidden` because a hidden element cannot take focus,
        and the calendar focuses a day the moment it opens.
      */
      style={{ left: `${position?.left ?? 0}px`, top: `${position?.top ?? 0}px` }}
      role="dialog"
      aria-modal="false"
      aria-label="Choose a night"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          // Handled by the buttons themselves; nothing to intercept.
          return;
        }
        const navigation = [
          "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
          "Home", "End", "PageUp", "PageDown",
        ];
        if (!navigation.includes(event.key)) return;
        event.preventDefault();
        keyboardMoved.current = true;
        setFocused(moveFocus(focused, event.key));
      }}
    >
      <div className="tk-cal-head">
        <button
          type="button"
          className="tk-cal-page"
          onClick={() => page(-1)}
          disabled={!monthIsReachable(shiftMonth(month, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        {/* Announced politely so a screen reader hears the month change without
            the grid being re-read from the top. */}
        <h2 className="tk-cal-month" aria-live="polite">
          {monthLabel}
        </h2>
        <button
          type="button"
          className="tk-cal-page"
          onClick={() => page(1)}
          disabled={!monthIsReachable(shiftMonth(month, 1))}
          aria-label="Next month"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      <div className="tk-cal-grid" role="grid" ref={gridRef}>
        <div className="tk-cal-week" role="row">
          {weekdayNames.map((day) => (
            <abbr key={day.long} className="tk-cal-weekday" title={day.long} role="columnheader">
              {day.short}
            </abbr>
          ))}
        </div>

        {Array.from({ length: 6 }, (_, week) => (
          <div className="tk-cal-week" role="row" key={week}>
            {cells.slice(week * 7, week * 7 + 7).map((cell) => {
              const isSelected = cell.date === date;
              const isToday = cell.date === today;
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  className="tk-cal-day"
                  data-date={cell.date}
                  data-outside={cell.inMonth ? undefined : "true"}
                  data-selected={isSelected ? "true" : undefined}
                  data-today={isToday ? "true" : undefined}
                  // One tab stop for the whole grid: Tab leaves the calendar,
                  // arrows move within it.
                  tabIndex={cell.date === focused ? 0 : -1}
                  aria-selected={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  disabled={!cell.selectable}
                  aria-label={
                    dayLabel.format(new Date(`${cell.date}T12:00:00`)) +
                    (marks.has(cell.date) ? ` — ${describeMarkers(marks.get(cell.date)!)}` : "")
                  }
                  onClick={() => commit(cell.date)}
                  onFocus={() => setFocused(cell.date)}
                >
                  <span className="tk-cal-num" aria-hidden>
                    {Number(cell.date.slice(8))}
                  </span>
                  {marks.has(cell.date) ? (
                    <span className="tk-cal-marks" aria-hidden>
                      {marks.get(cell.date)!.map((kind) => {
                        const Glyph = MARKS[kind];
                        return <Glyph key={kind} size={9} data-kind={kind} />;
                      })}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="tk-cal-foot">
        <button
          type="button"
          className="tk-cal-today"
          onClick={() => commit(today)}
          disabled={date === today}
        >
          Today
        </button>
      </div>
    </div>,
    document.body,
  );
}
