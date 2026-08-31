import {
  EARLIEST_SUPPORTED_DATE,
  LATEST_SUPPORTED_DATE,
  isSupportedDate,
  type LocalDate,
} from "./skyContext";

/**
 * The arithmetic behind Tracker's month calendar.
 *
 * ## Why this is its own module
 *
 * Calendar grids are where date bugs live: the month that starts on a Sunday,
 * the one with 28 days, the leap year, the row that is entirely next month.
 * None of that is visible in a React component until somebody opens April 2027
 * and finds a blank row, so the arithmetic is separated from the rendering and
 * tested directly.
 *
 * Everything here is a plain `YYYY-MM-DD` string in the observer's own local
 * days — no `Date` objects escape, and nothing depends on the machine's time
 * zone. `Date.UTC` is used internally purely as day-number arithmetic.
 */

/** A calendar month, as `YYYY-MM`. */
export type LocalMonth = string;

export function monthOf(date: LocalDate): LocalMonth {
  return date.slice(0, 7);
}

/** First day of a month, as a full date. */
export function firstOfMonth(month: LocalMonth): LocalDate {
  return `${month}-01`;
}

export function shiftMonth(month: LocalMonth, delta: number): LocalMonth {
  const [year, index] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: LocalMonth): number {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

/** Day of the week for a date, 0 = Sunday. */
export function weekdayOf(date: LocalDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export interface CalendarCell {
  date: LocalDate;
  /** False for the leading and trailing days borrowed from adjacent months. */
  inMonth: boolean;
  /** False where the ephemeris is not trusted, so the cell cannot be chosen. */
  selectable: boolean;
}

/**
 * A month as a grid of whole weeks.
 *
 * Always six rows. A five-row month and a six-row month next to each other make
 * the popover change height as the reader pages through it, which moves every
 * control under the cursor — so the grid is a fixed 42 cells and the extra days
 * come from the neighbouring months, marked as such.
 *
 * `weekStartsOn` is the locale's own first weekday, because a Monday-first
 * reader given a Sunday-first grid will misread the column a date sits in.
 */
export function monthGrid(month: LocalMonth, weekStartsOn = 0): CalendarCell[] {
  const first = firstOfMonth(month);
  const lead = (weekdayOf(first) - weekStartsOn + 7) % 7;
  const start = addDays(first, -lead);

  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    cells.push({
      date,
      inMonth: date.startsWith(month),
      selectable: isSupportedDate(date),
    });
  }
  return cells;
}

/** `shiftDate`, kept local so the grid has no dependency on presentation. */
function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-${String(
    moved.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Where the keyboard lands, given a key and the day it starts on.
 *
 * Returns the same date when the move would leave what the ephemeris supports,
 * so holding an arrow at the edge of the range stops rather than wrapping into
 * dates Tracker will not answer for.
 */
export function moveFocus(from: LocalDate, key: string): LocalDate {
  const step = (days: number) => {
    const next = addDays(from, days);
    return isSupportedDate(next) ? next : from;
  };
  switch (key) {
    case "ArrowLeft":
      return step(-1);
    case "ArrowRight":
      return step(1);
    case "ArrowUp":
      return step(-7);
    case "ArrowDown":
      return step(7);
    case "Home": {
      // Start of this week, in the grid's own column order.
      const back = weekdayOf(from);
      return step(-back);
    }
    case "End": {
      const forward = 6 - weekdayOf(from);
      return step(forward);
    }
    case "PageUp": {
      const next = clampToMonth(shiftMonth(monthOf(from), -1), Number(from.slice(8)));
      return isSupportedDate(next) ? next : from;
    }
    case "PageDown": {
      const next = clampToMonth(shiftMonth(monthOf(from), 1), Number(from.slice(8)));
      return isSupportedDate(next) ? next : from;
    }
    default:
      return from;
  }
}

/**
 * The same day-of-month in another month, pulled back to the last day when it
 * does not exist there. Paging from 31 March lands on 28 February, not 3 March.
 */
export function clampToMonth(month: LocalMonth, day: number): LocalDate {
  const last = daysInMonth(month);
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Whether a month is wholly outside what the ephemeris supports. */
export function monthIsReachable(month: LocalMonth): boolean {
  return (
    `${month}-${String(daysInMonth(month)).padStart(2, "0")}` >= EARLIEST_SUPPORTED_DATE &&
    firstOfMonth(month) <= LATEST_SUPPORTED_DATE
  );
}
