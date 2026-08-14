import type {
  ExplorerHistoricalCatalogObject,
} from "./explorerHistoricalCatalog";

/**
 * Fragmentation events reconstructed from GCAT parentage.
 *
 * Every debris row in GCAT carries a Parent and a separation date, and 99.4% of
 * parents resolve to another catalog object. That makes the fragmentation
 * history genuinely sourced rather than inferred — unusually, this view needs
 * no reconstruction at all.
 *
 * What the source does NOT record is *why* an object fragmented. GCAT has no
 * collision, ASAT or anomaly field. Two parents sharing a separation timestamp
 * is a fact; concluding they collided is not, and the naive test for it fails
 * badly in both directions — payload-and-its-own-rocket-stage separations share
 * a timestamp and overlapping altitudes without colliding, while Iridium 33 and
 * Kosmos-2251, which did collide, have source-epoch altitude ranges that do not
 * overlap at all because neither is the altitude they met at.
 *
 * So an event here is exactly one parent breaking up at one recorded time.
 * Events sharing a timestamp are surfaced as coincident, which is a statement
 * about the record rather than about causation.
 */

export type SeparationDatePrecision = "second" | "minute" | "day" | "month" | "year";

export interface FragmentSpread {
  minKm: number;
  medianKm: number;
  maxKm: number;
}

export interface FragmentationEvent {
  /** Stable across rebuilds: one parent, one recorded separation time. */
  id: string;
  parentRecordId: string;
  parentName: string;
  parentObjectClass: ExplorerHistoricalCatalogObject["sourceObjectClass"];
  parentOrbit?: { perigeeKm: number; apogeeKm: number; inclinationDeg: number };
  dateIso: string;
  datePrecision: SeparationDatePrecision;
  /** GCAT flags the recorded date itself as uncertain. */
  dateUncertain: boolean;
  fragmentCount: number;
  /** Fragments with no decay date in the source: still in orbit at the snapshot. */
  inOrbitCount: number;
  decayedCount: number;
  /**
   * Where the fragments went. A break-up does not leave a shell at the parent's
   * altitude — it throws material both up and down, and the pieces pushed to a
   * lower perigee are the ones that come back first. This spread is the whole
   * mechanism of debris decay, so it is computed rather than summarised away.
   */
  fragmentPerigeeKm?: FragmentSpread;
  fragmentApogeeKm?: FragmentSpread;
}

function spread(values: number[]): FragmentSpread | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return {
    minKm: sorted[0],
    medianKm:
      sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[Math.floor(middle)],
    maxKm: sorted[sorted.length - 1],
  };
}

/**
 * Group every object that names a parent into events, keyed by parent and
 * separation time. Objects without resolvable parentage are skipped rather than
 * bucketed into an "unknown" event, which would invent a fragmentation that the
 * source does not describe.
 */
export function explorerFragmentationEvents(
  objects: readonly ExplorerHistoricalCatalogObject[],
  options: { objectClass?: ExplorerHistoricalCatalogObject["sourceObjectClass"] } = {},
): FragmentationEvent[] {
  const wanted = options.objectClass ?? "debris";
  const byId = new Map(objects.map((object) => [recordIdOf(object), object]));
  const groups = new Map<string, ExplorerHistoricalCatalogObject[]>();

  for (const object of objects) {
    if (object.sourceObjectClass !== wanted) continue;
    const link = object.fragmentation;
    if (!link) continue;
    // The link carries its own date. `existenceStartDate` falls back to
    // the launch date when a separation date is missing, which would
    // silently merge unrelated fragments into a launch-dated event.
    const key = `${link.parentRecordId} ${link.separationDateIso}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(object);
    else groups.set(key, [object]);
  }

  const events: FragmentationEvent[] = [];
  for (const [key, fragments] of groups) {
    const [parentRecordId, dateIso] = key.split(" ");
    const parent = byId.get(parentRecordId);
    if (!parent) continue;
    const first = fragments[0].fragmentation!;
    const perigees: number[] = [];
    const apogees: number[] = [];
    let inOrbit = 0;
    for (const fragment of fragments) {
      if (!fragment.decayDate) inOrbit += 1;
      const orbit = fragment.orbitalSummary;
      if (orbit) perigees.push(orbit.perigeeAltitudeKm);
      if (orbit) apogees.push(orbit.apogeeAltitudeKm);
    }
    const parentOrbit = parent.orbitalSummary;

    events.push({
      id: `${parentRecordId}@${dateIso}`,
      parentRecordId,
      parentName: parent.name,
      parentObjectClass: parent.sourceObjectClass,
      parentOrbit:
        parentOrbit
          ? {
              perigeeKm: parentOrbit.perigeeAltitudeKm,
              apogeeKm: parentOrbit.apogeeAltitudeKm,
              inclinationDeg: parentOrbit.inclinationDeg,
            }
          : undefined,
      dateIso,
      datePrecision: first.separationDatePrecision,
      dateUncertain: first.separationDateUncertain,
      fragmentCount: fragments.length,
      inOrbitCount: inOrbit,
      decayedCount: fragments.length - inOrbit,
      fragmentPerigeeKm: spread(perigees),
      fragmentApogeeKm: spread(apogees),
    });
  }

  events.sort((a, b) => b.fragmentCount - a.fragmentCount || a.id.localeCompare(b.id));
  return events;
}

/** GCAT record id for an object, which is what parentage points at. */
export function recordIdOf(object: ExplorerHistoricalCatalogObject): string {
  const alias = object.aliases?.find((item) => item.kind === "source-record");
  return alias?.value ?? object.id;
}

/**
 * Events recorded at the same instant. This is a property of the catalog, not
 * evidence of a shared cause: a launch that deploys several payloads produces
 * coincident separations, and so does a collision. Presenting them together is
 * useful; labelling them a collision would be an invention.
 */
export function coincidentFragmentationEvents(
  events: readonly FragmentationEvent[],
): FragmentationEvent[][] {
  const byDate = new Map<string, FragmentationEvent[]>();
  for (const event of events) {
    // Only exact times can be meaningfully coincident; a shared bare year is not
    // a coincidence worth reporting.
    if (event.datePrecision !== "minute" && event.datePrecision !== "second") continue;
    const bucket = byDate.get(event.dateIso);
    if (bucket) bucket.push(event);
    else byDate.set(event.dateIso, [event]);
  }
  return [...byDate.values()]
    .filter((group) => group.length > 1)
    .sort(
      (a, b) =>
        b.reduce((sum, event) => sum + event.fragmentCount, 0) -
        a.reduce((sum, event) => sum + event.fragmentCount, 0),
    );
}

/**
 * The fraction of an event's fragments still in orbit, sampled by year.
 *
 * Built from decay dates alone, so it is a record of what happened rather than
 * a decay model. It ends at the catalog snapshot: the remaining fragments have
 * not decayed *yet*, which is not the same as never.
 */
export function fragmentSurvivalByYear(
  objects: readonly ExplorerHistoricalCatalogObject[],
  event: FragmentationEvent,
  snapshotYear: number,
): { year: number; remaining: number; fraction: number }[] {
  const fragments = objects.filter(
    (object) =>
      object.fragmentation?.parentRecordId === event.parentRecordId &&
      object.fragmentation.separationDateIso === event.dateIso,
  );
  if (fragments.length === 0) return [];
  const startYear = Number(event.dateIso.slice(0, 4));
  if (!Number.isFinite(startYear)) return [];

  const decayYears = fragments
    .map((fragment) => (fragment.decayDate ? Number(fragment.decayDate.slice(0, 4)) : null))
    .filter((year): year is number => year !== null && Number.isFinite(year));

  const series: { year: number; remaining: number; fraction: number }[] = [];
  for (let year = startYear; year <= snapshotYear; year += 1) {
    const gone = decayYears.filter((decayYear) => decayYear <= year).length;
    const remaining = fragments.length - gone;
    series.push({ year, remaining, fraction: remaining / fragments.length });
  }
  return series;
}
