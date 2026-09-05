/**
 * Does the product still work when the surfaces overlap?
 *
 * Tracker draws five families of furniture over one map: what you are looking
 * at (top left), when (top centre), what is drawn over it (top right), what you
 * do to the view (bottom right), and occasional context (bottom left). On a
 * desktop they sit in separate corners and never meet. On a phone they are all
 * competing for the same 360 points of width, and every one of them can open a
 * panel that covers most of the screen.
 *
 * This gate is about the meetings. It opens each panel at each width and asks
 * two questions a reader would ask: can I see all of it, and is the thing I can
 * see the thing I just opened?
 *
 * Deliberately not a stylesheet audit. Asserting `z-index: 20` proves only that
 * somebody typed 20; it says nothing about whether the panel is visible, because
 * a z-index is resolved inside its own stacking context and a panel trapped in a
 * container that ranks below its neighbour loses however large its own number
 * is. That is the exact bug this file exists to catch, so it tests the rendered
 * result: `elementFromPoint` over a grid of points across the open panel, which
 * is what the compositor actually did and what a finger actually hits. Whatever
 * is found at a point that does not belong to the panel is named, so a failure
 * says which surface is in the way rather than that one is.
 */
import { chromium } from "playwright";
import { preview } from "vite";
import { PORTLAND, seedPlace, stubTracker } from "./tracker-fixtures.mjs";

const ORIGIN = process.argv[2] ?? "http://127.0.0.1:4185";
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

/**
 * Every panel the top bar and the map controls can open.
 *
 * Named by what the reader pressed, not by the class, so a failure reads as a
 * sentence about the product rather than a selector that went missing.
 */
const SURFACES = [
  { name: "the place panel", trigger: ".tracker-place-current", panel: ".tracker-place-panel" },
  { name: "the calendar", trigger: ".tk-date-field", panel: ".tk-cal" },
  { name: "the equipment menu", trigger: ".tk-equipment-trigger", panel: ".tk-equipment-panel" },
  { name: "the event finder", trigger: ".tk-eventfinder-trigger", panel: ".tk-eventfinder-open" },
  { name: "the layer sheet", trigger: ".tk-layers-trigger", panel: ".tk-layers-panel" },
];

/**
 * Phones, a tablet, and a desktop.
 *
 * 320 is the narrowest width still worth supporting (an iPhone SE in its
 * smaller display mode); 360 and 390 are the two commonest Android and iPhone
 * widths; 375 is the older iPhone width that a great many people still hold.
 * The tablet and desktop entries are here so a fix aimed at a phone cannot
 * quietly break the case that already worked.
 */
const WIDTHS = [
  { width: 320, height: 720, mobile: true },
  { width: 360, height: 780, mobile: true },
  { width: 375, height: 812, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 900, mobile: false },
];

const settled = (page, ms = 1200) =>
  page
    .waitForSelector('.tk-map-canvas[data-map-settled="true"]', { timeout: 60_000 })
    .then(() => page.waitForTimeout(ms));

/** The tour covers the bar it is describing; a reader dismisses it, so do we. */
async function dismissTour(page) {
  for (let i = 0; i < 8; i += 1) {
    const button = page.locator(".tk-callout button").last();
    if ((await button.count()) === 0) return;
    await button.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(220);
  }
}

/**
 * What the compositor did, measured rather than assumed.
 *
 * The floating siblings are read out of the DOM instead of listed here, so a
 * surface added later is audited the day it appears rather than the day someone
 * remembers to add it to a list. Anything containing or contained by the panel
 * is skipped: nesting already fixes their order, and asking `elementFromPoint`
 * about an ancestor would report the ancestor's own descendant as an occluder.
 */
async function inspect(page, panelSelector) {
  return page.evaluate((selector) => {
    const panel = document.querySelector(selector);
    if (!panel) return { open: false };
    const box = panel.getBoundingClientRect();
    const radius = Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0;

    /* A grid over the panel itself, not over one neighbour at a time. The
       question a reader asks is "is the thing I can touch the thing I opened",
       and `elementFromPoint` answers it directly — including the case where the
       point falls through a hole in the panel to the map underneath, which no
       amount of comparing z-indexes would reveal.

       Whatever is found is named. An earlier version reported the neighbour it
       happened to be iterating, which meant a real defect was attributed to the
       map canvas simply because the canvas overlaps everything. */
    const lost = [];
    let sampled = 0;
    for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const fy of [0.15, 0.5, 0.85]) {
        const x = box.left + box.width * fx;
        const y = box.top + box.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        /* A rounded corner is outside the painted shape by design, so a point
           inside the corner's radius is not evidence of anything. */
        const dx = Math.min(x - box.left, box.right - x);
        const dy = Math.min(y - box.top, box.bottom - y);
        if (dx < radius && dy < radius && Math.hypot(radius - dx, radius - dy) > radius) continue;
        sampled += 1;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest(selector)) continue;
        const name = hit
          ? `${hit.tagName.toLowerCase()}${hit.className ? `.${String(hit.className).trim().split(/\s+/)[0]}` : ""}`
          : "nothing";
        lost.push(`${name} at ${Math.round(x)},${Math.round(y)}`);
      }
    }

    /* Can the reader press what the panel is for? The first control inside it
       has to be the topmost thing at its own centre, or the panel is a picture
       of a menu rather than a menu. */
    const control = panel.querySelector(
      'button, [role="option"], [role="gridcell"], a[href], input',
    );
    let operable = null;
    if (control) {
      const rect = control.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      operable = {
        ok: Boolean(hit && (control.contains(hit) || hit.contains(control) || hit === control)),
        name: (control.textContent ?? control.getAttribute("aria-label") ?? "").trim().slice(0, 32),
      };
    }

    return {
      open: true,
      rect: {
        left: Math.round(box.left),
        right: Math.round(box.right),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
      },
      viewport: { width: innerWidth, height: innerHeight },
      sampled,
      lost,
      operable,
    };
  }, panelSelector);
}

async function main() {
  let server = null;
  const reachable = await fetch(ORIGIN).then(
    () => true,
    () => false,
  );
  if (!reachable) {
    server = await preview({
      root: process.cwd(),
      preview: { host: "127.0.0.1", port: Number(new URL(ORIGIN).port), strictPort: true },
    });
  }
  const browser = await chromium.launch();

  /* --- the viewport declaration ----------------------------------------- */
  console.log("\nPinch zoom");
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(TRACKER, { waitUntil: "domcontentloaded" });
    const meta = await page.evaluate(
      () => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
    );
    /* A reader with low vision zooms the page. Suppressing that is the usual
       shortcut for stopping iOS zooming into a small input, and it trades one
       person's minor annoyance for another person's ability to use the site at
       all. The real fix is the input's font size, checked below. */
    check(
      !/user-scalable\s*=\s*no/i.test(meta) && !/maximum-scale/i.test(meta),
      `the page can still be pinched open ("${meta}")`,
    );
    await context.close();
  }

  /* --- the panels, at every width --------------------------------------- */
  for (const size of WIDTHS) {
    console.log(`\n${size.width}px`);
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      isMobile: size.mobile,
      hasTouch: size.mobile,
    });
    await stubTracker(context, { basemap: "empty", satellites: "unavailable" });
    await seedPlace(context, PORTLAND);
    const page = await context.newPage();
    await page.goto(`${TRACKER}&at=45.5,-122.7&z=8`, { waitUntil: "domcontentloaded" });
    await settled(page, 1400);
    await dismissTour(page);

    for (const surface of SURFACES) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(220);
      const trigger = page.locator(surface.trigger).first();
      if ((await trigger.count()) === 0) continue;
      await trigger.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(520);

      const seen = await inspect(page, surface.panel);
      if (!seen.open) {
        check(false, `${surface.name} opens at ${size.width}px`);
        continue;
      }

      /* Off the left or right edge is unreachable: the page does not scroll
         sideways, so whatever hangs over the edge is simply gone. */
      const inside = seen.rect.left >= 0 && seen.rect.right <= seen.viewport.width;
      check(
        inside,
        `${surface.name} stays on screen at ${size.width}px (${seen.rect.left}…${seen.rect.right} of ${seen.viewport.width})`,
      );

      check(
        seen.lost.length === 0,
        `every point of ${surface.name} belongs to it at ${size.width}px (${
          seen.lost.length
            ? `${seen.lost.length}/${seen.sampled} lost to ${seen.lost.join("; ")}`
            : `${seen.sampled} points clear`
        })`,
      );

      if (seen.operable) {
        check(
          seen.operable.ok,
          `${surface.name} can be pressed at ${size.width}px ("${seen.operable.name}")`,
        );
      }

      if (size.mobile) {
        /* iOS Safari zooms the layout when a focused input's text is smaller
           than 16px, and never zooms back out. That is the "why has the page
           jumped" report: it is the text size, not the viewport tag.

           Measured with the panel open, because that is the only time these
           fields exist. An earlier version of this check ran against the closed
           map, found no inputs at all, and passed. */
        const small = await page.evaluate((selector) => {
          const panel = document.querySelector(selector);
          if (!panel) return [];
          return [...panel.querySelectorAll("input, select, textarea")]
            .filter((node) => node.getClientRects().length > 0)
            .map((node) => ({
              name:
                node.getAttribute("aria-label") ??
                node.getAttribute("placeholder") ??
                String(node.className),
              size: Number.parseFloat(getComputedStyle(node).fontSize),
            }))
            .filter((entry) => entry.size < 16);
        }, surface.panel);
        if (await page.locator(`${surface.panel} input`).count()) {
          check(
            small.length === 0,
            `no field in ${surface.name} is small enough to make iOS zoom at ${size.width}px (${
              small.map((e) => `${e.name} ${e.size}px`).join("; ") || "all at least 16px"
            })`,
          );
        }
      }
    }
    await page.keyboard.press("Escape");

    /* --- the search a reader actually performs --------------------------- */
    const finder = page.locator(".tk-eventfinder-trigger").first();
    if (await finder.count()) {
      await finder.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
      const field = page.locator(".tk-eventfinder-field input");
      await field.fill("eclipse").catch(() => {});
      await page.waitForTimeout(500);
      const results = await page.locator(".tk-eventfinder-results li").count();
      check(results > 0, `typing into the event finder finds something at ${size.width}px (${results})`);
      const focused = await page.evaluate(
        () => document.activeElement?.closest(".tk-eventfinder-field") !== null,
      );
      check(focused, `and the field keeps focus while the results arrive at ${size.width}px`);

      /*
        The results list is bounded by the visible height, not the window's.
 
        This checks the wiring, not the keyboard: a headless browser has no
        on-screen keyboard, so the visual viewport never shrinks and the two
        heights are equal here. What it can prove is that the property is
        published, that it tracks `visualViewport`, and that the list's height is
        actually derived from it — so if the effect is removed or the property
        renamed, this fails rather than waiting for a phone to find out.
      */
      const bound = await page.evaluate(() => {
        const published = getComputedStyle(document.documentElement)
          .getPropertyValue("--tk-visual-height")
          .trim();
        const list = document.querySelector(".tk-eventfinder-results");
        return {
          published,
          matchesViewport:
            published === `${Math.round(window.visualViewport?.height ?? innerHeight)}px`,
          max: list ? Math.round(Number.parseFloat(getComputedStyle(list).maxHeight)) : null,
          visible: Math.round(window.visualViewport?.height ?? innerHeight),
        };
      });
      check(
        bound.matchesViewport && bound.max !== null && bound.max < bound.visible,
        `the results are bounded by what is visible at ${size.width}px (--tk-visual-height ${
          bound.published || "unset"
        }, list capped at ${bound.max}px of ${bound.visible}px)`,
      );
      await page.keyboard.press("Escape");
    }

    await context.close();
  }

  await browser.close();
  if (server) await server.close();

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
  }
}

await main();
