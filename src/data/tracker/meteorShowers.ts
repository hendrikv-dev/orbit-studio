import normalized from "../meteors/showers.json";

/** Offline NASA-backed twelve-shower catalogue. See docs/meteor-data.md. */
export const METEOR_SHOWER_SNAPSHOT = {
  snapshotDate: "2026-10-11",
  normalizationYear: 2026,
  sources: ["NASA CP 2011 J2000 nomenclature table", "NASA MEO 2026 forecast", "NASA meteoroid handbook", "NASA MEO forecasting methods", "NASA MEO 2021 overview"],
} as const;

export interface MeteorShower {
  code: string;
  name: string;
  /** Apparent solar longitude of date, derived from the NASA peak UTC/date. */
  peakSolarLongitudeDeg: number;
  /** Derived from NASA calendar bounds in 2026, inclusive through last day. */
  activityStartSolarLongitudeDeg: number;
  activityEndSolarLongitudeDeg: number;
  /** Published geocentric radiant, J2000.0, at the separate anchor longitude. */
  radiantRaDeg: number;
  radiantDecDeg: number;
  /** Published J2000 solar longitude belonging to radiant, NOT peak EQD longitude. */
  radiantSolarLongitudeJ2000Deg: number;
  /** NASA km/s: handbook geocentric; CAP/STA/NTA MEO at 100 km altitude. */
  speedKmS: number;
  populationIndex: number;
  /** Ground visual ZHR, not a local observer rate or spacecraft flux. */
  nominalZhr: number;
  /** First-party coarse core FWHM, NOT a NASA observation/profile fit. */
  peakWidthDays: number;
}

export const METEOR_SHOWERS: readonly MeteorShower[] = normalized.showers;
/** Existing first-party calibration, not shower source data. */
export const SPORADIC_BACKGROUND = { nominalZhr: 10, populationIndex: 3.0 } as const;
const DEGREES_PER_TURN = 360;

export function angularDifferenceDeg(a: number, b: number): number {
  let difference = (a - b) % DEGREES_PER_TURN;
  if (difference > 180) difference -= DEGREES_PER_TURN;
  if (difference < -180) difference += DEGREES_PER_TURN;
  return difference;
}

export function isShowerActiveAt(shower: MeteorShower, solarLongitudeDeg: number): boolean {
  const start = shower.activityStartSolarLongitudeDeg;
  const end = shower.activityEndSolarLongitudeDeg;
  let longitude = solarLongitudeDeg % DEGREES_PER_TURN;
  // Avoid an unnecessary +360 round-trip changing a valid endpoint by one ULP.
  if (longitude < 0) longitude += DEGREES_PER_TURN;
  if (start <= end) return longitude >= start && longitude <= end;
  return longitude >= start || longitude <= end;
}

export function meteorShowerByCode(code: string): MeteorShower | undefined {
  return METEOR_SHOWERS.find((shower) => shower.code === code);
}
