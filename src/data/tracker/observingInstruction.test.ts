import { describe, expect, it } from "vitest";
import { cardinalAbbreviation, compassWords, observingInstruction } from "./observingInstruction";
import type { Opportunity } from "./opportunity";
import type { SkyPath } from "./skyPath";
import type { BestWindow } from "./conditions";
import type { PlaceClock } from "../../lib/localTime";

/**
 * "Where do I actually look?"
 *
 * A reader used Tracker during a real lunar eclipse. Tracker named the event
 * and timed it correctly, and then left them outside working out which part of
 * the sky to search — with the altitude and azimuth at every contact already
 * computed and sitting unused. These tests are the contract that the answer
 * exists, is derived from the geometry rather than written separately, and says
 * the same thing wherever it appears.
 */

const CLOCK: PlaceClock = { timeZone: "UTC", locale: "en-GB" };

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "saturn",
    kind: "planet",
    title: "Saturn",
    summary: "A quiet yellow point.",
    qualities: {
      observability: 0.8,
      spectacle: 0.5,
      recognisability: 0.7,
      ease: 0.7,
      confidence: 1,
      rarity: 0.05,
    },
    guidance: {
      appearance: "A steady point of light.",
      whenUtc: "2026-08-22T04:00:00Z",
      durationMinutes: 90,
      direction: "south-east",
      elevation: "About 45° up.",
      howLong: "A minute to find it.",
      equipment: "eyes",
      technique: null,
      safety: null,
    },
    phenomenon: "",
    tonight: "",
    missingInputs: [],
    limitations: [],
    profile: [],
    transparency: "low",
    ...overrides,
  };
}

function path(kind: SkyPath["kind"], points: SkyPath["points"]): SkyPath {
  return {
    kind,
    points,
    riseUtc: null,
    culminationUtc: null,
    setUtc: null,
    windowStartUtc: null,
    windowEndUtc: null,
  };
}

function window(startUtc: string, peakUtc: string, endUtc: string): BestWindow {
  return {
    startUtc,
    peakUtc,
    endUtc,
    brief: false,
    movedByWeather: false,
    viewability: {
      band: "good",
      access: 0.8,
      reading: { condition: "clear", label: "", phrase: "", smokeDominant: false },
      freshness: "current",
      evidenceStatus: "available",
      limitedBySky: false,
    },
  };
}

/** A target climbing from the east-south-east to due south across three hours. */
const CLIMBING = path("target", [
  { atUtc: "2026-08-22T02:00:00Z", altitudeDeg: 12, azimuthDeg: 110, relative: 0.4 },
  { atUtc: "2026-08-22T03:00:00Z", altitudeDeg: 28, azimuthDeg: 125, relative: 0.7 },
  { atUtc: "2026-08-22T04:00:00Z", altitudeDeg: 44, azimuthDeg: 150, relative: 1 },
  { atUtc: "2026-08-22T05:00:00Z", altitudeDeg: 47, azimuthDeg: 178, relative: 0.9 },
]);

describe("bearings, in both forms the interface needs", () => {
  it("names the octant in words and abbreviated", () => {
    expect(compassWords(0)).toBe("north");
    expect(compassWords(135)).toBe("south-east");
    expect(compassWords(225)).toBe("south-west");
    expect(cardinalAbbreviation(135)).toBe("SE");
    expect(cardinalAbbreviation(315)).toBe("NW");
  });

  it("wraps rather than falling off either end", () => {
    expect(compassWords(360)).toBe("north");
    expect(compassWords(-45)).toBe("north-west");
    expect(cardinalAbbreviation(359)).toBe("N");
  });
});

describe("a target you point at", () => {
  const instruction = observingInstruction(
    opportunity(),
    CLIMBING,
    window("2026-08-22T02:00:00Z", "2026-08-22T03:00:00Z", "2026-08-22T05:00:00Z"),
    CLOCK,
  );

  it("answers all three questions the reader has", () => {
    expect(instruction).not.toBeNull();
    expect(instruction!.compass).toBe("south-east");
    expect(instruction!.cardinal).toBe("SE");
    expect(instruction!.altitudeDeg).toBe(28);
    expect(instruction!.atUtc).toBe("2026-08-22T03:00:00Z");
  });

  it("reads the position at the recommended moment, not at the night's best", () => {
    // These are different numbers on any night whose best hour is clouded out,
    // and the whole point of moving the window is that the reader will not be
    // outside at the peak. Culmination here is 47° due south; the recommended
    // moment is 28° south-east.
    expect(instruction!.altitudeDeg).not.toBe(47);
    expect(instruction!.compass).not.toBe("south");
  });

  it("says the height as a movement as well as a number", () => {
    // Degrees are precise and mean nothing to somebody standing in a garden.
    // Both go in the sentence: the body movement first, the number after it.
    expect(instruction!.altitudeWords).toBe("about a third of the way up");
    expect(instruction!.sentence).toMatch(/about 28° up, about a third of the way up/);
  });

  it("names the time in the reader's own clock", () => {
    expect(instruction!.sentence).toMatch(/3:00\u202fAM|3:00 AM/);
  });

  it("says what it is doing while the reader is outside", () => {
    expect(instruction!.motion).toBe("rising");
  });

  it("says how the position changes across the window", () => {
    expect(instruction!.change).toMatch(/south/);
    expect(instruction!.change).toMatch(/47°/);
  });

  it("gives the dense form the hero metric needs", () => {
    expect(instruction!.metric).toBe("SE · 28°");
  });
});

describe("a target that is dropping", () => {
  const setting = path("target", [
    { atUtc: "2026-08-22T02:00:00Z", altitudeDeg: 40, azimuthDeg: 240, relative: 1 },
    { atUtc: "2026-08-22T03:00:00Z", altitudeDeg: 22, azimuthDeg: 255, relative: 0.6 },
    { atUtc: "2026-08-22T04:00:00Z", altitudeDeg: 6, azimuthDeg: 268, relative: 0.2 },
  ]);

  it("reports the motion the reader will see", () => {
    const instruction = observingInstruction(
      opportunity(),
      setting,
      window("2026-08-22T02:00:00Z", "2026-08-22T03:00:00Z", "2026-08-22T04:00:00Z"),
      CLOCK,
    );
    expect(instruction!.motion).toBe("setting");
    expect(instruction!.compass).toBe("west");
  });

  it("says to look low when it is low", () => {
    const instruction = observingInstruction(
      opportunity(),
      setting,
      window("2026-08-22T04:00:00Z", "2026-08-22T04:00:00Z", "2026-08-22T04:00:00Z"),
      CLOCK,
    );
    expect(instruction!.sentence).toMatch(/^Look low in the west/);
  });
});

describe("a meteor shower, which is not a thing you point at", () => {
  const radiant = path("radiant", [
    { atUtc: "2026-08-22T04:00:00Z", altitudeDeg: 55, azimuthDeg: 45, relative: 1 },
  ]);

  const instruction = observingInstruction(
    opportunity({ id: "meteors", kind: "meteors", title: "Perseids" }),
    radiant,
    window("2026-08-22T04:00:00Z", "2026-08-22T04:00:00Z", "2026-08-22T05:00:00Z"),
    CLOCK,
  );

  it("names where the radiant is, because that orients the reader", () => {
    expect(instruction!.sentence).toMatch(/radiant stands about 55° up in the north-east/);
  });

  it("tells the reader not to stare at it", () => {
    // The commonest mistake in meteor watching. Trails near the radiant are
    // head-on and almost pointlike, so a product that says "look north-east"
    // causes the mistake it should be preventing.
    expect(instruction!.sentence).toMatch(/do not stare at it/i);
    expect(instruction!.sentence).toMatch(/half the sky away/i);
  });

  it("does not offer a bearing as the metric, because there is none to face", () => {
    expect(instruction!.metric).toBe("Whole sky");
  });

  it("still answers when the radiant has not risen", () => {
    const below = path("radiant", [
      { atUtc: "2026-08-22T04:00:00Z", altitudeDeg: -8, azimuthDeg: 45, relative: 0.3 },
    ]);
    const result = observingInstruction(
      opportunity({ id: "meteors", kind: "meteors" }),
      below,
      null,
      CLOCK,
    );
    expect(result!.sentence).toMatch(/below the horizon/);
    expect(result!.compass).toBeNull();
  });
});

describe("the sporadic background, which has no direction at all", () => {
  it("says so rather than inventing one", () => {
    // A rate path carries zeroed coordinates because there is no position to
    // carry. Reading a bearing off them produced "face north, 0° up" — an
    // instruction to stare at the ground, assembled out of placeholders.
    const instruction = observingInstruction(
      opportunity({ id: "meteors", kind: "meteors" }),
      path("rate", [{ atUtc: "2026-08-22T04:00:00Z", altitudeDeg: 0, azimuthDeg: 0, relative: 1 }]),
      null,
      CLOCK,
    );
    expect(instruction!.compass).toBeNull();
    expect(instruction!.azimuthDeg).toBeNull();
    expect(instruction!.sentence).toMatch(/no direction to face/i);
    expect(instruction!.metric).toBe("Whole sky");
  });

  it("returns nothing for a non-meteor phenomenon with no path", () => {
    // Null is a real answer. Inventing a direction for something with no
    // geometry would be the same class of error as the flat line at 0°.
    expect(observingInstruction(opportunity(), null, null, CLOCK)).toBeNull();
  });
});

describe("a target below the horizon", () => {
  it("has no instruction, because there is nothing to look at", () => {
    const down = path("target", [
      { atUtc: "2026-08-22T04:00:00Z", altitudeDeg: -12, azimuthDeg: 300, relative: 0 },
    ]);
    expect(observingInstruction(opportunity(), down, null, CLOCK)).toBeNull();
  });
});
