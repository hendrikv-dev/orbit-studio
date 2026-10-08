import type { ExplorerHistoricalCatalogObject } from "./explorerHistoricalCatalog";

/**
 * How long objects actually last at a given altitude, measured from the
 * catalog's own decay dates.
 *
 * This is a survival measurement, not a drag model. Nothing here integrates an
 * atmosphere: it counts what happened to 69,620 real objects. Which means the
 * hard part is not the arithmetic, it is deciding who may be counted — three
 * confounds each distort the result badly enough to invert it.
 *
 * 1. CENSORING. Two thirds of the catalog has not decayed. Taking the mean
 *    lifetime of the objects that *have* decayed measures only the short-lived
 *    ones, and the survivors' median age is just 7 years, so the bias is large.
 *    Kaplan-Meier handles this properly: a surviving object contributes its age
 *    to the population at risk and then leaves the sample without being counted
 *    as a death.
 *
 * 2. WHEN THE ORBIT WAS RECORDED. Each object carries a single orbit epoch. If
 *    that epoch is late in life the recorded perigee is already decayed, and the
 *    object gets filed under an altitude it only reached on the way down —
 *    24.3% of decayed objects have their epoch in the last fifth of their life.
 *    Only objects whose orbit was recorded within a year of coming into
 *    existence are counted.
 *
 * 3. MANOEUVRING. This one inverts the answer. Payloads are frequently inserted
 *    low and raised to their operational altitude, so their recorded orbit is
 *    the insertion orbit and not where they lived: 11,767 payloads sit at a
 *    recorded 200-300 km with 89% still in orbit a year later, which drag does
 *    not permit. Measured on payloads, the 200-300 km band appears to outlast
 *    the 300-400 km band. The default population is therefore objects that
 *    cannot maneuver — debris, rocket bodies and components.
 *
 * The payload population is still exposed, because the contrast between the two
 * is the clearest evidence that the control is necessary.
 */

/** An object's own clock starts when it came into existence, not when its parent launched. */
export interface LifetimeObservation {
  /** Years from existence to decay, or to the snapshot if still in orbit. */
  years: number;
  /** False where the object is still in orbit: the observation is censored. */
  decayed: boolean;
}

export interface SurvivalPoint {
  years: number;
  /** Kaplan-Meier estimate of the fraction still in orbit. */
  survival: number;
  atRisk: number;
}

export interface LifetimeBand {
  id: string;
  label: string;
  lowKm: number;
  highKm: number;
  observed: number;
  decayed: number;
  censored: number;
  curve: SurvivalPoint[];
  /**
   * Years at which half have decayed, or null where the curve never reaches
   * half within the observed record. Null means "longer than we have watched",
   * which is a different statement from a large number.
   */
  medianYears: number | null;
}

export type LifetimePopulation = "non-maneuvering" | "payload";

export const LIFETIME_BANDS: readonly { lowKm: number; highKm: number }[] = [
  { lowKm: 200, highKm: 300 },
  { lowKm: 300, highKm: 400 },
  { lowKm: 400, highKm: 500 },
  { lowKm: 500, highKm: 600 },
  { lowKm: 600, highKm: 800 },
  { lowKm: 800, highKm: 1000 },
  { lowKm: 1000, highKm: 1400 },
];

/** Eccentric orbits spend little time at perigee, so perigee alone would not
 *  describe their drag. Only near-circular orbits are counted. */
const MAX_APSIS_SPREAD_KM = 200;
/** How stale an orbit record may be relative to the object's start. */
const MAX_EPOCH_LAG_YEARS = 1;

function yearOf(value: string | undefined): number | null {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function maneuvers(object: ExplorerHistoricalCatalogObject): boolean {
  return object.sourceObjectClass === "payload";
}

/**
 * Turn one catalog object into a survival observation, or reject it.
 *
 * Exported because the exclusions are the substance of this analysis: a reader
 * who wants to know why an object is missing should be able to ask.
 */
export function lifetimeObservationFor(
  object: ExplorerHistoricalCatalogObject,
  snapshotYear: number,
  population: LifetimePopulation,
): { observation: LifetimeObservation; perigeeKm: number } | null {
  const wantsManeuvering = population === "payload";
  if (maneuvers(object) !== wantsManeuvering) return null;

  const orbit = object.orbitalSummary;
  if (!orbit) return null;
  if (orbit.apogeeAltitudeKm - orbit.perigeeAltitudeKm > MAX_APSIS_SPREAD_KM) return null;

  const start = yearOf(object.existenceStartDate);
  const epoch = yearOf(orbit.sourceEpoch);
  if (start === null || epoch === null) return null;
  if (epoch - start > MAX_EPOCH_LAG_YEARS) return null;

  const decay = yearOf(object.decayDate);
  if (decay !== null && decay >= start) {
    return { observation: { years: decay - start, decayed: true }, perigeeKm: orbit.perigeeAltitudeKm };
  }
  if (decay !== null) return null; // decay recorded before existence: unusable
  return {
    observation: { years: Math.max(0, snapshotYear - start), decayed: false },
    perigeeKm: orbit.perigeeAltitudeKm,
  };
}

/** Kaplan-Meier estimator over whole-year observations. */
export function survivalCurve(observations: readonly LifetimeObservation[]): SurvivalPoint[] {
  if (observations.length === 0) return [];
  const byYear = new Map<number, { deaths: number; censored: number }>();
  for (const item of observations) {
    const bucket = byYear.get(item.years) ?? { deaths: 0, censored: 0 };
    if (item.decayed) bucket.deaths += 1;
    else bucket.censored += 1;
    byYear.set(item.years, bucket);
  }

  let atRisk = observations.length;
  let survival = 1;
  const curve: SurvivalPoint[] = [{ years: 0, survival: 1, atRisk }];
  for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
    const { deaths, censored } = byYear.get(year)!;
    if (atRisk > 0 && deaths > 0) survival *= 1 - deaths / atRisk;
    curve.push({ years: year, survival, atRisk });
    atRisk -= deaths + censored;
  }
  return curve;
}

/** Fraction still in orbit at a given age, read off the step function. */
export function survivalAt(curve: readonly SurvivalPoint[], years: number): number {
  let value = 1;
  for (const point of curve) {
    if (point.years <= years) value = point.survival;
    else break;
  }
  return value;
}

function medianOf(curve: readonly SurvivalPoint[]): number | null {
  const crossing = curve.find((point) => point.survival <= 0.5);
  return crossing ? crossing.years : null;
}

export function explorerLifetimeBands(
  objects: readonly ExplorerHistoricalCatalogObject[],
  snapshotYear: number,
  population: LifetimePopulation = "non-maneuvering",
): LifetimeBand[] {
  const buckets = LIFETIME_BANDS.map(() => [] as LifetimeObservation[]);

  for (const object of objects) {
    const measured = lifetimeObservationFor(object, snapshotYear, population);
    if (!measured) continue;
    const index = LIFETIME_BANDS.findIndex(
      (band) => measured.perigeeKm >= band.lowKm && measured.perigeeKm < band.highKm,
    );
    if (index >= 0) buckets[index].push(measured.observation);
  }

  return LIFETIME_BANDS.map((band, index) => {
    const observations = buckets[index];
    const curve = survivalCurve(observations);
    return {
      id: `${band.lowKm}-${band.highKm}`,
      label: `${band.lowKm.toLocaleString()}–${band.highKm.toLocaleString()} km`,
      lowKm: band.lowKm,
      highKm: band.highKm,
      observed: observations.length,
      decayed: observations.filter((item) => item.decayed).length,
      censored: observations.filter((item) => !item.decayed).length,
      curve,
      medianYears: medianOf(curve),
    };
  });
}
