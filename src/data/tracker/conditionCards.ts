import { Body, Equator, Horizon, MakeTime, Observer } from "astronomy-engine";
import {
  nearestSnapshot,
  readCondition,
  type ConditionSnapshot,
  type EnvironmentalEvidenceStatus,
} from "./conditions";
import {
  aerosolExtinctionMagnitudes,
  airQualityIndex,
  readAerosol,
  type AerosolReading,
} from "./airQuality";
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
  | "air-quality"
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
  const percent = illuminatedPercent(Number(phase.illuminatedFraction), phase.name);

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

/**
 * The lit fraction as a percentage, without contradicting the phase beside it.
 *
 * The phase name comes from the cycle angle with a tolerance either side of the
 * principal phases; the percentage comes from the illumination. Just outside
 * that tolerance the Moon is 99.6% lit and named "Waning Gibbous", and rounding
 * gave the card "Waning Gibbous · 100%" — a full Moon that is not the Full
 * Moon, in four words.
 *
 * The name is the one to keep: it is what a reader will check against the sky
 * and against every other calendar. So the percentage rounds towards the phase
 * rather than away from it, and 100 and 0 are reserved for the phases that mean
 * them.
 */
function illuminatedPercent(fraction: number, phaseName: string): number {
  const rounded = Math.round(fraction * 100);
  if (rounded >= 100 && phaseName !== "Full Moon") return 99;
  if (rounded <= 0 && phaseName !== "New Moon") return 1;
  return rounded;
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
 * Sky transparency, and nothing about health.
 *
 * ## The split this enforces
 *
 * This card used to answer two questions in one slot. Where an aerosol model
 * covered the location it reported optical depth, which is genuinely about the
 * sky; where one did not it fell back to surface PM2.5, which is a measure of
 * the air at head height and says nothing whatever about transparency
 * overhead. One label, two meanings, and the reader had no way to tell which
 * one they were being given.
 *
 * So this is now only the observing question — how much light the atmosphere is
 * taking away, in the magnitudes an observer already thinks in. The health
 * question has its own card, appears on its own terms, and is never merged into
 * this one. They can legitimately disagree: a thin smoke layer aloft ruins a
 * night under air that is fine to breathe.
 *
 * Returns null where nothing measures the sky here. That is not the same as
 * "clear", and rather than print "Not reported" on every page in a region no
 * aerosol model reaches, the slot simply is not there — the brief's instruction
 * that a missing data source should not become interface clutter.
 *
 * Smoke and haze stay distinguishable within the card. Optical depth measures
 * all aerosol together — dust, sea salt, industrial pollution, smoke — and
 * cannot say which; the smoke column comes from a model that is specifically
 * about smoke. Calling a hazy summer evening "smoky" on optical depth alone is
 * the sort of small confident wrongness that costs a product its credibility
 * with exactly the readers who would notice.
 */
function transparencyCard(snapshot: ConditionSnapshot | null): ConditionCard | null {
  if (!snapshot) return null;

  const column = snapshot.smokeColumnMgM2;
  const opticalDepth = snapshot.aerosolOpticalDepth;
  const magnitudes =
    opticalDepth !== null && opticalDepth !== undefined
      ? aerosolExtinctionMagnitudes(opticalDepth)
      : null;

  // Smoke first, where a smoke model actually covers this place and reports
  // enough of it to matter. Only this branch may use the word.
  if (column !== null && column !== undefined && column >= SMOKE_MATERIAL_MG_M2) {
    const heavy = column >= 100;
    return {
      id: "smoke",
      label: "Smoke",
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

  // Nothing measures the sky above this location. Silence, not a slot saying so.
  if (magnitudes === null) return null;

  const provenance = {
    kind: "model" as const,
    detail:
      "Aerosol optical depth at 550 nm from Copernicus via Open-Meteo. Measures all aerosol together and cannot identify smoke.",
  };

  if (magnitudes < HAZE_MATERIAL_MAGNITUDES) {
    // Measured, and there is nothing there. Worth its slot: on a night after a
    // fire this is the card a reader checks first, and it can only reassure
    // them by being in the same place on the nights it has nothing to report.
    return {
      id: "smoke",
      label: "Transparency",
      value: "Clear",
      interpretation: `Under ${HAZE_MATERIAL_MAGNITUDES.toFixed(2)} mag of dimming`,
      tone: "good",
      provenance,
    };
  }

  const reading = readAerosol(opticalDepth!);
  const thick = reading === "heavy" || reading === "smoky";
  return {
    id: "smoke",
    label: "Transparency",
    // Never "smoky": this figure cannot tell smoke from dust or pollution.
    value: thick ? "Poor" : "Reduced",
    interpretation: `Dims the sky by ${magnitudes.toFixed(1)} mag`,
    tone: thick ? "poor" : "fair",
    provenance,
  };
}

/**
 * The air as a health matter, on the nights it is one.
 *
 * Present only at or above the first published category that asks anybody to
 * change what they do outdoors. Below that there is no card, because "AQI 23 ·
 * Good" tells a reader nothing they can act on and turns an observing page into
 * an air-quality dashboard.
 *
 * The guidance is the category's own, not Tracker's. Where the air is bad
 * enough that the published statement is about avoiding time outdoors, that is
 * a statement about the activity this whole product exists to encourage, and it
 * is shown at the same weight as anything else that would stop the night.
 */
function airQualityAlertCard(snapshot: ConditionSnapshot | null): ConditionCard | null {
  const pm25 = snapshot?.surfacePm25;
  if (pm25 === null || pm25 === undefined) return null;
  const index = airQualityIndex(pm25);
  if (!index.advisory) return null;
  return {
    id: "air-quality",
    label: "Air quality",
    value: `AQI ${index.aqi} · ${index.label}`,
    interpretation: index.guidance,
    tone: index.category === "sensitive" ? "fair" : "poor",
    provenance: {
      kind: "model",
      detail:
        "US AQI computed from the hourly surface PM2.5 forecast (Copernicus via Open-Meteo) against the EPA's 24-hour breakpoints. The official index uses a NowCast average, so a brief plume reads higher here than the published figure for the area. A health measure: it does not describe how transparent the sky is.",
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

/**
 * What the row is about, so it can decide what is worth showing.
 *
 * The row used to know only a time and a place, which is why it showed
 * "Moonlight · Full Moon · 100% · Some glare" beside a *lunar eclipse* — the
 * Moon treated as interference with an event whose entire subject is the Moon.
 * A condition earns its slot by bearing on the decision for *this* event, and
 * that cannot be judged without knowing what the event is.
 */
export interface ConditionSubject {
  categoryId:
    | "meteors"
    | "moon"
    | "planets"
    | "pairings"
    | "eclipses"
    | "deep-sky"
    | "auroras";
  /**
   * True when the Moon is what the reader is looking at, rather than something
   * competing with it: the Moon itself, a lunar eclipse, or a pairing with the
   * Moon in it.
   */
  moonIsTheTarget: boolean;
  /**
   * How much the Moon's light actually costs this event.
   *
   * "high" for faint, wide-field targets — meteors, aurora, dark-sky observing
   * — where a bright Moon is the difference between seeing it and not. "low"
   * for bright point targets like planets, which a full Moon barely troubles.
   */
  moonlightSensitivity: "high" | "low";
}

export interface ConditionRowInput {
  atUtc: string;
  latitudeDeg: number;
  longitudeDeg: number;
  snapshots: ConditionSnapshot[];
  evidenceStatus: EnvironmentalEvidenceStatus;
  now: Date;
  /** True while the forecast request is in flight, which is not the same as failed. */
  pending: boolean;
  /**
   * What is being observed. Optional so existing callers keep working, but
   * without it the row falls back to showing moonlight, which is the old
   * behaviour and is wrong for Moon-target events.
   */
  subject?: ConditionSubject;
}

export function conditionCards(input: ConditionRowInput): ConditionCard[] {
  const { atUtc, latitudeDeg, longitudeDeg, snapshots, evidenceStatus, now, pending, subject } =
    input;

  /**
   * Moonlight, which is always in the row and does not always mean the same
   * thing.
   *
   * Three cases, and the card says which one it is in rather than disappearing:
   *
   *  - The Moon interferes. Meteors, aurora and faint objects lose contrast to
   *    it, so how much there is and whether it is up are decisions.
   *  - The Moon *is* the target. A lunar eclipse, the Moon's own page, a Moon
   *    pairing. Reporting its brightness as interference read "Full Moon · 100%
   *    · Some glare" on an eclipse page — the event described as its own
   *    obstacle — so the interpretation says it is the subject instead.
   *  - The Moon barely matters. A bright planet is not troubled by moonlight in
   *    any way the reader can act on, and the card says so rather than implying
   *    a problem that is not there.
   *
   * It used to be dropped in the second and third cases. That is what made the
   * row change shape between phenomena, and the phase is a fact worth a slot on
   * any night: the reader planning tomorrow is looking at exactly this number.
   */
  const moonlight = subjectMoonlight(
    moonlightCard(atUtc, latitudeDeg, longitudeDeg),
    subject,
  );

  /**
   * Three fixed, then whatever is true.
   *
   * ## Where this landed, after going round twice
   *
   * It was a fixed four, then dynamic, then fixed at four again on the argument
   * that a row whose shape changes has to be re-read every time. That argument
   * is right about the cards a reader *learns* and wrong about the fourth slot,
   * because holding a slot open forced something into it — and what got forced
   * in was "Smoke / haze · Not reported", every night, in every region no
   * aerosol model reaches.
   *
   * So the invariant is narrower and actually holds: cloud, then atmosphere,
   * then moonlight, then temperature, in that order, always. Cloud, moonlight
   * and temperature are always answerable — two are forecasts and one is
   * geometry, and none is ever irrelevant — so the row a reader learns is
   * stable at its ends. The atmospheric slot appears when something measures
   * the sky here and is absent when nothing does, and a health alert appends
   * only when the air is bad enough to carry advice.
   *
   * The row is three, four or five cards. It never has a gap in it, because the
   * grid distributes what is there rather than reserving space for what is not.
   */
  const constants = (state: string): ConditionCard[] => [
    unknownCard("cloud", "Cloud cover", state),
    moonlight ?? moonlightCard(atUtc, latitudeDeg, longitudeDeg),
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
   * Rain, fog and dew have nowhere of their own to go, so they go where they
   * belong.
   *
   * Each is a fact about one of the standing subjects rather than a subject of
   * its own: rain and fog are the sky being shut, which is what the cloud card
   * is about, and dew is what the night's air does to a lens, which is
   * temperature's department. Folding them in keeps the row short without
   * dropping anything a reader would act on — and rain in particular is the
   * single most decisive thing on the page, so it takes over the cloud card's
   * headline rather than sitting fifth in a row nobody reaches.
   *
   * The health alert goes last. It is the only card here that is not about
   * observing, and putting it at the end keeps the four a reader scans for the
   * sky together, while still giving it the row rather than a footnote.
   */
  return [
    cloudCard(snapshot),
    transparencyCard(snapshot),
    moonlight ?? moonlightCard(atUtc, latitudeDeg, longitudeDeg),
    withDew(temperatureCard(snapshot), snapshot),
    airQualityAlertCard(snapshot),
  ].filter((card): card is ConditionCard => card !== null);
}

/**
 * Dew, on the temperature card.
 *
 * Only where the humidity is high enough to matter, and only as a change to the
 * interpretation line — the temperature itself is still the number, because
 * that is what the reader came to the card for.
 */
function subjectMoonlight(
  card: ConditionCard,
  subject: ConditionRowInput["subject"],
): ConditionCard {
  if (subject === undefined) return card;
  if (subject.moonIsTheTarget) {
    return {
      ...card,
      interpretation: "The Moon is what you are looking at",
      tone: "good",
    };
  }
  if (subject.moonlightSensitivity !== "high") {
    return {
      ...card,
      // A bright planet or the Moon itself is not lost to moonlight, and
      // "washes out faint objects" beside Saturn would be a warning about a
      // problem the reader does not have.
      interpretation: card.tone === "good" ? card.interpretation : "No effect on this target",
      tone: "good",
    };
  }
  return card;
}

function withDew(card: ConditionCard, snapshot: ConditionSnapshot | null): ConditionCard {
  const humidity = snapshot?.relativeHumidityPercent;
  if (humidity === null || humidity === undefined || humidity < DEW_HUMIDITY_PERCENT) return card;
  return {
    ...card,
    interpretation: `${card.interpretation ? `${card.interpretation} · ` : ""}Dew at ${Math.round(humidity)}% humidity`,
    tone: card.tone === "good" ? "fair" : card.tone,
  };
}
