import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  trackerBackToMapValidation,
  trackerRailValidation,
  trackerReviewFixtures,
  trackerReviewScenario,
  trackerShellValidation,
  trackerUnselectedValidation,
} from "./tracker.mjs";

const scenarioFile = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "tracker.mjs"),
  "utf8",
);

/**
 * The scenario with its prose removed.
 *
 * The comments in that file describe the architecture this rewrite deleted, on
 * purpose — that is the record of why the assertions are gone. The guards below
 * are about what the scenario *reaches for*, so they read the code only.
 */
const scenarioSource = scenarioFile
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Tracker as the map-first product actually reports itself. */
function mapFirstState(overrides = {}) {
  return {
    shellPresent: true,
    mapState: "map",
    layersOpen: false,
    mapPresent: true,
    controls: {
      place: true,
      date: true,
      projection: true,
      eventFinder: true,
      layers: true,
      equipment: true,
    },
    pin: "45.515,-122.678",
    date: "2026-09-02",
    detailEvent: null,
    activeEvent: null,
    expandedCard: null,
    projection: "flat",
    equipment: "eyes",
    layers: [],
    placeLabel: "Portland",
    dateLabel: "Today · Sep 2, 2026",
    openSurface: null,
    placeSearchPresent: false,
    eventSearchPresent: false,
    railPresent: true,
    railCards: [
      { id: "planet-saturn", reason: "strong", expanded: false, name: "Saturn" },
      { id: "planet-mars", reason: "notable-circumstance", expanded: false, name: "Mars" },
      { id: "deep-sky-m45", reason: "routine", expanded: false, name: "Pleiades" },
      { id: "moon", reason: "routine", expanded: false, name: "Waning Gibbous" },
    ],
    ...overrides,
  };
}

describe("Tracker map-first shell validation", () => {
  it("accepts Tracker opening as a map with its controls over it", () => {
    expect(trackerShellValidation(mapFirstState())).toMatchObject({ pass: true, failures: [] });
  });

  /**
   * The regression this whole rewrite exists for. The state below has no
   * heading, hero, visualization, conditions row or ranked list, and no metric
   * or condition-card totals at all — which is what the map-first product
   * reports — and it must pass.
   */
  it("does not require any of the destination-page regions or counts", () => {
    const state = mapFirstState();
    expect(state).not.toHaveProperty("regions");
    expect(state).not.toHaveProperty("metricCount");
    expect(state).not.toHaveProperty("conditionCardCount");
    expect(trackerShellValidation(state).pass).toBe(true);
  });

  it("detects Tracker that is no longer map-first", () => {
    expect(trackerShellValidation(mapFirstState({ mapState: "detail" })).failures)
      .toContain("not-map-first:detail");
  });

  it("detects a missing map canvas and a missing control", () => {
    expect(trackerShellValidation(mapFirstState({ mapPresent: false })).failures)
      .toContain("map-canvas-missing");
    expect(
      trackerShellValidation(
        mapFirstState({ controls: { ...mapFirstState().controls, layers: false } }),
      ).failures,
    ).toContain("control-missing:layers");
  });
});

describe("Tracker unselected entry validation", () => {
  const entry = (overrides = {}) =>
    mapFirstState({
      pin: null,
      date: null,
      railPresent: false,
      railCards: [],
      placeLabel: "Choose where you are",
      ...overrides,
    });

  it("accepts a Tracker that has not been told where the reader is", () => {
    expect(trackerUnselectedValidation(entry())).toMatchObject({ pass: true, failures: [] });
  });

  /**
   * The failure that stalled Release validation: the old scenario reached for
   * the place search on load, and the search lives inside a popover that has
   * not been opened yet. Expecting it there is now itself a failure.
   */
  it("rejects expecting the place search before the trigger is opened", () => {
    expect(trackerUnselectedValidation(entry({ placeSearchPresent: true })).failures)
      .toContain("place-search-before-trigger-opened");
    expect(trackerUnselectedValidation({ ...entry(), placeSearchPresent: true }).failures)
      .toContain("place-search-before-trigger-opened");
  });

  it("rejects an observing rail before there is a location to rail about", () => {
    expect(trackerUnselectedValidation({ ...entry(), railPresent: true }).failures)
      .toContain("rail-before-location");
  });
});

describe("Tracker observing rail validation", () => {
  it("names the opportunities it expects rather than counting them", () => {
    const withAFifth = mapFirstState();
    withAFifth.railCards = [
      ...withAFifth.railCards,
      { id: "planet-jupiter", reason: "strong", expanded: false, name: "Jupiter" },
    ];
    expect(trackerRailValidation(withAFifth, trackerReviewFixtures.nakedEyeCards).pass).toBe(true);
  });

  it("detects a controlled opportunity that has stopped being offered", () => {
    const state = mapFirstState();
    state.railCards = state.railCards.filter((card) => card.id !== "moon");
    expect(trackerRailValidation(state, trackerReviewFixtures.nakedEyeCards).failures)
      .toContain("opportunity-missing:moon");
  });

  it("detects two cards expanded at once", () => {
    const state = mapFirstState({ expandedCard: "planet-saturn" });
    state.railCards[0].expanded = true;
    state.railCards[1].expanded = true;
    expect(trackerRailValidation(state, []).failures)
      .toContain("multiple-cards-expanded:planet-saturn+planet-mars");
  });

  it("detects a rail whose open card disagrees with Tracker's own state", () => {
    const state = mapFirstState({ expandedCard: "moon" });
    state.railCards[0].expanded = true;
    expect(trackerRailValidation(state, []).failures)
      .toContain("expanded-card-disagrees-with-url:planet-saturn!=moon");
  });
});

describe("Tracker back-to-map validation", () => {
  const before = (overrides = {}) => mapFirstState({ expandedCard: "planet-saturn", ...overrides });

  it("accepts a return that brings the reader back where they were", () => {
    expect(trackerBackToMapValidation(before(), before())).toMatchObject({ pass: true });
  });

  it("detects a return that lost the night, the place or the open card", () => {
    expect(trackerBackToMapValidation(before(), before({ date: "2026-09-09" })).failures)
      .toContain("date-not-restored:2026-09-02!=2026-09-09");
    expect(trackerBackToMapValidation(before(), before({ expandedCard: null })).failures)
      .toContain("expandedCard-not-restored:planet-saturn!=null");
  });

  it("detects a Back that never left the detail page", () => {
    expect(
      trackerBackToMapValidation(before(), before({ mapState: "detail", detailEvent: "planet-saturn" })).failures,
    ).toEqual(expect.arrayContaining(["did-not-return-to-map:detail", "detail-still-open:planet-saturn"]));
  });
});

describe("Tracker review determinism", () => {
  it("pins the instant every answer is a function of", () => {
    expect(trackerReviewFixtures.at.toISOString()).toBe("2026-09-03T05:00:00.000Z");
    expect(trackerReviewFixtures.night).toBe("2026-09-02");
    expect(trackerReviewFixtures.eventId).toBe("solar-eclipse-2027-08-02");
  });

  /**
   * A fixture that reads the wall clock passes today and fails at the turn of a
   * month. The scenario may not contain one.
   */
  it("takes nothing from the wall clock", () => {
    expect(scenarioSource).not.toMatch(/Date\.now\(\)/);
    expect(scenarioSource).not.toMatch(/new Date\(\s*\)/);
  });

  it("installs its clock and feeds before the first navigation", () => {
    expect(typeof trackerReviewScenario.prepare).toBe("function");
    expect(scenarioSource).toMatch(/prepare\(\{ context, page \}\)/);
    expect(scenarioSource).toMatch(/page\.clock\.setFixedTime\(REVIEW_AT\)/);
  });

  it("uses the shared Tracker fixtures rather than a second fixture system", () => {
    expect(scenarioSource).toMatch(/from "\.\.\/\.\.\/verify\/tracker-fixtures\.mjs"/);
  });
});

/**
 * The old scenario's vocabulary, kept out by name.
 *
 * These are the selectors and counts that certified the deleted
 * destination-page Tracker. A future edit that reaches for any of them is
 * reintroducing the architecture the redesign removed, and should fail here
 * rather than in a forty-five second timeout in CI.
 */
describe("Tracker review no longer certifies the destination-page architecture", () => {
  it.each([
    ["tk-tonight", /tk-tonight/],
    ["tk-hero", /tk-hero/],
    ["tk-conditions", /tk-conditions/],
    ["tk-relevant-list", /tk-relevant-list/],
    ["tk-page-heading", /tk-page-heading/],
    ["tk-viz-slot", /tk-viz-slot/],
    ["metricCount", /metricCount/],
    ["conditionCardCount", /conditionCardCount/],
    ["planIdentity", /planIdentity/],
    ["TrackerEntry", /TrackerEntry/],
    ["Upcoming tab", /getByRole\("button", \{ name: "Upcoming"/],
    ["Calendar tab", /name: "Calendar"/],
  ])("does not reach for %s", (_name, pattern) => {
    expect(scenarioSource).not.toMatch(pattern);
  });

  it("no longer claims the four-region universal page in its notes", () => {
    const notes = JSON.stringify(trackerReviewScenario.notes);
    expect(notes).not.toMatch(/four condition cards/i);
    expect(notes).not.toMatch(/universal event page/i);
    expect(notes).toMatch(/map-first/i);
  });
});
