import { describe, expect, it } from "vitest";
import { experienceFor } from "../../components/tracker/TrackerExperience";
import showpieces from "../deep-sky/showpieces.json";
import manifest from "./heroImagery.json";
import { deepSkyOpportunities } from "./deepSky";
import { hasCataloguedImagery, heroImageryFor, TRACKER_IMAGERY } from "./imagery";

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

  /**
   * The defect: every deep-sky page showed one long exposure of the Milky Way
   * over Paranal, because `heroImageryFor` had no case for them. A photograph
   * of somewhere else, presented as the thing the reader is being sent out to
   * find, on the page whose whole job is to say what they are about to see.
   */
  it("shows a picture of the object itself on every deep-sky page it offers", () => {
    const objects = showpieces.objects.filter((object) => hasCataloguedImagery(object.id));
    expect(objects.length).toBeGreaterThan(20);

    const generic = heroImageryFor("none", "night-sky");
    for (const object of objects) {
      const imagery = heroImageryFor(`deep-sky-${object.id}`, "deep-sky");
      expect(imagery.src, object.id).not.toBe(generic.src);

      /**
       * The archive's own designation list has to name the object.
       *
       * Which is the assertion that matters: a picture is only a picture *of*
       * something if a source that is not this repository says so. The build
       * script refuses to download an image whose record does not name the
       * object; this checks what actually shipped still carries that record.
       */
      const record = manifest.images.find((image) => image.id === object.id);
      const flatten = (name: string) => name.toLowerCase().replace(/[\s.]+/g, "");
      const designations = [object.id];
      const messier = /^m(\d+)$/.exec(object.id);
      if (messier) designations.push(`m${messier[1]}`, `messier${messier[1]}`);
      const ngc = /^ngc0*(\d+)$/.exec(object.id);
      if (ngc) designations.push(`ngc${ngc[1]}`);
      expect(
        record?.archiveNames.some((name) => designations.includes(flatten(name))),
        `${object.id}: the archive files this picture as ${JSON.stringify(record?.archiveNames)}`,
      ).toBe(true);
    }
  });

  it("does not offer a deep-sky object it has no picture of", () => {
    const withoutImagery = showpieces.objects.filter((object) => !hasCataloguedImagery(object.id));
    for (const object of withoutImagery) {
      expect(
        deepSkyOpportunities(45.5, -122.7, {
          startUtc: "2027-01-15T02:00:00Z",
          endUtc: "2027-01-15T14:00:00Z",
        }).some((opportunity) => opportunity.id === `deep-sky-${object.id}`),
        `${object.id} has no picture and must not be offered`,
      ).toBe(false);
    }
  });

  it("illustrates Venus with Venus rather than with a twilight it happens to be in", () => {
    const venus = heroImageryFor("planet-venus", "planet");
    expect(venus.title.toLowerCase()).toContain("venus");
    expect(venus.src).not.toBe(heroImageryFor("none", "night-sky").src);
    // The Moon-and-Venus frame is a pairing, which is not the event.
    expect(venus.title.toLowerCase()).not.toContain("moon");
  });
});
