import { describe, expect, it } from "vitest";
import {
  actionLine,
  bestViewingWindow,
  forecastFreshness,
  nearestSnapshot,
  readCondition,
  skyAccess,
  viewability,
  type ConditionSnapshot,
  type OpportunitySample,
} from "./conditions";

const NOW = new Date("2026-08-16T18:00:00Z");

function snapshot(overrides: Partial<ConditionSnapshot> = {}): ConditionSnapshot {
  return {
    atUtc: "2026-08-16T23:00:00.000Z",
    cloudCoverPercent: 0,
    temperatureC: 14,
    issuedUtc: "2026-08-16T17:00:00.000Z",
    precipitating: false,
    visibilityM: null,
    lowCloudPercent: null,
    midCloudPercent: null,
    highCloudPercent: null,
    relativeHumidityPercent: null,
    smokeColumnMgM2: null,
    surfacePm25: null,
    source: "test",
    ...overrides,
  };
}

describe("the condition vocabulary", () => {
  it("names the sky in the terms the interface uses", () => {
    expect(readCondition(snapshot({ cloudCoverPercent: 5 })).condition).toBe("clear");
    expect(readCondition(snapshot({ cloudCoverPercent: 30 })).condition).toBe("somewhat-cloudy");
    expect(readCondition(snapshot({ cloudCoverPercent: 60 })).condition).toBe("cloudy");
    expect(readCondition(snapshot({ cloudCoverPercent: 95 })).condition).toBe("overcast");
  });

  it("puts precipitation and fog ahead of cloud, because they end the evening", () => {
    expect(readCondition(snapshot({ cloudCoverPercent: 20, precipitating: true })).condition).toBe(
      "precipitating",
    );
    expect(readCondition(snapshot({ cloudCoverPercent: 20, visibilityM: 300 })).condition).toBe(
      "foggy",
    );
  });

  it("can say clear but smoky, which is the whole point of tracking smoke", () => {
    const reading = readCondition(snapshot({ cloudCoverPercent: 3, smokeColumnMgM2: 60 }));
    expect(reading.condition).toBe("smoky");
    expect(reading.label).toBe("Clear but smoky");
    expect(reading.smokeDominant).toBe(true);
  });

  it("distinguishes smoky from very smoky rather than reusing the cloud state", () => {
    const heavy = readCondition(snapshot({ cloudCoverPercent: 3, smokeColumnMgM2: 200 }));
    expect(heavy.condition).toBe("very-smoky");
    expect(heavy.condition).not.toBe("cloudy");
  });

  it("does not make smoke the headline under an overcast, where there is nothing to spoil", () => {
    const reading = readCondition(snapshot({ cloudCoverPercent: 95, smokeColumnMgM2: 60 }));
    expect(reading.smokeDominant).toBe(false);
    expect(reading.label).toMatch(/overcast/i);
  });
});

describe("sky access", () => {
  it("is nothing at all through rain or fog", () => {
    expect(skyAccess(snapshot({ precipitating: true }), "low")).toBe(0);
    expect(skyAccess(snapshot({ visibilityM: 200 }), "low")).toBe(0);
  });

  it("costs a demanding target more than a forgiving one", () => {
    const broken = snapshot({ cloudCoverPercent: 50 });
    expect(skyAccess(broken, "high")).toBeLessThan(skyAccess(broken, "low"));
  });

  it("lets smoke dim rather than block, and dim the faint far more", () => {
    const smoky = snapshot({ cloudCoverPercent: 0, smokeColumnMgM2: 100 });
    expect(skyAccess(smoky, "high")).toBeGreaterThan(0);
    expect(skyAccess(smoky, "high")).toBeLessThan(skyAccess(smoky, "low"));
    // A clear smoky sky still beats an overcast one.
    expect(skyAccess(smoky, "high")).toBeGreaterThan(
      skyAccess(snapshot({ cloudCoverPercent: 95 }), "high"),
    );
  });

  it("runs unchanged when smoke is unavailable, rather than assuming none", () => {
    const withoutSmoke = snapshot({ cloudCoverPercent: 20, smokeColumnMgM2: null });
    const withNoSmoke = snapshot({ cloudCoverPercent: 20, smokeColumnMgM2: 0 });
    expect(skyAccess(withoutSmoke, "high")).toBeCloseTo(skyAccess(withNoSmoke, "high"), 6);
  });
});

describe("the viewing recommendation", () => {
  it("reports a band, never a percentage", () => {
    const result = viewability(snapshot(), "high", 0.8, NOW);
    expect(["excellent", "good", "possible", "unlikely"]).toContain(result.band);
    expect(JSON.stringify(result)).not.toMatch(/%/);
  });

  it("keeps both halves addressable after combining them", () => {
    // A strong phenomenon behind cloud must be distinguishable from a weak
    // phenomenon under a clear sky. Both rank low; only one is the sky's fault.
    const clouded = viewability(snapshot({ cloudCoverPercent: 95 }), "high", 0.9, NOW);
    const weak = viewability(snapshot({ cloudCoverPercent: 0 }), "high", 0.1, NOW);
    expect(clouded.band).toBe("unlikely");
    expect(weak.band).toBe("unlikely");
    expect(clouded.limitedBySky).toBe(true);
    expect(weak.limitedBySky).toBe(false);
  });

  it("does not blame the sky for light cloud on a good night", () => {
    // "It is the sky that is in the way" next to a badge reading good, under
    // scattered cloud, reads as a fault in the product rather than a fact.
    const light = viewability(snapshot({ cloudCoverPercent: 20 }), "low", 0.9, NOW);
    expect(light.band).toBe("excellent");
    expect(light.limitedBySky).toBe(false);
  });

  it("keeps freshness independent of the band", () => {
    const stale = snapshot({ issuedUtc: "2026-08-15T00:00:00Z" });
    expect(forecastFreshness(stale, NOW)).toBe("stale");
    // Same sky, same band, different confidence in it.
    expect(viewability(stale, "high", 0.9, NOW).band).toBe(
      viewability(snapshot(), "high", 0.9, NOW).band,
    );
  });
});

describe("choosing when to go outside", () => {
  const hourly = (values: { hour: number; cloud: number }[]): ConditionSnapshot[] =>
    values.map((entry) =>
      snapshot({
        atUtc: `2026-08-16T${String(entry.hour).padStart(2, "0")}:00:00.000Z`,
        cloudCoverPercent: entry.cloud,
      }),
    );

  const profile = (values: { hour: number; relative: number }[]): OpportunitySample[] =>
    values.map((entry) => ({
      atUtc: `2026-08-16T${String(entry.hour).padStart(2, "0")}:00:00.000Z`,
      relative: entry.relative,
    }));

  it("recommends the clear interval after the peak, not the peak under cloud", () => {
    // The acceptance criterion this whole file exists for: "When a clear
    // interval occurs after the nominal peak, Tracker recommends the clearer
    // useful interval rather than repeating the peak time."
    const window = bestViewingWindow(
      profile([
        { hour: 21, relative: 0.8 },
        { hour: 22, relative: 1.0 },
        { hour: 23, relative: 0.9 },
        { hour: 0, relative: 0.75 },
      ]),
      hourly([
        { hour: 21, cloud: 95 },
        { hour: 22, cloud: 95 },
        { hour: 23, cloud: 90 },
        { hour: 0, cloud: 5 },
      ]),
      "high",
      0.8,
      NOW,
    );
    expect(window!.peakUtc).toMatch(/T00:00/);
    expect(window!.movedByWeather).toBe(true);
  });

  it("stays at the peak when the sky is the same all night", () => {
    const window = bestViewingWindow(
      profile([
        { hour: 21, relative: 0.5 },
        { hour: 22, relative: 1.0 },
        { hour: 23, relative: 0.6 },
      ]),
      hourly([
        { hour: 21, cloud: 10 },
        { hour: 22, cloud: 10 },
        { hour: 23, cloud: 10 },
      ]),
      "high",
      0.8,
      NOW,
    );
    expect(window!.peakUtc).toMatch(/T22:00/);
    expect(window!.movedByWeather).toBe(false);
  });

  it("returns an interval, not just an instant", () => {
    const window = bestViewingWindow(
      profile([
        { hour: 21, relative: 0.9 },
        { hour: 22, relative: 1.0 },
        { hour: 23, relative: 0.95 },
      ]),
      hourly([
        { hour: 21, cloud: 0 },
        { hour: 22, cloud: 0 },
        { hour: 23, cloud: 0 },
      ]),
      "high",
      0.8,
      NOW,
    );
    expect(Date.parse(window!.endUtc)).toBeGreaterThan(Date.parse(window!.startUtc));
  });

  it("gives up rather than recommending an hour under rain", () => {
    const window = bestViewingWindow(
      profile([{ hour: 22, relative: 1 }]),
      [snapshot({ atUtc: "2026-08-16T22:00:00.000Z", precipitating: true })],
      "high",
      0.8,
      NOW,
    );
    expect(window).toBeNull();
  });

  it("still recommends the phenomenon's own best when no forecast exists", () => {
    // Provider failure degrades to an unadjusted recommendation rather than
    // hiding the event.
    const window = bestViewingWindow(
      profile([
        { hour: 21, relative: 0.4 },
        { hour: 22, relative: 1.0 },
      ]),
      [],
      "high",
      0.8,
      NOW,
    );
    expect(window!.peakUtc).toMatch(/T22:00/);
    expect(window!.viewability.reading.label).toMatch(/unavailable/i);
  });

  it("refuses to interpolate a forecast across a gap it does not cover", () => {
    expect(
      nearestSnapshot([snapshot({ atUtc: "2026-08-16T12:00:00.000Z" })], "2026-08-16T23:00:00.000Z"),
    ).toBeNull();
  });
});

describe("the action line", () => {
  const window = (movedByWeather: boolean, cloud: number) =>
    bestViewingWindow(
      [
        { atUtc: "2026-08-16T22:00:00.000Z", relative: 1 },
        { atUtc: "2026-08-16T23:00:00.000Z", relative: 0.9 },
      ],
      [
        snapshot({ atUtc: "2026-08-16T22:00:00.000Z", cloudCoverPercent: movedByWeather ? 95 : cloud }),
        snapshot({ atUtc: "2026-08-16T23:00:00.000Z", cloudCoverPercent: cloud }),
      ],
      "high",
      0.8,
      NOW,
    )!;

  it("tells the user what to do, not what the weather is", () => {
    expect(actionLine(window(false, 0), 12)).toMatch(/\d{2}:\d{2}/);
  });

  it("never scolds, even when the sky is poor", () => {
    const line = actionLine(window(true, 5), 8);
    expect(line).not.toMatch(/too cloudy|nothing|poor|skip|marginal|don't bother/i);
    expect(line).toMatch(/best chance/i);
  });

  it("carries the temperature for the recommended time", () => {
    expect(actionLine(window(false, 0), 12)).toMatch(/12°C/);
  });
});
