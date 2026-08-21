import process from "node:process";
import { chromium } from "playwright";
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
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  const values = (value) =>
    Array.from({ length: 48 }, (_, hour) => ({
      validTime: `${new Date(start.getTime() + hour * 3_600_000).toISOString().slice(0, 19)}+00:00/PT1H`,
      value,
    }));
  return {
    properties: {
      updateTime: new Date().toISOString(),
      skyCover: { values: values(18) },
      temperature: { values: values(14) },
      probabilityOfPrecipitation: { values: values(5) },
      relativeHumidity: { values: values(60) },
    },
  };
}

/** Installs the stubs on a context, before any page in it loads. */
async function stubProviders(context) {
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
  await context.route("**/api.met.no/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        properties: {
          meta: { updated_at: new Date().toISOString() },
          timeseries: Array.from({ length: 48 }, (_, hour) => ({
            time: new Date(Date.now() + hour * 3_600_000).toISOString(),
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
  await page.waitForSelector(".tracker-place-confirm", { timeout: 10_000 });
  await scan(page, "place confirmation");

  await page.keyboard.press("Enter");
  await page.waitForSelector(".tracker-hero h1", { timeout: 30_000 });
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
      ".tk-page-heading",
      ".tk-hero",
      ".tk-viz-slot",
      ".tk-conditions",
      ".tk-relevant",
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
    await page.goto(TRACKER, { waitUntil: "networkidle" });
    await scan(page, "entry");

    // The entry screen must show something before a place is known. An empty
    // frame with a search box in it was the state this replaced.
    expect(
      (await page.locator(".tk-preview-card").count()) > 0,
      "the entry screen should preview the ranked list before a place is chosen",
    );

    await chooseFirstResult(page, "Joshua Tree Village Campground");
    await scan(page, "recommendation");

    // Escape must close the panel and give focus back, which it did not before
    // the picker was rebuilt. Checked on the header popover, which is where the
    // panel still opens once a place has been chosen.
    await page.locator(".tracker-place-current").first().click();
    await page.waitForSelector(".tracker-place-panel");
    await scan(page, "header picker open");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".tracker-place-panel", { state: "detached", timeout: 5000 });
    // Checked against the trigger itself. An earlier version of this assertion
    // looked for a `.tracker-place` wrapper that the React Aria rebuild had
    // removed, and reported a failure against code that was working.
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.classList.contains("tracker-place-current")),
      ),
      "Escape should return focus to the picker trigger",
    );

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
    await page.waitForSelector(".tracker-hero h1");

    // "Already set" cards are styled differently and were the source of every
    // contrast violation the audit found, so the state is forced rather than
    // waited for — it depends on the time of day.
    // The ranked rows carry the "already set" state through their quality tone
    // rather than through a card modifier, so the state is forced on the tone
    // that produced every contrast violation the original audit found.
    const forced = await page.evaluate(() => {
      const quality = document.querySelector(".tk-relevant-quality");
      if (!quality) return false;
      quality.className = "tk-relevant-quality is-unknown";
      quality.textContent = "Already set";
      return true;
    });
    if (forced) await scan(page, "ranked row in its already-set state");

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
    await phone.goto(TRACKER, { waitUntil: "networkidle" });
    await scan(phone, "entry on a phone");
    await chooseFirstResult(phone, "Joshua Tree Village Campground");
    await scan(phone, "recommendation on a phone");
    assertNoHorizontalClipping(await visibleBounds(phone), "390px Tonight");

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
    await narrowPage.goto(TRACKER, { waitUntil: "networkidle" });
    await narrowPage.waitForSelector(".tracker-hero h1", { timeout: 30_000 });
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
    await reducedPage.goto(TRACKER, { waitUntil: "networkidle" });
    await reducedPage.waitForSelector(".tracker-hero h1", { timeout: 30_000 });
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
