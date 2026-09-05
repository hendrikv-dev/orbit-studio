import { describe, expect, it } from "vitest";
import { moonShadowPath } from "./TrackerScene";

/**
 * The two sweep flags are the whole of the phase logic, and inverting either
 * one draws a Moon that is confidently the wrong shape. That shipped once: a
 * four-day-old crescent rendered as a gibbous, directly under a caption reading
 * "a waxing crescent".
 */
function flags(path: string): { darkSide: string; terminator: string } {
  const arcs = [...path.matchAll(/A [\d.]+,[\d.]+ 0 0 (\d)/g)].map((match) => match[1]);
  return { darkSide: arcs[0], terminator: arcs[1] };
}

describe("the Moon's phase", () => {
  it("puts the shadow on the left while waxing, and on the right while waning", () => {
    expect(flags(moonShadowPath(12, 0.18, false)).darkSide).toBe("0");
    expect(flags(moonShadowPath(12, 0.18, true)).darkSide).toBe("1");
  });

  it("bulges the terminator the opposite way for a crescent and a gibbous", () => {
    const waxingCrescent = flags(moonShadowPath(12, 0.18, false)).terminator;
    const waxingGibbous = flags(moonShadowPath(12, 0.82, false)).terminator;
    expect(waxingCrescent).not.toBe(waxingGibbous);
    const waningCrescent = flags(moonShadowPath(12, 0.18, true)).terminator;
    const waningGibbous = flags(moonShadowPath(12, 0.82, true)).terminator;
    expect(waningCrescent).not.toBe(waningGibbous);
  });

  it("narrows the terminator to nothing at quarter, and widens it towards new", () => {
    const width = (fraction: number) =>
      Number(/A ([\d.]+),12 0 0 \d 0,-12/.exec(moonShadowPath(12, fraction, false))![1]);
    expect(width(0.5)).toBeCloseTo(0, 3);
    expect(width(0.05)).toBeGreaterThan(width(0.3));
    expect(width(0.95)).toBeGreaterThan(width(0.7));
  });
});
