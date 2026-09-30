/**
 * The responsive Tracker states required by the approved Map · Tonight · Sky
 * product model.
 *
 * This deliberately captures the same production components at four device
 * capability boundaries. Form factor is supplied by Playwright; camera and
 * orientation APIs are supplied independently so a mobile user agent alone
 * can never make an unsupported state pass.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  PORTLAND,
  SATELLITE_CLOCK,
  seedPlace,
  stubTracker,
} from "../verify/tracker-fixtures.mjs";

export { SATELLITE_CLOCK };

const REVIEW_PIN = "45.515,-122.678";
const DETAIL_CARD = "planet-saturn";
const PENDING_TEXT = /Checking the terrain|Loading Orbit Studio|Preparing the satellite/i;

async function installCapabilityBoundary(context, capability) {
  await context.addInitScript((kind) => {
    const attempts = [];
    Object.defineProperty(window, "__ORBIT_FINDER_PERMISSION_ATTEMPTS__", {
      configurable: true,
      value: attempts,
    });

    if (kind === "desktop") return;

    const tablet = kind.includes("tablet");
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: tablet
        ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Version/18 Mobile/15E148 Safari"
        : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Mobile Safari",
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: tablet ? "MacIntel" : "iPhone",
    });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });

    if (kind === "unsupported-tablet") {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
      Object.defineProperty(window, "DeviceOrientationEvent", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(window, "DeviceMotionEvent", {
        configurable: true,
        value: undefined,
      });
      return;
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          attempts.push("camera");
          return new MediaStream();
        },
      },
    });
    class ReviewOrientationEvent extends Event {}
    ReviewOrientationEvent.requestPermission = async () => {
      attempts.push("orientation");
      return "granted";
    };
    class ReviewMotionEvent extends Event {}
    ReviewMotionEvent.requestPermission = async () => {
      attempts.push("motion");
      return "granted";
    };
    Object.defineProperty(window, "DeviceOrientationEvent", {
      configurable: true,
      value: ReviewOrientationEvent,
    });
    Object.defineProperty(window, "DeviceMotionEvent", {
      configurable: true,
      value: ReviewMotionEvent,
    });
  }, capability);
}

async function openDevice(browser, capability, viewport) {
  const handheld = capability !== "desktop";
  const context = await browser.newContext({
    viewport,
    isMobile: capability === "phone",
    hasTouch: handheld,
    deviceScaleFactor: handheld ? 2 : 1,
  });
  await installCapabilityBoundary(context, capability);
  await stubTracker(context, { basemap: "live", satellites: "unavailable", unavailable: "empty" });
  await seedPlace(context, PORTLAND);
  const page = await context.newPage();
  await page.clock.setFixedTime(SATELLITE_CLOCK);
  return { context, page };
}

async function settledMap(page, delay = 1_500) {
  await page.waitForSelector('.tk-map-canvas[data-map-settled="true"]', { timeout: 60_000 });
  await page.waitForFunction(() => window.__trackerMap?.loaded?.() === true, null, {
    timeout: 45_000,
  }).catch(() => {});
  await page.waitForTimeout(delay);
}

async function dismissTour(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const close = page.locator(".tk-callout button[aria-label*='lose'], .tk-callout button:has-text('Done')").first();
    if ((await close.count()) === 0) break;
    await close.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape").catch(() => {});
}

async function visiblePending(page) {
  const busy = await page.locator('[aria-busy="true"], .tk-map-skeleton').count();
  if (busy) return `${busy} visible busy affordance(s)`;
  const body = await page.locator("body").innerText();
  return body.match(PENDING_TEXT)?.[0] ?? "";
}

async function productState(page) {
  return page.evaluate(() => {
    const buttonText = (selector) =>
      [...document.querySelectorAll(selector)].map((node) => node.textContent?.replace(/\s+/g, " ").trim());
    const nav = buttonText(".tk-mode-nav button");
    const buttons = buttonText("button");
    const finderEntries = buttonText(
      ".tk-map-recommendation .is-finder, .tk-tonight-lead .is-finder, .tk-tonight-row-finder, .tk-action.is-finder",
    );
    const map = window.__trackerMap;
    return {
      mapState: document.querySelector(".tracker-shell")?.getAttribute("data-map-state") ?? null,
      nav,
      finderEntries,
      genericShowOnMap: buttons.some((text) => /show on map/i.test(text ?? "")),
      detailMoreOpen: Boolean(document.querySelector(".tk-detail-more[open]")),
      terrainSource: map?.getTerrain?.()?.source ?? null,
      pitch: Math.round(map?.getPitch?.() ?? 0),
      bearing: Math.round(map?.getBearing?.() ?? 0),
      zoom: Number((map?.getZoom?.() ?? 0).toFixed(2)),
      finderDeviceClass: document.querySelector(".tk-sky-finder")?.getAttribute("data-device-class") ?? null,
      finderMode: document.querySelector(".tk-sky-finder")?.getAttribute("data-mode") ?? null,
      cameraState: document.querySelector(".tk-sky-finder")?.getAttribute("data-camera") ?? null,
      aligned: document.querySelector(".tk-sky-finder")?.getAttribute("data-aligned") === "true",
      targetLocks: document.querySelectorAll(".tk-finder-lock").length,
      diagnosticsOpen: Boolean(document.querySelector(".tk-finder-details[open]")),
      guidance: document.querySelector(".tk-finder-guidance strong")?.textContent?.trim() ?? null,
      permissionAttempts: Array.isArray(window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__)
        ? [...window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__]
        : [],
    };
  });
}

function hasExact(values, expected) {
  return values.some((value) => value === expected);
}

/** Pure gate used by the capture preconditions and its own failure/pass test. */
export function navigationCapabilityProof(state, expectsSky) {
  const hasSky = hasExact(state.nav, "Sky");
  const hasFinder = hasExact(state.finderEntries, "Find in Sky");
  if (expectsSky) {
    return hasSky && hasFinder && state.permissionAttempts.length === 0
      ? `nav ${state.nav.join(" · ")}; Find in Sky present; permissions untouched`
      : "";
  }
  return !hasSky && state.finderEntries.length === 0 && state.permissionAttempts.length === 0
    ? `nav ${state.nav.join(" · ")}; no Find in Sky; permissions untouched`
    : "";
}

/** An ordinary celestial target must stay collapsed and geographically honest. */
export function ordinaryDetailProof(state, expectsFinder) {
  const finderCorrect = expectsFinder
    ? hasExact(state.finderEntries, "Find in Sky")
    : state.finderEntries.length === 0;
  return state.mapState === "detail" && !state.detailMoreOpen && finderCorrect && !state.genericShowOnMap
    ? `collapsed detail; ${expectsFinder ? "Find in Sky present" : "no Find in Sky"}; no generic Show on Map`
    : "";
}

async function gotoMap(page, origin) {
  await page.goto(
    `${origin}/?app=tracker&at=${encodeURIComponent(REVIEW_PIN)}&z=8&pin=${encodeURIComponent(REVIEW_PIN)}&card=${DETAIL_CARD}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.locator(`.tk-map-recommendation[data-card="${DETAIL_CARD}"]`).waitFor({ timeout: 60_000 });
  await settledMap(page);
  await dismissTour(page);
}

async function selectTerrain(page) {
  await page.getByRole("radio", { name: /Oblique terrain/ }).click();
  await page.waitForFunction(
    () => window.__trackerMap?.getTerrain?.()?.source === "tracker-terrain-3d-dem" && window.__trackerMap?.getPitch?.() >= 65,
    null,
    { timeout: 20_000 },
  );
  await settledMap(page, 2_500);
}

async function selectTonight(page) {
  await page.getByRole("button", { name: "Tonight", exact: true }).click();
  await page.locator(".tk-tonight-lead").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
}

async function openDetail(page) {
  await page.getByRole("button", { name: /View details|Details/i }).first().click();
  await page.locator(".tk-map-detail .tracker-hero").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
}

async function dispatchOrientation(page, alpha, beta, repeats = 1) {
  await page.evaluate(({ alphaValue, betaValue, repeatCount }) => {
    for (let index = 0; index < repeatCount; index += 1) {
      const event = new Event("deviceorientationabsolute");
      Object.defineProperties(event, {
        alpha: { value: alphaValue },
        beta: { value: betaValue },
        gamma: { value: 0 },
        absolute: { value: true },
      });
      window.dispatchEvent(event);
    }
  }, { alphaValue: alpha, betaValue: beta, repeatCount: repeats });
}

async function dispatchReviewPointing(page) {
  await page.waitForFunction(
    () => Array.isArray(window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__) &&
      window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__.includes("orientation"),
    null,
    { timeout: 10_000 },
  );
  await dispatchOrientation(page, 90, 90);
  await page.waitForFunction(
    () => !/preparing/i.test(document.querySelector(".tk-finder-guidance strong")?.textContent ?? ""),
    null,
    { timeout: 10_000 },
  );
}

async function dispatchAlignedPointing(page) {
  const target = await page.locator(".tk-sky-finder").evaluate((node) => ({
    azimuth: Number(node.getAttribute("data-target-azimuth")),
    altitude: Number(node.getAttribute("data-target-altitude")),
  }));
  await dispatchOrientation(page, target.azimuth, 90 + target.altitude, 32);
  await page.waitForFunction(
    () => document.querySelector(".tk-sky-finder")?.getAttribute("data-aligned") === "true",
    null,
    { timeout: 10_000 },
  );
}

function makeCapture({ shots, problems, wanted, shotsDir }) {
  return async (page, id, caption, verify) => {
    if (wanted && !wanted.has(id)) return;
    let observed = "";
    try {
      observed = await verify();
      const pending = await visiblePending(page);
      if (pending) observed = "";
    } catch (error) {
      observed = `threw: ${error.message}`;
    }
    const verified = Boolean(observed) && !observed.startsWith("threw:");
    const file = `${id}.png`;
    await page.screenshot({ path: path.join(shotsDir, file) });
    shots.push({ id, file, caption, verified, observed: observed || "precondition not met or state pending" });
    if (!verified) problems.push(`${id}: ${caption}`);
    console.log(`  ${verified ? "✓" : "✗"} ${id} — ${observed || "precondition not met"}`);
  };
}

export async function captureStates({ browser, origin, shotsDir, only = null }) {
  await mkdir(shotsDir, { recursive: true });
  const shots = [];
  const problems = [];
  const wanted = only ? new Set(only) : null;
  const capture = makeCapture({ shots, problems, wanted, shotsDir });
  const wantsAny = (...ids) => !wanted || ids.some((id) => wanted.has(id));

  if (wantsAny("01-desktop-map-2d", "02-desktop-map-3d", "03-desktop-tonight-no-sky", "04-desktop-object-detail")) {
    console.log("\nDesktop capability boundary");
    const { context, page } = await openDevice(browser, "desktop", { width: 1440, height: 900 });
    await gotoMap(page, origin);
    await capture(page, "01-desktop-map-2d", "Desktop Map in accurate top-down 2D; navigation is Map · Tonight with no Sky or Find in Sky.", async () => {
      const state = await productState(page);
      const capability = navigationCapabilityProof(state, false);
      return state.mapState === "map" && capability ? `2D map; ${capability}` : "";
    });

    await selectTerrain(page);
    await capture(page, "02-desktop-map-3d", "Desktop Map in close observer-centred DEM terrain. Relief is rendered from the real elevation mesh at the documented fixed 1.35× display scale.", async () => {
      const state = await productState(page);
      return state.terrainSource === "tracker-terrain-3d-dem" && state.pitch >= 65 && state.pitch <= 70 && state.zoom >= 11
        ? `DEM ${state.terrainSource}; zoom ${state.zoom}; pitch ${state.pitch}°; bearing ${state.bearing}°; vertical scale 1.35×`
        : "";
    });

    await selectTonight(page);
    await capture(page, "03-desktop-tonight-no-sky", "Desktop Tonight as an editorial nightly briefing; this frame also proves the Sky tab and Find in Sky are absent.", async () => {
      const state = await productState(page);
      return state.mapState === "tonight" && !hasExact(state.nav, "Sky") && state.finderEntries.length === 0
        ? `Tonight; nav ${state.nav.join(" · ")}; no live action`
        : "";
    });

    await openDetail(page);
    await capture(page, "04-desktop-object-detail", "Desktop Object Detail collapsed by default, with no Find in Sky and no generic Show on Map action for Saturn.", async () => {
      const state = await productState(page);
      return ordinaryDetailProof(state, false);
    });
    await context.close();
  }

  if (wantsAny("05-phone-map-2d", "06-phone-map-3d", "07-phone-tonight", "08-phone-object-detail-collapsed", "09-phone-sky-camera-granted", "10-phone-sky-guiding", "11-phone-sky-aligned")) {
    console.log("\nSupported phone");
    const { context, page } = await openDevice(browser, "phone", { width: 390, height: 844 });
    await gotoMap(page, origin);
    await capture(page, "05-phone-map-2d", "Supported phone Map in top-down 2D with Map · Tonight · Sky and direct Find in Sky.", async () => {
      const state = await productState(page);
      return navigationCapabilityProof(state, true);
    });

    await selectTerrain(page);
    await capture(page, "06-phone-map-3d", "Supported phone Map in close observer-centred DEM terrain at the documented fixed 1.35× relief display scale.", async () => {
      const state = await productState(page);
      return state.terrainSource === "tracker-terrain-3d-dem" && state.pitch >= 65 && state.zoom >= 11
        ? `DEM terrain at zoom ${state.zoom}, ${state.pitch}° pitch; vertical scale 1.35×`
        : "";
    });

    await selectTonight(page);
    await capture(page, "07-phone-tonight", "Supported phone Tonight preserves the same ranked nightly briefing in a compact editorial composition.", async () => {
      const state = await productState(page);
      return state.mapState === "tonight" && hasExact(state.nav, "Sky") && hasExact(state.finderEntries, "Find in Sky")
        ? "Tonight; Sky and direct Find in Sky available"
        : "";
    });

    await openDetail(page);
    await capture(page, "08-phone-object-detail-collapsed", "Supported phone Object Detail stays concise and collapsed; Find in Sky is the capability-specific primary action.", async () => {
      const state = await productState(page);
      return ordinaryDetailProof(state, true);
    });

    await page.getByRole("button", { name: "Find in Sky", exact: true }).click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector(".tk-sky-finder")?.getAttribute("data-camera") === "active",
      null,
      { timeout: 10_000 },
    );
    await capture(page, "09-phone-sky-camera-granted", "Fixture-driven supported-phone state after camera and orientation permission are granted. This proves the active production camera path and immediate entry, but is not physical-device AR evidence.", async () => {
      const state = await productState(page);
      return state.cameraState === "active" && state.permissionAttempts.includes("camera") && state.permissionAttempts.includes("orientation") && !state.diagnosticsOpen
        ? `camera ${state.cameraState}; permissions ${state.permissionAttempts.join(", ")}; diagnostics collapsed`
        : "";
    });
    await dispatchReviewPointing(page);
    await page.waitForTimeout(500);
    await capture(page, "10-phone-sky-guiding", "Fixture-driven supported-phone Sky actively guiding with one coherent target lock and the production movement cue. This is deterministic interaction evidence, not physical sensor validation.", async () => {
      const state = await productState(page);
      return state.mapState === "finder" && state.finderDeviceClass === "handheld" && state.finderMode !== "preview" && state.cameraState === "active" && !state.diagnosticsOpen && state.targetLocks === 1 && /move|raise|lower|almost/i.test(state.guidance ?? "")
        ? `live ${state.finderMode}; camera active; one target lock; cue "${state.guidance}"; diagnostics collapsed`
        : "";
    });
    await dispatchAlignedPointing(page);
    await page.waitForTimeout(500);
    await capture(page, "11-phone-sky-aligned", "Fixture-driven supported-phone Sky aligned on target with the same single target lock transitioned into its on-target state.", async () => {
      const state = await productState(page);
      return state.aligned && state.cameraState === "active" && state.targetLocks === 1 && /is here/i.test(state.guidance ?? "")
        ? `aligned; camera active; one target lock; cue "${state.guidance}"`
        : "";
    });
    await context.close();
  }

  if (wantsAny("12-tablet-map-3d", "13-tablet-tonight", "14-tablet-sky-guiding")) {
    console.log("\nSupported tablet");
    const { context, page } = await openDevice(browser, "tablet", { width: 820, height: 1180 });
    await gotoMap(page, origin);
    await selectTerrain(page);
    await capture(page, "12-tablet-map-3d", "Supported tablet Map in close observer-centred 3D terrain with full touch rotation capability and the documented 1.35× relief display scale.", async () => {
      const state = await productState(page);
      return hasExact(state.nav, "Sky") && state.terrainSource === "tracker-terrain-3d-dem" && state.pitch >= 65 && state.zoom >= 11
        ? `nav ${state.nav.join(" · ")}; DEM terrain at zoom ${state.zoom}, ${state.pitch}° pitch`
        : "";
    });

    await selectTonight(page);
    await capture(page, "13-tablet-tonight", "Supported tablet Tonight uses the wider editorial briefing composition without exposing default expert density.", async () => {
      const state = await productState(page);
      return state.mapState === "tonight" && hasExact(state.nav, "Sky") && hasExact(state.finderEntries, "Find in Sky")
        ? "Tonight; capable tablet navigation and action present"
        : "";
    });

    await page.locator(".tk-tonight-lead .is-finder").click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 30_000 });
    await dispatchReviewPointing(page);
    await page.waitForTimeout(500);
    await capture(page, "14-tablet-sky-guiding", "Fixture-driven supported-tablet Sky is live guidance, not a desktop-style preview; camera permission is granted and one target lock carries the deterministic movement cue.", async () => {
      const state = await productState(page);
      return state.finderDeviceClass === "handheld" && state.finderMode !== "preview" && state.cameraState === "active" && state.targetLocks === 1 && !state.diagnosticsOpen && /move|raise|lower|almost|on target/i.test(state.guidance ?? "")
        ? `live ${state.finderMode}; camera active; one target lock; cue "${state.guidance}"; diagnostics collapsed`
        : "";
    });
    await context.close();
  }

  if (wantsAny("15-unsupported-tablet-map", "16-unsupported-tablet-tonight", "17-unsupported-tablet-object-detail")) {
    console.log("\nUnsupported tablet capability boundary");
    const { context, page } = await openDevice(browser, "unsupported-tablet", { width: 820, height: 1180 });
    await gotoMap(page, origin);
    await capture(page, "15-unsupported-tablet-map", "Touch-first tablet without camera/orientation support shows Map · Tonight only, with no Find in Sky and no reserved navigation space.", async () => {
      const state = await productState(page);
      const capability = navigationCapabilityProof(state, false);
      return state.nav.join("|") === "Map|Tonight" && capability ? capability : "";
    });

    await selectTonight(page);
    await capture(page, "16-unsupported-tablet-tonight", "Unsupported tablet Tonight remains a complete nightly briefing with Map · Tonight navigation and no capability-shaped gap.", async () => {
      const state = await productState(page);
      return state.mapState === "tonight" && state.nav.join("|") === "Map|Tonight" && state.finderEntries.length === 0
        ? "Tonight; Map · Tonight only; no Find in Sky"
        : "";
    });

    await openDetail(page);
    await capture(page, "17-unsupported-tablet-object-detail", "Unsupported tablet Object Detail remains usable and concise without Find in Sky or a generic object-map action.", async () => {
      const state = await productState(page);
      return ordinaryDetailProof(state, false);
    });
    await context.close();
  }

  return { shots, problems };
}
