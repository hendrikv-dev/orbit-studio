import { describe, expect, it } from "vitest";
import { buildCloudTimeline, cloudAdvice, cloudOver, nextChange } from "./cloudTimeline";
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
  /** A night that is closed early and clear later, as hourly forecast steps. */
  const clearingNight = () =>
    buildCloudTimeline({
      windowStartUtc: "2026-09-03T02:00Z",
      windowEndUtc: "2026-09-03T12:00Z",
      nowUtc: "2026-09-03T02:00Z",
      observed: null,
      forecast: forecast([
        ["2026-09-03T02:00Z", 95],
        ["2026-09-03T03:00Z", 95],
        ["2026-09-03T04:00Z", 95],
        ["2026-09-03T05:00Z", 95],
        ["2026-09-03T06:00Z", 5],
        ["2026-09-03T07:00Z", 5],
        ["2026-09-03T08:00Z", 5],
        ["2026-09-03T09:00Z", 5],
        ["2026-09-03T10:00Z", 5],
        ["2026-09-03T11:00Z", 5],
      ]),
    });

  const closedNight = () =>
    buildCloudTimeline({
      windowStartUtc: "2026-09-03T02:00Z",
      windowEndUtc: "2026-09-03T12:00Z",
      nowUtc: "2026-09-03T02:00Z",
      observed: null,
      forecast: forecast(
        Array.from({ length: 10 }, (_, hour) => [
          `2026-09-03T${String(2 + hour).padStart(2, "0")}:00Z`,
          95,
        ]) as [string, number][],
      ),
    });

  it("says nothing when the sky is open", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: observed([["2026-09-03T03:00Z", "clear"]]),
      forecast: forecast([["2026-09-03T04:00Z", 5]]),
    });
    expect(cloudAdvice(timeline, "time-critical", "UTC")).toEqual({
      suppress: false,
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
    expect(cloudAdvice(timeline, "routine", "UTC").suppress).toBe(false);
  });

  /* --- what the brief calls the governing principle ---------------------- */

  it("withholds a routine target whose own window is unusable", () => {
    const advice = cloudAdvice(closedNight(), "routine", "UTC", {
      startUtc: "2026-09-03T02:00Z",
      endUtc: "2026-09-03T05:00Z",
    });
    expect(advice.suppress).toBe(true);
    expect(advice.warning).toBeTruthy();
  });

  it("keeps a rare event under the same sky, and says so unmistakably", () => {
    const advice = cloudAdvice(closedNight(), "time-critical", "UTC", {
      startUtc: "2026-09-03T02:00Z",
      endUtc: "2026-09-03T05:00Z",
    });
    expect(advice.suppress).toBe(false);
    expect(advice.goAnyway).toBe(true);
    expect(advice.warning).toMatch(/worth going anyway/i);
  });

  it("keeps a routine target when the cloud is only intermittent", () => {
    const timeline = buildCloudTimeline({
      windowStartUtc: "2026-09-03T02:00Z",
      windowEndUtc: "2026-09-03T12:00Z",
      nowUtc: "2026-09-03T02:00Z",
      observed: null,
      forecast: forecast([
        ["2026-09-03T02:00Z", 95],
        ["2026-09-03T03:00Z", 95],
        ["2026-09-03T04:00Z", 10],
        ["2026-09-03T05:00Z", 10],
        ["2026-09-03T06:00Z", 10],
        ["2026-09-03T07:00Z", 10],
      ]),
    });
    const advice = cloudAdvice(timeline, "routine", "UTC", {
      startUtc: "2026-09-03T02:00Z",
      endUtc: "2026-09-03T07:00Z",
    });
    expect(advice.suppress).toBe(false);
    expect(advice.warning).toMatch(/comes and goes/i);
  });

  /* --- different times, different answers -------------------------------- */

  /**
   * The defect this replaces reasoned from one cloud state for the whole night.
   * Saturn at nine and a shower at two are not the same question, and on a
   * night that clears at midnight they must not receive the same answer.
   */
  it("gives two opportunities at different times different outcomes", () => {
    const timeline = clearingNight();
    const early = cloudAdvice(timeline, "routine", "UTC", {
      startUtc: "2026-09-03T02:00Z",
      endUtc: "2026-09-03T05:00Z",
    });
    const late = cloudAdvice(timeline, "routine", "UTC", {
      startUtc: "2026-09-03T07:00Z",
      endUtc: "2026-09-03T11:00Z",
    });
    expect(early.suppress).toBe(true);
    expect(late.suppress).toBe(false);
    expect(late.warning).toBeNull();
  });

  it("lets a later clearance save a later opportunity", () => {
    const timeline = clearingNight();
    expect(
      cloudAdvice(timeline, "routine", "UTC", {
        startUtc: "2026-09-03T08:00Z",
        endUtc: "2026-09-03T11:00Z",
      }).suppress,
    ).toBe(false);
  });

  it("suppresses an opportunity whose peak sits in the worst of the cloud", () => {
    const timeline = clearingNight();
    // Entirely inside the closed stretch.
    expect(
      cloudAdvice(timeline, "routine", "UTC", {
        startUtc: "2026-09-03T02:00Z",
        endUtc: "2026-09-03T04:00Z",
      }).suppress,
    ).toBe(true);
  });

  it("judges the night as a whole when an opportunity has no interval of its own", () => {
    const advice = cloudAdvice(closedNight(), "routine", "UTC", null);
    expect(advice.suppress).toBe(true);
  });

  it("never suppresses on an interval nothing sampled", () => {
    const advice = cloudAdvice(closedNight(), "routine", "UTC", {
      startUtc: "2026-09-04T02:00Z",
      endUtc: "2026-09-04T05:00Z",
    });
    expect(advice.suppress).toBe(false);
    expect(advice.warning).toBeNull();
  });
});

describe("cloud over one interval", () => {
  it("reports nothing for an interval outside the timeline", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: observed([["2026-09-03T03:00Z", "clear"]]),
      forecast: null,
    });
    expect(cloudOver(timeline, "2026-09-05T00:00Z", "2026-09-05T01:00Z")).toEqual({
      verdict: "unknown",
      samples: 0,
      worst: null,
    });
  });

  it("reports the worst level reached inside it", () => {
    const timeline = buildCloudTimeline({
      windowStartUtc: "2026-09-03T02:00Z",
      windowEndUtc: "2026-09-03T12:00Z",
      nowUtc: "2026-09-03T02:00Z",
      observed: null,
      forecast: forecast([
        ["2026-09-03T02:00Z", 5],
        ["2026-09-03T03:00Z", 95],
        ["2026-09-03T04:00Z", 5],
      ]),
    });
    expect(cloudOver(timeline, "2026-09-03T02:00Z", "2026-09-03T04:00Z").worst).toBe("bad");
    expect(cloudOver(timeline, "2026-09-03T04:00Z", "2026-09-03T04:00Z").worst).toBe("good");
  });

  it("refuses a backwards interval rather than guessing", () => {
    const timeline = buildCloudTimeline({
      ...WINDOW,
      nowUtc: "2026-09-03T03:00Z",
      observed: observed([["2026-09-03T03:00Z", "clear"]]),
      forecast: null,
    });
    expect(cloudOver(timeline, "2026-09-03T06:00Z", "2026-09-03T02:00Z").verdict).toBe("unknown");
  });
});
