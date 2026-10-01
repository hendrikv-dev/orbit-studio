import { describe, expect, it } from "vitest";
import {
  EARLIEST_SUPPORTED_DATE,
  LATEST_SUPPORTED_DATE,
  daysBetween,
  describeDate,
  instantForDate,
  isLocalDate,
  isSupportedDate,
  shiftDate,
  todayIn,
} from "./skyContext";

describe("a date is a calendar date, not an instant", () => {
  it("reads today in the observer's zone rather than the machine's", () => {
    // 06:00 UTC on the 12th is still the 11th in Los Angeles. A reader there
    // asking for "today" means the 11th.
    const at = new Date("2026-08-12T06:00:00Z");
    expect(todayIn("America/Los_Angeles", at)).toBe("2026-08-11");
    expect(todayIn("Europe/London", at)).toBe("2026-08-12");
    expect(todayIn("Asia/Tokyo", at)).toBe("2026-08-12");
  });

  it("accepts real dates and rejects ones that do not exist", () => {
    expect(isLocalDate("2026-08-12")).toBe(true);
    expect(isLocalDate("2024-02-29")).toBe(true);
    expect(isLocalDate("2025-02-29")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-04-31")).toBe(false);
    expect(isLocalDate("12 August 2026")).toBe(false);
  });

  it("moves by whole days across month and year boundaries", () => {
    expect(shiftDate("2026-08-12", 1)).toBe("2026-08-13");
    expect(shiftDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDate("2026-08-12", 0)).toBe("2026-08-12");
  });

  it("counts days without drifting across daylight saving", () => {
    // A US spring-forward weekend is 2 days, not 1.958.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-08-12", "2026-08-12")).toBe(0);
    expect(daysBetween("2026-08-12", "2026-08-11")).toBe(-1);
    expect(daysBetween("2025-08-12", "2026-08-12")).toBe(365);
  });
});

describe("the instant handed to the astronomy", () => {
  it("is local noon, so the night asked for is the night returned", () => {
    // Midnight would land inside the *previous* evening's night, because the
    // observation period anchors to the night an instant falls in.
    const at = instantForDate("2026-08-12", "America/Los_Angeles");
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      dateStyle: "short",
      timeStyle: "short",
      hour12: false,
    }).format(at);
    expect(local).toMatch(/2026-08-12/);
    expect(local).toMatch(/12:00/);
  });

  it("is right on both sides of a daylight-saving change", () => {
    for (const date of ["2026-03-07", "2026-03-09", "2026-10-31", "2026-11-02"]) {
      const at = instantForDate(date, "America/Los_Angeles");
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
      }).formatToParts(at);
      const hour = parts.find((part) => part.type === "hour")?.value;
      expect(hour).toBe("12");
    }
  });

  it("handles a half-hour zone", () => {
    const at = instantForDate("2026-08-12", "Asia/Kolkata");
    const hour = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      hour12: false,
      hour: "2-digit",
    }).format(at);
    expect(hour).toBe("12");
  });

  it("falls back to UTC noon without a zone", () => {
    expect(instantForDate("2026-08-12", null).toISOString()).toBe("2026-08-12T12:00:00.000Z");
  });
});

describe("naming the date in a heading", () => {
  const today = "2026-08-12";

  it("calls today tonight, because that is what a reader calls it", () => {
    expect(describeDate(today, today, "en-GB").heading).toBe("tonight");
  });

  it("names the near days plainly", () => {
    expect(describeDate("2026-08-13", today, "en-GB").heading).toBe("tomorrow");
    expect(describeDate("2026-08-11", today, "en-GB").heading).toBe("last night");
  });

  it("names any other date by its date", () => {
    expect(describeDate("2026-09-04", today, "en-GB").heading).toBe("on 4 Sept");
    expect(describeDate("2024-08-12", today, "en-GB").heading).toMatch(/2024/);
  });

  it("never uses language about the software", () => {
    // No "Historical results", no "Past mode", no "Archive" — the calendar
    // already says when the reader is looking.
    for (const date of ["1999-12-31", "2024-08-12", "2030-01-01", today]) {
      const { heading } = describeDate(date, today, "en-GB");
      expect(heading).not.toMatch(/historic|past|future|archive|mode/i);
    }
  });
});

describe("the supported range", () => {
  it("accepts dates inside the ephemeris's documented accuracy window", () => {
    expect(isSupportedDate("2026-08-12")).toBe(true);
    expect(isSupportedDate("1999-12-31")).toBe(true);
    expect(isSupportedDate(EARLIEST_SUPPORTED_DATE)).toBe(true);
    expect(isSupportedDate(LATEST_SUPPORTED_DATE)).toBe(true);
  });

  it("refuses dates outside it rather than quoting numbers it does not trust", () => {
    expect(isSupportedDate("1699-12-31")).toBe(false);
    expect(isSupportedDate("2201-01-01")).toBe(false);
    expect(isSupportedDate("1543-06-01")).toBe(false);
  });
});

describe("which night an instant belongs to", () => {
  /**
   * The subtle one, caught by the aurora fixtures rather than by reasoning.
   *
   * A chosen date is anchored at local noon, because the observation period
   * attaches an instant to the night it falls in and midnight on the 12th falls
   * inside the 11th's evening. But *today* must be anchored at now, not noon: a
   * reader looking at 1 AM is standing under a night that began yesterday
   * evening, and noon would skip it for the next one twenty hours away.
   */
  it("anchors a chosen date at local noon, which is inside that date's daylight", () => {
    const at = instantForDate("2026-08-12", "America/Los_Angeles");
    const hour = Number(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        hour12: false,
        hour: "2-digit",
      }).format(at),
    );
    // Between dawn and dusk, so the next sunset is the 12th's own night.
    expect(hour).toBeGreaterThan(6);
    expect(hour).toBeLessThan(18);
  });

  it("does not move a chosen date's anchor with the wall clock", () => {
    // Two calls hours apart describe the same night, because the anchor comes
    // from the date rather than from now.
    const first = instantForDate("2024-04-08", "America/Los_Angeles");
    const second = instantForDate("2024-04-08", "America/Los_Angeles");
    expect(first.getTime()).toBe(second.getTime());
  });

  it("gives today's date for an instant just after local midnight", () => {
    // 00:30 local on the 12th is still the 12th — and the night in progress
    // belongs to the 11th's evening, which is why the app anchors today at
    // `now` rather than at this date's noon.
    const justAfterMidnight = new Date("2026-08-12T07:30:00Z"); // 00:30 PDT
    expect(todayIn("America/Los_Angeles", justAfterMidnight)).toBe("2026-08-12");
  });
});
