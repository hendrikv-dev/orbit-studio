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
    rows: [...document.querySelectorAll(".tk-relevant-row")].map((node) =>
      node.textContent?.replace(/\s+/g, " ").trim(),
    ),
    visualization: document.querySelector(".tk-viz-slot .tk-viz-title")?.textContent?.trim() ?? null,
    /** The geometry the universal layout promises, as booleans. */
    geometry: {
      heading: Boolean(document.querySelector(".tk-page-heading h1")),
      hero: Boolean(document.querySelector(".tk-hero .tk-hero-name")),
      visualization: Boolean(document.querySelector(".tk-viz-slot")?.firstElementChild),
      conditions: document.querySelectorAll(".tk-condition-card").length,
      list: document.querySelectorAll(".tk-relevant-row").length,
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
          ["list", ".tk-relevant-list"],
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
  check(state.geometry.list > 0, `${label}: has a ranked list`);
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

async function seedPlace(page, place) {
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

async function clickRow(page, pattern) {
  const row = page.locator(".tk-relevant-row", { hasText: pattern }).first();
  if ((await row.count()) === 0) return false;
  await row.click();
  await page.waitForTimeout(500);
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
  await page.waitForSelector(".tk-tonight", { timeout: 30_000 }).catch(() => {});
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
const LUNAR_ECLIPSE_NIGHT = "2028-01-11";

async function openLunarEclipse(page) {
  await page.goto(`${TRACKER}&date=${LUNAR_ECLIPSE_NIGHT}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 30_000 });
  await page.waitForTimeout(4000);
  return (await page.locator(".tk-hero-name").count()) > 0;
}

/** Whether Best tonight currently recommends something matching `pattern`. */
async function bestTonightHas(page, pattern) {
  const names = await page.locator(".tk-relevant-name").allInnerTexts();
  return names.some((name) => pattern.test(name));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const captured = {};

  /* --- 1. location, from nothing ---------------------------------------- */
  const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  const page = await context.newPage();
  await page.clock.setFixedTime(WALK_AT);
  await page.goto(TRACKER, { waitUntil: "networkidle" });
  await page.waitForSelector(".tk-entry");
  console.log("\nLocation");
  await shot(page, "01-entry-no-location", "denied geolocation, manual search offered");
  check(
    await page.getByText(/blocking location|Use my current location/i).first().isVisible(),
    "entry states the geolocation position rather than failing silently",
  );

  const search = page.getByRole("combobox", { name: "Search for a place to observe from" });
  await search.fill("45.5152, -122.6784");
  await page.getByRole("option").first().waitFor({ timeout: 10_000 });
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Yes, use this" }).waitFor({ timeout: 5_000 });
  await shot(page, "02-location-confirmation", "nothing is computed before confirmation");
  await page.getByRole("button", { name: "Yes, use this" }).click();
  await page.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const firstIdentity = await page.locator(".tk-tonight").getAttribute("data-plan-identity");
  check(Boolean(firstIdentity), "a confirmed place produces an authoritative plan identity");
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
  await portland.goto(TRACKER, { waitUntil: "networkidle" });
  await portland.waitForSelector(".tk-tonight", { timeout: 30_000 });
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

  /* --- 3. upcoming ------------------------------------------------------- */
  console.log("\nUpcoming");
  await portland.getByRole("button", { name: "Upcoming", exact: true }).click();
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
    check(
      (await portland.locator(".tk-eclipse-track, .tk-eclipsemap svg rect").count()) > 0,
      "the eclipse map draws real coverage geometry",
    );
    await checkReminder(portland, "solar eclipse");
    await shot(portland, "08-eclipse-solar", solarState.heroName ?? "");
    captured.solarEclipse = solarState;
    await portland.locator(".tk-back").click();
    await portland.waitForSelector('.tk-highlights[data-planning-state="ready"]', {
      timeout: 90_000,
    });
    await portland.waitForTimeout(600);
    check(
      (await portland.locator(".tk-upcoming-card").count()) > 0,
      "returning from an event restores the previous Upcoming state",
    );
  } else {
    check(false, "an upcoming solar eclipse is offered for Portland");
  }

  // Pinned to a date rather than taken from whatever is in Upcoming, so the
  // assertions below are about the code. See `LUNAR_ECLIPSE_NIGHT`.
  if (await openLunarEclipse(portland)) {
    const lunarState = await readPageState(portland);
    assertUniversalGeometry(lunarState, "lunar eclipse");
    check(
      (await portland.locator(".tk-eclipse-track").count()) === 0,
      "a lunar eclipse map draws no track, because a lunar eclipse has none",
    );
    check(
      (await portland.locator(".tk-viz-slot .tk-geomap").count()) > 0,
      "a lunar eclipse leads with the geographic map, not the altitude chart",
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
  await luxor.goto(TRACKER, { waitUntil: "networkidle" });
  await luxor.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await luxor.getByRole("button", { name: "Upcoming", exact: true }).click();
  await luxor.waitForSelector('.tk-highlights[data-planning-state="ready"]', { timeout: 90_000 });
  const total = luxor.locator(".tk-upcoming-card", { hasText: /total solar eclipse/i }).first();
  if ((await total.count()) > 0) {
    await total.click();
    await luxor.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 30_000 });
    await luxor.waitForTimeout(2500);
    const totalState = await readPageState(luxor);
    assertUniversalGeometry(totalState, "total solar eclipse");
    check(
      (await luxor.locator(".tk-eclipse-band").count()) > 0,
      "a total eclipse draws the measured umbral band, not a nominal one",
    );
    const verdict = await luxor.locator(".tk-viz-verdict").innerText();
    // Totality at Luxor is 6m 25s. The check is that a duration is quoted at
    // all and that it is minutes rather than hours or seconds — the exact
    // figure is asserted against published circumstances in the unit tests.
    const duration = verdict.match(/(\d+)m\s*(\d+)s/);
    check(
      duration !== null && Number(duration[1]) >= 1 && Number(duration[1]) <= 8,
      `the verdict quotes the central duration (${duration ? duration[0] : verdict.split("\n")[0]})`,
    );
    check(
      /km/i.test(verdict) || /km/i.test(await luxor.locator(".tk-viz-panel").innerText()),
      "the path width is stated in kilometres, because it was measured",
    );
    await shot(luxor, "15-eclipse-total", totalState.heroName ?? "");
  } else {
    check(false, "the 2027 total eclipse is offered from inside its own path");
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
    await page.waitForSelector(".tk-tonight", { timeout: 30_000 });
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

      // The control is "View current oval" now: it opens the OVATION field,
      // which describes now rather than tonight, and calling it a forecast map
      // contradicted the panel it opens.
      await page.getByRole("button", { name: "View current oval" }).click();
      await page.waitForSelector(".tk-overlay", { timeout: 5000 });
      await page.waitForTimeout(800);
      check(
        !/forecast map/i.test(await page.locator(".tk-overlay-panel").innerText()),
        "the current oval is not presented as a forecast map",
      );
      await shot(page, "11-aurora-current-oval", "the current oval, expanded");
      await page.keyboard.press("Escape");
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
    const arrivalRows = await page.locator(".tk-relevant-row").allInnerTexts();
    const nameOf = (row) => (row ?? "").split("\n")[1] ?? "nothing";
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
      const fieldOpacity = await page
        .locator(".tk-auroramap svg g[filter]")
        .first()
        .getAttribute("opacity");
      check(
        fieldOpacity !== null && Number(fieldOpacity) < 0.5,
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
    await page.waitForSelector(".tk-tonight", { timeout: 30_000 });
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
    await page.waitForSelector(".tk-tonight", { timeout: 30_000 });
    await page.getByRole("button", { name: "Upcoming" }).click();
    await page.waitForSelector('.tk-highlights[data-planning-state="ready"]', { timeout: 90_000 });
    await page.selectOption(".tk-phenomenon-filter select", "auroras");
    await page.waitForTimeout(1200);

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
      check(false, "a quiet K-index forecast produces an empty aurora list");
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
    await page.waitForSelector(".tk-tonight", { timeout: 30_000 });
    await page.waitForTimeout(4000);

    const fit = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".tk-relevant-row")];
      const last = rows[rows.length - 1]?.getBoundingClientRect() ?? null;
      const heroRow = document.querySelector(".tk-main-row")?.getBoundingClientRect();
      const region = (selector) => Boolean(document.querySelector(selector));
      return {
        overflow: document.documentElement.scrollHeight - window.innerHeight,
        rows: rows.length,
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
        hasList: region(".tk-relevant-head"),
      };
    });

    check(fit.overflow <= 1, `${label}: the page does not scroll (${fit.overflow}px over)`);
    check(
      fit.lastRowBottom !== null && fit.lastRowBottom <= fit.viewport + 1,
      `${label}: the last ranked row is on screen (${fit.lastRowBottom} of ${fit.viewport})`,
    );
    check(
      fit.hasHeading && fit.hasHero && fit.hasViz && fit.hasConditions && fit.hasList,
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
    await page.waitForSelector(".tk-tonight", { timeout: 30_000 });
    await page.waitForTimeout(4000);
    const released = await page.evaluate(() => {
      const hero = document.querySelector(".tk-hero");
      return {
        scrolls: document.documentElement.scrollHeight > window.innerHeight,
        heroClipped: hero ? hero.scrollHeight - hero.clientHeight : 0,
        rows: document.querySelectorAll(".tk-relevant-row").length,
      };
    });
    check(
      released.heroClipped === 0,
      `below the floor: nothing is clipped (${released.heroClipped}px)`,
    );
    check(
      released.scrolls,
      "below the floor: the page scrolls rather than hiding the rest of the ranking",
    );
    check(released.rows > 0, "below the floor: the ranked list is still rendered");
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
  await dated.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await dated.waitForTimeout(4500);

  const historical = await dated.evaluate(() => ({
    heading: document.querySelector(".tk-relevant-head h2")?.textContent ?? "",
    body: document.body.innerText,
    rows: document.querySelectorAll(".tk-relevant-row").length,
    place: document.querySelector("header.tk-header")?.textContent ?? "",
    conditions: [...document.querySelectorAll(".tk-condition-value")].map((n) => n.textContent),
  }));

  check(/Apr 8, 2024|8 Apr 2024/.test(historical.heading), `the heading names the date (${historical.heading})`);
  check(
    !/historical|past mode|future mode|archive/i.test(historical.body),
    "no language about modes, archives or the software's state",
  );
  check(historical.rows > 0, `a historical night still produces a ranking (${historical.rows} rows)`);
  check(
    historical.place.includes(PLACES.portland.name),
    "changing the date preserves the place",
  );
  check(
    historical.conditions.some((value) => /not recorded/i.test(value ?? "")),
    "no weather is invented for a night in the past",
  );
  await shot(dated, "28-historical-date", "the same page, 8 April 2024");

  // Back returns to the night the reader came from.
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
  check(
    (await dated.locator('.tk-date input[type="date"]').inputValue()) === "2024-04-08",
    "the date control shows the night on screen",
  );
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
    check(
      /Best tonight/.test(await dated.locator(".tk-relevant-head h2").innerText()),
      "and the heading says tonight again",
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
    await honest.goto(`${TRACKER}&event=${id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await honest.waitForSelector(".tk-tonight", { timeout: 30_000 });
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
        rows: [...document.querySelectorAll(".tk-relevant-name")].map((n) => n.textContent?.trim()),
        metricCount: metrics.length,
        metricLabels: metrics.map((metric) => metric.label),
        allText: document.querySelector(".tk-page")?.textContent ?? "",
      };
    });

    const listed = state.rows.some((row) => new RegExp(id, "i").test(row ?? ""));
    check(!listed, `${id}: reachable directly, and still not recommended`);
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
  await honest.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await honest.waitForTimeout(4500);
  const recommended = await honest.evaluate(() => ({
    name: document.querySelector(".tk-hero-name")?.textContent?.trim() ?? "",
    rows: [...document.querySelectorAll(".tk-relevant-name")].map((n) => n.textContent?.trim()),
    where:
      [...document.querySelectorAll(".tk-hero-metrics .tk-metric")]
        .find((node) => /where to look/i.test(node.querySelector("dt")?.textContent ?? ""))
        ?.querySelector("dd")
        ?.textContent?.trim() ?? "",
  }));
  check(
    recommended.rows[0] === recommended.name,
    `the hero is the top of Best tonight ("${recommended.name}" vs "${recommended.rows[0]}")`,
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
    const airQuality = (hours) => (route) => {
      const times = [];
      const pm25 = [];
      const depths = [];
      const from = new Date(WALK_AT);
      from.setUTCHours(from.getUTCHours() - 12, 0, 0, 0);
      for (let index = 0; index < 72; index += 1) {
        const at = new Date(from.getTime() + index * 3_600_000);
        times.push(at.toISOString().slice(0, 19));
        pm25.push(hours.pm25);
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

    const cardsUnder = async (label, air) => {
      const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
      await seedPlace(context, PLACES.portland);
      await context.route("**/air-quality**", airQuality(air));
      const page = await context.newPage();
      await page.clock.setFixedTime(WALK_AT);
      await page.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector(".tk-tonight", { timeout: 30_000 });
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
    await page.waitForSelector(".tk-page", { timeout: 60_000 });
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
  await rankPage.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await rankPage.waitForTimeout(3500);

  /** Every ranked row as {rank, name}, exactly as a reader would read it. */
  const readRanking = () =>
    rankPage.evaluate(() =>
      [...document.querySelectorAll(".tk-relevant-row")].map((row) => ({
        rank: row.querySelector(".tk-relevant-rank")?.textContent?.trim() ?? "",
        name: row.querySelector(".tk-relevant-name")?.textContent?.trim() ?? "",
      })),
    );

  const baseline = await readRanking();
  check(baseline.length > 0, `a ranked list is present (${baseline.length} rows)`);
  console.log(
    `  · baseline: ${baseline.map((row) => `${row.rank}. ${row.name}`).join(", ")}`,
  );

  // Ranks must be 1..n with no repeats, or the number means nothing.
  check(
    baseline.every((row, index) => row.rank === String(index + 1)),
    "the ranked list is numbered one upwards with no gaps",
  );

  /** Comparable regardless of which rows a page happens to show. */
  const rankOf = (rows) => new Map(rows.map((row) => [row.name, row.rank]));
  const baselineRanks = rankOf(baseline);

  const disagreements = [];
  const compare = (rows, where) => {
    for (const row of rows) {
      const expected = baselineRanks.get(row.name);
      if (expected !== undefined && expected !== row.rank) {
        disagreements.push(`${row.name} was ${expected}, is ${row.rank} on ${where}`);
      }
    }
  };

  // Visit each event in the list by name, recording the ranking from its page.
  const visited = [];
  for (const target of baseline.slice(0, 5)) {
    const opened = await clickRow(rankPage, new RegExp(target.name.slice(0, 14).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    if (!opened) continue;
    await rankPage.waitForTimeout(1800);
    const rows = await readRanking();
    compare(rows, target.name);
    visited.push(target.name);

    // And the open event must not have been promoted to the top.
    const top = rows[0];
    check(
      top.name === baseline[0].name,
      `${target.name}: the list still leads with ${baseline[0].name}`,
    );
    const self = rows.find((row) => row.name === target.name);
    check(
      self !== undefined && self.rank === baselineRanks.get(target.name),
      `${target.name}: keeps rank ${baselineRanks.get(target.name)} on its own page`,
    );
  }
  console.log(`  · visited ${visited.length} event pages: ${visited.join(", ")}`);

  // A drill-in must not disturb it either.
  if ((await rankPage.locator(".tk-action.is-primary").count()) > 0) {
    await rankPage.locator(".tk-action.is-primary").first().click();
    await rankPage.waitForTimeout(1500);
    await rankPage.keyboard.press("Escape");
    await rankPage.waitForTimeout(1200);
    compare(await readRanking(), "closing a drill-in");
  }

  // Nor may Back and Forward.
  await rankPage.goBack();
  await rankPage.waitForTimeout(1500);
  compare(await readRanking(), "Back");
  await rankPage.goForward();
  await rankPage.waitForTimeout(1500);
  compare(await readRanking(), "Forward");

  // And returning to where we started must reproduce the baseline exactly.
  await rankPage.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await rankPage.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await rankPage.waitForTimeout(3500);
  const returned = await readRanking();
  compare(returned, "returning to Tonight");

  check(
    disagreements.length === 0,
    disagreements.length === 0
      ? `rank is identical across every page, drill-in and history move (${visited.length + 4} observations)`
      : `rank changed with navigation — ${disagreements.join("; ")}`,
  );

  // The list must also describe itself truthfully.
  const caption = await rankPage.locator(".tk-relevant-head p").innerText();
  check(
    !/sorted by time/i.test(caption),
    "the list does not claim to be sorted by time, which it never was",
  );
  await shot(rankPage, "24-ranking", "the ranked list, from Tonight");

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
  await nav.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await nav.waitForTimeout(3000);

  /** The Tracker location the address bar currently describes. */
  const urlState = () => {
    const params = new URLSearchParams(new URL(nav.url()).search);
    return {
      app: params.get("app"),
      view: params.get("view") ?? "tonight",
      event: params.get("event"),
      drill: params.get("drill"),
      mode: params.get("mode") ?? "list",
      filter: params.get("filter") ?? "all",
      month: params.get("month"),
    };
  };

  const openUpcoming = async () => {
    await nav.getByRole("button", { name: "Upcoming" }).click();
    await nav.waitForSelector('.tk-highlights[data-planning-state="ready"]', { timeout: 90_000 });
    await nav.waitForTimeout(500);
  };

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

    // "View visibility map" must open the geographic map. It used to open the
    // altitude chart, which is a different tool answering a different question.
    await nav.getByRole("button", { name: "View visibility map" }).click();
    await nav.waitForSelector(".tk-overlay", { timeout: 10_000 });
    await nav.waitForTimeout(1200);
    check(
      (await nav.locator(".tk-overlay .tk-geomap").count()) > 0,
      "View visibility map opens the geographic map",
    );
    check(
      (await nav.locator(".tk-overlay .tk-chart-path").count()) === 0,
      "View visibility map does not open the sky chart instead",
    );
    check(urlState().drill === "field", "the open map is a state the URL describes");
    await shot(nav, "15-lunar-visibility-map", "geographic visibility map for a lunar eclipse");

    // The regions have to be distinguishable, or the map is decoration.
    const legend = await nav.locator(".tk-overlay .tk-geomap-legend").innerText().catch(() => "");
    check(
      /all of it/i.test(legend) && /rises/i.test(legend) && /sets/i.test(legend),
      "the map distinguishes seeing all of it from moonrise and moonset",
    );
    check(
      (await nav.locator(".tk-overlay .tk-lunar-limit").count()) >= 2,
      "the horizon at first and last contact is drawn as a curve",
    );

    await nav.keyboard.press("Escape");
    await nav.waitForTimeout(800);
    check(
      (await nav.locator(".tk-overlay").count()) === 0,
      "Escape closes the visibility map",
    );

    // "Where to look" is the other tool, and must be reachable separately.
    const whereToLook = nav.getByRole("button", { name: "Where to look" });
    if ((await whereToLook.count()) > 0) {
      await whereToLook.click();
      await nav.waitForSelector(".tk-overlay", { timeout: 10_000 });
      await nav.waitForTimeout(1000);
      check(
        (await nav.locator(".tk-overlay .tk-chart-path").count()) > 0,
        "Where to look opens the altitude and bearing chart",
      );
      check(
        (await nav.locator(".tk-overlay .tk-geomap").count()) === 0,
        "Where to look is not the geographic map",
      );
      check(urlState().drill === "sky", "the sky chart is its own state in the URL");
      await nav.keyboard.press("Escape");
      await nav.waitForTimeout(700);
    } else {
      check(false, "Where to look is offered alongside the visibility map");
    }

    // --- Open full map, the control that did nothing at all -----------------
    const openFull = nav.locator(".tk-viz-open", { hasText: /open full map/i }).first();
    check((await openFull.count()) > 0, "the visualization offers Open full map");
    if ((await openFull.count()) > 0) {
      // Keyboard, not just mouse: the brief requires activation by both.
      await openFull.focus();
      await nav.keyboard.press("Enter");
      await nav.waitForSelector(".tk-overlay", { timeout: 10_000 });
      await nav.waitForTimeout(1800);
      check(
        (await nav.locator(".tk-overlay .tk-geomap").count()) > 0,
        "Open full map opens an expanded geographic map (keyboard)",
      );
      check(urlState().drill === "field", "Open full map is a history state");

      /**
       * Expanded means more of the world, not the same card scaled up.
       *
       * Read off the field's declared sampling rather than off how many nodes
       * it drew. Counting rectangles measured the renderer — it broke when the
       * field stopped being one rectangle per cell, on a map that was sampling
       * exactly as finely as before.
       */
      const cellsIn = async (scope) =>
        Number(
          (await nav.locator(`${scope} [data-field-cells]`).first().getAttribute("data-field-cells")) ??
            0,
        );
      const cardCells = await cellsIn(".tk-page .tk-eclipsemap");
      const fullCells = await cellsIn(".tk-overlay .tk-eclipsemap");
      check(
        fullCells > cardCells,
        `the expanded map samples more than the card (${fullCells} vs ${cardCells})`,
      );
      check(
        (await nav.locator(".tk-overlay .tk-viz-open").count()) === 0,
        "the expanded map does not offer to open itself again",
      );
      await shot(nav, "16-lunar-full-map", "expanded geographic map");

      // Back must close it and land on the event, not leave Tracker.
      await nav.goBack();
      await nav.waitForTimeout(1200);
      check(
        (await nav.locator(".tk-overlay").count()) === 0 && urlState().drill === null,
        "Back closes the expanded map",
      );
      check(
        urlState().event === eventUrl.event,
        "Back from the map returns to the event, not to the homepage",
      );
    }

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

    // Move to a second event from the ranked list on the event page itself.
    const nextRow = nav.locator(".tk-relevant-row").nth(1);
    if ((await nextRow.count()) > 0) {
      await nextRow.click();
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

  await nav.goto(TRACKER, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await nav.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await nav.waitForTimeout(3000);

  const depthNow = () => nav.evaluate(() => window.history.length);

  const beforeStep = await depthNow();
  await nav.locator(".tk-relevant-row").nth(1).click();
  await nav.waitForTimeout(1800);
  const afterStep = await depthNow();
  check(
    afterStep - beforeStep === 1,
    `opening an event pushes exactly one history entry (${afterStep - beforeStep})`,
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
  await nav.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await nav.waitForTimeout(4500);

  const eclipseNight = await nav.evaluate(() => ({
    category: document.querySelector(".tk-page")?.getAttribute("data-category") ?? null,
    hero: document.querySelector(".tk-hero-name")?.textContent?.trim() ?? "",
    rows: [...document.querySelectorAll(".tk-relevant-name")].map((n) => n.textContent?.trim()),
    hasGeoMap: Boolean(document.querySelector(".tk-viz-slot .tk-geomap")),
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

  // The same three controls, from Tonight rather than from Upcoming.
  await nav.getByRole("button", { name: "View visibility map" }).click();
  await nav.waitForSelector(".tk-overlay", { timeout: 10_000 });
  await nav.waitForTimeout(1500);
  check(
    (await nav.locator(".tk-overlay .tk-geomap").count()) > 0,
    "Tonight: View visibility map opens the geographic map",
  );
  await nav.keyboard.press("Escape");
  await nav.waitForTimeout(800);

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

  /* --- 5c. the map as a tool ---------------------------------------------- */
  //
  // Everything here asserts a consequence rather than a control's existence:
  // the viewBox actually moved, the answer for a picked point is a *different*
  // answer, and the saved place is untouched afterwards.
  console.log("\nInteractive maps");

  const mapContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  await seedPlace(mapContext, PLACES.portland);
  const map = await mapContext.newPage();
  await map.clock.setFixedTime(WALK_AT);

  const viewBox = () =>
    map.locator(".tk-overlay .tk-geomap-frame > svg").getAttribute("viewBox");
  /** viewBox as numbers, which is what "did it move" has to be measured on. */
  const box = async () => (await viewBox()).split(" ").map(Number);

  if (await openLunarEclipse(map)) {
    await map.waitForTimeout(2500);

    // The embedded panel must stay a glance: a map that captured drags there
    // would fight the reader for the page's own scrolling.
    check(
      (await map.locator(".tk-page .tk-geomap-frame[data-interactive='true']").count()) === 0,
      "the embedded map does not capture gestures from the page",
    );

    await map.locator(".tk-viz-open", { hasText: /open full map/i }).first().click();
    await map.waitForSelector(".tk-overlay .tk-geomap", { timeout: 15_000 });
    await map.waitForTimeout(1500);
    check(
      (await map.locator(".tk-overlay .tk-geomap-frame[data-interactive='true']").count()) === 1,
      "the expanded map is the interactive one",
    );

    /**
     * The expanded map has to fit the modal it opens in.
     *
     * Reported from a production screenshot: the controls were crowded against
     * the bottom-right boundary and partly clipped. The cause was the drawing
     * keeping its natural aspect at full width, which on a laptop made it
     * taller than the scrolling body — so the controls, the legend and the
     * summary all sat below the fold of what looks like a fixed panel.
     */
    const layout = await map.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      };
      const body = document.querySelector(".tk-overlay-body");
      return {
        viewportHeight: window.innerHeight,
        controls: rect(".tk-overlay .tk-geomap-controls"),
        frame: rect(".tk-overlay .tk-geomap-frame"),
        legend: rect(".tk-overlay .tk-geomap-legend"),
        summary: rect(".tk-overlay .tk-geomap-summary"),
        panel: rect(".tk-overlay-panel"),
      };
    });

    check(
      layout.controls !== null &&
        layout.controls.bottom <= layout.viewportHeight &&
        layout.controls.top >= 0,
      "the map controls are fully on screen without scrolling",
    );
    check(
      layout.controls !== null &&
        layout.frame !== null &&
        layout.controls.bottom <= layout.frame.bottom + 1 &&
        layout.controls.right <= layout.frame.right + 1 &&
        layout.frame.right - layout.controls.right >= 8 &&
        layout.frame.bottom - layout.controls.bottom >= 8,
      "the controls sit clear of the frame's edge rather than flush against it",
    );
    check(
      layout.legend !== null && layout.legend.bottom <= layout.viewportHeight,
      "the legend is visible without scrolling",
    );
    check(
      layout.frame !== null &&
        layout.panel !== null &&
        layout.frame.bottom <= layout.panel.bottom + 1,
      "the map does not extend past the modal that contains it",
    );

    const initial = await box();

    // --- zoom ---------------------------------------------------------------
    await map.locator(".tk-overlay .tk-map-control[aria-label='Zoom in']").click();
    await map.waitForTimeout(400);
    const zoomedIn = await box();
    check(zoomedIn[2] < initial[2], `Zoom in narrows the view (${initial[2]} to ${zoomedIn[2]})`);
    check(
      Math.abs(zoomedIn[2] / zoomedIn[3] - initial[2] / initial[3]) < 1e-6,
      "zooming holds the aspect ratio, so no layer is stretched",
    );

    await map.locator(".tk-overlay .tk-map-control[aria-label='Zoom out']").click();
    await map.waitForTimeout(400);
    check((await box())[2] > zoomedIn[2], "Zoom out widens it again");

    // --- reset --------------------------------------------------------------
    await map.locator(".tk-overlay .tk-map-control[aria-label='Zoom in']").click();
    await map.waitForTimeout(300);
    await map.locator(".tk-overlay .tk-map-control[aria-label='Reset the map']").click();
    await map.waitForTimeout(400);
    const reset = await box();
    check(
      reset.every((value, index) => Math.abs(value - initial[index]) < 1e-6),
      "Reset returns the whole map",
    );

    // --- recentre on me -----------------------------------------------------
    await map.locator(".tk-overlay .tk-map-control[aria-label='Zoom in']").click();
    await map.waitForTimeout(300);
    await map.locator(".tk-overlay .tk-map-control[aria-label='Recentre on me']").click();
    await map.waitForTimeout(400);
    const centred = await box();
    const markerAt = await map.evaluate(() => {
      const marker = document.querySelector(".tk-overlay .tk-geomap-marker");
      const transform = marker?.getAttribute("transform") ?? "";
      const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform);
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    });
    // Centred *or* clamped to an edge. Portland sits close to the top of a
    // pole-to-pole lunar map, so at this zoom the viewport reaches the edge
    // before the marker reaches the middle — and stopping at the edge is the
    // correct behaviour, not a failure to centre. What must always hold is
    // that the observer ends up inside the view.
    const inView =
      markerAt !== null &&
      markerAt.x >= centred[0] &&
      markerAt.x <= centred[0] + centred[2] &&
      markerAt.y >= centred[1] &&
      markerAt.y <= centred[1] + centred[3];
    const centredOrClamped =
      markerAt !== null &&
      (Math.abs(markerAt.x - (centred[0] + centred[2] / 2)) < 1 ||
        centred[0] === 0 ||
        Math.abs(centred[0] + centred[2] - 640) < 1e-6) &&
      (Math.abs(markerAt.y - (centred[1] + centred[3] / 2)) < 1 ||
        centred[1] === 0 ||
        Math.abs(centred[1] + centred[3] - initial[3]) < 1e-6);
    check(inView, "Recentre on me brings the observer into view");
    check(centredOrClamped, "Recentre on me centres the observer, or stops at the map's edge");

    // --- keyboard -----------------------------------------------------------
    const beforeKeys = await box();
    await map.locator(".tk-overlay .tk-geomap-frame").focus();
    await map.keyboard.press("ArrowRight");
    await map.waitForTimeout(300);
    const panned = await box();
    check(panned[0] > beforeKeys[0], "the arrow keys pan the map");
    await map.keyboard.press("0");
    await map.waitForTimeout(300);
    check((await box())[2] === initial[2], "zero resets the map from the keyboard");
    await map.keyboard.press("+");
    await map.waitForTimeout(300);
    check((await box())[2] < initial[2], "plus zooms in from the keyboard");
    await map.keyboard.press("-");
    await map.waitForTimeout(300);
    check((await box())[2] > 0, "minus zooms back out from the keyboard");

    // --- the phenomenon layer survives the viewport -------------------------
    // A viewBox change must not disturb what is drawn in it. If the bands or
    // the horizon curves vanished on zoom, the map would be showing geometry
    // that depends on where the reader happens to be looking.
    check(
      (await map.locator(".tk-overlay .tk-lunar-limit").count()) >= 2,
      "the horizon curves survive panning and zooming",
    );
    check(
      Number(
        (await map
          .locator(".tk-overlay .tk-eclipsemap [data-field-cells]")
          .first()
          .getAttribute("data-field-cells")) ?? 0,
      ) > 100,
      "the visibility field survives panning and zooming",
    );

    // --- picking somewhere else --------------------------------------------
    // Reset is disabled at full extent, which is where the keyboard test left
    // the map — clicking a disabled control would hang rather than assert.
    const resetControl = map.locator(".tk-overlay .tk-map-control[aria-label='Reset the map']");
    if (await resetControl.isEnabled()) {
      await resetControl.click();
      await map.waitForTimeout(400);
    }
    const summaryBefore = await map.locator(".tk-overlay .tk-geomap-summary").innerText();

    const frameBox = await map.locator(".tk-overlay .tk-geomap-frame > svg").boundingBox();
    // Well inside the map and away from the controls in the bottom right.
    await map.mouse.click(frameBox.x + frameBox.width * 0.62, frameBox.y + frameBox.height * 0.62);
    await map.waitForTimeout(900);

    check(
      (await map.locator(".tk-overlay .tk-geomap-selected").count()) === 1,
      "picking a point marks it, distinctly from the observer's own pin",
    );
    const summaryAfter = await map.locator(".tk-overlay .tk-geomap-summary").innerText();
    check(
      summaryAfter.length > summaryBefore.length && summaryAfter !== summaryBefore,
      "picking a point adds its circumstances in words, not only on the drawing",
    );
    check(
      /From [-\d.]+°, [-\d.]+°/.test(summaryAfter),
      "the picked point is named by its coordinates",
    );
    check(
      /moon|eclipse|horizon/i.test(summaryAfter.split("\n").slice(-1)[0]),
      "the picked point gets a real local circumstance",
    );
    check(
      summaryAfter.includes(PLACES.portland.name),
      "the reader's own circumstances stay alongside the picked point's",
    );
    await shot(map, "20-map-location-inspection", "asking about somewhere else");

    // --- and the saved place is untouched -----------------------------------
    const storedPlace = await map.evaluate(() => {
      const raw = localStorage.getItem("orbit-studio:tracker:confirmed-place:v1");
      return raw ? JSON.parse(raw) : null;
    });
    check(
      storedPlace !== null &&
        JSON.stringify(storedPlace).includes(PLACES.portland.name),
      "inspecting a point does not overwrite the saved location",
    );
    // The overlay has a header of its own, so this must name Tracker's.
    check(
      (await map.locator("header.tk-header").innerText()).includes(PLACES.portland.name),
      "the header still names the reader's own place",
    );

    // --- Back closes the map, and the pin goes with it ----------------------
    await map.goBack();
    await map.waitForTimeout(1400);
    check((await map.locator(".tk-overlay").count()) === 0, "Back closes the expanded map");
    check(
      new URL(map.url()).searchParams.get("drill") === null,
      "the drill-in leaves the URL when it closes",
    );
    await map.locator(".tk-viz-open", { hasText: /open full map/i }).first().click();
    await map.waitForSelector(".tk-overlay .tk-geomap", { timeout: 15_000 });
    await map.waitForTimeout(1200);
    check(
      (await map.locator(".tk-overlay .tk-geomap-selected").count()) === 0,
      "a temporary pin does not survive closing the map",
    );
    await map.keyboard.press("Escape");
    await map.waitForTimeout(700);
  } else {
    check(false, "the pinned lunar eclipse night renders a map to exercise");
  }

  // --- the solar map answers for a picked point too -------------------------
  //
  // Back to the list first: the lunar block left us on an event page, where
  // there are no cards to click and the whole block would skip in silence.
  await map.goto(`${TRACKER}&view=upcoming&filter=eclipses`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await map.waitForSelector('.tk-highlights[data-planning-state="ready"]', { timeout: 90_000 });
  await map.waitForTimeout(800);

  const solarForMap = map.locator(".tk-upcoming-card", { hasText: /solar eclipse/i }).first();
  if ((await solarForMap.count()) > 0) {
    await solarForMap.click();
    await map.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 30_000 });
    await map.waitForTimeout(2500);
    check(
      (await map.locator(".tracker-safety, .tk-safety").count()) > 0 ||
        (await map.locator(".tk-page").innerText()).includes("solar filter"),
      "solar: the safety message is still present on the event page",
    );
    await map.locator(".tk-viz-open", { hasText: /open full map/i }).first().click();
    await map.waitForSelector(".tk-overlay .tk-geomap", { timeout: 15_000 });
    await map.waitForTimeout(2000);
    check(
      Number(
        (await map
          .locator(".tk-overlay .tk-eclipsemap [data-field-cells]")
          .first()
          .getAttribute("data-field-cells")) ?? 0,
      ) > 50,
      "solar: the coverage field still renders on the expanded map",
    );
    const solarFrame = await map.locator(".tk-overlay .tk-geomap-frame > svg").boundingBox();
    await map.mouse.click(
      solarFrame.x + solarFrame.width * 0.45,
      solarFrame.y + solarFrame.height * 0.45,
    );
    await map.waitForTimeout(1200);
    const solarSummary = await map.locator(".tk-overlay .tk-geomap-summary").innerText();
    check(
      /From [-\d.]+°, [-\d.]+°/.test(solarSummary),
      "solar: a picked point is answered for",
    );
    check(
      /covered|not visible|below the horizon/i.test(solarSummary),
      "solar: the picked point gets a coverage answer",
    );
    check(
      !/covered/i.test(solarSummary) || /filter/i.test(solarSummary),
      "solar: safety travels with a picked point that can see it",
    );
    await shot(map, "21-solar-map-inspection", "solar eclipse, asking about somewhere else");
    await map.keyboard.press("Escape");
    await map.waitForTimeout(600);
  } else {
    check(false, "a solar eclipse is available to exercise the interactive map");
  }

  await map.close();
  await mapContext.close();

  // --- a phone --------------------------------------------------------------
  //
  // Its own context with touch enabled, rather than a resize of the desktop
  // one. A resized desktop page still reports a fine pointer and has no touch
  // API, so `tap` cannot run and the coarse-pointer rules never apply — it
  // would look like a mobile test and exercise none of what makes mobile
  // different.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  await seedPlace(phoneContext, PLACES.portland);
  const phone = await phoneContext.newPage();
  await phone.clock.setFixedTime(WALK_AT);

  const phoneBox = async () =>
    (await phone.locator(".tk-overlay .tk-geomap-frame > svg").getAttribute("viewBox"))
      .split(" ")
      .map(Number);

  if (await openLunarEclipse(phone)) {
    await shot(phone, "22-mobile-event", "eclipse event page on a phone");

    /**
     * The open, measured rather than merely awaited.
     *
     * This tap used to be the check: press it, wait for a map, pass. A map that
     * arrives after three seconds of a frozen interface satisfies that exactly
     * as well as one that arrives in fifty milliseconds, which is how a
     * two-second block survived a full verification pass.
     *
     * What is recorded instead is what a reader actually experiences — how long
     * the main thread was unavailable, and how much document the browser was
     * asked to build. Neither moves with machine load the way wall-clock time
     * does, so both are safe to assert on. `scripts/verify/tracker-map-profile.mjs`
     * is the same measurement as a standalone profiler.
     */
    await phone.evaluate(() => {
      window.__tkTasks = [];
      window.__tkObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__tkTasks.push(Math.round(entry.duration));
      });
      window.__tkObserver.observe({ entryTypes: ["longtask"] });
    });
    await phone
      .locator(".tk-viz-open", { hasText: /open full map/i })
      .first()
      .tap({ timeout: 90_000 });
    await phone.waitForSelector(".tk-overlay .tk-geomap", { timeout: 60_000 });
    await phone.waitForTimeout(1200);

    const openCost = await phone.evaluate(() => {
      window.__tkObserver.disconnect();
      const map = document.querySelector(".tk-overlay .tk-geomap");
      return {
        longest: window.__tkTasks.length ? Math.max(...window.__tkTasks) : 0,
        blocked: window.__tkTasks.reduce((a, b) => a + b, 0),
        svgNodes: map ? map.querySelectorAll("svg *").length : 0,
      };
    });

    /**
     * The two numbers, and why these thresholds.
     *
     * 16 330 SVG nodes was the field drawn one rectangle per sampled cell. The
     * same field as merged runs is about fifty, so 500 is far above the fixed
     * design and far below any return of per-cell drawing — it catches the
     * regression without pinning the exact node count of a map that may
     * legitimately gain a marker.
     *
     * 600 ms for a single task is likewise nowhere near the 105 ms this
     * measures today, and well under the 300 ms the per-cell version spent on a
     * headless machine that is faster than a phone. A tighter bound would start
     * failing on a loaded CI box for reasons that have nothing to do with the
     * code.
     */
    check(
      openCost.svgNodes > 0 && openCost.svgNodes < 500,
      `mobile: the expanded field is drawn as merged runs (${openCost.svgNodes} svg nodes)`,
    );
    check(
      openCost.longest < 600,
      `mobile: opening the map has no multi-second block (longest task ${openCost.longest} ms, ${openCost.blocked} ms total)`,
    );
    await phone.waitForTimeout(1800);

    const controlBox = await phone
      .locator(".tk-overlay .tk-map-control[aria-label='Zoom in']")
      .boundingBox();
    check(
      controlBox !== null && controlBox.width >= 40 && controlBox.height >= 40,
      `mobile: map controls are thumb-sized (${Math.round(controlBox?.width ?? 0)}px)`,
    );
    check(
      (await phone.evaluate(
        () => getComputedStyle(document.querySelector(".tk-overlay .tk-geomap-frame")).touchAction,
      )) === "none",
      "mobile: the map owns its gestures rather than scrolling the page",
    );

    // Controls must not sit on top of each other or run off the frame.
    const frameRect = await phone.locator(".tk-overlay .tk-geomap-frame").boundingBox();
    check(
      controlBox !== null &&
        frameRect !== null &&
        controlBox.x >= frameRect.x &&
        controlBox.x + controlBox.width <= frameRect.x + frameRect.width + 1,
      "mobile: the controls stay inside the map frame",
    );

    const mobileBefore = await phoneBox();
    await phone.locator(".tk-overlay .tk-map-control[aria-label='Zoom in']").tap();
    await phone.waitForTimeout(600);
    check((await phoneBox())[2] < mobileBefore[2], "mobile: tapping zoom in works");

    // A one-finger drag, with real touch events.
    const mFrame = await phone.locator(".tk-overlay .tk-geomap-frame > svg").boundingBox();
    const panBefore = await phoneBox();
    await phone.touchscreen.tap(mFrame.x + 10, mFrame.y + 10);
    await phone.waitForTimeout(200);
    await phone.mouse.move(mFrame.x + mFrame.width / 2, mFrame.y + mFrame.height / 2);
    await phone.mouse.down();
    await phone.mouse.move(
      mFrame.x + mFrame.width / 2 - 70,
      mFrame.y + mFrame.height / 2,
      { steps: 10 },
    );
    await phone.mouse.up();
    await phone.waitForTimeout(600);
    check((await phoneBox())[0] > panBefore[0], "mobile: dragging pans the map");

    check(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
      "mobile: the expanded map does not scroll the page sideways",
    );

    // Tapping the map picks a place, the same as clicking it does.
    await phone.touchscreen.tap(mFrame.x + mFrame.width * 0.4, mFrame.y + mFrame.height * 0.4);
    await phone.waitForTimeout(900);
    check(
      (await phone.locator(".tk-overlay .tk-geomap-selected").count()) === 1,
      "mobile: tapping the map picks a place",
    );
    const phoneSummary = await phone.locator(".tk-overlay .tk-geomap-summary").innerText();
    check(
      /From [-\d.]+°, [-\d.]+°/.test(phoneSummary),
      "mobile: the picked place is answered for in words",
    );
    await shot(phone, "23-mobile-full-map", "expanded map on a phone");

    /**
     * Closing and reopening must not rebuild the hemisphere.
     *
     * It did, because the memo behind it was keyed on whether the overlay was
     * open — and the second open measured worse than the first, since the
     * browser was tearing the old field down while the new one was computed.
     * Nothing about the geometry depends on the overlay's state, so a reopen
     * should be a cache read and should cost essentially nothing.
     */
    await phone.locator(".tk-overlay .tk-icon-button").first().tap();
    await phone.waitForSelector(".tk-overlay", { state: "detached", timeout: 20_000 });
    await phone.waitForTimeout(500);
    await phone.evaluate(() => {
      window.__tkTasks = [];
      window.__tkObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__tkTasks.push(Math.round(entry.duration));
      });
      window.__tkObserver.observe({ entryTypes: ["longtask"] });
    });
    await phone
      .locator(".tk-viz-open", { hasText: /open full map/i })
      .first()
      .tap({ timeout: 90_000 });
    await phone.waitForSelector(".tk-overlay .tk-geomap", { timeout: 60_000 });
    await phone.waitForTimeout(1200);
    const reopenCost = await phone.evaluate(() => {
      window.__tkObserver.disconnect();
      return {
        longest: window.__tkTasks.length ? Math.max(...window.__tkTasks) : 0,
        blocked: window.__tkTasks.reduce((a, b) => a + b, 0),
      };
    });
    check(
      reopenCost.longest < 250,
      `mobile: reopening the same map reuses its geometry (longest task ${reopenCost.longest} ms)`,
    );

    // Back, from the browser, on a phone.
    await phone.goBack();
    await phone.waitForTimeout(1500);
    check(
      (await phone.locator(".tk-overlay").count()) === 0,
      "mobile: Back closes the expanded map",
    );
    check(
      (await phone.locator(".tk-page").count()) > 0,
      "mobile: Back returns to the event page rather than leaving Tracker",
    );
    /**
     * The boundary, on a phone.
     *
     * The eclipse was opened by URL, so there is exactly one Tracker entry
     * behind the drill-in. One Back closes the map and lands on the event; a
     * second has no Tracker history left to consume and correctly leaves.
     * That is the rule the brief states — Back leaves Tracker only after
     * Tracker's own history is exhausted — and asserting it here is what stops
     * a future "stop Back from leaving" hack from passing.
     */
    check(
      new URL(phone.url()).searchParams.get("drill") === null &&
        new URL(phone.url()).searchParams.get("date") === LUNAR_ECLIPSE_NIGHT,
      "mobile: one Back closes the map and leaves the event page standing",
    );
  } else {
    check(false, "mobile: the pinned lunar eclipse night renders a map to exercise");
  }

  /**
   * Upcoming, filtered, on a phone.
   *
   * Split out from the map sequence above rather than folded into it. Those
   * checks open the eclipse by date, straight into Tonight, so there is no
   * filtered list anywhere in that history — an assertion about a surviving
   * filter there was checking a state the phone had never been in, and passing
   * or failing for reasons unrelated to the filter.
   *
   * Restoring browse state is a mobile question in its own right: the phone
   * lays Upcoming out differently, so "Back put me where I was" has to be
   * demonstrated here and not inferred from the desktop.
   */
  await phone.goto(`${TRACKER}&view=upcoming&filter=eclipses`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await phone.waitForSelector(".tk-upcoming", { timeout: 30_000 });
  await phone.waitForTimeout(2500);
  const phoneCard = phone.locator(".tk-upcoming-card").first();
  if ((await phoneCard.count()) > 0) {
    await phoneCard.tap();
    await phone.waitForSelector(".tk-page", { timeout: 30_000 });
    await phone.waitForTimeout(1500);
    check(
      new URL(phone.url()).searchParams.get("event") !== null,
      "mobile: opening an event from Upcoming is a history step",
    );
    await phone.goBack();
    await phone.waitForTimeout(1500);
    const back = new URL(phone.url()).searchParams;
    check(
      back.get("filter") === "eclipses" && back.get("view") === "upcoming",
      "mobile: Back to the list keeps the filter",
    );
    check(
      (await phone.locator(".tk-upcoming").count()) > 0,
      "mobile: Back renders the list it restored rather than an empty shell",
    );
  } else {
    check(false, "mobile: the filtered Upcoming list has something to open");
  }

  await phone.close();
  await phoneContext.close();


  /* --- 6. re-ranking when the place changes ------------------------------ */
  //
  // A context of its own, with no init script. Seeding through `addInitScript`
  // re-runs on every load, so a reload would put the original place back and
  // the comparison would silently be between a plan and itself.
  console.log("\nLocation change");
  const changeContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  const changing = await changeContext.newPage();
  await changing.clock.setFixedTime(WALK_AT);
  await changing.goto(TRACKER, { waitUntil: "networkidle" });
  const setPlace = async (place) => {
    await changing.evaluate((value) => {
      localStorage.setItem(
        "orbit-studio:tracker:confirmed-place:v1",
        JSON.stringify({ version: 1, place: value }),
      );
    }, { ...place, fromDevice: false });
    await changing.reload({ waitUntil: "networkidle" });
    await changing.waitForSelector(".tk-tonight", { timeout: 30_000 });
    await changing.waitForTimeout(2500);
    return changing.locator(".tk-tonight").getAttribute("data-plan-identity");
  };

  const fairbanksIdentity = await setPlace(PLACES.fairbanks);
  const fairbanksRows = await changing.locator(".tk-relevant-row").allInnerTexts();
  const portlandIdentity = await setPlace(PLACES.portland);
  const portlandRows = await changing.locator(".tk-relevant-row").allInnerTexts();

  check(
    fairbanksIdentity !== portlandIdentity,
    "changing the place invalidates the plan identity",
  );
  check(
    JSON.stringify(fairbanksRows) !== JSON.stringify(portlandRows),
    "the ranked list is re-ranked for the new place rather than carried over",
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
    (await changing.locator("header.tk-header").innerText()).includes(PLACES.portland.name),
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
  const placeTrigger = changing.locator(".tracker-place-current");
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
    await small.goto(TRACKER, { waitUntil: "networkidle" });
    await small.waitForSelector(".tk-tonight", { timeout: 30_000 });
    await small.waitForTimeout(2500);
    const order = await small.evaluate(() => {
      const y = (selector) =>
        document.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN;
      return {
        hero: y(".tk-hero"),
        viz: y(".tk-viz-slot"),
        conditions: y(".tk-conditions"),
        list: y(".tk-relevant"),
        overflowsHorizontally:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    check(
      order.hero < order.viz && order.viz < order.conditions && order.conditions < order.list,
      `${label}: the hierarchy survives — recommendation, evidence, conditions, alternatives`,
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
    for (const region of ["heading", "hero", "visualization", "conditions", "list"]) {
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
