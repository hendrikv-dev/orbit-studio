import type {
  ExplorerHistoricalCatalogDataset,
  ExplorerHistoricalCatalogObject,
  ExplorerHistoricalOrbitState,
  ExplorerHistoricalSourceAttribution,
} from "./explorerHistoricalCatalog";
import { reconstructHistoricalOrbitState } from "./historicalOrbitReconstruction";

export type HistoricalOrbitAvailability =
  | "exact-historical-orbit"
  | "nearest-historical-orbit"
  | "reconstructed-historical-orbit"
  | "catalog-only"
  | "unavailable";

export interface HistoricalCatalogIndexedObject extends ExplorerHistoricalCatalogObject {
  reentryDate?: string;
  existenceStartDate?: string;
}

export interface HistoricalCatalogWorldObject {
  object: HistoricalCatalogIndexedObject;
  orbitState?: ExplorerHistoricalOrbitState;
  orbitAvailability: HistoricalOrbitAvailability;
}

export interface HistoricalCatalogWorld {
  selectedDateIso: string;
  objects: HistoricalCatalogWorldObject[];
  renderableObjects: HistoricalCatalogWorldObject[];
  catalogOnlyObjects: HistoricalCatalogWorldObject[];
  unavailableObjects: HistoricalCatalogWorldObject[];
  byObjectId: ReadonlyMap<string, HistoricalCatalogWorldObject>;
  catalogObjectCount: number;
  renderableOrbitStateCount: number;
  exactOrbitStateCount: number;
  reconstructedOrbitStateCount: number;
  sourceLabels: string[];
}

export interface HistoricalCatalogIndex {
  loaded: boolean;
  objects: HistoricalCatalogIndexedObject[];
  orbitStatesByIdentity: ReadonlyMap<string, ExplorerHistoricalOrbitState[]>;
}

function dateMs(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDay(value?: string): string | undefined {
  const parsed = dateMs(value);
  return parsed === null ? undefined : new Date(parsed).toISOString().slice(0, 10);
}

function isDateOnlyIso(value?: string): boolean {
  return Boolean(value?.endsWith("T00:00:00.000Z"));
}

function startsAfterSelectedDate(startIso: string | undefined, selectedIso: string): boolean {
  const selectedMs = dateMs(selectedIso);
  const startMs = dateMs(startIso);
  if (selectedMs === null || startMs === null) return true;
  if (isDateOnlyIso(startIso)) return utcDay(startIso)! > utcDay(selectedIso)!;
  return startMs > selectedMs;
}

function endedBeforeSelectedDate(endIso: string | undefined, selectedIso: string): boolean {
  const selectedMs = dateMs(selectedIso);
  const endMs = dateMs(endIso);
  if (selectedMs === null || endMs === null) return false;
  if (isDateOnlyIso(endIso)) return utcDay(endIso)! < utcDay(selectedIso)!;
  return endMs < selectedMs;
}

function identityKeysForObject(object: HistoricalCatalogIndexedObject): string[] {
  const directKeys = [
    object.id ? `id:${object.id}` : "",
    object.canonicalId ? `id:${object.canonicalId}` : "",
    object.catalogNumber ? `cat:${object.catalogNumber}` : "",
    object.internationalDesignator ? `intl:${object.internationalDesignator}` : "",
  ].filter(Boolean);

  const aliasKeys = (object.aliases ?? []).flatMap((alias) => {
    if (alias.kind === "norad") return [`cat:${alias.value}`, `norad:${alias.value}`];
    if (alias.kind === "international-designator" || alias.kind === "cospar") {
      return [`intl:${alias.value}`, `${alias.kind}:${alias.value}`];
    }
    return [`${alias.kind}:${alias.value}`];
  });

  return [...new Set([...directKeys, ...aliasKeys])];
}

function identityKeysForOrbitState(state: ExplorerHistoricalOrbitState): string[] {
  return [
    state.objectId ? `id:${state.objectId}` : "",
    state.catalogNumber ? `cat:${state.catalogNumber}` : "",
  ].filter(Boolean);
}

function sourceLabel(source: ExplorerHistoricalSourceAttribution): string {
  const family =
    source.sourceFamily === "space-track"
      ? "Space-Track"
      : source.sourceFamily === "celestrak"
        ? "CelesTrak"
        : source.sourceFamily === "gcat"
          ? "GCAT"
          : "Historical catalog";

  return `${family}: ${source.sourceFile}`;
}

export function historicalObjectExistsOnDate(
  object: HistoricalCatalogIndexedObject,
  dateIso: string,
): boolean {
  if (object.periodEndPresence) {
    const selectedMs = dateMs(dateIso);
    if (selectedMs === null) return false;
    const selectedYear = new Date(selectedMs).getUTCFullYear();
    return (
      selectedYear >= object.periodEndPresence.firstYear &&
      selectedYear <= object.periodEndPresence.lastYear
    );
  }

  const selectedMs = dateMs(dateIso);
  const lifecycleStart = object.existenceStartDate ?? object.launchDate;
  if (selectedMs === null || startsAfterSelectedDate(lifecycleStart, dateIso)) return false;

  const endCandidates = [object.decayDate, object.reentryDate].filter(Boolean) as string[];
  if (endCandidates.length === 0) return true;

  return !endCandidates.some((endIso) => endedBeforeSelectedDate(endIso, dateIso));
}

function sameUtcDate(leftIso: string, rightIso: string): boolean {
  const left = new Date(leftIso);
  const right = new Date(rightIso);

  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function isRenderableOrbitState(state: ExplorerHistoricalOrbitState | undefined): boolean {
  return Boolean(state?.orbit);
}

function orbitStateForDate(
  orbitStates: readonly ExplorerHistoricalOrbitState[],
  selectedDateIso: string,
): ExplorerHistoricalOrbitState | undefined {
  const selectedMs = dateMs(selectedDateIso);
  if (selectedMs === null) return undefined;

  let nearest: ExplorerHistoricalOrbitState | undefined;
  let nearestMs = Number.NEGATIVE_INFINITY;

  for (const state of orbitStates) {
    const epochMs = dateMs(state.epoch);
    if (epochMs === null || epochMs > selectedMs || epochMs < nearestMs) continue;
    nearest = state;
    nearestMs = epochMs;
  }

  return nearest;
}

export function createHistoricalCatalogIndex(
  dataset: ExplorerHistoricalCatalogDataset,
): HistoricalCatalogIndex {
  const orbitStatesByIdentity = new Map<string, ExplorerHistoricalOrbitState[]>();

  for (const state of dataset.orbitStates) {
    for (const key of identityKeysForOrbitState(state)) {
      orbitStatesByIdentity.set(key, [...(orbitStatesByIdentity.get(key) ?? []), state]);
    }
  }

  for (const [key, states] of orbitStatesByIdentity) {
    orbitStatesByIdentity.set(
      key,
      [...states].sort((left, right) => Date.parse(left.epoch) - Date.parse(right.epoch)),
    );
  }

  return {
    loaded: dataset.objects.length > 0 || dataset.orbitStates.length > 0,
    objects: dataset.objects,
    orbitStatesByIdentity,
  };
}

export function queryHistoricalCatalog(
  index: HistoricalCatalogIndex,
  selectedDateIso: string,
): HistoricalCatalogWorld {
  const objects: HistoricalCatalogWorldObject[] = [];
  const labels = new Set<string>();

  if (!index.loaded) {
    return {
      selectedDateIso,
      objects: [],
      renderableObjects: [],
      catalogOnlyObjects: [],
      unavailableObjects: [],
      byObjectId: new Map(),
      catalogObjectCount: 0,
      renderableOrbitStateCount: 0,
      exactOrbitStateCount: 0,
      reconstructedOrbitStateCount: 0,
      sourceLabels: [],
    };
  }

  for (const object of index.objects) {
    if (!historicalObjectExistsOnDate(object, selectedDateIso)) continue;

    object.sources.forEach((source) => labels.add(sourceLabel(source)));

    const objectOrbitStates = identityKeysForObject(object).flatMap(
      (key) => index.orbitStatesByIdentity.get(key) ?? [],
    );
    const uniqueOrbitStates = [
      ...new Map(objectOrbitStates.map((state) => [state.id, state])).values(),
    ];
    const sourceOrbitState = orbitStateForDate(uniqueOrbitStates, selectedDateIso);
    let orbitState: ExplorerHistoricalOrbitState | undefined;
    if (sourceOrbitState?.orbit) {
      orbitState = {
        ...sourceOrbitState,
        stateKind: sourceOrbitState.stateKind ?? "source",
      };
    } else {
      orbitState = reconstructHistoricalOrbitState(object, selectedDateIso);
    }
    orbitState?.sources.forEach((source) => labels.add(sourceLabel(source)));

    const orbitAvailability: HistoricalOrbitAvailability =
      orbitState?.stateKind === "reconstructed"
        ? "reconstructed-historical-orbit"
        : isRenderableOrbitState(orbitState)
          ? sameUtcDate(orbitState!.epoch, selectedDateIso)
            ? "exact-historical-orbit"
            : "nearest-historical-orbit"
          : "catalog-only";

    objects.push({ object, orbitState, orbitAvailability });
  }

  const renderableObjects = objects.filter((item) => isRenderableOrbitState(item.orbitState));
  const catalogOnlyObjects = objects.filter((item) => item.orbitAvailability === "catalog-only");
  const unavailableObjects = objects.filter((item) => item.orbitAvailability === "unavailable");
  const exactOrbitStateCount = renderableObjects.filter(
    (item) => item.orbitState?.stateKind !== "reconstructed",
  ).length;
  const reconstructedOrbitStateCount = renderableObjects.filter(
    (item) => item.orbitState?.stateKind === "reconstructed",
  ).length;

  return {
    selectedDateIso,
    objects,
    renderableObjects,
    catalogOnlyObjects,
    unavailableObjects,
    byObjectId: new Map(objects.map((item) => [item.object.id, item])),
    catalogObjectCount: objects.length,
    renderableOrbitStateCount: renderableObjects.length,
    exactOrbitStateCount,
    reconstructedOrbitStateCount,
    sourceLabels: [...labels].sort(),
  };
}
