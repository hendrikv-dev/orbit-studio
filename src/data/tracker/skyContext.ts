/**
 * The three things every Tracker answer depends on.
 *
 * ## Why this is one type
 *
 * Tracker could already compute any night from any place: `planNight` takes a
 * `Date` and a latitude and longitude, and never cared which date it was. What
 * was locked to tonight was the *interface* — `planAnchor` was seeded with
 * `new Date()` and nothing could change it.
 *
 * So the work is not to teach the astronomy about history. It is to give the
 * page a date it can be told, and to keep that date, the place, and what the
 * reader is asking about as three independent values. Independent is the whole
 * point: "what was visible from Seattle on 12 August 2024" is one change of
 * date and one change of place, and neither may reset the other.
 *
 * ## What this is not
 *
 * Not a mode. There is no Past or Future or Archive — a date is a date, and
 * today is simply the one Tracker opens on. Every view renders the same way
 * whichever date it holds, which is why the type has no notion of "historical".
 */

import type { PhenomenonCategoryId } from "./phenomenonCategories";

/**
 * A calendar date, as the observer's civil day rather than an instant.
 *
 * Stored as `YYYY-MM-DD` because that is what a date *is* here: the night of
 * the 12th is the night of the 12th wherever you are reading it, and an instant
 * would drift across the date line and across daylight saving. The instant is
 * derived when the astronomy needs one, from this plus the place's time zone.
 */
export type LocalDate = string;

export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the reader is asking about.
 *
 * Deliberately small. The brief's warning against exposing a giant astronomical
 * taxonomy is the right one: the useful axis is the handful of things somebody
 * would actually filter to, and everything finer is served by opening the event
 * itself.
 */
export type SkySubject = PhenomenonCategoryId;

export interface SkyContext {
  date: LocalDate;
  /** Null until a place is confirmed; the entry screen's state. */
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  subject: SkySubject;
}

/** Today, in the observer's own time zone rather than the machine's. */
export function todayIn(timeZone: string | null, now: Date = new Date()): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isLocalDate(value: string): value is LocalDate {
  if (!LOCAL_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Reject the 31st of February and friends: `Date.UTC` rolls them over, so a
  // round trip through it is the cheapest real calendar check available.
  const rolled = new Date(Date.UTC(year, month - 1, day));
  return (
    rolled.getUTCFullYear() === year &&
    rolled.getUTCMonth() === month - 1 &&
    rolled.getUTCDate() === day
  );
}

/**
 * The instant to hand the astronomy for a chosen date.
 *
 * Local noon, not midnight. `trackerObservationPeriod` anchors to "the night
 * `at` falls in, or the next one if it is daytime" — so midnight on the 12th
 * lands *inside* the night that began on the 11th, and the reader who asked for
 * the 12th would be shown the wrong evening. Noon is unambiguously the middle
 * of the 12th's daylight, and the next sunset is the 12th's night.
 *
 * The offset is derived from the zone rather than assumed, so this is right
 * across daylight saving and in zones at half-hour offsets.
 */
export function instantForDate(date: LocalDate, timeZone: string | null): Date {
  const [year, month, day] = date.split("-").map(Number);
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  if (!timeZone) return new Date(utcNoon);
  // How far the zone sits from UTC at that moment, measured by formatting the
  // instant in the zone and reading the difference back.
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcNoon));
  const at = (type: string) => Number(formatted.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour") % 24,
    at("minute"),
    at("second"),
  );
  return new Date(utcNoon - (asUtc - utcNoon));
}

/** Move a date by whole days, staying a calendar date throughout. */
export function shiftDate(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-${String(
    moved.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Whole days from `from` to `to`, positive when `to` is later. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const parse = (value: LocalDate) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * How the date should be named in a heading.
 *
 * Today is "tonight", because that is what a reader calls it and because the
 * default state should not read like a query result. Everything else is named
 * by its date — never "Historical" or "Past mode", which describe the software
 * rather than the sky.
 */
export function describeDate(
  date: LocalDate,
  today: LocalDate,
  locale?: string,
): { heading: string; relative: "today" | "tomorrow" | "yesterday" | "other" } {
  const offset = daysBetween(today, date);
  if (offset === 0) return { heading: "tonight", relative: "today" };
  if (offset === 1) return { heading: "tomorrow", relative: "tomorrow" };
  if (offset === -1) return { heading: "last night", relative: "yesterday" };
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(year, month - 1, day);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return {
    heading: `on ${new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(at)}`,
    relative: "other",
  };
}

/**
 * The range Tracker will answer for, and why it stops there.
 *
 * Astronomy Engine's own documented accuracy window is 1700–2200 for the
 * planets and the Moon; outside it the ephemeris still returns numbers and they
 * stop being trustworthy. Tracker refuses rather than quoting them, because a
 * confident answer for 1543 is worse than no answer.
 */
export const EARLIEST_SUPPORTED_DATE: LocalDate = "1700-01-01";
export const LATEST_SUPPORTED_DATE: LocalDate = "2200-12-31";

export function isSupportedDate(date: LocalDate): boolean {
  return (
    isLocalDate(date) && date >= EARLIEST_SUPPORTED_DATE && date <= LATEST_SUPPORTED_DATE
  );
}
