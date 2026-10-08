import { describe, expect, it } from "vitest";
import {
  CLOUD_MEASURE_NOUN,
  cloudPhrase,
  cloudSourceLine,
  describesCover,
  describesProbability,
} from "./cloudWording";
import { CLOUD_CATEGORIES } from "./goesGrid";

/**
 * The regression this file exists for.
 *
 * NOAA's `Cloud_Probabilities` is the probability that a satellite pixel is
 * cloudy. A forecast model's total cloud cover is a fraction of sky. Both come
 * out of arithmetic as a number between 0 and 100, and the moment they are
 * rendered as `${value}%` at two call sites, somebody attaches the same noun to
 * both — and the interface starts telling a reader that a confidence is an
 * amount of sky.
 */
describe("a cloud number carries its own noun", () => {
  it("calls observed probability what it is", () => {
    expect(cloudPhrase({ kind: "observed-probability", probability: 0.84 })).toBe(
      "84% cloud probability",
    );
  });

  it("calls forecast cover what it is", () => {
    expect(cloudPhrase({ kind: "forecast-cover", percent: 64 })).toBe("64% cloud cover");
  });

  it("never lets the two nouns be the same string", () => {
    expect(CLOUD_MEASURE_NOUN["observed-probability"]).not.toBe(
      CLOUD_MEASURE_NOUN["forecast-cover"],
    );
  });

  /**
   * The specific failure: the same number, from the two sources, must not
   * produce the same sentence. If it ever does, the distinction has been
   * normalised away and a reader cannot recover it.
   */
  it("does not produce identical text for the same number from different sources", () => {
    for (const value of [0, 12, 42, 84, 100]) {
      const observed = cloudPhrase({ kind: "observed-probability", probability: value / 100 });
      const forecast = cloudPhrase({ kind: "forecast-cover", percent: value });
      expect(observed).not.toBe(forecast);
      expect(describesProbability(observed)).toBe(true);
      expect(describesCover(observed)).toBe(false);
      expect(describesCover(forecast)).toBe(true);
      expect(describesProbability(forecast)).toBe(false);
    }
  });

  it("never renders an observed classification as a percentage", () => {
    for (const category of CLOUD_CATEGORIES) {
      const phrase = cloudPhrase({ kind: "observed-classification", category });
      expect(phrase).not.toMatch(/%/);
      expect(describesCover(phrase)).toBe(false);
      expect(describesProbability(phrase)).toBe(false);
    }
  });

  it("keeps a probability inside its own range rather than reporting 120%", () => {
    expect(cloudPhrase({ kind: "observed-probability", probability: 1.4 })).toBe(
      "100% cloud probability",
    );
    expect(cloudPhrase({ kind: "observed-probability", probability: -0.2 })).toBe(
      "0% cloud probability",
    );
  });
});

describe("where a number came from", () => {
  it("names the spacecraft and how long ago it looked", () => {
    expect(cloudSourceLine({ kind: "observed", platform: "GOES-19", ageMinutes: 4 })).toBe(
      "GOES-19 · observed 4 min ago",
    );
  });

  it("says just now rather than 0 min ago", () => {
    expect(cloudSourceLine({ kind: "observed", platform: "G18", ageMinutes: 0.4 })).toBe(
      "G18 · observed just now",
    );
  });

  it("names the model and the hour a forecast is for", () => {
    expect(
      cloudSourceLine({ kind: "forecast", model: "HRRR", validLocal: "10:00 PM" }),
    ).toBe("Forecast · HRRR · 10:00 PM");
  });

  /**
   * The two provenance lines must be distinguishable before they are read.
   * A reader deciding whether to trust a number should not have to parse a
   * sentence to learn whether anybody actually looked at the sky.
   */
  it("makes observed and forecast provenance visibly different shapes", () => {
    const observed = cloudSourceLine({ kind: "observed", platform: "GOES-19", ageMinutes: 4 });
    const forecast = cloudSourceLine({ kind: "forecast", model: "HRRR", validLocal: "10:00 PM" });
    expect(observed).toMatch(/observed/i);
    expect(forecast).toMatch(/^Forecast/);
    expect(observed).not.toMatch(/^Forecast/);
  });
});
