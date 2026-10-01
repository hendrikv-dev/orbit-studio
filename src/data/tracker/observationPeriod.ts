import {
  Body,
  Equator,
  Horizon,
  MakeTime,
  Observer,
  SearchAltitude,
  SearchRiseSet,
} from "astronomy-engine";

/**
 * The observation period Tracker frames everything against — "tonight".
 *
 * Implements TRACKER_PRD R4.1–R4.3. The period is derived from the observer's
 * location, not from a calendar day: it runs from the evening's sunset to the
 * following sunrise, so at 01:00 local it still describes the evening that has
 * just passed and the morning to come, and an event at 04:30 belongs to the
 * night that is ending rather than the one beginning that evening.
 *
 * The period frames the view; it does not clip an event. A solar eclipse
 * happens in daylight and is outside every period, which is why events carry
 * their own windows and this only supplies the frame and the darkness inside it.
 *
 * Sunset and sunrise are the frame. Darkness is reported separately, because
 * how dark it gets is what decides whether a meteor shower is worth watching
 * and it varies from "astronomical darkness for eight hours" to "never darker
 * than civil twilight" at the same latitude across a year.
 */

/** Sun altitudes that define the conventional twilight bands. */
const TWILIGHT_ALTITUDES = {
  civil: -6,
  nautical: -12,
  astronomical: -18,
} as const;

export type TwilightBand = keyof typeof TWILIGHT_ALTITUDES;

export type ObservationPeriodKind =
  /** The Sun sets and rises: an ordinary night. */
  | "night"
  /** The Sun does not set. Darkness-dependent events are unobservable. */
  | "polar-day"
  /** The Sun does not rise. The whole local day is available. */
  | "polar-night";

export interface DarknessWindow {
  startUtc: string;
  endUtc: string;
}

export interface ObservationPeriod {
  kind: ObservationPeriodKind;
  /** Sunset, or the start of the local day where the Sun does not set or rise. */
  startUtc: string;
  /** Sunrise, or the end of that local day. */
  endUtc: string;
  /**
   * Windows in which the Sun is below each twilight altitude. A band is absent
   * when the Sun never gets that low, which is the normal summer case at high
   * latitude and not an error.
   */
  darkness: Partial<Record<TwilightBand, DarknessWindow>>;
  /** How far below the horizon the Sun gets at its lowest, in degrees. */
  deepestSunAltitudeDeg: number;
  /** Stated where darkness is limited or absent, so a view can say why. */
  limitation?: string;
}

const MS_PER_HOUR = 3_600_000;

function iso(date: Date): string {
  return date.toISOString();
}

/**
 * Sun altitude at an instant, used to report how dark the night actually gets
 * rather than assuming the twilight bands were reached.
 */
function sunAltitudeDeg(observer: Observer, at: Date): number {
  const time = MakeTime(at);
  // Horizon() needs equatorial coordinates; Equator with the observer applied
  // gives the topocentric position the altitude is measured from.
  const equator = Equator(Body.Sun, time, observer, true, true);
  return Horizon(time, observer, equator.ra, equator.dec, "normal").altitude;
}

/**
 * The period covering the night that `atUtc` falls in, or the next one if it is
 * currently daytime.
 */
export function trackerObservationPeriod(
  latitudeDeg: number,
  longitudeDeg: number,
  atUtc: Date,
): ObservationPeriod {
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const at = MakeTime(atUtc);

  const previousSunset = SearchRiseSet(Body.Sun, observer, -1, at, -1);
  const nextSunrise = SearchRiseSet(Body.Sun, observer, +1, at, 1);
  const nextSunset = SearchRiseSet(Body.Sun, observer, -1, at, 1);

  // Polar cases first: without a sunset or a sunrise the ordinary anchoring
  // logic has nothing to anchor to.
  if (!previousSunset && !nextSunset) {
    const dayStart = new Date(atUtc.getTime() - 12 * MS_PER_HOUR);
    const dayEnd = new Date(atUtc.getTime() + 12 * MS_PER_HOUR);
    // Not `!nextSunrise`: under a midnight sun the Sun never *rises* either,
    // because it never set, so the absence of a rise event describes both
    // cases. Only the Sun's actual altitude separates them.
    const polarNight = sunAltitudeDeg(observer, atUtc) < 0;
    return {
      kind: polarNight ? "polar-night" : "polar-day",
      startUtc: iso(dayStart),
      endUtc: iso(dayEnd),
      darkness: polarNight
        ? { civil: { startUtc: iso(dayStart), endUtc: iso(dayEnd) } }
        : {},
      deepestSunAltitudeDeg: sunAltitudeDeg(observer, polarNight ? atUtc : atUtc),
      limitation: polarNight
        ? "The Sun does not rise at this location today, so the whole day is available and darkness is not the limiting factor."
        : "The Sun does not set at this location today. Events that need darkness cannot be seen.",
    };
  }

  // Anchor to the night in progress where there is one, so 01:00 still belongs
  // to the evening that has passed.
  //
  // The test is whether the sunrise that ends the *previous sunset's* night is
  // still ahead — not merely whether some sunrise is ahead, which is true at
  // every instant and made midday resolve to the night that had already ended.
  const sunriseEndingPreviousNight = previousSunset
    ? SearchRiseSet(Body.Sun, observer, +1, MakeTime(previousSunset.date), 1)
    : null;
  const insideNight =
    previousSunset &&
    sunriseEndingPreviousNight &&
    sunriseEndingPreviousNight.date.getTime() > atUtc.getTime()
      ? previousSunset
      : null;
  const start = insideNight ?? nextSunset ?? previousSunset!;
  const startDate = start.date;
  const end =
    SearchRiseSet(Body.Sun, observer, +1, MakeTime(startDate), 1) ?? nextSunrise;
  const endDate = end ? end.date : new Date(startDate.getTime() + 12 * MS_PER_HOUR);

  const darkness: Partial<Record<TwilightBand, DarknessWindow>> = {};
  for (const band of Object.keys(TWILIGHT_ALTITUDES) as TwilightBand[]) {
    const altitude = TWILIGHT_ALTITUDES[band];
    const dusk = SearchAltitude(Body.Sun, observer, -1, MakeTime(startDate), 1, altitude);
    if (!dusk || dusk.date >= endDate) continue;
    const dawn = SearchAltitude(Body.Sun, observer, +1, MakeTime(dusk.date), 1, altitude);
    if (!dawn) continue;
    darkness[band] = { startUtc: iso(dusk.date), endUtc: iso(dawn.date) };
  }

  // Local midnight is where the Sun is lowest, and is a better sample than the
  // period's midpoint when the night is asymmetric about it.
  const midnight = new Date((startDate.getTime() + endDate.getTime()) / 2);
  const deepest = sunAltitudeDeg(observer, midnight);

  let limitation: string | undefined;
  if (!darkness.astronomical) {
    limitation = darkness.nautical
      ? "The Sun never drops below 18°, so the sky does not reach full astronomical darkness tonight."
      : darkness.civil
        ? "The Sun stays above 12°, so the sky remains in nautical twilight at its darkest."
        : "The sky does not get darker than civil twilight tonight.";
  }

  return {
    kind: "night",
    startUtc: iso(startDate),
    endUtc: iso(endDate),
    darkness,
    deepestSunAltitudeDeg: deepest,
    limitation,
  };
}

/** True where the instant falls inside the period's frame. */
export function isWithinObservationPeriod(period: ObservationPeriod, at: Date): boolean {
  return (
    at.getTime() >= Date.parse(period.startUtc) && at.getTime() <= Date.parse(period.endUtc)
  );
}

/** The darkest band actually reached, or null where none is. */
export function deepestTwilightBand(period: ObservationPeriod): TwilightBand | null {
  if (period.darkness.astronomical) return "astronomical";
  if (period.darkness.nautical) return "nautical";
  if (period.darkness.civil) return "civil";
  return null;
}
