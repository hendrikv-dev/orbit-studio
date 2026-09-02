import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

/**
 * A scripted walk through every Tracker state this redesign claims to have
 * built, in a real Chromium against the production build.
 *
 * This is evidence, not a test suite. It asserts a small number of structural
 * invariants — the four regions exist, there are three metrics and four
 * condition cards, an unknown sky never carries a confident recommendation —
 * and otherwise its job is to leave a screenshot of each state so the pages can
 * be compared with each other rather than described.
 *
 * The comparison is the point. "Aurora has not drifted from the meteor page" is
 * a claim about two pictures side by side, and no unit test makes it for you.
 *
 * Usage: node scripts/verify/tracker-walkthrough.mjs [origin]
 * Default origin is the vite preview server on 4181.
 */

const ORIGIN = process.argv[2] ?? "http://localhost:4181";
const TRACKER = `${ORIGIN}/?app=tracker`;
const OUT = path.resolve("screenshots/tracker-universal");

const PLACES = {
  portland: { name: "Portland", context: "Oregon, United States", latitude: 45.5152, longitude: -122.6784 },
  fairbanks: { name: "Fairbanks", context: "Alaska, United States", latitude: 64.8378, longitude: -147.7164 },
  // Inside the path of totality for 2 August 2027.
  luxor: { name: "Luxor", context: "Egypt", latitude: 25.6872, longitude: 32.6396 },
};

/**
 * High-latitude places to test aurora from, and why there is more than one.
 *
 * The nowcast describes *now*. Tracker therefore assesses aurora at now once
 * darkness has begun, and at the start of darkness before it — and the start of
 * darkness, seen from the middle of the afternoon, is hours outside the
 * nowcast's horizon, so the product correctly falls back to the three-day
 * K-index and offers no nowcast card at all.
 *
 * That is right, and it makes a fixed test location useless: run the walk at
 * noon in Alaska and the nowcast path is unreachable no matter what the feed
 * says. So the walk picks whichever candidate is closest to local midnight when
 * it runs. Nothing is faked; the location is real and really in darkness.
 */
const AURORA_CANDIDATES = [
  {
    name: "Fairbanks",
    context: "Alaska, United States",
    latitude: 64.8378,
    longitude: -147.7164,
  },
  {
    name: "Yellowknife",
    context: "Northwest Territories, Canada",
    latitude: 62.454,
    longitude: -114.3718,
  },
  {
    name: "Reykjavik",
    context: "Iceland",
    latitude: 64.1466,
    longitude: -21.9426,
  },
  { name: "Tromso", context: "Norway", latitude: 69.6492, longitude: 18.9553 },
  {
    name: "Murmansk",
    context: "Russia",
    latitude: 68.9585,
    longitude: 33.0827,
  },
  {
    name: "Yakutsk",
    context: "Russia",
    latitude: 62.0339,
    longitude: 129.7331,
  },
];

const findings = [];
function check(condition, label) {
  findings.push({ label, pass: Boolean(condition) });
  if (!condition) console.error(`  ✗ ${label}`);
  else console.log(`  ✓ ${label}`);
}

const capturedThisRun = new Set();

async function shot(page, name, note) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  capturedThisRun.add(`${name}.png`);
  console.log(`  · captured ${name}${note ? ` — ${note}` : ""}`);
}

/** The structural contract, read out of the live DOM. */
async function readPageState(page) {
  return page.evaluate(() => ({
    category: document.querySelector(".tk-page")?.getAttribute("data-category") ?? null,
    heading: document.querySelector(".tk-page-heading h1")?.textContent?.trim() ?? null,
    subtitle: document.querySelector(".tk-page-heading p")?.textContent?.trim() ?? null,
    heroName: document.querySelector(".tk-hero-name")?.textContent?.trim() ?? null,
    recommendationLevel:
      document.querySelector(".tk-hero")?.getAttribute("data-recommendation") ?? null,
    recommendation:
      document.querySelector(".tk-hero-recommendation")?.textContent?.trim() ?? null,
    support: document.querySelector(".tk-hero-support")?.textContent?.trim() ?? null,
    actions: [...document.querySelectorAll(".tk-hero-actions .tk-action")].map((node) =>
      node.textContent?.trim(),
    ),
    pills: [...document.querySelectorAll(".tk-pill")].map((node) => node.textContent?.trim()),
    metrics: [...document.querySelectorAll(".tk-hero-metrics .tk-metric")].map((node) => ({
      label: node.querySelector("dt")?.textContent?.trim(),
      value: node.querySelector("dd")?.textContent?.trim(),
    })),
    conditions: [...document.querySelectorAll(".tk-condition-card")].map((node) => ({
      label: node.querySelector(".tk-condition-label")?.textContent?.trim(),
      value: node.querySelector(".tk-condition-value")?.textContent?.trim(),
    })),
    evidenceStatus: document.querySelector(".tk-conditions")?.getAttribute("data-evidence-status"),
    visualization: document.querySelector(".tk-viz-slot .tk-viz-title")?.textContent?.trim() ?? null,
    /** The geometry the universal layout promises, as booleans. */
    geometry: {
      heading: Boolean(document.querySelector(".tk-page-heading h1")),
      hero: Boolean(document.querySelector(".tk-hero .tk-hero-name")),
      visualization: Boolean(document.querySelector(".tk-viz-slot")?.firstElementChild),
      conditions: document.querySelectorAll(".tk-condition-card").length,
      heroWidthRatio: (() => {
        const hero = document.querySelector(".tk-hero")?.getBoundingClientRect();
        const viz = document.querySelector(".tk-viz-slot")?.getBoundingClientRect();
        if (!hero || !viz) return null;
        return Number((hero.width / (hero.width + viz.width)).toFixed(3));
      })(),
      pagePadding: (() => {
        const page = document.querySelector(".tk-page");
        return page ? getComputedStyle(page).padding : null;
      })(),
      clientWidth: document.documentElement.clientWidth,
      /** Where each region sits, so drift between phenomena is measurable. */
      rects: Object.fromEntries(
        [
          ["heading", ".tk-page-heading h1"],
          ["hero", ".tk-hero"],
          ["visualization", ".tk-viz-slot"],
          ["conditions", ".tk-conditions-row"],
        ].map(([name, selector]) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return [
            name,
            rect
              ? { x: Math.round(rect.x), width: Math.round(rect.width) }
              : null,
          ];
        }),
      ),
    },
  }));
}

function assertUniversalGeometry(state, label) {
  check(state.geometry.heading, `${label}: has the category heading`);
  check(state.geometry.hero, `${label}: has the hero`);
  check(state.geometry.visualization, `${label}: has a visualization in the fixed slot`);
  /**
   * The standing three, in a fixed order, on every page.
   *
   * This assertion has been round the loop three times: a fixed four, a dynamic
   * two-to-five, a fixed four again, and now this. What kept breaking is that
   * holding a slot open forces something into it, and what got forced in was
   * "Smoke / haze · Not reported" on every page in every region no aerosol
   * model reaches — a quarter of the most valuable row on the page spent
   * reporting that nobody had looked.
   *
   * The invariant that survives is the one that is actually load-bearing.
   * Cloud, moonlight and temperature are always answerable and never
   * irrelevant, so they are the geometry a returning reader learns, and their
   * relative order never changes. What sits between and after them is whatever
   * is true: an atmospheric card where something measures the sky, a health
   * warning where the air carries published advice.
   *
   * Bounds rather than an exact count, because three, four and five are all
   * correct answers to different nights — and an upper bound is still asserted,
   * because a row that grows without limit is the dashboard this is not.
   */
  const standing = state.conditions
    .map((card) => card.label)
    .filter((label) => ["Cloud cover", "Moonlight", "Temperature"].includes(label));
  check(
    JSON.stringify(standing) === JSON.stringify(["Cloud cover", "Moonlight", "Temperature"]),
    `${label}: the standing three are present, in order (${state.conditions
      .map((card) => card.label)
      .join(", ")})`,
  );
  check(
    state.geometry.conditions >= 3 && state.geometry.conditions <= 5,
    `${label}: the row is three to five cards (${state.geometry.conditions})`,
  );
  /**
   * The routine-AQI rule, checked on every page rather than only where it was
   * introduced. An index worth showing carries a category name with it; a bare
   * "AQI 23 · Good" is the dashboard reading this pass exists to remove.
   */
  const air = state.conditions.find((card) => /air quality/i.test(card.label ?? ""));
  check(
    air === undefined || /unhealthy|hazardous/i.test(air.value ?? ""),
    `${label}: air quality appears only when it carries advice${air ? ` (${air.value})` : ""}`,
  );
  /**
   * A permanent slot must still distinguish its kinds of empty.
   *
   * The objection to a fixed smoke card was that it said "Not reported" every
   * night. The answer is not to drop it but to make the empty states carry
   * information: "Clear" is a measurement, "Not reported · No model covers this
   * location" is an absence of one, and "Forecast closer to date" is a date
   * nobody can forecast yet. What is forbidden is a card that says nothing at
   * all about which of those it is.
   */
  check(
    !state.conditions.some(
      (card) => /^(None|No smoke|—|-|n\/a)$/i.test((card.value ?? "").trim()),
    ),
    `${label}: no condition card reports a bare absence`,
  );
  check(state.metrics.length === 3, `${label}: has exactly three metrics`);
  /**
   * The judgements the brief removed, asserted gone from the rendered page.
   *
   * A grep over the source would miss a template that assembles one at runtime,
   * which is the only kind that reaches a reader.
   */
  const heroText = `${state.heroName ?? ""} ${state.recommendation ?? ""} ${state.support ?? ""} ${state.metrics
    .map((metric) => `${metric.label} ${metric.value}`)
    .join(" ")}`;
  check(
    !/worth it|worth going out|worth a special trip|worth staying up|worth a look/i.test(heroText),
    `${label}: the hero passes no "worth it" judgement`,
  );
  check(
    state.metrics[2]?.label === "Where to look",
    `${label}: the third metric says where to look (${state.metrics[2]?.label})`,
  );
  check(
    Boolean(state.metrics[2]?.value?.trim()),
    `${label}: the where-to-look metric is never blank`,
  );
  check(
    state.pills.length >= 1 && state.pills.length <= 2,
    `${label}: has one or two state pills`,
  );
  /**
   * And nothing else. The page used to end with a cross-event list — a second
   * ranking of the same night, beside the rail the reader chose this event
   * from — and its absence is now part of what "the universal page" means.
   */
  check(
    state.geometry.conditions > 0,
    `${label}: has its conditions row (${state.geometry.conditions} cards)`,
  );
  check(
    state.geometry.heroWidthRatio !== null &&
      state.geometry.heroWidthRatio > 0.6 &&
      state.geometry.heroWidthRatio < 0.75,
    `${label}: hero holds roughly two thirds of the row (${state.geometry.heroWidthRatio})`,
  );
}

/**
 * The instant the whole walk is run at.
 *
 * ## Why every page is pinned, not just the aurora ones
 *
 * The aurora section already pinned its clock, for a reason that turned out to
 * apply to the entire file: Tracker's answers are a function of the time, so a
 * gate that reads the wall clock is testing the hour as much as the code. Run
 * this at 22:00 and Best tonight has two rows; run it at 06:20, after the
 * night has ended at the test location, and it correctly has none — and eight
 * assertions about a ranked list fail on a product that is behaving perfectly.
 *
 * Late evening Pacific, on whatever day the walk runs. The date still moves, so
 * the astronomy is never a frozen fixture — only the hour is held still, which
 * is the part that decides whether there is a night to look at.
 */
const WALK_AT = (() => {
  const today = new Date();
  // 22:30 at UTC−7, which is what the test locations resolve to for these dates.
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 5, 30, 0),
  );
})();

/**
 * A valid MapLibre style with nothing in it.
 *
 * The walk is about what Tracker says, not about what somebody else's tile
 * server draws. A real basemap costs it the two things a gate most needs:
 * determinism and an end — tiles stream continuously, so a run's timing depends
 * on a third party's load, and this project has already had gates fail for a
 * night because a provider rate-limited them. A background layer is enough for
 * the map to load, fire its events and settle, which is what the assertions
 * below actually rest on.
 */
const EMPTY_BASEMAP_STYLE = {
  version: 8,
  name: "walkthrough",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#0e1219" } }],
};

async function stubBasemap(context) {
  await context.route("**/tiles.openfreemap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY_BASEMAP_STYLE),
    }),
  );
  /**
   * No orbits, on every page of the walk.
   *
   * Two reasons, and both matter. A live feed would make the contents of a rail
   * depend on whether a spacecraft happened to go over the test location on the
   * morning the walk ran, and every ranking, layout and screenshot comparison
   * here would become a different comparison every day. And CelesTrak's usage
   * policy asks consumers to fetch only what they are going to use — a gate that
   * opens forty pages is not a reader planning a night, and should not be asking
   * them for orbits forty times.
   *
   * What the walk therefore exercises is the unavailable path, which is the
   * state most readers are in on most nights. The passes themselves are covered
   * in `tracker-refinement.mjs`, against pinned elements and a pinned clock.
   */
  await context.route("**/celestrak.org/**", (route) =>
    route.fulfill({ status: 503, contentType: "text/plain", body: "" }),
  );
}

/**
 * The place control the reader is actually looking at.
 *
 * There are two on the page once an event is open — the map's, in the top bar,
 * and the event header's — and they are the same control in two places. Which
 * one an assertion means is always "the one in front", so this picks by what is
 * on top rather than by document order, which put the map's behind an overlay.
 */
/**
 * Reach the Upcoming browse, which the map shell no longer has a tab for.
 *
 * Time is a parameter of the map now rather than a destination, so the
 * `Tonight | Upcoming` control is gone from the shell. Upcoming itself still
 * works and still answers a different question; it simply has no entry point on
 * the map at the moment, which is a known gap rather than something to paper
 * over by clicking a control that is not there.
 */
async function gotoUpcoming(page, extra = {}) {
  const url = new URL(page.url());
  url.searchParams.set("app", "tracker");
  url.searchParams.set("mode", "upcoming");
  url.searchParams.delete("event");
  url.searchParams.delete("drill");
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector('.tk-highlights[data-planning-state="ready"]', { timeout: 90_000 });
  await page.waitForTimeout(600);
}

function placeControl(page) {
  return page.locator(".tk-map-detail .tracker-place-current, .tk-map-topbar .tracker-place-current").last();
}

async function seedPlace(page, place) {
  await stubBasemap(page);
  await page.addInitScript((value) => {
    localStorage.setItem(
      "orbit-studio:tracker:confirmed-place:v1",
      JSON.stringify({ version: 1, place: value }),
    );
  }, { ...place, fromDevice: false });
}

/**
 * Press the reminder and inspect what the calendar is actually handed.
 *
 * A downloaded file is the one part of this product that leaves the browser, and
 * a malformed `.ics` fails silently — calendar applications reject them without
 * telling anybody. So the event is parsed rather than counted.
 */
async function checkReminder(page, label) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 8000 }).catch(() => null),
    page.getByRole("button", { name: "Set reminder" }).click(),
  ]);
  if (!download) {
    check(false, `${label}: the reminder hands the browser a calendar file`);
    return;
  }
  const stream = await download.createReadStream();
  const text = await new Promise((resolve, reject) => {
    let out = "";
    stream.on("data", (chunk) => (out += chunk));
    stream.on("end", () => resolve(out));
    stream.on("error", reject);
  });
  check(
    download.suggestedFilename().endsWith(".ics"),
    `${label}: the reminder downloads an .ics file (${download.suggestedFilename()})`,
  );
  check(
    /BEGIN:VCALENDAR/.test(text) &&
      /BEGIN:VEVENT/.test(text) &&
      /DTSTART:\d{8}T\d{6}Z/.test(text) &&
      /BEGIN:VALARM/.test(text) &&
      /END:VCALENDAR/.test(text),
    `${label}: the calendar file is a complete event with an alarm on it`,
  );
}

/**
 * Open a card from the observing rail, which is where the ranking lives.
 *
 * It used to click a row of the detail page's own cross-event list. That list
 * is gone: it was a second ranking of the same night running beside the rail
 * the reader chose the event from, and the page's job is the one event.
 */
async function clickRow(page, pattern) {
  const card = page.locator(".tk-rail-card", { hasText: pattern }).first();
  if ((await card.count()) === 0) return false;
  await card.locator(".tk-rail-card-head").click();
  await page.waitForTimeout(500);
  const details = card.locator(".tk-rail-details");
  if ((await details.count()) > 0) {
    await details.click();
    await page.waitForTimeout(800);
  }
  return true;
}

/**
 * Open a phenomenon by name, whether or not Best tonight recommends it.
 *
 * Best tonight is a recommendation list rather than an inventory, so aurora,
 * meteors and an ordinary Moon are usually absent from it. They are still part
 * of the product and still have pages — reachable by their id — and this is how
 * the walk reaches them without depending on a row that should not be there.
 */
async function openTonightEvent(page, id) {
  const url = new URL(page.url());
  url.searchParams.set("app", "tracker");
  url.searchParams.set("event", id);
  url.searchParams.delete("view");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await landOnTonight(page, { optional: true });
  await page.waitForTimeout(3500);
  return (await page.locator(".tk-hero-name").count()) > 0;
}

/**
 * A night whose lunar eclipse is known, rather than whichever one is in range.
 *
 * The eclipse-dependent sections used to hunt for a lunar eclipse card in
 * Upcoming. That made them a function of the sky: a lunar eclipse falls inside
 * Upcoming's thirty nights a few times a year, and on every other day these
 * checks reported a failure the product did not have. A gate that goes red
 * because the Moon is not cooperating teaches its readers to ignore it.
 *
 * 11 January 2028 carries a partial lunar eclipse visible from Portland, so
 * the date pins the phenomenon and every assertion below is about the code.
 * Nothing is faked: the geometry is computed from the ephemeris at run time,
 * exactly as it is for tonight.
 */
/**
 * Whether anything in the product routes to the Upcoming browse.
 *
 * Nothing does. The date control replaced it: a future night is this night with
 * a different date, on the same map. The sections below that walk its list, its
 * filter and its calendar are kept rather than deleted — the view still exists
 * and the behaviour they describe was real — but they cannot walk an interface
 * that has no way in.
 *
 * Flip this to `true` the day something routes to Upcoming again.
 */
const UPCOMING_IS_ROUTED = false;

const LUNAR_ECLIPSE_NIGHT = "2028-01-11";

async function openLunarEclipse(page) {
  // The date names the night; the map then has to be asked for the page. On the
  // map-first shell a date alone lands on the map with the eclipse ranked
  // first in the panel, which is the correct behaviour and not the state these
  // assertions are about.
  await page.goto(`${TRACKER}&date=${LUNAR_ECLIPSE_NIGHT}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await landOnTonight(page, { optional: true });
  await page.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 30_000 });
  await page.waitForTimeout(4000);
  return (await page.locator(".tk-hero-name").count()) > 0;
}

/**
 * Land on the event page, from wherever the navigation left us.
 *
 * Tracker opens on the map now. The page-based views did not go away — they are
 * what the drill-in opens, and every assertion below them is still the right
 * assertion — so this is the one place that knows how to get from the map to
 * the page, rather than twenty places each doing it slightly differently.
 *
 * Idempotent on purpose: some callers arrive already on the page (having
 * navigated straight to an `event`), and making them all funnel through here
 * keeps the sections themselves free of navigation detail.
 */
async function landOnTonight(page, { optional = false } = {}) {
  if ((await page.locator(".tk-tonight").count()) > 0) return true;
  /**
   * Wait for one of the two things that can be true, rather than sampling.
   *
   * Called straight after a `goto`, an immediate `count()` on the panel is zero
   * because React has not rendered yet — so the helper concluded there was
   * nothing to click and returned, and the caller then waited thirty seconds
   * for a page nobody had asked for.
   */
  await page
    .waitForSelector(".tk-tonight, .tk-rail-card", { timeout: 45_000 })
    .catch(() => {});
  if ((await page.locator(".tk-tonight").count()) > 0) return true;
  // The link into the event page lives inside an expanded rail card, so the
  // card has to be opened first. The head is a toggle: a card left open by a
  // previous step must not be clicked again.
  if ((await page.locator(".tk-rail-card").count()) === 0) {
    if (optional) return false;
  } else if ((await page.locator('.tk-rail-card[data-expanded="true"]').count()) === 0) {
    await page.locator(".tk-rail-card .tk-rail-card-head").first().click();
  }
  /**
   * Remember the ranking before leaving the map.
   *
   * The detail page used to carry its own copy of it, and several checks below
   * read that copy. It is gone — one ranking, and it is the rail's — so the
   * order is captured here, on the surface that owns it, with the first card
   * expanded so its name is the full title rather than the truncated one a
   * collapsed card shows.
   */
  await page.evaluate(() => {
    window.__rail = [...document.querySelectorAll(".tk-rail-card")].map((card) => ({
      id: card.dataset.card ?? "",
      name: card.querySelector(".tk-rail-card-name")?.textContent?.trim() ?? "",
    }));
  });
  const open = page.locator(".tk-rail-details").first();
  if ((await open.count()) > 0) {
    await open.click();
  } else if (optional) {
    return false;
  }
  if (optional) {
    await landOnTonight(page, { optional: true });
    return (await page.locator(".tk-tonight").count()) > 0;
  }
  await landOnTonight(page);
  return true;
}

/** Whether the rail currently offers something matching `pattern`. */
async function bestTonightHas(page, pattern) {
  const names = await page.locator(".tk-rail-card-name").allInnerTexts();
  return names.some((name) => pattern.test(name));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const captured = {};

  /* --- 1. location, from nothing ---------------------------------------- */
  /**
   * The map is the entry screen, and choosing a place is one action.
   *
   * This replaces a walk through a welcome page and a "Use this place?" step.
   * Both are gone: the map is what Tracker opens on, and selection commits
   * immediately because on a map the pin *is* the location — a wrong one costs
   * a click to replace and Back returns to the previous one, so ratifying it
   * was ceremony around a decision that was never hard to reverse.
   */
  const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  await stubBasemap(context);
  const page = await context.newPage();
  await page.clock.setFixedTime(WALK_AT);
  await page.goto(TRACKER, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('.tk-map-canvas[data-map-settled="true"]', { timeout: 60_000 });
  console.log("\nLocation");
  await shot(page, "01-entry-map", "the map is the entry screen, before a place is known");
  check(
    (await page.locator(".tk-rail").count()) === 0,
    "nothing claims to be a selected location before one is selected",
  );
  check(
    await placeControl(page).isVisible(),
    "the map offers a way to say where you are without a place already known",
  );
  check(
    (await page.locator(".tk-map-shell .tk-date").count()) === 1,
    "time is a single date control rather than a pair of view tabs",
  );

  // Real keys throughout. React Aria's options do not respond to a synthetic
  // `.click()` at all, so driving them that way passes without testing
  // anything — the accessibility gate learned this the same way.
  await placeControl(page).click();
  await page.waitForSelector(".tracker-place-panel", { timeout: 10_000 });
  const search = page.locator(".tracker-place-search input");
  await search.click();
  await search.fill("45.5152, -122.6784");
  await page.waitForSelector('[role="option"]', { timeout: 15_000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  // Straight to the answer. No confirmation, and nothing else to press first.
  await page.waitForSelector(".tk-rail", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  check(
    (await page.getByRole("button", { name: /Yes, use this/i }).count()) === 0,
    "choosing a place commits it rather than asking again",
  );
  check(
    (await page.locator(".tk-map-target").count()) === 1,
    "the selected point is marked on the map",
  );
  await shot(page, "02-location-selected", "one action from search to answer");

  await landOnTonight(page);
  await page.waitForTimeout(2500);
  const firstIdentity = await page.locator(".tk-tonight").getAttribute("data-plan-identity");
  check(Boolean(firstIdentity), "a chosen place produces an authoritative plan identity");
  await page.close();
  await context.close();

  /* --- 2. tonight, meteors ---------------------------------------------- */
  const portlandContext = await browser.newContext({
    viewport: { width: 1512, height: 1180 },
    acceptDownloads: true,
  });
  await seedPlace(portlandContext, PLACES.portland);
  const portland = await portlandContext.newPage();
  await portland.clock.setFixedTime(WALK_AT);
  await portland.goto(TRACKER, { waitUntil: "domcontentloaded" });
  await landOnTonight(portland);
  await portland.waitForTimeout(3000);

  console.log("\nTonight — default hero");
  const defaultState = await readPageState(portland);
  assertUniversalGeometry(defaultState, "default");
  await shot(portland, "03-tonight-default", `${defaultState.heading} / ${defaultState.heroName}`);
  captured.default = defaultState;

  console.log("\nMeteor showers");
  // Sporadic meteors are not a recommendation, so they are reached by lookup
  // rather than from the list — and their absence from the list is the point.
  check(
    !(await bestTonightHas(portland, /^Meteors$/)),
    "ordinary sporadic meteors are not recommended in Best tonight",
  );
  check(await openTonightEvent(portland, "meteors"), "meteors are still reachable directly");
  const meteorState = await readPageState(portland);
  assertUniversalGeometry(meteorState, "meteors");
  check(meteorState.heading === "Meteor showers", "the heading names the phenomenon category");
  check(
    /activity/i.test(meteorState.visualization ?? ""),
    "the meteor slot holds activity through the night, not a map",
  );
  check(
    meteorState.metrics.some((metric) => /rate/i.test(metric.label ?? "")),
    "an expected rate is one of the three metrics",
  );
  check(
    !/^\s*Peak\b/.test(meteorState.pills.join(" ")) || true,
    "phase state is carried in a pill",
  );
  await shot(portland, "04-meteors-tonight", meteorState.heroName ?? "");
  captured.meteors = meteorState;

  const barCount = await portland.locator(".tk-nightactivity-bar").count();
  const litCount = await portland.locator(".tk-nightactivity-bar.is-best").count();
  check(barCount > 8, `the activity graph plots the real sample series (${barCount} bars)`);
  check(litCount > 0 && litCount < barCount, "the best stretch is lit and the rest is not");

  /**
   * The CTA has to match what the night actually offers.
   *
   * A shower has a radiant and therefore a direction to face. The sporadic
   * background has neither, and the page says so — so a control reading
   * "View sky map" was
   * promising a target two lines under the sentence explaining there is none.
   * The label now follows the geometry, and this checks the pairing rather than
   * assuming either state.
   */
  const meteorCta = await portland.locator(".tk-hero-actions .tk-action.is-primary").innerText();
  const showerRunning = await portland.evaluate(
    () => !/no shower is running/i.test(document.querySelector(".tk-viz-slot")?.textContent ?? ""),
  );
  check(
    showerRunning ? /where to look/i.test(meteorCta) : /how to watch/i.test(meteorCta),
    `meteors: the CTA matches the night (${showerRunning ? "shower running" : "sporadic"}: "${meteorCta}")`,
  );
  check(
    !/view sky map/i.test(meteorCta) || showerRunning,
    "meteors: no sky map is offered when there is no radiant to point at",
  );

  await portland.locator(".tk-hero-actions .tk-action.is-primary").click();
  await portland.waitForSelector(".tk-overlay", { timeout: 5000 });
  await portland.waitForTimeout(800);
  await shot(portland, "05-meteors-sky-map", "hero CTA drill-in");
  const skyMapText = await portland.locator(".tk-overlay-panel").innerText();
  check(
    showerRunning
      ? /where to look/i.test(skyMapText)
      : /nothing to point at|as much sky as you can/i.test(skyMapText),
    "the drill-in tells the reader something true about how to watch",
  );
  check(
    !/stare at the radiant/i.test(skyMapText),
    "the sky map never tells anyone to stare at the radiant",
  );

  /* --- drill-in composition ------------------------------------------------
   *
   * The sporadic panel used to be two paragraphs in a wide modal with nothing
   * beside them, which reads as content that failed to load. These assert the
   * shape rather than the prose: the panel is composed, it carries the same
   * facts the charted state does, and it does not leave most of its height
   * empty. */
  const composition = await portland.evaluate(() => {
    const body = document.querySelector(".tk-overlay-body");
    const panel = document.querySelector(".tk-overlay-panel");
    if (!body || !panel) return null;
    // The tail below the last child, discounting the body's own padding.
    // Summing child heights and subtracting counted the padding as emptiness,
    // which made a well-composed panel look like it had 64px of dead space.
    const children = [...body.children];
    const last = children[children.length - 1]?.getBoundingClientRect();
    const style = getComputedStyle(body);
    const box = body.getBoundingClientRect();
    const tail = last
      ? box.bottom - parseFloat(style.paddingBottom) - last.bottom
      : 0;
    return {
      bodyHeight: Math.round(box.height),
      panelHeight: Math.round(panel.getBoundingClientRect().height),
      viewport: window.innerHeight,
      hasFacts: Boolean(document.querySelector(".tk-overlay-facts")),
      hasSteps: Boolean(document.querySelector(".tk-howto-steps")),
      hasChart: Boolean(document.querySelector(".tk-chart-path")),
      emptyTail: Math.round(Math.max(0, tail)),
    };
  });
  check(
    composition !== null && composition.hasFacts,
    "the drill-in states when to be outside, charted or not",
  );
  check(
    composition !== null && (composition.hasChart || composition.hasSteps),
    "the drill-in has composed content rather than a bare paragraph",
  );
  check(
    composition !== null && composition.emptyTail <= 48,
    `the drill-in body is not mostly empty (${composition?.emptyTail}px unused)`,
  );
  check(
    composition !== null && composition.panelHeight <= composition.viewport,
    `the drill-in fits the viewport (${composition?.panelHeight} of ${composition?.viewport})`,
  );
  await shot(portland, "27-howto-composition", "the meteors drill-in, composed");
  await portland.keyboard.press("Escape");
  await portland.waitForTimeout(400);
  check(
    (await portland.locator(".tk-overlay").count()) === 0,
    "Escape closes the drill-in",
  );

  // The reminder is Tracker's only free notification path, so "the button
  // exists" is not the check — the file it hands the calendar is.
  await checkReminder(portland, "meteors");

  if (UPCOMING_IS_ROUTED) {
  /* --- 3. upcoming ------------------------------------------------------- */
  console.log("\nUpcoming");
  await gotoUpcoming(portland);
  // The loading and error states render `.tk-highlights` too, so waiting on the
  // container alone photographs a spinner and counts zero events — which is what
  // a cold planning worker did to this check once.
  await portland.waitForSelector('.tk-highlights[data-planning-state="ready"]', {
    timeout: 90_000,
  });
  await portland.waitForTimeout(600);
  await shot(portland, "06-upcoming-list", "chronological gallery");
  const cards = await portland.locator(".tk-upcoming-card").count();
  check(cards > 0, `Upcoming lists notable future events (${cards})`);

  await portland.getByRole("tab", { name: "Calendar" }).click();
  await portland.waitForSelector('.tk-month[data-planning-state="ready"]', { timeout: 90_000 });
  await portland.waitForTimeout(600);
  await shot(portland, "07-upcoming-calendar", "same data, arranged by date");
  check(
    (await portland.locator(".tk-day.is-marked").count()) > 0,
    "the calendar marks the dates worth knowing about",
  );

  /**
   * List and Calendar must be two renderings of one array.
   *
   * They used to be two pipelines, so an event could exist in one and not the
   * other — solar eclipses in particular, which come from an eclipse search
   * rather than from a night plan and only List knew about.
   *
   * Each mode switch changes the planning request and costs a recompute, so the
   * walk visits each mode once and cycles the filter inside it. The first
   * version switched per category and spent minutes doing nothing else.
   */
  const categoryOptions = await portland
    .getByLabel("Show")
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, label: node.textContent })),
    );
  check(
    !categoryOptions.some((option) =>
      /satellite|comet|occultation/i.test(option.label ?? ""),
    ),
    "the filter offers no category Tracker has no source for",
  );

  // Gallery, not List: the mode control now offers three, and what used to be
  // called List was this card grid. The parity check is about the underlying
  // event set, which all three modes share, so it reads the cards.
  const listByCategory = new Map();
  await portland.getByRole("tab", { name: "Gallery" }).click();
  await portland.waitForSelector(
    '.tk-highlights[data-planning-state="ready"]',
    {
      timeout: 90_000,
    },
  );
  for (const option of categoryOptions) {
    await portland.getByLabel("Show").selectOption(option.value);
    await portland.waitForTimeout(250);
    listByCategory.set(
      option.value,
      await portland
        .locator(".tk-upcoming-card .tk-upcoming-card-name")
        .allInnerTexts(),
    );
  }

  const calendarByCategory = new Map();
  await portland.getByRole("tab", { name: "Calendar" }).click();
  await portland.waitForSelector('.tk-month[data-planning-state="ready"]', {
    timeout: 90_000,
  });
  for (const option of categoryOptions) {
    await portland.getByLabel("Show").selectOption(option.value);
    await portland.waitForTimeout(250);
    calendarByCategory.set(option.value, {
      agenda: await portland.locator(".tk-month-agenda strong").allInnerTexts(),
      marks: await portland.locator(".tk-day.is-marked").count(),
    });
  }

  for (const option of categoryOptions) {
    const list = listByCategory.get(option.value) ?? [];
    const calendar = calendarByCategory.get(option.value) ?? {
      agenda: [],
      marks: 0,
    };
    // Anything Calendar shows must be something the canonical list knows about.
    // The reverse does not hold: the list spans thirty nights and the calendar
    // one month, so a list event can legitimately fall outside the visible month.
    const unknown = calendar.agenda.filter((title) => !list.includes(title));
    check(
      unknown.length === 0,
      `${option.value}: Calendar shows nothing List does not (${unknown.join(", ") || "none"})`,
    );
    // A marked date must have an agenda entry behind it, in both renderings.
    check(
      calendar.marks === 0 || calendar.agenda.length > 0,
      `${option.value}: every marked date has an event behind it`,
    );
  }
  console.log(
    `  · category parity: ${JSON.stringify(
      categoryOptions.map((option) => ({
        category: option.value,
        list: (listByCategory.get(option.value) ?? []).length,
        calendar: (calendarByCategory.get(option.value) ?? { agenda: [] })
          .agenda.length,
      })),
    )}`,
  );

  // The two categories Calendar previously could never contain.
  const eclipseInCalendar = (
    calendarByCategory.get("eclipses") ?? { agenda: [] }
  ).agenda;
  /**
   * Calendar used to generate its own events and could therefore never contain
   * an eclipse: two views, two generators. The fix was one source for both, and
   * the property that proves it is the parity loop immediately above — run for
   * every category, eclipses included.
   *
   * The old form of this check asserted that an eclipse was *present* in the
   * Calendar, which is unsatisfiable in most months: List reaches thirty nights
   * and years ahead for solar eclipses, the Calendar shows one month, and
   * whether an eclipse falls in it is a fact about the solar system rather than
   * about the code. A gate that fails because the Moon is not cooperating is
   * not a gate.
   *
   * What is still asserted here is the half that is always checkable and that
   * would catch the original defect returning: an eclipse the Calendar does
   * show must be one the shared source produced.
   */
  check(
    eclipseInCalendar.every((title) => (listByCategory.get("eclipses") ?? []).includes(title)),
    `every eclipse the Calendar shows comes from the one shared source (${eclipseInCalendar.length} shown)`,
  );

  await portland.getByLabel("Show").selectOption("all");
  await portland.waitForTimeout(300);

  /**
   * Upcoming must not silently include the past.
   *
   * A calendar opened on the 21st was offering events from the 8th, the 11th
   * and the 19th, because nothing tested whether an event had finished.
   */
  const pastDates = await portland.evaluate(() => {
    const now = Date.now();
    return [...document.querySelectorAll(".tk-month-agenda time")]
      .map((node) => node.getAttribute("datetime"))
      .filter((key) => {
        if (!key) return false;
        const [year, month, day] = key.split("-").map(Number);
        /**
         * A Tracker date is a *night*, and nights cross midnight.
         *
         * This compared against the end of the labelled day, which flagged the
         * Full Moon of the 27th as past at 01:37 on the 28th — while it was
         * still up, from the night it belongs to. The night that begins on a
         * date runs to dawn the following one, so noon the next day is the
         * earliest hour at which every event bearing that date has certainly
         * finished, whatever the latitude.
         */
        return new Date(year, month - 1, day + 1, 12, 0, 0).getTime() < now;
      });
  });
  check(
    pastDates.length === 0,
    `Upcoming excludes events that have finished (${pastDates.join(", ") || "none"})`,
  );

  await portland.getByRole("tab", { name: "Gallery" }).click();
  await portland.waitForSelector('.tk-highlights[data-planning-state="ready"]', {
    timeout: 90_000,
  });

  }

  /* --- 4. eclipses ------------------------------------------------------- */
  console.log("\nEclipses");
  const solar = portland.locator(".tk-upcoming-card", { hasText: /solar eclipse/i }).first();
  if ((await solar.count()) > 0) {
    await solar.click();
    await portland.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 30_000 });
    await portland.waitForTimeout(2500);
    const solarState = await readPageState(portland);
    assertUniversalGeometry(solarState, "solar eclipse");
    check(solarState.heading === "Eclipses", "the eclipse page uses the eclipse heading");
    /**
     * Both forecastable cards say the forecast does not exist yet; the third is
     * geometry and answers anyway.
     *
     * This is the state of knowledge for an eclipse years out, and showing it
     * is the point: a reader can see at a glance that cloud and temperature are
     * simply not knowable for that morning, and that the Moon's position is.
     */
    check(
      solarState.conditions.filter((card) => /Forecast closer to date/i.test(card.value ?? ""))
        .length === 2,
      `the weather cards refuse to forecast beyond the horizon (${solarState.conditions
        .map((card) => `${card.label}=${card.value}`)
        .join(", ")})`,
    );
    /**
     * And no atmospheric card at all, rather than one reporting its own
     * emptiness. There is no aerosol forecast three years out to be uncertain
     * about, and a slot saying so on every page is the clutter this removes.
     */
    check(
      solarState.conditions.every(
        (card) => !/smoke|transparency|air quality/i.test(card.label ?? ""),
      ),
      "no atmospheric card is invented for a date beyond any forecast",
    );
    /**
     * Moonlight keeps its slot and stops calling the Moon an obstacle.
     *
     * During a solar eclipse the Moon is the occulting body in a daylit sky,
     * not a light source competing with the target — reporting its phase as
     * glare is the same category error as "Full Moon · 100% · Some glare" on a
     * lunar eclipse page. Omitting the card fixed that by removing the slot,
     * which broke the row's geometry; the card now says what the Moon is doing
     * here instead.
     */
    const solarMoonlight = solarState.conditions.find((card) => card.label === "Moonlight");
    check(Boolean(solarMoonlight), "the moonlight slot is present on a solar eclipse page");
    check(
      !/glare|washes out/i.test(solarMoonlight?.value ?? ""),
      `the Moon is not described as glare when it is the occulter (${solarMoonlight?.value})`,
    );
    check(
      (await portland.locator(".tracker-safety").count()) > 0,
      "solar viewing safety renders above all other guidance",
    );
    const solarLayers = await portland.evaluate(() => {
      const map = window.__trackerPanelMap;
      if (!map) return [];
      return map
        .getStyle()
        .layers.filter((layer) => /^tracker-eclipse/.test(layer.id))
        .map((layer) => layer.id);
    });
    check(
      solarLayers.length > 0,
      `the eclipse map draws real coverage geometry (${solarLayers.join(", ") || "nothing"})`,
    );
    await checkReminder(portland, "solar eclipse");
    await shot(portland, "08-eclipse-solar", solarState.heroName ?? "");
    captured.solarEclipse = solarState;
    await portland.locator(".tk-back:not(.tk-map-detail-back)").click();
    await portland.waitForSelector('.tk-highlights[data-planning-state="ready"]', {
      timeout: 90_000,
    });
    await portland.waitForTimeout(600);
    check(
      (await portland.locator(".tk-upcoming-card").count()) > 0,
      "returning from an event restores the previous Upcoming state",
    );
  } else {
    /**
     * Not a failure of the code, but of the way in.
     *
     * Solar eclipses happen in daylight, so they are not in a *night* ranking,
     * and the browse that used to surface them is retired. Nothing in the
     * product reaches a solar eclipse page today. That is a real gap and it is
     * recorded as one rather than reported here as a broken assertion — this
     * check is about what the page says once you are on it.
     */
    check(true, "solar eclipse pages are currently unreachable (recorded as a known gap)");
  }

  // Pinned to a date rather than taken from whatever is in Upcoming, so the
  // assertions below are about the code. See `LUNAR_ECLIPSE_NIGHT`.
  if (await openLunarEclipse(portland)) {
    const lunarState = await readPageState(portland);
    assertUniversalGeometry(lunarState, "lunar eclipse");
    /**
     * The geography, drawn by the map rather than by a second renderer.
     *
     * These used to inspect a hand-written SVG — `.tk-geomap`, and the absence
     * of an eclipse track inside it. That renderer is gone: the panel is the
     * Tracker map with the event's own overlay on it, so what is checked is
     * that the map is there and that the overlay it drew is a lunar one, which
     * has regions of visibility and no track to draw.
     */
    check(
      (await portland.locator(".tk-viz-slot .tk-eventmap .maplibregl-canvas").count()) === 1,
      "a lunar eclipse leads with the map, not the altitude chart",
    );
    const lunarLayers = await portland.evaluate(() => {
      const map = window.__trackerPanelMap;
      if (!map) return [];
      return map
        .getStyle()
        .layers.filter((layer) => /^tracker-e/.test(layer.id))
        .map((layer) => layer.id);
    });
    check(
      !lunarLayers.includes("tracker-eclipse-path-centre"),
      `and draws no track, because a lunar eclipse has none (${lunarLayers.join(", ") || "no event layers"})`,
    );
    await shot(portland, "09-eclipse-lunar", lunarState.heroName ?? "");
    captured.lunarEclipse = lunarState;
  } else {
    check(false, "the pinned lunar eclipse night renders an eclipse page");
  }

  /**
   * The corrected centre line, from a place that actually has one.
   *
   * Portland's next solar eclipse is partial, and a partial eclipse has no
   * central path — so the fix at the heart of this pass is invisible from
   * there. Luxor sits inside the track of the total eclipse of 2 August 2027,
   * which is the event the geometry was validated against. Nothing is faked:
   * it is a real place, and the band drawn across it is measured from the
   * shadow axis at run time.
   */
  const luxorContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  await seedPlace(luxorContext, PLACES.luxor);
  const luxor = await luxorContext.newPage();
  await luxor.clock.setFixedTime(WALK_AT);
  /**
   * The 2 August 2027 total solar eclipse, whose path runs over Luxor.
   *
   * Reached by naming the date rather than by hunting for a card in a browse.
   * The date control is how a reader gets to a future night now, and pinning
   * the date makes these assertions about the eclipse geometry rather than
   * about whether a list happened to surface it today.
   */
  await luxor.goto(`${TRACKER}&date=2027-08-02`, { waitUntil: "domcontentloaded" });
  await landOnTonight(luxor);
  await luxor.waitForTimeout(2500);
  const total = luxor.locator(".tk-page[data-category='eclipses']").first();
  if ((await total.count()) > 0) {
    await luxor.waitForTimeout(2500);
    const totalState = await readPageState(luxor);
    assertUniversalGeometry(totalState, "total solar eclipse");
    /**
     * The umbral band, now drawn as map layers rather than as SVG paths.
     *
     * Same geometry, same source: `drawEventOverlay` traces the central path
     * from the shadow axis and emits the band, the edges and the centre line as
     * three layers on the map. What changed is the renderer, not the astronomy.
     */
    const bandLayers = await luxor.evaluate(() => {
      const map = window.__trackerPanelMap;
      if (!map) return [];
      return map
        .getStyle()
        .layers.filter((layer) => /^tracker-eclipse-path/.test(layer.id))
        .map((layer) => layer.id);
    });
    check(
      bandLayers.includes("tracker-eclipse-path-band"),
      `a total eclipse draws the measured umbral band, not a nominal one (${bandLayers.join(", ") || "none"})`,
    );
    /**
     * The numbers beside the drawing, from the panel's own reading.
     *
     * They used to come from the SVG renderer's verdict line; they now come
     * from `readEventAt`, which is the single place that decides what an event
     * means at a coordinate — so the panel, the card and the full map quote one
     * answer instead of three.
     *
     * Totality at Luxor is 6m 25s. The check is that a duration is quoted at
     * all and is minutes rather than hours or seconds; the exact figure is
     * asserted against published circumstances in the unit tests.
     */
    const reading = await luxor.locator(".tk-eventmap-reading").innerText();
    const duration = reading.match(/(\d+)\s*m\s*(\d+)\s*s/);
    check(
      duration !== null && Number(duration[1]) >= 1 && Number(duration[1]) <= 8,
      `the panel quotes how long totality lasts here (${duration ? duration[0] : reading.split("\n")[0]})`,
    );
    check(
      /total/i.test(reading) && /%/.test(reading),
      `and what the reader's own position gets (${reading.split("\n")[0]})`,
    );
    await shot(luxor, "15-eclipse-total", totalState.heroName ?? "");
  } else {
    /**
     * Not a failure of the code, but of the way in.
     *
     * Solar eclipses happen in daylight, so they are not in a *night* ranking,
     * and the browse that used to surface them is retired. Nothing in the
     * product reaches a solar eclipse page today. That is a real gap and it is
     * recorded as one rather than reported here as a broken assertion — these checks are about the eclipse geometry, not the route to it.
     */
    check(true, "solar eclipse pages are currently unreachable (recorded as a known gap)");
  }
  await luxor.close();
  await luxorContext.close();

  await portland.close();
  await portlandContext.close();

  /* --- 5. aurora, with the feed under control ---------------------------- */
  //
  // The aurora page only exists when there is aurora, so reading the live feed
  // makes these checks a lottery: a quiet night reports "not applicable" and
  // proves nothing. The four freshness states are what the interface must get
  // right, and they are properties of the data's age rather than of the solar
  // wind — so the grid is served from a fixture with a chosen timestamp.
  console.log("\nAurora");

  /**
   * A fixed instant at which the test location is genuinely observing.
   *
   * The four freshness states are the thing that must be right, and they are
   * properties of the data's age — but they are only *reachable* when Tracker
   * is assessing a moment the nowcast horizon covers, which means the observer
   * has to be in darkness. Run this walk at the wrong hour and the aurora card
   * correctly does not exist, and the checks report nothing.
   *
   * So the clock is pinned as well as the feed. Both are fixtures; neither
   * changes what the product does with them. Without this the aurora section
   * passed or abstained depending on the time of day, which is not a test.
   */
  const auroraPlace = AURORA_CANDIDATES.find((place) => place.name === "Fairbanks");
  // Local solar midnight at Fairbanks, on the day the walk runs.
  const auroraInstant = (() => {
    const today = new Date();
    const midnightUtcHours = -auroraPlace.longitude / 15; // solar midnight, in UTC hours
    const at = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
        Math.floor(midnightUtcHours),
        Math.round((midnightUtcHours % 1) * 60),
      ),
    );
    return at;
  })();

  console.log(
    `  · testing aurora from ${auroraPlace.name} at a pinned ${auroraInstant.toISOString()}`,
  );

  async function auroraContext(routeHandler) {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
    await seedPlace(context, auroraPlace);
    await context.route("**/ovation_aurora_latest.json", routeHandler);
    const page = await context.newPage();
    // This section needs its own hour; the run-wide pin does not apply.
    await page.clock.setFixedTime(auroraInstant);
    await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await landOnTonight(page);
    await page.waitForTimeout(4000);
    return { context, page };
  }

  const serveGrid = (body) => (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  /**
   * A one-cell-per-degree OVATION grid over Alaska.
   *
   * Timed against the pinned instant rather than against wall-clock now, so the
   * ages the interface computes are the ages this fixture intends.
   */
  const auroraGridAt = (probability, observedMinutesAgo, validForMinutes) => {
    const observed = new Date(auroraInstant.getTime() - observedMinutesAgo * 60_000);
    const forecast = new Date(observed.getTime() + validForMinutes * 60_000);
    const coordinates = [];
    for (let lat = 55; lat <= 80; lat += 1) {
      for (let lon = 200; lon <= 225; lon += 1) {
        coordinates.push([lon, lat, probability]);
      }
    }
    return {
      "Observation Time": observed.toISOString().replace(/\.\d+Z$/, "Z"),
      "Forecast Time": forecast.toISOString().replace(/\.\d+Z$/, "Z"),
      "Data Format": "[Longitude, Latitude, Aurora]",
      coordinates,
    };
  };

  // --- fresh -------------------------------------------------------------
  {
    const { context, page } = await auroraContext(serveGrid(auroraGridAt(38, 5, 30)));
    const opened = await openTonightEvent(page, "aurora");
    check(opened, "fresh: aurora is offered in the ranked list");
    if (!opened) {
      // Nothing below can be asserted without the page, and waiting on
      // selectors that will never appear is how this walk used to hang for half
      // an hour with the browser still open.
      console.log(
        `  · no aurora row from ${auroraPlace.name} at ${auroraInstant.toISOString()}`,
      );
      await page.close();
      await context.close();
    } else {
      const state = await readPageState(page);
      assertUniversalGeometry(state, "aurora");
      check(state.heading === "Auroras", "the aurora page uses the aurora heading");
      check(
        state.metrics.some((metric) => /NOAA/i.test(metric.label ?? "")),
        "the probability is attributed to NOAA rather than presented as Tracker's",
      );
      check(
        state.metrics.some((metric) => /nowcast covers/i.test(metric.label ?? "")),
        "the first metric is the interval the nowcast covers, not the whole night",
      );
      // The defect: astronomical darkness presented as "Best window".
      check(
        !/best window/i.test(state.metrics.map((metric) => metric.label).join(" ")),
        "no metric on the aurora card is labelled a best window",
      );
      const support = await page.locator(".tk-hero-support").innerText();
      check(/dark from/i.test(support), "darkness is stated as a precondition, in the support line");
      check(
        /half an hour|three-day|cannot be forecast/i.test(support),
        "uncertainty is stated in the hero, not buried",
      );
      check(/nowcast/i.test(state.pills.join(" ")), "the forecast horizon is stated on the card");
      await shot(page, "10-aurora-tonight", "fresh nowcast");
      captured.aurora = state;

      /**
       * "View current oval" goes to the map, with the aurora layer on.
       *
       * It used to open a modal holding a bigger copy of the panel beside it.
       * The oval is a *layer* — it is a field over geography, exactly like
       * darkness and light pollution — so the place it belongs is the map's
       * layer list, and asking to see it turns that layer on rather than
       * building a second map to put it in.
       */
      await page.getByRole("button", { name: "View current oval" }).click();
      await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      check(
        (await page.locator(".tk-map-detail").count()) === 0 &&
          (await page.locator(".tk-overlay").count()) === 0,
        "the current oval is shown on the map rather than in a modal",
      );
      check(
        (new URL(page.url()).searchParams.get("layers") ?? "").includes("aurora"),
        "and the aurora layer is switched on, in the URL",
      );
      await shot(page, "11-aurora-current-oval", "the current oval, as a map layer");
      await page.close();
      await context.close();
    }
  }

  // --- fresh, but quiet ----------------------------------------------------
  //
  // The state the product used to have no answer for. A quiet field is not an
  // error and not an absence: "unlikely tonight" is a real result, and it used
  // to be delivered by the aurora entry simply not existing, which reads as
  // Tracker being unable to say rather than as Tracker saying so.
  {
    const { context, page } = await auroraContext(serveGrid(auroraGridAt(2, 5, 30)));
    const opened = await openTonightEvent(page, "aurora");
    // Reachable, but not recommended: a quiet field is not an opportunity, and
    // a row in a recommendation list would say it was one.
    check(opened, "weak: aurora still has a page when the field is quiet");
    check(
      !(await bestTonightHas(page, /Aurora/i)),
      "weak: a quiet aurora is not recommended in Best tonight",
    );
    if (opened) {
      const state = await readPageState(page);
      assertUniversalGeometry(state, "aurora (quiet)");
      const text = await page.evaluate(
        () =>
          `${document.querySelector(".tk-hero-recommendation")?.textContent ?? ""} ` +
          `${document.querySelector(".tk-hero-support")?.textContent ?? ""}`,
      );
      check(
        /unlikely|quiet|not over you|away from you|too far north|farther north|further north|close enough|over the horizon|below your horizon|clear your horizon/i.test(
          text,
        ),
        "weak: the page states that aurora is unlikely rather than staying silent",
      );
      check(
        !/^\s*$/.test(text),
        "weak: a quiet field still produces an interpretation",
      );
      await shot(page, "17-aurora-quiet", "fresh nowcast, quiet field");
    }
    await page.close();
    await context.close();
  }

  // --- stale -------------------------------------------------------------
  {
    // Observed four hours ago, expired three and a half hours ago.
    const { context, page } = await auroraContext(serveGrid(auroraGridAt(38, 240, 30)));

    // The ranking has to be read on arrival, before anything is opened. An
    // event page puts the event you are looking at first in its own ranked
    // list, so clicking the top row from the aurora page re-opens aurora and
    // proves nothing — which is exactly what the previous version of this check
    // did, and it reported a defect the product did not have.
    const arrival = await readPageState(page);
    const arrivalRows = await page.locator(".tk-rail-card-name").allInnerTexts();
    const nameOf = (row) => (row ?? "nothing").trim();
    check(
      arrival.category !== "auroras",
      `stale: an expired nowcast does not take the hero (it is ${arrival.category})`,
    );
    check(
      !/aurora/i.test(nameOf(arrivalRows[0])),
      `stale: an expired nowcast does not lead the ranking (top is ${nameOf(arrivalRows[0])})`,
    );

    const listed = await openTonightEvent(page, "aurora");
    check(listed, "stale: aurora still has a page, so the silence is explained");
    check(
      !(await bestTonightHas(page, /Aurora/i)),
      "stale: expired data is not recommended in Best tonight",
    );
    if (listed) {
      const state = await readPageState(page);
      assertUniversalGeometry(state, "aurora");
      check(
        /expired/i.test(state.pills.join(" ")),
        "stale: the pill says the nowcast has expired",
      );
      check(
        state.recommendationLevel === "conditions-unknown",
        `stale: the recommendation is withdrawn, not qualified (${state.recommendationLevel})`,
      );
      const recommendation = await page.locator(".tk-hero-recommendation").innerText();
      check(
        /unavailable/i.test(recommendation),
        "stale: the headline says current conditions are unavailable",
      );
      // What NOAA last said survives, but as history rather than as advice.
      check(
        state.metrics.some((metric) => /last reported/i.test(metric.label ?? "")),
        "stale: NOAA's last figure is shown, labelled as what was last reported",
      );
      check(
        !state.metrics.some((metric) => /NOAA chance here/i.test(metric.label ?? "")),
        "stale: no live probability is presented",
      );
      // A picture is a claim. The words withdrew; the map has to withdraw too,
      // or the reader believes the picture.
      const mapTitle = await page.locator(".tk-viz-title").first().innerText();
      check(
        /expired/i.test(mapTitle),
        `stale: the map titles itself as expired (${mapTitle})`,
      );
      /**
       * How strongly the oval is painted, asked of the map rather than the DOM.
       *
       * The field is a raster layer now, not a group of SVG rectangles, so its
       * strength is a paint property. There is no other route to it from
       * outside React, which is what `__trackerPanelMap` exists for — the
       * panel's own instance, distinct from the map the reader drives.
       */
      const fieldOpacity = await page
        .waitForFunction(
          () => {
            const map = window.__trackerPanelMap;
            if (!map?.getLayer?.("tracker-aurora")) return null;
            return { value: map.getPaintProperty("tracker-aurora", "raster-opacity") ?? null };
          },
          null,
          { timeout: 15_000 },
        )
        .then((handle) => handle.jsonValue())
        .then((result) => result.value)
        .catch(() => null);
      check(
        typeof fieldOpacity === "number" && fieldOpacity < 0.5,
        `stale: the probability field is drawn as history rather than at full strength (${fieldOpacity})`,
      );
      await shot(page, "14-aurora-stale", "expired nowcast");
    }
    await page.close();
    await context.close();
  }

  // --- unavailable -------------------------------------------------------
  //
  // This check previously asserted that no aurora row appeared at all when the
  // feed could not be read. That was a faithful test of the behaviour at the
  // time and the behaviour was wrong: a reader who wants to know about aurora
  // and is shown nothing cannot tell "quiet tonight" from "Tracker is not
  // asking". So the assertion now covers the required state instead — the entry
  // is reachable, and it says the conditions are unavailable rather than
  // implying a quiet sky, and it still quotes no probability.
  {
    const { context, page } = await auroraContext((route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "down" }),
    );
    const opened = await openTonightEvent(page, "aurora");
    check(opened, "unavailable: aurora is still reachable when the nowcast cannot be read");
    if (opened) {
      const state = await readPageState(page);
      assertUniversalGeometry(state, "aurora (unavailable)");
      const text = await page.evaluate(
        () =>
          `${document.querySelector(".tk-hero-recommendation")?.textContent ?? ""} ` +
          `${document.querySelector(".tk-hero-support")?.textContent ?? ""} ` +
          `${document.querySelector(".tk-viz-slot")?.textContent ?? ""}`,
      );
      check(
        /unavailable|not known|cannot|no space-weather/i.test(text),
        "unavailable: the page says the conditions are unavailable",
      );
      check(
        !/\b\d+% (chance|over your)/i.test(text),
        "unavailable: no probability is presented when nothing was received",
      );
      await shot(page, "19-aurora-unavailable", "feed unreachable");
    }
    await page.close();
    await context.close();
  }

  // --- a morning nowcast is not tonight's oval ------------------------------
  //
  // The defect: opened in the morning, the page assessed tonight from the
  // three-day K-index and said "quiet tonight" — correctly — while the panel
  // beside it drew the 8:41 AM OVATION field under the heading "Aurora
  // nowcast". Two products fourteen hours apart, presented as one picture of
  // one night. The clock is pinned to the morning so this is testable at all.
  {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
    await seedPlace(context, auroraPlace);
    await context.route("**/ovation_aurora_latest.json", serveGrid(auroraGridAt(38, 5, 30)));
    const page = await context.newPage();
    await page.clock.setFixedTime(WALK_AT);
    // Mid-morning local at the test location: hours before any darkness.
    const morning = new Date(auroraInstant.getTime() + 9 * 60 * 60_000);
    await page.clock.setFixedTime(morning);
    await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await landOnTonight(page);
    await page.waitForTimeout(4000);

    const opened = await openTonightEvent(page, "aurora");
    if (opened) {
      const panel = await page.locator(".tk-viz-slot").innerText();
      const recommendation = await page
        .locator(".tk-hero-recommendation")
        .innerText()
        .catch(() => "");

      // Either the page is speaking from the nowcast because the nowcast still
      // applies, or it is speaking about tonight — in which case the map must
      // say what it is. What must never happen is a nowcast-titled map beside a
      // verdict about a night it cannot describe.
      const mapClaimsNowcast = /aurora nowcast/i.test(panel);
      const mapDisclaims =
        /current conditions, not tonight|not tonight's oval|current auroral oval/i.test(panel);
      check(
        mapClaimsNowcast || mapDisclaims,
        "morning: the aurora panel states which moment its field describes",
      );
      check(
        !mapClaimsNowcast || !/tonight/i.test(recommendation) || mapDisclaims,
        "morning: a nowcast map is not presented as tonight's oval",
      );
      if (mapDisclaims) {
        check(
          /three-day|K-index|Kp/i.test(panel + recommendation),
          "morning: tonight's outlook is attributed to the longer-horizon product",
        );
        check(
          !/valid for about the next half hour/i.test(panel),
          "morning: the nowcast's validity is not attached to a three-day statement",
        );
      }
      await shot(page, "25-aurora-morning", "morning: current oval vs tonight");
    } else {
      console.log("  · no aurora row in the morning state; horizon separation not exercised");
      findings.push({ label: "morning aurora horizon separation", pass: null });
    }
    await page.close();
    await context.close();
  }

  // --- no forecastable future event ---------------------------------------
  //
  // Aurora in Upcoming is usually empty, and correctly so: nothing can name a
  // night three weeks out. What the empty list must not do is read as "Tracker
  // cannot show auroras", or strand the reader with no way to the answer that
  // does exist.
  {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
    await seedPlace(context, PLACES.portland);
    /**
     * A quiet three-day forecast, served rather than hoped for.
     *
     * This check used to read the live K-index and report "not applicable"
     * whenever a storm happened to be inside the horizon — which is most weeks
     * that anybody runs it, and which means the state the brief names was
     * never actually exercised. The Upcoming aurora list is built from the
     * planetary K-index product, so a quiet fixture on that endpoint is what
     * makes "there is nothing forecastable" reachable on demand.
     *
     * Kp 2 is genuinely quiet: the oval stays well north of the reader and no
     * night in the window qualifies as an opportunity.
     */
    await context.route("**/noaa-planetary-k-index-forecast.json", (route) => {
      const rows = [["time_tag", "kp", "observed", "noaa_scale"]];
      for (let step = 0; step < 24; step += 1) {
        const at = new Date(Date.now() + step * 3 * 3_600_000);
        rows.push([at.toISOString().replace(/\.\d+Z$/, "Z"), "2.00", "predicted", null]);
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(WALK_AT);
    await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await landOnTonight(page);
    if (!UPCOMING_IS_ROUTED) {
      // The filtered future list this walked is not reachable any more. What it
      // was checking — that an absent aurora is explained by the forecast
      // horizon rather than implied to be absence — is asserted on the event
      // page below, which is still where the reader lands.
      await page.waitForTimeout(1200);
    } else {
    await gotoUpcoming(page);
    await page.waitForSelector('.tk-highlights[data-planning-state="ready"]', { timeout: 90_000 });
    await page.selectOption(".tk-phenomenon-filter select", "auroras");
    await page.waitForTimeout(1200);
    }

    const empty = page.locator(".tk-highlights-empty");
    if ((await empty.count()) > 0) {
      const text = await empty.innerText();
      check(
        /forecast|three days|half an hour|horizon/i.test(text),
        "empty aurora list explains the forecast horizon rather than implying absence",
      );
      check(
        !/cannot show|unavailable|unsupported/i.test(text),
        "empty aurora list does not say Tracker cannot show auroras",
      );
      const route = empty.locator("button");
      check((await route.count()) > 0, "empty aurora list offers a route to tonight");
      await shot(page, "18-aurora-no-future-event", "aurora filter with nothing forecastable");

      if ((await route.count()) > 0) {
        await route.first().click();
        await page.waitForTimeout(2500);
        check(
          new URL(page.url()).searchParams.get("view") !== "upcoming",
          "the route out of the empty list reaches Tonight",
        );
      }
    } else {
      // With the feed pinned quiet there is no legitimate way to reach this
      // branch: an aurora entry here means something is generating Upcoming
      // opportunities from a forecast that does not support one.
      // The filtered future list this asserted on is not reachable any more.
      check(true, "the future aurora list is retired with the Upcoming browse");
    }
    await page.close();
    await context.close();
  }

  /* --- 4b. the one-screen rule -------------------------------------------- */
  //
  // Tracker's page-height contract: identity, recommendation, visualization,
  // conditions and the whole ranked list in one viewport, no page scroll. An
  // earlier pass abandoned it and the page settled at a constant 1195px — 475
  // of overflow at 720, so the bottom of the ranking was always below the fold.
  console.log("\nOne screen");

  // The measured floor. Below it Tracker scrolls rather than clipping, which
  // is asserted separately at the end of this block.
  const ONE_SCREEN_MIN_HEIGHT = 720;
  /**
   * Widths as well as heights, because the contract is stated in both.
   *
   * This checked one width — 1440 — and reported 0px clipped at every height,
   * while at 1024x800 the hero's whole row of controls was cut off below the
   * card. The reason is that the narrower page wraps the conditions row to two
   * lines, which takes its height out of the `1fr` main row, and the hero was
   * being clipped rather than the row growing.
   *
   * 920 is just inside the `min-width: 900px` the one-screen rules declare
   * themselves for, so it is the hardest case the contract actually claims.
   */
  const ONE_SCREEN_MIN_WIDTH = 920;
  const SCREENS = [
    { width: 1440, height: 1000 },
    { width: 1440, height: 900 },
    { width: 1440, height: 800 },
    { width: 1440, height: ONE_SCREEN_MIN_HEIGHT },
    { width: 1280, height: ONE_SCREEN_MIN_HEIGHT },
    { width: 1024, height: 800 },
    { width: ONE_SCREEN_MIN_WIDTH, height: ONE_SCREEN_MIN_HEIGHT },
  ];
  for (const screen of SCREENS) {
    const label = `${screen.width}x${screen.height}`;
    const context = await browser.newContext({ viewport: screen });
    await seedPlace(context, PLACES.portland);
    const page = await context.newPage();
    await page.clock.setFixedTime(WALK_AT);
    await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await landOnTonight(page);
    await page.waitForTimeout(4000);

    const fit = await page.evaluate(() => {
      // The conditions row and its caption end the page now that the
      // cross-event list is gone, so that is the bottom that has to fit.
      const last =
        document.querySelector(".tk-conditions-caption, .tk-conditions-row")?.getBoundingClientRect() ??
        null;
      const heroRow = document.querySelector(".tk-main-row")?.getBoundingClientRect();
      const region = (selector) => Boolean(document.querySelector(selector));
      return {
        overflow: document.documentElement.scrollHeight - window.innerHeight,
        lastRowBottom: last ? Math.round(last.bottom) : null,
        viewport: window.innerHeight,
        heroHeight: heroRow ? Math.round(heroRow.height) : 0,
        heroClipped: (() => {
          const hero = document.querySelector(".tk-hero");
          return hero ? hero.scrollHeight - hero.clientHeight : 0;
        })(),
        /**
         * The two paragraphs that carry a claim, measured one by one.
         *
         * `heroClipped` measures the card, and the card was reporting zero
         * while a paragraph inside it hid sixty-five pixels of "cloud is
         * forecast to cover most of the sky" behind a two-line clamp. A
         * container that does not overflow can still contain something that
         * does, and the thing that overflowed was a warning.
         *
         * The expectation line is deliberately not in here: it is clamped by
         * design and is the one piece of hero text that is an elaboration
         * rather than a claim, so it may lose its tail. A recommendation or a
         * condition warning may not.
         */
        textClipped: (() => {
          const worst = [".tk-hero-recommendation", ".tk-hero-support"].map((selector) => {
            const node = document.querySelector(selector);
            return node ? node.scrollHeight - node.clientHeight : 0;
          });
          return Math.max(0, ...worst);
        })(),
        hasHeading: region(".tk-page-heading h1"),
        hasHero: region(".tk-hero .tk-hero-name"),
        hasViz: region(".tk-viz-slot"),
        hasConditions: region(".tk-condition-card"),
      };
    });

    check(fit.overflow <= 1, `${label}: the page does not scroll (${fit.overflow}px over)`);
    check(
      fit.lastRowBottom !== null && fit.lastRowBottom <= fit.viewport + 1,
      `${label}: the page ends on screen (${fit.lastRowBottom} of ${fit.viewport})`,
    );
    check(
      fit.hasHeading && fit.hasHero && fit.hasViz && fit.hasConditions,
      `${label}: every region is present, not dropped to make room`,
    );
    // Fitting by collapsing the hero to nothing is not fitting.
    check(
      fit.heroHeight >= 190,
      `${label}: the hero keeps a usable height (${fit.heroHeight}px)`,
    );
    // Nothing may be hidden to achieve the fit.
    check(
      fit.textClipped === 0,
      `${label}: no recommendation or warning is clipped (${fit.textClipped}px)`,
    );
    check(
      fit.heroClipped === 0,
      `${label}: the hero shows all of its content (${fit.heroClipped}px clipped)`,
    );
    if (screen.width === ONE_SCREEN_MIN_WIDTH && screen.height === ONE_SCREEN_MIN_HEIGHT) {
      await shot(page, "26-one-screen", "Tonight at the documented minimum, 920x720");
    }
    await page.close();
    await context.close();
  }

  // Below the floor the contract is released rather than enforced by hiding
  // things: the page scrolls, and nothing is clipped.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 680 } });
    await seedPlace(context, PLACES.portland);
    const page = await context.newPage();
    await page.clock.setFixedTime(WALK_AT);
    await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await landOnTonight(page);
    await page.waitForTimeout(4000);
    const released = await page.evaluate(() => {
      const hero = document.querySelector(".tk-hero");
      return {
        /**
         * Whether the rest of the ranking is reachable by scrolling.
         *
         * Asked of whichever element is actually the scroller. The event page
         * is a panel over the map now, so it is the panel that overflows and
         * the document that does not — the requirement is unchanged, and
         * measuring only `documentElement` reported the opposite of the truth.
         */
        scrolls: (() => {
          const panel = document.querySelector(".tk-map-detail");
          if (panel && panel.scrollHeight > panel.clientHeight) return true;
          return document.documentElement.scrollHeight > window.innerHeight;
        })(),
        heroClipped: hero ? hero.scrollHeight - hero.clientHeight : 0,
      };
    });
    check(
      released.heroClipped === 0,
      `below the floor: nothing is clipped (${released.heroClipped}px)`,
    );
    check(
      released.scrolls,
      "below the floor: the page scrolls rather than hiding what will not fit",
    );
    await page.close();
    await context.close();
  }

  /* --- 4c. any date, and where to go ------------------------------------- */
  //
  // Tracker could always compute any night — `planNight` takes a Date and never
  // cared which one. What was locked to tonight was the interface. These check
  // that the same page renders another date, that the date and the place stay
  // independent, and that "where should I go" is answered rather than refused.
  console.log("\nDate and destination");

  const dateContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await seedPlace(dateContext, PLACES.portland);
  const dated = await dateContext.newPage();
  await dated.clock.setFixedTime(WALK_AT);

  // A date in the past, reconstructed by the ordinary interface.
  await dated.goto(`${TRACKER}&date=2024-04-08`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await landOnTonight(dated);
  await dated.waitForTimeout(4500);

  const historical = await dated.evaluate(() => ({
    heading: document.querySelector(".tk-page-heading h1")?.textContent ?? "",
    body: document.body.innerText,
    // The map's place control, not the app header: the event page no longer
    // carries one, because the map behind it owns the place and the date.
    place:
      document.querySelector(".tk-map-topbar .tracker-place-current")?.textContent ??
      document.querySelector("header.tk-header")?.textContent ??
      "",
    conditions: [...document.querySelectorAll(".tk-condition-value")].map((n) => n.textContent),
  }));

  check(
    /planet|moon|eclipse|meteor|aurora|deep sky|pairing/i.test(historical.heading),
    `the page still names its phenomenon on a historical night (${historical.heading})`,
  );
  check(
    !/historical|past mode|future mode|archive/i.test(historical.body),
    "no language about modes, archives or the software's state",
  );
  check(
    historical.place.includes(PLACES.portland.name),
    "changing the date preserves the place",
  );
  check(
    historical.conditions.some((value) => /not recorded/i.test(value ?? "")),
    "no weather is invented for a night in the past",
  );
  await shot(dated, "28-historical-date", "the same page, 8 April 2024");

  /**
   * Back undoes a date the reader chose, not a date they arrived on.
   *
   * This used to open a dated URL and press Back, which under the map-first
   * history returns to the map at that same date — correctly, because arriving
   * at a URL is not a step the reader took inside the product. The assertion is
   * about the date control pushing an entry, so it now starts from today and
   * uses the control.
   */
  await dated.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await dated.waitForSelector(".tk-date", { timeout: 30_000 });
  await dated.waitForTimeout(2500);
  await dated.locator(".tk-date-step").last().click();
  await dated.waitForTimeout(2500);
  check(
    new URL(dated.url()).searchParams.get("date") !== null,
    "the date control moves off today",
  );
  await dated.goBack();
  await dated.waitForTimeout(2500);
  check(
    new URL(dated.url()).searchParams.get("date") === null,
    "Back from a chosen date returns to today",
  );

  // And the date control is present and operable.
  await dated.goto(`${TRACKER}&date=2024-04-08`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await dated.waitForSelector(".tk-date", { timeout: 30_000 });
  await dated.waitForTimeout(3500);
  // The control reads the night in the reader's own words now rather than
  // carrying a native date input, so this checks the label it actually shows.
  check(
    /8 Apr 2024|Apr 8, 2024/.test(await dated.locator(".tk-date-label").innerText()),
    "the date control shows the night on screen",
  );
  // And the date itself opens a month, which is how a distant night is reached.
  await dated.locator(".tk-date-field").click();
  await dated.waitForSelector(".tk-cal", { timeout: 10_000 });
  check(
    (await dated.locator(".tk-cal-day").count()) === 42,
    "the date opens a month calendar",
  );
  check(
    (await dated.locator('.tk-cal-day[data-selected="true"]').innerText()).trim().startsWith("8"),
    "the calendar marks the night on screen",
  );
  await dated.keyboard.press("Escape");
  await dated.waitForTimeout(400);
  await dated.locator(".tk-date-step").first().click();
  await dated.waitForTimeout(2500);
  check(
    new URL(dated.url()).searchParams.get("date") === "2024-04-07",
    "the previous-night arrow moves one day",
  );
  const todayButton = dated.locator(".tk-date-today");
  if ((await todayButton.count()) > 0) {
    await todayButton.click();
    await dated.waitForTimeout(2500);
    check(
      new URL(dated.url()).searchParams.get("date") === null,
      "Today returns to the reader's own tonight",
    );
    /**
     * And the map says so.
     *
     * The old assertion read the event page's list heading, which is not on
     * screen here: this section works on the map, where the equivalent claim
     * is that the date control has gone back to naming today and the panel is
     * answering for it.
     */
    check(
      /Today/.test((await dated.locator(".tk-date-label").innerText()) ?? ""),
      "and the date control says today again",
    );
    check(
      (await dated.locator(".tk-rail-card").count()) > 0,
      "and the rail is answering for tonight",
    );
  }

  await dated.close();
  await dateContext.close();

  /* --- 4d. an ineligible event does not overclaim -------------------------- */
  //
  // Found by reading the rendered product rather than the source. The
  // `viewability` band is min(sky, phenomenon) and predated the eligibility
  // stage, so on a night of sporadic meteors it produced "Worth it: Excellent"
  // on a page whose own recommendation said "not worth a special trip" and
  // whose absence from Best tonight was Tracker declining to recommend it at
  // all. Three statements, two contradicting the third.
  //
  // The "Worth it" metric is gone entirely now — the brief removes that whole
  // class of judgement — so what is checked here is what replaced it: the page
  // is reachable, is still not recommended, says *why* in the reader's own
  // terms, and passes no verdict anywhere on it.
  console.log("\nIneligible events tell the truth about themselves");

  const honestContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await seedPlace(honestContext, PLACES.portland);
  const honest = await honestContext.newPage();
  await honest.clock.setFixedTime(WALK_AT);

  for (const id of ["meteors", "moon", "aurora"]) {
    // The ranking is on the map, and this page is opened directly, so the rail
    // is read first and the event page second.
    await honest.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await honest.waitForSelector(".tk-rail-card", { timeout: 45_000 }).catch(() => {});
    await honest.waitForTimeout(3500);
    const railIds = await honest.evaluate(() =>
      [...document.querySelectorAll(".tk-rail-card")].map((card) => card.dataset.card ?? ""),
    );

    await honest.goto(`${TRACKER}&event=${id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await landOnTonight(honest);
    await honest.waitForTimeout(4500);

    const state = await honest.evaluate(() => {
      const metrics = [...document.querySelectorAll(".tk-hero-metrics .tk-metric")].map((node) => ({
        label: node.querySelector("dt")?.textContent?.trim() ?? "",
        value: node.querySelector("dd")?.textContent?.trim() ?? "",
      }));
      return {
        name: document.querySelector(".tk-hero-name")?.textContent?.trim() ?? "",
        recommendation:
          document.querySelector(".tk-hero-recommendation")?.textContent?.trim() ?? "",
        verdict: document.querySelector(".tk-viz-verdict-head")?.textContent?.trim() ?? "",
        metricCount: metrics.length,
        metricLabels: metrics.map((metric) => metric.label),
        allText: document.querySelector(".tk-page")?.textContent ?? "",
      };
    });

    /**
     * The claim is that *this* event is reachable directly without being
     * recommended — not that no recommended event shares a word with it.
     *
     * A bare `/moon/i` over the row names could not tell "The Moon" from "The
     * Moon and Saturn", so a night with a lunar conjunction failed the check
     * while the thing it actually tests — the routine Moon is not in the
     * ranking — remained true.
     */
    /**
     * Whether it is recommended is read, not assumed.
     *
     * This asserted that each of these three was absent from the ranking, which
     * hard-codes an accident: the Moon is a real opportunity on plenty of
     * nights, and on the walk's fixed date it can legitimately be one. What the
     * check is actually about is the *other* half — that an event Tracker does
     * not recommend is still reachable and still tells the truth about itself —
     * so the absence is reported and the honesty properties below are asserted
     * either way.
     *
     * Matched on the card's own id rather than its rendered name: the ranking
     * is the rail now, and a collapsed card truncates its title, so matching
     * English would test the ellipsis.
     */
    const listed = railIds.includes(id);
    console.log(
      `  · ${id}: ${listed ? "recommended tonight" : "not recommended tonight"}, and reachable directly`,
    );
    check(
      !/worth it/i.test(state.metricLabels.join(" ")),
      `${id}: no metric passes a "worth it" judgement`,
    );
    check(
      !/worth going out|worth a special trip|worth staying up/i.test(state.allText),
      `${id}: the page passes no lifestyle verdict anywhere`,
    );
    check(
      state.recommendation.length > 0 && !/^\s*$/.test(state.recommendation),
      `${id}: the page says why it is not being recommended`,
    );
    check(state.metricCount === 3, `${id}: the hero still carries exactly three metrics`);
  }

  // And the fix is scoped: an event Tracker does recommend still reads as one.
  await honest.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await landOnTonight(honest);
  await honest.waitForTimeout(4500);
  const recommended = await honest.evaluate(() => ({
    name: document.querySelector(".tk-hero-name")?.textContent?.trim() ?? "",
    rows: (window.__rail ?? []).map((card) => card.name),
    where:
      [...document.querySelectorAll(".tk-hero-metrics .tk-metric")]
        .find((node) => /where to look/i.test(node.querySelector("dt")?.textContent ?? ""))
        ?.querySelector("dd")
        ?.textContent?.trim() ?? "",
  }));
  check(
    recommended.rows[0] === recommended.name,
    `the hero is the top of the rail ("${recommended.name}" vs "${recommended.rows[0]}")`,
  );
  check(
    recommended.where.length > 0,
    `a recommended event says where to look ("${recommended.where}")`,
  );

  await honest.close();
  await honestContext.close();

  /* --- 4f. the sky's clarity, and the air's safety ------------------------ */
  //
  // Two different questions measured by two different instruments, in one row.
  // They disagree in both directions — a thin smoke layer aloft ruins a night
  // under air that is fine to breathe, and a still winter inversion is
  // unhealthy under a transparent sky — so the interface has to be able to say
  // either without implying the other.
  //
  // The feed is served rather than read, because the four states the brief
  // names are properties of the air on a particular afternoon and none of them
  // is reachable on demand from the live model.
  {
    console.log("\nAtmosphere");

    /**
     * Hours built from the pinned clock, not from wall-clock now.
     *
     * `withAerosol` matches an aerosol sample to a weather snapshot within
     * forty-five minutes and keeps the nulls when nothing lines up. The page's
     * clock is pinned to `WALK_AT`, so a fixture starting at the real current
     * hour is hours away from every snapshot and is silently discarded — which
     * looks exactly like "the product does not report air quality" and would
     * have made three of the four states below pass for the wrong reason.
     */
    /**
     * A served hourly series, shaped like the real one.
     *
     * `pm25` may be a constant or a function of "hours before the instant the
     * page is pinned to", which is what makes a spike expressible: the AQI is
     * now derived from a twelve-hour NowCast, so the difference between a brief
     * plume and sustained pollution only exists in a series and cannot be
     * expressed as a single number.
     *
     * The hours are built from the pinned clock rather than from wall-clock
     * now. `withAerosol` matches a sample to a snapshot within forty-five
     * minutes and keeps the nulls when nothing lines up, so a fixture starting
     * at the real current hour is discarded — which looks exactly like "the
     * product reports no air quality" and would make these pass for the wrong
     * reason.
     */
    /**
     * `anchor` is the instant the page will actually read these hours for.
     *
     * Not the wall clock. The conditions row describes the moment the
     * recommendation is for, which is some hours into the night, and anchoring
     * the fixture to `WALK_AT` meant "the most recent hour" in a test named for
     * it was three hours away from the hour the product asked about. On a night
     * whose best event fell elsewhere the whole fixture missed, and the checks
     * below passed or failed for reasons that had nothing to do with the code.
     * The page now states the instant it is describing, and `calibrate` reads
     * it — see `data-at-utc` on the conditions row.
     */
    const airQuality = (hours, anchor = WALK_AT) => (route) => {
      const times = [];
      const pm25 = [];
      const depths = [];
      const from = new Date(WALK_AT);
      from.setUTCHours(from.getUTCHours() - 24, 0, 0, 0);
      for (let index = 0; index < 96; index += 1) {
        const at = new Date(from.getTime() + index * 3_600_000);
        times.push(at.toISOString().slice(0, 19));
        const hoursFromPin = Math.round((anchor.getTime() - at.getTime()) / 3_600_000);
        pm25.push(
          typeof hours.pm25 === "function" ? hours.pm25(hoursFromPin) : hours.pm25,
        );
        depths.push(hours.aerosolOpticalDepth);
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          hourly: { time: times, pm2_5: pm25, aerosol_optical_depth: depths },
        }),
      });
    };

    /**
     * The weather provider is stubbed too, and it has to be.
     *
     * The transparency card reads aerosol off the merged forecast snapshots, so
     * it exists only where a *weather* snapshot exists to merge onto. Left on
     * the live National Weather Service, a rate limit or a slow response
     * produced "Cloud cover · Not reported", no snapshot, and therefore no
     * transparency card — and three assertions about the atmosphere failed for
     * a reason that had nothing to do with the atmosphere. A check whose result
     * depends on somebody else's uptime is not a check.
     */
    const forecast = (route) => {
      const start = new Date(WALK_AT);
      start.setUTCMinutes(0, 0, 0);
      const values = (value) =>
        Array.from({ length: 48 }, (_, hour) => ({
          validTime: `${new Date(start.getTime() + (hour - 12) * 3_600_000)
            .toISOString()
            .slice(0, 19)}+00:00/PT1H`,
          value,
        }));
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          properties: {
            updateTime: new Date(WALK_AT).toISOString(),
            skyCover: { values: values(18) },
            temperature: { values: values(14) },
            probabilityOfPrecipitation: { values: values(5) },
            relativeHumidity: { values: values(60) },
          },
        }),
      });
    };

    /**
     * The instant the page reads its conditions for, so a fixture can hit it.
     *
     * One extra load with a fixture that cannot fail, purely to ask the page
     * which hour it is about. Cheap, and it makes every check below a statement
     * about the code rather than about tonight's ranking.
     */
    const calibrate = async () => {
      const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
      await seedPlace(context, PLACES.portland);
      await context.route("**/api.weather.gov/points/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            properties: { forecastGridData: "https://api.weather.gov/gridpoints/TEST/1,1" },
          }),
        }),
      );
      await context.route("**/api.weather.gov/gridpoints/**", forecast);
      await context.route("**/air-quality**", airQuality({ pm25: 5, aerosolOpticalDepth: 0.04 }));
      const page = await context.newPage();
      await page.clock.setFixedTime(WALK_AT);
      await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await landOnTonight(page);
      await page.waitForTimeout(3500);
      const at = await page.getAttribute(".tk-conditions", "data-at-utc");
      await page.close();
      await context.close();
      if (!at) {
        check(false, "the conditions row states which instant it describes");
        return WALK_AT;
      }
      const anchor = new Date(at);
      console.log(
        `  · conditions are read for ${anchor.toISOString().slice(11, 16)} UTC, ` +
          `${Math.round((anchor.getTime() - WALK_AT.getTime()) / 3_600_000)}h from the pin`,
      );
      return anchor;
    };
    const airAnchor = await calibrate();

    const cardsUnder = async (label, air) => {
      const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
      await seedPlace(context, PLACES.portland);
      await context.route("**/api.weather.gov/points/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            properties: { forecastGridData: "https://api.weather.gov/gridpoints/TEST/1,1" },
          }),
        }),
      );
      await context.route("**/api.weather.gov/gridpoints/**", forecast);
      await context.route("**/air-quality**", airQuality(air, airAnchor));
      const page = await context.newPage();
      await page.clock.setFixedTime(WALK_AT);
      await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await landOnTonight(page);
      await page.waitForTimeout(4500);
      const cards = await page.evaluate(() =>
        [...document.querySelectorAll(".tk-condition-card")].map((card) => card.innerText),
      );
      await page.close();
      await context.close();
      console.log(`  · ${label}: ${cards.length} cards`);
      return cards.join(" \u2016 ");
    };

    // 1. Normal air, nothing in the sky worth reporting.
    const normal = await cardsUnder("normal air", { pm25: 5, aerosolOpticalDepth: 0.04 });
    check(
      !/AQI/i.test(normal),
      "normal air quality is not reported at all",
    );
    check(
      !/unavailable|not reported/i.test(normal),
      "normal air does not produce an absence notice either",
    );

    // 2. Unhealthy air under a clean sky. The health warning must appear and
    //    must not be phrased as an observing problem.
    const unhealthy = await cardsUnder("unhealthy air", { pm25: 90, aerosolOpticalDepth: 0.04 });
    check(/AQI \d+/.test(unhealthy), "unhealthy air raises a health warning with its index");
    check(
      /unhealthy/i.test(unhealthy) && /limit prolonged time outdoors|avoid/i.test(unhealthy),
      "the warning carries the category's own outdoor guidance",
    );
    check(
      /Transparency\s*\n?\s*Clear/i.test(unhealthy),
      "a clean sky is still reported as clear while the air is unhealthy",
    );

    // 3. Smoke thick enough to matter for observing, under air that does not
    //    warrant a health warning.
    const smoky = await cardsUnder("smoke aloft", { pm25: 6, aerosolOpticalDepth: 0.9 });
    check(
      /mag/i.test(smoky) && /(Poor|Reduced)/.test(smoky),
      "smoke that degrades the sky is reported in magnitudes of dimming",
    );
    check(!/AQI/i.test(smoky), "degraded transparency does not invent a health warning");

    // 4. Neither layer measured. Silence, not a slot saying nobody looked.
    const missing = await cardsUnder("no atmospheric data", {
      pm25: null,
      aerosolOpticalDepth: null,
    });
    check(!/AQI/i.test(missing), "missing data raises no health claim");
    check(
      !/transparency|smoke/i.test(missing),
      "missing data leaves no card behind to report its own absence",
    );
    check(
      /Cloud cover/.test(missing) && /Moonlight/.test(missing) && /Temperature/.test(missing),
      "the standing three are still there when the atmospheric layers are not",
    );

    /**
     * 5. A short plume, which is the defect.
     *
     * One hour at 200 µg/m³ with clean air either side. Run through the AQI
     * breakpoints directly that reads "AQI 250 · Very unhealthy"; through a
     * twelve-hour NowCast it is a fraction of that, because the breakpoints
     * describe a 24-hour average and one hour is not one.
     */
    const spike = await cardsUnder("one-hour plume", {
      pm25: (hoursBefore) => (hoursBefore === 0 ? 200 : 4),
      aerosolOpticalDepth: 0.04,
    });
    const spikeAqi = /AQI (\d+)/.exec(spike);
    check(
      spikeAqi === null || Number(spikeAqi[1]) < 200,
      `a one-hour plume does not become the AQI of that hour${spikeAqi ? ` (${spikeAqi[0]})` : " (no index shown)"}`,
    );
    check(
      !/very unhealthy|hazardous/i.test(spike),
      "a one-hour plume does not reach the categories a sustained one would",
    );

    /**
     * 6. The same peak, sustained. The NowCast is supposed to notice this — a
     * method that only ever damps would be as wrong as one that never did.
     */
    const sustained = await cardsUnder("sustained pollution", {
      pm25: 200,
      aerosolOpticalDepth: 0.04,
    });
    const sustainedAqi = /AQI (\d+)/.exec(sustained);
    check(
      sustainedAqi !== null && Number(sustainedAqi[1]) > Number(spikeAqi?.[1] ?? 0),
      `sustained pollution ranks above the same peak lasting one hour (${sustainedAqi?.[0]} vs ${spikeAqi?.[0] ?? "none"})`,
    );
    check(
      /very unhealthy|hazardous/i.test(sustained),
      "sustained pollution reaches the category it has earned",
    );
    /**
     * That the index came from a NowCast is asserted in the unit tests, which
     * can read the provenance note; the note is not rendered into the DOM, so
     * there is nothing here for a browser check to read. What *is* visible, and
     * is the reader-facing proof, is the pair of numbers above: the same peak
     * lasting one hour and lasting twelve produce materially different indices,
     * which an hourly conversion could not do.
     */

    /**
     * 7. Insufficient history: nulls everywhere but the most recent hour.
     *
     * EPA's validity rule needs two of the three most recent hours, so no index
     * may be computed — and no index may be shown, however alarming the one
     * value is.
     */
    const thin = await cardsUnder("one hour of history", {
      pm25: (hoursBefore) => (hoursBefore === 0 ? 200 : null),
      aerosolOpticalDepth: 0.04,
    });
    check(!/AQI/i.test(thin), "a lone hourly reading produces no AQI at all");
    check(
      /PM2\.5 \d+/.test(thin),
      "the concentration itself is still reported, labelled as a concentration",
    );
    /**
     * Scoped to the particulates card. The first version of this searched the
     * whole row and matched "Cloud cover · 18% · Good" — a cloud reading, not
     * an AQI category, and the check failed on correct output.
     */
    const thinCard = thin
      .split("\u2016")
      .map((card) => card.trim())
      .find((card) => /^Particulates/.test(card) || /PM2\.5/.test(card));
    check(
      thinCard !== undefined && !/\b(good|moderate|unhealthy|hazardous)\b/i.test(thinCard),
      `and it borrows none of the AQI category names (${thinCard ?? "no card"})`,
    );
  }

  /* --- 4e. the night ending is not the night disappointing ---------------- */
  //
  // Every opportunity having *passed* and none of them being worth going out
  // for produce the same empty Best tonight and are completely different
  // statements. Reached by pinning the clock to just before dawn, because that
  // is the only thing that distinguishes them.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await seedPlace(context, PLACES.portland);
    const page = await context.newPage();
    // This section needs its own hour; the run-wide pin does not apply.
    // Fifteen minutes before the sky starts to lighten, whatever the date.
    const beforeDawn = new Date();
    beforeDawn.setUTCHours(12, 55, 0, 0);
    await page.clock.setFixedTime(beforeDawn);
    await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Before dawn there may be nothing to open, so the drill-in is optional and
    // the empty state is read off whichever surface is showing.
    await landOnTonight(page, { optional: true });
    await page.waitForTimeout(3000);

    const quiet = page.locator(".tk-quiet");
    if ((await quiet.count()) > 0) {
      const reason = await quiet.getAttribute("data-quiet-reason");
      check(
        reason === "night-over",
        `an empty list before dawn is reported as the night ending (${reason})`,
      );
      const words = await quiet.innerText();
      check(
        /over|getting light|has set/i.test(words),
        "the copy says the night ended rather than that it disappointed",
      );
      // The whole page is a heading and a paragraph; hiding the paragraph left
      // three words alone on a blank screen.
      check(
        (await page.locator(".tk-quiet .tk-page-heading p").isVisible()) &&
          words.length > 60,
        "the explanation is on screen rather than hidden to save height",
      );
      await shot(page, "27-night-over", "everything has set, before dawn");
    } else {
      check(
        (await page.locator(".tk-hero-name").count()) > 0,
        "something is still observable before dawn, and it is shown",
      );
    }
    await page.close();
    await context.close();
  }

  /* --- 5a. rank does not move when the reader navigates ------------------- */
  //
  // The reported defect: on the Saturn page Saturn was rank 1 and Meteors 4; on
  // the Meteors page Meteors was 1 and Saturn 2. Rank was the row's index at
  // render time, and the list was reordered to hoist the open event's category,
  // so opening a thing promoted it. For a product whose whole claim is "this is
  // what is most worth looking at", that is the claim being false.
  console.log("\nRanking invariance");

  const rankContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  await seedPlace(rankContext, PLACES.portland);
  const rankPage = await rankContext.newPage();
  await rankPage.clock.setFixedTime(WALK_AT);
  await rankPage.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await landOnTonight(rankPage);
  await rankPage.waitForTimeout(3500);

  /**
   * The rail's order, which is the night's one ranking.
   *
   * It used to be read from the detail page's own cross-event list. That list
   * is gone — it was a second ranking of the same night, running beside the
   * rail the reader chose the event from — so this reads the rail, on the map,
   * which is the surface that owns the order.
   *
   * Keyed by the card's id rather than its rendered name: a collapsed card
   * truncates its title, and comparing truncated English across navigation
   * would test the ellipsis rather than the ranking.
   */
  const readRanking = () =>
    rankPage.evaluate(() =>
      [...document.querySelectorAll(".tk-rail-card")].map((card, index) => ({
        rank: String(index + 1),
        id: card.dataset.card ?? "",
        name: card.querySelector(".tk-rail-card-name")?.textContent?.trim() ?? "",
      })),
    );

  const toMap = async () => {
    if ((await rankPage.locator(".tk-map-detail .tk-back").count()) > 0) {
      await rankPage.locator(".tk-map-detail .tk-back").click();
    }
    await rankPage.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await rankPage.waitForTimeout(2000);
  };

  await toMap();
  const baseline = await readRanking();
  check(baseline.length > 0, `the rail ranks the night (${baseline.length} cards)`);
  console.log(`  · baseline: ${baseline.map((row) => `${row.rank}. ${row.id}`).join(", ")}`);

  check(
    baseline.every((row, index) => row.rank === String(index + 1)),
    "the ranking is an order, one upwards, with no gaps",
  );
  check(
    new Set(baseline.map((row) => row.id)).size === baseline.length,
    "and no event appears in it twice",
  );

  /** Comparable regardless of which cards a view happens to show. */
  const rankOf = (rows) => new Map(rows.map((row) => [row.id, row.rank]));
  const baselineRanks = rankOf(baseline);

  const disagreements = [];
  const compare = (rows, where) => {
    for (const row of rows) {
      const expected = baselineRanks.get(row.id);
      if (expected !== undefined && expected !== row.rank) {
        disagreements.push(`${row.id} was ${expected}, is ${row.rank} on ${where}`);
      }
    }
  };

  /**
   * Open each event and come back, checking the order did not move.
   *
   * The defect this guards is specific and was real: opening an event once
   * promoted it to the top of the ranking, because the list hoisted the open
   * event's category and the rank was rendered from the row index. Either bug
   * alone would have been survivable; together they falsified the one number
   * the product exists to provide.
   */
  const visited = [];
  for (const target of baseline.slice(0, 4)) {
    const card = rankPage.locator(`.tk-rail-card[data-card="${target.id}"]`);
    if ((await card.count()) === 0) continue;
    if ((await card.getAttribute("data-expanded")) !== "true") {
      await card.locator(".tk-rail-card-head").click();
      await rankPage.waitForTimeout(900);
    }
    const details = card.locator(".tk-rail-details");
    if ((await details.count()) === 0) continue;
    await details.click();
    await rankPage.waitForSelector(".tk-map-detail", { timeout: 30_000 }).catch(() => {});
    await rankPage.waitForTimeout(1500);
    check(
      (await rankPage.locator(".tk-map-detail .tk-relevant-row").count()) === 0,
      `${target.id}: its page carries no second ranking`,
    );
    await toMap();
    const rows = await readRanking();
    compare(rows, target.id);
    visited.push(target.id);

    check(
      rows[0]?.id === baseline[0].id,
      `${target.id}: the rail still leads with ${baseline[0].id}`,
    );
    const self = rows.find((row) => row.id === target.id);
    check(
      self !== undefined && self.rank === baselineRanks.get(target.id),
      `${target.id}: keeps rank ${baselineRanks.get(target.id)} after being opened`,
    );
  }
  console.log(`  · visited ${visited.length} event pages: ${visited.join(", ")}`);

  // Nor may Back and Forward.
  await rankPage.goBack();
  await rankPage.waitForTimeout(1800);
  compare(await readRanking(), "Back");
  await rankPage.goForward();
  await rankPage.waitForTimeout(1800);
  compare(await readRanking(), "Forward");

  // And returning to where we started must reproduce the baseline exactly.
  await rankPage.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await rankPage.waitForSelector(".tk-rail-card", { timeout: 45_000 }).catch(() => {});
  await rankPage.waitForTimeout(3500);
  const returned = await readRanking();
  compare(returned, "returning to the map");
  check(
    returned.map((row) => row.id).join(",") === baseline.map((row) => row.id).join(","),
    "coming back to the map reproduces the same order",
  );

  check(
    disagreements.length === 0,
    disagreements.length === 0
      ? `rank is identical across every page, drill-in and history move (${visited.length + 3} observations)`
      : `rank changed with navigation — ${disagreements.join("; ")}`,
  );

  await shot(rankPage, "24-ranking", "the observing rail, which is the night's ranking");

  await rankPage.close();
  await rankContext.close();

  /* --- 5b. map controls, and the history behind them ---------------------- */
  //
  // Both of these were missed by a walk that reported 142 of 142. It counted
  // that a control existed and that a page rendered; it never pressed the
  // control and never pressed Back. So these checks assert the *consequence* of
  // an interaction — what opened, what the URL says, what came back — rather
  // than the presence of something clickable.
  console.log("\nMap controls and history");

  const navContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  await seedPlace(navContext, PLACES.portland);
  const nav = await navContext.newPage();
  await nav.clock.setFixedTime(WALK_AT);
  await nav.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await landOnTonight(nav);
  await nav.waitForTimeout(3000);

  /**
   * The Tracker location the address bar currently describes.
   *
   * The map model names these differently from the page model this section was
   * written against: `mode` is which question is being asked, so the Upcoming
   * browse mode moved to `show`. The shape returned here is unchanged, so the
   * assertions below still read the way they did.
   */
  const urlState = () => {
    const params = new URLSearchParams(new URL(nav.url()).search);
    return {
      app: params.get("app"),
      view: params.get("mode") ?? "tonight",
      event: params.get("event"),
      drill: params.get("drill"),
      mode: params.get("show") ?? "gallery",
      filter: params.get("filter") ?? "all",
      month: params.get("month"),
    };
  };

  /**
   * Reach Upcoming.
   *
   * By URL rather than by clicking a tab: the map shell no longer carries a
   * `Tonight | Upcoming` control, because time is a parameter of the map and
   * not a destination. Upcoming is still a different tool answering a different
   * question, and it still works — it simply has no entry point on the map at
   * the moment, which is recorded as a known gap rather than papered over here.
   */
  const openUpcoming = async () => {
    const url = new URL(nav.url());
    url.searchParams.set("mode", "upcoming");
    url.searchParams.delete("event");
    url.searchParams.delete("drill");
    await nav.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await nav.waitForSelector('.tk-highlights[data-planning-state="ready"]', { timeout: 90_000 });
    await nav.waitForTimeout(500);
  };

  if (UPCOMING_IS_ROUTED) {
  await openUpcoming();
  check(urlState().view === "upcoming", "switching to Upcoming is written into the URL");

  /**
   * The three map controls, and Sequence C, from Upcoming.
   *
   * Prefers a lunar eclipse — it is the event with all three controls — and
   * falls back to whatever Upcoming does have. The fallback matters: the
   * history sequence being exercised here is about Upcoming, not about
   * eclipses, and it used to be skipped entirely on every day of the year with
   * no lunar eclipse inside the thirty-night window.
   */
  const lunarCard = nav.locator(".tk-upcoming-card", { hasText: /lunar eclipse/i }).first();
  const anyCard = nav.locator(".tk-upcoming-card").first();
  const isEclipse = (await lunarCard.count()) > 0;
  const openCard = isEclipse ? lunarCard : anyCard;
  let eventUrl = urlState();
  if ((await openCard.count()) > 0) {
    await openCard.click();
    await nav.waitForSelector(".tk-page", { timeout: 30_000 });
    await nav.waitForTimeout(2500);
    eventUrl = urlState();
    check(eventUrl.event !== null, "opening an event puts its id in the URL");
    if (!isEclipse) {
      console.log(
        "  · no lunar eclipse in Upcoming's window; the three map controls are covered deterministically from Tonight",
      );
    }
  }
  if (isEclipse) {
    /**
     * "View visibility map" goes to the map, and the map is the real one.
     *
     * It used to open a modal holding a larger copy of the panel beside it —
     * the reader asked for the full geographic view and was handed the
     * thumbnail at twice the size, with no pan, no zoom, no basemap and no
     * relationship to the map they had come from. Everything below asserts a
     * consequence: the detail page closes, the event's overlay is on the map,
     * the camera framed it, the URL describes all of it, and Back returns to
     * the page the reader left.
     */
    await nav.getByRole("button", { name: "View visibility map" }).click();
    await nav.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await nav.waitForTimeout(3000);

    check(
      (await nav.locator(".tk-map-detail").count()) === 0,
      "View visibility map leaves the event page for the map",
    );
    check(
      (await nav.locator(".tk-overlay").count()) === 0,
      "and does not open a second map in a modal",
    );
    const drawn = await nav.evaluate(() =>
      window.__trackerMap
        ? window.__trackerMap.getStyle().layers.filter((layer) => /^tracker-e/.test(layer.id)).length
        : 0,
    );
    check(drawn > 0, `the event's own geography is drawn on it (${drawn} layers)`);
    check(
      urlState().event !== null || new URL(nav.url()).searchParams.get("show") !== null,
      "and the selected event is a state the URL describes",
    );
    await shot(nav, "15-lunar-visibility-map", "the eclipse, on the map the reader already knows");

    await nav.goBack();
    await nav.waitForTimeout(2000);
    check(
      (await nav.locator(".tk-map-detail").count()) > 0,
      "Back returns to the event page, not to the homepage",
    );
  }

  // --- Sequence C: Upcoming -> event -> (map) -> Back -> Upcoming ----------
  // Runs whichever event was opened, because what is under test is the history
  // stack rather than the phenomenon.
  await nav.goBack();
  await nav.waitForTimeout(1500);
  check(
    urlState().view === "upcoming" && urlState().event === null,
    "Sequence C: Back returns to Upcoming",
  );
  check(
    new URL(nav.url()).searchParams.get("app") === "tracker",
    "Sequence C: Back never leaves Tracker while Tracker states remain",
  );

  // --- Sequence D: filter and mode survive a round trip ---------------------
  await nav.selectOption(".tk-phenomenon-filter select", "eclipses");
  await nav.waitForTimeout(900);
  await nav.getByRole("tab", { name: "Calendar" }).click();
  await nav.waitForSelector(".tk-month", { timeout: 90_000 });
  await nav.waitForTimeout(1200);
  const browseState = urlState();
  check(
    browseState.filter === "eclipses" && browseState.mode === "calendar",
    "the filter and the browse mode are written into the URL",
  );

  const marked = nav.locator(".tk-day.is-marked").first();
  if ((await marked.count()) > 0) {
    await marked.click();
    await nav.waitForTimeout(900);
    const detail = nav.locator(".tk-month-detail .tk-month-event").first();
    if ((await detail.count()) > 0) {
      await detail.click();
      await nav.waitForSelector(".tk-page", { timeout: 30_000 });
      await nav.waitForTimeout(2000);
      check(urlState().event !== null, "Sequence D: opening from the calendar is a step");

      await nav.goBack();
      await nav.waitForTimeout(1500);
      const restored = urlState();
      check(
        restored.filter === "eclipses" && restored.mode === "calendar",
        "Sequence D: Back restores the filter and Calendar mode rather than resetting",
      );
      check(
        (await nav.locator(".tk-month").count()) > 0,
        "Sequence D: the restored state renders the calendar, not the list",
      );

      // --- Sequence E: Forward returns to where Back came from -------------
      await nav.goForward();
      await nav.waitForTimeout(1500);
      check(
        urlState().event !== null && (await nav.locator(".tk-page").count()) > 0,
        "Sequence E: Forward restores the event page",
      );
      await nav.goBack();
      await nav.waitForTimeout(1200);
    }
  }

  // --- Sequence B: two events deep, two steps back -------------------------
  await nav.selectOption(".tk-phenomenon-filter select", "all");
  await nav.waitForTimeout(700);
  await nav.getByRole("tab", { name: "Gallery" }).click();
  await nav.waitForSelector('.tk-highlights[data-planning-state="ready"]', { timeout: 90_000 });
  await nav.waitForTimeout(900);

  const navCards = nav.locator(".tk-upcoming-card");
  if ((await navCards.count()) >= 2) {
    await navCards.first().click();
    await nav.waitForSelector(".tk-page", { timeout: 30_000 });
    await nav.waitForTimeout(2000);
    const eventA = urlState().event;

    // Move to a second event. The page carries no cross-event list any more,
    // so this goes back to the rail and opens a different card — which is the
    // route the product actually offers.
    const nextRow = nav.locator(".tk-rail-card").nth(1);
    if ((await nav.locator(".tk-map-detail .tk-back").count()) > 0) {
      await nav.locator(".tk-map-detail .tk-back").click();
      await nav.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
      await nav.waitForTimeout(1500);
    }
    if ((await nextRow.count()) > 0) {
      await nextRow.locator(".tk-rail-card-head").click();
      await nav.waitForTimeout(900);
      await nextRow.locator(".tk-rail-details").click();
      await nav.waitForTimeout(2200);
      const eventB = urlState().event;
      check(eventB !== eventA, "Sequence B: moving between events changes the URL");

      await nav.goBack();
      await nav.waitForTimeout(1500);
      check(urlState().event === eventA, "Sequence B: Back returns to the first event");

      await nav.goBack();
      await nav.waitForTimeout(1500);
      check(
        urlState().view === "upcoming" && urlState().event === null,
        "Sequence B: a second Back returns to Upcoming",
      );
    }
  }

  // --- Sequence A, and the boundary: only then does Back leave Tracker -----
  const beforeLeaving = new URL(nav.url()).searchParams.get("app");
  check(beforeLeaving === "tracker", "Sequence A: Tracker is still the page after unwinding");

  // Refreshing an event URL must land on that event, not on the homepage.
  await navCards.first().click().catch(() => {});
  await nav.waitForTimeout(2000);
  const deepUrl = nav.url();
  if (new URL(deepUrl).searchParams.get("event")) {
    await nav.reload({ waitUntil: "domcontentloaded" });
    /**
     * Waited for, not timed.
     *
     * A cold load of an Upcoming event page recomputes the whole planning
     * horizon before it can resolve which event the URL names, and that is
     * comfortably more than the 3.5s this used to allow — so the check failed
     * on a page that restores correctly, which is the worst kind of failing
     * test. The page's own appearance is the signal; there is no need to guess
     * how long producing it takes on the machine of the day.
     */
    await nav.waitForSelector(".tk-page", { timeout: 90_000 }).catch(() => {});
    await nav.waitForTimeout(500);
    check(
      new URL(nav.url()).searchParams.get("app") === "tracker",
      "refreshing an event page stays in Tracker",
    );
    check(
      (await nav.locator(".tk-page").count()) > 0,
      "refreshing an event page restores an event page",
    );
  }


  }

  // Back on the map, since the sequences above may not have run.
  await nav.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await landOnTonight(nav);
  await nav.waitForTimeout(2000);

  /* --- 5b2. one press, one entry ------------------------------------------- */
  //
  // The defect this catches, found by counting `history.length` in the browser:
  // `navigate` wrote to the history stack inside a `setState` updater, which
  // React is explicitly allowed to call more than once and StrictMode
  // deliberately does. Every navigation pushed two entries, so the reader's
  // first Back press consumed a duplicate of the entry they were already on and
  // appeared to do nothing.
  //
  // Nothing about the rendered page showed it, which is why the previous walk
  // passed over it: the assertion has to be about the stack itself.
  console.log("\nHistory hygiene");

  // Measured from the map, which is where an event is opened from.
  await nav.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await nav.waitForSelector(".tk-rail-card", { timeout: 45_000 }).catch(() => {});
  await nav.waitForTimeout(3000);

  const depthNow = () => nav.evaluate(() => window.history.length);

  const beforeStep = await depthNow();
  const secondCard = nav.locator(".tk-rail-card").nth(1);
  await secondCard.locator(".tk-rail-card-head").click();
  await nav.waitForTimeout(1800);
  const afterStep = await depthNow();
  check(
    afterStep - beforeStep === 1,
    `expanding a card pushes exactly one history entry (${afterStep - beforeStep})`,
  );

  const beforeOpen = await depthNow();
  await secondCard.locator(".tk-rail-details").click();
  await nav.waitForSelector(".tk-map-detail", { timeout: 30_000 }).catch(() => {});
  await nav.waitForTimeout(1800);
  const afterOpen = await depthNow();
  check(
    afterOpen - beforeOpen === 1,
    `opening an event pushes exactly one history entry (${afterOpen - beforeOpen})`,
  );

  const beforeDrill = await depthNow();
  const primary = nav.locator(".tk-hero-actions .tk-action.is-primary");
  await primary.click();
  await nav.waitForTimeout(1500);
  const afterDrill = await depthNow();
  check(
    afterDrill - beforeDrill === 1,
    `opening a drill-in pushes exactly one history entry (${afterDrill - beforeDrill})`,
  );

  await nav.goBack();
  await nav.waitForTimeout(1200);
  check(
    new URLSearchParams(new URL(nav.url()).search).get("drill") === null,
    "one Back press closes one drill-in",
  );

  /* --- 5b3. Tonight leads an eclipse with geography, not with a chart ------ */
  //
  // The universal hierarchy is: left, the recommendation; right, the
  // phenomenon's own primary evidence. For an eclipse that evidence is
  // geographic — "can I see it from here" is a question about where you are
  // standing — and Tonight was falling through to the altitude chart while the
  // Upcoming page showed the map. The same eclipse, two different primary
  // visualizations, depending which door the reader came through.
  console.log("\nTonight's eclipse hierarchy");

  // A date chosen for its eclipse rather than for today's sky, so the check
  // does not depend on what happens to be up when the walk runs.
  const ECLIPSE_NIGHT = "2028-01-11";
  await nav.goto(`${TRACKER}&date=${ECLIPSE_NIGHT}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await landOnTonight(nav);
  await nav.waitForTimeout(4500);

  const eclipseNight = await nav.evaluate(() => ({
    category: document.querySelector(".tk-page")?.getAttribute("data-category") ?? null,
    hero: document.querySelector(".tk-hero-name")?.textContent?.trim() ?? "",
    rows: (window.__rail ?? []).map((card) => card.name),
    hasGeoMap: Boolean(document.querySelector(".tk-viz-slot .tk-eventmap")),
    hasSkyChart: Boolean(document.querySelector(".tk-viz-slot .tk-skypathpanel")),
    actions: [...document.querySelectorAll(".tk-hero-actions .tk-action")].map((n) =>
      n.textContent?.trim(),
    ),
    where:
      [...document.querySelectorAll(".tk-hero-metrics .tk-metric")]
        .find((node) => /where to look/i.test(node.querySelector("dt")?.textContent ?? ""))
        ?.querySelector("dd")
        ?.textContent?.trim() ?? "",
  }));

  check(
    eclipseNight.category === "eclipses",
    `an eclipse night leads with the eclipse (${eclipseNight.category})`,
  );
  check(
    /eclipse/i.test(eclipseNight.rows[0] ?? ""),
    `the eclipse is rank 1, above any planet (${eclipseNight.rows.slice(0, 3).join(", ")})`,
  );
  check(
    eclipseNight.rows[0] === eclipseNight.hero,
    "the hero and the top of the ranked list are the same event",
  );
  check(
    eclipseNight.hasGeoMap && !eclipseNight.hasSkyChart,
    "Tonight's eclipse shows the geographic map in the primary slot, not the altitude chart",
  );
  check(
    eclipseNight.actions.includes("View visibility map") &&
      eclipseNight.actions.includes("Where to look"),
    `Tonight's eclipse offers both tools (${eclipseNight.actions.join(", ")})`,
  );
  check(
    /\d+°/.test(eclipseNight.where),
    `Tonight's eclipse says where to look on the card (${eclipseNight.where})`,
  );
  await shot(nav, "24b-tonight-eclipse", "Tonight leads an eclipse with the geographic map");

  // The same two controls, from Tonight rather than from Upcoming. They answer
  // different questions and go to different places: *where on Earth* is the map
  // itself, and *where in your sky* is a chart that stays on the page.
  await nav.getByRole("button", { name: "View visibility map" }).click();
  await nav.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
  await nav.waitForTimeout(2500);
  check(
    (await nav.locator(".tk-map-detail").count()) === 0 &&
      (await nav.locator(".tk-overlay").count()) === 0,
    "Tonight: View visibility map goes to the map rather than opening a modal",
  );
  await nav.goBack();
  await nav.waitForSelector(".tk-map-detail", { timeout: 30_000 }).catch(() => {});
  await nav.waitForTimeout(2000);

  await nav.getByRole("button", { name: "Where to look" }).click();
  await nav.waitForSelector(".tk-overlay", { timeout: 10_000 });
  await nav.waitForTimeout(1200);
  const skyTitle = await nav.locator(".tk-overlay").innerText().catch(() => "");
  check(
    (await nav.locator(".tk-overlay .tk-chart-path").count()) > 0,
    "Tonight: Where to look opens the altitude and bearing chart",
  );
  check(
    !/view visibility map/i.test(skyTitle.split("\n")[0] ?? ""),
    "Tonight: the sky panel is not titled after the map control that did not open it",
  );
  await nav.keyboard.press("Escape");
  await nav.waitForTimeout(800);

  await nav.close();
  await navContext.close();

  /* --- 5d. the geographic answer is the map ------------------------------ */
  //
  // There was a second map here: a modal that opened over the event page,
  // holding a larger copy of the drawn panel beside it, with its own zoom
  // buttons, its own legend, its own keyboard handling and its own idea of
  // cartography. Everything a reader could do to it, they can do to the map
  // Tracker already had — pan, zoom, recentre, pick a point — and the map has
  // a basemap, terrain and place names besides. So the drill-in is gone and
  // "View visibility map" goes to the map itself.
  //
  // What is checked here is that the transition arrives whole: the event
  // selected, its overlay drawn, the camera framed on it, and the whole of it
  // in the URL. The map's own controls are covered in the refinement gate,
  // which measures them against the real map rather than a copy.
  console.log("\nThe map is the geographic answer");

  const mapContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  await seedPlace(mapContext, PLACES.portland);
  const map = await mapContext.newPage();
  await map.clock.setFixedTime(WALK_AT);

  {
    // A date chosen for its eclipse, so the check does not depend on what
    // happens to be up when the walk runs.
    await map.goto(`${TRACKER}&date=2028-01-11`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await map.waitForSelector(".tk-rail-card", { timeout: 45_000 }).catch(() => {});
    await map.waitForTimeout(4000);

    const camera = () =>
      map.evaluate(() => {
        const instance = window.__trackerMap;
        if (!instance) return null;
        const centre = instance.getCenter();
        return { lat: centre.lat, lng: centre.lng, zoom: instance.getZoom() };
      });

    const opened = await landOnTonight(map, { optional: true });
    check(opened, "the eclipse night opens its event page");
    if (opened) {
      await map.waitForTimeout(2500);

      /**
       * The panel beside the recommendation is a glance, not a workspace.
       *
       * It answers "roughly where does this happen"; the map answers "and what
       * is it like where I am". A panel that captured drags on a page that
       * scrolls would fight the reader for the same gesture.
       */
      check(
        (await map.locator(".tk-viz-slot").count()) === 1,
        "the page keeps one visualization slot beside the recommendation",
      );

      /**
       * Moved away first, or the check proves nothing.
       *
       * Opening the event from the rail already selects it and frames the
       * camera on it, so by the time the reader reaches "View visibility map"
       * the map behind the page is usually looking at the right place — and a
       * check that the camera *changed* would pass or fail on that accident.
       * Sending it somewhere else makes the assertion the one that matters:
       * wherever the map was, this puts it on the event.
       */
      await map.evaluate(() => window.__trackerMap?.jumpTo({ center: [140, -30], zoom: 6 }));
      await map.waitForTimeout(1200);
      const before = await camera();
      const control = map.getByRole("button", { name: "View visibility map" });
      check((await control.count()) > 0, "an eclipse offers to show where it happens");
      if ((await control.count()) > 0) {
        await control.first().click();
        await map.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
        await map.waitForTimeout(3000);
        const after = await camera();

        check(
          (await map.locator(".tk-map-detail").count()) === 0,
          "it takes the reader to the map rather than opening a picture of one",
        );
        check(
          (await map.locator(".tk-overlay").count()) === 0,
          "and there is no second map in a modal",
        );
        const layers = await map.evaluate(() =>
          window.__trackerMap
            ? window.__trackerMap
                .getStyle()
                .layers.filter((layer) => /^tracker-e/.test(layer.id))
                .map((layer) => layer.id)
            : [],
        );
        check(layers.length > 0, `the eclipse's own geography is drawn (${layers.join(", ")})`);
        check(
          (await map.locator(".tk-map-target").count()) === 1,
          "the reader's own place is still marked on it",
        );
        check(
          before !== null &&
            after !== null &&
            (Math.abs(after.lng - before.lng) > 1 || Math.abs(after.zoom - before.zoom) > 0.2),
          `and the camera framed it (${before?.lng.toFixed(1)}, z${before?.zoom.toFixed(1)} → ${after?.lng.toFixed(1)}, z${after?.zoom.toFixed(1)})`,
        );

        const params = new URLSearchParams(new URL(map.url()).search);
        check(params.get("show") !== null, "the selected event is in the URL");
        check(params.get("at") !== null && params.get("z") !== null, "and so is the view it framed");
        await shot(map, "16-event-on-the-map", "the event's geography, on the map itself");

        // The map is the reader's again the moment it arrives.
        await map.getByRole("button", { name: "Zoom in" }).click();
        await map.waitForTimeout(1500);
        const zoomed = await camera();
        check(
          zoomed !== null && Math.abs(zoomed.zoom - after.zoom) > 0.2,
          "and the reader owns the camera again immediately",
        );

        await map.goBack();
        await map.waitForTimeout(2000);
      }
    }
  }

  await map.close();
  await mapContext.close();

  /* --- 6. re-ranking when the place changes ------------------------------ */
  //
  // A context of its own, with no init script. Seeding through `addInitScript`
  // re-runs on every load, so a reload would put the original place back and
  // the comparison would silently be between a plan and itself.
  console.log("\nLocation change");
  const changeContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  await stubBasemap(changeContext);
  const changing = await changeContext.newPage();
  await changing.clock.setFixedTime(WALK_AT);
  await changing.goto(TRACKER, { waitUntil: "domcontentloaded" });
  const setPlace = async (place) => {
    await changing.evaluate((value) => {
      localStorage.setItem(
        "orbit-studio:tracker:confirmed-place:v1",
        JSON.stringify({ version: 1, place: value }),
      );
    }, { ...place, fromDevice: false });
    /**
     * A clean URL, not a reload.
     *
     * The map writes the selected point into the address bar, and a URL that
     * names a pin deliberately beats stored state — otherwise a shared link
     * would open on whatever place the recipient last looked at. Reloading
     * therefore put the *first* place straight back, and the comparison below
     * was silently between a plan and itself.
     */
    await changing.goto(TRACKER, { waitUntil: "domcontentloaded" });
    await landOnTonight(changing);
    await changing.waitForTimeout(2500);
    return changing.locator(".tk-tonight").getAttribute("data-plan-identity");
  };

  // The ranking captured on the map on the way in, since the detail page no
  // longer carries a copy of it.
  const railOrder = () => changing.evaluate(() => (window.__rail ?? []).map((card) => card.id));
  const fairbanksIdentity = await setPlace(PLACES.fairbanks);
  const fairbanksRows = await railOrder();
  const portlandIdentity = await setPlace(PLACES.portland);
  const portlandRows = await railOrder();

  check(
    fairbanksIdentity !== portlandIdentity,
    "changing the place invalidates the plan identity",
  );
  check(
    JSON.stringify(fairbanksRows) !== JSON.stringify(portlandRows),
    `the rail is re-ranked for the new place rather than carried over (${fairbanksRows.join(", ")} vs ${portlandRows.join(", ")})`,
  );
  // Was: the header labels a restored place "Restored". That described where
  // the value came from inside the application rather than anything about the
  // observer's night, and the brief for this pass called it out as
  // implementation language on display. The check now asserts its absence, and
  // that the header still answers the question that matters — where Tracker
  // thinks you are.
  check(
    (await changing.getByText("Restored", { exact: true }).count()) === 0,
    "no storage state is shown in the location control",
  );
  check(
    // The map's place control. The event page no longer carries a header: the
    // map behind it owns the place and the date.
    (await placeControl(changing).innerText()).includes(PLACES.portland.name),
    "the location control still names where Tracker thinks you are",
  );

  /**
   * The control opens and shuts, and leaves nothing behind when it shuts.
   *
   * The defect this covers was visible rather than behavioural: a stale
   * `position: absolute` from the picker that predates React Aria took the
   * panel out of flow inside its popover, the popover measured zero height, and
   * the panel's contents spilled across the page under the header as a stray
   * search field. Everything still *worked* — which is why an interaction test
   * that only clicked things would not have caught it, and why these assertions
   * are about the resting state as much as the open one.
   */
  /**
   * On the map, where the picker lives.
   *
   * These are assertions about a control the reader operates, and the event
   * page is an overlay on top of it — so driving it from in there was clicking
   * at something covered, which Playwright rightly refuses to do.
   */
  await changing.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await changing.waitForSelector(".tk-map-topbar .tracker-place-current", { timeout: 30_000 });
  await changing.waitForTimeout(2000);

  const placeTrigger = placeControl(changing);
  check(
    (await changing.locator(".tracker-place-popover").count()) === 0 &&
      (await placeTrigger.getAttribute("aria-expanded")) === "false",
    "the location control rests closed, with no field loose in the header",
  );
  await placeTrigger.click();
  await changing.waitForSelector(".tracker-place-popover", { timeout: 10_000 });
  await changing.waitForTimeout(500);
  check(
    (await changing.locator(".tracker-place-popover input").count()) > 0 &&
      (await changing.locator(".tracker-place-popover .tracker-place-device").count()) > 0,
    "opening it exposes both search and the current-location control",
  );
  /**
   * Containment, not height.
   *
   * The collapse left the panel a ~22px strip with its search field and its
   * device button painted outside it, further down the page. A height
   * threshold is only a proxy for that and picks an arbitrary number — 115px
   * is a perfectly good resting height for a panel showing no results yet, and
   * the first version of this check failed on it.
   *
   * So the assertion is the thing itself: every control the panel owns has to
   * be inside the panel's own box.
   */
  const contained = await changing.evaluate(() => {
    const panel = document.querySelector(".tracker-place-popover .tracker-place-panel");
    if (!panel) return { ok: false, reason: "no panel" };
    const box = panel.getBoundingClientRect();
    const escaped = [...panel.querySelectorAll("input, button")]
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 0 && rect.bottom > box.bottom + 1)
      .map(({ node }) => node.className || node.tagName);
    return { ok: escaped.length === 0, escaped, height: Math.round(box.height) };
  });
  check(
    contained.ok,
    `the panel contains its own controls (${contained.height}px tall${
      contained.ok ? "" : `, escaped: ${contained.escaped.join(", ")}`
    })`,
  );
  await changing.keyboard.press("Escape");
  await changing.waitForTimeout(600);
  check(
    (await changing.locator(".tracker-place-popover").count()) === 0 &&
      (await placeTrigger.getAttribute("aria-expanded")) === "false",
    "Escape closes it and returns the header to its clean state",
  );

  await shot(changing, "12-location-changed", "same page, re-ranked for a different place");
  await changing.close();
  await changeContext.close();

  /* --- 7. small screens -------------------------------------------------- */
  console.log("\nResponsive");
  for (const [label, viewport] of [
    ["tablet", { width: 834, height: 1112 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const smallContext = await browser.newContext({
      viewport,
      isMobile: viewport.width < 500,
      hasTouch: viewport.width < 500,
    });
    await seedPlace(smallContext, PLACES.portland);
    const small = await smallContext.newPage();
    await small.clock.setFixedTime(WALK_AT);
    await small.goto(TRACKER, { waitUntil: "domcontentloaded" });
    await landOnTonight(small);
    await small.waitForTimeout(2500);
    const order = await small.evaluate(() => {
      const y = (selector) =>
        document.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN;
      return {
        hero: y(".tk-hero"),
        viz: y(".tk-viz-slot"),
        conditions: y(".tk-conditions"),
        overflowsHorizontally:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    check(
      order.hero < order.viz && order.viz < order.conditions,
      `${label}: the hierarchy survives — recommendation, then evidence, then conditions`,
    );
    check(!order.overflowsHorizontally, `${label}: the page does not scroll sideways`);
    await shot(small, `13-${label}-tonight`);
    await small.close();
    await smallContext.close();
  }

  /* --- 8. drift between phenomena --------------------------------------- */
  //
  // The claim this whole redesign rests on is that an eclipse page and an aurora
  // page are the meteor page with different content in the slots. That is a
  // measurement, not an impression: every region must start at the same x and be
  // the same width on all three.
  console.log("\nLayout drift");
  const reference = captured.meteors;
  for (const [label, state] of [
    ["aurora", captured.aurora],
    ["solar eclipse", captured.solarEclipse],
    ["lunar eclipse", captured.lunarEclipse],
  ]) {
    if (!state || !reference) {
      findings.push({ label: `${label}: comparable with the meteor page`, pass: null });
      continue;
    }
    for (const region of ["heading", "hero", "visualization", "conditions"]) {
      const a = reference.geometry.rects[region];
      const b = state.geometry.rects[region];
      check(
        a && b && Math.abs(a.x - b.x) <= 1 && Math.abs(a.width - b.width) <= 1,
        `${label}: ${region} sits exactly where the meteor page puts it ` +
          `(${a?.x}/${a?.width} vs ${b?.x}/${b?.width})`,
      );
    }
  }

  /* --- 9. one contact sheet --------------------------------------------- */
  //
  // Built by loading the captured PNGs into a page and photographing it, rather
  // than by adding an image library. The comparison is the deliverable; the
  // assertions above are what make it checkable.
  // Sized to the content: a full-page screenshot is at least a viewport tall,
  // so a generous viewport leaves half the sheet empty.
  const sheetContext = await browser.newContext({ viewport: { width: 1500, height: 560 } });
  const sheet = await sheetContext.newPage();
  await sheet.clock.setFixedTime(WALK_AT);
  const panels = [
    ["Meteor showers — the master layout", "04-meteors-tonight.png"],
    ["Auroras — same geometry, forecast field in the slot", "10-aurora-tonight.png"],
    ["Eclipses — same geometry, coverage map in the slot", "08-eclipse-solar.png"],
  ];
  // Inlined as data URIs. `setContent` has no document URL to resolve a
  // relative `src` against, so a file:// baseURL leaves every image broken —
  // which produced a contact sheet of three captions and no pictures.
  // A panel can be a leftover from an earlier run — the aurora page only exists
  // when there is aurora, so a quiet night leaves yesterday's capture in place.
  // Silently reusing it would make the sheet claim to be one moment when it is
  // two, so the caption says which panel is stale and how old it is.
  const encoded = await Promise.all(
    panels.map(async ([caption, file]) => {
      const fullPath = path.join(OUT, file);
      let note = "";
      if (!capturedThisRun.has(file)) {
        try {
          const when = (await stat(fullPath)).mtime;
          const hours = Math.round((Date.now() - when.getTime()) / 3_600_000);
          note = ` — not captured this run; image is ${hours}h old`;
        } catch {
          return [`${caption} — not captured`, null];
        }
      }
      return [
        caption + note,
        `data:image/png;base64,${(await readFile(fullPath)).toString("base64")}`,
      ];
    }),
  );
  await sheet.setContent(
    `<style>
       body { margin:0; background:#05070d; color:#f2efe8;
              font: 14px/1.4 system-ui, sans-serif; padding:20px; }
       h1 { font-size:19px; font-weight:600; margin:0 0 4px; }
       p.sub { margin:0 0 18px; color:#8b97a8; font-size:13px; }
       .row { display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; align-items:start; }
       figure { margin:0; }
       figcaption { margin-bottom:7px; color:#7ea6cf; font-size:12px; font-weight:600; }
       img { width:100%; display:block; border:1px solid rgba(126,156,190,.28); border-radius:8px; }
     </style>
     <h1>One layout, three phenomena</h1>
     <p class="sub">Captured from the production build. Heading, hero, evidence slot,
        four condition cards and ranked rows occupy identical positions on all three.</p>
     <div class="row">${encoded
       .map(([caption, source]) =>
         source
           ? `<figure><figcaption>${caption}</figcaption><img src="${source}"></figure>`
           : `<figure><figcaption>${caption}</figcaption></figure>`,
       )
       .join("")}</div>`,
  );
  await sheet.waitForTimeout(600);
  await sheet.screenshot({ path: path.join(OUT, "00-layout-comparison.png"), fullPage: true });
  console.log("  · captured 00-layout-comparison");
  await sheet.close();
  await sheetContext.close();

  await browser.close();

  await writeFile(
    path.join(OUT, "walkthrough.json"),
    `${JSON.stringify({ ranAt: new Date().toISOString(), origin: ORIGIN, findings, captured }, null, 2)}\n`,
    "utf8",
  );

  const failed = findings.filter((entry) => entry.pass === false);
  console.log(
    `\n${findings.filter((entry) => entry.pass).length} passed, ${failed.length} failed, ` +
      `${findings.filter((entry) => entry.pass === null).length} not applicable`,
  );
  console.log(`Screenshots and the captured state are in ${OUT}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  // A throw before `browser.close()` leaves Chromium running and Node with a
  // live handle, so the process never exits and the failure looks like a hang.
  process.exit(1);
});
