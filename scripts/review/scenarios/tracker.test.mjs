import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NO_DATA_BODIES,
  CLOUDY_COVER_FORECAST,
  CLOUDY_WEATHER_FORECAST,
  trackerBackToMapValidation,
  trackerCloudUncertaintyValidation,
  trackerLocationRoundTripValidation,
  trackerRecoveryValidation,
  trackerRailLegValidation,
  trackerRailValidation,
  trackerReviewFixtures,
  trackerReviewScenario,
  trackerShellValidation,
  trackerUpcomingValidation,
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
/**
 * Comment lines removed, code lines kept whole.
 *
 * Deliberately line-based. A regex that hunts for block-comment openers also
 * finds the one inside a route glob such as a doubled-star wildcard before
 * "api.weather.gov", and then eats every line up to the next closer — which
 * silently deletes the code these guards are supposed to be reading, and makes
 * them pass by finding nothing at all.
 */
function stripComments(text) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

const scenarioSource = stripComments(scenarioFile);

/** Tracker as the map-first product actually reports itself. */
function mapFirstState(overrides = {}) {
  return {
    shellPresent: true,
    mapState: "map",
    layersOpen: false,
    mapPresent: true,
    controls: {
      modes: true,
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
    recommendationSurfacePresent: true,
    railPresent: true,
    railCards: [
      { id: "planet-saturn", reason: "strong", expanded: false, name: "Saturn" },
      { id: "planet-mars", reason: "notable-circumstance", expanded: false, name: "Mars" },
      { id: "deep-sky-m45", reason: "routine", expanded: false, name: "Pleiades" },
      { id: "moon", reason: "routine", expanded: false, name: "Waning Gibbous" },
      { id: "upcoming", reason: "gateway", expanded: false, name: "Upcoming" },
    ],
    recoveryReason: null,
    recoveryKind: null,
    recoveryDate: null,
    recoveryTarget: null,
    recoveryObserver: null,
    recoveryPlanningKey: null,
    recoveryText: null,
    reminderPresent: false,
    cloudWarning: null,
    expandedConditions: [],
    upcomingOpen: false,
    upcomingPlanningState: null,
    upcomingObserver: null,
    upcomingPlanObserver: null,
    upcomingRange: null,
    upcomingEvents: [],
    observer: "45.5152,-122.6784",
    planKey: "plan|45.515200|-122.678400|2026-09-02",
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
      .toContain("not-primary-mode:detail");
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

describe("Tracker Tonight briefing validation", () => {
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

  it("requires the Upcoming gateway without fixing the number of sky cards", () => {
    const state = mapFirstState();
    state.railCards = state.railCards.filter((card) => card.id !== "upcoming");
    expect(trackerRailValidation(state, trackerReviewFixtures.nakedEyeCards).failures)
      .toContain("upcoming-gateway-missing");
  });

  it("detects a missing recommendation surface", () => {
    expect(
      trackerRailValidation(mapFirstState({ recommendationSurfacePresent: false }), []).failures,
    ).toContain("recommendation-surface-missing");
  });
});

describe("Tracker cloudy-night recovery validation", () => {
  const recovery = (overrides = {}) =>
    mapFirstState({
      railCards: [
        { id: "next-best-chance", reason: null, expanded: false, name: "Saturn" },
        { id: "recovery-summary", reason: null, expanded: false, name: "Clouded out tonight" },
        { id: "upcoming", reason: "gateway", expanded: false, name: "Upcoming" },
      ],
      recoveryReason: "cloud",
      recoveryKind: "chance",
      recoveryDate: trackerReviewFixtures.nextNight,
      recoveryTarget: "planet-saturn",
      recoveryObserver: "45.5152,-122.6784",
      recoveryPlanningKey: "planning|45.515200|-122.678400|30",
      recoveryText: "Next best chance Saturn Tomorrow · 10:40 PM · Clouded out tonight 4 worthwhile targets are blocked by cloud.",
      reminderPresent: true,
      railCardIdentities: ["next-best-chance", "recovery-summary", "upcoming"],
      ...overrides,
    });

  it("accepts an honest miss followed by a forecast-backed next chance", () => {
    expect(
      trackerRecoveryValidation(recovery(), trackerReviewFixtures.nextNight),
    ).toMatchObject({ pass: true, failures: [] });
  });

  it("rejects a mobile recovery rail that makes the negative context primary", () => {
    const negativeFirst = recovery();
    negativeFirst.railCards = [
      negativeFirst.railCards[1],
      negativeFirst.railCards[0],
      negativeFirst.railCards[2],
    ];
    negativeFirst.railCardIdentities = negativeFirst.railCards.map((card) => card.id);
    expect(
      trackerRecoveryValidation(negativeFirst, trackerReviewFixtures.nextNight).failures,
    ).toContain("recovery-future-not-first:recovery-summary!=next-best-chance");
  });

  it("rejects a clouded target that leaks back into recommendations", () => {
    const stale = recovery();
    stale.railCards.splice(2, 0, {
      id: "planet-mars", reason: "routine", expanded: false, name: "Mars",
    });
    expect(
      trackerRecoveryValidation(stale, trackerReviewFixtures.nextNight).failures,
    ).toContain("clouded-targets-still-offered:planet-mars");
  });

  it("rejects a stale date, missing reminder, or missing Upcoming gateway", () => {
    const broken = recovery({
      recoveryDate: trackerReviewFixtures.night,
      reminderPresent: false,
    });
    broken.railCards = broken.railCards.filter((card) => card.id !== "upcoming");
    expect(
      trackerRecoveryValidation(broken, trackerReviewFixtures.nextNight).failures,
    ).toEqual(expect.arrayContaining([
      `recovery-date:${trackerReviewFixtures.night}!=${trackerReviewFixtures.nextNight}`,
      "recovery-reminder-missing",
      "upcoming-gateway-missing",
    ]));
  });

  it("accepts the authoritative Upcoming fallback without requiring a reminder", () => {
    const upcoming = recovery({
      railCards: [
        { id: "recovery-upcoming", reason: null, expanded: false, name: "Orionids peak" },
        { id: "recovery-summary", reason: null, expanded: false, name: "Clouded out tonight" },
        { id: "upcoming", reason: "gateway", expanded: false, name: "Upcoming" },
      ],
      railCardIdentities: ["recovery-upcoming", "recovery-summary", "upcoming"],
      recoveryKind: "upcoming",
      recoveryDate: "2026-09-21",
      recoveryTarget: "2026-09-21:meteor-shower-ORI",
      recoveryText: "Clouded out tonight 4 worthwhile targets are blocked by cloud. Nothing worthwhile in the next 7 nights · Next notable event Orionids peak",
      reminderPresent: false,
    });
    expect(
      trackerRecoveryValidation(upcoming, { kind: "upcoming" }),
    ).toMatchObject({ pass: true, failures: [] });
  });

  it("accepts a location transition only after the previous chance is withdrawn", () => {
    const loading = recovery({
      railCards: [
        { id: "recovery-loading", reason: null, expanded: false, name: null },
        { id: "recovery-summary", reason: null, expanded: false, name: "Clouded out tonight" },
        { id: "upcoming", reason: "gateway", expanded: false, name: "Upcoming" },
      ],
      railCardIdentities: ["recovery-loading", "recovery-summary", "upcoming"],
      recoveryKind: "loading",
      recoveryDate: null,
      recoveryTarget: null,
      recoveryText: "Clouded out tonight 4 worthwhile targets are blocked by cloud. Finding the next forecast window…",
      reminderPresent: false,
    });
    expect(
      trackerRecoveryValidation(loading, { kind: "loading" }),
    ).toMatchObject({ pass: true, failures: [] });
  });

  it("uses an overcast selected night and a clear following night", () => {
    const samples = CLOUDY_WEATHER_FORECAST.properties.timeseries;
    expect(samples[5].data.instant.details.cloud_area_fraction).toBe(96);
    expect(samples[29].data.instant.details.cloud_area_fraction).toBe(4);
    expect(CLOUDY_COVER_FORECAST.hourly.cloud_cover).toEqual(
      expect.arrayContaining([96]),
    );
  });
});

describe("Tracker cloudy-forecast uncertainty validation", () => {
  const cloudy = (overrides = {}) =>
    mapFirstState({
      expandedCard: "planet-saturn",
      railCards: mapFirstState().railCards.map((card) => ({
        ...card,
        expanded: card.id === "planet-saturn",
      })),
      cloudWarning:
        "Cloud is forecast across the area, but this is not direction-specific. Clear gaps may still make this target worth checking.",
      expandedConditions: ["Cloud outlookMay interfere", "Moonlight65%"],
      ...overrides,
    });

  it("accepts a cloudy forecast that cautions without erasing bright targets", () => {
    expect(
      trackerCloudUncertaintyValidation(cloudy(), ["planet-saturn", "moon"]),
    ).toMatchObject({ pass: true, failures: [] });
  });

  it("rejects a false empty state caused by coarse cloud", () => {
    const empty = cloudy({
      recoveryReason: "cloud",
      railCards: [
        { id: "recovery-summary", reason: null, expanded: false, name: "Clouded out tonight" },
        { id: "upcoming", reason: "gateway", expanded: false, name: "Upcoming" },
      ],
    });
    expect(
      trackerCloudUncertaintyValidation(empty, ["planet-saturn", "moon"]).failures,
    ).toEqual(expect.arrayContaining([
      "false-empty-recovery:cloud",
      "opportunity-missing:planet-saturn",
      "opportunity-missing:moon",
    ]));
  });

  it("rejects warning copy that pretends the forecast is directional", () => {
    expect(
      trackerCloudUncertaintyValidation(
        cloudy({ cloudWarning: "The target is blocked." }),
        ["planet-saturn", "moon"],
      ).failures,
    ).toEqual(expect.arrayContaining([
      "cloud-warning-overclaims:The target is blocked.",
      "cloud-warning-omits-gaps:The target is blocked.",
    ]));
  });

  it("requires the concise warning on the lead recommendation", () => {
    expect(
      trackerCloudUncertaintyValidation(cloudy({ cloudWarning: null }), ["planet-saturn", "moon"]).failures,
    ).toContain("cloud-uncertainty-warning-missing");
  });
});

describe("Tracker Upcoming validation", () => {
  const ready = (overrides = {}) =>
    mapFirstState({
      observer: "45.5152,-122.6784",
      upcomingOpen: true,
      upcomingPlanningState: "ready",
      upcomingObserver: "45.5152,-122.6784",
      upcomingPlanObserver: "45.5152,-122.6784",
      upcomingRange: "30-days",
      upcomingEvents: [{ id: "notable:moon", title: "Full Moon" }],
      ...overrides,
    });

  it("accepts a ready list planned for the shell's current observer", () => {
    expect(trackerUpcomingValidation(ready())).toMatchObject({ pass: true, failures: [] });
  });

  it("rejects a stale plan and a fabricated sporadic-meteor peak", () => {
    expect(
      trackerUpcomingValidation(
        ready({
          upcomingPlanObserver: "38.9,-77.03",
          upcomingEvents: [{ id: "notable:meteors", title: "Meteors" }],
        }),
      ).failures,
    ).toEqual(expect.arrayContaining(["upcoming-plan-observer:38.9,-77.03!=45.5152,-122.6784", "sporadic-meteors-promoted"]));
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

describe("Tracker rail leg validation", () => {
  const leg = () => ({ offered: ["planet-mars"], withheld: ["deep-sky-m31"] });
  const greenbelt = () =>
    mapFirstState({
      pin: "38.996,-76.876",
      observer: "38.996,-76.876",
      planKey: "plan|38.996000|-76.876000",
      railCards: [
        { id: "planet-saturn", reason: "strong", expanded: false, name: "Saturn" },
        { id: "planet-mars", reason: "notable-circumstance", expanded: false, name: "Mars" },
      ],
    });

  it("accepts a rail that offers what the place offers and withholds what it withholds", () => {
    expect(trackerRailLegValidation(greenbelt(), leg())).toMatchObject({ pass: true, failures: [] });
  });

  it("detects a leg missing its expected opportunity", () => {
    const withoutMars = greenbelt();
    withoutMars.railCards = withoutMars.railCards.filter((card) => card.id !== "planet-mars");
    expect(trackerRailLegValidation(withoutMars, leg()).failures)
      .toContain("opportunity-missing:planet-mars");
  });

  it("detects a leg still offering what the place withholds", () => {
    const withM31 = greenbelt();
    withM31.railCards = withM31.railCards.concat({
      id: "deep-sky-m31", reason: "routine", expanded: false, name: "Andromeda",
    });
    expect(trackerRailLegValidation(withM31, leg()).failures)
      .toContain("opportunity-still-offered:deep-sky-m31");
  });

  it("detects a leg whose rail never arrived", () => {
    expect(
      trackerRailLegValidation(mapFirstState({ railPresent: false, railCards: [] }), leg()).failures,
    ).toContain("rail-missing");
  });
});

describe("Tracker location round-trip validation", () => {
  /**
   * The reported fault this guards: objects admitted at the second place were
   * still being offered after the reader returned to the first.
   */
  const before = (overrides = {}) =>
    mapFirstState({
      pin: "38.996,-76.876",
      observer: "38.996,-76.876",
      planKey: "plan|38.996000|-76.876000",
      railCards: [
        { id: "planet-saturn", reason: "strong", expanded: false, name: "Saturn" },
        { id: "planet-mars", reason: "notable-circumstance", expanded: false, name: "Mars" },
      ],
      ...overrides,
    });
  const moved = () =>
    before({
      pin: "38.900,-77.030",
      observer: "38.9,-77.03",
      planKey: "plan|38.900000|-77.030000",
      railCards: [
        { id: "planet-saturn", reason: "strong", expanded: false, name: "Saturn" },
        { id: "deep-sky-m31", reason: "routine", expanded: false, name: "Andromeda" },
      ],
    });

  it("accepts a round trip that restores the first place in every derived value", () => {
    expect(trackerLocationRoundTripValidation(before(), moved(), before())).toMatchObject({
      pass: true,
      failures: [],
    });
  });

  it("detects the moved place's extra object surviving the return", () => {
    const stale = before({ railCards: before().railCards.concat(moved().railCards[1]) });
    expect(trackerLocationRoundTripValidation(before(), moved(), stale).failures)
      .toContain("moved-place-opportunity-remained:deep-sky-m31");
  });

  it("detects a return that kept another place's observer or plan", () => {
    expect(trackerLocationRoundTripValidation(before(), moved(), moved()).failures)
      .toEqual(expect.arrayContaining([
        "pin-not-restored:38.900,-77.030!=38.996,-76.876",
        "observer-not-restored:38.9,-77.03!=38.996,-76.876",
        `plan-not-restored:${moved().planKey}!=${before().planKey}`,
      ]));
  });

  it("detects a move that never re-answered anything", () => {
    expect(trackerLocationRoundTripValidation(before(), before(), before()).failures)
      .toEqual(expect.arrayContaining(["observer-did-not-move", "plan-did-not-move"]));
  });

  it("detects a return that dropped an object the first place offered", () => {
    const diminished = before({ railCards: [before().railCards[0]] });
    expect(trackerLocationRoundTripValidation(before(), moved(), diminished).failures)
      .toContain("opportunity-not-restored:planet-mars");
  });

  it("pins the fixture legs to rails the fixtures can actually produce", () => {
    const legs = trackerReviewFixtures.locationLegRail;
    for (const offered of legs.greenbelt.offered) {
      expect(legs.washington.offered).not.toContain(offered);
    }
    for (const leg of Object.values(legs)) {
      for (const id of leg.offered) {
        expect(leg.withheld).not.toContain(id);
      }
    }
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
    ["metricCount", /metricCount/],
    ["conditionCardCount", /conditionCardCount/],
    ["planIdentity", /planIdentity/],
    ["TrackerEntry", /TrackerEntry/],
    ["Upcoming tab", /getByRole\("button", \{ name: "Upcoming"/],
    ["Calendar tab", /name: "Calendar"/],
  ])("does not reach for %s", (_name, pattern) => {
    expect(scenarioSource).not.toMatch(pattern);
  });

  /**
   * The guard above can only mean something if it is reading the scenario. An
   * over-eager comment stripper once removed most of the file, which would have
   * made every "does not reach for" assertion pass by finding nothing.
   */
  it("is reading the real scenario, not an emptied copy", () => {
    expect(scenarioSource).toMatch(/readTrackerMapState/);
    expect(scenarioSource).toMatch(/captureSurface\("tracker-map-entry"/);
    expect(scenarioSource.length).toBeGreaterThan(4_000);
  });

  it("no longer claims the four-region universal page in its notes", () => {
    const notes = JSON.stringify(trackerReviewScenario.notes);
    expect(notes).not.toMatch(/four condition cards/i);
    expect(notes).not.toMatch(/universal event page/i);
    expect(notes).toMatch(/map-first/i);
  });
});

describe("Tracker capability-aware production review coverage", () => {
  it.each([
    "tracker-map-2d",
    "tracker-map-3d-terrain",
    "tracker-tonight-normal",
    "tracker-object-detail-collapsed",
    "tracker-object-detail-expanded",
    "tracker-phone-map-2d",
    "tracker-phone-map-3d",
    "tracker-phone-tonight",
    "tracker-phone-object-detail-collapsed",
    "tracker-phone-sky",
    "tracker-tablet-map-3d",
    "tracker-tablet-tonight",
    "tracker-tablet-sky",
    "tracker-tablet-landscape-live-finder",
    "tracker-unsupported-tablet-no-sky",
  ])("captures %s", (name) => {
    expect(scenarioSource).toContain(`captureSurface("${name}"`);
  });

  it("proves the Finder launch without a redundant start control", () => {
    expect(scenarioSource).not.toMatch(/getByRole\("button", \{ name: "Start live guidance"/);
    expect(scenarioSource).toMatch(/finderGuidanceControlPresent/);
    expect(scenarioSource).toMatch(/finderPermissionAttempts\.includes\("orientation"\)/);
  });

  it("proves real terrain rather than certifying a renamed globe", () => {
    expect(scenarioSource).toMatch(/getTerrain/);
    expect(scenarioSource).toMatch(/tracker-terrain-3d-dem/);
    expect(scenarioSource).toMatch(/pitch < 55/);
    expect(scenarioSource).not.toMatch(/tracker-projection-globe/);
    expect(scenarioSource).not.toMatch(/name: \/Globe/);
  });
});

/**
 * The unavailable-data fixtures.
 *
 * These replaced six blanket 503s. A refused subresource is written to the
 * browser console before any application code sees it, so refusing every
 * environmental service put 27 console errors into a release package that is
 * required to contain none — none of which described anything wrong with the
 * product, because the adapters were already handling each one silently.
 *
 * Answering instead is only safe while the answers stay empty. A body that
 * carries a reading would turn "we could not find out" into "we found out, and
 * it is nothing", which is the one thing this product must never do.
 */
describe("Tracker review unavailable-data fixtures", () => {
  const bodyFor = (pattern) => NO_DATA_BODIES.find(([glob]) => glob === pattern)?.[1];

  it("answers every refused service rather than failing the request", () => {
    expect(NO_DATA_BODIES.length).toBeGreaterThanOrEqual(6);
    for (const [pattern, body] of NO_DATA_BODIES) {
      expect(typeof pattern).toBe("string");
      expect(body).toBeDefined();
      expect(() => JSON.stringify(body)).not.toThrow();
    }
  });

  /**
   * The measurement fields each adapter would read. None may be present: an
   * aurora grid of zeroes, a Kp of 0, a cloud cover of 0% or a sea-level
   * elevation are all claims about tonight.
   */
  it("carries no reading any adapter could mistake for a measurement", () => {
    const readings = [
      "kp", "kp_index", "estimated_kp", "cloud_cover", "cloudCover", "pm2_5",
      "aerosol_optical_depth", "temperature", "elevation", "properties", "timeseries",
    ];
    /**
     * The fields that describe a service rather than a sky.
     *
     * A TileJSON has to declare its own zoom range to be a TileJSON at all, and
     * those numbers say what the endpoint would serve if it served anything.
     * Everything outside this list is a quantity about tonight, which is what
     * an unavailable service must not supply.
     */
    const structural = new Set(["tilejson", "minzoom", "maxzoom"]);
    for (const [pattern, body] of NO_DATA_BODIES) {
      const serialised = JSON.stringify(body);
      for (const reading of readings) {
        expect(serialised, `${pattern} carries ${reading}`).not.toContain(`"${reading}"`);
      }
      for (const [key, value] of Object.entries(body ?? {})) {
        if (structural.has(key)) continue;
        expect(
          Array.isArray(value) ? value.length : value,
          `${pattern} carries a value under ${key}`,
        ).toEqual(Array.isArray(value) ? 0 : expect.anything());
        expect(typeof value, `${pattern} carries a number under ${key}`).not.toBe("number");
      }
    }
  });

  it("gives the aurora nowcast a grid with no coordinates", () => {
    const ovation = bodyFor("**/services.swpc.noaa.gov/json/ovation_aurora_latest.json*");
    expect(ovation).toEqual({ coordinates: [] });
  });

  it("gives the K-index products no samples at all", () => {
    expect(bodyFor("**/services.swpc.noaa.gov/**")).toEqual([]);
  });

  /**
   * Registered last so it wins: Playwright matches the most recently registered
   * route first, so listing the narrow OVATION pattern before the broad SWPC one
   * would silently hand the nowcast an array and lose the intent of both bodies.
   */
  it("registers the narrow aurora route after the broad one", () => {
    const broad = NO_DATA_BODIES.findIndex(([p]) => p === "**/services.swpc.noaa.gov/**");
    const narrow = NO_DATA_BODIES.findIndex(([p]) => p.includes("ovation_aurora_latest"));
    expect(broad).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(broad);
  });

  /**
   * A DEM that decodes would flatten Oregon to sea level and read as terrain
   * rather than as missing terrain, so the service publishes no tiles instead.
   */
  it("publishes a terrain source with no tiles rather than a flat one", () => {
    const terrain = bodyFor("**/tiles.mapterhorn.com/**");
    expect(terrain.tiles).toEqual([]);
    expect(terrain.tilejson).toBe("2.2.0");
  });

  it("asks for the console-clean satellite transport", () => {
    expect(scenarioSource).toMatch(/unavailable:\s*"empty"/);
  });

  it("no longer refuses anything with a status code", () => {
    expect(scenarioSource).not.toMatch(/status:\s*503/);
  });
});

/**
 * Tracker states carry no catalog identity, and say so.
 *
 * The declaration is what obliges them to stay empty of Explorer's catalog
 * metadata. Removing it would not relax the release rule — it would fail the
 * package, because a state that declares nothing is rejected outright.
 */
describe("Tracker review catalog authority", () => {
  it("declares that it never certifies the current satellite catalog", () => {
    expect(trackerReviewScenario.catalogAuthority).toBe("none");
  });
});
