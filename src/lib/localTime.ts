/**
 * Times in the language of the place being observed from.
 *
 * "Best chance 00:35–01:20 UTC" is an engineering answer. Somebody deciding
 * whether to put a coat on needs "12:35–1:20 AM", in the clock time of wherever
 * they are standing — and if they are planning a trip, in the clock time of the
 * place they are going, not the one they are sitting in.
 *
 * ## How the zone is decided, and where that is approximate
 *
 * Two cases, and they are not equally good:
 *
 * - **The device's own location.** The browser knows its IANA zone, so the
 *   answer is exact, including daylight saving.
 * - **Anywhere else.** Turning coordinates into an IANA zone needs a boundary
 *   dataset or a provider that returns one, and neither is available on the
 *   free path. So the offset is derived from longitude, which is how time zones
 *   were laid out in the first place and is right for most of the world.
 *
 * It is wrong where politics beat geography — India's half-hour offset, China
 * on one zone, Spain an hour off its meridian — and it does not know about
 * daylight saving. Where the derived offset matches the device's current one,
 * the device zone is used instead, which quietly fixes the common case of
 * searching for somewhere near home.
 *
 * The approximation is stated in the interface's own detail rather than only
 * here, because a time that is silently an hour out is worse than no time.
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
 * The clock at a place known only by its coordinates.
 *
 * Falls back to the device zone when the derived offset matches it, so
 * searching for a campsite two valleys away keeps daylight saving right.
 */
export function clockForLongitude(longitudeDeg: number, now = new Date()): PlaceClock {
  const derivedHours = Math.round(longitudeDeg / 15);
  const offsetMinutes = derivedHours * MINUTES_PER_HOUR;
  const deviceOffset = -now.getTimezoneOffset();
  if (offsetMinutes === deviceOffset) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) return { timeZone, offsetMinutes, approximate: false };
  }
  return { timeZone: null, offsetMinutes, approximate: true };
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

/** °C or °F, following the formatting locale rather than asking. */
export function formatTemperature(celsius: number): string {
  const usesFahrenheit = ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].some((country) =>
    (Intl.DateTimeFormat().resolvedOptions().locale ?? "").toUpperCase().endsWith(country),
  );
  return usesFahrenheit
    ? `${Math.round(celsius * 1.8 + 32)}°F`
    : `${Math.round(celsius)}°C`;
}
