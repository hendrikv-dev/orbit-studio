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

export type ConditionCardId =
  /** Always shown: these three bear on every night. */
  | "cloud"
  | "moonlight"
  | "temperature"
  /**
   * Shown only when they would change what somebody does.
   *
   * A row of fixed slots has to fill them, and a slot that must be filled
   * eventually says "No smoke" on a night with no smoke — which spends a
   * quarter of the row telling the reader nothing, every night, so that it can
   * tell them something on the rare night it matters. These appear when they
   * are material and are absent otherwise.
   */
  | "smoke"
  | "haze"
  | "precipitation"
  | "fog"
  | "dew";
export type ConditionTone = "good" | "fair" | "poor" | "unknown";

/**
 * Where the reading came from and how long it is good for.
 *
 * Carried per card because the row mixes horizons: moonlight is an
 * astronomical computation good for a century, cloud is a point forecast good
 * for days, and aerosol is a model run good for hours. Presenting them as one
 * undifferentiated row of "conditions" is what lets a reader take the weakest
 * of them as seriously as the strongest.
 */
export interface ConditionProvenance {
  kind: "computed" | "forecast" | "model";
  detail: string;
}

export interface ConditionCard {
  id: ConditionCardId;
  label: string;
  /** The number or state. Never invented. */
  value: string;
  /** What it means for observing, in two or three words. Null where unknown. */
  interpretation: string | null;
  tone: ConditionTone;
  /** What kind of claim this is, available on inspection. */
  provenance?: ConditionProvenance;
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
/**
 * Where each conditional card starts earning its place.
 *
 * Set so that a card appears when it would change a decision, not when a
 * sensor twitches. The haze figure is in magnitudes of extinction because that
 * is the unit the decision is actually made in: 0.15 mag is about the point
 * where a practised eye notices the difference on faint objects.
 */
const SMOKE_MATERIAL_MG_M2 = 20;
const HAZE_MATERIAL_MAGNITUDES = 0.15;
const FOG_VISIBILITY_M = 2_000;
const DEW_HUMIDITY_PERCENT = 92;
const PM25_MATERIAL_UG_M3 = 35;
/** Three constants plus at most this many, so the row stays scannable. */
const MAX_CONDITIONAL_CARDS = 2;

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
/**
 * Smoke and haze, kept apart because the models keep them apart.
 *
 * Aerosol optical depth measures *all* aerosol — dust, sea salt, industrial
 * pollution, smoke — and cannot say which. The smoke column comes from a model
 * that is specifically about smoke. Labelling a hazy summer evening "Smoky"
 * because the optical depth was high is the sort of small confident wrongness
 * that costs a product its credibility with exactly the readers who would
 * notice, so a card only says smoke when the smoke model says smoke.
 *
 * Returns null when there is nothing worth a slot. That is the point: on most
 * nights in most places the honest answer is silence, and silence should not
 * occupy a quarter of the row.
 */
function obstructionCard(snapshot: ConditionSnapshot | null): ConditionCard | null {
  if (!snapshot) return null;

  const column = snapshot.smokeColumnMgM2;
  // Smoke first, where a smoke model actually covers this place and reports
  // enough of it to matter.
  if (column !== null && column !== undefined && column >= SMOKE_MATERIAL_MG_M2) {
    const heavy = column >= 100;
    const magnitudes =
      snapshot.aerosolOpticalDepth !== null && snapshot.aerosolOpticalDepth !== undefined
        ? aerosolExtinctionMagnitudes(snapshot.aerosolOpticalDepth)
        : null;
    return {
      id: "smoke",
      label: "Wildfire smoke",
      value: heavy ? "Heavy" : "Moderate",
      interpretation:
        magnitudes !== null
          ? `Dims the sky by ${magnitudes.toFixed(1)} mag`
          : heavy
            ? "Faint objects lost"
            : "Dims faint detail",
      tone: heavy ? "poor" : "fair",
      provenance: {
        kind: "model",
        detail:
          "Smoke column from the weather provider's smoke model, with the dimming computed from aerosol optical depth at 550 nm.",
      },
    };
  }

  // Otherwise haze, and only when it is thick enough to change the night.
  const opticalDepth = snapshot.aerosolOpticalDepth;
  if (opticalDepth === null || opticalDepth === undefined) {
    // No aerosol model covers everywhere. Surface particulate is the fallback
    // and is a *health* measure, not a sky one — it says what the air at ground
    // level is like to stand in and nothing about transparency overhead. It is
    // labelled that way, and only appears when it is bad enough to matter.
    const surface = snapshot.surfacePm25;
    if (surface === null || surface === undefined || surface < PM25_MATERIAL_UG_M3) return null;
    const heavy = surface >= 55;
    return {
      id: "smoke",
      label: "Air quality",
      value: heavy ? "Heavy at ground" : "Moderate at ground",
      interpretation: heavy ? "Poor air to stand in" : "Noticeable at ground",
      tone: heavy ? "poor" : "fair",
      provenance: {
        kind: "model",
        detail:
          "Surface PM2.5 from Copernicus via Open-Meteo. A ground-level health measure; it does not describe how transparent the sky is.",
      },
    };
  }
  const magnitudes = aerosolExtinctionMagnitudes(opticalDepth);
  if (magnitudes < HAZE_MATERIAL_MAGNITUDES) return null;

  const reading = readAerosol(opticalDepth);
  return {
    id: "haze",
    label: "Haze",
    // Never "smoky": this figure cannot tell smoke from dust or pollution.
    value: reading === "heavy" || reading === "smoky" ? "Thick" : "Noticeable",
    interpretation: `Dims the sky by ${magnitudes.toFixed(1)} mag`,
    tone: reading === "heavy" || reading === "smoky" ? "poor" : "fair",
    provenance: {
      kind: "model",
      detail:
        "Aerosol optical depth at 550 nm from Copernicus via Open-Meteo. Measures all aerosol together and cannot identify smoke.",
    },
  };
}

/** Rain or snow, which settles the question before anything else does. */
function precipitationCard(snapshot: ConditionSnapshot | null): ConditionCard | null {
  if (!snapshot || snapshot.precipitating !== true) return null;
  return {
    id: "precipitation",
    label: "Precipitation",
    value: "Falling",
    interpretation: "Not an observing night",
    tone: "poor",
    provenance: { kind: "forecast", detail: "Point forecast from the weather provider." },
  };
}

/** Fog, which cloud cover does not describe: it can be clear overhead. */
function fogCard(snapshot: ConditionSnapshot | null): ConditionCard | null {
  if (!snapshot) return null;
  const visibility = snapshot.visibilityM;
  if (visibility === null || visibility === undefined || visibility >= FOG_VISIBILITY_M) return null;
  return {
    id: "fog",
    label: "Fog",
    value: visibility < 400 ? "Thick" : "Patchy",
    interpretation: `Visibility ${(visibility / 1000).toFixed(1)} km`,
    tone: visibility < 400 ? "poor" : "fair",
    provenance: { kind: "forecast", detail: "Horizontal visibility from the weather provider." },
  };
}

/**
 * Dew, which is about equipment rather than sky.
 *
 * Shown high because it is actionable — a dew shield or a hair dryer is the
 * whole fix — and because nothing else in the row hints at it.
 */
function dewCard(snapshot: ConditionSnapshot | null): ConditionCard | null {
  if (!snapshot) return null;
  const humidity = snapshot.relativeHumidityPercent;
  if (humidity === null || humidity === undefined || humidity < DEW_HUMIDITY_PERCENT) return null;
  return {
    id: "dew",
    label: "Dew",
    value: `${Math.round(humidity)}% humidity`,
    interpretation: "Optics will fog without a shield",
    tone: "fair",
    provenance: { kind: "forecast", detail: "Relative humidity from the weather provider." },
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

  /**
   * The three that are always here.
   *
   * Cloud decides whether there is a sky, the Moon decides what can be seen in
   * it, and temperature decides how long anybody lasts outside. None of those
   * is ever irrelevant, so none is ever omitted — including when the answer is
   * that nothing is known, which is itself worth a slot.
   */
  const constants = (state: string): ConditionCard[] => [
    unknownCard("cloud", "Cloud cover", state),
    moonlight,
    unknownCard("temperature", "Temperature", state),
  ];

  // Tracker keeps no weather history, so it has nothing to say about a sky that
  // has already happened. The Moon still answers, because the Moon's position
  // on a past date is as computable as on a future one.
  if (isPastEvent(atUtc, now)) return constants(ALREADY_PAST);
  if (!withinForecastHorizon(atUtc, now)) return constants(BEYOND_HORIZON);
  if (pending) return constants("Checking…");
  if (evidenceStatus === "not-supported" || evidenceStatus === "request-failed") {
    return constants(
      evidenceStatus === "not-supported" ? "No provider covers here" : "Forecast unavailable",
    );
  }

  const snapshot = nearestSnapshot(snapshots, atUtc);

  /**
   * The conditional cards, in the order they would change a decision.
   *
   * Precipitation first because it ends the question; then whatever is dimming
   * the sky; then fog, which cloud cover does not describe; then dew, which is
   * about the equipment rather than the sky. Each returns null when it has
   * nothing to say, and a night with nothing to add simply gets three wider
   * cards.
   */
  const conditional = [
    precipitationCard(snapshot),
    obstructionCard(snapshot),
    fogCard(snapshot),
    dewCard(snapshot),
  ].filter((card): card is ConditionCard => card !== null);

  return [
    cloudCard(snapshot),
    moonlight,
    temperatureCard(snapshot),
    // Capped so the row stays scannable. On the rare night that trips four of
    // them, the two that matter most are the two that are shown.
    ...conditional.slice(0, MAX_CONDITIONAL_CARDS),
  ];
}
