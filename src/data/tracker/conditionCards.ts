import { Body, Equator, Horizon, MakeTime, Observer } from "astronomy-engine";
import {
  nearestSnapshot,
  readCondition,
  type ConditionSnapshot,
  type EnvironmentalEvidenceStatus,
} from "./conditions";
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

export function withinForecastHorizon(atUtc: string, now: Date): boolean {
  const daysAhead = (Date.parse(atUtc) - now.getTime()) / 86_400_000;
  return daysAhead <= FORECAST_HORIZON_DAYS;
}

const BEYOND_HORIZON = "Forecast closer to date";

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

/**
 * Smoke, reported only where a provider actually measures it.
 *
 * Neither shipping adapter carries a smoke layer, so this card is usually an
 * honest "Not reported". That is deliberately not the same statement as "no
 * smoke": a clear-but-smoky sky is the exact case the condition vocabulary
 * exists to express, and filling the card with a zero would assert the sky is
 * transparent on the strength of nobody having looked.
 */
function smokeCard(snapshot: ConditionSnapshot | null): ConditionCard {
  if (!snapshot) return unknownCard("smoke", "Smoke", "Not reported");
  const column = snapshot.smokeColumnMgM2;
  const surface = snapshot.surfacePm25;
  if (column === null && surface === null) {
    return unknownCard("smoke", "Smoke", "Not reported", "No provider measures it");
  }
  if (column !== null) {
    if (column >= 100) {
      return { id: "smoke", label: "Smoke", value: "Heavy", interpretation: "Faint objects lost", tone: "poor" };
    }
    if (column >= 20) {
      return { id: "smoke", label: "Smoke", value: "Moderate", interpretation: "Dims faint detail", tone: "fair" };
    }
    return { id: "smoke", label: "Smoke", value: "Low", interpretation: "Good", tone: "good" };
  }
  const pm = surface as number;
  return {
    id: "smoke",
    label: "Smoke",
    value: pm >= 55 ? "Heavy" : pm >= 25 ? "Moderate" : "Low",
    interpretation: pm >= 55 ? "Faint objects lost" : pm >= 25 ? "Dims faint detail" : "Good",
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

  if (!withinForecastHorizon(atUtc, now)) {
    return [
      unknownCard("cloud", "Cloud cover", BEYOND_HORIZON),
      unknownCard("smoke", "Smoke", BEYOND_HORIZON),
      moonlight,
      unknownCard("temperature", "Temperature", BEYOND_HORIZON),
    ];
  }

  if (pending) {
    return [
      unknownCard("cloud", "Cloud cover", "Checking…"),
      unknownCard("smoke", "Smoke", "Checking…"),
      moonlight,
      unknownCard("temperature", "Temperature", "Checking…"),
    ];
  }

  if (evidenceStatus === "not-supported" || evidenceStatus === "request-failed") {
    const message =
      evidenceStatus === "not-supported" ? "No provider covers here" : "Forecast unavailable";
    return [
      unknownCard("cloud", "Cloud cover", message),
      unknownCard("smoke", "Smoke", message),
      moonlight,
      unknownCard("temperature", "Temperature", message),
    ];
  }

  const snapshot = nearestSnapshot(snapshots, atUtc);
  return [cloudCard(snapshot), smokeCard(snapshot), moonlight, temperatureCard(snapshot)];
}
