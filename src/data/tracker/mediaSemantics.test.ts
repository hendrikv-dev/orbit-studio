import { describe, expect, it } from "vitest";
import { experienceFor } from "../../components/tracker/TrackerExperience";
import { heroImageryFor, TRACKER_IMAGERY } from "./imagery";

describe("Tracker media semantics", () => {
  it("classifies every shipped still by claim, origin and expected view", () => {
    for (const image of TRACKER_IMAGERY) {
      expect(image.claim).toMatch(/^(representative|event-specific)$/);
      expect(image.origin).toMatch(/^(historical-capture|current-model)$/);
      expect(image.expectedMode).toMatch(/^(naked-eye|binoculars|telescope|long-exposure|processed)$/);
      expect(image.claim).not.toBe("live");
    }
  });

  it("describes the meteor clip as historical natural-speed footage, never a live view", () => {
    const media = experienceFor("meteors");
    expect(media).toMatchObject({
      claim: "representative",
      origin: "historical-capture",
      capturedAt: "2020-08-12",
      expectedMode: "naked-eye",
    });
    expect(media?.alt.toLowerCase()).not.toContain("real-time");
    expect(media?.alt.toLowerCase()).not.toContain("live");
  });

  it("uses a generic historical night sky for a quiet night instead of an unrelated conjunction", () => {
    const quiet = heroImageryFor("none", "night-sky");
    expect(quiet.title).toContain("dark sky");
    expect(quiet.title).not.toContain("Venus");
  });
});
