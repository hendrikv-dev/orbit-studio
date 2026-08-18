import tzLookup from "@photostructure/tz-lookup";

/**
 * Times in the language of the place being observed from.
 *
 * "Best chance 00:35–01:20 UTC" is an engineering answer. Somebody deciding
 * whether to put a coat on needs "12:35–1:20 AM", in the clock time of wherever
 * they are standing — and if they are planning a trip, in the clock time of the
 * place they are going, not the one they are sitting in.
 *
 * ## How the zone is decided
 *
 * Coordinates are resolved to an IANA zone from a vendored boundary dataset, so
 * `Intl` handles daylight saving and every political oddity for us.
 *
 * This replaces an approximation that was documented as a known defect: the
 * offset used to be derived from longitude, which is how time zones were laid
 * out but not how they ended up. It was wrong wherever politics beat geography
 * — India's half-hour offset, Spain an hour off its meridian, all of China on
 * one zone — and it knew nothing about daylight saving. A time silently an hour
 * out is worse than no time at all, and this is a stargazing app, where the
 * whole output is a time.
 *
 * The dataset is lossily compressed to keep it small, so a point within a few
 * hundred metres of a zone boundary can resolve to the neighbouring zone. That
 * matters far less than the hour it removes, and nowhere anybody observes from
 * is likely to sit on the line.
 */

export interface PlaceClock {
  /** IANA zone where it is known exactly. */
  timeZone: string | null;
  /** Minutes east of UTC, used when `timeZone` is null. */
  offsetMinutes: number;
  /** True where the offset was derived from longitude rather than known. */
  approximate: boolean;
}

const MINUTES_PER_HOUR = 60;

/** The device's own zone, which is exact for the device's own location. */
export function deviceClock(): PlaceClock {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    timeZone: timeZone ?? null,
    offsetMinutes: -new Date().getTimezoneOffset(),
    approximate: false,
  };
}

/**
 * The clock at a place, from its coordinates.
 *
 * The lookup is offline and synchronous. Where it cannot answer — the middle of
 * an ocean, or coordinates outside the dataset — the longitude approximation is
 * kept as a fallback and flagged as approximate, so the caller can still say
 * something rather than nothing.
 */
export function clockForCoordinates(
  latitudeDeg: number,
  longitudeDeg: number,
): PlaceClock {
  try {
    const timeZone = tzLookup(latitudeDeg, longitudeDeg);
    if (timeZone) {
      return { timeZone, offsetMinutes: offsetOf(timeZone), approximate: false };
    }
  } catch {
    // Out of range, or a coordinate the dataset does not cover.
  }
  return {
    timeZone: null,
    offsetMinutes: Math.round(longitudeDeg / 15) * MINUTES_PER_HOUR,
    approximate: true,
  };
}

/** Current offset of a named zone, in minutes east of UTC. */
function offsetOf(timeZone: string, at = new Date()): number {
  // Formatting the same instant in the zone and in UTC and differencing them is
  // the only way to get an offset out of Intl, and it follows daylight saving
  // because the formatter does.
  const inZone = new Date(at.toLocaleString("en-US", { timeZone }));
  const inUtc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((inZone.getTime() - inUtc.getTime()) / 60_000);
}

function shifted(iso: string, clock: PlaceClock): Date {
  return new Date(Date.parse(iso) + clock.offsetMinutes * 60_000);
}

/** "12:35 AM" in the place's clock. */
export function formatClockTime(iso: string, clock: PlaceClock): string {
  if (clock.timeZone) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: clock.timeZone,
    }).format(new Date(iso));
  }
  // Formatted from a UTC-shifted instant, so the formatter must be told to read
  // it as UTC — otherwise the machine's own zone is applied a second time.
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(shifted(iso, clock));
}

/** "12:35–1:20 AM", collapsing a repeated meridiem. */
export function formatClockRange(startIso: string, endIso: string, clock: PlaceClock): string {
  const start = formatClockTime(startIso, clock);
  const end = formatClockTime(endIso, clock);
  const meridiem = /\s?([AP]M)$/i;
  const startMeridiem = meridiem.exec(start)?.[1];
  const endMeridiem = meridiem.exec(end)?.[1];
  if (startMeridiem && endMeridiem && startMeridiem === endMeridiem) {
    return `${start.replace(meridiem, "")}–${end}`;
  }
  return `${start}–${end}`;
}

/** "Tonight", "Tomorrow night" or a date, in the place's clock. */
export function formatNightLabel(startIso: string, clock: PlaceClock, now = new Date()): string {
  const dayKey = (date: Date) =>
    clock.timeZone
      ? new Intl.DateTimeFormat("en-CA", { timeZone: clock.timeZone }).format(date)
      : new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(
          new Date(date.getTime() + clock.offsetMinutes * 60_000),
        );

  const start = new Date(startIso);
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000));
  const startDay = dayKey(start);

  if (startDay === today) return "Tonight";
  if (startDay === tomorrow) return "Tomorrow night";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: clock.timeZone ?? "UTC",
  }).format(clock.timeZone ? start : shifted(startIso, clock));
}

/**
 * A viewing window as a phrase: "12:35–1:20 AM", or "around 9:43 PM".
 *
 * Centralised because both the hero and the ranked cards formatted the window
 * themselves, and a window can legitimately collapse to a single instant — an
 * object low in the west after dusk may have one usable moment before it sets.
 * Rendered as a range that reads "9:43–9:43 PM", which says nothing and looks
 * broken. Two call sites meant two places to get that wrong.
 */
export function formatWindowPhrase(
  window: { startUtc: string; endUtc: string; peakUtc: string; brief: boolean },
  clock: PlaceClock,
): string {
  return window.brief
    ? `around ${formatClockTime(window.peakUtc, clock)}`
    : formatClockRange(window.startUtc, window.endUtc, clock);
}

/** °C or °F, following the formatting locale rather than asking. */
export function formatTemperature(celsius: number): string {
  const usesFahrenheit = ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].some((country) =>
    (Intl.DateTimeFormat().resolvedOptions().locale ?? "").toUpperCase().endsWith(country),
  );
  return usesFahrenheit
    ? `${Math.round(celsius * 1.8 + 32)}°F`
    : `${Math.round(celsius)}°C`;
}
