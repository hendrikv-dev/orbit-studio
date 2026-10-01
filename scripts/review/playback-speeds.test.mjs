import { describe, expect, it } from "vitest";
import { MAX_SPEED, SPEED_ANCHORS } from "../../src/components/PlaybackSpeedSlider.tsx";
import {
  reviewPlaybackSpeedLabel,
  reviewPlaybackSpeeds,
  reviewPlaybackTimeScales,
} from "./playback-speeds.mjs";

describe("review playback speeds", () => {
  it("samples exactly the speeds the Explorer slider offers", () => {
    expect(reviewPlaybackSpeeds.map((speed) => reviewPlaybackTimeScales[speed]))
      .toEqual([...SPEED_ANCHORS]);
  });

  it("drives the slider to its ceiling at max", () => {
    expect(reviewPlaybackTimeScales.max).toBe(MAX_SPEED);
  });

  // The Explorer builds its speed readout with toLocaleString, so every scale at or above a
  // thousand carries a group separator. Hand-written labels missed that and left the review
  // harness waiting 45 seconds for "1000×" while the application displayed "1,000×".
  it("renders labels the way the Explorer does, separators included", () => {
    expect(reviewPlaybackSpeedLabel(1)).toBe("1×");
    expect(reviewPlaybackSpeedLabel(100)).toBe("100×");
    expect(reviewPlaybackSpeedLabel(1_000)).toBe("1,000×");
    expect(reviewPlaybackSpeedLabel(3_000)).toBe("3,000×");
  });
});
