import { describe, expect, it } from "vitest";
import { compactName } from "./TrackerObservingRail";

/**
 * High-value card identity must not be produced by clipping prose.
 *
 * The review evidence for the previous pass showed `The Space Stati…` and
 * `The Moon, a waning gi…` on rail cards. Neither names anything: the first
 * could be a station, a state or a stationery shop, and the second has lost the
 * phase, which is the only part of it that changes. An ellipsis is a reasonable
 * last resort for descriptive prose and a poor way to identify a subject.
 */
describe("the name a closed card wears", () => {
  it("uses a supplied short name in preference to anything derived", () => {
    expect(compactName("The Space Station", "ISS")).toBe("ISS");
    expect(compactName("The Moon, a waning gibbous", "Waning Gibbous")).toBe("Waning Gibbous");
  });

  it("prefers the short name even when the title would survive the comma rule", () => {
    // The comma rule would give "The Moon", which is true every night of the
    // month and therefore identifies nothing.
    expect(compactName("The Moon, a waning gibbous", "Waning Gibbous")).not.toBe("The Moon");
  });

  /**
   * A short name has to actually be short.
   *
   * "Waning Gibbous Moon" was the first attempt at the Moon's and it still
   * clipped to "Waning Gibbou…" — a shorter way of producing the same defect.
   * The budget is roughly what a closed card renders without an ellipsis, and
   * "Starlink train" at fourteen characters is the known-good reference.
   */
  it("keeps supplied short names inside what a closed card can show", () => {
    const BUDGET = "Starlink train".length + 2;
    for (const short of [
      "ISS",
      "Starlink train",
      "Waning Gibbous",
      "Waxing Crescent",
      "New Moon",
      "Full Moon",
      "First Quarter",
    ]) {
      expect(compactName("some long descriptive title", short).length).toBeLessThanOrEqual(BUDGET);
    }
  });

  it("falls back to the qualifier rule when nothing is supplied", () => {
    expect(compactName("The Moon, a waning gibbous")).toBe("The Moon");
  });

  it("leaves a title that needs no shortening alone", () => {
    expect(compactName("Saturn")).toBe("Saturn");
    expect(compactName("Perseids")).toBe("Perseids");
  });

  it("ignores a blank short name rather than rendering an empty card", () => {
    expect(compactName("Saturn", "")).toBe("Saturn");
    expect(compactName("Saturn", "   ")).toBe("Saturn");
    expect(compactName("Saturn", null)).toBe("Saturn");
  });

  it("never introduces an ellipsis of its own", () => {
    for (const [title, short] of [
      ["The Space Station", "ISS"],
      ["The Moon, a waning gibbous", null],
      ["A very long descriptive title with no comma at all in it", null],
    ] as [string, string | null][]) {
      expect(compactName(title, short)).not.toMatch(/…|\.\.\./);
    }
  });
});
