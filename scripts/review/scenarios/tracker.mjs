import { PORTLAND, TRACKER_FIXTURE_AT, stubTracker } from "../../verify/tracker-fixtures.mjs";

/**
 * Tracker's deterministic review, against the map-first product.
 *
 * The scenario this replaced certified a destination-page Tracker: a heading, a
 * hero, a visualization slot, exactly four condition cards and a ranked list,
 * reached through an entry screen. The map-first redesign removed that
 * architecture deliberately — `TrackerEntry` is no longer rendered, and the
 * regions it asserted now live *inside* an event's full detail rather than at
 * the top of Tracker. Every one of those assertions has been removed rather
 * than relocated: a review that certifies a shape the product no longer has is
 * not evidence, and keeping fixed counts alive with compatibility markup would
 * have made the harness the reason the markup existed.
 *
 * What it certifies instead is the model the redesign was approved as:
 *
 *   map → select location → Tonight briefing → full detail → Back
 *
 * ## State is read from the URL, not from the DOM
 *
 * Tracker serialises its own state into the query string — `pin`, `date`,
 * `show`, `event`, `card`, `mode`, `terrain`, `with`, `layers`. That is the product's own
 * contract with the reader's address bar, so it is the thing worth asserting:
 * it survives restyling, and it says what Tracker *means* rather than which
 * element happened to carry a class this week. The DOM is consulted only for
 * what genuinely is not in the URL — whether a surface is open, what the briefing
 * is offering, and what the place and date controls read.
 */

/**
 * The instant every answer here is a function of.
 *
 * Tracker's whole output is "what is worth seeing from here, tonight", so an
 * unpinned clock makes the rail a different rail every run and the date label a
 * different label every day. 05:00Z is 22:00 the previous evening in Portland,
 * which is inside the night rather than after it — the hour at which there is
 * something to rank at all.
 *
 * Shared with the accessibility gate rather than declared twice, so the two
 * cannot drift onto different nights.
 */
const REVIEW_AT = TRACKER_FIXTURE_AT;

/** The Portland-local night `REVIEW_AT` falls in, which is the previous date. */
const REVIEW_NIGHT = "2026-09-02";
const NEXT_NIGHT = "2026-09-03";

/** Portland, rounded the way Tracker rounds it into the URL. */
const REVIEW_PIN = "45.515,-122.678";

/**
 * A second observing site, for the location-invalidation leg.
 *
 * The rail is an answer to "where am I", so two places an hour apart must be
 * able to give two different answers. Washington is bright enough that Mars
 * fails the naked-eye rule there but passes at Greenbelt, which is the
 * rail-visible difference this leg moves the reader across. Under the review
 * fixtures the two places cannot share a rail, so a stale one is a failure and
 * not a coincidence.
 */
const GREENBELT = {
  name: "Greenbelt",
  context: "Maryland, United States",
  latitude: 38.996,
  longitude: -76.876,
};
const WASHINGTON = {
  name: "Washington",
  context: "District of Columbia, United States",
  latitude: 38.9,
  longitude: -77.03,
};

/**
 * The opportunities the pinned place and night produce.
 *
 * Named rather than counted. A total is the assertion that broke the scenario
 * this replaces — it fails the moment the sky legitimately offers a fifth thing
 * — whereas "Saturn is still being offered from Portland that night" stays true
 * for the reason the product is supposed to make it true.
 */
const EXPECTED_NAKED_EYE_CARDS = ["planet-saturn", "planet-mars", "deep-sky-m45", "moon"];

/**
 * A target the eyes cannot have and a telescope can.
 *
 * The observing-rule model is covered exhaustively in its own gate; this is the
 * smoke invariant that it is still wired to the rail at all.
 */
const TELESCOPE_ONLY_CARD = "deep-sky-m31";

/** A catalogue event whose search term resolves to one stable first result. */
const EVENT_QUERY = "Total solar eclipse";
const EXPECTED_EVENT_ID = "solar-eclipse-2027-08-02";
const EXPECTED_EVENT_DATE = "2027-08-02";

/** Where a rail card's full detail is entered from, and returned to. */
const DETAIL_CARD = "planet-saturn";

/**
 * Everything this scenario holds still, in one object.
 *
 * Exported so the pinning itself can be asserted: a fixture that quietly starts
 * reading the wall clock produces a review that passes today and fails at the
 * turn of a month, which is the failure mode this whole file exists to avoid.
 */
export const trackerReviewFixtures = {
  at: REVIEW_AT,
  night: REVIEW_NIGHT,
  nextNight: NEXT_NIGHT,
  pin: REVIEW_PIN,
  place: PORTLAND,
  nakedEyeCards: EXPECTED_NAKED_EYE_CARDS,
  telescopeOnlyCard: TELESCOPE_ONLY_CARD,
  eventQuery: EVENT_QUERY,
  eventId: EXPECTED_EVENT_ID,
  eventDate: EXPECTED_EVENT_DATE,
  detailCard: DETAIL_CARD,
  greenbelt: GREENBELT,
  washington: WASHINGTON,
  /**
   * What each leg of the location round trip must name. Named rather than
   * counted, like the rail above, and observed rather than presumed: under the
   * review fixtures Washington's sky is bright enough to withhold Mars and
   * still admit the Andromeda Galaxy to the naked eye, and Greenbelt's is not.
   * A future recalibration of the naked-eye rule may legitimately move these —
   * in which case this table and the rule change together, in one review.
   */
  locationLegRail: {
    greenbelt: { offered: ["planet-mars"], withheld: ["deep-sky-m31"] },
    washington: { offered: ["deep-sky-m31"], withheld: ["planet-mars"] },
  },
};

/**
 * Tracker's state, as Tracker itself records it.
 *
 * Everything derivable from the query string is read from the query string.
 * `mapState` and the open-surface flags are the exceptions: whether the reader
 * is looking at the map or a full detail page is in the URL as `event`, but the
 * shell also declares it, and a disagreement between the two is worth catching.
 */
export async function readTrackerMapState(page) {
  return page.evaluate(() => {
    const params = new URLSearchParams(window.location.search);
    const shell = document.querySelector(".tracker-shell");
    const openSurface =
      document.querySelector(".tk-layers-panel") ? "layers"
      : document.querySelector(".tracker-place-panel") ? "place"
      : document.querySelector(".tk-eventfinder-open") ? "event-finder"
      : document.querySelector(".tk-equipment-panel") ? "equipment"
      : null;

    return {
      shellPresent: Boolean(shell),
      mapState: shell?.getAttribute("data-map-state") ?? null,
      layersOpen: shell?.getAttribute("data-layers-open") === "true",
      mapPresent: Boolean(document.querySelector(".maplibregl-map canvas")),
      mapPresentation:
        document.querySelector(".tk-map-canvas")?.getAttribute("data-map-presentation") ?? null,

      // The map-first controls, by the names a reader reaches them by.
      controls: {
        modes: Boolean(document.querySelector('nav[aria-label="Tracker modes"]')),
        place: Boolean(document.querySelector(".tracker-place-current")),
        date: Boolean(document.querySelector(".tk-date-field")),
        projection: Boolean(document.querySelector('[role="radiogroup"][aria-label="Map projection"]')),
        eventFinder: Boolean(document.querySelector(".tk-eventfinder")),
        layers: Boolean(document.querySelector(".tk-layers")),
        equipment: Boolean(document.querySelector(".tk-equipment")),
      },

      // Serialised state: what Tracker says it is showing.
      pin: params.get("pin"),
      date: params.get("date"),
      detailEvent: params.get("event"),
      activeEvent: params.get("show"),
      expandedCard: params.get("card"),
      primaryMode: params.get("mode") === "tonight" ? "tonight" : "map",
      projection: params.get("terrain") === "1" || params.get("globe") === "1" ? "terrain" : "flat",
      equipment: params.get("with") ?? "eyes",
      layers: (params.get("layers") ?? "").split(",").filter(Boolean),

      // What the reader can actually see of it.
      placeLabel: document.querySelector(".tracker-place-name")?.textContent?.trim() ?? null,
      dateLabel: document.querySelector(".tk-date-label")?.textContent?.trim() ?? null,
      openSurface,

      /**
       * The observer the answers are about, declared by the shell.
       *
       * The rail is computed from the observing location, so a rail drawn for
       * one place while the shell declares another is exactly the stale-state
       * defect this attribute exists to catch.
       */
      observer: document.querySelector(".tracker-shell")?.getAttribute("data-observer") ?? null,
      /** The night plan's own identity key, for the same reason. */
      planKey: document.querySelector(".tracker-shell")?.getAttribute("data-plan-identity") ?? null,
      recoveryReviewActive:
        document.querySelector(".tracker-shell")?.getAttribute("data-recovery-review") === "true",
      cloudTimelineState:
        document.querySelector(".tracker-shell")?.getAttribute("data-cloud-timeline") ?? null,
      placeSearchPresent: Boolean(document.querySelector(".tracker-place-combobox input")),
      eventSearchPresent: Boolean(document.querySelector('.tk-eventfinder-open input[type="search"]')),
      recommendationSurfacePresent: Boolean(
        document.querySelector(".tk-map-recommendation, .tk-tonight-surface"),
      ),
      // Retain these field names in the artifact schema for continuity with
      // the prior cloud-recovery evidence. They now observe the R2 Map/Tonight
      // presentations, not legacy `.tk-rail` markup.
      railPresent: Boolean(document.querySelector(".tk-map-recommendation, .tk-tonight-surface")),
      railCards: [...document.querySelectorAll(
        ".tk-map-recommendation[data-card], .tk-tonight-surface [data-card]",
      )].map((card) => ({
        id: card.getAttribute("data-card"),
        reason: card.getAttribute("data-reason"),
        expanded: false,
        name:
          card.querySelector("h2, strong")?.textContent?.trim() ??
          card.textContent?.replace(/\s+/g, " ").trim() ??
          null,
      })),
      railCardIdentities: [...document.querySelectorAll(
        ".tk-map-recommendation[data-card], .tk-tonight-surface [data-card]",
      )].map((card) => card.getAttribute("data-card")),
      recoveryReason:
        document.querySelector(".tk-recovery-context")?.getAttribute("data-recovery-reason") ?? null,
      recoveryKind:
        document.querySelector("[data-recovery-kind]")?.getAttribute("data-recovery-kind") ?? null,
      recoveryDate:
        document.querySelector("[data-recovery-date]")?.getAttribute("data-recovery-date") ?? null,
      recoveryTarget:
        document.querySelector("[data-recovery-target]")?.getAttribute("data-recovery-target") ?? null,
      recoveryObserver:
        document.querySelector("[data-recovery-observer]")?.getAttribute("data-recovery-observer") ?? null,
      recoveryPlanningKey:
        document.querySelector("[data-recovery-planning-key]")
          ?.getAttribute("data-recovery-planning-key") ?? null,
      recoveryText: [...document.querySelectorAll(
        '[data-card="recovery-summary"], [data-recovery-kind]',
      )]
        .map((node) =>
          (node instanceof HTMLElement ? node.innerText : node.textContent)
            ?.replace(/\s+/g, " ")
            .trim() ?? "",
        )
        .filter(Boolean)
        .join(" · ") || null,
      reminderPresent: Boolean(
        document.querySelector(".tk-recovery-meta button"),
      ),
      cloudWarning:
        document.querySelector(".tk-tonight-cloud")
          ?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      expandedConditions: [],
      liveFinderEntryPresent: Boolean(
        document.querySelector(
          ".tk-map-recommendation .is-finder, .tk-tonight-lead .is-finder, .tk-tonight-row-finder, .tk-action.is-finder",
        ),
      ),
      finderEntryText:
        (() => {
          const entry = document.querySelector(
            ".tk-map-recommendation .is-finder, .tk-tonight-lead .is-finder, .tk-tonight-row-finder, .tk-action.is-finder",
          );
          return entry?.textContent?.replace(/\s+/g, " ").trim() || entry?.getAttribute("aria-label") || null;
        })(),
      detailMoreOpen: Boolean(document.querySelector(".tk-detail-more[open]")),
      skyTabPresent: [...document.querySelectorAll(".tk-mode-nav button")].some(
        (button) => button.textContent?.trim() === "Sky",
      ),
      genericShowOnMapPresent: [...document.querySelectorAll("button")].some((button) =>
        /show on map/i.test(button.textContent ?? ""),
      ),
      phenomenonMapActionPresent: [...document.querySelectorAll("button")].some((button) =>
        /view eclipse path|view aurora visibility|view ground track|view visibility/i.test(
          button.textContent ?? "",
        ),
      ),
      finderDeviceClass:
        document.querySelector(".tk-sky-finder")?.getAttribute("data-device-class") ?? null,
      finderMode:
        document.querySelector(".tk-sky-finder")?.getAttribute("data-mode") ?? null,
      finderCameraState:
        document.querySelector(".tk-sky-finder")?.getAttribute("data-camera") ?? null,
      finderVisualBase:
        document.querySelector(".tk-sky-finder")?.getAttribute("data-visual-base") ?? null,
      finderStarCount:
        Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-stars") ?? 0),
      finderCameraControlPresent: Boolean(
        document.querySelector('.tk-sky-finder button[aria-label="Turn camera on"]'),
      ),
      finderGuidanceControlPresent: Boolean(
        [...document.querySelectorAll(".tk-sky-finder button")].some((button) =>
          /start live guidance/i.test(button.textContent ?? ""),
        ),
      ),
      finderPermissionAttempts:
        Array.isArray(window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__)
          ? [...window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__]
          : [],
      upcomingOpen: shell?.getAttribute("data-upcoming-open") === "true",
      upcomingPlanningState:
        document.querySelector(".tk-upcoming-sheet")?.getAttribute("data-planning-state") ?? null,
      upcomingObserver:
        document.querySelector(".tk-upcoming-sheet")?.getAttribute("data-upcoming-observer") ?? null,
      upcomingPlanObserver:
        document.querySelector(".tk-upcoming-sheet")?.getAttribute("data-upcoming-plan-observer") ?? null,
      upcomingRange:
        document.querySelector(".tk-upcoming-sheet")?.getAttribute("data-upcoming-range") ?? null,
      upcomingEvents: [...document.querySelectorAll("[data-upcoming-event]")].map((row) => ({
        id: row.getAttribute("data-upcoming-event"),
        title: row.querySelector(".tk-upcoming-sheet-copy > strong")?.textContent?.trim() ?? null,
      })),
    };
  });
}

/**
 * The map-first shell invariant.
 *
 * Deliberately says nothing about how many of anything there are. It asserts
 * that Tracker is the map, that the map is under the reader, and that the six
 * controls the model is steered by are present and reachable.
 */
export function trackerShellValidation(state) {
  const failures = [];
  if (!state.shellPresent) failures.push("shell-missing");
  if (!["map", "tonight"].includes(state.mapState)) failures.push(`not-primary-mode:${state.mapState}`);
  if (!state.mapPresent) failures.push("map-canvas-missing");
  const required = state.mapState === "tonight"
    ? ["place", "date", "equipment"]
    : Object.keys(state.controls ?? {});
  for (const name of required) {
    const present = state.controls?.[name];
    if (!present) failures.push(`control-missing:${name}`);
  }
  return { ...state, pass: failures.length === 0, failures };
}

/**
 * The rail is an answer to "where am I", so it does not exist before that is
 * answered. Asserting its absence is the same rule as not expecting the place
 * search before the picker is opened: certify what the product does, including
 * where it deliberately offers nothing.
 */
export function trackerUnselectedValidation(state) {
  const failures = trackerShellValidation(state).failures.slice();
  if (state.pin) failures.push(`pin-before-selection:${state.pin}`);
  if (state.railPresent) failures.push("rail-before-location");
  if (state.placeSearchPresent) failures.push("place-search-before-trigger-opened");
  if (state.eventSearchPresent) failures.push("event-search-before-trigger-opened");
  return { ...state, pass: failures.length === 0, failures };
}

/** The Tonight briefing, checked by which production opportunities it names. */
export function trackerRailValidation(state, expectedCards) {
  const failures = trackerShellValidation(state).failures.slice();
  if (!state.recommendationSurfacePresent) failures.push("recommendation-surface-missing");
  const offered = state.railCards.map((card) => card.id);
  if (!offered.includes("upcoming")) failures.push("upcoming-gateway-missing");
  for (const expected of expectedCards) {
    if (!offered.includes(expected)) failures.push(`opportunity-missing:${expected}`);
  }
  return { ...state, offered, pass: failures.length === 0, failures };
}

/**
 * A genuinely blocked night remains an honest no, then points to the nearest
 * genuinely good window without replacing the rail or its Upcoming gateway.
 * Coarse area cloud is not sufficient to enter this state.
 */
export function trackerRecoveryValidation(state, expected) {
  const expectation = typeof expected === "string"
    ? { kind: "chance", date: expected }
    : expected;
  const failures = trackerShellValidation(state).failures.slice();
  if (!state.railPresent) failures.push("rail-missing");
  if (state.recoveryReason !== (expectation.reason ?? "cloud")) {
    failures.push(
      `recovery-reason:${state.recoveryReason}!=${expectation.reason ?? "cloud"}`,
    );
  }
  if (state.recoveryKind !== expectation.kind) {
    failures.push(`recovery-kind:${state.recoveryKind}!=${expectation.kind}`);
  }
  if (expectation.date !== undefined && state.recoveryDate !== expectation.date) {
    failures.push(`recovery-date:${state.recoveryDate}!=${expectation.date}`);
  }
  if (["chance", "upcoming"].includes(expectation.kind)) {
    if (!state.recoveryDate) failures.push("recovery-date-missing");
    if (!state.recoveryTarget) failures.push("recovery-target-missing");
  }
  if (expectation.kind === "chance" && !state.reminderPresent) {
    failures.push("recovery-reminder-missing");
  }
  if (state.recoveryObserver !== state.observer) {
    failures.push(`recovery-observer:${state.recoveryObserver}!=${state.observer}`);
  }
  if (expectation.observer !== undefined && state.observer !== expectation.observer) {
    failures.push(`observer:${state.observer}!=${expectation.observer}`);
  }
  if (!state.planKey) failures.push("current-plan-key-missing");
  if (!state.recoveryPlanningKey) failures.push("recovery-planning-key-missing");

  const offered = state.railCards.map((card) => card.id);
  if (!offered.includes("recovery-summary")) failures.push("recovery-summary-missing");
  const expectedCard = {
    chance: "next-best-chance",
    upcoming: "recovery-upcoming",
    loading: "recovery-loading",
    none: "recovery-none",
    error: "recovery-none",
  }[expectation.kind];
  if (expectedCard && !offered.includes(expectedCard)) {
    failures.push(`recovery-card-missing:${expectedCard}`);
  }
  if (expectedCard && offered[0] !== expectedCard) {
    failures.push(`recovery-future-not-first:${offered[0]}!=${expectedCard}`);
  }
  if (offered[1] !== "recovery-summary") {
    failures.push(`recovery-context-not-secondary:${offered[1]}`);
  }
  if (!offered.includes("upcoming")) failures.push("upcoming-gateway-missing");

  const ordinary = offered.filter(
    (id) => ![
      "recovery-summary",
      "recovery-loading",
      "next-best-chance",
      "recovery-upcoming",
      "recovery-none",
      "upcoming",
    ].includes(id),
  );
  if (ordinary.length > 0) failures.push(`clouded-targets-still-offered:${ordinary.join("+")}`);
  if (!/\bClouded out tonight\b/.test(state.recoveryText ?? "")) {
    failures.push(`recovery-copy:${state.recoveryText}`);
  }
  if (JSON.stringify(state.railCardIdentities) !== JSON.stringify(offered)) {
    failures.push("rail-card-identities-disagree");
  }
  return { ...state, offered, pass: failures.length === 0, failures };
}

/** A coarse cloudy forecast may caution and re-rank, but not erase the sky. */
export function trackerCloudUncertaintyValidation(state, expectedCards) {
  const failures = trackerRailValidation(state, expectedCards).failures.slice();
  if (state.recoveryReason !== null) {
    failures.push(`false-empty-recovery:${state.recoveryReason}`);
  }
  if (!state.cloudWarning) failures.push("cloud-uncertainty-warning-missing");
  if (!/not direction-specific/i.test(state.cloudWarning ?? "")) {
    failures.push(`cloud-warning-overclaims:${state.cloudWarning}`);
  }
  if (!/clear gaps/i.test(state.cloudWarning ?? "")) {
    failures.push(`cloud-warning-omits-gaps:${state.cloudWarning}`);
  }
  return { ...state, pass: failures.length === 0, failures };
}

/** Upcoming stays on the map and may only show results for its declared observer. */
export function trackerUpcomingValidation(state, expectedRange = "30-days") {
  const failures = trackerShellValidation(state).failures.slice();
  if (!state.upcomingOpen) failures.push("upcoming-sheet-not-open");
  if (state.upcomingPlanningState !== "ready") {
    failures.push(`upcoming-not-ready:${state.upcomingPlanningState}`);
  }
  if (state.upcomingRange !== expectedRange) {
    failures.push(`upcoming-range:${state.upcomingRange}!=${expectedRange}`);
  }
  if (state.upcomingObserver !== state.observer) {
    failures.push(`upcoming-observer:${state.upcomingObserver}!=${state.observer}`);
  }
  if (state.upcomingPlanObserver !== state.observer) {
    failures.push(`upcoming-plan-observer:${state.upcomingPlanObserver}!=${state.observer}`);
  }
  if (!state.upcomingEvents?.length) failures.push("upcoming-events-empty");
  if (state.upcomingEvents?.some((event) => event.title === "Meteors")) {
    failures.push("sporadic-meteors-promoted");
  }
  return { ...state, pass: failures.length === 0, failures };
}

/**
 * Returning from full detail restores the map the reader left.
 *
 * The contract is per-field rather than "the URL is identical": entering detail
 * legitimately adds `event`, and leaving it legitimately removes it. Everything
 * the reader chose — where they are, which night, which card they had open —
 * has to come back.
 */
export function trackerBackToMapValidation(before, after) {
  const failures = [];
  if (after.mapState !== "map") failures.push(`did-not-return-to-map:${after.mapState}`);
  if (after.detailEvent) failures.push(`detail-still-open:${after.detailEvent}`);
  if (!after.railPresent) failures.push("rail-not-restored");
  for (const field of ["pin", "date", "expandedCard", "projection", "equipment", "activeEvent"]) {
    if (before[field] !== after[field]) {
      failures.push(`${field}-not-restored:${before[field]}!=${after[field]}`);
    }
  }
  return {
    before: { pin: before.pin, date: before.date, expandedCard: before.expandedCard },
    after: { pin: after.pin, date: after.date, expandedCard: after.expandedCard },
    pass: failures.length === 0,
    failures,
  };
}

/**
 * One leg of the location round trip, judged by the cards it names.
 *
 * The same rule as the rail validation above — named opportunities, never
 * counts — applied to what a place offers and withholds. A leg waits for this
 * shape before anything is asserted about it, so a slow measurement can never
 * make the review read one place's rail as another's.
 */
export function trackerRailLegValidation(state, leg) {
  const failures = trackerShellValidation(state).failures.slice();
  if (!state.railPresent) failures.push("rail-missing");
  const offered = state.railCards.map((card) => card.id);
  for (const expected of leg.offered) {
    if (!offered.includes(expected)) failures.push(`opportunity-missing:${expected}`);
  }
  for (const withheld of leg.withheld) {
    if (offered.includes(withheld)) failures.push(`opportunity-still-offered:${withheld}`);
  }
  return { ...state, offered, pass: failures.length === 0, failures };
}

/**
 * A location round trip must end where it began, in every derived value.
 *
 * The reported fault this guards: objects admitted at the second place were
 * still being offered after the reader returned to the first. The check is
 * three-sided — the state before the move, the state at the second place, and
 * the state after returning — because "the rail changed" alone cannot catch a
 * rail that changed and then failed to change back.
 */
export function trackerLocationRoundTripValidation(before, moved, after) {
  const failures = [];
  if (after.pin !== before.pin) failures.push(`pin-not-restored:${after.pin}!=${before.pin}`);
  if (after.observer !== before.observer) {
    failures.push(`observer-not-restored:${after.observer}!=${before.observer}`);
  }
  if (after.planKey !== before.planKey) {
    failures.push(`plan-not-restored:${after.planKey}!=${before.planKey}`);
  }
  if (moved.observer === before.observer) failures.push("observer-did-not-move");
  if (moved.planKey === before.planKey) failures.push("plan-did-not-move");
  const ids = (state) => state.railCards.map((card) => card.id);
  for (const expected of ids(before)) {
    if (!ids(after).includes(expected)) failures.push(`opportunity-not-restored:${expected}`);
  }
  for (const extra of ids(moved)) {
    const movedOnly = !ids(before).includes(extra);
    if (movedOnly && ids(after).includes(extra)) {
      failures.push(`moved-place-opportunity-remained:${extra}`);
    }
  }
  return { pass: failures.length === 0, failures };
}

function assertPass(result, message) {
  if (!result.pass) throw new Error(`${message}: ${result.failures.join(", ")}`);
  return result;
}

/**
 * The geocoder, as a fixture.
 *
 * One query, one result, no live service. The place search is a real browser
 * interaction in this scenario — the reader opens the picker and types — so the
 * response behind it has to be the same response every run.
 */
export async function stubGeocoder(context) {
  await context.route("https://photon.komoot.io/api/**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    const feature = (place, state) => ({
      properties: {
        osm_type: "R",
        osm_id: 1,
        name: place.name,
        state,
        country: "United States",
        osm_value: "town",
      },
      geometry: { coordinates: [place.longitude, place.latitude] },
    });
    const features = /portland/i.test(query)
      ? [{
          properties: {
            osm_type: "R",
            osm_id: 186_579,
            name: PORTLAND.name,
            city: "Portland",
            state: "Oregon",
            country: "United States",
            osm_value: "city",
          },
          geometry: { coordinates: [PORTLAND.longitude, PORTLAND.latitude] },
        }]
      : /greenbelt/i.test(query)
        ? [feature(GREENBELT, "Maryland")]
        : /washington/i.test(query)
          ? [feature(WASHINGTON, "District of Columbia")]
          : [];
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ features }),
    });
  });
  await context.route("https://photon.komoot.io/reverse**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ features: [] }) }),
  );
}

/**
 * Every source of weather, air and space weather, answering with nothing.
 *
 * Tracker's honest-degradation behaviour is what a review most needs to be able
 * to photograph, and an absent forecast is the state most readers are in when a
 * provider is down. The cloud and light-pollution layers have their own gates
 * against real fixtures.
 *
 * ## Why these answer 200 rather than 503
 *
 * A release review must contain no unexpected browser diagnostics, and a
 * browser logs every non-2xx subresource as `Failed to load resource` before
 * any application code sees it. Refusing six services therefore wrote 27
 * console errors into the package that had nothing to do with the product —
 * the adapters were already handling every one of them silently.
 *
 * So each service answers instead, with the payload its own client already
 * reads as "there is no data here". The product state is identical: no grid, no
 * forecast, no samples, no relief.
 *
 * ## Why a payload and never a value
 *
 * Each body below is empty in the shape its parser understands. None of them
 * carries a *reading*. An aurora grid of zeroes, a cloud cover of 0% or a
 * sea-level elevation would each be a claim about tonight, and the whole
 * argument of this product is that it does not make claims it cannot source.
 * Absence has to stay absence, so these say "nothing", never "none".
 */
export const NO_DATA_BODIES = [
  // The planetary K-index products, carrying no samples: the parsers return a
  // null current Kp and an empty forecast rather than a Kp of zero.
  //
  // Listed before the nowcast because Playwright matches the most recently
  // registered route first, so the narrower OVATION pattern has to be
  // registered after this one to win.
  ["**/services.swpc.noaa.gov/**", []],
  // The OVATION nowcast, carrying no grid: `parseAuroraGrid` rejects a body
  // with no coordinates, which is the adapter's own path to `grid: null` and a
  // freshness of "unavailable" — not an aurora that is quiet everywhere.
  ["**/services.swpc.noaa.gov/json/ovation_aurora_latest.json*", { coordinates: [] }],
  // No hourly series, so there is no PM2.5 and no aerosol depth to read.
  ["**/air-quality-api.open-meteo.com/**", {}],
  // No gridpoint URL and no timeseries, so each forecast provider fails over
  // and the night ends with no forecast at all.
  ["**/api.weather.gov/**", {}],
  ["**/api.met.no/**", {}],
  ["**/api.open-meteo.com/**", {}],
  // A valid TileJSON that publishes no tiles. MapLibre adds the source, finds
  // nothing to request and draws no relief; the analytical sightline path finds
  // no elevation and says so. Serving a decodable DEM instead would flatten
  // Oregon to sea level, which is a landscape, not a missing one.
  ["**/tiles.mapterhorn.com/**", { tilejson: "2.2.0", tiles: [], minzoom: 0, maxzoom: 15 }],
];

export async function stubEnvironment(context) {
  for (const [pattern, body] of NO_DATA_BODIES) {
    await context.route(pattern, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      }),
    );
  }
}

/**
 * A provider-shaped forecast for the recovery-state leg.
 *
 * The selected night is overcast through sunrise. The following night is
 * clear, so the production planner — not this fixture — must decide which
 * eligible target is the first one worth returning for.
 */
export const CLOUDY_WEATHER_FORECAST = {
  properties: {
    meta: { updated_at: "2026-09-03T04:30:00.000Z" },
    timeseries: Array.from({ length: 60 }, (_, index) => {
      const at = new Date(Date.parse("2026-09-03T00:00:00.000Z") + index * 3_600_000);
      const cloud = at < new Date("2026-09-03T16:00:00.000Z") ? 96 : 4;
      return {
        time: at.toISOString(),
        data: {
          instant: {
            details: {
              air_temperature: 12,
              cloud_area_fraction: cloud,
              cloud_area_fraction_low: cloud,
              cloud_area_fraction_medium: 0,
              cloud_area_fraction_high: 0,
              relative_humidity: cloud > 90 ? 88 : 52,
            },
          },
          next_1_hours: { details: { precipitation_amount: 0 } },
        },
      };
    }),
  },
};

export const CLOUDY_COVER_FORECAST = {
  hourly: {
    time: Array.from({ length: 14 }, (_, index) =>
      new Date(Date.parse("2026-09-03T00:00:00.000Z") + index * 3_600_000)
        .toISOString()
        .slice(0, 16),
    ),
    cloud_cover: Array.from({ length: 14 }, () => 96),
  },
};

async function stubCloudyForecast(page) {
  // Page routes override the scenario's context-wide unavailable provider.
  // NWS remains empty, so Tracker reaches its ordinary global fallback.
  await page.route(
    "https://api.met.no/weatherapi/locationforecast/2.0/compact**",
    (route) => {
      const request = new URL(route.request().url());
      const portland = request.searchParams.get("lat") === PORTLAND.latitude.toFixed(4);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(portland ? CLOUDY_WEATHER_FORECAST : {}),
      });
    },
  );
  await page.route(
    "https://api.open-meteo.com/v1/forecast**",
    (route) => {
      const request = new URL(route.request().url());
      const portland = request.searchParams.get("latitude") === PORTLAND.latitude.toFixed(3);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(portland ? CLOUDY_COVER_FORECAST : {}),
      });
    },
  );
}

export const trackerReviewScenario = {
  id: "tracker",
  title: "Tracker",
  reviewUrl: "http://127.0.0.1:4179/?app=tracker",
  requiresReviewBridge: false,
  /**
   * Tracker answers "what is worth seeing from here tonight" out of ephemerides,
   * a shower calendar and an event catalogue. It never loads the current
   * satellite catalog Explorer renders, so its states have no catalog identity
   * to certify — and must not invent one. Declaring "none" is what obliges them
   * to stay empty of catalog metadata rather than what excuses them from it; see
   * `catalogAuthority` in scripts/release/source-identity.mjs.
   */
  catalogAuthority: "none",
  readySelector: ".tracker-shell",
  notes: {
    featuresImplemented: [
      "Two universal state-preserving modes—Map and Tonight—with rendered Sky available on handhelds independently of camera access",
      "Map-first Tracker keeps the default top-down canvas, with location, night, equipment and layers chosen over it and one compact recommendation kept secondary",
      "The 3D map presentation reuses the production DEM as real oblique terrain, with pitch and rotation, instead of switching to a globe",
      "Tonight is a dedicated vertical briefing built from the production recommendation, recovery and Upcoming pipelines",
      "Sky opens the real rendered celestial sphere on handhelds, starts targeted guidance from Find in Sky, and treats camera and orientation as optional enhancements",
      "Object detail is concise by default, with the visualization and full evidence available under More details",
      "Place selection through the map's own picker, with the search revealed by the trigger rather than always present",
      "Production-ranked observing opportunities presented as one compact Map answer and a dedicated Tonight briefing",
      "An empty-night recovery briefing that names the nearest forecast-backed good window or reuses Upcoming as its fallback",
      "Cloud uncertainty that re-ranks and cautions without letting a non-directional percentage erase bright targets",
      "An Upcoming gateway inside Tonight, opening a map-overlay sheet with 7-day, 30-day, 3-month and one-year ranges",
      "Upcoming is observer-scoped: changing the place while the sheet is open withdraws the prior plan and recomputes the list in place",
      "Full event detail entered from Map or Tonight, with Back restoring the exact prior mode, place, night and selected target",
      "Notable-event search that moves the map and the night to the event while keeping the observing location",
      "Equipment-aware ranking, with telescope-only targets appearing only under a telescope",
      "Observer-scoped invalidation: moving between two places re-answers everything that depends on the place, and returning restores the first place's answers through both the picker and the map",
    ],
    knownLimitations: [
      "Map evidence uses the production OpenFreeMap basemap and Mapterhorn DEM so geography and relief remain visible; those captures therefore depend on the declared third-party tile services.",
      "Automated handheld states exercise the real permission and fallback orchestration with deterministic browser stubs; they do not claim physical gyroscope accuracy or camera-based visual verification.",
      "Weather, air quality and the aurora nowcast are deliberately refused in the general tour; the final cloud leg supplies deterministic provider-shaped forecasts to prove uncertainty handling.",
      "Cloud and light-pollution layer behaviour is certified by their own gates; this scenario only proves the layer surface opens and closes without losing state.",
      "The location round-trip leg drives the map path by writing the pin into the query string the shell itself reads, rather than by hand-mocking the map's event system; the recommendation, observer and plan answers it asserts are recomputed from that location by the production path.",
    ],
    expectedReviewFocus: [
      "Verify Map, Tonight and Sky preserve one observer/date/target context while giving each task a distinct hierarchy.",
      "Verify Map is top-down by default and the 3D toggle produces pitched, rotatable DEM terrain without losing target state.",
      "Verify Map keeps the recommendation compact while Tonight exposes the full production briefing and Upcoming gateway.",
      "Verify one phone tap starts targeted rendered-Sky guidance, tablets remain usable in both orientations, camera is not requested implicitly, and sensorless handhelds retain the rendered celestial browser.",
      "Verify object detail is concise until More details is expanded.",
      "Verify the place search does not exist until the location trigger is opened.",
      "Verify Back from full detail restores the exact prior mode, place, night and selected target.",
      "Verify a telescope adds targets the naked eye is not offered.",
      "Verify moving between two places re-answers the briefing for the new place and that returning restores the first place's answers.",
      "Verify Upcoming opens over the map, changes planning range, and declares the same observer for the sheet, completed plan and map shell.",
      "Verify a coarse cloudy forecast keeps the Moon and Saturn available, marks the forecast as non-directional, and says clear gaps remain possible.",
    ],
  },

  /**
   * Clock and feeds, before the first navigation.
   *
   * `seedPlace` is deliberately *not* called: this scenario starts where a new
   * reader starts, with nothing chosen, because the location interaction is one
   * of the things being certified.
   */
  async prepare({ context, page }) {
    await context.addInitScript(() => {
      const attempts = [];
      Object.defineProperty(window, "__ORBIT_FINDER_PERMISSION_ATTEMPTS__", {
        configurable: true,
        value: attempts,
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            attempts.push("camera");
            throw new DOMException("Review camera denied", "NotAllowedError");
          },
        },
      });
      class ReviewOrientationEvent extends Event {}
      ReviewOrientationEvent.requestPermission = async () => {
        attempts.push("orientation");
        return "granted";
      };
      class ReviewMotionEvent extends Event {}
      ReviewMotionEvent.requestPermission = async () => {
        attempts.push("motion");
        return "granted";
      };
      Object.defineProperty(window, "DeviceOrientationEvent", {
        configurable: true,
        value: ReviewOrientationEvent,
      });
      Object.defineProperty(window, "DeviceMotionEvent", {
        configurable: true,
        value: ReviewMotionEvent,
      });
    });
    await page.clock.setFixedTime(REVIEW_AT);
    await stubTracker(context, {
      basemap: "live",
      satellites: "unavailable",
      // The review is the one caller that needs a clean browser console, so the
      // refused feed answers with an empty body rather than a 503. The
      // ephemeris still resolves to null and Tracker still offers no spacecraft.
      unavailable: "empty",
    });
    await stubEnvironment(context);
    await stubGeocoder(context);
  },

  async run({ captureSurface, page }) {
    const read = () => readTrackerMapState(page);
    const settle = (ms = 1_200) => page.waitForTimeout(ms);

    /**
     * A place chosen through the picker, wherever the picker was left.
     *
     * The trigger opens the panel; typed rather than filled, because the
     * picker is a React Aria combobox and opens its list from key events.
     */
    const selectPlaceBySearch = async (name) => {
      await page.locator(".tracker-place-current").first().click();
      await settle(600);
      const search = page.getByRole("combobox", { name: "Search for a place to observe from" });
      await search.click();
      await search.fill("");
      await search.pressSequentially(name, { delay: 40 });
      await page.locator('[role="option"]').first().waitFor({ timeout: 20_000 });
      await page.locator('[role="option"]').first().click();
    };

    /**
     * A map pick, arrived at through the same state write.
     *
     * The map's click handler performs `navigate({ pin })`, which pushes the
     * location into the query string and re-renders from it; writing the pin
     * into the query string and letting the shell read it back resolves to the
     * same location state without hand-mocking the map's event system. The
     * rail, the observer and the plan are the things being asserted, and each
     * of those is recomputed from the location alone.
     */
    const pickOnMap = async (place) => {
      await page.evaluate(({ latitude, longitude }) => {
        const url = new URL(window.location.href);
        url.searchParams.set("pin", `${latitude.toFixed(3)},${longitude.toFixed(3)}`);
        window.history.pushState(null, "", url.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, { latitude: place.latitude, longitude: place.longitude });
    };

    /**
     * The rail for one leg of the round trip, waited for rather than assumed.
     *
     * The light measurement arrives over a fetch, and the rail changes only
     * once it lands, so the leg waits until the expected cards are offered and
     * the expected withheld card is gone before anything is asserted.
     */
    const waitForRailLeg = async (leg) => {
      await page.waitForFunction(
        ({ offered, withheld }) => {
          const ids = [...document.querySelectorAll(".tk-tonight-surface [data-card]")].map((card) =>
            card.getAttribute("data-card"),
          );
          return (
            offered.every((id) => ids.includes(id)) &&
            withheld.every((id) => !ids.includes(id))
          );
        },
        { offered: leg.offered, withheld: leg.withheld },
        { timeout: 30_000 },
      );
      await settle(1_500);
      return read();
    };

    const waitForUpcoming = async (range) => {
      await page.waitForFunction(
        (expectedRange) => {
          const sheet = document.querySelector(".tk-upcoming-sheet");
          const shell = document.querySelector(".tracker-shell");
          return (
            sheet?.getAttribute("data-planning-state") === "ready" &&
            sheet.getAttribute("data-upcoming-range") === expectedRange &&
            sheet.getAttribute("data-upcoming-observer") === shell?.getAttribute("data-observer") &&
            sheet.getAttribute("data-upcoming-plan-observer") === shell?.getAttribute("data-observer") &&
            sheet.querySelectorAll("[data-upcoming-event]").length > 0
          );
        },
        range,
        { timeout: 60_000 },
      );
      await settle(800);
      return read();
    };

    // 1. Tracker opens as a map, with nothing chosen.
    await page.locator(".maplibregl-map canvas").waitFor({ timeout: 30_000 });
    await settle(2_000);
    const entry = assertPass(
      trackerUnselectedValidation(await read()),
      "Tracker did not open into the map-first shell",
    );
    await captureSurface("tracker-map-entry", entry);

    // 2. The place search exists only once the trigger is opened.
    await page.getByRole("button", { name: "Choose where you are" }).click();
    await settle(600);
    const picker = await read();
    if (picker.openSurface !== "place") throw new Error("The location trigger did not open the picker.");
    if (!picker.placeSearchPresent) throw new Error("Opening the location picker did not reveal the place search.");
    await captureSurface("tracker-location-picker", picker);

    // Typed rather than filled: the picker is a React Aria combobox, and it
    // opens its list from key events, not from a programmatic value change.
    const placeSearch = page.getByRole("combobox", { name: "Search for a place to observe from" });
    await placeSearch.click();
    await placeSearch.pressSequentially(PORTLAND.name, { delay: 40 });
    await page.locator('[role="option"]').first().waitFor({ timeout: 20_000 });
    await page.locator('[role="option"]').first().click();
    await page.locator(".tk-map-recommendation").waitFor({ timeout: 30_000 });
    await settle(2_500);

    const located = await read();
    if (located.pin !== REVIEW_PIN) {
      throw new Error(`The selected location is not in Tracker's own state: pin=${located.pin}`);
    }
    if (located.placeLabel !== PORTLAND.name) {
      throw new Error(`The map does not show the selected place: ${located.placeLabel}`);
    }
    if (
      located.mapState !== "map" ||
      located.mapPresentation !== "mercator" ||
      located.railCards[0]?.id !== DETAIL_CARD ||
      located.railCards.some((card) => card.id === "upcoming")
    ) {
      throw new Error(`Map did not keep the recommendation secondary: ${JSON.stringify(located)}`);
    }
    await captureSurface("tracker-map-2d", located);

    // The same authoritative state over the real DEM, not a globe or a second
    // scene. Selection, observer and plan identity must remain unchanged.
    await page.getByRole("radio", { name: /Oblique terrain/ }).click();
    await settle(1_200);
    const terrain = await read();
    const terrainRuntime = await page.evaluate(() => ({
      source: window.__trackerMap?.getTerrain?.()?.source ?? null,
      pitch: Math.round(window.__trackerMap?.getPitch?.() ?? 0),
      rotation: window.__trackerMap?.dragRotate?.isEnabled?.() ?? false,
    }));
    if (
      terrain.projection !== "terrain" ||
      terrain.mapPresentation !== "terrain" ||
      terrainRuntime.source !== "tracker-terrain-3d-dem" ||
      terrainRuntime.pitch < 55 ||
      !terrainRuntime.rotation ||
      terrain.observer !== located.observer ||
      terrain.planKey !== located.planKey ||
      terrain.pin !== located.pin
    ) {
      throw new Error(`3D terrain did not preserve the map state: ${JSON.stringify({ terrain, terrainRuntime })}`);
    }
    await captureSurface("tracker-map-3d-terrain", terrain);
    await page.getByRole("radio", { name: /Top-down map/ }).click();
    await settle(700);

    // Tonight is the complete ranked decision surface. It consumes the same
    // cards and puts Upcoming inside the briefing rather than beside Map.
    await page.getByRole("button", { name: "Tonight", exact: true }).click();
    await page.locator(".tk-tonight-planning").waitFor({ timeout: 10_000 });
    await settle(900);
    const tonight = assertPass(
      trackerRailValidation(await read(), EXPECTED_NAKED_EYE_CARDS),
      "Tonight did not expose the production ranked briefing",
    );
    if (tonight.mapState !== "tonight" || tonight.primaryMode !== "tonight") {
      throw new Error(`Tonight mode was not recorded: ${JSON.stringify(tonight)}`);
    }
    await captureSurface("tracker-tonight-normal", tonight);

    // 2b. Future discovery is a gateway inside Tonight and a sheet over the
    //     same shared state. Its completed worker plan must name the shell's exact
    //     observer. A place change while it is open must replace that identity
    //     in place rather than leaving Portland's future attached to Greenbelt.
    const tourClose = page.getByRole("button", { name: "Close the tour" });
    if (await tourClose.isVisible()) await tourClose.click();
    await page.locator(".tk-tonight-planning").click();
    const upcoming = assertPass(
      trackerUpcomingValidation(await waitForUpcoming("30-days")),
      "Upcoming did not open with a current observer-scoped plan",
    );
    await captureSurface("tracker-upcoming", upcoming);

    await page.getByRole("button", { name: "Show the next 7 days" }).click();
    assertPass(
      trackerUpcomingValidation(await waitForUpcoming("7-days"), "7-days"),
      "Upcoming did not replace its plan for the 7-day range",
    );

    await selectPlaceBySearch(GREENBELT.name);
    const upcomingMoved = assertPass(
      trackerUpcomingValidation(await waitForUpcoming("7-days"), "7-days"),
      "Upcoming did not replace Portland's plan after the observing place changed",
    );
    if (upcomingMoved.upcomingObserver === upcoming.upcomingObserver) {
      throw new Error("Upcoming's observer identity did not change with the place.");
    }
    await captureSurface("tracker-upcoming-location-reactive", upcomingMoved);

    await selectPlaceBySearch(PORTLAND.name);
    const upcomingReturned = assertPass(
      trackerUpcomingValidation(await waitForUpcoming("7-days"), "7-days"),
      "Upcoming did not restore Portland's plan after the place returned",
    );
    if (upcomingReturned.upcomingObserver !== upcoming.upcomingObserver) {
      throw new Error("Upcoming did not restore the original observer identity.");
    }
    await page.getByRole("button", { name: "Close Upcoming" }).click();
    await page.locator(".tk-upcoming-sheet").waitFor({ state: "detached", timeout: 10_000 });
    await page.waitForFunction(
      () => document.activeElement?.closest('[data-gateway="upcoming"]') != null,
      undefined,
      { timeout: 5_000 },
    );

    // 3. The night is deterministic, moves, and does not disturb the place.
    if (!/Sep 2, 2026/.test(located.dateLabel ?? "")) {
      throw new Error(`The pinned clock did not produce a deterministic night: ${located.dateLabel}`);
    }
    await page.getByRole("button", { name: "Next night" }).click();
    await settle(2_500);
    const advanced = await read();
    if (advanced.date !== NEXT_NIGHT) throw new Error(`Next night did not advance: ${advanced.date}`);
    if (advanced.pin !== REVIEW_PIN) throw new Error("Changing the night lost the selected location.");
    if (advanced.mapState !== "tonight") throw new Error("Changing the night left Tonight.");
    await captureSurface("tracker-night-advanced", advanced);
    await page.getByRole("button", { name: "Previous night" }).click();
    await settle(2_500);
    const returned = await read();
    if (returned.date && returned.date !== REVIEW_NIGHT) {
      throw new Error(`Previous night did not return to the pinned night: ${returned.date}`);
    }

    // 4. Desktop keeps the full Tonight briefing but exposes neither live Sky
    // nor a placeholder destination for it.
    const leading = assertPass(
      trackerRailValidation(await read(), EXPECTED_NAKED_EYE_CARDS),
      "The leading opportunity broke the Tonight briefing",
    );
    if (leading.railCards[0]?.id !== DETAIL_CARD) {
      throw new Error(`Tonight did not lead with the expected target: ${leading.railCards[0]?.id}`);
    }
    if (leading.mapState !== "tonight") throw new Error("Reading the leading target replaced Tonight.");
    if (leading.liveFinderEntryPresent || leading.skyTabPresent) {
      throw new Error("Desktop briefing exposed a handheld-only Sky entry.");
    }
    if (leading.finderPermissionAttempts.length > 0) {
      throw new Error(`Desktop browsing requested Finder permissions: ${leading.finderPermissionAttempts}`);
    }
    await captureSurface("tracker-tonight-leading-target", leading);

    // 5. Full detail, and the way back.
    const beforeDetail = await read();
    // The editorial Tonight row is itself the detail action; its accessible
    // name is the object identity and observing summary, not legacy CTA copy.
    await page.locator(".tk-tonight-lead .tk-tonight-row-main").click();
    await page.waitForFunction(
      () => document.querySelector(".tracker-shell")?.getAttribute("data-map-state") === "detail",
      undefined,
      { timeout: 30_000 },
    );
    await settle(2_500);
    const detail = await read();
    if (detail.detailEvent !== DETAIL_CARD) {
      throw new Error(`Full detail did not open the expanded opportunity: event=${detail.detailEvent}`);
    }
    if (
      detail.genericShowOnMapPresent ||
      detail.liveFinderEntryPresent ||
      detail.skyTabPresent ||
      detail.detailMoreOpen
    ) {
      throw new Error("Desktop detail did not open in its concise capability-safe state.");
    }
    if (detail.finderPermissionAttempts.length > 0) {
      throw new Error(`Desktop detail requested Finder permissions: ${detail.finderPermissionAttempts}`);
    }
    await captureSurface("tracker-object-detail-collapsed", detail);

    await page.getByText("More details", { exact: true }).click();
    await settle(500);
    const detailExpanded = await read();
    if (!detailExpanded.detailMoreOpen) {
      throw new Error("The detail disclosure did not expose advanced evidence.");
    }
    await captureSurface("tracker-object-detail-expanded", detailExpanded);

    await page.getByRole("button", { name: /Back to Tonight/i }).click();
    await page.waitForFunction(
      () => document.querySelector(".tracker-shell")?.getAttribute("data-map-state") === "tonight",
      undefined,
      { timeout: 30_000 },
    );
    await settle(2_500);
    const restored = await read();
    if (
      restored.mapState !== "tonight" ||
      restored.pin !== beforeDetail.pin ||
      restored.date !== beforeDetail.date ||
      restored.expandedCard !== beforeDetail.expandedCard ||
      restored.equipment !== beforeDetail.equipment
    ) {
      throw new Error(`Back from detail did not restore Tonight: ${JSON.stringify(restored)}`);
    }
    await captureSurface("tracker-detail-back-to-tonight", restored);

    // 6. A telescope is offered what the eyes are not.
    await page.getByRole("button", { name: /Viewing: .*Change/ }).click();
    await settle(600);
    await page.getByRole("switch", { name: /Telescope/i }).click();
    await settle(3_000);
    const telescope = assertPass(
      trackerRailValidation(await read(), [TELESCOPE_ONLY_CARD]),
      "A telescope did not reach targets the naked eye cannot",
    );
    if (telescope.equipment !== "telescope") {
      throw new Error(`The chosen equipment is not in Tracker's state: with=${telescope.equipment}`);
    }
    if (located.railCards.some((card) => card.id === TELESCOPE_ONLY_CARD)) {
      throw new Error(`${TELESCOPE_ONLY_CARD} was already offered to the naked eye, so it proves nothing.`);
    }
    await captureSurface("tracker-equipment-telescope", telescope);
    // Telescope keeps the selector open so the optional saved-setup path is
    // available without another step. Return directly to the naked-eye rule.
    await page.getByRole("switch", { name: /Naked eye/i }).click();
    await settle(3_000);
    const eyesAgain = await read();
    if (eyesAgain.equipment !== "eyes") {
      throw new Error(`Returning to the naked eye did not take: with=${eyesAgain.equipment}`);
    }

    // 7. Layers remain Map tools. Switching presentation does not change the
    // observer/date/card state they act on.
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await settle(500);
    const beforeLayers = await read();
    await page.getByRole("button", { name: /^Layers/ }).click();
    await settle(800);
    const layersOpen = await read();
    if (!layersOpen.layersOpen || layersOpen.openSurface !== "layers") {
      throw new Error("The layers control did not open.");
    }
    await captureSurface("tracker-layers-open", layersOpen);
    await page.getByRole("button", { name: "Close the layer list" }).click();
    await settle(800);
    const layersClosed = await read();
    if (layersClosed.layersOpen) throw new Error("The layer list did not close.");
    for (const field of ["pin", "date", "expandedCard", "mapState"]) {
      if (beforeLayers[field] !== layersClosed[field]) {
        throw new Error(`Opening the layers lost ${field}: ${beforeLayers[field]} -> ${layersClosed[field]}`);
      }
    }

    // 8. Moving between two places updates every observer-dependent answer,
    //     and returning to the first place restores all of them — through both
    //     of the paths that set a location. The rail needs a place whose sky
    //     differs to see the difference, so the light-pollution measurement is
    //     turned on and the rail read with the naked-eye rule.
    const openLightPollutionMeasurement = async () => {
      await page.getByRole("button", { name: /^Layers/ }).click();
      await settle(600);
      await page.getByRole("switch", { name: "Light pollution" }).click();
      await page.getByRole("button", { name: "Close the layer list" }).click();
      await settle(800);
    };
    await openLightPollutionMeasurement();
    await page.getByRole("button", { name: "Tonight", exact: true }).click();
    await settle(700);

    const greenbeltLeg = trackerReviewFixtures.locationLegRail.greenbelt;
    const washingtonLeg = trackerReviewFixtures.locationLegRail.washington;

    await selectPlaceBySearch(GREENBELT.name);
    await settle(2_500);
    const greenbelt = assertPass(
      trackerRailLegValidation(await waitForRailLeg(greenbeltLeg), greenbeltLeg),
      "The Greenbelt leg did not produce the expected observing rail",
    );
    await captureSurface("tracker-location-greenbelt", greenbelt);

    // The map path: a pick at Washington's coordinates is the same state write
    // the map's click handler performs — `navigate({ pin })` — arrived at
    // through the location state the shell itself declares.
    await pickOnMap(WASHINGTON);
    const washington = assertPass(
      trackerRailLegValidation(await waitForRailLeg(washingtonLeg), washingtonLeg),
      "Moving to Washington did not update the rail for the new place",
    );
    await captureSurface("tracker-location-washington", washington);

    // The search path, back: the answer must be the answer Greenbelt gave
    // before, not the answer Washington left behind.
    await selectPlaceBySearch(GREENBELT.name);
    const searchReturn = assertPass(
      trackerRailLegValidation(await waitForRailLeg(greenbeltLeg), greenbeltLeg),
      "Returning to Greenbelt did not produce its rail",
    );
    const greenbeltReturn = assertPass(
      trackerLocationRoundTripValidation(greenbelt, washington, searchReturn),
      "Returning to Greenbelt through the place search did not restore its answers",
    );
    await captureSurface("tracker-location-returned", searchReturn);

    // The map path, both ways: the same round trip, driven by picks alone.
    await pickOnMap(WASHINGTON);
    await waitForRailLeg(washingtonLeg);
    await pickOnMap(GREENBELT);
    const pickedReturn = assertPass(
      trackerRailLegValidation(await waitForRailLeg(greenbeltLeg), greenbeltLeg),
      "The map round trip did not produce Greenbelt's rail",
    );
    const mapRoundTrip = assertPass(
      trackerLocationRoundTripValidation(greenbelt, washington, pickedReturn),
      "Returning to Greenbelt through the map did not restore its answers",
    );
    await captureSurface("tracker-location-map-roundtrip", pickedReturn);

    // Leave the leg as it was found: the measurement off and the reader in
    // Portland, so the next step starts from the state it has always assumed.
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await settle(500);
    await page.getByRole("button", { name: /^Layers/ }).click();
    await settle(600);
    await page.getByRole("switch", { name: "Light pollution" }).click();
    await page.getByRole("button", { name: "Close the layer list" }).click();
    await settle(800);
    await selectPlaceBySearch(PORTLAND.name);
    await settle(2_500);
    await page.getByRole("button", { name: "Tonight", exact: true }).click();
    await settle(700);
    const portlandRestored = await read();
    if (portlandRestored.pin !== REVIEW_PIN) {
      throw new Error(`The location leg did not restore the review place: pin=${portlandRestored.pin}`);
    }
    assertPass(
      trackerRailValidation(portlandRestored, EXPECTED_NAKED_EYE_CARDS),
      "The location leg left Portland's observing rail changed",
    );

    // 9. Finding a notable event moves the map and the night to it, and keeps
    //    the observing location, which is a different question from where the
    //    map is looking.
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await settle(500);
    const eventSearchBefore = await read();
    if (eventSearchBefore.eventSearchPresent) {
      throw new Error("The event search existed before the finder was opened.");
    }
    await page.getByRole("button", { name: "Find a notable astronomical event" }).click();
    await settle(600);
    const finderOpen = await read();
    if (!finderOpen.eventSearchPresent || finderOpen.openSurface !== "event-finder") {
      throw new Error("Opening the event finder did not reveal its search.");
    }
    const eventSearch = page.getByRole("searchbox", { name: "Find a notable astronomical event" });
    await eventSearch.pressSequentially(EVENT_QUERY, { delay: 30 });
    await page.locator(".tk-eventfinder-results button").first().waitFor({ timeout: 20_000 });
    await captureSurface("tracker-event-search", await read());
    await page.locator(".tk-eventfinder-results button").first().click();
    await settle(3_000);

    const found = await read();
    if (found.activeEvent !== EXPECTED_EVENT_ID) {
      throw new Error(`The chosen event is not the deterministic fixture: show=${found.activeEvent}`);
    }
    if (found.date !== EXPECTED_EVENT_DATE) {
      throw new Error(`Choosing an event did not move the night to it: date=${found.date}`);
    }
    if (found.pin !== REVIEW_PIN) throw new Error("Choosing an event moved the observing location.");
    if (found.mapState !== "map") throw new Error("Choosing an event left the map.");
    if (!found.recommendationSurfacePresent) throw new Error("Choosing an event removed the Map recommendation.");
    await captureSurface("tracker-event-selected", found);

    // 10. A coarse cloudy forecast may lower quality and caution, but it cannot
    //     erase a bright target without target-direction evidence. This is the
    //     real-world Moon/Saturn failure mode: both remain in the rail and the
    //     expanded warning names the uncertainty and the possibility of gaps.
    await stubCloudyForecast(page);
    await page.goto(
      `${trackerReviewScenario.reviewUrl}&mode=tonight&at=${encodeURIComponent(REVIEW_PIN)}&z=8&pin=${encodeURIComponent(REVIEW_PIN)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator(".maplibregl-map canvas").waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const ids = [...document.querySelectorAll(".tk-tonight-surface [data-card]")].map((card) =>
          card.getAttribute("data-card"),
        );
        return ids.includes("planet-saturn") && ids.includes("moon");
      },
      undefined,
      { timeout: 60_000 },
    );
    await page.locator('.tk-tonight-surface .tk-tonight-cloud').waitFor({
      timeout: 30_000,
    });
    await settle(1_500);
    const cloudy = assertPass(
      trackerCloudUncertaintyValidation(await read(), ["planet-saturn", "moon"]),
      "A non-directional cloudy forecast erased or overclaimed the visible sky",
    );
    await captureSurface("tracker-cloud-uncertainty", cloudy);

    // 11. The original Find in Sky tap starts the phone flow. There is no
    // redundant Guide/Lock/Start control, and protected calls do not occur
    // before that explicit tap.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      });
      Object.defineProperty(navigator, "platform", { configurable: true, value: "iPhone" });
      Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `${trackerReviewScenario.reviewUrl}&at=${encodeURIComponent(REVIEW_PIN)}` +
        `&z=8&pin=${encodeURIComponent(REVIEW_PIN)}&card=${DETAIL_CARD}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator(`.tk-map-recommendation[data-card="${DETAIL_CARD}"]`).waitFor({ timeout: 30_000 });
    await settle(900);
    const phoneMap = await read();
    if (!phoneMap.liveFinderEntryPresent || !phoneMap.skyTabPresent || phoneMap.finderPermissionAttempts.length > 0) {
      throw new Error(`Phone Sky entry policy failed: ${JSON.stringify(phoneMap)}`);
    }
    await captureSurface("tracker-phone-map-2d", phoneMap);

    await page.getByRole("radio", { name: /Oblique terrain/ }).click();
    await settle(1_200);
    await captureSurface("tracker-phone-map-3d", await read());
    await page.getByRole("radio", { name: /Top-down map/ }).click();
    await settle(700);

    await page.getByRole("button", { name: "Tonight", exact: true }).click();
    await page.locator(".tk-tonight-lead").waitFor({ timeout: 20_000 });
    await settle(700);
    await captureSurface("tracker-phone-tonight", await read());

    await page.locator(".tk-tonight-lead .tk-tonight-row-main").click();
    await page.locator(".tk-map-detail .tracker-hero").waitFor({ timeout: 20_000 });
    await settle(500);
    const phoneDetail = await read();
    if (phoneDetail.detailMoreOpen || phoneDetail.genericShowOnMapPresent || !phoneDetail.liveFinderEntryPresent) {
      throw new Error(`Phone detail hierarchy failed: ${JSON.stringify(phoneDetail)}`);
    }
    await captureSurface("tracker-phone-object-detail-collapsed", phoneDetail);
    await page.getByRole("button", { name: /Back to Tonight/i }).click();
    await page.locator(".tk-tonight-lead .is-finder").waitFor({ timeout: 20_000 });
    await settle(500);

    await page.locator(".tk-tonight-lead .is-finder").click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      () =>
        Array.isArray(window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__) &&
        window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__.includes("orientation"),
      undefined,
      { timeout: 10_000 },
    );
    await settle(500);
    const phoneFinder = await read();
    if (
      phoneFinder.finderDeviceClass !== "handheld" ||
      phoneFinder.finderMode !== "targeted" ||
      phoneFinder.finderCameraState !== "off" ||
      phoneFinder.finderVisualBase !== "rendered-sky" ||
      phoneFinder.finderStarCount < 8 ||
      phoneFinder.finderGuidanceControlPresent ||
      !phoneFinder.finderPermissionAttempts.includes("orientation") ||
      phoneFinder.finderPermissionAttempts.includes("camera")
    ) {
      throw new Error(`Phone automatic Finder launch failed: ${JSON.stringify(phoneFinder)}`);
    }
    await captureSurface("tracker-phone-sky", phoneFinder);

    // 12. A tablet remains a physical pointing device in both orientations,
    // even at a desktop-like landscape width. The review exposes permission
    // paths but never fabricates an orientation event or a successful lock.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Version/18 Mobile/15E148 Safari",
      });
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        value: "MacIntel",
      });
      Object.defineProperty(navigator, "maxTouchPoints", {
        configurable: true,
        value: 5,
      });
      Object.defineProperty(navigator, "userAgentData", {
        configurable: true,
        value: { mobile: false, platform: "macOS" },
      });
    });
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(
      `${trackerReviewScenario.reviewUrl}&at=${encodeURIComponent(REVIEW_PIN)}` +
        `&z=8&pin=${encodeURIComponent(REVIEW_PIN)}&card=${DETAIL_CARD}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator(`.tk-map-recommendation[data-card="${DETAIL_CARD}"]`).waitFor({
      timeout: 30_000,
    });
    await page.locator(".tk-map-recommendation .is-finder").waitFor({ timeout: 10_000 });
    await settle(900);
    const tabletEntry = await read();
    if (!tabletEntry.liveFinderEntryPresent || !tabletEntry.skyTabPresent || tabletEntry.finderPermissionAttempts.length > 0) {
      throw new Error(`Tablet Finder entry policy failed: ${JSON.stringify(tabletEntry)}`);
    }
    await page.getByRole("radio", { name: /Oblique terrain/ }).click();
    await settle(1_200);
    await captureSurface("tracker-tablet-map-3d", await read());
    await page.getByRole("button", { name: "Tonight", exact: true }).click();
    await page.locator(".tk-tonight-lead").waitFor({ timeout: 20_000 });
    await settle(700);
    await captureSurface("tracker-tablet-tonight", await read());

    await page.locator(".tk-tonight-lead .is-finder").click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 20_000 });
    await settle(500);
    const tabletPortrait = await read();
    if (
      tabletPortrait.finderDeviceClass !== "handheld" ||
      tabletPortrait.finderMode !== "targeted" ||
      tabletPortrait.finderCameraState !== "off" ||
      tabletPortrait.finderVisualBase !== "rendered-sky" ||
      tabletPortrait.finderStarCount < 8 ||
      !tabletPortrait.finderCameraControlPresent ||
      tabletPortrait.finderGuidanceControlPresent ||
      !tabletPortrait.finderPermissionAttempts.includes("orientation") ||
      tabletPortrait.finderPermissionAttempts.includes("camera")
    ) {
      throw new Error(`Tablet portrait Finder capability failed: ${JSON.stringify(tabletPortrait)}`);
    }
    await captureSurface("tracker-tablet-sky", tabletPortrait);

    await page.setViewportSize({ width: 1180, height: 820 });
    await settle(700);
    const tabletLandscape = await read();
    if (
      tabletLandscape.finderDeviceClass !== "handheld" ||
      tabletLandscape.finderMode !== "targeted" ||
      tabletLandscape.finderCameraState !== "off" ||
      tabletLandscape.finderVisualBase !== "rendered-sky"
    ) {
      throw new Error(`Tablet landscape Finder policy failed: ${JSON.stringify(tabletLandscape)}`);
    }
    await captureSurface("tracker-tablet-landscape-live-finder", tabletLandscape);

    // 13. A touch-first tablet without camera or orientation capabilities still
    // owns the rendered celestial browser. Later init scripts deliberately
    // replace the earlier review capabilities before the next navigation.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
      Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: undefined });
      Object.defineProperty(window, "DeviceMotionEvent", { configurable: true, value: undefined });
    });
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(
      `${trackerReviewScenario.reviewUrl}&at=${encodeURIComponent(REVIEW_PIN)}` +
        `&z=8&pin=${encodeURIComponent(REVIEW_PIN)}&card=${DETAIL_CARD}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.locator(`.tk-map-recommendation[data-card="${DETAIL_CARD}"]`).waitFor({ timeout: 30_000 });
    await settle(900);
    const unsupportedTablet = await read();
    if (
      !unsupportedTablet.skyTabPresent ||
      !unsupportedTablet.liveFinderEntryPresent ||
      unsupportedTablet.finderPermissionAttempts.length > 0
    ) {
      throw new Error(`Sensorless tablet lost rendered Sky: ${JSON.stringify(unsupportedTablet)}`);
    }
    await page.getByRole("button", { name: "Sky", exact: true }).click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 20_000 });
    await settle(500);
    const sensorlessSky = await read();
    if (
      sensorlessSky.finderDeviceClass !== "handheld" ||
      sensorlessSky.finderMode !== "browse" ||
      sensorlessSky.finderCameraControlPresent ||
      sensorlessSky.finderCameraState !== "off" ||
      sensorlessSky.finderVisualBase !== "rendered-sky" ||
      sensorlessSky.finderStarCount < 8 ||
      sensorlessSky.finderPermissionAttempts.length > 0
    ) {
      throw new Error(`Sensorless tablet rendered Sky failed: ${JSON.stringify(sensorlessSky)}`);
    }
    await captureSurface("tracker-sensorless-tablet-rendered-sky", sensorlessSky);
  },
};
