/** The only Tracker state persisted across reloads: a user-confirmed place. */
export const TRACKER_PLACE_STORAGE_KEY = "orbit-studio:tracker:confirmed-place:v1";

const SCHEMA_VERSION = 1;
const COORDINATE_DECIMALS = 4;

export interface ConfirmedPlaceRecord {
  name: string;
  context: string;
  latitude: number;
  longitude: number;
  fromDevice: boolean;
  restored?: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredPlaceV1 {
  version: 1;
  place: Omit<ConfirmedPlaceRecord, "restored">;
}

function validCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

function storageOrNull(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Persist no forecast, plan, history, or raw device accuracy. */
export function persistConfirmedPlace(place: ConfirmedPlaceRecord, storage?: StorageLike): boolean {
  const target = storageOrNull(storage);
  if (!target || !validCoordinate(place.latitude, place.longitude)) return false;
  const record: StoredPlaceV1 = {
    version: SCHEMA_VERSION,
    place: {
      name: place.name,
      context: place.context,
      latitude: Number(place.latitude.toFixed(COORDINATE_DECIMALS)),
      longitude: Number(place.longitude.toFixed(COORDINATE_DECIMALS)),
      fromDevice: place.fromDevice,
    },
  };
  try {
    target.setItem(TRACKER_PLACE_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function loadConfirmedPlace(storage?: StorageLike): ConfirmedPlaceRecord | null {
  const target = storageOrNull(storage);
  if (!target) return null;
  try {
    const parsed = JSON.parse(target.getItem(TRACKER_PLACE_STORAGE_KEY) ?? "null") as Partial<StoredPlaceV1> | null;
    const place = parsed?.place;
    if (
      parsed?.version !== SCHEMA_VERSION ||
      !place ||
      typeof place.name !== "string" ||
      typeof place.context !== "string" ||
      typeof place.latitude !== "number" ||
      typeof place.longitude !== "number" ||
      typeof place.fromDevice !== "boolean" ||
      !validCoordinate(place.latitude, place.longitude)
    ) {
      return null;
    }
    return { ...place, restored: true };
  } catch {
    return null;
  }
}
