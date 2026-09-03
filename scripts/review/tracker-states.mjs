/**
 * The Tracker product states a review package is made of, and the engine that
 * drives them.
 *
 * ## Why this is shared
 *
 * Two things need these states: the aggregate pass package, which shows the
 * whole feature, and a commit package, which shows the part one commit
 * changed. If each carried its own copy of "open the cloud layer and wait for
 * the field", they would drift, and then a commit's evidence would be of a
 * slightly different product than the pass's evidence of the same day.
 *
 * ## What a state is
 *
 * A state drives the real product to a situation and then *checks the
 * situation arrived* before the frame is kept. The check returns a short string
 * describing what was actually found, which is written into the manifest beside
 * the file. A state whose precondition fails is recorded as a failure — never
 * saved as a plausible picture of something else.
 *
 * ## Live data and fixtures
 *
 * The basemap and all the astronomy are live. Orbits and the cloud mask are
 * pinned, because states like "a visible station pass" and "an observed cloud
 * field" are states the sky has to cooperate with, and evidence that can only
 * be produced on a clear night with the ISS overhead is evidence nobody can
 * reproduce. The fixtures are the ones the refinement gate asserts against,
 * imported rather than copied, so a picture and an assertion are about the same
 * night. Every caption that rests on a fixture says so.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PORTLAND,
  SATELLITE_CLOCK,
  seedPlace,
  stubCloudForecast,
  stubCloudMask,
  stubTracker,
} from "../verify/tracker-fixtures.mjs";

export { SATELLITE_CLOCK };

const shots = [];
const problems = [];

/**
 * Take one shot, but only after its precondition holds.
 *
 * `expect` returns a short string describing what was actually found. It is
 * written into the manifest beside the file, so a reader can see what the
 * picture was checked for rather than taking the filename's word for it.
 */
/**
 * Build the capture function for one run.
 *
 * A factory rather than a free function because the run owns the manifest, the
 * failure list and the destination — and because `only` has to be able to skip
 * a state without the caller writing a conditional around every call site.
 */
function makeCapture({ shots, problems, wanted, shotsDir }) {
  return async function capture(page, id, caption, expect, options = {}) {
    if (wanted && !wanted.has(id)) return;
    let found = null;
    try {
      found = await expect();
    } catch (error) {
      found = `threw: ${error.message}`;
    }
    const ok = typeof found === "string" && found.length > 0;
    const file = `${id}.png`;
    await page.screenshot({ path: path.join(shotsDir, file), ...options });
    shots.push({ id, file, caption, verified: ok, observed: found ?? "nothing" });
    console.log(`  ${ok ? "✓" : "✗"} ${id} — ${found ?? "precondition not met"}`);
    if (!ok) problems.push(`${id}: ${caption}`);
  };
}

/**
 * Wait until the map has actually finished drawing, not merely settled.
 *
 * `data-map-settled` says the camera has come to rest. It says nothing about
 * whether the tiles under it have arrived, and the first pictures taken here
 * caught the hillshade half-loaded: hard rectangular blocks across the
 * Coast Range, which look like a rendering bug and are only a screenshot taken
 * too early. `map.loaded()` is MapLibre's own answer to "is everything for this
 * view in", so the shot waits for that as well.
 */
async function settled(page, ms = 1500) {
  await page.waitForSelector('.tk-map-canvas[data-map-settled="true"]', { timeout: 60_000 });
  await page
    .waitForFunction(() => window.__trackerMap?.loaded?.() === true, null, { timeout: 45_000 })
    .catch(() => {});
  await page.waitForTimeout(ms);
}

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

/** A context with the basemap live and the pinned feeds routed. */
async function open(browser, { viewport, satellites = "unavailable", cloud = null, mobile = false }) {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 2,
  });
  await stubTracker(context, { basemap: "live", satellites });
  await seedPlace(context, PORTLAND);
  if (cloud) {
    await stubCloudMask(context, { ...cloud.mask, nowUtc: SATELLITE_CLOCK.toISOString() });
    await stubCloudForecast(context, cloud.percent);
  }
  const page = await context.newPage();
  await page.clock.setFixedTime(SATELLITE_CLOCK);
  return { context, page };
}

/**
 * The whole of an element's text, collapsed.
 *
 * Not truncated. An earlier version cut this to ninety characters for tidy log
 * lines, and then a precondition testing for a sentence near the end of a long
 * reading failed against a string that had had that sentence removed — by the
 * test, not by the product. Shortening is the caller's job, after the check.
 */
const text = (page, selector) =>
  page
    .locator(selector)
    .first()
    .innerText()
    .then((value) => value.replace(/\s+/g, " ").trim())
    .catch(() => "");

const brief = (value, limit = 90) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;


/**
 * Run a set of states against an open browser, writing frames into `shotsDir`.
 *
 * Returns the manifest entries and the ids that could not be verified, so the
 * caller decides what a failure means: an aggregate package reports it, a
 * commit package refuses to claim the commit is evidenced.
 */
export async function captureStates({ browser, origin, shotsDir, only = null }) {
  const TRACKER = `${origin}/?app=tracker`;
  const shots = [];
  const problems = [];
  const wanted = only ? new Set(only) : null;
  const capture = makeCapture({ shots, problems, wanted, shotsDir });

  await mkdir(shotsDir, { recursive: true });



  const desktop = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };

  /* --- the map, on a desktop ---------------------------------------------- */
  console.log("\nDesktop");
  {
    const { context, page } = await open(browser, { viewport: desktop });
    await page.goto(`${TRACKER}&at=45.52,-122.68&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 4000);
    await dismissTour(page);
    await capture(page, "01-desktop-2d", "The map as a reader arrives: 2D, Portland, tonight's rail.", async () =>
      (await page.locator(".tk-rail-card").count()) > 0
        ? `${await page.locator(".tk-rail-card").count()} rail cards, 2D active`
        : "",
    );

    // The control is a radio group, so the selected option carries
    // `aria-checked`, and the projection is read the way the gate reads it.
    await page.locator(".tk-projection-option[aria-label*='3D']").click();
    await page.waitForTimeout(1500);
    /**
     * Pulled back until the sphere is a sphere.
     *
     * At the zoom the rest of these shots are taken at, the globe projection is
     * indistinguishable from the flat one — there is no curvature across two
     * hundred kilometres. A picture captioned "the globe" that a reader cannot
     * tell from the picture above it is not evidence of anything, however
     * correctly `getProjection()` reports it.
     */
    await page.evaluate(() =>
      window.__trackerMap.easeTo({ center: [-100, 30], zoom: 1.6, duration: 1800 }),
    );
    await page.waitForTimeout(3000);
    await settled(page, 2500);
    await capture(
      page,
      "02-desktop-3d-globe",
      "The same layers on a sphere, pulled back far enough to see it is one: one style, one set of layers, no second renderer. MapLibre's default atmosphere is off — a blue halo is a flourish on a map about how dark the sky is.",
      async () => {
      const state = await page.evaluate(() => {
        const map = window.__trackerMap;
        const style = map.getStyle();
        return {
          projection: (map.getProjection?.() ?? style.projection ?? { type: "mercator" }).type,
          selected: document
            .querySelector('.tk-projection-option[data-current="true"]')
            ?.getAttribute("aria-label"),
        };
      });
        return state.projection === "globe"
          ? `projection ${state.projection}, "${state.selected}"`
          : "";
      },
    );
    await context.close();
  }

  /* --- the telescope rule ------------------------------------------------- */
  {
    const { context, page } = await open(browser, { viewport: desktop });
    await page.goto(`${TRACKER}&at=45.52,-122.68&z=8&equipment=telescope`, {
      waitUntil: "domcontentloaded",
    });
    await settled(page, 4000);
    await dismissTour(page);
    await capture(
      page,
      "03-telescope-rule",
      "Telescope selected: the rail carries deep-sky targets a naked eye could not reach.",
      async () => {
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll(".tk-rail-card")].map((c) => c.dataset.card ?? ""),
        );
        const deep = cards.filter((id) => id.startsWith("deep-sky"));
        return deep.length ? `${deep.length} deep-sky cards: ${deep.join(", ")}` : "";
      },
    );
    await context.close();
  }

  /* --- cloud, observed and forecast --------------------------------------- */
  console.log("\nCloud");
  {
    const { context, page } = await open(browser, {
      viewport: desktop,
      /**
       * Bands rather than a wash, and a series whose newest frame agrees with
       * the field. The first version gave the field "probably cloudy" and the
       * series a newest frame of "cloudy", so the key said one thing and the
       * map showed another — a disagreement invented by the fixture, which a
       * reader would reasonably read as the product contradicting itself.
       */
      cloud: { mask: { acm: 2, series: [0, 0, 2, 2], pattern: "banded" }, percent: 64 },
    });
    await page.goto(`${TRACKER}&at=45.52,-122.68&z=7&layers=cloud`, {
      waitUntil: "domcontentloaded",
    });
    await settled(page, 5000);
    await dismissTour(page);
    await capture(
      page,
      "04-cloud-observed",
      "Cloud viewing conditions: NOAA's four-level classification drawn as observing suitability, hatched where it is worth working around. The banding is the fixture, laid out so all four levels appear at once — real cloud is not striped. Basemap and astronomy live.",
      async () => {
        const key = await page.locator(".tk-cloud-key").count();
        const now = await text(page, ".tk-cloud-key-now");
        const observed = await page.locator('.tk-cloud-cell[data-basis="observed"]').count();
        return key === 1 && observed > 0 ? `${observed} observed cells; "${brief(now)}"` : "";
      },
    );

    // Scrub to the far end of the window, which is forecast rather than seen.
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
    await page.waitForTimeout(2500);
    await capture(
      page,
      "05-cloud-forecast",
      "The same night scrubbed past the last observation: the reading names the hour, the level and the model, and says it is a forecast.",
      async () => {
        const now = await text(page, ".tk-cloud-key-now");
        return /forecast/i.test(now) ? `"${brief(now)}"` : "";
      },
    );

    await page.locator(".tk-layers-trigger").click();
    await page.waitForSelector(".tk-layers-panel", { timeout: 5000 });
    await page.waitForTimeout(600);
    await capture(
      page,
      "06-cloud-reading",
      "What the layer says at the reader's own point, including how wide a satellite pixel is.",
      async () => {
        const reading = await text(page, ".tk-map-layer-reading");
        return /km across/.test(reading) ? brief(reading) : "";
      },
    );
    await context.close();
  }

  /* --- spacecraft, present and absent ------------------------------------- */
  console.log("\nSatellites");
  {
    const { context, page } = await open(browser, { viewport: desktop, satellites: "full" });
    await page.goto(`${TRACKER}&at=45.52,-122.68&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 4000);
    await page.waitForTimeout(3000);
    await dismissTour(page);
    await capture(
      page,
      "07-iss-visible",
      "A station pass that clears the naked-eye rule, offered on the rail. Orbit fixtured; the prediction is computed.",
      async () => {
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll(".tk-rail-card")].map((c) => c.dataset.card ?? ""),
        );
        return cards.includes("satellite-iss") ? `rail: ${cards.join(", ")}` : "";
      },
    );

    const head = page.locator('.tk-rail-card[data-card="satellite-iss"] .tk-rail-card-head');
    if (await head.count()) {
      await head.click();
      await page.waitForTimeout(1200);
      await capture(
        page,
        "08-iss-expanded",
        "The pass opened: the facts it was admitted on, rather than a score.",
        async () => {
          const facts = await page.locator('.tk-rail-card[data-expanded="true"] .tk-rail-facts li').count();
          return facts > 0 ? `${facts} facts listed` : "";
        },
      );
    }
    await context.close();
  }
  {
    const { context, page } = await open(browser, { viewport: desktop, satellites: "unavailable" });
    await page.goto(`${TRACKER}&at=45.52,-122.68&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 4000);
    await page.waitForTimeout(2500);
    await dismissTour(page);
    await capture(
      page,
      "09-no-satellites",
      "With no element set published, nothing is offered as a pass — the rail simply does not carry one.",
      async () => {
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll(".tk-rail-card")].map((c) => c.dataset.card ?? ""),
        );
        const none = !cards.some((id) => id.startsWith("satellite"));
        return none && cards.length ? `rail without spacecraft: ${cards.join(", ")}` : "";
      },
    );
    await context.close();
  }

  /* --- the rail, on a phone ----------------------------------------------- */
  console.log("\nMobile rail");
  {
    const { context, page } = await open(browser, { viewport: phone, mobile: true });
    await page.goto(`${TRACKER}&at=45.52,-122.68&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 4000);
    await dismissTour(page);
    await capture(page, "10-mobile-rail", "The rail at rest on a phone.", async () => {
      const count = await page.locator(".tk-rail-card").count();
      const left = await page.evaluate(
        () => document.querySelector(".tk-rail-scroll")?.scrollLeft ?? -1,
      );
      return count > 0 ? `${count} cards, scrollLeft ${left}` : "";
    });

    await page.evaluate(() => {
      const strip = document.querySelector(".tk-rail-scroll");
      strip.scrollLeft = strip.scrollWidth - strip.clientWidth;
    });
    await page.waitForTimeout(900);
    await capture(page, "11-mobile-rail-scrolled", "Swiped to the later cards.", async () => {
      const state = await page.evaluate(() => {
        const strip = document.querySelector(".tk-rail-scroll");
        return { left: Math.round(strip.scrollLeft), max: Math.round(strip.scrollWidth - strip.clientWidth) };
      });
      return state.left > 0 && state.left >= state.max - 2
        ? `scrolled to ${state.left} of ${state.max}`
        : "";
    });

    /**
     * The corrected containment rule, not the superseded one.
     *
     * The original brief asked for a picture of the selected card "moved to
     * first position". That behaviour was withdrawn: selecting a card now moves
     * the rail only when part of the card would otherwise be hidden, and then by
     * the minimum distance. So this photographs the rule that is actually in the
     * product — a card selected near the end stays where it is, fully visible,
     * and the rail does not jump.
     */
    const last = page.locator(".tk-rail-card-head").last();
    const before = await page.evaluate(() =>
      Math.round(document.querySelector(".tk-rail-scroll").scrollLeft),
    );
    await last.click();
    await page.waitForTimeout(1400);
    // The terrain horizon is fetched when a card opens and shows "Checking the
    // terrain horizon…" until it lands. Photographing the pending state is
    // honest but uninformative, so the shot waits for the answer.
    await page
      .waitForFunction(
        () => !/Checking the terrain/i.test(document.querySelector(".tk-rail")?.textContent ?? ""),
        null,
        { timeout: 20_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(800);
    await capture(
      page,
      "12-mobile-selected-contained",
      "A card selected at the far end: fully visible, clear of the map controls, and the rail moved only as far as it had to.",
      async () => {
        const framing = await page.evaluate(() => {
          const strip = document.querySelector(".tk-rail-scroll");
          const card = document.querySelector('.tk-rail-card[data-expanded="true"]');
          if (!strip || !card) return null;
          const box = strip.getBoundingClientRect();
          const controls = document.querySelector(".tk-map-controls-view");
          const over = controls?.getBoundingClientRect();
          const overlaps = over && over.left < box.right && over.right > box.left;
          const right = overlaps ? Math.min(box.right, over.left) : box.right;
          const rect = card.getBoundingClientRect();
          return {
            clippedLeft: Math.round(Math.max(0, box.left - rect.left)),
            clippedRight: Math.round(Math.max(0, rect.right - right)),
            scrollLeft: Math.round(strip.scrollLeft),
          };
        });
        if (!framing) return "";
        return framing.clippedLeft <= 1 && framing.clippedRight <= 1
          ? `fully visible; rail moved ${Math.abs(framing.scrollLeft - before)}px`
          : "";
      },
    );

    await capture(
      page,
      "13-mobile-expanded-controls",
      "Expanded, with the Layers and map controls exactly where they were.",
      async () => {
        const state = await page.evaluate(() => {
          const controls = document.querySelector(".tk-map-controls-view");
          const card = document.querySelector('.tk-rail-card[data-expanded="true"]');
          if (!controls || !card) return null;
          const c = controls.getBoundingClientRect();
          return {
            controlsTop: Math.round(c.top),
            onScreen: c.bottom <= window.innerHeight + 1 && c.top >= 0,
            cardBottom: Math.round(card.getBoundingClientRect().bottom),
          };
        });
        return state?.onScreen ? `controls at y=${state.controlsTop}, still on screen` : "";
      },
    );
    await context.close();
  }

  /* --- the embedded event map --------------------------------------------- */
  console.log("\nEvent map");
  {
    const { context, page } = await open(browser, { viewport: desktop });
    await page.goto(
      `${TRACKER}&at=45.52,-122.68&z=4&date=2027-02-06&show=solar-eclipse-2027-02-06`,
      { waitUntil: "domcontentloaded" },
    );
    await settled(page, 4500);
    await dismissTour(page);
    await capture(
      page,
      "14-event-map",
      "An eclipse selected on the map: the band, the centre line and the coverage field, drawn by the same renderer as the rest.",
      async () => {
        const layers = await page.evaluate(() =>
          window.__trackerMap
            ? window.__trackerMap.getStyle().layers.map((l) => l.id).filter((id) => /event|eclipse/.test(id))
            : [],
        );
        return layers.length ? `event layers: ${layers.join(", ")}` : "";
      },
    );
    await context.close();
  }

  /* --- licensing ---------------------------------------------------------- */
  console.log("\nLicensing");
  {
    const context = await browser.newContext({ viewport: desktop, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
    /**
     * Wait for the page, not for a stopwatch.
     *
     * The homepage prepares a large satellite catalogue before it renders, and
     * a fixed two and a half seconds photographed the loading spinner on a busy
     * machine. The check caught it — which is the point of checking — but the
     * fix is to wait for the heading that only the loaded page has.
     */
    await page.waitForSelector("#orbit-home-title", { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await capture(
      page,
      "15-home-licensing",
      "The homepage: the products are named separately where their terms differ — Explorer and Playground offered for reuse, Tracker not — instead of one open-source claim over all three.",
      async () => {
        const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        /**
         * The claim has to be attached to products, not merely present.
         *
         * An earlier version matched the word "licen" anywhere, and passed on
         * the footer's "License" link while the sentence that actually does the
         * work sits in About — where it names which tools are offered for reuse
         * and which is not. A check that a link exists is not a check that the
         * page tells the truth about its terms.
         */
        const statement = (body.match(/[^.]*not offered for reuse[^.]*\./) ?? [])[0];
        if (!statement) return "";
        const separates = /Explorer/.test(statement) && /Tracker/.test(statement);
        return separates ? brief(statement.trim()) : "";
      },
      { fullPage: true },
    );
    await context.close();
  }





  return { shots, problems };
}

/**
 * Render a contact sheet as a page and photograph it.
 *
 * Built this way rather than composited so it carries each caption and whether
 * the state was verified — the part of a contact sheet that does any work — and
 * so the tooling needs no image binary that may not be installed.
 */
export async function writeContactSheet({ browser, shotsDir, outFile, shots, title }) {
  const htmlPath = path.join(shotsDir, "contact-sheet.html");
  await writeFile(htmlPath, contactSheetHtml(shots, title));
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: outFile, fullPage: true });
  await context.close();
}

/** The contact sheet's own markup. Plain and dense; it is an index, not a page. */
function contactSheetHtml(entries, title = "Tracker review") {
  const cards = entries
    .map(
      (shot) => `
      <figure>
        <img src="${shot.file}" alt="${shot.caption.replace(/"/g, "&quot;")}" />
        <figcaption>
          <b>${shot.id}</b>
          <span class="${shot.verified ? "ok" : "bad"}">${shot.verified ? "verified" : "NOT VERIFIED"}</span>
          <p>${shot.caption}</p>
          <code>${String(shot.observed).replace(/</g, "&lt;")}</code>
        </figcaption>
      </figure>`,
    )
    .join("");
  return `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 28px 28px 40px;
    background: #0b0e14; color: #e8edf6;
    font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.01em; }
  .lede { margin: 0 0 22px; color: #9aa7bd; max-width: 74ch; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  figure { margin: 0; background: #121722; border: 1px solid #1e2836; border-radius: 10px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; border-bottom: 1px solid #1e2836; }
  figcaption { padding: 9px 11px 11px; }
  b { font-size: 12px; letter-spacing: 0.02em; }
  span { margin-left: 7px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
  .ok { color: #6fcf97; }
  .bad { color: #eb5757; }
  p { margin: 5px 0 6px; color: #c3cee2; font-size: 12px; }
  code { display: block; color: #7f8ca4; font-size: 10.5px; word-break: break-word; }
</style>
<h1>${title}</h1>
<p class="lede">
  Each frame was driven to its state and checked before it was saved; the line
  under each caption is what was actually found, not what was expected. The
  basemap and the astronomy are live. Orbits and the cloud mask are pinned
  fixtures, shared with the refinement gate, so the pictures and the assertions
  are about the same night.
</p>
<div class="grid">${cards}</div>
`;
}
