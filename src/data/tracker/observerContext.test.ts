import { describe, expect, it } from "vitest";
import { placeAtPin, trackerObserverKey } from "./observerContext";
import { planNight } from "./schedule";

const greenbelt = { name: "Greenbelt", context: "Maryland", latitude: 38.996, longitude: -76.876, fromDevice: false };
const pin = (latitude: number, longitude: number) => ({ latitudeDeg: latitude, longitudeDeg: longitude });

describe("Tracker observer authority", () => {
  it("keeps nearby naming metadata without borrowing its coordinates or device fix", () => {
    const nearby = placeAtPin(pin(38.997, -76.877), { ...greenbelt, fromDevice: true })!;
    expect(nearby.name).toBe("Greenbelt");
    expect(nearby).toMatchObject({ latitude: 38.997, longitude: -76.877, fromDevice: false });
    expect(trackerObserverKey(nearby)).not.toBe(trackerObserverKey(greenbelt));
    expect(placeAtPin(null, greenbelt)).toBeNull();
  });

  it("recomputes the production plan for A → B → A and nearby coordinates", () => {
    const at = new Date("2026-09-02T20:00:00Z");
    const plan = (latitude: number, longitude: number) => {
      const observer = placeAtPin(pin(latitude, longitude), greenbelt)!;
      return planNight(observer.latitude, observer.longitude, at, "America/New_York")!;
    };
    const initial = plan(38.996, -76.876);
    const edgewater = plan(38.957, -76.55);
    const nearby = plan(38.997, -76.877);
    expect(edgewater.identity.key).not.toBe(initial.identity.key);
    expect(edgewater.ranking).not.toEqual(initial.ranking);
    expect(nearby.identity).toMatchObject({ latitudeDeg: 38.997, longitudeDeg: -76.877 });
    expect(nearby.ranking).not.toEqual(initial.ranking);
    expect(plan(38.996, -76.876)).toEqual(initial);
  });
});
