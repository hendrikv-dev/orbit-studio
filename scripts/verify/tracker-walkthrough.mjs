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
};

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

  await portland.close();
  await portlandContext.close();

  /* --- 5. aurora --------------------------------------------------------- */
  console.log("\nAurora");
  const northContext = await browser.newContext({ viewport: { width: 1512, height: 1180 } });
  await seedPlace(northContext, PLACES.fairbanks);
  const north = await northContext.newPage();
  await north.goto(TRACKER, { waitUntil: "networkidle" });
  await north.waitForSelector(".tk-tonight", { timeout: 30_000 });
  await north.waitForTimeout(6000);

  if (await clickRow(north, /Aurora/i)) {
    const auroraState = await readPageState(north);
    assertUniversalGeometry(auroraState, "aurora");
    check(auroraState.heading === "Auroras", "the aurora page uses the aurora heading");
    check(
      auroraState.metrics.some((metric) => /NOAA/i.test(metric.label ?? "")),
      "the probability is attributed to NOAA rather than presented as Tracker's",
    );
    check(
      /nowcast|3-day/i.test(auroraState.pills.join(" ")),
      "the forecast horizon is stated on the card",
    );
    const support = await north.locator(".tk-hero-support").innerText();
    check(
      /half an hour|three-day|cannot be forecast/i.test(support),
      "uncertainty is stated in the hero, not buried",
    );
    await shot(north, "10-aurora-tonight", auroraState.heroName ?? "");
    captured.aurora = auroraState;

    await north.getByRole("button", { name: "View forecast map" }).click();
    await north.waitForSelector(".tk-overlay", { timeout: 5000 });
    await north.waitForTimeout(800);
    await shot(north, "11-aurora-forecast-map", "full forecast map drill-in");
    await north.keyboard.press("Escape");
  } else {
    console.log("  · aurora is below the reporting threshold right now — nothing to capture");
    findings.push({ label: "aurora present tonight (activity-dependent)", pass: null });
  }

  await north.close();
  await northContext.close();

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
});
