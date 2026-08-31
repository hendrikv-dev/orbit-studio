import { describe, expect, it } from "vitest";

import { describeMarkers, markersForRange } from "./calendarMarkers";

/**
 * The marks exist to answer "is there an eclipse this month". These check that
 * they land on real, independently known dates rather than merely appearing.
 */
describe("markersForRange", () => {
  it("marks the 2 August 2027 total solar eclipse", () => {
    const marks = markersForRange("2027-08-01", "2027-08-31", "UTC");
    expect(marks.get("2027-08-02")).toContain("solar-eclipse");
  });

  it("marks the Perseid peak in August", () => {
    const marks = markersForRange("2027-08-01", "2027-08-31", "UTC");
    const peaks = [...marks.entries()].filter(([, kinds]) => kinds.includes("meteor-shower"));
    expect(peaks.length).toBeGreaterThan(0);
    // The Perseids peak on 12–13 August every year.
    expect(peaks.some(([date]) => date >= "2027-08-11" && date <= "2027-08-14")).toBe(true);
  });

  it("finds a lunar eclipse in a month that has one", () => {
    // 20 February 2027, penumbral.
    const marks = markersForRange("2027-02-01", "2027-02-28", "UTC");
    expect(marks.get("2027-02-20")).toContain("lunar-eclipse");
  });

  it("leaves ordinary days unmarked", () => {
    const marks = markersForRange("2027-08-01", "2027-08-31", "UTC");
    // A quiet stretch with no eclipse and no shower peak.
    for (const day of ["2027-08-05", "2027-08-08", "2027-08-25"]) {
      expect(marks.has(day)).toBe(false);
    }
  });

  it("includes an event on the range's own first day", () => {
    const marks = markersForRange("2027-08-02", "2027-08-31", "UTC");
    expect(marks.get("2027-08-02")).toContain("solar-eclipse");
  });

  it("never returns a day outside the range", () => {
    const marks = markersForRange("2027-08-10", "2027-08-20", "UTC");
    for (const date of marks.keys()) {
      expect(date >= "2027-08-10" && date <= "2027-08-20").toBe(true);
    }
  });

  it("orders a day's kinds consistently", () => {
    const marks = markersForRange("2027-01-01", "2028-12-31", "UTC");
    for (const kinds of marks.values()) {
      const order = ["solar-eclipse", "lunar-eclipse", "meteor-shower"];
      const indices = kinds.map((k) => order.indexOf(k));
      expect([...indices].sort((a, b) => a - b)).toEqual(indices);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });
});

describe("describeMarkers", () => {
  it("reads a day's marks as a sentence fragment", () => {
    expect(describeMarkers([])).toBe("");
    expect(describeMarkers(["solar-eclipse"])).toBe("solar eclipse");
    expect(describeMarkers(["lunar-eclipse", "meteor-shower"])).toBe(
      "lunar eclipse and meteor shower peak",
    );
  });
});
