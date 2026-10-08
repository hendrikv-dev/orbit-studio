import { describe, expect, it } from "vitest";
import {
  PHENOMENON_CATEGORIES,
  SELECTABLE_PHENOMENON_CATEGORIES,
  categoryForNotableKind,
} from "./phenomenonCategories";
import { EVENT_CATEGORIES } from "./eventCategories";

describe("Tracker phenomenon discovery foundation", () => {
  it("makes only implemented categories selectable", () => {
    expect(SELECTABLE_PHENOMENON_CATEGORIES.every((category) => category.support !== "not-yet")).toBe(true);
    expect(PHENOMENON_CATEGORIES.filter((category) => category.support === "not-yet").every((category) => !category.selectable)).toBe(true);
  });

  it("maps every notable event kind to a usable filter", () => {
    const mapped = ["eclipse", "shower-peak", "conjunction", "moon-phase", "opposition"].map(
      (kind) => categoryForNotableKind(kind as Parameters<typeof categoryForNotableKind>[0]),
    );
    expect(new Set(mapped)).toEqual(new Set(["eclipses", "meteors", "pairings", "moon", "planets"]));
  });

  /**
   * Satellite passes are partial, and the scope has to say what is missing.
   *
   * This test used to assert "not-yet", which was true while Tracker had no
   * pass prediction. It has one now — the Space Station from NASA's published
   * trajectory, and a Starlink train while SpaceX is publishing a stack for one
   * — and the honest claim is neither of the two extremes. What must never
   * appear here is "supported", which would imply the hundreds of other
   * naked-eye satellites Tracker deliberately does not offer.
   */
  it("offers satellite passes only as the partial support its sources provide", () => {
    const satellites = PHENOMENON_CATEGORIES.find((category) => category.id === "satellites");
    expect(satellites).toMatchObject({ support: "partial", selectable: true });
    expect(satellites?.scope).toMatch(/Space Station/i);
    expect(satellites?.scope).toMatch(/train/i);
  });

  it("offers aurora only as the partial support its sources actually provide", () => {
    const aurora = PHENOMENON_CATEGORIES.find((category) => category.id === "auroras");
    expect(aurora).toMatchObject({ support: "partial", selectable: true });
    // The scope string is the promise the interface makes about the horizon, so
    // it has to name the limit rather than describe the feature.
    expect(aurora?.scope).toMatch(/no long-range/i);
  });

  it("keys every selectable category to a real page definition", () => {
    for (const category of SELECTABLE_PHENOMENON_CATEGORIES) {
      expect(EVENT_CATEGORIES[category.id as keyof typeof EVENT_CATEGORIES]).toBeDefined();
    }
  });
});
