import { describe, expect, it } from "vitest";
import { buildCloudTimeline, cloudAdvice, nextChange } from "./cloudTimeline";
import type { ObservedSeries } from "./cloudObservation";
import type { CloudForecastSeries } from "./cloud";
import type { CloudCategory } from "./goesGrid";

const HEAD = {
  satellite: "GOES-West",
  platform: "G18",
  scene: "CONUS",
  product: "ABI-L2-ACMC (Clear Sky Mask)",
  resolution: "2km at nadir",
  probabilityScale: 1.5261e-5,
};

function observed(entries: [string, CloudCategory | null][]): ObservedSeries {
  return {
    ...HEAD,
    frames: entries.map(([observedUtc, category]) => ({
      observedUtc,
      category,
      probability: null,
      quality: category ? ("good" as const) : ("unusable" as const),
      covered: true,
    })),
  };
}

function forecast(entries: [string, number][]): CloudForecastSeries {
  return { model: "NOAA HRRR", hours: entries.map(([validUtc, percent]) => ({ validUtc, percent })) };
}

const WINDOW = { windowStartUtc: "2026-09-03T02:00Z", windowEndUtc: "2026-09-03T12:00Z" };

describe("the cloud timeline", () => {
  it("puts observations before forecast hours, in time order", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T04:10Z",
      observed: observed([
        ["2026-09-03T03:00Z", "clear"],
        ["2026-09-03T04:00Z", "clear"],
      ]),
      forecast: forecast([
        ["2026-09-03T05:00Z", 10],
        ["2026-09-03T06:00Z", 90],
      ]),
    });
    expect(timeline.samples.map((sample) => sample.basis)).toEqual([
      "observed",
      "observed",
      "forecast",
      "forecast",
    ]);
    expect(timeline.samples.map((sample) => sample.atUtc)).toEqual([
      "2026-09-03T03:00Z",
      "2026-09-03T04:00Z",
      "2026-09-03T05:00Z",
      "2026-09-03T06:00Z",
    ]);
  });

  it("never lets a forecast hour cover ground the satellite already watched", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T05:10Z",
      observed: observed([["2026-09-03T05:00Z", "cloudy"]]),
      // The model also has an opinion about 05:00. The satellite was there.
      forecast: forecast([
        ["2026-09-03T05:00Z", 0],
        ["2026-09-03T06:00Z", 0],
      ]),
    });
    expect(timeline.samples).toHaveLength(2);
    expect(timeline.samples[0]).toMatchObject({ basis: "observed", suitability: "bad" });
    expect(timeline.samples[1]).toMatchObject({ basis: "forecast", atUtc: "2026-09-03T06:00Z" });
  });

  it("drops observations from before the window", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      // Two in the afternoon is this afternoon's weather, not tonight's.
      observed: observed([
        ["2026-09-02T21:00Z", "cloudy"],
        ["2026-09-03T03:00Z", "clear"],
      ]),
      forecast: null,
    });
    expect(timeline.samples).toHaveLength(1);
    expect(timeline.samples[0].atUtc).toBe("2026-09-03T03:00Z");
  });

  it("keeps a scan from just before dusk, because the satellite is on its own schedule", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T02:00Z",
      observed: observed([["2026-09-03T01:46Z", "clear"]]),
      forecast: null,
    });
    expect(timeline.samples).toHaveLength(1);
  });

  it("drops frames the mask could not classify", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T04:00Z",
      observed: observed([
        ["2026-09-03T03:00Z", "clear"],
        ["2026-09-03T03:30Z", null],
      ]),
      forecast: null,
    });
    expect(timeline.samples).toHaveLength(1);
  });

  it("marks where now falls", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T04:30Z",
      observed: observed([
        ["2026-09-03T03:00Z", "clear"],
        ["2026-09-03T04:00Z", "clear"],
      ]),
      forecast: forecast([["2026-09-03T05:00Z", 10]]),
    });
    expect(timeline.nowIndex).toBe(1);
  });

  it("names both sources when both spoke", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T04:00Z",
      observed: observed([["2026-09-03T04:00Z", "clear"]]),
      forecast: forecast([["2026-09-03T05:00Z", 10]]),
    });
    expect(timeline.observedSource).toBe("GOES-West ABI-L2-ACMC (Clear Sky Mask)");
    expect(timeline.forecastModel).toBe("NOAA HRRR");
    expect(timeline.bases).toEqual(["observed", "forecast"]);
  });

  it("names neither when nothing arrived", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T04:00Z",
      observed: null,
      forecast: null,
    });
    expect(timeline.samples).toEqual([]);
    expect(timeline.verdict).toBe("unknown");
    expect(timeline.observedSource).toBeNull();
    expect(timeline.forecastModel).toBeNull();
  });
});

describe("the next change", () => {
  it("says when a closed sky opens, and on whose authority", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:30Z",
      observed: observed([
        ["2026-09-03T03:00Z", "cloudy"],
        ["2026-09-03T03:30Z", "cloudy"],
      ]),
      forecast: forecast([
        ["2026-09-03T04:00Z", 5],
        ["2026-09-03T05:00Z", 5],
        ["2026-09-03T06:00Z", 5],
      ]),
    });
    expect(nextChange(timeline)).toEqual({
      kind: "clearing",
      atUtc: "2026-09-03T04:00Z",
      basis: "forecast",
    });
  });

  it("warns before an open sky closes", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: observed([["2026-09-03T03:00Z", "clear"]]),
      forecast: forecast([
        ["2026-09-03T04:00Z", 10],
        ["2026-09-03T05:00Z", 95],
        ["2026-09-03T06:00Z", 95],
      ]),
    });
    expect(nextChange(timeline)).toEqual({
      kind: "closing",
      atUtc: "2026-09-03T05:00Z",
      basis: "forecast",
    });
  });

  it("has nothing to say about a night that stays clear", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: observed([["2026-09-03T03:00Z", "clear"]]),
      forecast: forecast([
        ["2026-09-03T04:00Z", 5],
        ["2026-09-03T05:00Z", 5],
      ]),
    });
    expect(nextChange(timeline)).toBeNull();
  });
});

describe("what cloud does to a recommendation", () => {
  const closed = () =>
    buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: observed([
        ["2026-09-03T02:30Z", "cloudy"],
        ["2026-09-03T03:00Z", "cloudy"],
      ]),
      forecast: forecast([
        ["2026-09-03T04:00Z", 95],
        ["2026-09-03T05:00Z", 95],
        ["2026-09-03T06:00Z", 95],
        ["2026-09-03T07:00Z", 95],
        ["2026-09-03T08:00Z", 95],
        ["2026-09-03T09:00Z", 95],
      ]),
    });

  it("says nothing when the sky is open", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: observed([["2026-09-03T03:00Z", "clear"]]),
      forecast: forecast([["2026-09-03T04:00Z", 5]]),
    });
    expect(cloudAdvice(timeline, "notable", "UTC")).toEqual({
      warning: null,
      goAnyway: false,
    });
  });

  it("says nothing when it has nothing to go on", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: null,
      forecast: null,
    });
    expect(cloudAdvice(timeline, "routine", "UTC").warning).toBeNull();
  });

  it("warns about every tier rather than silently dropping any of them", () => {
    // Cloud never removes an opportunity: the sky can open, and something the
    // rail deleted is something the reader can never find out was there.
    for (const tier of ["routine", "good-example", "favourable", "notable"] as const) {
      expect(cloudAdvice(closed(), tier, "UTC").warning).toBeTruthy();
    }
  });

  it("offers no ordering signal at all, because cloud has none to give", () => {
    // The same sky covers everything above one place, so a per-opportunity
    // penalty would either change no order or merely restate the significance
    // tiers. What differs between tiers is the wording, and only the wording.
    const advice = cloudAdvice(closed(), "routine", "UTC");
    expect(Object.keys(advice).sort()).toEqual(["goAnyway", "warning"]);
  });

  it("tells the reader to go anyway for something they will not see again", () => {
    const advice = cloudAdvice(closed(), "notable", "UTC");
    expect(advice.goAnyway).toBe(true);
    expect(advice.warning).toContain("Worth going anyway");
  });

  it("does not say that about a planet that is up most nights", () => {
    const advice = cloudAdvice(closed(), "routine", "UTC");
    expect(advice.goAnyway).toBe(false);
    expect(advice.warning).not.toContain("Worth going anyway");
  });

  it("quotes the clearing time on the reader's own clock", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: observed([
        ["2026-09-03T02:30Z", "cloudy"],
        ["2026-09-03T03:00Z", "cloudy"],
      ]),
      forecast: forecast([
        ["2026-09-03T04:00Z", 5],
        ["2026-09-03T05:00Z", 5],
        ["2026-09-03T06:00Z", 5],
      ]),
    });
    const advice = cloudAdvice(timeline, "routine", "America/Los_Angeles");
    // 04:00Z is 9pm the previous evening in Pacific daylight time.
    expect(advice.warning).toContain("9:00");
    expect(advice.warning).not.toContain("UTC");
  });
});
