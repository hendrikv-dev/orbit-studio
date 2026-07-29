import { describe, expect, it } from "vitest";
import {
  formatLocalSimulationTime,
  formatUtcSimulationTime,
  fromDateTimeLocalValue,
  normalizeSimulationTimeUtc,
  toDateTimeLocalValue,
} from "./format";

describe("simulation time display helpers", () => {
  it("round-trips local datetime input to the same UTC instant at minute precision", () => {
    const instantUtc = "2026-06-02T15:13:00.000Z";
    const localInput = toDateTimeLocalValue(instantUtc);
    const parsedUtc = fromDateTimeLocalValue(localInput);

    expect(parsedUtc).not.toBeNull();
    expect(Date.parse(parsedUtc ?? "")).toBe(Date.parse(instantUtc));
  });

  it("labels UTC display explicitly while local display represents the same instant", () => {
    const instantUtc = "2026-06-02T15:13:00.000Z";
    const local = formatLocalSimulationTime(instantUtc);
    const utc = formatUtcSimulationTime(instantUtc);

    expect(local).not.toBe("--");
    expect(utc).toContain("UTC");
    expect(normalizeSimulationTimeUtc(instantUtc)).toBe(instantUtc);
  });
});
