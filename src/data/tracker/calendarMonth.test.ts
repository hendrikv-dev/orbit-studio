import { describe, expect, it } from "vitest";

import {
  clampToMonth,
  daysInMonth,
  monthGrid,
  monthIsReachable,
  monthOf,
  moveFocus,
  shiftMonth,
  weekdayOf,
} from "./calendarMonth";
import { EARLIEST_SUPPORTED_DATE, LATEST_SUPPORTED_DATE } from "./skyContext";

describe("month arithmetic", () => {
  it("counts the days in a month, including February", () => {
    expect(daysInMonth("2026-01")).toBe(31);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29); // leap
    expect(daysInMonth("2100-02")).toBe(28); // not a leap year, despite /4
    expect(daysInMonth("2000-02")).toBe(29); // is a leap year, despite /100
    expect(daysInMonth("2026-04")).toBe(30);
  });

  it("steps across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-06", 18)).toBe("2027-12");
    expect(shiftMonth("2026-06", -18)).toBe("2024-12");
  });

  it("pulls a day back to the end of a shorter month", () => {
    expect(clampToMonth("2026-02", 31)).toBe("2026-02-28");
    expect(clampToMonth("2028-02", 31)).toBe("2028-02-29");
    expect(clampToMonth("2026-04", 31)).toBe("2026-04-30");
    expect(clampToMonth("2026-03", 15)).toBe("2026-03-15");
  });
});

describe("monthGrid", () => {
  it("always returns six whole weeks, so the popover never changes height", () => {
    for (const month of ["2026-02", "2026-08", "2027-05", "2028-02", "2026-11"]) {
      expect(monthGrid(month)).toHaveLength(42);
    }
  });

  it("starts on the requested weekday and runs consecutively", () => {
    for (const weekStart of [0, 1]) {
      const cells = monthGrid("2026-08", weekStart);
      expect(weekdayOf(cells[0].date)).toBe(weekStart);
      for (let i = 1; i < cells.length; i += 1) {
        const previous = new Date(`${cells[i - 1].date}T00:00:00Z`).getTime();
        const current = new Date(`${cells[i].date}T00:00:00Z`).getTime();
        expect(current - previous).toBe(86_400_000);
      }
    }
  });

  it("contains every day of the month exactly once, and marks the borrowed ones", () => {
    const cells = monthGrid("2026-02");
    const inMonth = cells.filter((cell) => cell.inMonth).map((cell) => cell.date);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[0]).toBe("2026-02-01");
    expect(inMonth.at(-1)).toBe("2026-02-28");
    expect(new Set(inMonth).size).toBe(28);
    // The rest are real dates from the neighbouring months, not blanks.
    for (const cell of cells.filter((c) => !c.inMonth)) {
      expect(cell.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(cell.date.startsWith("2026-02")).toBe(false);
    }
  });

  it("marks cells outside the ephemeris as unselectable rather than hiding them", () => {
    const cells = monthGrid(monthOf(EARLIEST_SUPPORTED_DATE));
    const before = cells.filter((cell) => cell.date < EARLIEST_SUPPORTED_DATE);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((cell) => !cell.selectable)).toBe(true);
    expect(cells.filter((c) => c.date >= EARLIEST_SUPPORTED_DATE).every((c) => c.selectable)).toBe(
      true,
    );
  });
});

describe("moveFocus", () => {
  it("moves by day and by week", () => {
    expect(moveFocus("2026-08-15", "ArrowLeft")).toBe("2026-08-14");
    expect(moveFocus("2026-08-15", "ArrowRight")).toBe("2026-08-16");
    expect(moveFocus("2026-08-15", "ArrowUp")).toBe("2026-08-08");
    expect(moveFocus("2026-08-15", "ArrowDown")).toBe("2026-08-22");
  });

  it("crosses month and year boundaries rather than stopping at them", () => {
    expect(moveFocus("2026-08-31", "ArrowRight")).toBe("2026-09-01");
    expect(moveFocus("2026-01-01", "ArrowLeft")).toBe("2025-12-31");
    expect(moveFocus("2026-12-28", "ArrowDown")).toBe("2027-01-04");
  });

  it("pages by month, keeping the day where the month is long enough", () => {
    expect(moveFocus("2026-03-15", "PageUp")).toBe("2026-02-15");
    expect(moveFocus("2026-03-31", "PageUp")).toBe("2026-02-28");
    expect(moveFocus("2026-01-31", "PageDown")).toBe("2026-02-28");
    expect(moveFocus("2026-12-15", "PageDown")).toBe("2027-01-15");
  });

  it("moves to the ends of the week", () => {
    // 2026-08-15 is a Saturday, so it is already the end of a Sunday-first week.
    expect(weekdayOf("2026-08-15")).toBe(6);
    expect(moveFocus("2026-08-15", "Home")).toBe("2026-08-09");
    expect(moveFocus("2026-08-15", "End")).toBe("2026-08-15");
    expect(moveFocus("2026-08-12", "Home")).toBe("2026-08-09");
    expect(moveFocus("2026-08-12", "End")).toBe("2026-08-15");
  });

  it("stops at the edges of the ephemeris instead of walking past them", () => {
    expect(moveFocus(EARLIEST_SUPPORTED_DATE, "ArrowLeft")).toBe(EARLIEST_SUPPORTED_DATE);
    expect(moveFocus(EARLIEST_SUPPORTED_DATE, "PageUp")).toBe(EARLIEST_SUPPORTED_DATE);
    expect(moveFocus(LATEST_SUPPORTED_DATE, "ArrowRight")).toBe(LATEST_SUPPORTED_DATE);
    expect(moveFocus(LATEST_SUPPORTED_DATE, "PageDown")).toBe(LATEST_SUPPORTED_DATE);
  });

  it("ignores keys it does not handle", () => {
    expect(moveFocus("2026-08-15", "a")).toBe("2026-08-15");
    expect(moveFocus("2026-08-15", "Enter")).toBe("2026-08-15");
  });
});

describe("monthIsReachable", () => {
  it("accepts the months at the edges and rejects the ones beyond", () => {
    expect(monthIsReachable(monthOf(EARLIEST_SUPPORTED_DATE))).toBe(true);
    expect(monthIsReachable(monthOf(LATEST_SUPPORTED_DATE))).toBe(true);
    expect(monthIsReachable(shiftMonth(monthOf(EARLIEST_SUPPORTED_DATE), -1))).toBe(false);
    expect(monthIsReachable(shiftMonth(monthOf(LATEST_SUPPORTED_DATE), 1))).toBe(false);
  });
});
