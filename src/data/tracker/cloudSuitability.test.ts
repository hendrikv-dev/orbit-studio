import { describe, expect, it } from "vitest";
import {
  CLEAR_RUN,
  RAISE_RUN,
  suitabilityOfCategory,
  suitabilityOfPercent,
  verdictOf,
  warningsIn,
  type CloudSample,
  type Suitability,
} from "./cloudSuitability";

/** A run of samples an hour apart, written as a suitability string. */
function series(letters: string, basis: "observed" | "forecast" = "observed"): CloudSample[] {
  const of: Record<string, Suitability> = { g: "good", f: "fair", p: "poor", b: "bad" };
  return [...letters].map((letter, index) => ({
    atUtc: `2026-09-03T${String(index).padStart(2, "0")}:00Z`,
    basis,
    suitability: of[letter],
  }));
}

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

describe("warnings", () => {
  it("says nothing about a clear night", () => {
    expect(warningsIn(series("gggggggg"))).toEqual([]);
  });

  it("ignores a single cloudy frame between clear ones", () => {
    expect(warningsIn(series("gggbgggg"))).toEqual([]);
  });

  it("raises once cloud persists", () => {
    const warnings = warningsIn(series("ggbbgggg"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fromUtc).toBe("2026-09-03T02:00Z");
    expect(warnings[0].severity).toBe("bad");
  });

  it("dates the end of a warning at the first clear frame, not at the third", () => {
    // Cloud at 02–03, clear from 04. The warning must end at 03, because the
    // sky opened at 04 even though it took until 06 to be sure of it.
    const warnings = warningsIn(series("ggbbgggg"));
    expect(warnings[0].toUtc).toBe("2026-09-03T03:00Z");
  });

  it("does not stand down on a single gap", () => {
    const warnings = warningsIn(series("bbbgbbbb"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fromUtc).toBe("2026-09-03T00:00Z");
    expect(warnings[0].toUtc).toBe("2026-09-03T07:00Z");
  });

  it("takes more evidence to relent than to warn", () => {
    expect(CLEAR_RUN).toBeGreaterThan(RAISE_RUN);
  });

  it("closes an open warning at the end of the window", () => {
    const warnings = warningsIn(series("ggggggbb"));
    expect(warnings[0].toUtc).toBe("2026-09-03T07:00Z");
  });

  it("reports both evidence paths when a warning spans the two", () => {
    const samples = [...series("ggggpp"), ...series("bb", "forecast").map((sample, index) => ({
      ...sample,
      atUtc: `2026-09-03T${String(6 + index).padStart(2, "0")}:00Z`,
    }))];
    const warnings = warningsIn(samples);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].bases).toEqual(["observed", "forecast"]);
    expect(warnings[0].severity).toBe("bad");
  });

  it("finds two warnings either side of a real clearance", () => {
    const warnings = warningsIn(series("bbggggbb"));
    expect(warnings).toHaveLength(2);
    expect(warnings[0].toUtc).toBe("2026-09-03T01:00Z");
    expect(warnings[1].fromUtc).toBe("2026-09-03T06:00Z");
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
