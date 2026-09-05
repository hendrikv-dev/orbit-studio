import process from "node:process";
import { chromium } from "playwright";
import { TRACKER_FIXTURE_AT } from "./tracker-fixtures.mjs";
import { preview } from "vite";
import AxeBuilder from "@axe-core/playwright";

/**
 * The accessibility gate.
 *
 * Written after an audit found the place picker was not operable without a
 * mouse: no combobox role, no accessible name, no arrow keys, Escape doing
 * nothing. Everything in that list was fixed by hand and nothing stopped it
 * coming back.
 *
 * ## What this can and cannot do
 *
 * axe-core catches a minority of accessibility problems — it found exactly one
 * violation type in the audit that produced this file, while the serious faults
 * were invisible to it because a custom widget gives an automated checker
 * nothing to compare against. So this gate does two different jobs:
 *
 * 1. **axe-core** over each state, for the things a machine can judge:
 *    contrast, names, roles, landmark and heading structure.
 * 2. **Explicit assertions** on the interactions that were actually broken.
 *    A combobox that loses `aria-activedescendant`, or an Escape key that stops
 *    closing the panel, is a regression axe would report as clean.
 *
 * States matter as much as pages. The audit's violations were all in the
 * *loaded* view and the picker's failures were all in its *open* state, so
 * checking the first screen alone would have passed while the product was
 * broken.
 *
 * ## No network
 *
 * The geocoder and the forecast are both stubbed. A gate that calls somebody
 * else's free service goes red when that service has a bad afternoon, and a
 * gate that goes red for reasons unrelated to the change is one people learn to
 * ignore. Stubbing also keeps continuous integration from putting traffic on
 * services this project is a guest of. The component code under test is
 * unchanged — only the responses are fixed.
 */

/**
 * Fixed responses, shaped exactly like the providers'.
 *
 * The geocoder result deliberately has no `name` — it is a plain street
 * address, the case that used to be discarded and report "Nothing found".
 */
/**
 * The instant every page in this run is rendered at.
 *
 * ## Why the clock is pinned
 *
 * The fixture location is a campsite near Joshua Tree, and Tracker correctly
 * shows nothing to recommend once that location's night has ended — so the
 * recommendation page has no hero, and every scan that waits for one times out.
 * Run this gate at 22:00 and it passes; run it at 05:59 and it fails, on
 * identical code. That is not an accessibility result.
 *
 * Late evening local time, on whatever day the gate runs, so the sky is dark
 * and there is a recommendation to inspect. The fixture is the clock, not the
 * astronomy: everything below is still computed from the real ephemeris for
 * that instant.
 */
/**
 * The instant this gate is written against, shared with the Tracker review so
 * the two cannot drift. Every fixture below is stamped from it rather than from
 * the wall clock: a pinned page clock and wall-clock fixture data disagree by
 * however far the run happens to be from the pinned hour, and that gap is what
 * silently changed which sky this gate was scanning.
 */
const RUN_AT = TRACKER_FIXTURE_AT;

const PLACE_FIXTURE = {
  features: [
    {
      properties: {
        osm_id: 1,
        osm_type: "N",
        name: "Joshua Tree Village Campground",
        city: "Joshua Tree",
        county: "San Bernardino County",
        state: "California",
        country: "United States",
        osm_value: "camp_site",
      },
      geometry: { type: "Point", coordinates: [-116.313, 34.135] },
    },
    {
      properties: {
        osm_id: 2,
        osm_type: "N",
        housenumber: "16",
        street: "Ash Tree Grove",
        city: "Leeds",
        postcode: "LS14 5LT",
        osm_value: "house",
      },
      geometry: { type: "Point", coordinates: [-1.4409, 53.8192] },
    },
  ],
};

/** Hourly cover for the next two days, which outlasts any observing night. */
function forecastFixture() {
  const start = new Date(RUN_AT);
  start.setUTCMinutes(0, 0, 0);
  const values = (value) =>
    Array.from({ length: 48 }, (_, hour) => ({
      validTime: `${new Date(start.getTime() + hour * 3_600_000).toISOString().slice(0, 19)}+00:00/PT1H`,
      value,
    }));
  return {
    properties: {
      updateTime: RUN_AT.toISOString(),
      skyCover: { values: values(18) },
      temperature: { values: values(14) },
      probabilityOfPrecipitation: { values: values(5) },
      relativeHumidity: { values: values(60) },
    },
  };
}

/** Installs the stubs on a context, before any page in it loads. */
/**
 * A valid MapLibre style with nothing in it.
 *
 * The gate is about whether the interface can be operated, not about what the
 * cartography looks like, and a real basemap costs it the two things a gate
 * most needs: determinism and an end. Tiles stream continuously, so the network
 * never falls idle and the run never finishes; they also come from somebody
 * else's server, which is the dependency that has broken this project's gates
 * before. A background layer is enough for the map to load, fire its events and
 * settle, which is all the assertions below actually rest on.
 */
const EMPTY_BASEMAP_STYLE = {
  version: 8,
  name: "gate",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#11151f" } }],
};

async function stubProviders(context) {
  await context.route("**/tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_BASEMAP_STYLE),
    }),
  );
  // No orbits: a contrast scan should not depend on whether a spacecraft went
  // over the test location this morning, and CelesTrak asks consumers to fetch
  // only what they are going to use.
  await context.route("**/celestrak.org/**", (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "" }),
  );
  await context.route("**/photon.komoot.io/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PLACE_FIXTURE) }),
  );
  await context.route("**/api.weather.gov/points/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        properties: { forecastGridData: "https://api.weather.gov/gridpoints/TEST/1,1" },
      }),
    }),
  );
  await context.route("**/api.weather.gov/gridpoints/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(forecastFixture()) }),
  );
  /**
   * The cloud mask, in all three shapes the layer asks for.
   *
   * Stubbed rather than skipped because the cloud key is the only place in
   * Tracker with a slider in it, and a control that never renders during the
   * scan is a control nobody has checked.
   */
  await context.route("**/api/goes-cloud-mask*", (route) => {
    const url = new URL(route.request().url());
    const head = {
      satellite: "GOES-West",
      platform: "G18",
      scene: "CONUS",
      product: "ABI-L2-ACMC (Clear Sky Mask)",
      resolution: "2.0km at nadir",
      observedUtc: RUN_AT.toISOString(),
      probabilityScale: 1.5261e-5,
    };
    if (url.searchParams.get("series") === "1") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...head,
          frames: [0, 0, 2, 3].map((acm, index) => ({
            observedUtc: new Date(RUN_AT.getTime() - (3 - index) * 600_000).toISOString(),
            covered: true,
            acm,
            cloudProbabilityRaw: 51154,
            dqf: 0,
            probabilityScale: head.probabilityScale,
          })),
        }),
      });
    }
    if (url.searchParams.get("bbox")) {
      /**
       * No field for the map, deliberately.
       *
       * This scan is about the key's markup — the slider's name, its spoken
       * value, and the strip being hidden from a screen reader — none of which
       * depends on pixels being painted. Faking a covered window would mean
       * duplicating the fixed-grid geolocation here to make it land in the
       * right place, which is the refinement gate's job and is tested there.
       */
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...head, covered: false }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...head,
        covered: true,
        cell: { column: 1768, row: 162 },
        acm: 2,
        cloudProbabilityRaw: 51154,
        dqf: 0,
      }),
    });
  });
  await context.route("**/api.open-meteo.com/v1/forecast**", (route) => {
    const url = new URL(route.request().url());
    const latitudes = (url.searchParams.get("latitude") ?? "").split(",");
    const start = url.searchParams.get("start_hour") ?? "2026-09-03T04:00";
    const end = url.searchParams.get("end_hour") ?? start;
    const hours = [];
    for (let at = Date.parse(`${start}:00Z`); at <= Date.parse(`${end}:00Z`); at += 3_600_000) {
      hours.push(new Date(at).toISOString().slice(0, 16));
    }
    const body =
      latitudes.length > 1
        ? Array.from({ length: latitudes.length }, () => ({
            hourly: { time: [start], cloud_cover: [64] },
          }))
        : { hourly: { time: hours, cloud_cover: hours.map(() => 64) } };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await context.route("**/api.met.no/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        properties: {
          meta: { updated_at: RUN_AT.toISOString() },
          timeseries: Array.from({ length: 48 }, (_, hour) => ({
            time: new Date(RUN_AT.getTime() + hour * 3_600_000).toISOString(),
            data: {
              instant: { details: { air_temperature: 14, cloud_area_fraction: 18 } },
              next_1_hours: { details: { precipitation_amount: 0 } },
            },
          })),
        },
      }),
    }),
  );
}

// Written out rather than interpolated, so the provenance scanner can read the
// host it is about to see in the source and match it against the documented
// list. A template literal reads as an invalid URL to it.
const PREVIEW_ORIGIN = "http://127.0.0.1:4181";
const PREVIEW_PORT = Number(new URL(PREVIEW_ORIGIN).port);
const TRACKER = `${PREVIEW_ORIGIN}/?app=tracker`;

/** WCAG 2.1 A and AA, which is the level the interface claims. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Whether anything in the product routes to the Upcoming browse.
 *
 * Nothing does. The date control replaced it: a future night is this night with
 * a different date, on the same map. The blocks below that scan its list and
 * its calendar are kept rather than deleted — the view still exists, its
 * accessibility work was real, and the decision to retire it as a destination
 * is one the product may revisit — but they cannot run against an interface
 * that has no way in, and a gate that dies halfway through tests nothing after
 * the point it stopped.
 *
 * Flip this to `true` the day something routes to Upcoming again.
 */
const UPCOMING_IS_ROUTED = false;

const failures = [];
const checked = [];

function record(state, results) {
  checked.push(`${state} (${results.violations.length})`);
  for (const violation of results.violations) {
    const where = violation.nodes
      .slice(0, 3)
      .map((node) => node.target.join(" "))
      .join("; ");
    failures.push(
      `${state}: ${violation.id} [${violation.impact}] x${violation.nodes.length} — ${violation.help}\n    ${where}`,
    );
  }
}

async function scan(page, state, disabledRules = []) {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (disabledRules.length > 0) builder = builder.disableRules(disabledRules);
  const results = await builder.analyze();
  record(disabledRules.length > 0 ? `${state} [-${disabledRules.join(",")}]` : state, results);
}

/**
 * `aria-hidden-focus`, disabled for the open inline combobox only.
 *
 * React Aria's combobox calls ariaHideOutside whenever its list is open: while
 * you are choosing a suggestion, the rest of the page is hidden from assistive
 * technology, exactly as a modal does. On the entry screen the combobox lives
 * in the document rather than in a dialog, so what gets hidden is the page
 * itself — including the skip link and the photograph's credit link, which stay
 * focusable. axe reads that snapshot and reports focusable elements inside an
 * aria-hidden subtree.
 *
 * Nobody can reach them. Tab from the open list closes it, which un-hides
 * everything before focus moves. That is a claim about behaviour rather than
 * about markup, so it is not left as a comment: assertTabLeavesNothingHidden
 * checks it, and it is checked in place of the rule, not as well as suppressing
 * it quietly. The rule stays on for every other state, including the header
 * picker, which does not hide the page at all.
 */
const INLINE_COMBOBOX_RULE = "aria-hidden-focus";

async function assertTabLeavesNothingHidden(page) {
  expect(
    await page.evaluate(() => document.querySelectorAll('[aria-hidden="true"]').length > 0),
    "the open inline combobox should hide the page from assistive technology",
  );
  await page.keyboard.press("Tab");
  // React Aria removes the overlay and restores aria-hidden in its layout
  // effect. Wait for that committed state rather than sampling between the
  // native Tab event and React's cleanup.
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[role="option"]').length === 0 &&
      !document.activeElement?.closest('[aria-hidden="true"]'),
    null,
    { timeout: 1_000 },
  ).catch(() => {});
  const after = await page.evaluate(() => ({
    listOpen: document.querySelectorAll('[role="option"]').length > 0,
    focusHidden: Boolean(document.activeElement?.closest('[aria-hidden="true"]')),
    focusExists: document.activeElement !== document.body,
    active: {
      tag: document.activeElement?.tagName,
      className: document.activeElement?.className,
      role: document.activeElement?.getAttribute("role"),
      text: document.activeElement?.textContent?.trim().slice(0, 80),
    },
  }));
  expect(!after.listOpen, `Tab should close the suggestion list rather than move into it (${JSON.stringify(after.active)})`);
  expect(after.focusExists, "Tab should move focus somewhere, not drop it on the body");
  expect(
    !after.focusHidden,
    `Tab out of the suggestion list must not land on an aria-hidden element (${JSON.stringify(after.active)})`,
  );
}

/** Fails loudly rather than silently passing when an expectation is not met. */
function expect(condition, message) {
  if (!condition) failures.push(`interaction: ${message}`);
}

/**
 * Drives the picker to a chosen place.
 *
 * Uses real keyboard input throughout, because that is the thing that was
 * broken and because synthetic events do not exercise React Aria's press and
 * focus handling — a `.click()` on an option does nothing at all.
 *
 * The same panel appears in two forms. On the entry screen it is inline: there
 * is no trigger and nothing to open, because asking somebody to open a dialog
 * before they can type a place name was the extra step the entry rebuild
 * removed. In the header, after a place exists, it is still a popover behind a
 * trigger. Both are driven here, from the same assertions, so neither can lose
 * its keyboard behaviour unnoticed.
 */
async function chooseFirstResult(page, query) {
  const inline = (await page.locator(".tk-locate").count()) > 0;
  if (!inline) {
    await page.locator(".tracker-place-current").first().click();
    await page.waitForSelector(".tracker-place-panel");
  }

  const input = page.locator(".tracker-place-search input");
  // Only the popover moves focus on open. The inline field is already in the
  // page and stealing focus into it on load would fight a screen reader
  // working through the headline above it.
  if (!inline) {
    expect(
      await input.evaluate((el) => el === document.activeElement),
      "opening the picker should focus the search field",
    );
  }
  expect(
    (await input.getAttribute("role")) === "combobox",
    "the search field should expose role=combobox",
  );
  expect(
    Boolean(await input.getAttribute("aria-label")) ||
      Boolean(await input.getAttribute("aria-labelledby")),
    "the search field should have an accessible name, not just a placeholder",
  );

  await input.click();
  await input.fill(query);
  await page.waitForSelector('[role="option"]', { timeout: 20_000 });
  await scan(page, "picker open with results", inline ? [INLINE_COMBOBOX_RULE] : []);

  if (inline) {
    await assertTabLeavesNothingHidden(page);
    // Tab closed the list. Reopen it and carry on with the selection. Focus
    // alone is not enough to reopen a list the user has just dismissed, so the
    // query is retyped.
    await input.click();
    await input.fill("");
    await input.fill(query);
    await page.waitForSelector('[role="option"]', { timeout: 20_000 });
  }

  await page.keyboard.press("ArrowDown");
  const active = await input.getAttribute("aria-activedescendant");
  expect(Boolean(active), "arrow keys should move aria-activedescendant");
  if (active) {
    // Resolved in the page, because `CSS.escape` is a DOM API and React Aria's
    // generated ids contain colons that a bare selector cannot carry.
    expect(
      await page.evaluate((id) => Boolean(document.getElementById(id)), active),
      "aria-activedescendant should point at an element that exists",
    );
    expect(
      await page.evaluate(
        (id) => document.getElementById(id)?.getAttribute("role") === "option",
        active,
      ),
      "aria-activedescendant should point at an option",
    );
  }

  await page.keyboard.press("Enter");
  /**
   * Straight to the map's panel; there is no confirmation step any more.
   *
   * Selecting a place used to ask "use this place?" before computing anything.
   * On a map the pin is the location, a wrong one costs a click, and Back
   * returns to the previous one — so the extra press ratified a decision that
   * was never hard to reverse, and it disagreed with a click on the map, which
   * had always committed immediately.
   */
  await page.waitForSelector(".tk-rail", { timeout: 30_000 });
  // The place itself now lives in the top bar rather than at the head of a
  // panel, so that is where "a place is selected" is proved.
  await page.waitForSelector(".tk-map-topbar-lead", { timeout: 30_000 });
}

/**
 * The one deliberate step from the map into the full event page.
 *
 * The page-based views did not go away when the map arrived — they are what the
 * drill-in opens — so the assertions about them below are still the assertions
 * this gate should be making. What changed is only how a reader reaches them.
 */
async function openDetail(page) {
  // A rail card is a summary until it is opened, and the link into the full
  // event page lives inside the expanded card. That is one more click than the
  // panel needed, and it is the point: the rail answers most questions without
  // leaving the map, so the page is reached deliberately.
  //
  // The head is a toggle, so a card that is already open must not be clicked
  // again — returning from a detail view restores the card that was open, and
  // a blind click there would close it and then wait forever for its link.
  await page.waitForSelector(".tk-rail-card", { timeout: 30_000 });
  if ((await page.locator('.tk-rail-card[data-expanded="true"]').count()) === 0) {
    await page.locator(".tk-rail-card .tk-rail-card-head").first().click();
  }
  await page.waitForSelector(".tk-rail-details", { timeout: 30_000 });
  await page.locator(".tk-rail-details").first().click();
  await page.waitForSelector(".tracker-hero .tk-hero-name", { timeout: 30_000 });
}

/** Back out of the event page to the map that opened it. */
async function backToMap(page) {
  await page.goBack();
  await page.waitForSelector(".tk-rail", { timeout: 30_000 });
}

/** Waits for the worker-backed future view to finish without mistaking its
 * deliberately immediate progress UI for completed content. */
async function waitForPlanning(page, selector) {
  await page.waitForSelector(`${selector}[data-planning-state="ready"]`, { timeout: 30_000 });
}

/** Horizontal clipping was invisible to `scrollWidth` because the shell hid
 * overflow. Measure the visible boxes that actually carry the application. */
async function visibleBounds(page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const selectors = [
      ".tracker-bar",
      ".tracker-shell",
      // The map's own furniture. The surface fills the viewport by design, so
      // what is worth measuring is the rail and the things floating on it.
      ".tk-rail",
      ".tk-map-topbar",
      ".tk-map-controls-view",
      ".tk-callout",
      ".tk-page-heading",
      ".tk-hero",
      ".tk-viz-slot",
      ".tk-conditions",
      ".tk-tonight",
      ".tk-upcoming",
      ".tk-upcoming-bar",
      ".tk-highlights",
      ".tk-month",
    ];
    const boxes = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: element.className,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      });
    return { viewportWidth, boxes };
  });
}

function assertNoHorizontalClipping(result, state) {
  for (const box of result.boxes) {
    expect(box.left >= -1, `${state}: ${box.selector} should not start outside the viewport`);
    expect(
      box.right <= result.viewportWidth + 1,
      `${state}: ${box.selector} should not end outside the viewport`,
    );
  }
}

async function run() {
  let server = null;
  let browser = null;
  try {
    server = await preview({
      root: process.cwd(),
      preview: { host: "127.0.0.1", port: PREVIEW_PORT, strictPort: true },
    });
    browser = await chromium.launch({ headless: true });

    // --- desktop -------------------------------------------------------
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await stubProviders(desktop);
    const page = await desktop.newPage();
    await page.clock.setFixedTime(RUN_AT);
    await page.goto(TRACKER, { waitUntil: "domcontentloaded" });
    await scan(page, "entry");

    /**
     * The entry screen is the map, and it has to be usable before Tracker knows
     * anything about the reader.
     *
     * This replaces a check that the entry previewed a ranked list. That screen
     * is gone: the map is the workspace now, and what has to be true on arrival
     * is that there is something to look at, a way to say where you are, and a
     * way to move around — none of which may wait on a place being chosen.
     */
    await page.waitForSelector('.tk-map-canvas[data-map-settled="true"]', { timeout: 60_000 });
    expect(
      (await page.locator(".tk-map-surface").count()) === 1,
      "the entry screen should be the map itself",
    );
    expect(
      (await page.locator(".tracker-place-current").count()) === 1,
      "the map should offer a way to say where you are before any place is known",
    );
    expect(
      (await page.locator(".tk-map-control").count()) >= 3,
      "the map's own controls should be present on arrival",
    );

    /* --- the date control, which replaced the Tonight/Upcoming tabs --------
     *
     * Time is a parameter of the map now rather than a destination, so the
     * control that changes it has to be operable without a mouse and has to
     * say which night it is showing. The tabs it replaced must be gone: two
     * ways to express "when", one of them a navigation, is the ambiguity this
     * form factor exists to remove.
     */
    expect(
      (await page.locator(".tk-map-shell .tk-date").count()) === 1,
      "the map should carry a single date control",
    );
    expect(
      (await page.locator(".tk-map-shell .tk-map-modes").count()) === 0,
      "the map shell should no longer carry Tonight/Upcoming tabs",
    );
    for (const name of ["Previous night", "Next night"]) {
      expect(
        (await page.locator(`.tk-map-shell [aria-label="${name}"]`).count()) === 1,
        `the date control needs a labelled ${name} action`,
      );
    }
    /* --- the month calendar -------------------------------------------------
     *
     * The date used to be a label with a transparent `<input type="date">`
     * stretched over it, and this checked that input's `max`. The input is
     * gone: the date is a button that opens Tracker's own month, so the bound
     * is now expressed by the cells themselves and by the paging controls.
     */
    expect(
      (await page.locator(".tk-date-field[aria-haspopup='dialog']").count()) === 1,
      "the date itself should open the calendar",
    );
    await page.locator(".tk-date-field").click();
    await page.waitForSelector(".tk-cal", { timeout: 5_000 });
    await scan(page, "month calendar open");
    expect(
      (await page.locator(".tk-cal[role='dialog'][aria-label]").count()) === 1,
      "the calendar needs an accessible name",
    );
    expect(
      (await page.locator(".tk-cal-day").count()) === 42,
      "the calendar shows six whole weeks, so its height never changes",
    );
    expect(
      (await page.locator('.tk-cal-day[tabindex="0"]').count()) === 1,
      "the grid is one tab stop, with a roving focus inside it",
    );
    expect(
      await page.evaluate(() => document.activeElement?.classList.contains("tk-cal-day")),
      "opening the calendar should put focus on a day",
    );
    // Every cell carries a full date, so the range bound is expressible.
    expect(
      (await page.locator(".tk-cal-day[aria-label]").count()) === 42,
      "every day needs its own accessible name",
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect((await page.locator(".tk-cal").count()) === 0, "Escape should close the calendar");
    expect(
      await page.evaluate(() => document.activeElement?.classList.contains("tk-date-field")),
      "closing the calendar should hand focus back to the control that opened it",
    );

    /* --- the layer control -------------------------------------------------
     *
     * One control that opens a panel, rather than a chip per layer. The rows
     * inside are switches, so they report state rather than merely looking
     * pressed, and each is named in text rather than by icon alone.
     */
    expect(
      (await page.locator(".tk-layers-trigger").count()) === 1,
      "the map should offer one layer control",
    );
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5_000 });
    const rows = page.locator(".tk-layers-item");
    expect((await rows.count()) > 0, "the layer panel should list layers");
    for (let index = 0; index < (await rows.count()); index += 1) {
      const row = rows.nth(index);
      expect(
        ["true", "false"].includes((await row.getAttribute("aria-checked")) ?? ""),
        "every layer row should report whether it is on",
      );
      expect(
        ((await row.textContent()) ?? "").trim().length > 0,
        "every layer row should be named in text, not by icon alone",
      );
    }
    await scan(page, "layer panel open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(
      (await page.locator(".tk-rail").count()) === 0,
      "nothing should claim to be a selected location before one is selected",
    );

    await chooseFirstResult(page, "Joshua Tree Village Campground");
    await scan(page, "map with a location selected");

    /* --- the cloud key, which is the one control here with a slider in it ---
     *
     * A time scrubber has an accessible name and a spoken value or it is a
     * mystery to anybody not looking at it, and the strip beside it is a
     * picture that must not be read out cell by cell. Neither can be checked
     * on a page where the layer was never switched on, which is why this state
     * exists at all.
     *
     * Switched on through the panel rather than by loading a URL with the layer
     * in it: this scan sits in the middle of a long linear flow, and navigating
     * away would quietly change the place and the date every later state is
     * written against. It is also the path a reader actually takes.
     */
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5_000 });
    const cloudRow = page.locator(".tk-layers-item", { hasText: "Cloud viewing conditions" });
    if ((await cloudRow.count()) === 1 && (await cloudRow.getAttribute("aria-checked")) === "false") {
      await cloudRow.click();
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(4_000);
    const cloudKey = await page.locator(".tk-cloud-key").count();
    expect(cloudKey === 1, "the cloud key should be on the map while the layer is on");
    const scrub = page.locator(".tk-cloud-scrub");
    if (await scrub.count()) {
      const named = await scrub.evaluate((node) => {
        const label = node.labels?.[0];
        return {
          name: (label?.textContent ?? node.getAttribute("aria-label") ?? "").trim(),
          spoken: (node.getAttribute("aria-valuetext") ?? "").trim(),
        };
      });
      expect(named.name.length > 0, "the cloud scrubber should have an accessible name");
      expect(
        named.spoken.length > 0,
        "and should say what it is pointing at, not just a slider position",
      );
      const strip = await page.locator(".tk-cloud-strip").getAttribute("aria-hidden");
      expect(
        strip === "true",
        "the strip is a picture and should not be read out one cell at a time",
      );
    }
    await scan(page, "cloud layer on, with its timeline");
    /*
      Off again, so the rest of the flow sees the map it was written against.
    */
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5_000 });
    if ((await cloudRow.count()) === 1 && (await cloudRow.getAttribute("aria-checked")) === "true") {
      await cloudRow.click();
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    /* --- the picker, on the map ------------------------------------------
     *
     * Checked here rather than after the drill-in: there are two of these on a
     * page once an event is open, the map's and the event header's, and the
     * event page covers the map. Testing `.first()` from inside the detail
     * view was therefore clicking at a control behind an overlay, which
     * Playwright correctly refuses to do.
     */
    await page.locator(".tracker-place-current").first().click();
    await page.waitForSelector(".tracker-place-panel");
    await scan(page, "header picker open");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".tracker-place-panel", { state: "detached", timeout: 5000 });
    // Checked against the trigger itself. An earlier version of this assertion
    // looked for a `.tracker-place` wrapper that the React Aria rebuild had
    // removed, and reported a failure against code that was working.
    /**
     * Waited for, not sampled once.
     *
     * React Aria restores focus asynchronously after the popover unmounts, and
     * this read happened immediately after the panel detached — so on a loaded
     * machine it could look at `document.activeElement` before the restore had
     * run and report a failure against code that works. The requirement is
     * unchanged and is still asserted: focus must come back to the trigger. It
     * is simply allowed to take a frame or two to get there.
     */
    await page
      .waitForFunction(
        () => Boolean(document.activeElement?.classList.contains("tracker-place-current")),
        undefined,
        { timeout: 5000 },
      )
      .catch(() => {});
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.classList.contains("tracker-place-current")),
      ),
      "Escape should return focus to the picker trigger",
    );

    assertNoHorizontalClipping(await visibleBounds(page), "1440px map with panel");

    await openDetail(page);
    await scan(page, "recommendation");

    /* --- Back is the browser's Back ---------------------------------------
     *
     * Drilling into an event pushes one entry, and going back returns to the
     * map with the same location still selected. Asserted here rather than only
     * in the walkthrough because a product that breaks the back button is an
     * accessibility problem before it is anything else: Back is how a great
     * many people undo, and a swallowed one strands them.
     */
    await backToMap(page);
    expect(
      (await page.locator(".tracker-hero .tk-hero-name").count()) === 0,
      "Back should leave the event page",
    );
    expect(
      (await page.locator(".tk-map-topbar-lead").count()) > 0,
      "Back should return to the map with the same location still selected",
    );
    await openDetail(page);

    // Decision support must precede the reminder in the document as well as
    // visually. The old verifier clicked a disclosure removed by the Phase 1
    // redesign and therefore never inspected a current production state.
    const decisionOrder = await page.evaluate(() => {
      const expectation = document.querySelector(".tracker-expect");
      const mediaExpectation = document.querySelector(".tk-media-expectation");
      const reminder = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Set reminder",
      );
      const before = (first, second) =>
        Boolean(first && second && first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        hasExpectation: Boolean(expectation),
        hasReminder: Boolean(reminder),
        expectationBeforeReminder: before(expectation, reminder),
        mediaBeforeReminder: mediaExpectation ? before(mediaExpectation, reminder) : true,
      };
    });
    expect(decisionOrder.hasExpectation, "Tonight should state the realistic viewing expectation");
    expect(decisionOrder.hasReminder, "Tonight should offer a calendar reminder after the decision support");
    expect(
      decisionOrder.expectationBeforeReminder && decisionOrder.mediaBeforeReminder,
      "Tonight's viewing guidance and media context should precede its reminder",
    );

    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((element) => {
        element.open = true;
      });
    });
    await scan(page, "recommendation with all detail open");

    // Exercise both worker-backed future views, including their current filter
    // contract. Unsupported categories must not appear as selectable promises.
    if (UPCOMING_IS_ROUTED) {
    await page.getByRole("button", { name: "Upcoming" }).click();
    await waitForPlanning(page, ".tk-highlights");
    await scan(page, "Upcoming list ready");
    const categoryOptions = await page.getByLabel("Show").locator("option").allTextContents();
    // Aurora is offered now that a real nowcast backs it, and its option says
    // the horizon is limited. Satellite passes and comets still have no source
    // and must not appear at all.
    expect(
      !categoryOptions.some((label) => /satellite|comet|occultation/i.test(label)),
      "the phenomenon filter must not offer unsupported satellite, comet or occultation coverage",
    );
    expect(
      categoryOptions.some((label) => /aurora/i.test(label) && /limited horizon/i.test(label)),
      "aurora must be offered with its horizon limit stated, not as full support",
    );
    await page.getByRole("tab", { name: "Calendar" }).click();
    await waitForPlanning(page, ".tk-month");
    await scan(page, "Upcoming Calendar ready");
    expect(
      (await page.locator('.tk-month-agenda [aria-pressed="true"]').count()) <= 1,
      "Calendar must never expose two different agenda events as selected",
    );
    const markedDay = page.locator(".tk-day.is-marked").first();
    if ((await markedDay.count()) > 0) {
      expect(Boolean(await markedDay.getAttribute("aria-label")), "a marked calendar day needs an accessible event label");
      await markedDay.click();
      await page.waitForFunction(
        () => document.activeElement?.classList.contains("tk-month-detail"),
        null,
        { timeout: 1_000 },
      ).catch(() => {});
      expect(
        await page.locator(".tk-month-detail").evaluate((element) => element === document.activeElement),
        "selecting a calendar event should move focus to its detail",
      );
      await scan(page, "Upcoming Calendar selected event");
    }
    await page.getByRole("button", { name: "Tonight" }).click();
    }
    // The ranked row this next block inspects lives on the event page, which is
    // one deliberate step in from the panel.
    if ((await page.locator(".tracker-hero .tk-hero-name").count()) === 0) {
      await page.waitForSelector(".tk-rail", { timeout: 30_000 });
      await openDetail(page);
    }

    /**
     * "Already set", which is the state that produced every contrast violation.
     *
     * It used to be forced onto a row of the detail page's cross-event list.
     * That list is gone — one ranking, and it is the rail's — so the state is
     * forced where a reader meets it now: the hero metric that says where to
     * look, which reads "Already set" for an event that has finished for the
     * night. Forced rather than waited for, because whether any event has set
     * depends on the time of day.
     */
    const forced = await page.evaluate(() => {
      const metric = document.querySelector(".tk-hero-metrics .tk-metric dd");
      if (!metric) return false;
      metric.textContent = "Already set";
      metric.classList.add("is-unknown");
      return true;
    });
    if (forced) await scan(page, "a metric in its already-set state");

    /* --- the expanded map, which is a control rather than a picture --------
     *
     * Scanned as its own state because it is the one part of Tracker a reader
     * operates rather than reads: four controls, a focusable surface, and a
     * textual summary that has to carry the map's answer for anybody who
     * cannot see the drawing. None of that is exercised by scanning the page
     * behind it.
     */
    /**
     * The map model's own parameters: `mode`, not `view`, and a pin.
     *
     * Upcoming opens over a selected place, so a URL that names the view but no
     * location lands on the bare map — which is what this line used to do, and
     * why it then waited ninety seconds for a list that was never going to
     * render.
     */
    /**
     * Reached by date rather than through Upcoming.
     *
     * The expanded map is a property of the eclipse page, not of the browse
     * that used to lead to it — and the date control is how a reader gets to a
     * future night now. 11 January 2028 carries a partial lunar eclipse visible
     * from Portland, so the date and the place together pin the phenomenon and
     * the assertions below stay about the code rather than about the sky.
     */
    await page.goto(`${TRACKER}&date=2028-01-11&pin=45.5152,-122.6784`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForSelector(".tk-rail", { timeout: 60_000 });
    await openDetail(page);
    await page.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    /**
     * The geographic answer is the map, and the map is the one being scanned.
     *
     * There used to be a second map here — a modal over the event page with its
     * own four controls, its own focusable surface and its own textual summary,
     * all of which had to be audited separately because none of it was the map
     * the rest of the product uses. "View visibility map" goes to the real map
     * now, so what is scanned is the real map with an event drawn on it.
     */
    const mapOpener = page.getByRole("button", { name: "View visibility map" }).first();
    if ((await mapOpener.count()) > 0) {
      await mapOpener.click();
      await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2_500);

      // Every control is a real button with a name, or a screen reader
      // announces four unlabelled graphics.
      for (const name of ["Zoom in", "Zoom out", "Use my current location"]) {
        expect(
          (await page.locator(`.tk-map-control[aria-label="${name}"]`).count()) === 1,
          `the map needs a labelled ${name} control`,
        );
      }
      // The map itself takes focus, so keyboard panning is reachable.
      expect(
        (await page.locator('.tk-map-surface[tabindex="0"]').count()) === 1,
        "the map should be focusable for keyboard panning",
      );
      await scan(page, "the map with an event drawn on it");
    }



    expect(
      (await page.title()).toLowerCase() !== "orbit studio",
      "the page title should name the recommendation, not just the product",
    );
    await desktop.close();

    // --- mobile --------------------------------------------------------
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await stubProviders(mobile);
    const phone = await mobile.newPage();
    await phone.clock.setFixedTime(RUN_AT);
    await phone.goto(TRACKER, { waitUntil: "domcontentloaded" });
    await scan(phone, "entry on a phone");
    await chooseFirstResult(phone, "Joshua Tree Village Campground");
    await scan(phone, "map with a location selected on a phone");

    /* --- the rail, which is what a phone gets instead of a sheet ----------
     *
     * There used to be a bottom sheet here: a collapsed strip with a button
     * that expanded it over most of the screen. The rail replaced it, and the
     * sheet went with it rather than being kept alongside.
     *
     * The reason is that the sheet and the rail answer the same question in
     * ways that cannot both be right. A sheet says "the details are somewhere
     * else, here is a handle"; the rail says "the details are in the card you
     * tapped". Two mechanisms for opening the same content on the same screen
     * is exactly the duplication this pass exists to remove — and the rail is
     * the better of the two on a phone, because expanding a card keeps the map
     * visible where expanding the sheet covered it.
     *
     * So what is asserted here is the rail's own contract: it is present, its
     * cards are reachable, exactly one opens at a time, and opening one does
     * not cover the map.
     */
    await phone.waitForSelector(".tk-rail-card", { timeout: 30_000 });
    expect(
      (await phone.locator(".tk-map-sheet-handle").count()) === 0,
      "the bottom sheet should be gone, not living alongside the rail",
    );
    const railHead = phone.locator(".tk-rail-card .tk-rail-card-head").first();
    expect(
      (await railHead.getAttribute("aria-expanded")) === "false",
      "a rail card should say whether it is open",
    );
    await railHead.click();
    await phone.waitForSelector('.tk-rail-card[data-expanded="true"]', { timeout: 5_000 });
    expect(
      (await railHead.getAttribute("aria-expanded")) === "true",
      "a rail card should report its expanded state",
    );
    expect(
      (await phone.locator('.tk-rail-card[data-expanded="true"]').count()) === 1,
      "only one rail card should be open at a time on a phone",
    );
    expect(
      await phone.evaluate(() => {
        const rail = document.querySelector(".tk-rail");
        if (!rail) return false;
        // The map has to stay the larger half of the screen: a card that grows
        // to cover it has become the sheet it replaced.
        return rail.getBoundingClientRect().height < window.innerHeight * 0.6;
      }),
      "an expanded rail card should leave most of the map visible",
    );
    await scan(phone, "rail card expanded on a phone");
    await railHead.click();
    await phone.waitForSelector('.tk-rail-card[data-expanded="false"]', { timeout: 5_000 });

    await openDetail(phone);
    await scan(phone, "recommendation on a phone");
    assertNoHorizontalClipping(await visibleBounds(phone), "390px Tonight");

    if (UPCOMING_IS_ROUTED) {
    await phone.getByRole("button", { name: "Upcoming" }).click();
    await waitForPlanning(phone, ".tk-highlights");
    await scan(phone, "Upcoming Highlights on a phone");
    assertNoHorizontalClipping(await visibleBounds(phone), "390px Highlights");

    await phone.getByRole("tab", { name: "Calendar" }).click();
    await waitForPlanning(phone, ".tk-month");
    await scan(phone, "Upcoming Calendar agenda on a phone");
    expect(!(await phone.locator(".tk-month-grid").isVisible()), "390px Calendar should not expose the desktop grid");
    expect(await phone.locator(".tk-month-agenda").isVisible(), "390px Calendar should expose its chronological agenda");
    expect(
      (await phone.locator('.tk-month-agenda [aria-pressed="true"]').count()) <= 1,
      "390px Calendar must expose one selected agenda event at most",
    );
    assertNoHorizontalClipping(await visibleBounds(phone), "390px Calendar");
    }
    await mobile.close();

    // 320 CSS px is the narrow end of the explicit Phase 2 support range.
    // Persist the already-confirmed fixture so this pass is about reflow, not a
    // duplicate geocoder test.
    const narrow = await browser.newContext({
      viewport: { width: 320, height: 720 },
      isMobile: true,
      hasTouch: true,
    });
    await stubProviders(narrow);
    await narrow.addInitScript((place) => {
      localStorage.setItem(
        "orbit-studio:tracker:confirmed-place:v1",
        JSON.stringify({ version: 1, place }),
      );
    }, {
      name: "Joshua Tree Village Campground",
      context: "Joshua Tree, California, United States",
      latitude: 34.135,
      longitude: -116.313,
      fromDevice: false,
    });
    const narrowPage = await narrow.newPage();
    await narrowPage.clock.setFixedTime(RUN_AT);
    await narrowPage.goto(TRACKER, { waitUntil: "domcontentloaded" });
    // A stored place opens the map on that place, so the event page is one
    // deliberate step in rather than the landing screen.
    await narrowPage.waitForSelector(".tk-rail", { timeout: 30_000 });
    await openDetail(narrowPage);
    await scan(narrowPage, "recommendation at 320 CSS pixels");
    assertNoHorizontalClipping(await visibleBounds(narrowPage), "320px Tonight");
    await narrow.close();

    // Reduced motion is not an inference from CSS source: exercise the actual
    // production view with the preference set and verify its media is not
    // autoplaying motion at the user.
    const reduced = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await stubProviders(reduced);
    await reduced.addInitScript((place) => {
      localStorage.setItem(
        "orbit-studio:tracker:confirmed-place:v1",
        JSON.stringify({ version: 1, place }),
      );
    }, {
      name: "Joshua Tree Village Campground",
      context: "Joshua Tree, California, United States",
      latitude: 34.135,
      longitude: -116.313,
      fromDevice: false,
    });
    const reducedPage = await reduced.newPage();
    await reducedPage.clock.setFixedTime(RUN_AT);
    await reducedPage.goto(TRACKER, { waitUntil: "domcontentloaded" });
    // A stored place opens the map on that place, so the event page is one
    // deliberate step in rather than the landing screen.
    await reducedPage.waitForSelector(".tk-rail", { timeout: 30_000 });
    await openDetail(reducedPage);
    expect(
      await reducedPage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      "the reduced-motion production context should expose the requested preference",
    );
    const autoplaying = await reducedPage.locator("video").evaluateAll((videos) =>
      videos.some((video) => !video.paused && video.currentTime > 0),
    );
    expect(!autoplaying, "reduced-motion mode must not leave Tracker video autoplaying");
    await scan(reducedPage, "recommendation with reduced motion");
    await reduced.close();
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  }
}

await run();

console.log(`[a11y] Checked: ${checked.join(", ")}`);
if (failures.length > 0) {
  console.error(`\n[a11y] ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("[a11y] PASS — no WCAG 2.1 AA violations, and the picker is keyboard operable.");
}
