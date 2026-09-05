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
 *   map → select location → observing rail → expand → full detail → Back to map
 *
 * ## State is read from the URL, not from the DOM
 *
 * Tracker serialises its own state into the query string — `pin`, `date`,
 * `show`, `event`, `card`, `globe`, `with`, `layers`. That is the product's own
 * contract with the reader's address bar, so it is the thing worth asserting:
 * it survives restyling, and it says what Tracker *means* rather than which
 * element happened to carry a class this week. The DOM is consulted only for
 * what genuinely is not in the URL — whether a surface is open, what the rail
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

      // The map-first controls, by the names a reader reaches them by.
      controls: {
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
      projection: params.get("globe") === "1" ? "globe" : "flat",
      equipment: params.get("with") ?? "eyes",
      layers: (params.get("layers") ?? "").split(",").filter(Boolean),

      // What the reader can actually see of it.
      placeLabel: document.querySelector(".tracker-place-name")?.textContent?.trim() ?? null,
      dateLabel: document.querySelector(".tk-date-label")?.textContent?.trim() ?? null,
      openSurface,
      placeSearchPresent: Boolean(document.querySelector(".tracker-place-combobox input")),
      eventSearchPresent: Boolean(document.querySelector('.tk-eventfinder-open input[type="search"]')),
      railPresent: Boolean(document.querySelector(".tk-rail")),
      railCards: [...document.querySelectorAll(".tk-rail-card")].map((card) => ({
        id: card.getAttribute("data-card"),
        reason: card.getAttribute("data-reason"),
        expanded: card.getAttribute("data-expanded") === "true",
        name: card.querySelector(".tk-rail-card-name")?.textContent?.trim() ?? null,
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
  if (state.mapState !== "map") failures.push(`not-map-first:${state.mapState}`);
  if (!state.mapPresent) failures.push("map-canvas-missing");
  for (const [name, present] of Object.entries(state.controls ?? {})) {
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

/** The rail, checked by which opportunities it names rather than how many. */
export function trackerRailValidation(state, expectedCards) {
  const failures = trackerShellValidation(state).failures.slice();
  if (!state.railPresent) failures.push("rail-missing");
  const offered = state.railCards.map((card) => card.id);
  for (const expected of expectedCards) {
    if (!offered.includes(expected)) failures.push(`opportunity-missing:${expected}`);
  }
  const expanded = state.railCards.filter((card) => card.expanded).map((card) => card.id);
  if (expanded.length > 1) failures.push(`multiple-cards-expanded:${expanded.join("+")}`);
  if (state.expandedCard && expanded[0] !== state.expandedCard) {
    failures.push(`expanded-card-disagrees-with-url:${expanded[0]}!=${state.expandedCard}`);
  }
  return { ...state, offered, expanded, pass: failures.length === 0, failures };
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
async function stubGeocoder(context) {
  await context.route("https://photon.komoot.io/api/**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
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

async function stubEnvironment(context) {
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
      "Map-first Tracker: the map is the canvas, and location, night, equipment and layers are chosen over it",
      "Place selection through the map's own picker, with the search revealed by the trigger rather than always present",
      "An observing rail of ranked opportunities for the selected place and night, one expanded at a time",
      "Full event detail entered from the rail, with Back restoring the map, the place, the night and the open card",
      "Notable-event search that moves the map and the night to the event while keeping the observing location",
      "Equipment-aware ranking, with telescope-only targets appearing only under a telescope",
    ],
    knownLimitations: [
      "The basemap is stubbed to an empty style so a run cannot depend on a tile provider; the map chrome, pin and overlays are real, the streets are not drawn.",
      "Weather, air quality and the aurora nowcast are deliberately refused, so this package shows Tracker degrading honestly rather than a forecast.",
      "Cloud and light-pollution layer behaviour is certified by their own gates; this scenario only proves the layer surface opens and closes without losing state.",
    ],
    expectedReviewFocus: [
      "Verify the map is still the primary canvas at every step short of full detail.",
      "Verify the place search does not exist until the location trigger is opened.",
      "Verify Back from full detail restores the place, the night and the expanded card.",
      "Verify a telescope adds targets the naked eye is not offered.",
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
    await page.clock.setFixedTime(REVIEW_AT);
    await stubTracker(context, {
      basemap: "empty",
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
    await page.locator(".tk-rail").waitFor({ timeout: 30_000 });
    await settle(2_500);

    const located = assertPass(
      trackerRailValidation(await read(), EXPECTED_NAKED_EYE_CARDS),
      "Selecting a location did not produce the expected observing rail",
    );
    if (located.pin !== REVIEW_PIN) {
      throw new Error(`The selected location is not in Tracker's own state: pin=${located.pin}`);
    }
    if (located.placeLabel !== PORTLAND.name) {
      throw new Error(`The map does not show the selected place: ${located.placeLabel}`);
    }
    await captureSurface("tracker-location-selected", located);

    // 3. The night is deterministic, moves, and does not disturb the place.
    if (!/Sep 2, 2026/.test(located.dateLabel ?? "")) {
      throw new Error(`The pinned clock did not produce a deterministic night: ${located.dateLabel}`);
    }
    await page.getByRole("button", { name: "Next night" }).click();
    await settle(2_500);
    const advanced = await read();
    if (advanced.date !== NEXT_NIGHT) throw new Error(`Next night did not advance: ${advanced.date}`);
    if (advanced.pin !== REVIEW_PIN) throw new Error("Changing the night lost the selected location.");
    if (advanced.mapState !== "map") throw new Error("Changing the night left the map.");
    await captureSurface("tracker-night-advanced", advanced);
    await page.getByRole("button", { name: "Previous night" }).click();
    await settle(2_500);
    const returned = await read();
    if (returned.date && returned.date !== REVIEW_NIGHT) {
      throw new Error(`Previous night did not return to the pinned night: ${returned.date}`);
    }

    // 4. A card expands through the product's own control, and only one does.
    await page.locator(`.tk-rail-card[data-card="${DETAIL_CARD}"] .tk-rail-card-head`).click();
    await settle(1_200);
    const expanded = assertPass(
      trackerRailValidation(await read(), EXPECTED_NAKED_EYE_CARDS),
      "Expanding an opportunity broke the rail",
    );
    if (expanded.expandedCard !== DETAIL_CARD) {
      throw new Error(`Expanding a card did not record it: card=${expanded.expandedCard}`);
    }
    if (expanded.mapState !== "map") throw new Error("Expanding a card replaced the map.");
    await captureSurface("tracker-rail-expanded", expanded);

    // 5. Full detail, and the way back.
    const beforeDetail = await read();
    await page.getByRole("button", { name: /View full details/i }).click();
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
    await captureSurface("tracker-event-detail", detail);

    await page.getByRole("button", { name: /Back to the map/i }).click();
    await page.waitForFunction(
      () => document.querySelector(".tracker-shell")?.getAttribute("data-map-state") === "map",
      undefined,
      { timeout: 30_000 },
    );
    await settle(2_500);
    const restored = assertPass(
      trackerBackToMapValidation(beforeDetail, await read()),
      "Back from full detail did not restore the map the reader left",
    );
    await captureSurface("tracker-back-to-map", restored);

    // 6. A telescope is offered what the eyes are not.
    await page.getByRole("button", { name: /Observing with: .*Change/ }).click();
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
    // The panel closes on choosing, so going back to the eyes reopens it.
    await page.getByRole("button", { name: /Observing with: .*Change/ }).click();
    await settle(600);
    await page.getByRole("switch", { name: /Naked eye/i }).click();
    await settle(3_000);
    const eyesAgain = await read();
    if (eyesAgain.equipment !== "eyes") {
      throw new Error(`Returning to the naked eye did not take: with=${eyesAgain.equipment}`);
    }

    // 7. Layers open and close over the map without costing the reader anything.
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

    // 8. Projection is a state, not a label.
    await page.getByRole("radio", { name: /Globe \(3D\)/i }).click();
    await settle(2_500);
    const globe = await read();
    if (globe.projection !== "globe") throw new Error("The 3D control did not change the projection.");
    if (globe.pin !== REVIEW_PIN || globe.expandedCard !== beforeLayers.expandedCard) {
      throw new Error("Switching to the globe lost the reader's place or open card.");
    }
    await captureSurface("tracker-projection-globe", globe);
    await page.getByRole("radio", { name: /Flat map \(2D\)/i }).click();
    await settle(2_000);
    const flat = await read();
    if (flat.projection !== "flat") throw new Error("The 2D control did not restore the flat map.");

    // 9. Finding a notable event moves the map and the night to it, and keeps
    //    the observing location, which is a different question from where the
    //    map is looking.
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
    if (!found.railPresent) throw new Error("Choosing an event removed the observing rail.");
    await captureSurface("tracker-event-selected", found);
  },
};
