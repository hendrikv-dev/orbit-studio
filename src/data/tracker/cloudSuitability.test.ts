import { describe, expect, it } from "vitest";
import {
  CLEAR_AFTER_MINUTES,
  RAISE_AFTER_MINUTES,
  suitabilityOfCategory,
  suitabilityOfPercent,
  verdictOf,
  warningsIn,
  type CloudSample,
  type Suitability,
} from "./cloudSuitability";

const OF: Record<string, Suitability> = { g: "good", f: "fair", p: "poor", b: "bad" };

/**
 * A run of samples at a given cadence, written as a suitability string.
 *
 * The cadence is explicit because it is the thing under test: the same letters
 * at five minutes and at an hour describe very different nights, and the rule
 * has to notice.
 */
function at(letters: string, minutes: number, basis: "observed" | "forecast"): CloudSample[] {
  const base = Date.parse("2026-09-03T00:00:00Z");
  return [...letters].map((letter, index) => ({
    atUtc: new Date(base + index * minutes * 60_000).toISOString(),
    basis,
    suitability: OF[letter],
  }));
}

/** Five-minute satellite scans, the observed cadence. */
const scans = (letters: string) => at(letters, 5, "observed");

/** Hourly forecast steps. */
const hours = (letters: string) => at(letters, 60, "forecast");

/** Hourly samples, for the verdict tests that do not care about cadence. */
const series = (letters: string, basis: "observed" | "forecast" = "observed") =>
  at(letters, 60, basis);

describe("suitability", () => {
  it("relabels the mask's own four levels without inventing a percentage", () => {
    expect(suitabilityOfCategory("clear")).toBe("good");
    expect(suitabilityOfCategory("probably_clear")).toBe("fair");
    expect(suitabilityOfCategory("probably_cloudy")).toBe("poor");
    expect(suitabilityOfCategory("cloudy")).toBe("bad");
  });

  it("puts the model's thresholds where they change what a reader does", () => {
    expect(suitabilityOfPercent(0)).toBe("good");
    expect(suitabilityOfPercent(20)).toBe("good");
    expect(suitabilityOfPercent(21)).toBe("fair");
    expect(suitabilityOfPercent(50)).toBe("fair");
    expect(suitabilityOfPercent(51)).toBe("poor");
    expect(suitabilityOfPercent(80)).toBe("poor");
    expect(suitabilityOfPercent(100)).toBe("bad");
  });
});

describe("warnings, measured in time rather than in samples", () => {
  it("says nothing about a clear night", () => {
    expect(warningsIn(series("gggggggg"))).toEqual([]);
  });

  it("ignores a single bad scan between clear ones", () => {
    // Five minutes of cloud crossing a two-kilometre pixel is not the end of
    // the night, and warning on it would make the layer flicker as scans land.
    expect(warningsIn(scans("gggbgggg"))).toEqual([]);
  });

  it("raises once deterioration has actually persisted", () => {
    // Nine five-minute scans of bad sky is forty-five minutes, past the
    // forty-minute threshold.
    const warnings = warningsIn(scans("ggbbbbbbbbbgggggggggggggggggggg"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("bad");
  });

  it("does not raise on a short burst, however many samples it contains", () => {
    // Six scans is thirty minutes. Same number of *samples* as would trigger
    // under the old raw-count rule several times over; still under the time.
    expect(warningsIn(scans("ggbbbbbbgggggggggggg"))).toEqual([]);
  });

  /**
   * The regression this change exists for.
   *
   * Under a raw-count rule, two observations meant ten minutes and two
   * forecast hours meant two hours — the same words, twelve times the sky. The
   * threshold must describe the same amount of night whichever source supplies
   * it.
   */
  it("treats the same elapsed time the same way whatever the cadence", () => {
    // Forty-five minutes of bad sky as nine five-minute scans...
    const observed = warningsIn(scans("g" + "b".repeat(9) + "g".repeat(30)));
    // ...and as one hourly forecast step, which is sixty minutes.
    const forecast = warningsIn(hours("gbgggggg"));
    expect(observed).toHaveLength(1);
    expect(forecast).toHaveLength(1);
  });

  it("does not let a run of brief scans warn faster than the clock allows", () => {
    // Four scans is twenty minutes: fewer minutes than the threshold, more
    // samples than the old rule needed.
    expect(warningsIn(scans("gbbbbgggggggg"))).toEqual([]);
  });

  it("needs sustained improvement before it relents", () => {
    // Bad for an hour, then one clear scan, then bad again. Five minutes of
    // clear sky is not a clearance.
    const warnings = warningsIn(scans("b".repeat(12) + "g" + "b".repeat(12)));
    expect(warnings).toHaveLength(1);
  });

  it("clears when improvement has held long enough", () => {
    // An hour bad, then two hours clear: past the ninety-minute clear rule.
    const warnings = warningsIn(scans("b".repeat(12) + "g".repeat(24)));
    expect(warnings).toHaveLength(1);
    expect(Date.parse(warnings[0].toUtc)).toBeLessThan(Date.parse("2026-09-03T02:00:00Z"));
  });

  it("takes longer to relent than to warn", () => {
    expect(CLEAR_AFTER_MINUTES).toBeGreaterThan(RAISE_AFTER_MINUTES);
  });

  it("closes an open warning at the end of the window", () => {
    const samples = scans("g".repeat(6) + "b".repeat(12));
    const warnings = warningsIn(samples);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].toUtc).toBe(samples[samples.length - 1].atUtc);
  });

  it("reports both evidence paths when a warning spans the two", () => {
    const samples = [
      ...scans("b".repeat(12)),
      { atUtc: "2026-09-03T01:00:00Z", basis: "forecast" as const, suitability: "bad" as const },
      { atUtc: "2026-09-03T02:00:00Z", basis: "forecast" as const, suitability: "bad" as const },
    ];
    const warnings = warningsIn(samples);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].bases).toEqual(["observed", "forecast"]);
  });

  /**
   * A gap is missing evidence, not a continuation. Three hours of silence
   * between two bad scans must not be counted as three hours of bad sky.
   */
  it("does not carry persistence across a gap in the evidence", () => {
    const samples: CloudSample[] = [
      { atUtc: "2026-09-03T00:00:00Z", basis: "observed", suitability: "bad" },
      { atUtc: "2026-09-03T00:05:00Z", basis: "observed", suitability: "bad" },
      // Four hours later: the feed was down, and nobody saw the sky between.
      { atUtc: "2026-09-03T04:05:00Z", basis: "observed", suitability: "bad" },
      { atUtc: "2026-09-03T04:10:00Z", basis: "observed", suitability: "bad" },
    ];
    expect(warningsIn(samples)).toEqual([]);
  });

  it("finds two warnings either side of a real clearance", () => {
    const warnings = warningsIn(
      scans("b".repeat(12) + "g".repeat(24) + "b".repeat(12)),
    );
    expect(warnings).toHaveLength(2);
  });
});

describe("the window's verdict", () => {
  it("is unknown with nothing to go on", () => {
    expect(verdictOf([], [])).toBe("unknown");
  });

  it("is open when no warning stands", () => {
    const samples = series("gggggggg");
    expect(verdictOf(samples, warningsIn(samples))).toBe("open");
  });

  it("is intermittent when part of the window survives", () => {
    const samples = series("bbgggggg");
    expect(verdictOf(samples, warningsIn(samples))).toBe("intermittent");
  });

  it("is closed when almost none of it does", () => {
    const samples = series("bbbbbbgg");
    expect(verdictOf(samples, warningsIn(samples))).toBe("closed");
  });
});
