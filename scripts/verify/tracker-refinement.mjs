/**
 * Focused checks for the map-first refinement pass.
 *
 * Deliberately not a rewrite of the walkthrough. That suite was written against
 * the destination-era product and still carries most of its value; this covers
 * only what the refinement changed, so a regression in the new behaviour is
 * caught without waiting on a decision about the old suite.
 *
 * Runs against a preview server, and starts one if nothing is listening.
 */
import { chromium } from "playwright";
import { preview } from "vite";
import {
  PORTLAND,
  SATELLITE_CLOCK,
  seedPlace,
  stubCloudForecast,
  stubCloudMask,
  stubTracker,
} from "./tracker-fixtures.mjs";

const ORIGIN = process.argv[2] ?? "http://127.0.0.1:4181";
const TRACKER = `${ORIGIN}/?app=tracker`;

const failures = [];
const passes = [];
function check(condition, label) {
  if (condition) {
    passes.push(label);
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}



/** The gate always wants the empty basemap; only the orbits vary. */
async function stub(context, { basemap = true, satellites = "unavailable" } = {}) {
  await stubTracker(context, { basemap: basemap ? "empty" : "live", satellites });
}

/**
 * Where the expanded card sits inside the part of the rail that can be seen.
 *
 * The usable viewport is not the strip: the map's zoom and locate buttons float
 * over its right-hand end, and a card reaching under them is not visible however
 * much of it is inside the scroller. Measured the same way the component
 * measures it, so the gate is checking the rule rather than a restatement of it.
 */
async function railFraming(page) {
  return page.evaluate(() => {
    const strip = document.querySelector(".tk-rail-scroll");
    const card = document.querySelector('.tk-rail-card[data-expanded="true"]');
    if (!strip || !card) return null;
    const box = strip.getBoundingClientRect();
    const controls = document.querySelector(".tk-map-controls-view");
    const over = controls?.getBoundingClientRect();
    const overlaps =
      over &&
      over.left < box.right &&
      over.right > box.left &&
      over.top < box.bottom &&
      over.bottom > box.top;
    const right = overlaps ? Math.min(box.right, over.left) : box.right;
    const rect = card.getBoundingClientRect();
    return {
      name: card.querySelector(".tk-rail-card-name")?.textContent?.trim() ?? "",
      clippedLeft: Math.round(Math.max(0, box.left - rect.left)),
      clippedRight: Math.round(Math.max(0, rect.right - right)),
      scrollLeft: Math.round(strip.scrollLeft),
      maxScroll: Math.round(strip.scrollWidth - strip.clientWidth),
    };
  });
}

const seed = (context, place = PORTLAND) => seedPlace(context, place);

/**
 * Luma statistics for a strip of what is actually on screen.
 *
 * Not read from the GL canvas. MapLibre runs with `preserveDrawingBuffer`
 * off — which is the right setting, it is what keeps the map cheap — and
 * reading that canvas from script returns an empty image, so a check written
 * that way reports "no contrast" and "no map" whatever is really drawn. The
 * screenshot is taken by the browser itself and handed back in through an
 * ordinary 2D canvas, which has no such problem.
 */
async function sampleStrip(page, clip) {
  const shot = await page.screenshot({ clip });
  const dataUrl = `data:image/png;base64,${shot.toString("base64")}`;
  return page.evaluate(
    (url) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const { data } = ctx.getImageData(0, 0, image.width, image.height);
          const columns = [];
          for (let x = 0; x < image.width; x += 1) {
            let sum = 0;
            for (let y = 0; y < image.height; y += 1) {
              const i = (y * image.width + x) * 4;
              sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            }
            columns.push(sum / image.height);
          }
          // Channel means as well as luma: the cloud ramp encodes its direction
          // in red-versus-green, and a luma-only reading cannot see that.
          let red = 0;
          let green = 0;
          for (let i = 0; i < data.length; i += 4) {
            red += data[i];
            green += data[i + 1];
          }
          const pixels = data.length / 4;
          resolve({
            width: image.width,
            min: Math.min(...columns),
            max: Math.max(...columns),
            columns,
            red: red / pixels,
            green: green / pixels,
          });
        };
        image.onerror = reject;
        image.src = url;
      }),
    dataUrl,
  );
}

const settled = (page, ms = 1200) =>
  page
    .waitForSelector('.tk-map-canvas[data-map-settled="true"]', { timeout: 60_000 })
    .then(() => page.waitForTimeout(ms));

/**
 * Open the two places a reading now lives.
 *
 * The location panel used to render every reading in one stack, so a gate could
 * assert on them from the map. The rail replaced that panel and the readings
 * moved to where each one is actually about something: a layer's reading sits
 * under the switch that turned the layer on, and an event's reading sits in
 * that event's own card. Both are therefore one deliberate press away, which is
 * what these two helpers perform.
 */
/**
 * Close the layer panel again.
 *
 * It now opens along the map's right edge rather than dropping from the top
 * bar, so a panel left open covers controls a later step wants to click. A
 * reader closes it; so does this.
 */
async function closeLayerPanel(page) {
  if ((await page.locator(".tk-layers-panel").count()) === 0) return;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}

/**
 * Close the onboarding tour, which is anchored over the top-left controls.
 *
 * Seeding "seen" in localStorage does not work here: the tour decides whether
 * to run after the map settles, and the harness's init script runs before that.
 * Pressing its own close button is what a reader does, and it is what leaves
 * the interface in the state the checks are about.
 */
async function dismissTour(page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const close = page
      .locator(".tk-callout button[aria-label*='lose'], .tk-callout button:has-text('Done')")
      .first();
    if ((await close.count()) === 0) break;
    await close.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

async function openLayerPanel(page) {
  if ((await page.locator(".tk-layers-panel").count()) === 0) {
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 10_000 });
  }
}

async function openEventReading(page) {
  await page.waitForSelector(".tk-rail-card", { timeout: 45_000 });
  // The reading belongs to the selected event's own card, so opening whichever
  // card happens to be first would usually open the wrong one. Selecting an
  // event puts its card id in the URL; that is the card to open.
  const wanted = await page.evaluate(() => new URLSearchParams(location.search).get("card"));
  const target = wanted
    ? page.locator(`.tk-rail-card[data-card="${wanted}"]`)
    : page.locator(".tk-rail-card").first();
  if ((await target.count()) > 0) {
    if ((await target.getAttribute("data-expanded")) !== "true") {
      await target.locator(".tk-rail-card-head").click();
    }
    await page.waitForTimeout(700);
    if ((await page.locator(".tk-map-event-reading").count()) > 0) return true;
  }
  // No card for it here: the event is drawn but not observable from this place,
  // and the reading falls back to the layers menu beside the event's name.
  await openLayerPanel(page);
  await page.waitForTimeout(400);
  // Left open: the caller reads the reading out of it.
  return (await page.locator(".tk-map-event-reading").count()) > 0;
}

async function main() {
  let server = null;
  const listening = await fetch(ORIGIN).then(() => true).catch(() => false);
  if (!listening) {
    server = await preview({
      root: process.cwd(),
      preview: { host: "127.0.0.1", port: Number(new URL(ORIGIN).port), strictPort: true },
    });
  }
  const browser = await chromium.launch();

  /* --- world wrap ------------------------------------------------------- */
  console.log("\nWorld wrap");
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=0,170&z=2&layers=twilight`, { waitUntil: "domcontentloaded" });
    await settled(page, 2500);

    const surface = await page.locator(".tk-map-surface").boundingBox();
    const drag = async (dx) => {
      await page.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2);
      await page.mouse.down();
      await page.mouse.move(surface.x + surface.width / 2 + dx, surface.y + surface.height / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(350);
    };

    // East, past the antimeridian and well beyond.
    for (let i = 0; i < 8; i += 1) await drag(-420);
    await page.waitForTimeout(1500);
    const east = await page.evaluate(() => new URLSearchParams(location.search).get("at"));
    const eastLon = Number(east.split(",")[1]);
    check(
      Number.isFinite(eastLon) && Math.abs(eastLon) <= 180.001,
      `panning east keeps the stored longitude in range (${eastLon})`,
    );

    // West, all the way back and past the other side.
    for (let i = 0; i < 16; i += 1) await drag(420);
    await page.waitForTimeout(1500);
    const west = await page.evaluate(() => new URLSearchParams(location.search).get("at"));
    const westLon = Number(west.split(",")[1]);
    check(
      Number.isFinite(westLon) && Math.abs(westLon) <= 180.001,
      `panning west keeps the stored longitude in range (${westLon})`,
    );

    /**
     * The camera comes to rest — which is the thing that can actually regress.
     *
     * This began as a one-shot read of `data-map-settled` a fixed sleep after
     * the last drag, and it flickered between pass and fail on identical
     * builds. Instrumenting it showed why: the camera is already still, and
     * what is outstanding is `areTilesLoaded()` — basemap tiles queued by two
     * dozen rapid world-scale pans, answered by a public tile service whose
     * latency is not this project's to control. Measured settle times across
     * runs ranged from two seconds to over twenty, with the camera motionless
     * throughout.
     *
     * The regression this test exists for is a camera that re-clamps itself
     * every frame and therefore never idles at all — which was a real defect
     * once, when world copies were disabled at low zoom. That is a question
     * about `isMoving`, and it is answered immediately and deterministically.
     * The settled flag is still checked, with a budget generous enough to be
     * about the map rather than about a CDN.
     */
    const still = await page.evaluate(() => {
      const m = window.__trackerMap;
      return !m.isMoving() && !m.isZooming() && !m.isRotating();
    });
    check(still, "the camera comes to rest after crossing the antimeridian repeatedly");

    const settledAt = Date.now();
    const reachedRest = await page
      .waitForSelector('.tk-map-canvas[data-map-settled="true"]', { timeout: 45_000 })
      .then(() => true, () => false);
    check(
      reachedRest,
      `and the map reports itself settled once its tiles arrive (${Date.now() - settledAt}ms)`,
    );

    await context.close();
  }

  /**
   * No hard edge at the antimeridian.
   *
   * The one check here that needs the real basemap: a style's `background`
   * layer fills the viewport whether or not the world repeats, so a stubbed
   * style cannot tell a wrapped map from a truncated one. Real geography can —
   * either the coastlines continue past the seam or there is a flat band where
   * they stop. Skipped rather than failed when the tile service is unreachable,
   * because that is a fact about the network and not about Tracker.
   */
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 600 } });
    await seed(context);
    const page = await context.newPage();
    let tiles = 0;
    page.on("response", (response) => {
      if (/openfreemap/.test(response.url()) && response.status() === 200) tiles += 1;
    });
    /**
     * Driven to the seam rather than linked to it.
     *
     * `&at=10,180&z=3` does not get there: a reader with a confirmed place
     * lands on that place, which is the right product behaviour and meant this
     * check spent a long time measuring Portland at zoom eight and passing or
     * failing on how much terrain detail happened to have loaded. Moving the
     * camera after the page settles is what actually puts the antimeridian in
     * front of it.
     */
    await page.goto(TRACKER, { waitUntil: "domcontentloaded" });
    await settled(page, 6000);
    /**
     * The Aleutians, not the open Pacific.
     *
     * The check reads a truncated world as a run of columns that do not vary,
     * so it needs geography either side of the seam to vary. At ten degrees
     * north the antimeridian runs through two thousand kilometres of empty
     * ocean, which is featureless whether or not the map wraps — the check was
     * measuring the sea and calling it a hard edge. At fifty-two degrees it has
     * Kamchatka on one side and Alaska on the other.
     */
    await page.evaluate(() => window.__trackerMap?.jumpTo({ center: [180, 52], zoom: 3 }));
    await settled(page, 8000);
    const arrived = await page.evaluate(() => {
      const map = window.__trackerMap;
      return map ? Math.round(((map.getCenter().lng % 360) + 540) % 360 - 180) : null;
    });
    check(arrived === 180 || arrived === -180, `the camera reached the antimeridian (${arrived})`);
    if (tiles < 3) {
      console.log("  · skipped: the tile service did not respond, so the seam cannot be judged");
    } else {
      /**
       * What a truncated world actually looks like.
       *
       * The shell's own background, showing through where the map has run out.
       * This used to be tested as "a run of columns that do not vary", which
       * assumed geography either side of the seam to vary — and the
       * antimeridian is mostly ocean, which is featureless whether the map
       * wraps or not. Measured against the shell colour instead, the two states
       * separate completely: nothing matches it when the world repeats, and
       * hundreds of columns do when it does not.
       */
      const backgroundRun = async () => {
        const shot = await page.screenshot({ clip: { x: 0, y: 260, width: 1200, height: 80 } });
        return page.evaluate(
          (url) =>
            new Promise((resolve) => {
              const shell = document.querySelector(".tk-map-shell") ?? document.body;
              const parsed = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(
                getComputedStyle(shell).backgroundColor,
              );
              const target = parsed
                ? [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])]
                : [0, 0, 0];
              const image = new Image();
              image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context2d = canvas.getContext("2d");
                context2d.drawImage(image, 0, 0);
                const { data } = context2d.getImageData(0, 0, canvas.width, canvas.height);
                let run = 0;
                let longest = 0;
                for (let x = 0; x < canvas.width; x += 1) {
                  let r = 0;
                  let g = 0;
                  let b = 0;
                  for (let y = 0; y < canvas.height; y += 1) {
                    const at = (y * canvas.width + x) * 4;
                    r += data[at];
                    g += data[at + 1];
                    b += data[at + 2];
                  }
                  const near =
                    Math.abs(r / canvas.height - target[0]) +
                      Math.abs(g / canvas.height - target[1]) +
                      Math.abs(b / canvas.height - target[2]) <
                    12;
                  run = near ? run + 1 : 0;
                  longest = Math.max(longest, run);
                }
                resolve(longest);
              };
              image.src = url;
            }),
          `data:image/png;base64,${shot.toString("base64")}`,
        );
      };

      const wrapped = await backgroundRun();
      check(wrapped < 40, `the world repeats across the antimeridian (${wrapped}px of shell showing)`);

      /**
       * And the check can still fail, which is the other half of trusting it.
       *
       * Turning world copies off is the regression this exists for — it shipped
       * once. If the measurement cannot see the difference it is not guarding
       * anything, so it is made to look at both states before the map is put
       * back the way the product has it.
       */
      await page.evaluate(() => window.__trackerMap?.setRenderWorldCopies(false));
      await settled(page, 8000);
      const truncated = await backgroundRun();
      check(
        truncated > wrapped + 100,
        `and a truncated world would be caught (${truncated}px of shell showing without world copies)`,
      );
      await page.evaluate(() => window.__trackerMap?.setRenderWorldCopies(true));
    }

    await context.close();
  }

  /* --- place identity --------------------------------------------------- */
  console.log("\nPlace identity");
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await stub(context);
    const page = await context.newPage();
    await page.goto(TRACKER, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);

    await page.locator(".tk-map-topbar .tracker-place-current").click();
    await page.waitForSelector(".tracker-place-panel", { timeout: 10_000 });
    const input = page.locator(".tracker-place-search input");
    await input.click();
    await input.fill("Wood Village, Oregon");
    await page.waitForSelector('[role="option"]', { timeout: 20_000 });
    const chosen = (await page.locator('[role="option"]').first().innerText()).split("\n")[0].trim();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".tk-rail", { timeout: 30_000 });
    // Long enough for a reverse lookup to have come back and overwritten it.
    await page.waitForTimeout(6000);
    // The top bar names the place and then qualifies it — "Wood Village" over
    // "Multnomah, Oregon, United States" — so the name is the first line.
    const shown = (await page.locator(".tk-map-topbar-lead .tracker-place-current").innerText())
      .split("\n")[0];
    check(
      shown.trim() === chosen,
      `a searched place keeps the name the reader chose (chose "${chosen}", the map says "${shown.trim()}")`,
    );

    // A bare map click is the case reverse geocoding is for.
    const surface = await page.locator(".tk-map-surface").boundingBox();
    await page.mouse.click(surface.x + surface.width * 0.62, surface.y + surface.height * 0.42);
    await page.waitForTimeout(6000);
    const clicked = await page.locator(".tk-map-topbar-lead .tracker-place-current").innerText();
    check(clicked.trim() !== shown.trim(), `clicking elsewhere adopts that point's own context ("${clicked.trim()}")`);

    // Mid-ocean: nothing near enough to name, so coordinates.
    await page.goto(`${TRACKER}&pin=-32.5,-140.2&at=-32.5,-140.2&z=4`, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);
    await page.waitForTimeout(6000);
    const ocean = await page.locator(".tk-map-topbar-lead .tracker-place-current").innerText();
    check(/[NS].*[EW]|°/.test(ocean), `an unresolved point falls back to coordinates ("${ocean.trim()}")`);
    await context.close();
  }

  /* --- date ------------------------------------------------------------- */
  console.log("\nDate");
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=9`, { waitUntil: "domcontentloaded" });
    await settled(page, 2000);

    const viewportOf = () => page.evaluate(() => new URLSearchParams(location.search).get("at"));
    const pinOf = () => page.evaluate(() => new URLSearchParams(location.search).get("pin"));
    const before = { at: await viewportOf(), pin: await pinOf() };

    await page.click('[aria-label="Next night"]');
    await page.waitForTimeout(2500);
    check(
      (await page.evaluate(() => new URLSearchParams(location.search).get("date"))) !== null,
      "the next-night arrow moves the date",
    );
    check((await viewportOf()) === before.at, "changing the date leaves the viewport alone");
    check((await pinOf()) === before.pin, "changing the date leaves the selected place alone");

    await page.click('[aria-label="Previous night"]');
    await page.waitForTimeout(2000);
    check(
      (await page.evaluate(() => new URLSearchParams(location.search).get("date"))) === null,
      "stepping back to today drops the date from the URL",
    );

    await page.click('[aria-label="Next night"]');
    await page.waitForTimeout(2000);
    await page.locator(".tk-date-today").click();
    await page.waitForTimeout(2000);
    check(
      (await page.evaluate(() => new URLSearchParams(location.search).get("date"))) === null,
      "Today returns to the reader's own tonight",
    );
    check(
      (await page.locator(".tk-date-label").innerText()).startsWith("Today"),
      "and the control says so",
    );
    check(
      (await page.locator(".tk-map-shell .tracker-nav").count()) === 0,
      "there are no Tonight/Upcoming tabs on the map",
    );
    check(
      (await page.evaluate(() => new URLSearchParams(location.search).get("mode"))) === null,
      "the URL no longer carries a view mode",
    );
    await context.close();
  }

  /* --- detail ----------------------------------------------------------- */
  console.log("\nDetail");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=9&date=2026-09-12&layers=twilight`, { waitUntil: "domcontentloaded" });
    await settled(page, 2000);

    await page.waitForSelector(".tk-rail-card", { timeout: 60_000 });
    if ((await page.locator('.tk-rail-card[data-expanded="true"]').count()) === 0) {
      await page.locator(".tk-rail-card .tk-rail-card-head").first().click();
      await page.waitForTimeout(600);
    }
    // Captured with the card already open, because which card is open is part
    // of the map state Back has to restore. Reading it before the expansion
    // would be asking Back to return to a screen that was never left.
    const before = await page.evaluate(() => location.search);
    const action = page.locator(".tk-rail-details").first();
    await action.waitFor({ timeout: 60_000 });
    check(
      (await action.locator("svg.lucide-external-link").count()) === 0,
      "View details does not use an external-link icon",
    );
    await action.click();
    await page.waitForSelector(".tracker-hero .tk-hero-name", { timeout: 45_000 });
    await page.waitForTimeout(2500);

    const heading = await page.locator(".tk-page-heading").innerText();
    check(!/tonight/i.test(heading), `the category heading is date-aware ("${heading.replace(/\n+/g, " / ")}")`);
    /**
     * One ranking, and it is the rail's.
     *
     * The detail page used to carry a second cross-event list — "Best
     * tonight", with a grade on every row — running beside the rail the reader
     * had just chosen this event *from*. Two rankings of one night is exactly
     * the disagreement this project keeps carefully in step elsewhere, and the
     * page's job is the one event.
     */
    check(
      (await page.locator(".tk-map-detail .tk-relevant, .tk-map-detail .tk-relevant-row").count()) === 0,
      "the detail page carries no second ranking of the night",
    );

    /**
     * One left edge for the whole page.
     *
     * The way back used to be a pill positioned over the top-left corner, and
     * the heading was pushed 168 pixels clear of it to avoid a collision — so
     * the title alone stood a hundred and sixty-eight pixels right of the hero,
     * the conditions and everything else, and the number was the width of one
     * particular English label.
     */
    const edges = await page.evaluate(() => {
      const left = (selector) => {
        const element = document.querySelector(selector);
        return element ? Math.round(element.getBoundingClientRect().left) : null;
      };
      return {
        back: left(".tk-map-detail .tk-back"),
        heading: left(".tk-page-heading h1"),
        subtitle: left(".tk-page-heading p"),
        hero: left(".tracker-hero"),
        conditions: left(".tk-conditions-row, .tk-conditions"),
      };
    });
    const distinct = [...new Set(Object.values(edges).filter((value) => value !== null))];
    check(
      distinct.length === 1,
      `back, heading, subtitle, hero and conditions share one left edge (${JSON.stringify(edges)})`,
    );

    await page.goBack();
    await page.waitForSelector(".tk-rail", { timeout: 30_000 });
    await page.waitForTimeout(2000);
    check((await page.evaluate(() => location.search)) === before, "Back restores the exact map state");

    /**
     * "Back to the map" is a destination, not a step backwards.
     *
     * The reader drills in, then does several things that each push an entry —
     * changes the date twice, opens a different event from the ranked list.
     * One press of the in-product control has to land on the map they came
     * from. Implemented as `history.back()` it landed on the same event page
     * with an older date, which is a different promise entirely.
     */
    const mapState = await page.evaluate(() => location.search);
    if ((await page.locator('.tk-rail-card[data-expanded="true"]').count()) === 0) {
      await page.locator(".tk-rail-card .tk-rail-card-head").first().click();
    }
    await page.locator(".tk-rail-details").first().click();
    await page.waitForSelector(".tracker-hero .tk-hero-name", { timeout: 45_000 });
    await page.waitForTimeout(2000);

    let pushed = 0;
    for (const label of ["Next night", "Next night"]) {
      const control = page.locator(`.tk-map-detail [aria-label="${label}"]`);
      if ((await control.count()) > 0) {
        await control.first().click();
        await page.waitForTimeout(2000);
        pushed += 1;
      }
    }
    /**
     * The list this used to click is gone, so the drill-in is the push.
     *
     * It opens as a dialog over the page, and the point of the check below is
     * that one press of "Back to the map" crosses *every* entry laid down
     * since — so the dialog is dismissed first, which is itself another entry,
     * and the reader is left on the detail page with three behind them.
     */
    const drill = page.locator(".tk-map-detail .tk-hero-actions button").nth(0);
    if ((await drill.count()) > 0) {
      await drill.click();
      await page.waitForSelector(".tk-overlay", { timeout: 15_000 });
      await page.waitForTimeout(1500);
      pushed += 1;
      await page.keyboard.press("Escape");
      await page.waitForSelector(".tk-overlay", { state: "detached", timeout: 15_000 });
      await page.waitForTimeout(1200);
      pushed += 1;
    }
    check(pushed > 0, `intervening history entries were laid down (${pushed})`);
    check(
      (await page.evaluate(() => location.search)) !== mapState,
      "and they moved the URL away from the map state",
    );

    await page.locator(".tk-map-detail .tk-back").click();
    await page.waitForSelector(".tk-rail", { timeout: 30_000 });
    await page.waitForTimeout(2500);
    check(
      (await page.evaluate(() => location.search)) === mapState,
      "one press of Back to the map returns to the exact map state it was opened from",
    );
    check(
      (await page.locator(".tracker-hero .tk-hero-name").count()) === 0,
      "and the event page is gone rather than one step less deep",
    );
    await context.close();
  }

  /* --- aurora and day/night --------------------------------------------- */
  console.log("\nOverlays");
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=64,-30&z=3&layers=aurora`, { waitUntil: "domcontentloaded" });
    await settled(page, 4000);
    const aurora = await page.evaluate(() => {
      const map = document.querySelector(".maplibregl-canvas");
      return { hasImageLayer: Boolean(map) };
    });
    check(aurora.hasImageLayer, "the aurora layer renders");
    await openLayerPanel(page);
    // The reading arrives with the nowcast fetch, so this waits for it rather
    // than counting after a fixed sleep — the same race that made the
    // antimeridian check flicker between pass and fail on identical builds.
    const reading = await page
      .waitForSelector(".tk-map-layer-value", { timeout: 20_000 })
      .then(() => true, () => false);
    check(reading, "the layer control reads the aurora value at the selected point");

    await page.goto(`${TRACKER}&at=20,-30&z=2&layers=twilight`, { waitUntil: "domcontentloaded" });
    await settled(page, 4000);
    /**
     * Day and night have to differ enough to see.
     *
     * A band across the middle of the map, from the screenshot rather than from
     * the GL canvas. The threshold is deliberately modest: this map stays dark
     * on both sides by design, and the requirement is that the difference is
     * findable in about a second, not that half the screen turns blue.
     */
    const strip = await sampleStrip(page, { x: 0, y: 300, width: 1200, height: 60 });
    const contrast = Math.round(strip.max - strip.min);
    check(contrast >= 5, `day and night differ visibly across the terminator (${contrast} levels of luma)`);
    await context.close();
  }

  /* --- mobile ----------------------------------------------------------- */
  console.log("\nMobile");
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=9`, { waitUntil: "domcontentloaded" });
    await settled(page, 2000);

    const topbar = await page.evaluate(() =>
      Math.round(document.querySelector(".tk-map-topbar").getBoundingClientRect().height),
    );
    check(topbar <= 110, `the top controls stay compact (${topbar}px of 844)`);
    const rows = await page.evaluate(() => {
      const tops = [".tk-map-topbar-lead", ".tk-map-topbar-centre", ".tk-map-topbar-end"].map((s) =>
        Math.round(document.querySelector(s).getBoundingClientRect().top),
      );
      return new Set(tops).size;
    });
    check(rows <= 2, `the top controls occupy at most two rows (${rows})`);

    const targets = await page.evaluate(() =>
      [...document.querySelectorAll(".tk-map-control, .tk-map-layer-chip, .tk-date-step")].every(
        (el) => el.getBoundingClientRect().height >= 32,
      ),
    );
    check(targets, "no touch target was shrunk below 32px to make room");

    check(
      await page.locator(".tk-rail-card").first().isVisible(),
      "the rail still shows the top observing answer",
    );
    check(await page.locator(".tk-map-target").isVisible(), "the selected-location target stays visible");

    const clearOf = async () =>
      page.evaluate(() => {
        const controls = document.querySelector(".tk-map-controls-view").getBoundingClientRect();
        const rail = document.querySelector(".tk-rail").getBoundingClientRect();
        return controls.bottom <= rail.top + 2;
      });
    check(await clearOf(), "the controls clear the resting rail");

    /**
     * Expanding a card must not move the controls, or cover them.
     *
     * This used to assert that the controls sat entirely above the rail, and
     * the way that was kept true was by sliding the whole stack up as the rail
     * grew — two hundred and forty pixels on a phone, on the one interaction
     * where a reader most wants Layers and zoom to stay where they were. The
     * controls hold their position now and the card is capped so it stops short
     * of them, so what has to be checked is the thing that actually matters:
     * they have not moved, they are still on screen, and nothing is over them.
     */
    const stackAt = () =>
      page.evaluate(() => {
        const controls = document.querySelector(".tk-map-controls-view").getBoundingClientRect();
        const card = document
          .querySelector('.tk-rail-card[data-expanded="true"]')
          ?.getBoundingClientRect();
        return {
          top: Math.round(controls.top),
          left: Math.round(controls.left),
          bottom: Math.round(controls.bottom),
          onScreen: controls.top >= 0 && controls.bottom <= window.innerHeight,
          cardRight: card ? Math.round(card.right) : null,
        };
      });
    const before = await stackAt();
    await page.click(".tk-rail-card .tk-rail-card-head");
    await page.waitForTimeout(1400);
    const after = await stackAt();
    check(
      after.top === before.top,
      `expanding a card does not move the controls (${before.top} → ${after.top})`,
    );
    check(after.onScreen, "and leaves them on screen");
    check(
      after.cardRight !== null && after.cardRight <= after.left,
      `and the card stops short of them (${after.cardRight} vs ${after.left})`,
    );
    check(
      await page.locator(".tk-layers-trigger").isVisible(),
      "the layer control stays reachable with a card open",
    );
    await context.close();
  }

  /* --- event discovery -------------------------------------------------- */
  console.log("\nEvent discovery");
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=25,20&z=3`, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);

    const find = async (query) => {
      // The layer panel opens along the right edge now and can sit over the
      // finder, so anything left open from a previous read is closed first.
      await closeLayerPanel(page);
      const trigger = page.locator(".tk-eventfinder-trigger, .tk-eventfinder-current").first();
      await trigger.click();
      const field = page.locator(".tk-eventfinder-field input");
      await field.fill(query);
      await page.waitForSelector(".tk-eventfinder-results button", { timeout: 15_000 });
      const first = await page.locator(".tk-eventfinder-results button").first().innerText();
      await page.locator(".tk-eventfinder-results button").first().click();
      await page.waitForTimeout(9000);
      return first.split("\n")[0];
    };

    // --- solar -----------------------------------------------------------
    const solar = await find("next solar eclipse");
    check(/solar eclipse/i.test(solar), `searching finds a solar eclipse ("${solar}")`);
    const solarState = await page.evaluate(() => ({
      show: new URLSearchParams(location.search).get("show"),
      date: new URLSearchParams(location.search).get("date"),
      label: document.querySelector(".tk-date-label")?.textContent,
    }));
    check(
      solarState.show?.startsWith("solar-eclipse") === true,
      "choosing it selects the event on the map",
    );
    check(
      solarState.date !== null && solarState.date === solarState.show?.replace("solar-eclipse-", ""),
      `and moves the date to the eclipse's own day (${solarState.date})`,
    );
    await openEventReading(page);
    check(
      (await page.locator(".tk-map-event-reading").count()) === 1,
      "the panel reports what the eclipse does at the selected point",
    );

    /**
     * The path, drawn as geometry rather than as a gradient.
     *
     * A solar eclipse lands on the ground and the band has edges you can stand
     * either side of, so it is a real line on the map and not a smear of
     * colour — that distinction is the point of the overlay architecture.
     */
    const eclipseLayers = await page.evaluate(() =>
      ["tracker-eclipse-path-band", "tracker-eclipse-path-centre", "tracker-event-1"].map((id) =>
        Boolean(document.querySelector(".maplibregl-canvas")) && id,
      ),
    );
    check(eclipseLayers.length === 3, "the eclipse draws a band, a centre line and a coverage field");

    // Inside the path versus far outside it: the same event, different answers.
    const readAt = async (lat, lon) => {
      const url = new URL(page.url());
      url.searchParams.set("pin", `${lat},${lon}`);
      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await settled(page, 1500);
      await page.waitForTimeout(6000);
      await openEventReading(page);
      return page.evaluate(() => ({
        value: document.querySelector(".tk-map-event-value")?.textContent ?? null,
        facts: [...document.querySelectorAll(".tk-map-event-facts li")].map((li) =>
          li.innerText.replace(/\n/g, ": "),
        ),
      }));
    };

    // --- lunar -----------------------------------------------------------
    const lunar = await find("next lunar eclipse");
    check(/lunar eclipse/i.test(lunar), `searching finds a lunar eclipse ("${lunar}")`);
    await openEventReading(page);
    const lunarReading = await page.evaluate(
      () => document.querySelector(".tk-map-event-value")?.textContent ?? null,
    );
    check(
      lunarReading !== null &&
        /visible|moon rises|moon sets|not visible/i.test(lunarReading),
      `a lunar eclipse reports a visibility region rather than a path ("${lunarReading}")`,
    );
    check(
      (await page.evaluate(() => Boolean(document.querySelector(".maplibregl-canvas")))) === true,
      "and draws its visibility regions",
    );

    // --- Perseids --------------------------------------------------------
    const perseids = await find("Perseids");
    check(/perseid/i.test(perseids), `searching finds the Perseids ("${perseids}")`);
    const label = await page.evaluate(
      () => document.querySelector(".tk-map-event-reading .tk-map-layer-label")?.textContent ?? "",
    );
    check(
      /observing potential/i.test(label) && !/visibility/i.test(label),
      `a shower is labelled observing potential, not visibility ("${label}")`,
    );
    const perseidFacts = await page.evaluate(() =>
      [...document.querySelectorAll(".tk-map-event-facts li")].map((li) =>
        li.innerText.replace(/\n/g, ": "),
      ),
    );
    check(
      perseidFacts.some((f) => /darkness/i.test(f)) &&
        perseidFacts.some((f) => /radiant/i.test(f)) &&
        perseidFacts.some((f) => /moonlight/i.test(f)),
      `its inputs are listed rather than hidden behind a score (${perseidFacts.length} facts)`,
    );

    // A northern site and a southern one must not agree about the Perseids.
    const north = await readAt(45.5, -122.7);
    const south = await readAt(-33.87, 151.21);
    check(
      north.value !== south.value,
      `the same shower reads differently in each hemisphere ("${north.value}" vs "${south.value}")`,
    );
    check(
      south.facts.some((f) => /never rises/i.test(f)),
      "and the southern reading says why: the radiant never rises",
    );
    await context.close();
  }

  /* --- layers versus event overlays ------------------------------------- */
  console.log("\nLayers and overlays");
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);

    check(
      (await page.locator(".tk-layers-trigger").count()) === 1,
      "there is one Layers control rather than a chip per layer",
    );
    check(
      (await page.locator(".tk-layers-panel").count()) === 0,
      "and it is closed until asked for",
    );
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    const listed = await page.locator(".tk-layers-item-name").allInnerTexts();
    for (const expected of [
      "Light pollution",
      "Aurora",
      "Twilight and darkness",
      "Cloud viewing conditions",
    ]) {
      check(listed.some((name) => name === expected), `the panel offers ${expected}`);
    }
    /**
     * The panel lists what Tracker can draw, and nothing else.
     *
     * Cloud and smoke were both listed here once, permanently disabled, reading
     * "Needs a gridded forecast, not yet fetched" — an engineering note about
     * work never started, printed in the product as if it were a temporary
     * outage. A control that can never turn on advertises a feature that does
     * not exist, so both went until there was data behind them.
     *
     * Cloud has data behind it now and is back. Smoke does not: Tracker has an
     * aerosol figure for a point, which is why a card's conditions are real, and
     * no field to draw across a continent. So the assertion is not weaker, it is
     * the same assertion — this panel lists exactly what can be drawn — applied
     * to a product that can now draw one more thing.
     */
    for (const absent of ["Smoke and haze"]) {
      check(!listed.some((name) => name === absent), `the panel does not offer ${absent}`);
    }
    const panelText = await page.locator(".tk-layers-panel").innerText();
    check(
      !/not yet fetched|gridded (forecast|aerosol)/i.test(panelText),
      "and no engineering placeholder text reaches the panel",
    );
    check(
      (await page.locator(".tk-layers-group h3").count()) >= 2,
      "layers are grouped rather than listed flat",
    );

    // Turning one on shows in the trigger without opening the panel.
    await page.locator('.tk-layers-item:has-text("Light pollution")').click();
    await page.waitForTimeout(7000);
    check(
      (await page.evaluate(() => new URLSearchParams(location.search).get("layers")))?.includes(
        "light-pollution",
      ) === true,
      "turning a layer on is written into the URL",
    );
    check(
      (await page.locator(".tk-layers-count").innerText()) === "1",
      "and the closed control says how many are on",
    );
    await openLayerPanel(page);
    check(
      (await page.locator(".tk-map-layer-reading").count()) >= 1,
      "the layer control interprets the layer at the selected point",
    );
    await closeLayerPanel(page);

    /**
     * Environment layers and the event overlay are separate systems.
     *
     * This is the check the whole architecture exists for: switching a weather
     * layer off must not disturb the astronomy the reader is looking at.
     */
    const withEvent = new URL(page.url());
    withEvent.searchParams.set("show", "meteor-shower-PER-2027-08-12");
    withEvent.searchParams.set("date", "2027-08-12");
    await page.goto(withEvent.toString(), { waitUntil: "domcontentloaded" });
    await settled(page, 1500);
    await page.waitForTimeout(8000);
    await openEventReading(page);
    check(
      (await page.locator(".tk-map-event-reading").count()) === 1,
      "an event overlay and an environment layer coexist",
    );
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    await page.locator('.tk-layers-item:has-text("Light pollution")').click();
    await page.waitForTimeout(3000);
    check(
      (await page.evaluate(() => new URLSearchParams(location.search).get("layers"))) === null,
      "turning the layer off removes it",
    );
    await openEventReading(page);
    check(
      (await page.locator(".tk-map-event-reading").count()) === 1,
      "and the event overlay is untouched by it",
    );
    check(
      (await page.evaluate(() => new URLSearchParams(location.search).get("show"))) !== null,
      "the selected event survives a layer change",
    );
    await context.close();
  }

  /* --- daytime events --------------------------------------------------- */
  console.log("\nDaytime events");
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await stub(context);
    // Luxor, inside the path of the 2 August 2027 total solar eclipse.
    await seed(context, { name: "Luxor", context: "Egypt", latitude: 25.6872, longitude: 32.6396 });
    const page = await context.newPage();
    await page.goto(`${TRACKER}&date=2027-08-02&at=25.7,32.6&z=6`, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);
    await page.waitForTimeout(8000);
    // The rail is ordered best-first, so what used to be the panel's lead is
    // now simply the first card.
    const lead = await page.locator(".tk-rail-card .tk-rail-card-name").first().innerText();
    check(
      /solar eclipse/i.test(lead),
      `a daytime eclipse leads the ranking on its own date ("${lead}")`,
    );
    await context.close();
  }

  /* --- what the reader is observing with ---------------------------------- */
  console.log("\nObserving rules");
  {
    const context = await browser.newContext({ viewport: { width: 1300, height: 880 } });
    await stub(context);
    // Sisters, Oregon: a real dark-sky town, so the naked-eye rule is not
    // deciding everything on light pollution alone.
    await seed(context, { name: "Sisters", context: "Oregon", latitude: 44.29, longitude: -121.55 });
    const page = await context.newPage();

    const railFor = async (rule) => {
      await page.goto(
        `${TRACKER}&at=44.29,-121.55&z=8&date=2027-01-15${rule ? `&with=${rule}` : ""}`,
        { waitUntil: "domcontentloaded" },
      );
      await settled(page, 2500);
      await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(3000);
      return page.evaluate(() =>
        [...document.querySelectorAll(".tk-rail-card")].map((card) => card.dataset.card ?? ""),
      );
    };

    const eyes = await railFor(null);
    const telescope = await railFor("telescope");
    const binoculars = await railFor("binoculars");

    check(eyes.length > 0, `the default rail answers with the unaided eye (${eyes.join(", ")})`);
    /**
     * The demonstration this whole rule exists for.
     *
     * A telescope object is absent from the naked-eye rail because it needs a
     * telescope on every night there has ever been — not because it is faint
     * tonight, which would imply another night would do.
     */
    check(
      eyes.every((id) => !id.startsWith("deep-sky-m57") && !id.startsWith("deep-sky-m51")),
      "and offers no telescope target in it",
    );
    check(
      telescope.some((id) => id.startsWith("deep-sky-")),
      `the telescope rule adds deep-sky targets (${telescope.join(", ")})`,
    );
    const added = telescope.filter((id) => !eyes.includes(id));
    check(added.length > 0, `and they are additions rather than replacements (${added.join(", ")})`);
    for (const id of eyes) {
      check(
        telescope.includes(id) || id === "moon",
        `${id} is still offered under the telescope rule`,
      );
    }
    check(
      binoculars.some((id) => id.startsWith("deep-sky-")),
      `binoculars add their own (${binoculars.join(", ")})`,
    );
    check(
      JSON.stringify(binoculars) !== JSON.stringify(telescope),
      "and the two aided rules do not produce the same answer",
    );

    // The rule is a state the URL carries, so a shared link reproduces it.
    check(
      (await page.evaluate(() => new URLSearchParams(location.search).get("with"))) === "binoculars",
      "the rule is in the URL",
    );

    /**
     * The control is a rule, not a layer and not a mode.
     *
     * It sits in the top bar with the place and the date — the three things a
     * Tracker answer depends on — and not in the map's own control stack.
     */
    const placement = await page.evaluate(() => {
      const control = document.querySelector(".tk-equipment");
      return control
        ? {
            inTopBar: Boolean(control.closest(".tk-map-topbar")),
            inControlStack: Boolean(control.closest(".tk-map-controls-view")),
            inLayers: Boolean(control.closest(".tk-layers")),
          }
        : null;
    });
    check(
      placement?.inTopBar === true && !placement.inControlStack && !placement.inLayers,
      `the observing rule sits with the place and the date (${JSON.stringify(placement)})`,
    );

    await context.close();
  }

  /* --- the event's geography, drawn by the map ---------------------------- */
  console.log("\nEmbedded event map");
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8&date=2028-01-11`, {
      waitUntil: "domcontentloaded",
    });
    await settled(page, 2500);
    await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissTour(page);
    await page.locator(".tk-rail-card .tk-rail-card-head").first().click();
    await page.waitForTimeout(1000);
    await page.locator(".tk-rail-details").first().click();
    await page.waitForSelector(".tk-map-detail", { timeout: 30_000 });
    await page.waitForTimeout(5000);

    /**
     * One cartography, not two.
     *
     * There were three hand-written SVG renderers here — an eclipse map, an
     * aurora map and a general geographic map — with their own projection,
     * coastlines, legend and colours, and they looked like a different product
     * from the map the reader had just come from.
     */
    check(
      (await page.locator(".tk-geomap, .tk-eclipsemap, .tk-auroramap").count()) === 0,
      "the event page draws no second cartography",
    );
    check(
      (await page.locator(".tk-eventmap .maplibregl-canvas").count()) === 1,
      "the visualization slot holds the Tracker map itself",
    );
    check(
      (await page.locator(".tk-eventmap .maplibregl-ctrl-attrib").count()) === 1,
      "with the attribution its sources require",
    );
    const reading = await page.locator(".tk-eventmap-reading").innerText().catch(() => "");
    check(
      reading.trim().length > 0,
      `and the words beside it, so the drawing is not the only answer ("${reading.replace(/\n/g, " · ")}")`,
    );
    /**
     * A panel, not a workspace: it must not take the drag the page needs.
     */
    const inert = await page.evaluate(() => {
      const canvas = document.querySelector(".tk-eventmap .maplibregl-canvas-container");
      return canvas ? !canvas.classList.contains("maplibregl-interactive") : null;
    });
    check(inert === true, "and it does not capture the page's own gestures");

    await context.close();
  }

  /* --- 2D and 3D are the same map ----------------------------------------- */
  console.log("\n2D and 3D");
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(
      `${TRACKER}&at=45.5,-122.7&z=4&date=2027-08-12&show=meteor-shower-PER-2027-08-12&layers=twilight`,
      { waitUntil: "domcontentloaded" },
    );
    await settled(page, 2500);
    await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissTour(page);

    const state = () =>
      page.evaluate(() => {
        const map = window.__trackerMap;
        const style = map.getStyle();
        const params = new URLSearchParams(location.search);
        const toggle = document.querySelector(".tk-projection");
        const topbar = document.querySelector(".tk-map-topbar");
        return {
          projection: (map.getProjection?.() ?? style.projection ?? { type: "mercator" }).type,
          worldCopies: map.getRenderWorldCopies(),
          atmosphere: style.sky?.["atmosphere-blend"] ?? null,
          overlays: style.layers
            .filter((layer) => /^tracker-/.test(layer.id))
            .map((layer) => layer.id),
          centre: {
            lat: Number(map.getCenter().lat.toFixed(3)),
            lng: Number(map.getCenter().lng.toFixed(3)),
            zoom: Number(map.getZoom().toFixed(2)),
          },
          card: document.querySelector('.tk-rail-card[data-expanded="true"]')?.dataset.card ?? null,
          url: {
            pin: params.get("pin"),
            date: params.get("date"),
            show: params.get("show"),
            layers: params.get("layers"),
            globe: params.get("globe"),
          },
          toggle: toggle
            ? {
                left: Math.round(toggle.getBoundingClientRect().left),
                top: Math.round(toggle.getBoundingClientRect().top),
                belowTopBar: topbar
                  ? toggle.getBoundingClientRect().top >=
                    topbar.getBoundingClientRect().bottom - 1
                  : false,
                inControlStack: Boolean(toggle.closest(".tk-map-controls-view")),
              }
            : null,
          selected:
            document.querySelector('.tk-projection-option[aria-checked="true"]')?.getAttribute("aria-label") ?? null,
          tabStops: [...document.querySelectorAll(".tk-projection-option")].map((b) => b.tabIndex),
        };
      });

    await page.locator(".tk-rail-card .tk-rail-card-head").first().click();
    await page.waitForTimeout(1400);
    const flat = await state();

    check(flat.projection === "mercator", "Tracker opens flat, and stays 2D-first");
    check(flat.url.globe === null, "and a link without the flag opens flat");
    /**
     * The control belongs with what the reader is looking at, not with what
     * moves the camera.
     */
    check(
      flat.toggle !== null && flat.toggle.left < 200 && flat.toggle.belowTopBar,
      `the 2D/3D control sits top-left, under the top bar (${JSON.stringify(flat.toggle)})`,
    );
    check(
      flat.toggle !== null && !flat.toggle.inControlStack,
      "and not in the zoom and Layers stack on the right",
    );
    check(
      JSON.stringify(flat.tabStops) === JSON.stringify([0, -1]),
      `one tab stop for the group, on the selected option (${flat.tabStops.join(", ")})`,
    );

    // The arrow keys move and select, which is what the radio role promises.
    await page.locator('.tk-projection-option[aria-checked="true"]').focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(4000);
    const globe = await state();
    check(globe.projection === "globe", "the arrow keys switch projection");
    check(globe.selected?.includes("Globe") === true, "and the selection follows");
    check(globe.url.globe === "1", "and the globe is a state the URL describes");

    /**
     * No atmosphere, in either mode.
     *
     * MapLibre's globe blends one in at 0.8 by default: a blue halo and a lit
     * limb. It is a picture of daylight on a product about what the sky does
     * after dark, and it puts a bright ring around exactly the edge where a
     * low-altitude eclipse or an aurora oval is read.
     */
    check(globe.atmosphere === 0, `the globe renders no atmosphere (blend ${globe.atmosphere})`);
    check(
      globe.worldCopies === false && flat.worldCopies === true,
      "repeated worlds are a flat-map answer and stop at the globe",
    );
    check(
      globe.overlays.length === flat.overlays.length && globe.overlays.length > 0,
      `the same overlays are drawn in 3D (${globe.overlays.join(", ")})`,
    );

    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(3500);
    const back = await state();
    check(back.projection === "mercator", "and back again");

    const kept = (key) =>
      JSON.stringify(flat[key]) === JSON.stringify(globe[key]) &&
      JSON.stringify(globe[key]) === JSON.stringify(back[key]);
    for (const [key, what] of [
      ["card", "the expanded card"],
      ["centre", "the camera"],
      ["overlays", "the event overlay"],
    ]) {
      check(kept(key), `2D → 3D → 2D keeps ${what}`);
    }
    for (const field of ["pin", "date", "show", "layers"]) {
      check(
        flat.url[field] === globe.url[field] && globe.url[field] === back.url[field],
        `2D → 3D → 2D keeps ${field} (${flat.url[field]})`,
      );
    }
    check(back.url.globe === null, "and the flag is dropped when it goes back to flat");

    await context.close();
  }

  /* --- the rail on a real phone ------------------------------------------- */
  //
  // Measured at three narrow sizes rather than at a generous responsive width,
  // because every one of these defects only appears when the rail and the map
  // controls are actually competing for the same few hundred pixels.
  console.log("\nMobile rail");
  for (const [label, viewport] of [
    ["375x667", { width: 375, height: 667 }],
    ["360x740", { width: 360, height: 740 }],
    ["390x844", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    // A night with three cards, including one whose time range is long enough
    // to have wrapped before.
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8&date=2027-08-12`, {
      waitUntil: "domcontentloaded",
    });
    await settled(page, 2000);
    await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const snap = () =>
      page.evaluate(() => {
        const box = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { x: Math.round(rect.x), y: Math.round(rect.y), right: Math.round(rect.right) };
        };
        const strip = document.querySelector(".tk-rail-scroll");
        return {
          controls: box(".tk-map-controls-view"),
          layers: box(".tk-layers"),
          cards: [...document.querySelectorAll(".tk-rail-card")].map((card) => ({
            id: card.dataset.card ?? "",
            x: Math.round(card.getBoundingClientRect().x),
            right: Math.round(card.getBoundingClientRect().right),
            height: Math.round(card.getBoundingClientRect().height),
            expanded: card.dataset.expanded === "true",
          })),
          scrollLeft: Math.round(strip?.scrollLeft ?? -1),
          scrollable: strip ? strip.scrollWidth > strip.clientWidth : false,
          sideways:
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });

    const resting = await snap();
    /**
     * A compact card's height is a property of the card, not of its content.
     *
     * A time range like "11:48 PM–4:18 AM" wrapped in the width a 200-pixel
     * card leaves for text, and a wrapped card is seventeen pixels taller than
     * its neighbours. With the cards bottom-aligned that reads as one card
     * being bigger than the rest for no reason — and which card it is depends
     * on what is in the sky.
     */
    const heights = [...new Set(resting.cards.filter((c) => !c.expanded).map((c) => c.height))];
    check(
      heights.length === 1,
      `${label}: every compact card is the same height (${heights.join(", ")})`,
    );
    check(!resting.sideways, `${label}: the page itself does not scroll sideways`);
    check(resting.scrollable, `${label}: the rail has more cards than fit, and can scroll`);

    /**
     * A swipe that starts between two cards still scrolls the strip.
     *
     * The strip was transparent to the pointer so that a click beside a card
     * could reach the map. A browser will not begin a scroll gesture on an
     * element that receives no pointer events, so every swipe that did not
     * begin exactly on a card did nothing at all.
     */
    const first = resting.cards[0];
    const strip = await page.locator(".tk-rail-scroll").boundingBox();
    const session = await page.context().newCDPSession(page);
    const y = strip.y + strip.height / 2;
    const from = first.right + 5;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from, y }],
    });
    for (let step = 1; step <= 10; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: from - step * 18, y }],
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(900);
    const scrolled = await page.evaluate(() =>
      Math.round(document.querySelector(".tk-rail-scroll").scrollLeft),
    );
    check(
      scrolled > 40,
      `${label}: a swipe starting between cards scrolls the rail (${scrolled}px)`,
    );
    check(
      (await page.locator('.tk-rail-card[data-expanded="true"]').count()) === 0,
      `${label}: and scrolling does not open a card`,
    );

    /**
     * Selecting any card brings it to the front, and the controls stay put.
     *
     * The last card is the one that proves it: a scroller stops when its
     * content runs out, so without room past the end the final card came to
     * rest halfway under the control stack.
     */
    const cards = page.locator(".tk-rail-card");
    const count = await cards.count();
    for (const index of [count - 1, 0]) {
      await cards.nth(index).locator(".tk-rail-card-head").click();
      await page.waitForTimeout(1600);
      const open = await snap();
      const card = open.cards.find((entry) => entry.expanded);
      /**
       * Whole, rather than first.
       *
       * Bringing every chosen card to the front was the old rule and it moved
       * the rail on selections where nothing needed moving. What the reader is
       * owed is the card they just chose, entire; where it sits after that is
       * wherever it already was.
       */
      const framing = await railFraming(page);
      check(
        framing !== null && framing.clippedLeft === 0 && framing.clippedRight === 0,
        `${label}: selecting card ${index + 1} leaves it whole (${framing?.clippedLeft}px off the left, ${framing?.clippedRight}px off the right)`,
      );
      check(
        card !== undefined && open.controls !== null && card.right <= open.controls.x,
        `${label}: and the expanded card stops short of the controls (${card?.right} vs ${open.controls?.x})`,
      );
      check(
        open.controls?.y === resting.controls?.y && open.layers?.y === resting.layers?.y,
        `${label}: and the controls have not moved (${resting.controls?.y} → ${open.controls?.y})`,
      );
      check(
        open.cards.filter((entry) => entry.expanded).length === 1,
        `${label}: exactly one card is open`,
      );
      await cards.nth(index).locator(".tk-rail-card-head").click();
      await page.waitForTimeout(800);
    }

    /**
     * The corrected rule, at this width.
     *
     * Selecting a card must not move the rail unless part of that card would
     * otherwise be hidden, and when it does move it must move by the least
     * distance that makes the card whole. Every case below is one way that can
     * go wrong, and the sequence deliberately never closes a card first — a
     * card shrinking beside the one being chosen is the geometry the decision
     * has to be made against.
     */
    for (const index of [1, count - 1, 2, 0]) {
      const before = await page.evaluate(() =>
        Math.round(document.querySelector(".tk-rail-scroll").scrollLeft),
      );
      const wasWhole = await page.evaluate((position) => {
        const strip = document.querySelector(".tk-rail-scroll");
        const card = document.querySelectorAll(".tk-rail-card")[position];
        if (!strip || !card) return false;
        const box = strip.getBoundingClientRect();
        const controls = document.querySelector(".tk-map-controls-view");
        const over = controls?.getBoundingClientRect();
        const overlaps =
          over && over.left < box.right && over.right > box.left &&
          over.top < box.bottom && over.bottom > box.top;
        const right = overlaps ? Math.min(box.right, over.left) : box.right;
        const rect = card.getBoundingClientRect();
        // Room for the width it is about to grow to, so "it already fitted" is
        // a statement about the card the reader ends up looking at.
        const expanded = rect.left + Math.max(rect.width, 344);
        return rect.left >= box.left - 1 && expanded <= right + 1;
      }, index);

      await cards.nth(index).locator(".tk-rail-card-head").click();
      await page.waitForTimeout(1500);
      const framing = await railFraming(page);
      const after = framing?.scrollLeft ?? -1;

      check(
        framing !== null && framing.clippedLeft === 0 && framing.clippedRight === 0,
        `${label}: choosing ${framing?.name} leaves it whole (${framing?.clippedLeft}px off the left, ${framing?.clippedRight}px off the right)`,
      );
      /**
       * And the rail did not move for a card that already fitted.
       *
       * This is the assertion the correction exists for. The old rule scrolled
       * on every selection; a reader looking straight at a card they can see
       * should not have it slide away from them.
       */
      if (wasWhole) {
        check(
          Math.abs(after - before) <= 2,
          `${label}: and a card that already fitted did not move the rail (${before} → ${after})`,
        );
      }
      check(
        framing !== null && framing.scrollLeft >= 0 && framing.scrollLeft <= framing.maxScroll,
        `${label}: and the scroll position stays inside its own bounds (${framing?.scrollLeft} of ${framing?.maxScroll})`,
      );
    }

    await context.close();
  }

  /* --- and the same rule on a desktop rail --------------------------------- */
  //
  // A wider strip fits several cards at once, so most selections should move
  // nothing at all — which is the case the old always-scroll rule got wrong
  // most often, because there was always somewhere else to put the card.
  for (const [label, viewport] of [
    ["1024x800", { width: 1024, height: 800 }],
    ["1440x900", { width: 1440, height: 900 }],
  ]) {
    const context = await browser.newContext({ viewport });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8&date=2027-08-12`, {
      waitUntil: "domcontentloaded",
    });
    await settled(page, 2000);
    await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissTour(page);

    const cards = page.locator(".tk-rail-card");
    const count = await cards.count();
    let unmoved = 0;
    /**
     * Never the same card twice in a row: the head is a toggle, so a repeat
     * closes the card rather than choosing it, and there is then nothing to
     * measure. A short rail makes that easy to write by accident.
     */
    const sequence = [0, 1, count - 1, 2, count - 2].filter(
      (index, at, all) => index >= 0 && index < count && index !== all[at - 1],
    );
    for (const index of sequence) {
      const before = await page.evaluate(() =>
        Math.round(document.querySelector(".tk-rail-scroll").scrollLeft),
      );
      await cards.nth(index).locator(".tk-rail-card-head").click();
      await page.waitForTimeout(1500);
      const framing = await railFraming(page);
      if (framing && Math.abs(framing.scrollLeft - before) <= 2) unmoved += 1;
      check(
        framing !== null && framing.clippedLeft === 0 && framing.clippedRight === 0,
        `${label}: ${framing?.name} is whole after being chosen (${framing?.clippedLeft}/${framing?.clippedRight}px clipped)`,
      );
      check(
        framing !== null && framing.scrollLeft >= 0 && framing.scrollLeft <= framing.maxScroll,
        `${label}: and the scroll stays inside its bounds (${framing?.scrollLeft} of ${framing?.maxScroll})`,
      );
    }
    /**
     * Most of those should have moved nothing.
     *
     * A rail this wide shows several cards at once. If every selection still
     * scrolls, the rule has not changed however contained the cards end up.
     */
    check(
      unmoved >= 2,
      `${label}: and selecting a card that already fitted left the rail alone (${unmoved} of ${sequence.length})`,
    );
    await context.close();
  }

  /* --- the same, with motion turned off ----------------------------------- */
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8&date=2027-08-12`, {
      waitUntil: "domcontentloaded",
    });
    await settled(page, 2000);
    await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const cards = page.locator(".tk-rail-card");
    const count = await cards.count();
    await cards.nth(count - 1).locator(".tk-rail-card-head").click();
    // Deliberately short: with motion off the rail should already be there
    // rather than still gliding.
    await page.waitForTimeout(500);
    /**
     * With motion off, the same containment and no glide to watch.
     *
     * The rule is about geometry, not animation: the card the reader chose is
     * whole by the time they look at it, and the rail arrives rather than
     * travels. Half a second is deliberately short — enough for the layout to
     * settle, not enough for a smooth scroll to have finished.
     */
    const framing = await railFraming(page);
    check(
      framing !== null && framing.clippedLeft === 0 && framing.clippedRight === 0,
      `reduced motion: the selected card is already whole (${framing?.clippedLeft}/${framing?.clippedRight}px clipped)`,
    );
    await context.close();
  }

  /* --- the toggle stays under what drops out of the top bar ---------------- */
  //
  // It sat at the same stacking level as the bar and later in the document, so
  // it painted over the bar's own panels — and the bar is a stacking context,
  // so their z-index could not climb out of it however high it went. On a
  // narrow screen those panels are nearly the full width, and a reader opening
  // the observing rule got a 2D/3D switch sitting on top of the list.
  // 700 is where the event finder's panel first reaches the toggle; 430 and 390
  // are where the observing rule's does.
  for (const width of [700, 430, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 820 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 2000);
    await page.waitForTimeout(2500);
    await dismissTour(page);

    const covered = async (label, panelSelector) => {
      const seen = await page.evaluate((selector) => {
        const toggle = document.querySelector(".tk-projection");
        const panel = document.querySelector(selector);
        if (!toggle || !panel) return null;
        const t = toggle.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const across = Math.max(0, Math.min(p.right, t.right) - Math.max(p.left, t.left));
        const down = Math.max(0, Math.min(p.bottom, t.bottom) - Math.max(p.top, t.top));
        if (across <= 0 || down <= 0) return { overlaps: false };
        const element = document.elementFromPoint(
          Math.max(p.left, t.left) + across / 2,
          Math.max(p.top, t.top) + down / 2,
        );
        return { overlaps: true, toggleOnTop: Boolean(element?.closest(".tk-projection")) };
      }, panelSelector);
      if (seen === null) return;
      if (!seen.overlaps) {
        check(true, `${width}px: the ${label} panel clears the 2D/3D control entirely`);
        return;
      }
      check(
        seen.toggleOnTop === false,
        `${width}px: the ${label} panel is above the 2D/3D control where they overlap`,
      );
    };

    const rule = page.getByRole("button", { name: /naked eye|binocular|telescope/i }).first();
    if ((await rule.count()) > 0) {
      await rule.click().catch(() => {});
      await page.waitForTimeout(700);
      await covered("observing rule", ".tk-equipment-panel");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    /**
     * And the event finder, whose panel drops out of the same bar.
     *
     * Named rather than silently skipped: a check that quietly does nothing
     * when a selector stops matching is worse than no check, because it goes on
     * reporting success.
     */
    const finder = page.locator(".tk-eventfinder-trigger, .tk-eventfinder-current").first();
    if ((await finder.count()) > 0) {
      await finder.click().catch(() => {});
      await page.waitForTimeout(700);
      await covered("event finder", ".tk-eventfinder-open");
    } else {
      console.log(`  · ${width}px: no event-finder control on screen, so its stacking is untested`);
    }
    await context.close();
  }

  /* --- cloud, as a time-aware observing warning ---------------------------- */
  console.log("\nCloud");

  /**
   * A cloud mask stub that answers every shape the app asks for.
   *
   * The proxy has three modes and the layer uses all of them: a point reading
   * at native resolution, a strided field over the view, and a series of recent
   * scans for the warning system. Stubbing only the first is how a gate ends up
   * proving that a feature which never ran is fine.
   */
  // The mask and the forecast come from the shared fixtures, so the picture in
  // the review package is of the same night these checks are about.
  const cloudMask = stubCloudMask;
  const cloudForecast = stubCloudForecast;

  /**
   * The cloud checks run on a pinned night, not on whatever hour it is here.
   *
   * They used to inherit the wall clock, and the fixture's scans were stamped
   * with it. That works while the machine happens to be inside Portland's
   * observing window and fails the moment it is not: run in the morning, every
   * scan lands in daylight, the timeline filters them all out, and three checks
   * about the observed half of the layer fail on a product that is working. A
   * check whose answer depends on the time of day is not a check.
   */
  const cloudPage = async (context) => {
    const page = await context.newPage();
    await page.clock.setFixedTime(SATELLITE_CLOCK);
    return page;
  };
  const cloudNow = { nowUtc: SATELLITE_CLOCK.toISOString() };

  const openCloud = async (page) => {
    await settled(page, 2500);
    await page.waitForTimeout(4500);
    await dismissTour(page);
  };

  /* --- what the satellite saw, and what the model expects ------------------ */
  {
    const CLOUD_PERCENT = 37;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context);
    await seed(context);
    await cloudForecast(context, CLOUD_PERCENT);
    // ACM 2 is "probably cloudy": the mask's own third level.
    await cloudMask(context, { acm: 2, ...cloudNow });
    const page = await cloudPage(context);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=7&layers=cloud`, {
      waitUntil: "domcontentloaded",
    });
    await openCloud(page);

    const drawn = await page.evaluate(() =>
      window.__trackerMap
        ? window.__trackerMap.getStyle().layers.filter((layer) => /cloud/.test(layer.id)).map((l) => l.id)
        : [],
    );
    check(
      drawn.includes("tracker-cloud"),
      `the suitability field is drawn (${drawn.join(", ") || "nothing"})`,
    );

    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    const reading = await page.locator(".tk-layers-panel").innerText();

    /**
     * The rule this whole feature turns on.
     *
     * The number beside the reader's pin is the model's, sampled from the same
     * values the field is drawn from — never read back out of a rendered tile.
     */
    check(
      new RegExp(`${CLOUD_PERCENT}% cloud`).test(reading),
      `the forecast reading is the model's own number (${(reading.match(/\d+% cloud[^\n]*/) ?? ["nothing"])[0]})`,
    );
    check(/HRRR/i.test(reading), "and it names the model that answered");
    /**
     * The observation is a category, and stays one.
     *
     * The clear-sky mask is a per-pixel classification, not a sky-cover
     * fraction, so it is reported in the product's own words. Turning "probably
     * cloudy" into a percentage would be inventing a measurement.
     */
    check(
      /probably cloudy/i.test(reading),
      `the observation is reported as the classification it is (${(reading.match(/(Clear|Probably clear|Probably cloudy|Cloudy)[^\n]*/) ?? ["nothing"])[0]})`,
    );
    check(/observed .*(ago|just now)/i.test(reading), "and says how long ago the satellite looked");
    check(/GOES-West|G18/.test(reading), "and which spacecraft and product it came from");
    /**
     * Spatial honesty, which is the claim a cloud product is most tempted to
     * overstate. The mask is two-kilometre pixels; it knows nothing about the
     * sky over one roof, and the reading has to say so.
     */
    check(
      /km across/i.test(reading) && /area rather than your exact horizon/i.test(reading),
      `and does not claim to know the sky over the reader's roof (${(reading.match(/[^.]*km across[^.]*\./) ?? ["nothing"])[0]})`,
    );
    check(
      !/\d+%\s*(cloud)?\s*(observed|satellite)/i.test(reading),
      "and no percentage is attached to the classification",
    );
    /**
     * The two cloud percentages are different quantities and must not share a
     * noun. NOAA publishes the probability that a pixel is cloudy; the model
     * publishes a fraction of sky. Rendering both as "N% cloud cover" tells a
     * reader a confidence is an amount.
     */
    check(
      /cloud cover/i.test(reading) && !/\d+%\s*cloud probability[^.]*observed/i.test(reading),
      `the forecast percentage is named as cover (${(reading.match(/\d+% cloud cover/) ?? ["nothing"])[0]})`,
    );
    check(
      !/observed[^.]*\d+% cloud cover/i.test(reading),
      "and no observed reading is labelled as cloud cover",
    );
    check(
      /\d+% cloud probability/i.test(reading),
      `while the mask's own confidence is named a probability (${(reading.match(/\d+% cloud probability/) ?? ["nothing"])[0]})`,
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    /**
     * And the field is actually on the screen, not merely in the style.
     *
     * A layer entry proves the source was added; it proves nothing about
     * pixels. A tile renderer that throws, or a sampler that returns null
     * everywhere, leaves a perfectly well-formed layer drawing nothing — which
     * is the failure a check on `getStyle().layers` cannot see.
     *
     * So: the same strip of map with the layer on and with it off. The
     * difference has to be findable, and the negative control is what stops
     * this passing on a basemap that happens to be busy.
     */
    const meanOf = (strip) => strip.columns.reduce((a, b) => a + b, 0) / strip.columns.length;
    const withCloud = await sampleStrip(page, { x: 400, y: 300, width: 480, height: 120 });
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("layers");
      window.history.replaceState({}, "", url);
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await openCloud(page);
    const withoutCloud = await sampleStrip(page, { x: 400, y: 300, width: 480, height: 120 });
    const on = meanOf(withCloud);
    const off = meanOf(withoutCloud);
    const lift = Math.round(Math.abs(on - off));
    check(
      lift >= 2,
      `the field changes what is on the screen (${lift} levels of luma, ${Math.round(on)} with it on vs ${Math.round(off)} with it off)`,
    );
    await context.close();
  }

  /* --- and the paint follows the classification ---------------------------- */
  //
  // The old version of this section checked that the infrared image was *not*
  // painted, because brightness temperature is not a cloud mask and no
  // threshold separates warm ground from low stratus. There is a real
  // classification now and it is painted, so the check that replaces it is the
  // positive form of the same worry: the field has to be made of NOAA's
  // decision, not of something that merely looks like weather.
  //
  // Same view, same forecast, same everything — only the mask's own value
  // differs. If the screen does not change, the field is not reading it.
  {
    const luma = async (acm) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await stub(context);
      await seed(context);
      await cloudForecast(context, 50);
      await cloudMask(context, { acm, ...cloudNow });
      const page = await cloudPage(context);
      await page.goto(`${TRACKER}&at=45.5,-122.7&z=7&layers=cloud`, {
        waitUntil: "domcontentloaded",
      });
      await openCloud(page);
      const strip = await sampleStrip(page, { x: 400, y: 300, width: 480, height: 120 });
      await context.close();
      return { ...strip, luma: strip.columns.reduce((a, b) => a + b, 0) / strip.columns.length };
    };
    const clearShot = await luma(0);
    const cloudyShot = await luma(3);
    const clear = clearShot.luma;
    const cloudy = cloudyShot.luma;
    const difference = Math.round(Math.abs(cloudy - clear));
    /**
     * Measured on the channels the palette actually encodes, and on brightness.
     *
     * An earlier version of this compared mean luma alone and reported "0
     * levels" for a ramp that was working perfectly well in hue — a light green
     * at low opacity and a dark red at high opacity land in the same place once
     * blended over a dark basemap. That was a real finding about the palette,
     * which now rises in brightness as well; but the check that found it was
     * measuring one of the three cues and calling it the whole answer.
     *
     * So both are asserted: the favourable end must be greener than red and the
     * unfavourable end redder than green — the direction a reader sees — and
     * the two must also differ in brightness, so the ramp survives a screen
     * with no usable hue at all.
     */
    check(
      clearShot.green > clearShot.red,
      `clear sky is painted green rather than red (G ${Math.round(clearShot.green)} vs R ${Math.round(clearShot.red)})`,
    );
    check(
      cloudyShot.red > cloudyShot.green,
      `and cloudy sky red rather than green (R ${Math.round(cloudyShot.red)} vs G ${Math.round(cloudyShot.green)})`,
    );
    check(
      difference >= 6,
      `and the two differ in brightness for a reader without hue (${difference} levels of luma, ${Math.round(clear)} clear vs ${Math.round(cloudy)} cloudy)`,
    );
    check(
      cloudy > clear,
      `with the worse sky the heavier mark (${Math.round(cloudy)} cloudy vs ${Math.round(clear)} clear)`,
    );
  }

  /* --- the timeline, and the boundary between seeing and guessing ---------- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context);
    await seed(context);
    await cloudForecast(context, 12);
    await cloudMask(context, { acm: 0, ...cloudNow });
    const page = await cloudPage(context);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=7&layers=cloud`, {
      waitUntil: "domcontentloaded",
    });
    await openCloud(page);

    const key = page.locator(".tk-cloud-key");
    check(await key.count() === 1, "the cloud key is on the map while the layer is on");

    const title = await key.locator(".tk-cloud-key-title").innerText();
    /**
     * The title names one field, not a verdict on the night.
     *
     * "Stargazing quality" would claim something this layer cannot know: it
     * sees cloud, and nothing of the Moon, the transparency or the light on the
     * ground.
     */
    check(
      /cloud viewing conditions/i.test(title),
      `and it is a key to cloud, not a grade for the night ("${title}")`,
    );

    const strip = await page.evaluate(() => {
      const cells = [...document.querySelectorAll(".tk-cloud-cell")];
      return {
        total: cells.length,
        observed: cells.filter((cell) => cell.dataset.basis === "observed").length,
        forecast: cells.filter((cell) => cell.dataset.basis === "forecast").length,
        order: cells.map((cell) => cell.dataset.basis).join(","),
        boundary: document.querySelectorAll(".tk-cloud-boundary").length,
      };
    });
    check(strip.total > 1, `the night is drawn as a strip of time (${strip.total} samples)`);
    check(
      strip.observed > 0 && strip.forecast > 0,
      `with both evidence paths on it (${strip.observed} observed, ${strip.forecast} forecast)`,
    );
    /**
     * Observations never appear after a forecast hour.
     *
     * The two are ordered in time and the satellite always wins an overlap, so
     * a forecast cell followed by an observed one would mean a model's guess
     * had been laid over an hour the satellite actually watched.
     */
    check(
      !/forecast,observed/.test(strip.order),
      `and never a guess before a look at the same hour (${strip.order})`,
    );
    check(strip.boundary === 1, "and the boundary between them is marked");

    // The scrubber moves the map's own frame rather than only the words.
    const before = await page.locator(".tk-cloud-key-now").innerText();
    await page.evaluate(() => {
      const input = document.querySelector(".tk-cloud-scrub");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, String(Number(input.max)));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(1200);
    const after = await page.locator(".tk-cloud-key-now").innerText();
    check(before !== after, `scrubbing moves through the night ("${before}" → "${after}")`);
    check(
      /forecast/i.test(after),
      "and the far end of the night is labelled as forecast, not as observation",
    );
    check(
      (await page.locator(".tk-cloud-key-reset").count()) === 1,
      "and there is a way back to now",
    );
    await context.close();
  }

  /* --- the warning, and what it does to a recommendation ------------------- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context);
    await seed(context);
    await cloudForecast(context, 95);
    // Cloudy, and it stayed cloudy: the warning is about persistence.
    await cloudMask(context, { acm: 3, series: [3, 3, 3, 3], ...cloudNow });
    const page = await cloudPage(context);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=7&layers=cloud`, {
      waitUntil: "domcontentloaded",
    });
    await openCloud(page);

    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    const reading = await page.locator(".tk-layers-panel").innerText();
    check(
      /cloudy for most of tonight/i.test(reading),
      `a night that stays closed is called closed, in plain words (${(reading.match(/Cloudy for most of tonight/i) ?? ["nothing"])[0]})`,
    );
    await page.keyboard.press("Escape");

    const cards = await page.evaluate(() =>
      [...document.querySelectorAll(".tk-rail-card")].map((card) => card.dataset.card ?? ""),
    );
    /**
     * Cloud takes routine targets off the rail and leaves the rest.
     *
     * This used to assert that cloud never removed anything, which was the rule
     * at the time and was wrong: it filled the rail with things a reader could
     * not see. What must still hold is that the rail is not *emptied* — a night
     * with a rare event in it still offers that event, however bad the sky,
     * because missing it costs years and a satellite pixel knows nothing about
     * the gap over the next valley.
     */
    /**
     * A night of only routine targets, all clouded out, is legitimately empty —
     * and must say so rather than rendering as no rail at all.
     *
     * This used to assert `cards.length > 0`, which was right while cloud could
     * not remove anything. Now that it can, the meaningful claim is that the
     * reader is told what happened: a blank map is the same picture a reader
     * with an empty sky gets, and those are different answers.
     */
    const withheld = await page.evaluate(
      () => document.querySelector(".tk-rail-withheld")?.textContent?.trim() ?? "",
    );
    check(
      cards.length > 0 || withheld.length > 0,
      `a clouded-out night says what happened (${cards.length} cards${cards.length ? `: ${cards.join(", ")}` : `; "${withheld.slice(0, 70)}"`})`,
    );

    /**
     * And it does not offer everything.
     *
     * The counterpart to the check above: a repeatable target whose own window
     * is cloudy throughout is withheld, so the rail under a closed sky is
     * shorter than the same night's rail with the layer off. Without this, "the
     * rail is not empty" would pass just as happily on a product that had
     * quietly stopped suppressing anything.
     */
    const openSky = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(openSky);
    await seed(openSky);
    const clearPage = await cloudPage(openSky);
    await clearPage.goto(`${TRACKER}&at=45.5,-122.7&z=7`, { waitUntil: "domcontentloaded" });
    await openCloud(clearPage);
    const withoutCloud = await clearPage.evaluate(() =>
      [...document.querySelectorAll(".tk-rail-card")].map((card) => card.dataset.card ?? ""),
    );
    await openSky.close();
    check(
      cards.length < withoutCloud.length,
      `and withholds the ones a reader could not see (${cards.length} under cloud vs ${withoutCloud.length} without: dropped ${withoutCloud.filter((id) => !cards.includes(id)).join(", ") || "nothing"})`,
    );

    /**
     * The warning on a surviving card is checked on the next night, not this
     * one.
     *
     * This block used to open the first card and read its cloud caution. On a
     * night whose opportunities are all routine there is now no first card to
     * open — which is the behaviour under test two checks above — so the
     * assertion moved to the rare-event night below, where a card survives by
     * design and the caution is the point.
     */
    await context.close();
  }

  /* --- and the same sky over something that will not come round again ------ */
  //
  // The cost of being wrong is not symmetric. Missing a clear night for Saturn
  // costs nothing; missing a rare event because a model said eighty percent
  // costs years. So the warning is scaled by the significance the opportunity
  // already earned, and the rare case is told to go anyway.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context);
    await seed(context);
    await cloudForecast(context, 95);
    await cloudMask(context, { acm: 3, series: [3, 3, 3, 3], ...cloudNow });
    const page = await cloudPage(context);
    await page.goto(
      `${TRACKER}&at=45.5,-122.7&z=7&layers=cloud&date=2027-08-12&show=meteor-shower-PER-2027-08-12`,
      { waitUntil: "domcontentloaded" },
    );
    await openCloud(page);

    /**
     * Driven with real clicks on the card's own button.
     *
     * `.tk-rail-card` is the list item; the control inside it is
     * `.tk-rail-card-head`. Calling `.click()` on the item in page script
     * dispatched an event nothing was listening for, so no card ever opened and
     * the check passed judgement on an interface it had not operated.
     */
    const heads = page.locator(".tk-rail-card-head");
    const total = await heads.count();
    const notes = [];
    for (let index = 0; index < total; index += 1) {
      await heads.nth(index).click();
      await page.waitForTimeout(800);
      const note = await page.evaluate(() => {
        const node = document.querySelector(".tk-rail-cloud");
        if (!node) return null;
        const card = node.closest(".tk-rail-card");
        return {
          card: card?.dataset.card ?? "",
          goAnyway: node.dataset.goAnyway === "true",
          text: node.textContent ?? "",
        };
      });
      if (note) notes.push(note);
    }
    check(total > 0, `there are cards to check (${total})`);
    const encouraged = notes.filter((note) => note.goAnyway);
    const plain = notes.filter((note) => !note.goAnyway);
    check(
      notes.length === total,
      `every card under a closed sky carries the warning (${notes.length} of ${total})`,
    );
    if (encouraged.length) {
      check(
        /worth going anyway/i.test(encouraged[0].text),
        `and something rare is told to go anyway (${encouraged[0].card})`,
      );
    } else {
      console.log("  · no notable-tier card on this night, so the rare-event wording is untested");
    }
    if (plain.length) {
      check(
        !/worth going anyway/i.test(plain[0].text),
        `while a routine target is not (${plain[0].card})`,
      );
    } else {
      console.log("  · every card on this night was rare, so the routine wording is untested");
    }
    await context.close();
  }

  /* --- when the observation cannot be had ---------------------------------- */
  //
  // A forecast is not an observation and must never be relabelled as one. With
  // the mask unavailable the layer still draws the model, and says the
  // observation is missing rather than presenting the forecast as current.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context);
    await seed(context);
    await cloudForecast(context, 41);
    await cloudMask(context, { status: 502, ...cloudNow });
    const page = await cloudPage(context);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=7&layers=cloud`, { waitUntil: "domcontentloaded" });
    await openCloud(page);
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    const panel = await page.locator(".tk-layers-panel").innerText();
    check(
      /satellite feed is not responding/i.test(panel),
      `an unreachable feed says which thing failed (${(panel.match(/[^\n·]*not responding[^\n]*/) ?? ["nothing"])[0]})`,
    );
    check(/41% cloud/.test(panel), "and the forecast is still offered, as a forecast");
    /**
     * Scoped to the reading, not to the whole panel.
     *
     * The layer's own blurb says "observed then forecast", which is a true
     * description of what the layer does and would fail a naive search of the
     * panel's text. What must not happen is the *reading* presenting the
     * model's number as something the satellite saw.
     */
    const cloudReading = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".tk-layers-item, li")];
      const item = items.find(
        (node) =>
          /cloud viewing conditions/i.test(node.textContent ?? "") &&
          node.querySelector(".tk-map-layer-reading"),
      );
      return item?.querySelector(".tk-map-layer-reading")?.textContent ?? "";
    });
    check(
      cloudReading.length > 0,
      `the cloud layer still shows a reading (${cloudReading.slice(0, 50) || "nothing"})`,
    );
    check(
      !/observed/i.test(cloudReading),
      `and nothing in it calls the forecast an observation (${cloudReading.slice(0, 90)})`,
    );
    await context.close();
  }

  /* --- and when no model answers either ------------------------------------ */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context);
    await seed(context);
    await context.route("**/api.open-meteo.com/v1/forecast**", (route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "" }),
    );
    await cloudMask(context, { status: 502, ...cloudNow });
    const page = await cloudPage(context);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=7&layers=cloud`, {
      waitUntil: "domcontentloaded",
    });
    await openCloud(page);
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    const panel = await page.locator(".tk-layers-panel").innerText();
    check(
      /no forecast covers this view/i.test(panel),
      "a layer with no source behind it says so rather than drawing nothing in silence",
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const empty = await page.evaluate(() => {
      const node = document.querySelector(".tk-cloud-key-empty");
      return node ? node.textContent ?? "" : null;
    });
    check(
      Boolean(empty) && /no cloud information/i.test(empty ?? ""),
      `and the key says there is nothing rather than showing an empty scale (${(empty ?? "nothing").slice(0, 60)})`,
    );
    const drawn = await page.evaluate(() =>
      window.__trackerMap
        ? window.__trackerMap.getStyle().layers.filter((layer) => /cloud/.test(layer.id)).length
        : -1,
    );
    check(drawn === 0, `and nothing is drawn (${drawn} cloud layers)`);
    await context.close();
  }

  /* --- the layer draws the sky; it does not decide it ---------------------- */
  /**
   * Turning Clouds on and off must not change what is worth going out for.
   *
   * The rail does suppress a repeatable target whose whole window is closed —
   * that is the product working, and the count of what cloud cost is stated
   * beside it. What it must not do is depend on whether the reader happens to
   * be looking at the cloud field.
   *
   * It did. Every cloud query was gated on the layer switch, so `cloudTimeline`
   * only existed while the overlay was on, and under a shut sky the rail
   * offered four things with the layer off and none with it on. Turning a layer
   * on to check the weather deleted the answer; turning it off brought back
   * four opportunities that were still behind cloud. A display preference was
   * silently choosing between two different recommendations, and neither the
   * reader nor this gate could see it happening.
   *
   * So the fix ungated the two queries the timeline is built from and left the
   * layer's own surfaces switched. These checks pin both halves: the rail is
   * the same either way, and cloud still decides what is on it.
   */
  console.log("\nClouds layer invariance");
  {
    const railOf = (page) =>
      page.locator(".tk-rail-card").evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-card") ?? "").join(","),
      );

    /** One night, one place, one sky — opened with the layer already off or on. */
    const railUnder = async (sky, layers) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await stub(context);
      await seed(context);
      await cloudForecast(context, sky === "clear" ? 5 : 95);
      await cloudMask(context, { acm: sky === "clear" ? 0 : 3, ...cloudNow });
      const page = await cloudPage(context);
      await page.goto(`${TRACKER}&at=45.5,-122.7&z=7${layers ? "&layers=cloud" : ""}`, {
        waitUntil: "domcontentloaded",
      });
      await openCloud(page);
      const rail = await railOf(page);
      await context.close();
      return rail;
    };

    const clearOff = await railUnder("clear", false);
    const clearOn = await railUnder("clear", true);
    const closedOff = await railUnder("closed", false);
    const closedOn = await railUnder("closed", true);

    /**
     * Asserted first, because every check below it is vacuous without it: a
     * rail that was always empty, or a build that had stopped reading cloud at
     * all, would satisfy "the same either way" perfectly.
     */
    check(clearOff.length > 0, `a clear night offers something (${clearOff || "nothing"})`);
    check(
      closedOff !== clearOff,
      "and a closed night does not offer the same things as a clear one",
    );

    check(
      clearOff === clearOn,
      `the rail under a clear sky ignores the layer switch (off ${clearOff || "-"} / on ${clearOn || "-"})`,
    );
    check(
      closedOff === closedOn,
      `the rail under a closed sky ignores it too (off ${closedOff || "-"} / on ${closedOn || "-"})`,
    );
  }

  /* --- and switching it back leaves nothing behind ------------------------- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context);
    await seed(context);
    await cloudForecast(context, 5);
    await cloudMask(context, { acm: 0, ...cloudNow });
    const page = await cloudPage(context);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=7`, { waitUntil: "domcontentloaded" });
    await openCloud(page);

    const railOf = () =>
      page.locator(".tk-rail-card").evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-card") ?? "").join(","),
      );
    /**
     * Returns the layer's own reading while the panel is still open.
     *
     * The reading is rendered inside the panel's list item, so counting it
     * after closing the panel counts zero whatever the layer is doing — which
     * is what the first version of this check did, and it failed against a
     * product that was working.
     */
    const toggleCloud = async () => {
      await openLayerPanel(page);
      await page
        .locator('.tk-layers-item[role="switch"]:has-text("Cloud viewing conditions")')
        .first()
        .click();
      await page.waitForTimeout(3000);
      const readings = await page.locator(".tk-map-layer-reading").count();
      await closeLayerPanel(page);
      await page.waitForTimeout(1500);
      return readings;
    };

    const before = await railOf();
    check(before.length > 0, `the rail has something to lose (${before || "nothing"})`);

    const readingOn = await toggleCloud();
    const during = await railOf();
    check(during === before, `turning Clouds on changes nothing on the rail (${during || "-"})`);

    const readingOff = await toggleCloud();
    const after = await railOf();
    check(after === before, `and turning it off restores exactly what was there (${after || "-"})`);

    /**
     * The other half of the contract. Ungating the data must not have dragged
     * the layer's own furniture into a map that has it switched off.
     */
    check(readingOn > 0, "the layer still states its own reading while it is on");
    check(readingOff === 0, "and takes that reading away again when it is off");

    await context.close();
  }

  /* --- spacecraft overhead ------------------------------------------------- */
  console.log("\nSatellites");
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context, { satellites: "full" });
    await seed(context);
    const page = await context.newPage();
    await page.clock.setFixedTime(SATELLITE_CLOCK);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 2000);
    await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3500);
    await dismissTour(page);

    const rail = await page.evaluate(() =>
      [...document.querySelectorAll(".tk-rail-card")].map((card) => card.dataset.card ?? ""),
    );
    check(rail.includes("satellite-iss"), `the station is offered on a night it passes (${rail.join(", ")})`);

    /**
     * And the train, which had to clear four screens to get here.
     *
     * A real deployment rather than Starlink objects in a recent-launch feed;
     * still travelling together; low enough to be the bright population with
     * room under the height at which they are dimmed; and a prediction that
     * clears the sky by more than the spread of the population its brightness
     * came from. Every one of those can say no, and the tests in
     * `satellites.test.ts` make each of them say it.
     */
    check(
      rail.some((id) => id.startsWith("satellite-train")),
      "and so is a train that clears all four of its screens",
    );

    if (rail.includes("satellite-iss")) {
      await page
        .locator('.tk-rail-card[data-card="satellite-iss"] .tk-rail-card-head')
        .click();
      await page.waitForTimeout(1200);
      const card = await page
        .locator('.tk-rail-card[data-card="satellite-iss"]')
        .innerText();
      check(/\d+°/.test(card), `the card says how high the pass goes (${card.split("\n")[2] ?? ""})`);

      await page.goto(`${TRACKER}&at=45.5,-122.7&z=8&event=satellite-iss`, {
        waitUntil: "domcontentloaded",
      });
      await settled(page, 2000);
      await page.waitForTimeout(3500);
      const detail = await page.evaluate(() => ({
        heading: document.querySelector(".tk-page-heading")?.textContent?.trim() ?? "",
        image: document.querySelector(".tracker-media img")?.getAttribute("src") ?? "",
        timing: document.querySelector(".tk-viz-timing")?.textContent?.trim() ?? "",
        limitations: [...document.querySelectorAll(".tk-limitation, .tk-hero-limitation")].map(
          (node) => node.textContent?.trim() ?? "",
        ),
        body: document.body.innerText,
      }));
      check(/satellite/i.test(detail.heading), `the page is filed under satellites (${detail.heading})`);
      /**
       * A picture of the station, not of the sky it crosses.
       *
       * The same rule every other page follows, and the one the generic night
       * sky used to break.
       */
      check(/iss/i.test(detail.image), `the hero is a photograph of the station (${detail.image})`);
      /**
       * The panel says how long the pass is, not how long the night is.
       *
       * A four-minute event under a line reading "7:46 PM to 6:34 AM" is the
       * interface contradicting its own chart.
       */
      const span = detail.timing.match(/(\d+):(\d+)\s*([AP]M)?\s*to\s*(\d+):(\d+)/i);
      check(span !== null, `the panel states the pass rather than the night (${detail.timing})`);
      if (span) {
        const minutes = (h, m, meridiem) =>
          ((Number(h) % 12) + (/(pm)/i.test(meridiem ?? "") ? 12 : 0)) * 60 + Number(m);
        const start = minutes(span[1], span[2], span[3]);
        const end = minutes(span[4], span[5], detail.timing.slice(-2));
        const length = (end - start + 1440) % 1440;
        check(
          length > 0 && length <= 15,
          `and that pass is minutes rather than hours (${length} minutes)`,
        );
      }
      /**
       * Where the brightness came from, said on the page.
       *
       * A magnitude nobody measured is the one thing this whole feature is not
       * allowed to invent, so the page has to be able to say it did not.
       */
      check(
        /measured standard magnitude/i.test(detail.body),
        "the page says the brightness is scaled from a measurement",
      );
      check(
        /NASA|public catalogue/i.test(detail.body),
        "and where the orbit came from",
      );
    }
    await context.close();
  }

  /* --- a night with a station but no deployment ---------------------------- */
  //
  // The usual night. The index lists no post-deployment stack, so there is no
  // train — an absence with a cause rather than a prediction nobody can check.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context, { satellites: "iss-only" });
    await seed(context);
    const page = await context.newPage();
    await page.clock.setFixedTime(SATELLITE_CLOCK);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 2000);
    await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const rail = await page.evaluate(() =>
      [...document.querySelectorAll(".tk-rail-card")].map((card) => card.dataset.card ?? ""),
    );
    check(rail.includes("satellite-iss"), "the station is still offered with no deployment published");
    check(
      !rail.some((id) => id.startsWith("satellite-train")),
      "and nothing is offered as a train when no stack is being published",
    );
    await context.close();
  }

  /* --- and when CelesTrak cannot be reached -------------------------------- */
  //
  // The common state, and it has to be an absence rather than a stale pass or a
  // guess. Nothing else on the page may depend on it.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await stub(context, { satellites: "unavailable" });
    await seed(context);
    const page = await context.newPage();
    await page.clock.setFixedTime(SATELLITE_CLOCK);
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 2000);
    await page.waitForSelector(".tk-rail-card", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const rail = await page.evaluate(() =>
      [...document.querySelectorAll(".tk-rail-card")].map((card) => card.dataset.card ?? ""),
    );
    check(
      !rail.some((id) => id.startsWith("satellite-")),
      "no orbit reached the device, so no pass is offered",
    );
    check(rail.length > 0, `and the rest of the night is unaffected (${rail.length} cards)`);
    await context.close();
  }

  /* --- the light-pollution field actually draws ---------------------------- */
  console.log("\nLight pollution");
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();

    /**
     * Proved by differencing, not by asserting a layer exists.
     *
     * A source and a layer can both be present while nothing is drawn — a
     * failed range read, a sampler that returns transparent, an archive whose
     * format changed. What matters is that the reader sees the city, so this
     * photographs the same view with and without the layer and measures what
     * appeared.
     */
    const stripOver = async (layers) => {
      await page.goto(`${TRACKER}&at=45.52,-122.66&z=8${layers ? `&layers=${layers}` : ""}`, {
        waitUntil: "domcontentloaded",
      });
      await settled(page, 6000);
      // Across the middle of the view, which at this zoom is metropolitan
      // Portland — some of the brightest ground in the Pacific North-West.
      return sampleStrip(page, { x: 0, y: 340, width: 1200, height: 90 });
    };
    const bare = await stripOver(null);
    const lit = await stripOver("light-pollution");
    const brightened = Math.round(lit.max - bare.max);
    check(
      brightened >= 8,
      `the light-pollution field draws over the city (${brightened} levels brighter than the same view without it)`,
    );

    await openLayerPanel(page);
    const reading = await page.locator(".tk-map-layer-value").first().innerText();
    /**
     * The number, in the unit the archive is in.
     *
     * Not a Bortle class, not an SQM figure, not a limiting magnitude: those
     * are claims about the sky, and this is a measurement of the ground.
     */
    check(
      /nW\/cm²\/sr/.test(reading),
      `and the panel reads it as radiance at the selected point ("${reading}")`,
    );
    check(
      !/bortle|sqm|limiting magnitude/i.test(reading),
      "without claiming a sky-brightness figure it cannot support",
    );

    const legend = await page.evaluate(() => {
      const element = document.querySelector(".tk-map-legend");
      if (!element) return null;
      return {
        ticks: [...element.querySelectorAll(".tk-map-legend-scale li")].map((li) => li.textContent),
        here: Boolean(element.querySelector(".tk-map-legend-here")),
        label: element.getAttribute("aria-label") ?? "",
      };
    });
    check(legend !== null, "the field has a key on the map");
    check(
      legend?.ticks.join(",") === "0.25,1,4,16,64",
      `whose stops are the bands the reading's words come from (${legend?.ticks.join(", ")})`,
    );
    check(legend?.here === true, "and which marks where the selected place sits on it");

    await context.close();
  }

  /* --- the camera on selecting an event ----------------------------------- */
  console.log("\nEvent search and the camera");
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);

    const camera = () =>
      page.evaluate(() => {
        const map = window.__trackerMap;
        const centre = map.getCenter();
        return { lat: centre.lat, lng: centre.lng, zoom: map.getZoom() };
      });
    const search = async (text) => {
      const trigger = page.locator(".tk-eventfinder-trigger, .tk-eventfinder-current").first();
      await trigger.click();
      const field = page.locator(".tk-eventfinder-field input");
      await field.fill("");
      await field.type(text, { delay: 5 });
      await page.waitForTimeout(900);
    };

    /**
     * A global question, answered with the reader's own stake in it.
     *
     * "The next total solar eclipse" is a question about the sky; the row still
     * has to say what it does at the reader's coordinates, because that is the
     * fact that decides whether the answer matters to them.
     */
    await search("total solar eclipse");
    const labels = await page.locator(".tk-eventfinder-local").allInnerTexts();
    check(labels.length > 0, "a global search labels each result for the reader's own place");
    check(
      labels.every((label) => /here|horizon/i.test(label)),
      `and says it in local terms (${labels.slice(0, 2).join(", ")})`,
    );

    const before = await camera();
    await page.locator(".tk-eventfinder-results button").first().click();
    await page.waitForTimeout(2600);
    const after = await camera();

    /**
     * The map goes to the event.
     *
     * Selecting the 2027 totality used to change the date, draw a band across
     * North Africa, and leave the reader looking at Oregon: the overlay was
     * correct and entirely invisible.
     */
    check(
      Math.abs(after.lng - before.lng) > 20 || Math.abs(after.zoom - before.zoom) > 1,
      `selecting an eclipse moves the map to it (${before.lng.toFixed(1)}, z${before.zoom.toFixed(1)} → ${after.lng.toFixed(1)}, z${after.zoom.toFixed(1)})`,
    );
    check(
      after.zoom < before.zoom,
      "and pulls back far enough to hold the track rather than diving into it",
    );
    /* The viewport is URL state, so the flight has to end up recorded there —
       otherwise Back returns to an entry that never learned where it looked. */
    const recorded = await page.evaluate(() => new URLSearchParams(location.search).get("at"));
    const [recordedLat, recordedLng] = (recorded ?? "0,0").split(",").map(Number);
    check(
      Math.abs(recordedLng - after.lng) < 0.5 && Math.abs(recordedLat - after.lat) < 0.5,
      "and the URL records where it arrived",
    );

    /**
     * Selecting the event that is already selected does not fly again.
     *
     * The frame is recomputed whenever the overlay or the place changes, and
     * re-running the flight each time would take the map away from a reader who
     * had just panned it somewhere.
     */
    await page.evaluate(() => window.__trackerMap.jumpTo({ center: [10, 20], zoom: 3 }));
    await page.waitForTimeout(900);
    const moved = await camera();
    // Re-pick the event that is already showing, which is the thing that must
    // not re-run the flight.
    await search("total solar eclipse");
    await page.locator(".tk-eventfinder-results button").first().click();
    await page.waitForTimeout(2400);
    const still = await camera();
    check(
      Math.abs(still.lng - moved.lng) < 1 && Math.abs(still.zoom - moved.zoom) < 0.3,
      `and choosing the same event again leaves the map where the reader put it (${moved.lng.toFixed(1)}, z${moved.zoom.toFixed(1)} → ${still.lng.toFixed(1)}, z${still.zoom.toFixed(1)})`,
    );

    /**
     * A shower is framed around the reader, not around the planet.
     *
     * The Perseids at maximum are worth seeing from every longitude in the
     * northern mid-latitudes, so "the region worth going out in" is a band that
     * circles the Earth. Fitting that is a picture of the world.
     */
    await search("perseids");
    await page.locator(".tk-eventfinder-results button").first().click();
    await page.waitForTimeout(2600);
    const shower = await camera();
    check(
      Math.abs(shower.lng - (-122.7)) < 25 && shower.zoom > 2,
      `a shower frames the reader's own share of the band (${shower.lng.toFixed(1)}, z${shower.zoom.toFixed(1)})`,
    );

    await context.close();
  }

  /* --- local intent ------------------------------------------------------- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);

    await page.locator(".tk-eventfinder-trigger").first().click();
    const field = page.locator(".tk-eventfinder-field input");
    await field.type("next lunar eclipse visible here", { delay: 5 });
    await page.waitForTimeout(1200);
    const local = await page.locator(".tk-eventfinder-local").allInnerTexts();
    check(local.length > 0, "a local search returns something");
    check(
      local.every((label) => !/not visible/i.test(label)),
      `and returns only what can be seen from here (${local.slice(0, 2).join(", ")})`,
    );

    /**
     * A limit of the catalogue is a limit of the catalogue.
     *
     * Totality returns to a given town about once every three or four
     * centuries and the catalogue looks forward four years, so "none in range"
     * is the ordinary answer to a reasonable question — and it must not be
     * phrased as "there is no such event".
     */
    await field.fill("");
    await field.type("next total solar eclipse here", { delay: 5 });
    await page.waitForTimeout(1200);
    const empty = await page.locator(".tk-eventfinder-empty").innerText();
    check(
      /catalogue|covers/i.test(empty),
      `and names the catalogue's horizon when it runs out ("${empty}")`,
    );

    await context.close();
  }

  /* --- which way to face ------------------------------------------------- */
  console.log("\nObserving direction");
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=9`, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);

    const wedge = () =>
      page.evaluate(() => {
        const element = document.querySelector(".tk-map-target-bearing");
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          on: element.dataset.on === "true",
          bearing: Number.parseFloat(element.style.getPropertyValue("--tk-bearing")),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      });

    check((await wedge())?.on === false, "no direction is drawn until a card is open");

    // The first card is a planet or the Moon on any ordinary night: something
    // with a place in the sky to point at.
    await page.locator(".tk-rail-card-head").first().click();
    await page.waitForSelector('.tk-rail-card[data-expanded="true"]', { timeout: 5000 });
    await page.waitForTimeout(1200);

    const open = await wedge();
    check(open?.on === true, "opening a card the reader can point at draws one");

    /**
     * The map and the card have to name the same direction.
     *
     * They are two derivations of one fact, and they diverged once already:
     * the card reads the sky at the *recommended* moment while an earlier
     * version of the cue read it at the night's best, which put the wedge due
     * south of a card that said south-east. A reader who goes outside and finds
     * the map disagreeing with the card has been told two directions by one
     * product.
     */
    const said = await page
      .locator('.tk-rail-card[data-expanded="true"] .tk-rail-facts li')
      .last()
      .innerText();
    const cardinal = said.replace(/\s+/g, " ").match(/\b(N|NE|E|SE|S|SW|W|NW)\b/)?.[1] ?? null;
    const expected = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
      Math.round(((open?.bearing ?? 0) % 360) / 45) % 8
    ];
    check(
      cardinal !== null && cardinal === expected,
      `the wedge points where the card says (${cardinal ?? "no compass point"} on the card, ${expected} on the map)`,
    );

    /**
     * The same size at every zoom, because it is a heading and not a distance.
     *
     * Drawn as geography it would have a length, and a length on a map says the
     * planet is forty kilometres to the south-west. Fixed screen size is what
     * makes that reading impossible.
     */
    await page.evaluate(() => window.__trackerMap.zoomTo(4, { duration: 0 }));
    await page.waitForTimeout(1500);
    const zoomedOut = await wedge();
    check(
      zoomedOut?.width === open?.width && zoomedOut?.height === open?.height,
      `zooming out does not change its size (${open?.width}x${open?.height} at z9, ${zoomedOut?.width}x${zoomedOut?.height} at z4)`,
    );

    await context.close();
  }

  /* --- a shower has no direction to face --------------------------------- */
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    // The Perseid maximum, from a latitude where the shower is genuinely good.
    await page.goto(`${TRACKER}&date=2027-08-12&at=45.5,-122.7&z=8`, {
      waitUntil: "domcontentloaded",
    });
    await settled(page, 1500);
    await page.waitForTimeout(4000);
    await page.locator(".tk-rail-card-head").first().click();
    await page.waitForSelector('.tk-rail-card[data-expanded="true"]', { timeout: 5000 });
    await page.waitForTimeout(1200);

    const name = await page
      .locator('.tk-rail-card[data-expanded="true"] .tk-rail-card-name')
      .innerText();
    check(/perseid/i.test(name), `the shower leads its own peak night ("${name}")`);
    const said = await page
      .locator('.tk-rail-card[data-expanded="true"] .tk-rail-card-where')
      .innerText();
    check(/whole sky/i.test(said), `and the card says to take in the whole sky ("${said}")`);
    /**
     * No arrow for a radiant, even though the radiant has a bearing.
     *
     * Staring at the radiant is the commonest mistake in meteor watching —
     * trails there are head-on and almost pointlike — and the card's own
     * sentence tells the reader to look half the sky away from it. An arrow
     * would undo that sentence.
     */
    const on = await page.evaluate(
      () => document.querySelector(".tk-map-target-bearing")?.dataset.on === "true",
    );
    check(!on, "and the map does not point at the radiant anyway");

    await context.close();
  }

  /* --- world wrap with overlays ----------------------------------------- */
  console.log("\nOverlays across the antimeridian");
  {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    /**
     * Whether an overlay reaches a world copy, measured by turning it off.
     *
     * Comparing the two halves of one screenshot does not work: the eastern
     * Pacific is open ocean, so the basemap itself is flat there and a
     * featureless strip says nothing about the overlay. Differencing the same
     * view with and without the layer isolates exactly what the layer drew.
     */
    const stripWith = async (layers) => {
      await page.goto(`${TRACKER}&at=0,180&z=2${layers ? `&layers=${layers}` : ""}`, {
        waitUntil: "domcontentloaded",
      });
      await settled(page, 6000);
      return sampleStrip(page, { x: 0, y: 280, width: 1200, height: 90 });
    };
    const bare = await stripWith(null);
    const lit = await stripWith("twilight");
    /**
     * Sampled well east of the seam, in the copy that only exists because the
     * world wraps. An overlay confined to the canonical world changes nothing
     * here, however well it draws at home.
     */
    const eastOfSeam = (strip) => strip.columns.slice(760, 1160);
    const canonical = (strip) => strip.columns.slice(40, 440);
    const meanDiff = (a, b) =>
      a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
    const homeChange = meanDiff(canonical(lit), canonical(bare));
    const wrappedChange = meanDiff(eastOfSeam(lit), eastOfSeam(bare));
    check(homeChange > 0.6, `the twilight overlay draws at all (${homeChange.toFixed(2)} levels)`);
    check(
      wrappedChange > 0.6,
      `and reaches the world copy past the antimeridian (${wrappedChange.toFixed(2)} levels)`,
    );
    await context.close();
  }

  /* --- mobile layers ---------------------------------------------------- */
  console.log("\nMobile layers");
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await stub(context);
    await seed(context);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 1500);
    const topbar = await page.evaluate(() =>
      Math.round(document.querySelector(".tk-map-topbar").getBoundingClientRect().height),
    );
    check(topbar <= 110, `adding layers did not grow the mobile chrome (${topbar}px of 844)`);
    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    const panel = await page.evaluate(() => {
      const box = document.querySelector(".tk-layers-panel").getBoundingClientRect();
      return { top: Math.round(box.top), height: Math.round(box.height), width: Math.round(box.width) };
    });
    check(panel.width <= 390 && panel.height <= 844 * 0.7, `the layer panel fits the phone (${panel.width}x${panel.height})`);
    check(
      (await page.evaluate(() =>
        [...document.querySelectorAll(".tk-layers-item")].every(
          (el) => el.getBoundingClientRect().height >= 44,
        ),
      )) === true,
      "and its rows are still real touch targets",
    );

    /**
     * A phone has room for one sheet at a time.
     *
     * An expanded observing card and the layer panel are both most of a phone
     * screen, and opening the second over the first left a strip of map about a
     * centimetre tall — while the reader's reason for opening the panel was to
     * look at a field drawn on that map. The card's expanded *presentation* is
     * suppressed while the panel is open and comes back when it closes; what
     * must not happen is losing the selection, which lives in the URL, so the
     * URL is checked at every step rather than only at the end.
     */
    await page.keyboard.press("Escape");
    await page.waitForSelector(".tk-layers-panel", { state: "detached", timeout: 5000 });
    await page.locator(".tk-rail-card-head").first().click();
    await page.waitForSelector('.tk-rail-card[data-expanded="true"]', { timeout: 5000 });
    const urlWithCard = await page.evaluate(() => location.search);
    check(
      /[?&]card=/.test(urlWithCard),
      "expanding a card on a phone puts it in the URL",
    );
    const bodyShown = () =>
      page.evaluate(() => {
        const body = document.querySelector('.tk-rail-card[data-expanded="true"] .tk-rail-card-body');
        return Boolean(body) && getComputedStyle(body).display !== "none";
      });
    check(await bodyShown(), "and the card is actually unfolded");

    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    check(!(await bodyShown()), "opening Layers folds the expanded card away");
    check(
      (await page.evaluate(() => location.search)) === urlWithCard,
      "without changing the selection, the date, the place or the layers",
    );
    check(
      (await page.locator('.tk-rail-card[data-expanded="true"]').count()) === 1,
      "and the card is still the selected one",
    );
    const visibleMap = await page.evaluate(() => {
      const panel = document.querySelector(".tk-layers-panel").getBoundingClientRect();
      const rail = document.querySelector(".tk-rail").getBoundingClientRect();
      return Math.round(Math.min(panel.top, rail.top) - 0);
    });
    check(visibleMap >= 200, `and the map is still meaningfully visible (${visibleMap}px)`);

    await page.keyboard.press("Escape");
    await page.waitForSelector(".tk-layers-panel", { state: "detached", timeout: 5000 });
    check(await bodyShown(), "closing Layers brings the card back unfolded");
    check(
      (await page.evaluate(() => location.search)) === urlWithCard,
      "and everything it was showing is still what it was showing",
    );

    await context.close();
  }

  await browser.close();
  if (server) await server.close();

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("\nFailed:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

await main();
