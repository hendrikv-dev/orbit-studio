import { describe, expect, it } from "vitest";
import {
  loadConfirmedPlace,
  persistConfirmedPlace,
  TRACKER_PLACE_STORAGE_KEY,
} from "./trackerPersistence";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("confirmed Tracker place persistence", () => {
  it("stores only a versioned, rounded confirmed place and labels the restore", () => {
    const storage = memoryStorage();
    expect(
      persistConfirmedPlace(
        {
          name: "Joshua Tree",
          context: "California, United States",
          latitude: 34.1349998,
          longitude: -116.3129997,
          fromDevice: false,
        },
        storage,
      ),
    ).toBe(true);
    const raw = storage.values.get(TRACKER_PLACE_STORAGE_KEY)!;
    expect(raw).not.toMatch(/forecast|weather|accuracy|plan/i);
    expect(loadConfirmedPlace(storage)).toEqual({
      name: "Joshua Tree",
      context: "California, United States",
      latitude: 34.135,
      longitude: -116.313,
      fromDevice: false,
      restored: true,
    });
  });

  it("rejects invalid or unknown persisted schemas", () => {
    const storage = memoryStorage();
    storage.setItem(TRACKER_PLACE_STORAGE_KEY, JSON.stringify({ version: 99, place: {} }));
    expect(loadConfirmedPlace(storage)).toBeNull();
    storage.setItem(TRACKER_PLACE_STORAGE_KEY, "not json");
    expect(loadConfirmedPlace(storage)).toBeNull();
  });
});
