import { EARTH_RADIUS_KM } from "../physics/constants";
import type {
  ExplorerHistoricalCatalogObject,
  ExplorerHistoricalOrbitState,
} from "./explorerHistoricalCatalog";

export const HISTORICAL_RECONSTRUCTION_METHOD =
  "metadata-constrained-keplerian-v1" as const;
const reconstructionCache = new WeakMap<
  ExplorerHistoricalCatalogObject,
  ExplorerHistoricalOrbitState | null
>();

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function angleFromSeed(seed: string, label: string): number {
  return (hash32(`${seed}:${label}`) / 0x1_0000_0000) * 360;
}

function validSummary(object: ExplorerHistoricalCatalogObject): boolean {
  const summary = object.orbitalSummary;
  if (!summary) return false;
  const { apogeeAltitudeKm, inclinationDeg, perigeeAltitudeKm } = summary;
  return (
    Number.isFinite(perigeeAltitudeKm) &&
    Number.isFinite(apogeeAltitudeKm) &&
    Number.isFinite(inclinationDeg) &&
    perigeeAltitudeKm > -EARTH_RADIUS_KM &&
    apogeeAltitudeKm >= perigeeAltitudeKm &&
    inclinationDeg >= 0 &&
    inclinationDeg <= 180
  );
}

/**
 * Builds a stable educational orbit from source-reported orbital constraints.
 * The three angular elements unavailable in GCAT are deliberately synthesized
 * and declared in provenance. The launch epoch anchors continuous two-body
 * propagation; no reconstructed value is represented as a historical fix.
 */
export function reconstructHistoricalOrbitState(
  object: ExplorerHistoricalCatalogObject,
): ExplorerHistoricalOrbitState | undefined {
  const cached = reconstructionCache.get(object);
  if (cached !== undefined) return cached ?? undefined;
  if (!validSummary(object) || !object.launchDate) {
    reconstructionCache.set(object, null);
    return undefined;
  }
  const summary = object.orbitalSummary!;
  const perigeeRadiusKm = EARTH_RADIUS_KM + summary.perigeeAltitudeKm;
  const apogeeRadiusKm = EARTH_RADIUS_KM + summary.apogeeAltitudeKm;
  const semiMajorAxisKm = (perigeeRadiusKm + apogeeRadiusKm) / 2;
  const eccentricity = (apogeeRadiusKm - perigeeRadiusKm) /
    (apogeeRadiusKm + perigeeRadiusKm);
  if (!(semiMajorAxisKm > EARTH_RADIUS_KM) || eccentricity < 0 || eccentricity >= 1) {
    reconstructionCache.set(object, null);
    return undefined;
  }

  const launchFamily = [
    object.launchDate.slice(0, 10),
    object.owner ?? "unknown-owner",
    summary.inclinationDeg.toFixed(2),
  ].join(":");
  const objectSeed = object.catalogNumber ?? object.id;
  const epoch = object.launchDate;

  const state: ExplorerHistoricalOrbitState = {
    id: `${object.id}:reconstructed:${HISTORICAL_RECONSTRUCTION_METHOD}`,
    objectId: object.id,
    catalogNumber: object.catalogNumber,
    epoch,
    sourceEpoch: summary.sourceEpoch,
    stateKind: "reconstructed",
    orbit: {
      altitudeKm: semiMajorAxisKm - EARTH_RADIUS_KM,
      eccentricity,
      inclinationDeg: summary.inclinationDeg,
      raanDeg: angleFromSeed(launchFamily, "plane"),
      argumentOfPeriapsisDeg: angleFromSeed(objectSeed, "apsis"),
      trueAnomalyDeg: angleFromSeed(objectSeed, "phase"),
      epoch,
    },
    reconstruction: {
      method: HISTORICAL_RECONSTRUCTION_METHOD,
      deterministicSeed: objectSeed,
      constrainedFields: ["perigeeAltitudeKm", "apogeeAltitudeKm", "inclinationDeg"],
      synthesizedFields: ["raanDeg", "argumentOfPeriapsisDeg", "trueAnomalyDeg"],
      sourceEpoch: summary.sourceEpoch,
      regime: summary.regime,
    },
    sources: object.sources.filter((source) => source.sourceId === summary.sourceId),
  };
  reconstructionCache.set(object, state);
  return state;
}
