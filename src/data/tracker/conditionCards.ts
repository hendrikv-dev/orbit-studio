import { Body, Equator, Horizon, MakeTime, Observer } from "astronomy-engine";
import {
  nearestSnapshot,
  readCondition,
  type ConditionSnapshot,
  type EnvironmentalEvidenceStatus,
} from "./conditions";
import { aerosolExtinctionMagnitudes, readAerosol, type AerosolReading } from "./airQuality";
import { lunarPhaseAt } from "./lunarPhase";
import { formatTemperature } from "../../lib/localTime";

/**
 * The four condition cards, computed once for whatever event is on screen.
 *
 * Always four, always the same four, always in the same order. That is a design
 * constraint from the specification and it is also the only way the cards stay
 * comparable: a row whose contents changed with the phenomenon would make the
 * reader re-read the labels every time they moved between events, and a fifth
 * "explanatory" card would turn the row into a weather dashboard, which is the
 * thing this product is not.
 *
 * ## The honest-absence problem
 *
 * Three of the four are forecasts and one is geometry, and they fail
 * differently. Cloud, smoke and temperature are unknowable outside the
 * forecast horizon and unknown wherever no provider covers the location. The
 * Moon is known for any date, from an ephemeris, to a precision far beyond what
 * anybody observing needs.
 *
 * So a card for an eclipse three months out reads:
 *
 *     Cloud cover      Forecast closer to date
 *     Smoke            Forecast closer to date
 *     Moonlight        Full Moon
 *     Temperature      Forecast closer to date
 *
 * Three absences and one fact, which is the true state of knowledge. Filling
 * the first three with seasonal averages would look better and be a fabrication;
 * dropping them would break the geometry the row exists to hold.
 */

export type ConditionCardId = "cloud" | "smoke" | "moonlight" | "temperature";
export type ConditionTone = "good" | "fair" | "poor" | "unknown";

export interface ConditionCard {
  id: ConditionCardId;
  label: string;
  /** The number or state. Never invented. */
  value: string;
  /** What it means for observing, in two or three words. Null where unknown. */
  interpretation: string | null;
  tone: ConditionTone;
}

/**
 * How far ahead a point forecast is worth quoting at all.
 *
 * MET Norway publishes about nine days and the US National Weather Service
 * about seven, but "published" and "useful for deciding whether to drive to a
 * dark site" are not the same horizon. Seven days is the outer edge at which
 * cloud cover for a particular evening carries any decision value, and beyond
 * it the honest answer is that the forecast does not exist yet.
 */
export const FORECAST_HORIZON_DAYS = 7;

/**
 * How far into the past an event may reach and still be given a forecast.
 *
 * Not zero, because an observing window that opened two hours ago and has not
 * closed is a live event and the current forecast genuinely describes it. Small,
 * because beyond that a "forecast" for a time already past is a contradiction:
 * whatever the sky did, it has done it.
 */
export const FORECAST_PAST_TOLERANCE_HOURS = 3;

/**
 * Whether a forecast can speak about an instant at all.
 *
 * The bound used to be one-sided — `daysAhead <= 7` — which is satisfied by
 * every negative number ever computed. An event from last August therefore
 * entered the branch that looks for a forecast, and any provider sample within
 * the matching tolerance was attached to it. A forecast is a claim about the
 * future; the lower bound is what makes that true in code as well as in prose.
 */
export function withinForecastHorizon(atUtc: string, now: Date): boolean {
  const hoursAhead = (Date.parse(atUtc) - now.getTime()) / 3_600_000;
  if (hoursAhead < -FORECAST_PAST_TOLERANCE_HOURS) return false;
  return hoursAhead / 24 <= FORECAST_HORIZON_DAYS;
}

/** True where the instant is far enough behind that no forecast applies to it. */
export function isPastEvent(atUtc: string, now: Date): boolean {
  return (Date.parse(atUtc) - now.getTime()) / 3_600_000 < -FORECAST_PAST_TOLERANCE_HOURS;
}

const BEYOND_HORIZON = "Forecast closer to date";
/**
 * The past has no forecast, and saying "closer to date" about it would be
 * nonsense — the date has been and gone. Distinct wording, because it is a
 * distinct situation and the reader can tell them apart.
 */
const ALREADY_PAST = "Not recorded";

function unknownCard(
  id: ConditionCardId,
  label: string,
  value: string,
  interpretation: string | null = null,
): ConditionCard {
  return { id, label, value, interpretation, tone: "unknown" };
}

/* ------------------------------------------------------------- moonlight */

/**
 * Moonlight, which is the one card that is always answerable.
 *
 * Both halves matter and neither is enough alone. A full Moon below the horizon
 * costs nothing, and a half Moon high overhead costs a meteor watch most of its
 * faint end. So the value names the phase and the interpretation names what it
 * does to *this* night, from the Moon's actual altitude at the event.
 */
export function moonlightCard(
  atUtc: string,
  latitudeDeg: number,
  longitudeDeg: number,
): ConditionCard {
  const at = new Date(atUtc);
  const phase = lunarPhaseAt(at);
  const observer = new Observer(latitudeDeg, longitudeDeg, 0);
  const time = MakeTime(at);
  const equator = Equator(Body.Moon, time, observer, true, true);
  const altitudeDeg = Horizon(time, observer, equator.ra, equator.dec, "normal").altitude;
  const percent = Math.round(Number(phase.illuminatedFraction) * 100);

  if (altitudeDeg <= 0) {
    return {
      id: "moonlight",
      label: "Moonlight",
      value: `${percent}% · below horizon`,
      interpretation: "Dark sky",
      tone: "good",
    };
  }

  // The product of illumination and how high it has climbed, which is roughly
  // how much sky brightness it actually adds.
  const load = (percent / 100) * Math.sin((altitudeDeg * Math.PI) / 180);
  return {
    id: "moonlight",
    label: "Moonlight",
    value: `${phase.name} · ${percent}%`,
    interpretation: load > 0.45 ? "Washes out faint objects" : load > 0.18 ? "Some glare" : "Little effect",
    tone: load > 0.45 ? "poor" : load > 0.18 ? "fair" : "good",
  };
}

/* ----------------------------------------------------------------- cloud */

function cloudCard(snapshot: ConditionSnapshot | null): ConditionCard {
  if (!snapshot) return unknownCard("cloud", "Cloud cover", "Not reported");
  const percent = Math.round(snapshot.cloudCoverPercent);
  const reading = readCondition(snapshot);
  if (reading.condition === "precipitating") {
    return { id: "cloud", label: "Cloud cover", value: "Rain or snow", interpretation: "Sky closed", tone: "poor" };
  }
  if (reading.condition === "foggy") {
    return { id: "cloud", label: "Cloud cover", value: "Fog", interpretation: "Sky closed", tone: "poor" };
  }
  return {
    id: "cloud",
    label: "Cloud cover",
    value: `${percent}%`,
    interpretation: percent < 25 ? "Good" : percent < 55 ? "Broken" : percent < 80 ? "Poor" : "Overcast",
    tone: percent < 25 ? "good" : percent < 55 ? "fair" : "poor",
  };
}

/* ----------------------------------------------------------------- smoke */

const AEROSOL_LABEL: Record<AerosolReading, { value: string; tone: ConditionTone }> = {
  clean: { value: "Clean", tone: "good" },
  slight: { value: "Slight haze", tone: "good" },
  hazy: { value: "Hazy", tone: "fair" },
  smoky: { value: "Smoky", tone: "poor" },
  heavy: { value: "Heavy smoke", tone: "poor" },
};

/**
 * Haze and smoke, from the aerosol model where one covers this location.
 *
 * This card used to be permanently empty: neither weather provider carries an
 * aerosol layer, so it read "Not reported" everywhere while holding a quarter
 * of the most valuable row on the page. It is now backed by aerosol optical
 * depth, which is the measurement that answers the observing question — how
 * much light the atmosphere is taking away — expressed in the magnitudes an
 * observer already thinks in.
 *
 * The fallbacks below it remain, and so does the honest empty state: a
 * location the model does not reach still says nobody measured it, because
 * "clean" and "unmeasured" are different claims and only one of them is safe
 * to make on no evidence.
 */
function smokeCard(snapshot: ConditionSnapshot | null): ConditionCard {
  if (!snapshot) return unknownCard("smoke", "Haze & smoke", "Not reported");

  const opticalDepth = snapshot.aerosolOpticalDepth;
  if (opticalDepth !== null && opticalDepth !== undefined) {
    const reading = AEROSOL_LABEL[readAerosol(opticalDepth)];
    const magnitudes = aerosolExtinctionMagnitudes(opticalDepth);
    return {
      id: "smoke",
      label: "Haze & smoke",
      value: reading.value,
      // Quoted as what it costs rather than as an index. "0.34" tells nobody
      // anything; "dims the sky by 0.4 mag" is the same number in the unit the
      // decision is made in.
      interpretation:
        magnitudes < 0.12
          ? "Transparent"
          : `Dims the sky by ${magnitudes.toFixed(1)} mag`,
      tone: reading.tone,
    };
  }

  const column = snapshot.smokeColumnMgM2;
  const surface = snapshot.surfacePm25;
  if (column === null && surface === null) {
    return unknownCard("smoke", "Haze & smoke", "Not reported", "No model covers here");
  }
  if (column !== null) {
    if (column >= 100) {
      return { id: "smoke", label: "Haze & smoke", value: "Heavy", interpretation: "Faint objects lost", tone: "poor" };
    }
    if (column >= 20) {
      return { id: "smoke", label: "Haze & smoke", value: "Moderate", interpretation: "Dims faint detail", tone: "fair" };
    }
    return { id: "smoke", label: "Haze & smoke", value: "Low", interpretation: "Good", tone: "good" };
  }
  const pm = surface as number;
  return {
    id: "smoke",
    label: "Haze & smoke",
    // Surface particulate is a health measure, and the label says so rather
    // than letting it stand in for sky transparency.
    value: pm >= 55 ? "Heavy at ground" : pm >= 25 ? "Moderate at ground" : "Low at ground",
    interpretation: pm >= 55 ? "Poor air to stand in" : pm >= 25 ? "Noticeable at ground" : "Good",
    tone: pm >= 55 ? "poor" : pm >= 25 ? "fair" : "good",
  };
}

/* ----------------------------------------------------------- temperature */

function temperatureCard(snapshot: ConditionSnapshot | null): ConditionCard {
  if (!snapshot || snapshot.temperatureC === null) {
    return unknownCard("temperature", "Temperature", "Not reported");
  }
  const celsius = snapshot.temperatureC;
  return {
    id: "temperature",
    label: "Temperature",
    value: formatTemperature(celsius),
    // Standing still outside for an hour is colder than the number suggests,
    // which is the difference between a weather widget and observing advice.
    interpretation:
      celsius <= -5
        ? "Dress for standing still"
        : celsius <= 4
          ? "Cold — layers"
          : celsius <= 16
            ? "Comfortable"
            : "Mild",
    tone: "good",
  };
}

/* ------------------------------------------------------------------- row */

export interface ConditionRowInput {
  atUtc: string;
  latitudeDeg: number;
  longitudeDeg: number;
  snapshots: ConditionSnapshot[];
  evidenceStatus: EnvironmentalEvidenceStatus;
  now: Date;
  /** True while the forecast request is in flight, which is not the same as failed. */
  pending: boolean;
}

export function conditionCards(input: ConditionRowInput): ConditionCard[] {
  const { atUtc, latitudeDeg, longitudeDeg, snapshots, evidenceStatus, now, pending } = input;
  const moonlight = moonlightCard(atUtc, latitudeDeg, longitudeDeg);

  if (isPastEvent(atUtc, now)) {
    // Tracker keeps no weather history, so it has nothing to say about a sky
    // that has already happened. The Moon still answers, because the Moon's
    // position on a past date is as computable as on a future one.
    return [
      unknownCard("cloud", "Cloud cover", ALREADY_PAST),
      unknownCard("smoke", "Haze & smoke", ALREADY_PAST),
      moonlight,
      unknownCard("temperature", "Temperature", ALREADY_PAST),
    ];
  }

  if (!withinForecastHorizon(atUtc, now)) {
    return [
      unknownCard("cloud", "Cloud cover", BEYOND_HORIZON),
      unknownCard("smoke", "Haze & smoke", BEYOND_HORIZON),
      moonlight,
      unknownCard("temperature", "Temperature", BEYOND_HORIZON),
    ];
  }

  if (pending) {
    return [
      unknownCard("cloud", "Cloud cover", "Checking…"),
      unknownCard("smoke", "Haze & smoke", "Checking…"),
      moonlight,
      unknownCard("temperature", "Temperature", "Checking…"),
    ];
  }

  if (evidenceStatus === "not-supported" || evidenceStatus === "request-failed") {
    const message =
      evidenceStatus === "not-supported" ? "No provider covers here" : "Forecast unavailable";
    return [
      unknownCard("cloud", "Cloud cover", message),
      unknownCard("smoke", "Haze & smoke", message),
      moonlight,
      unknownCard("temperature", "Temperature", message),
    ];
  }

  const snapshot = nearestSnapshot(snapshots, atUtc);
  return [cloudCard(snapshot), smokeCard(snapshot), moonlight, temperatureCard(snapshot)];
}
