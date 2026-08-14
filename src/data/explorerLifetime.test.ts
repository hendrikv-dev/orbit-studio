import { describe, expect, it } from "vitest";
import { explorerHistoricalCatalog } from "./explorerHistoricalCatalog";
import {
  explorerLifetimeBands,
  survivalAt,
  survivalCurve,
  type LifetimeObservation,
} from "./explorerLifetime";

const SNAPSHOT_YEAR = 2026;
const objects = explorerHistoricalCatalog.objects;
const bands = explorerLifetimeBands(objects, SNAPSHOT_YEAR);
const band = (id: string) => bands.find((item) => item.id === id)!;

describe("Kaplan-Meier estimator", () => {
  it("returns 1 for a population where nothing has decayed", () => {
    const observations: LifetimeObservation[] = [
      { years: 5, decayed: false },
      { years: 9, decayed: false },
    ];
    const curve = survivalCurve(observations);
    expect(survivalAt(curve, 20)).toBe(1);
  });

  it("does not count a censored object as a death", () => {
    // Four objects; one decays at year 1. Survival must be 0.75, not 0.25.
    const curve = survivalCurve([
      { years: 1, decayed: true },
      { years: 1, decayed: false },
      { years: 2, decayed: false },
      { years: 3, decayed: false },
    ]);
    expect(survivalAt(curve, 1)).toBeCloseTo(0.75, 6);
    expect(survivalAt(curve, 5)).toBeCloseTo(0.75, 6);
  });

  it("reduces the population at risk as observations leave", () => {
    const curve = survivalCurve([
      { years: 1, decayed: true },
      { years: 2, decayed: true },
      { years: 3, decayed: false },
      { years: 4, decayed: false },
    ]);
    // 1 - 1/4 = 0.75, then 0.75 * (1 - 1/3) = 0.5
    expect(survivalAt(curve, 2)).toBeCloseTo(0.5, 6);
  });

  it("never increases", () => {
    for (const item of bands) {
      let previous = 1;
      for (const point of item.curve) {
        expect(point.survival).toBeLessThanOrEqual(previous + 1e-9);
        previous = point.survival;
      }
    }
  });
});

describe("measured orbital lifetime", () => {
  it("has enough observations in every band to say anything", () => {
    for (const item of bands) expect(item.observed).toBeGreaterThan(300);
  });

  it("lasts longer the higher the orbit", () => {
    // The result the view exists to show, stated as a monotonic claim so a
    // catalog rebuild that breaks it fails here.
    const ordered = bands.map((item) => survivalAt(item.curve, 5));
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]).toBeGreaterThanOrEqual(ordered[index - 1] - 1e-9);
    }
  });

  it("puts the decay cliff between 600 and 1000 km", () => {
    expect(band("400-500").medianYears).toBeLessThanOrEqual(2);
    expect(band("500-600").medianYears).toBeLessThanOrEqual(4);
    expect(band("600-800").medianYears).toBeGreaterThan(8);
    // Above 800 km half the population has not decayed in the whole record.
    expect(band("800-1000").medianYears).toBeNull();
    expect(band("1000-1400").medianYears).toBeNull();
  });

  it("clears the low bands within a year or two", () => {
    expect(survivalAt(band("200-300").curve, 1)).toBeLessThan(0.1);
    expect(survivalAt(band("300-400").curve, 2)).toBeLessThan(0.1);
  });

  it("still has most of the high bands in orbit after 25 years", () => {
    expect(survivalAt(band("800-1000").curve, 25)).toBeGreaterThan(0.6);
    expect(survivalAt(band("1000-1400").curve, 25)).toBeGreaterThan(0.7);
  });
});

describe("the maneuvering control", () => {
  const payloads = explorerLifetimeBands(objects, SNAPSHOT_YEAR, "payload");
  const payloadBand = (id: string) => payloads.find((item) => item.id === id)!;

  it("shows payloads apparently outlasting drag at insertion altitudes", () => {
    // Payloads are inserted low and raised, so their recorded orbit is not
    // where they lived. This is the evidence that the default population has to
    // exclude them — if this assertion ever stops holding, the control is no
    // longer needed and the view should say so.
    expect(survivalAt(payloadBand("200-300").curve, 1)).toBeGreaterThan(0.6);
    expect(survivalAt(band("200-300").curve, 1)).toBeLessThan(0.1);
  });

  it("inverts the altitude ordering it should obey", () => {
    // Measured on payloads, the lowest band appears to outlast the one above it.
    expect(survivalAt(payloadBand("200-300").curve, 5)).toBeGreaterThan(
      survivalAt(payloadBand("300-400").curve, 5),
    );
  });

  it("separates the two populations completely", () => {
    const defaultTotal = bands.reduce((sum, item) => sum + item.observed, 0);
    const payloadTotal = payloads.reduce((sum, item) => sum + item.observed, 0);
    expect(defaultTotal).toBeGreaterThan(1000);
    expect(payloadTotal).toBeGreaterThan(1000);
  });
});
