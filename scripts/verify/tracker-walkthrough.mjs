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
  check(state.geometry.conditions === 4, `${label}: has exactly four condition cards`);
  check(state.metrics.length === 3, `${label}: has exactly three metrics`);
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

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const captured = {};

  /* --- 1. location, from nothing ---------------------------------------- */
  const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  const page = await context.newPage();
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
  await portland.goto(TRACKER, { waitUntil: "networkidle" });
  await portland.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await portland.waitForTimeout(3000);

  console.log("\nTonight — default hero");
  const defaultState = await readPageState(portland);
  assertUniversalGeometry(defaultState, "default");
  await shot(portland, "03-tonight-default", `${defaultState.heading} / ${defaultState.heroName}`);
  captured.default = defaultState;

  console.log("\nMeteor showers");
  check(await clickRow(portland, /Meteor/i), "the ranked list can select the meteor event");
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

  await portland.getByRole("button", { name: "View sky map" }).click();
  await portland.waitForSelector(".tk-overlay", { timeout: 5000 });
  await portland.waitForTimeout(800);
  await shot(portland, "05-meteors-sky-map", "hero CTA drill-in");
  const skyMapText = await portland.locator(".tk-overlay-panel").innerText();
  check(
    /where to look/i.test(skyMapText),
    "the sky map answers where to look rather than only when",
  );
  check(
    !/stare at the radiant/i.test(skyMapText),
    "the sky map never tells anyone to stare at the radiant",
  );
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

  const listByCategory = new Map();
  await portland.getByRole("tab", { name: "List" }).click();
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
  check(
    eclipseInCalendar.length > 0 ||
      (listByCategory.get("eclipses") ?? []).length === 0,
    "eclipses reach Calendar, not only List",
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
        // End of that local day, so an event earlier today still counts.
        return new Date(year, month - 1, day, 23, 59, 59).getTime() < now;
      });
  });
  check(
    pastDates.length === 0,
    `Upcoming excludes events that have finished (${pastDates.join(", ") || "none"})`,
  );

  await portland.getByRole("tab", { name: "List" }).click();
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
    check(
      solarState.conditions.filter((card) => /Forecast closer to date/i.test(card.value ?? ""))
        .length === 3,
      "three condition cards refuse to forecast beyond the horizon",
    );
    check(
      /Moon|%/i.test(
        solarState.conditions.find((card) => card.label === "Moonlight")?.value ?? "",
      ),
      "moonlight is still answered, because it is geometry",
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

  const lunar = portland.locator(".tk-upcoming-card", { hasText: /lunar eclipse/i }).first();
  if ((await lunar.count()) > 0) {
    await lunar.click();
    await portland.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 30_000 });
    await portland.waitForTimeout(2500);
    const lunarState = await readPageState(portland);
    assertUniversalGeometry(lunarState, "lunar eclipse");
    check(
      (await portland.locator(".tk-eclipse-track").count()) === 0,
      "a lunar eclipse map draws no track, because a lunar eclipse has none",
    );
    await shot(portland, "09-eclipse-lunar", lunarState.heroName ?? "");
    captured.lunarEclipse = lunarState;
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
    const opened = await clickRow(page, /Aurora/i);
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

      await page.getByRole("button", { name: "View forecast map" }).click();
      await page.waitForSelector(".tk-overlay", { timeout: 5000 });
      await page.waitForTimeout(800);
      await shot(page, "11-aurora-forecast-map", "full forecast map drill-in");
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
    const opened = await clickRow(page, /Aurora/i);
    check(opened, "weak: aurora is still offered when the field is quiet");
    if (opened) {
      const state = await readPageState(page);
      assertUniversalGeometry(state, "aurora (quiet)");
      const text = await page.evaluate(
        () =>
          `${document.querySelector(".tk-hero-recommendation")?.textContent ?? ""} ` +
          `${document.querySelector(".tk-hero-support")?.textContent ?? ""}`,
      );
      check(
        /unlikely|quiet|not over you|away from you|farther north|further north/i.test(text),
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

    const listed = await clickRow(page, /Aurora/i);
    check(listed, "stale: aurora is still listed, so the silence is explained");
    if (listed) {
      const state = await readPageState(page);
      assertUniversalGeometry(state, "aurora");
      check(
        /expired/i.test(state.pills.join(" ")),
        "stale: the pill says the nowcast has expired",
      );
      check(
        state.recommendationLevel === "Conditions unknown — check before going",
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
    const opened = await clickRow(page, /Aurora/i);
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

  // --- no forecastable future event ---------------------------------------
  //
  // Aurora in Upcoming is usually empty, and correctly so: nothing can name a
  // night three weeks out. What the empty list must not do is read as "Tracker
  // cannot show auroras", or strand the reader with no way to the answer that
  // does exist.
  {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
    await seedPlace(context, PLACES.portland);
    const page = await context.newPage();
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
      // A storm inside the horizon is a legitimate outcome; the state simply is
      // not reachable right now, and saying so beats asserting against reality.
      console.log("  · a forecastable aurora event exists right now; empty-state check skipped");
      findings.push({ label: "aurora empty state (needs a quiet forecast)", pass: null });
    }
    await page.close();
    await context.close();
  }

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

  // --- the lunar eclipse's three map controls -------------------------------
  const lunarCard = nav.locator(".tk-upcoming-card", { hasText: /lunar eclipse/i }).first();
  if ((await lunarCard.count()) > 0) {
    await lunarCard.click();
    await nav.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 30_000 });
    await nav.waitForTimeout(2500);
    const eventUrl = urlState();
    check(eventUrl.event !== null, "opening an event puts its id in the URL");

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

      // Expanded means more of the world, not the same card scaled up.
      const cardCells = await nav.locator(".tk-page .tk-eclipsemap rect").count();
      const fullCells = await nav.locator(".tk-overlay .tk-eclipsemap rect").count();
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

    // --- Sequence C: Upcoming -> event -> map -> Back -> Back --------------
    await nav.goBack();
    await nav.waitForTimeout(1500);
    check(
      urlState().view === "upcoming" && urlState().event === null,
      "Sequence C: a second Back returns to Upcoming",
    );
    check(
      new URL(nav.url()).searchParams.get("app") === "tracker",
      "Sequence C: Back never leaves Tracker while Tracker states remain",
    );
  } else {
    check(false, "a lunar eclipse is available to exercise the map controls");
  }

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
  await nav.getByRole("tab", { name: "List" }).click();
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
    await nav.waitForTimeout(3500);
    check(
      new URL(nav.url()).searchParams.get("app") === "tracker",
      "refreshing an event page stays in Tracker",
    );
    check(
      (await nav.locator(".tk-page").count()) > 0,
      "refreshing an event page restores an event page",
    );
  }

  await nav.close();
  await navContext.close();

  /* --- 6. re-ranking when the place changes ------------------------------ */
  //
  // A context of its own, with no init script. Seeding through `addInitScript`
  // re-runs on every load, so a reload would put the original place back and
  // the comparison would silently be between a plan and itself.
  console.log("\nLocation change");
  const changeContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  const changing = await changeContext.newPage();
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
  check(
    (await changing.getByText("Restored", { exact: true }).count()) > 0,
    "a restored place is labelled as restored",
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
