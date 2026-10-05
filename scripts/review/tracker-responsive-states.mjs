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
const TELESCOPE_STORAGE_KEY = "orbit.tracker.telescope-setups.v1";
const REVIEW_TELESCOPE = {
  version: 1,
  activeId: "review-dobsonian",
  setups: [{
    id: "review-dobsonian",
    name: '8" Dobsonian',
    type: "reflector",
    apertureMm: 203,
    focalLengthMm: 1_200,
    eyepiecesMm: [25, 10],
    mount: "alt-az",
    tracking: false,
    goto: false,
  }],
};
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
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const paint = canvas.getContext("2d");
          if (paint) {
            const sky = paint.createLinearGradient(0, 0, 0, canvas.height);
            sky.addColorStop(0, "#202b3b");
            sky.addColorStop(0.65, "#111821");
            sky.addColorStop(1, "#080b0f");
            paint.fillStyle = sky;
            paint.fillRect(0, 0, canvas.width, canvas.height);
            paint.fillStyle = "rgba(2, 4, 7, 0.82)";
            paint.beginPath();
            paint.moveTo(0, 610);
            paint.lineTo(150, 535);
            paint.lineTo(290, 592);
            paint.lineTo(480, 500);
            paint.lineTo(690, 575);
            paint.lineTo(900, 520);
            paint.lineTo(1100, 590);
            paint.lineTo(1280, 548);
            paint.lineTo(1280, 720);
            paint.lineTo(0, 720);
            paint.closePath();
            paint.fill();
            paint.fillStyle = "rgba(235, 241, 252, 0.58)";
            paint.font = "500 18px system-ui, sans-serif";
            paint.fillText("FIXTURE CAMERA · NOT PHYSICAL AR EVIDENCE", 28, 690);
          }
          const fixtureStream = canvas.captureStream(15);
          Object.defineProperty(window, "__ORBIT_FIXTURE_CAMERA_CANVAS__", {
            configurable: true,
            value: canvas,
          });
          Object.defineProperty(window, "__ORBIT_FIXTURE_CAMERA_STREAM__", {
            configurable: true,
            value: fixtureStream,
          });
          return fixtureStream;
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

async function openDevice(
  browser,
  capability,
  viewport,
  { clock = SATELLITE_CLOCK, telescopeFixture = false } = {},
) {
  const handheld = capability !== "desktop";
  const context = await browser.newContext({
    viewport,
    isMobile: capability === "phone",
    hasTouch: handheld,
    deviceScaleFactor: handheld ? 2 : 1,
  });
  await installCapabilityBoundary(context, capability);
  if (telescopeFixture) {
    await context.addInitScript(({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    }, { key: TELESCOPE_STORAGE_KEY, value: REVIEW_TELESCOPE });
  }
  await stubTracker(context, { basemap: "live", satellites: "unavailable", unavailable: "empty" });
  await seedPlace(context, PORTLAND);
  const page = await context.newPage();
  await page.clock.setFixedTime(clock);
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
    const finderEntries = [...document.querySelectorAll(
      ".tk-map-recommendation .is-finder, .tk-tonight-lead .is-finder, .tk-tonight-row-finder, .tk-action.is-finder",
    )].map((node) => {
      const label = node.getAttribute("aria-label") ?? node.textContent ?? "";
      return label.split(":")[0].replace(/\s+/g, " ").trim();
    });
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
      visualBase: document.querySelector(".tk-sky-finder")?.getAttribute("data-visual-base") ?? null,
      aligned: document.querySelector(".tk-sky-finder")?.getAttribute("data-aligned") === "true",
      targetLocks: document.querySelectorAll(".tk-finder-lock").length,
      skyStars: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-stars") ?? 0),
      skyLines: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-lines") ?? 0),
      skyLabels: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-labels") ?? 0),
      skyObjects: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-objects") ?? 0),
      selectedMarker: document.querySelector(".tk-finder-lock .tk-sky-object-glyph")?.getAttribute("data-marker") ?? null,
      diagnosticsOpen: Boolean(document.querySelector(".tk-finder-details[open]")),
      guidance: document.querySelector(".tk-finder-guidance strong")?.textContent?.trim() ?? null,
      targetSummary: document.querySelector(".tk-finder-target-card")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      viewing: document.querySelector(".tk-equipment-trigger")?.getAttribute("aria-label") ?? null,
      telescopeGuidance: document.querySelector(".tk-telescope-guidance")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      edgeCues: document.querySelectorAll(".tk-finder-edge-cue").length,
      developerDiagnostics: document.querySelector(".tk-finder-developer")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      cameraHorizontalFov: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-camera-horizontal-fov") ?? 0),
      cameraVerticalFov: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-camera-vertical-fov") ?? 0),
      cameraCropAxis: document.querySelector(".tk-sky-finder")?.getAttribute("data-camera-crop-axis") ?? null,
      headingReference: document.querySelector(".tk-sky-finder")?.getAttribute("data-heading-reference") ?? null,
      mapToolbar: [...document.querySelectorAll(
        ".tk-map-topbar .tracker-place-current, .tk-map-topbar .tk-date, .tk-map-topbar-projection .tk-projection",
      )].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          text: node.textContent?.replace(/\s+/g, " ").trim() ?? "",
          top: Math.round(rect.top),
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      }),
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

/** The phone Map has one compact Location / Date / 2D–3D toolbar row. */
export function mobileMapToolbarProof(state) {
  if (!Array.isArray(state.mapToolbar) || state.mapToolbar.length !== 3) return "";
  const [location, date, projection] = state.mapToolbar;
  const sameRow = Math.max(...state.mapToolbar.map((item) => item.top)) -
    Math.min(...state.mapToolbar.map((item) => item.top)) <= 2;
  const matchedContent = /Portland/i.test(location.text) && /Tonight|Today/i.test(date.text) &&
    /2D/.test(projection.text) && /3D/.test(projection.text);
  const proportions = location.width > date.width && date.width > projection.width;
  const compact = state.mapToolbar.every((item) => item.height >= 36 && item.height <= 44);
  return sameRow && matchedContent && proportions && compact
    ? `one ${Math.max(...state.mapToolbar.map((item) => item.height))}px row; location ${location.width}px, date ${date.width}px, projection ${projection.width}px`
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
  const rankedLead = page.locator(".tk-tonight-lead .tk-tonight-row-main").first();
  if (await rankedLead.count()) await rankedLead.click();
  else await page.getByRole("button", { name: /View details|Details/i }).first().click();
  await page.locator(".tk-map-detail .tracker-hero").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
}

async function openSaturnDetail(page, origin, equipment = "eyes", { diagnostics = false } = {}) {
  await page.goto(
    `${origin}/?app=tracker&mode=tonight&at=${encodeURIComponent(REVIEW_PIN)}&z=8&pin=${encodeURIComponent(REVIEW_PIN)}&card=${DETAIL_CARD}&event=${DETAIL_CARD}&with=${equipment}${diagnostics ? "&skyDiagnostics=1" : ""}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.locator(".tk-map-detail .tracker-hero").waitFor({ timeout: 30_000 });
  await dismissTour(page);
  await page.waitForTimeout(700);
}

async function dispatchOrientation(page, alpha, beta, repeats = 1, compassAccuracy = null, compassHeading = null) {
  await page.evaluate(({ alphaValue, betaValue, repeatCount, accuracy, heading }) => {
    for (let index = 0; index < repeatCount; index += 1) {
      const event = new Event("deviceorientationabsolute");
      Object.defineProperties(event, {
        alpha: { value: alphaValue },
        beta: { value: betaValue },
        gamma: { value: 0 },
        absolute: { value: true },
        ...(accuracy === null ? {} : { webkitCompassAccuracy: { value: accuracy } }),
        ...(heading === null ? {} : { webkitCompassHeading: { value: heading } }),
      });
      window.dispatchEvent(event);
    }
  }, { alphaValue: alpha, betaValue: beta, repeatCount: repeats, accuracy: compassAccuracy, heading: compassHeading });
}

async function dispatchPointing(page, azimuthDeg, altitudeDeg, repeats = 48) {
  // W3C alpha runs opposite the compass heading in the flat reference case.
  const alpha = ((360 - azimuthDeg) % 360 + 360) % 360;
  await dispatchOrientation(page, alpha, 90 + altitudeDeg, repeats);
}

async function dispatchMagneticPointing(page, azimuthDeg, altitudeDeg, repeats = 48) {
  // Safari alpha may be arbitrary; webkitCompassHeading is the magnetic yaw
  // authority. This fixture deliberately leaves true-north correction absent.
  await dispatchOrientation(page, 17, 90 + altitudeDeg, repeats, 5, azimuthDeg);
}

async function dispatchReviewPointing(page) {
  await page.waitForFunction(
    () => Array.isArray(window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__) &&
      window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__.includes("orientation"),
    null,
    { timeout: 10_000 },
  );
  const target = await page.locator(".tk-sky-finder").evaluate((node) => ({
    azimuth: Number(node.getAttribute("data-target-azimuth")),
    altitude: Number(node.getAttribute("data-target-altitude")),
  }));
  await dispatchPointing(page, target.azimuth + 11, target.altitude, 48);
  await page.waitForFunction(
    () => !/preparing/i.test(document.querySelector(".tk-finder-guidance strong")?.textContent ?? ""),
    null,
    { timeout: 10_000 },
  );
}

async function waitForPopulatedSky(page) {
  await page.waitForFunction(
    () => {
      const finder = document.querySelector(".tk-sky-finder");
      return Number(finder?.getAttribute("data-expected-stars") ?? 0) >= 8 &&
        Number(finder?.getAttribute("data-expected-lines") ?? 0) > 0 &&
        Number(finder?.getAttribute("data-expected-labels") ?? 0) > 0 &&
        finder?.querySelector(".tk-finder-lock .tk-sky-object-glyph[data-marker='saturn']");
    },
    null,
    { timeout: 15_000 },
  );
}

async function dispatchAlignedPointing(page) {
  const target = await page.locator(".tk-sky-finder").evaluate((node) => ({
    azimuth: Number(node.getAttribute("data-target-azimuth")),
    altitude: Number(node.getAttribute("data-target-altitude")),
  }));
  await dispatchPointing(page, target.azimuth, target.altitude, 64);
  await page.waitForFunction(
    () => document.querySelector(".tk-sky-finder")?.getAttribute("data-aligned") === "true",
    null,
    { timeout: 10_000 },
  );
}

async function dispatchAlmostPointing(page) {
  const target = await page.locator(".tk-sky-finder").evaluate((node) => ({
    azimuth: Number(node.getAttribute("data-target-azimuth")),
    altitude: Number(node.getAttribute("data-target-altitude")),
  }));
  await dispatchPointing(page, target.azimuth + 2.8, target.altitude + 2.8, 64);
  await page.waitForFunction(
    () => /almost there/i.test(document.querySelector(".tk-finder-guidance strong")?.textContent ?? ""),
    null,
    { timeout: 10_000 },
  );
}

async function dispatchOffscreenPointing(page) {
  const target = await page.locator(".tk-sky-finder").evaluate((node) => ({
    azimuth: Number(node.getAttribute("data-target-azimuth")),
    altitude: Number(node.getAttribute("data-target-altitude")),
  }));
  await dispatchPointing(page, target.azimuth + 65, target.altitude, 64);
  await page.waitForFunction(
    () => document.querySelectorAll(".tk-finder-edge-cue").length === 1 &&
      document.querySelectorAll(".tk-finder-lock").length === 0,
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

  if (wantsAny(
    "05-phone-map-2d",
    "06-phone-map-3d",
    "07-phone-tonight",
    "07a-phone-viewing-capability-selector",
    "07b-phone-tonight-telescope",
    "08-phone-object-detail-collapsed",
    "09-phone-sky-camera-granted",
    "09a-phone-sky-target-offscreen",
    "10-phone-sky-guiding",
    "10a-phone-sky-almost-aligned",
    "11-phone-sky-aligned",
  )) {
    console.log("\nSupported phone");
    const { context, page } = await openDevice(
      browser,
      "phone",
      { width: 390, height: 844 },
      { telescopeFixture: true },
    );
    await gotoMap(page, origin);
    await capture(page, "05-phone-map-2d", "Supported phone Map in top-down 2D with Map · Tonight · Sky and direct Find in Sky.", async () => {
      const state = await productState(page);
      const capability = navigationCapabilityProof(state, true);
      const toolbar = mobileMapToolbarProof(state);
      return capability && toolbar ? `${capability}; ${toolbar}` : "";
    });

    await selectTerrain(page);
    await capture(page, "06-phone-map-3d", "Supported phone Map in close observer-centred DEM terrain at the documented fixed 1.35× relief display scale.", async () => {
      const state = await productState(page);
      const toolbar = mobileMapToolbarProof(state);
      return state.terrainSource === "tracker-terrain-3d-dem" && state.pitch >= 65 && state.zoom >= 11 && toolbar
        ? `DEM terrain at zoom ${state.zoom}, ${state.pitch}° pitch; vertical scale 1.35×; ${toolbar}`
        : "";
    });

    await selectTonight(page);
    await capture(page, "07-phone-tonight", "Supported phone Tonight with the default Naked eye capability preserves the compact ranked nightly briefing.", async () => {
      const state = await productState(page);
      return state.mapState === "tonight" && /Naked eye/.test(state.viewing ?? "") && hasExact(state.nav, "Sky") && hasExact(state.finderEntries, "Find in Sky")
        ? "Tonight; Naked eye active; Sky and direct Find in Sky available"
        : "";
    });

    await page.getByRole("button", { name: /Viewing: Naked eye/ }).click();
    await capture(page, "07a-phone-viewing-capability-selector", "The compact Viewing selector exposes Naked eye, Binoculars, Telescope, and Astrophotography without forcing setup or leaving Tonight.", async () => {
      const options = await page.getByRole("switch").allTextContents();
      return options.some((option) => /Naked eye/.test(option)) &&
        options.some((option) => /Binoculars/.test(option)) &&
        options.some((option) => /Telescope/.test(option)) &&
        options.some((option) => /Astrophotography/.test(option))
        ? `compact selector; ${options.length} capabilities; setup remains optional`
        : "";
    });
    await page.getByRole("switch", { name: /^Telescope/ }).click();
    await page.getByRole("combobox", { name: "Saved telescope" }).selectOption("review-dobsonian");
    await page.locator(".tk-equipment-trigger").click();
    await page.waitForFunction(
      () => /Dobsonian|Telescope/.test(document.querySelector(".tk-equipment-trigger")?.getAttribute("aria-label") ?? ""),
      null,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(600);
    await capture(page, "07b-phone-tonight-telescope", "The same Tonight surface immediately recalculates for Telescope with the saved 8-inch Dobsonian active; no expert mode is introduced.", async () => {
      const state = await productState(page);
      return state.mapState === "tonight" && /Dobsonian|Telescope/.test(state.viewing ?? "")
        ? "Tonight; Telescope active; saved 8-inch Dobsonian retained device-locally"
        : "";
    });

    await openSaturnDetail(page, origin, "telescope");
    await capture(page, "08-phone-object-detail-collapsed", "Supported phone Saturn detail stays object-first and collapsed while adding only useful 8-inch Dobsonian guidance; Find in Sky remains the capability-specific action.", async () => {
      const state = await productState(page);
      const detail = ordinaryDetailProof(state, true);
      return detail && /10 mm eyepiece/.test(state.telescopeGuidance ?? "") && /120×/.test(state.telescopeGuidance ?? "")
        ? `${detail}; contextual 10 mm · 120× guidance`
        : "";
    });

    await page.getByRole("button", { name: "Find in Sky", exact: true }).click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector(".tk-sky-finder")?.getAttribute("data-camera") === "active",
      null,
      { timeout: 10_000 },
    );
    await waitForPopulatedSky(page);
    await capture(page, "09-phone-sky-camera-granted", "Fixture-driven supported-phone state after camera and orientation permission are granted. This proves the active production camera path and immediate entry, but is not physical-device AR evidence.", async () => {
      const state = await productState(page);
      return state.cameraState === "active" && state.visualBase === "camera" && state.permissionAttempts.includes("camera") && state.permissionAttempts.includes("orientation") && !state.diagnosticsOpen && state.skyStars >= 8 && state.skyLines > 0 && state.skyLabels > 0 && state.selectedMarker === "saturn" && state.cameraHorizontalFov > 0 && state.cameraVerticalFov > 0
        ? `fixture camera visual base; ${state.skyStars} real stars; ${state.skyLines} figure segments; ${state.skyLabels} constellation labels; Saturn marker; effective FOV ${state.cameraHorizontalFov.toFixed(1)}° × ${state.cameraVerticalFov.toFixed(1)}°; ${state.cameraCropAxis} crop; diagnostics collapsed`
        : "";
    });
    await dispatchOffscreenPointing(page);
    await page.waitForTimeout(400);
    await capture(page, "09a-phone-sky-target-offscreen", "Fixture-driven off-screen target state. Saturn remains at its astronomical projection while one compact edge cue gives direction; no target marker is pulled into the viewport.", async () => {
      const state = await productState(page);
      return state.cameraState === "active" && state.edgeCues === 1 && state.targetLocks === 0 && /move|raise|lower/i.test(state.guidance ?? "")
        ? `camera active; one edge cue; no in-field target lock; cue "${state.guidance}"`
        : "";
    });
    await dispatchReviewPointing(page);
    await waitForPopulatedSky(page);
    await page.waitForTimeout(500);
    await capture(page, "10-phone-sky-guiding", "Fixture-driven supported-phone Sky actively guiding with one coherent target lock and the production movement cue. This is deterministic interaction evidence, not physical sensor validation.", async () => {
      const state = await productState(page);
      return state.mapState === "finder" && state.finderDeviceClass === "handheld" && state.finderMode !== "preview" && state.cameraState === "active" && !state.diagnosticsOpen && state.targetLocks === 1 && state.skyLines > 0 && state.skyLabels > 0 && state.selectedMarker === "saturn" && /move|raise|lower|almost/i.test(state.guidance ?? "")
        ? `live ${state.finderMode}; camera active; ${state.skyStars} real stars; constellation figures labelled; one Saturn target lock; cue "${state.guidance}"`
        : "";
    });
    await dispatchAlmostPointing(page);
    await waitForPopulatedSky(page);
    await page.waitForTimeout(500);
    await capture(page, "10a-phone-sky-almost-aligned", "Fixture-driven supported-phone Sky in the Almost there state. Target, real stars, and constellation geometry share one stabilized camera projection.", async () => {
      const state = await productState(page);
      return !state.aligned && state.targetLocks === 1 && state.selectedMarker === "saturn" && /almost there/i.test(state.guidance ?? "")
        ? `almost aligned; one Saturn target lock; cue "${state.guidance}"`
        : "";
    });
    await dispatchAlignedPointing(page);
    await waitForPopulatedSky(page);
    await page.waitForTimeout(500);
    await capture(page, "11-phone-sky-aligned", "Fixture-driven supported-phone Sky aligned on target with the same single target lock transitioned into its on-target state.", async () => {
      const state = await productState(page);
      return state.aligned && state.cameraState === "active" && state.targetLocks === 1 && state.selectedMarker === "saturn" && state.skyLines > 0 && /is here/i.test(state.guidance ?? "")
        ? `aligned; camera active; one Saturn target lock; populated real sky; cue "${state.guidance}"`
        : "";
    });
    await context.close();
  }

  if (wantsAny("11b-phone-sky-ar-diagnostics")) {
    console.log("\nSupported phone · developer AR diagnostics");
    const { context, page } = await openDevice(browser, "phone", { width: 390, height: 844 });
    await openSaturnDetail(page, origin, "eyes", { diagnostics: true });
    await page.getByRole("button", { name: "Find in Sky", exact: true }).click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector(".tk-sky-finder")?.getAttribute("data-camera") === "active",
      null,
      { timeout: 10_000 },
    );
    const diagnosticsTarget = await page.locator(".tk-sky-finder").evaluate((node) => ({
      azimuth: Number(node.getAttribute("data-target-azimuth")),
      altitude: Number(node.getAttribute("data-target-altitude")),
    }));
    await dispatchMagneticPointing(page, diagnosticsTarget.azimuth + 11, diagnosticsTarget.altitude, 64);
    await page.locator(".tk-finder-developer").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await capture(page, "11b-phone-sky-ar-diagnostics", "Localhost-only AR diagnostics from a deterministic browser session. It exposes each registration layer, the live fixture-video dimensions, effective FOV/crop, projected target coordinate, heading reference, and calibration state; it is not consumer UI or physical-device validation.", async () => {
      const state = await productState(page);
      const diagnostics = state.developerDiagnostics ?? "";
      return state.cameraState === "active" &&
        /RA \/ Dec/.test(diagnostics) &&
        /Expected Az \/ Alt/.test(diagnostics) &&
        /Local ENU/.test(diagnostics) &&
        /Quaternion/.test(diagnostics) &&
        /Camera FOV/.test(diagnostics) &&
        /Projected X \/ Y/.test(diagnostics) &&
        state.headingReference === "magnetic-uncorrected" &&
        !state.aligned &&
        state.cameraHorizontalFov > 0 &&
        state.cameraVerticalFov > 0
        ? `developer-only diagnostics; ${state.headingReference}; effective FOV ${state.cameraHorizontalFov.toFixed(1)}° × ${state.cameraVerticalFov.toFixed(1)}°; ${state.cameraCropAxis} crop`
        : "";
    });
    await context.close();
  }

  if (wantsAny("11a-phone-sky-below-horizon")) {
    console.log("\nSupported phone · below-horizon policy");
    const { context, page } = await openDevice(
      browser,
      "phone",
      { width: 390, height: 844 },
      { clock: new Date("2026-09-02T18:00:00Z") },
    );
    await openSaturnDetail(page, origin, "eyes");
    await page.getByRole("button", { name: "Find in Sky", exact: true }).click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      () => /below the horizon/i.test(document.querySelector(".tk-finder-guidance strong")?.textContent ?? ""),
      null,
      { timeout: 15_000 },
    );
    await capture(page, "11a-phone-sky-below-horizon", "Fixture-driven supported-phone Sky stops normal pointing guidance when Saturn is physically below the horizon and offers the next rise when available.", async () => {
      const state = await productState(page);
      const pageText = await page.locator(".tk-sky-finder").innerText();
      return /Saturn is below the horizon/i.test(state.guidance ?? "") &&
        state.targetLocks === 0 &&
        !/-\d+° high/.test(pageText) &&
        /below horizon/i.test(state.targetSummary ?? "") &&
        /rises/i.test(state.targetSummary ?? "") &&
        !/easy naked eye/i.test(state.targetSummary ?? "")
        ? `below-horizon stop; no target lock or movement cue; summary "${state.targetSummary}"`
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
    await waitForPopulatedSky(page);
    await page.waitForTimeout(500);
    await capture(page, "14-tablet-sky-guiding", "Fixture-driven supported-tablet Sky is live guidance, not a desktop-style preview; camera permission is granted and one target lock carries the deterministic movement cue.", async () => {
      const state = await productState(page);
      return state.finderDeviceClass === "handheld" && state.finderMode !== "preview" && state.cameraState === "active" && state.targetLocks === 1 && state.skyStars >= 8 && state.skyLines > 0 && state.skyLabels > 0 && state.selectedMarker === "saturn" && !state.diagnosticsOpen && /move|raise|lower|almost|on target/i.test(state.guidance ?? "")
        ? `live ${state.finderMode}; camera active; populated and labelled real sky; one Saturn target lock; cue "${state.guidance}"`
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
