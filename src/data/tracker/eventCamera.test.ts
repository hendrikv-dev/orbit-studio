import { describe, expect, it } from "vitest";
import { cameraForEvent, nearestCopy } from "./eventCamera";
import { buildEventOverlay } from "./eventOverlay";
import { catalogue } from "./eventCatalogue";

const FROM = new Date("2026-09-01T00:00:00Z");
const TROUTDALE = { latitudeDeg: 45.54, longitudeDeg: -122.4 };
const LUXOR = { latitudeDeg: 25.687, longitudeDeg: 32.64 };

const overlayFor = (id: string) => buildEventOverlay(catalogue(FROM).find((e) => e.id === id)!)!;
const span = (target: ReturnType<typeof cameraForEvent>) =>
  target ? target.bounds.east - target.bounds.west : Number.NaN;

describe("choosing the nearest copy of the world", () => {
  it("crosses the antimeridian the short way", () => {
    // 170°E and 170°W are twenty degrees apart, not three hundred and forty.
    expect(nearestCopy(170, -170)).toBe(-190);
    expect(nearestCopy(-170, 170)).toBe(190);
  });

  it("leaves a longitude alone when it is already the nearest one", () => {
    expect(nearestCopy(10, 10)).toBe(10);
    expect(nearestCopy(-122, -120)).toBe(-122);
  });
});

describe("framing an event", () => {
  /**
   * The frame is the track, and it must not be a whole world.
   *
   * Wrapping each point to the copy nearest the *viewer* is the obvious thing
   * and is wrong: the 2027 track runs from Iberia to the Indian Ocean, and
   * seen from Oregon its eastern half lands 360° from its western half. The
   * first version of this produced a three-hundred-and-sixty-eight-degree
   * frame to hold a track that spans eighty.
   */
  it("holds a solar eclipse's track without spanning the planet", () => {
    const target = cameraForEvent(overlayFor("solar-eclipse-2027-08-02"), TROUTDALE, -122.4);
    expect(target).not.toBeNull();
    expect(span(target)).toBeLessThan(180);
    expect(span(target)).toBeGreaterThan(40);
  });

  it("frames the same track wherever the reader is standing", () => {
    const fromOregon = cameraForEvent(overlayFor("solar-eclipse-2027-08-02"), TROUTDALE, -122.4);
    const fromEgypt = cameraForEvent(overlayFor("solar-eclipse-2027-08-02"), LUXOR, 32.6);
    expect(fromEgypt!.bounds.west).toBeCloseTo(fromOregon!.bounds.west, 1);
    expect(fromEgypt!.bounds.east).toBeCloseTo(fromOregon!.bounds.east, 1);
  });

  /**
   * Reaching for a reader nine thousand kilometres away is worse than not.
   *
   * A frame that holds both Oregon and a track across North Africa is two
   * hundred degrees wide, in which neither is legible — it answers "where is
   * this eclipse" with "Earth".
   */
  it("leaves a distant reader out rather than framing a hemisphere", () => {
    const target = cameraForEvent(overlayFor("solar-eclipse-2027-08-02"), TROUTDALE, -122.4);
    expect(target!.bounds.west).toBeGreaterThan(-100);
  });

  it("keeps a reader who is standing in the path", () => {
    const target = cameraForEvent(overlayFor("solar-eclipse-2027-08-02"), LUXOR, 32.6);
    expect(target!.bounds.west).toBeLessThan(LUXOR.longitudeDeg);
    expect(target!.bounds.east).toBeGreaterThan(LUXOR.longitudeDeg);
    expect(target!.bounds.south).toBeLessThan(LUXOR.latitudeDeg);
    expect(target!.bounds.north).toBeGreaterThan(LUXOR.latitudeDeg);
  });

  /**
   * A lunar eclipse has nowhere to travel to.
   *
   * Either the Moon is up where you are or it is not, and the boundary is a
   * circle half the planet wide. Zooming to anything smaller implies a place
   * to be.
   */
  it("frames a lunar eclipse as the hemisphere it is", () => {
    const target = cameraForEvent(overlayFor("lunar-eclipse-2027-08-17"), TROUTDALE, -122.4);
    expect(span(target)).toBeGreaterThan(100);
    expect(target!.maxZoom).toBeLessThanOrEqual(3);
  });

  /**
   * A shower good everywhere is not a place to go.
   *
   * The Perseids at maximum are worth seeing from every longitude in the
   * northern mid-latitudes, so the region "worth going out in" circles the
   * Earth. Fitting that is a picture of the world with a wash over it, so the
   * frame becomes the reader's own share of the band.
   */
  it("frames a global shower around the reader", () => {
    const target = cameraForEvent(overlayFor("meteor-shower-PER-2027-08-12"), TROUTDALE, -122.4);
    expect(span(target)).toBeLessThan(60);
    expect(target!.bounds.west).toBeLessThan(TROUTDALE.longitudeDeg);
    expect(target!.bounds.east).toBeGreaterThan(TROUTDALE.longitudeDeg);
  });

  it("still frames a shower when nobody has chosen a place", () => {
    const target = cameraForEvent(overlayFor("meteor-shower-PER-2027-08-12"), null, 0);
    expect(target).not.toBeNull();
    expect(target!.maxZoom).toBeLessThan(4);
  });

  it("never asks for a latitude the projection cannot draw", () => {
    for (const id of [
      "solar-eclipse-2027-08-02",
      "lunar-eclipse-2027-08-17",
      "meteor-shower-PER-2027-08-12",
    ]) {
      const target = cameraForEvent(overlayFor(id), TROUTDALE, -122.4)!;
      expect(target.bounds.south).toBeGreaterThanOrEqual(-85);
      expect(target.bounds.north).toBeLessThanOrEqual(85);
      expect(target.bounds.north).toBeGreaterThan(target.bounds.south);
      expect(target.bounds.east).toBeGreaterThan(target.bounds.west);
    }
  });
});
