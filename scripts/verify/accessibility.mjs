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

async function scan(page, state) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  record(state, results);
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
 */
async function chooseFirstResult(page, query) {
  await page.locator(".tracker-place-current").first().click();
  await page.waitForSelector(".tracker-place-panel");

  const input = page.locator(".tracker-place-search input");
  expect(await input.evaluate((el) => el === document.activeElement), "opening the picker should focus the search field");
  expect(
    (await input.getAttribute("role")) === "combobox",
    "the search field should expose role=combobox",
  );
  expect(
    Boolean(await input.getAttribute("aria-label")) ||
      Boolean(await input.getAttribute("aria-labelledby")),
    "the search field should have an accessible name, not just a placeholder",
  );

  await input.fill(query);
  await page.waitForSelector('[role="option"]', { timeout: 20_000 });
  await scan(page, "picker open with results");

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
    await scan(page, "welcome");

    // Escape must close the panel and give focus back, which it did not before
    // the picker was rebuilt.
    await page.locator(".tracker-place-current").first().click();
    await page.waitForSelector(".tracker-place-panel");
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

    await chooseFirstResult(page, "Joshua Tree Village Campground");
    await scan(page, "recommendation");

    // The disclosure content is part of the page and is checked as such.
    await page.locator(".tracker-detail > button").click();
    await page.waitForSelector(".tracker-detail-body");
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((element) => {
        element.open = true;
      });
    });
    await scan(page, "recommendation with all detail open");

    // "Already set" cards are styled differently and were the source of every
    // contrast violation the audit found, so the state is forced rather than
    // waited for — it depends on the time of day.
    const forced = await page.evaluate(() => {
      const card = document.querySelector(".tracker-card");
      if (!card) return false;
      card.classList.add("tracker-card-passed");
      return true;
    });
    if (forced) await scan(page, "ranked card in its already-set state");

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
    await scan(phone, "welcome on a phone");
    await chooseFirstResult(phone, "Joshua Tree Village Campground");
    await scan(phone, "recommendation on a phone");
    await mobile.close();
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
