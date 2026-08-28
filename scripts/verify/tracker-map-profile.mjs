/**
 * What opening the expanded eclipse map actually costs.
 *
 * ## Why this is a script rather than a paragraph in a report
 *
 * The expanded lunar map blocked the main thread for seconds at phone width,
 * and the reason it survived a full verification pass is that nothing measured
 * it. The walkthrough tapped the control and waited for a map; a map that takes
 * three seconds to arrive satisfies that exactly as well as one that takes
 * thirty milliseconds.
 *
 * So the cost is measured, and measured the way a reader experiences it: how
 * long the main thread is unavailable, and how much of the document the browser
 * has been asked to build. Both are properties of the interaction rather than
 * of the machine, which is what makes them safe to assert on.
 *
 * ## What is deliberately not asserted
 *
 * Wall-clock time to a painted map. It is the number everyone wants and it is
 * the one that cannot be trusted here: a headless browser on a loaded CI box
 * paints when it gets round to it, and a threshold low enough to catch a
 * regression would fail on an unlucky afternoon. Long-task duration and node
 * count do not move with machine load in that way — a sixteen-thousand-node
 * field is sixteen thousand nodes on any hardware.
 *
 *   node scripts/verify/tracker-map-profile.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.TRACKER_BASE_URL ?? "http://localhost:4181";
const TRACKER = `${BASE}/?app=tracker`;
/** A partial lunar eclipse visible from Portland; the same night the walk pins. */
const ECLIPSE_NIGHT = "2028-01-11";
const PORTLAND = {
  name: "Portland",
  context: "Oregon, United States",
  latitude: 45.5152,
  longitude: -122.6784,
};

/**
 * One open, measured.
 *
 * `longtask` entries are the browser's own record of the main thread being
 * unavailable for 50 ms or more, which is exactly the thing a reader feels as
 * the interface freezing.
 */
async function measureOpen(page) {
  await page.evaluate(() => {
    window.__tk = { tasks: [] };
    window.__tkObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__tk.tasks.push(Math.round(entry.duration));
    });
    window.__tkObserver.observe({ entryTypes: ["longtask"] });
    window.__tk.t0 = performance.now();
  });

  await page.locator(".tk-viz-open", { hasText: /open full map/i }).first().click();
  await page.waitForSelector(".tk-overlay .tk-geomap", { timeout: 60_000 });
  // Let anything the open scheduled actually run before the tally is read.
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    window.__tkObserver.disconnect();
    const overlay = document.querySelector(".tk-overlay .tk-geomap");
    return {
      elapsedMs: Math.round(performance.now() - window.__tk.t0),
      longTasks: window.__tk.tasks,
      blockedMs: window.__tk.tasks.reduce((a, b) => a + b, 0),
      longestTaskMs: window.__tk.tasks.length ? Math.max(...window.__tk.tasks) : 0,
      svgNodes: overlay ? overlay.querySelectorAll("svg *").length : 0,
      rects: overlay ? overlay.querySelectorAll("rect").length : 0,
      paths: overlay ? overlay.querySelectorAll("path").length : 0,
    };
  });
}

async function closeOverlay(page) {
  await page.locator(".tk-overlay .tk-icon-button").first().click();
  await page.waitForSelector(".tk-overlay", { state: "detached", timeout: 20_000 });
  await page.waitForTimeout(400);
}

export async function profileExpandedMap({ width = 390, height = 844 } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  await context.addInitScript((place) => {
    localStorage.setItem(
      "orbit-studio:tracker:confirmed-place:v1",
      JSON.stringify({ version: 1, place }),
    );
  }, { ...PORTLAND, fromDevice: false });

  const page = await context.newPage();
  await page.goto(`${TRACKER}&date=${ECLIPSE_NIGHT}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector(".tk-page[data-category='eclipses']", { timeout: 60_000 });
  await page.waitForTimeout(4000);

  const first = await measureOpen(page);
  await closeOverlay(page);
  const reopen = await measureOpen(page);

  await page.close();
  await context.close();
  await browser.close();
  return { viewport: `${width}x${height}`, first, reopen };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await profileExpandedMap();
  const line = (label, m) =>
    `  ${label.padEnd(8)} blocked ${String(m.blockedMs).padStart(5)} ms  ` +
    `longest ${String(m.longestTaskMs).padStart(4)} ms  ` +
    `elapsed ${String(m.elapsedMs).padStart(5)} ms  ` +
    `svg nodes ${String(m.svgNodes).padStart(6)}  (rect ${m.rects}, path ${m.paths})`;
  console.log(`\nExpanded eclipse map, ${result.viewport}`);
  console.log(line("open", result.first));
  console.log(line("reopen", result.reopen));
  console.log("");
}
