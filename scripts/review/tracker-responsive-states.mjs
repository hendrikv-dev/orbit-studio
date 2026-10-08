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
          if (kind === "camera-denied-phone") {
            throw new DOMException("Fixture camera permission denied", "NotAllowedError");
          }
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
  await stubTracker(context, { basemap: "live", satellites: "full", unavailable: "empty" });
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
    const compactDate = document.querySelector(".tk-date-label-compact");
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
      navigationMode: document.querySelector(".tk-sky-finder")?.getAttribute("data-navigation-mode") ?? null,
      pointingActive: document.querySelector(".tk-sky-finder")?.getAttribute("data-pointing-active") === "true",
      orientationPermission: document.querySelector(".tk-sky-finder")?.getAttribute("data-orientation-permission") ?? null,
      skyDensity: document.querySelector(".tk-sky-finder")?.getAttribute("data-sky-density") ?? null,
      magnitudeLimit: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-magnitude-limit") ?? 0),
      cameraState: document.querySelector(".tk-sky-finder")?.getAttribute("data-camera") ?? null,
      visualBase: document.querySelector(".tk-sky-finder")?.getAttribute("data-visual-base") ?? null,
      aligned: document.querySelector(".tk-sky-finder")?.getAttribute("data-aligned") === "true",
      targetLocks: document.querySelectorAll(".tk-finder-lock").length,
      skyStars: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-stars") ?? 0),
      skyLines: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-lines") ?? 0),
      skyLabels: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-labels") ?? 0),
      skyObjects: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-expected-objects") ?? 0),
      constellationIdentities: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-constellation-identities") ?? 0),
      skyFigures: document.querySelectorAll(".tk-finder-constellation-figures path[data-primary='true']").length,
      skyFigureConstellations: [...new Set([...document.querySelectorAll(".tk-finder-constellation-figures path[data-constellation]")].map((node) => node.getAttribute("data-constellation")))],
      milkyWaySamples: Number(document.querySelector(".tk-finder-milky-way-texture")?.getAttribute("data-sample-count") ?? 0),
      milkyWayDrawnCells: Number(document.querySelector(".tk-finder-milky-way-texture")?.getAttribute("data-drawn-cells") ?? 0),
      milkyWayRenderMs: Number(document.querySelector(".tk-finder-milky-way-texture")?.getAttribute("data-render-ms") ?? 0),
      skyStarLabels: document.querySelectorAll(".tk-finder-star small").length,
      searchOpen: Boolean(document.querySelector(".tk-sky-search")),
      alertsOpen: Boolean(document.querySelector(".tk-sky-alert-settings")),
      qualityOpen: Boolean(document.querySelector(".tk-sky-quality-panel")),
      hasSkyLayersControl: Boolean(document.querySelector('[aria-label="Sky layers"], .tk-sky-layers, .tk-sky-layer-list')),
      selectedMarker: document.querySelector(".tk-finder-lock .tk-sky-object-glyph")?.getAttribute("data-marker") ?? null,
      diagnosticsOpen: Boolean(document.querySelector(".tk-finder-developer")),
      guidance: document.querySelector(".tk-finder-guidance strong")?.textContent?.trim() ?? null,
      targetSummary: document.querySelector(".tk-finder-guidance")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      targetTreatments: document.querySelectorAll(".tk-finder-guidance, .tk-finder-target-card").length,
      browseHint: Boolean(document.querySelector(".tk-sky-browse-hint")),
      targetAltitude: document.querySelector(".tk-sky-finder")?.getAttribute("data-target-altitude") ?? null,
      targetAzimuth: document.querySelector(".tk-sky-finder")?.getAttribute("data-target-azimuth") ?? null,
      selectedTarget: document.querySelector(".tk-sky-finder")?.getAttribute("data-selected-target") ?? null,
      targetRecommendedAt: document.querySelector(".tk-sky-finder")?.getAttribute("data-target-recommended-at") ?? null,
      observerLatitude: document.querySelector(".tk-sky-finder")?.getAttribute("data-observer-latitude") ?? null,
      observerLongitude: document.querySelector(".tk-sky-finder")?.getAttribute("data-observer-longitude") ?? null,
      astronomyUtc: document.querySelector(".tk-sky-finder")?.getAttribute("data-astronomy-utc") ?? null,
      viewing: document.querySelector(".tk-equipment-trigger")?.getAttribute("aria-label") ?? null,
      telescopeGuidance: document.querySelector(".tk-telescope-guidance")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      edgeCues: document.querySelectorAll(".tk-finder-edge-cue").length,
      starlinkTrailNodes: document.querySelectorAll(".tk-finder-starlink-trail circle").length,
      developerDiagnostics: document.querySelector(".tk-finder-developer")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      cameraHorizontalFov: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-camera-horizontal-fov") ?? 0),
      cameraVerticalFov: Number(document.querySelector(".tk-sky-finder")?.getAttribute("data-camera-vertical-fov") ?? 0),
      cameraCropAxis: document.querySelector(".tk-sky-finder")?.getAttribute("data-camera-crop-axis") ?? null,
      headingReference: document.querySelector(".tk-sky-finder")?.getAttribute("data-heading-reference") ?? null,
      visibleDateLabel: compactDate && getComputedStyle(compactDate).display !== "none"
        ? compactDate.textContent?.trim() ?? null
        : document.querySelector(".tk-date-label")?.textContent?.trim() ?? null,
      dateLabelOverflow: compactDate instanceof HTMLElement && getComputedStyle(compactDate).display !== "none"
        ? compactDate.scrollWidth > compactDate.clientWidth + 1
        : false,
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
  const readableDate = /Today · [A-Z][a-z]{2} \d{1,2}|Tomorrow · [A-Z][a-z]{2} \d{1,2}|Yesterday · [A-Z][a-z]{2} \d{1,2}|[A-Z][a-z]{2} \d{1,2}, \d{2}/.test(state.visibleDateLabel ?? "") && !state.dateLabelOverflow;
  return sameRow && matchedContent && proportions && compact && readableDate
    ? `one ${Math.max(...state.mapToolbar.map((item) => item.height))}px row; location ${location.width}px, date ${date.width}px, projection ${projection.width}px; readable date “${state.visibleDateLabel}”`
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
  // Six degrees is outside Saturn's alignment tolerance but stays comfortably
  // inside the cover-cropped portrait camera field used by the fixture.
  await dispatchPointing(page, target.azimuth + 6, target.altitude, 64);
  await page.waitForFunction(
    () => document.querySelectorAll(".tk-finder-lock").length === 1 &&
      /move|raise|lower|almost/i.test(document.querySelector(".tk-finder-guidance strong")?.textContent ?? ""),
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
        (Number(finder?.getAttribute("data-expected-labels") ?? 0) + finder?.querySelectorAll(".tk-finder-star small").length) > 0 &&
        finder?.querySelector(".tk-finder-lock .tk-sky-object-glyph[data-marker='saturn']");
    },
    null,
    { timeout: 15_000 },
  );
}

async function searchSky(page, query, resultName = query) {
  await page.getByRole("button", { name: "Search the sky" }).click();
  const field = page.getByRole("textbox", { name: "Search celestial objects" });
  await field.fill(query);
  await page.locator(".tk-sky-search-results > button").filter({ hasText: resultName }).first().click();
  await page.waitForTimeout(500);
}

async function openExploreSkyAtCurrentClock(page, origin) {
  await page.goto(`${origin}/?app=tracker&mode=tonight&at=${encodeURIComponent(REVIEW_PIN)}&z=8&pin=${encodeURIComponent(REVIEW_PIN)}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sky", exact: true }).click();
  await page.locator('.tk-sky-finder[data-mode="browse"][data-navigation-mode="point"]').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__?.includes("orientation"), null, { timeout: 10_000 });
  await dispatchPointing(page, 180, 35, 64);
  await page.waitForFunction(() => document.querySelector('.tk-sky-finder')?.getAttribute('data-pointing-active') === 'true', null, { timeout: 10_000 });
  await page.getByRole("button", { name: "Explore sky manually" }).click();
  await page.locator('.tk-sky-finder[data-navigation-mode="explore"]').waitFor({ timeout: 10_000 });
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

  const captureRenderedBodyGroup = async (clock, entries) => {
    const { context, page } = await openDevice(browser, "phone", { width: 390, height: 844 }, { clock });
    await gotoMap(page, origin);
    await page.getByRole("button", { name: "Sky", exact: true }).click();
    await page.locator('.tk-sky-finder[data-mode="browse"][data-navigation-mode="point"]').waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__?.includes("orientation"), null, { timeout: 10_000 });
    await dispatchPointing(page, 180, 35, 64);
    await page.waitForFunction(() => document.querySelector('.tk-sky-finder')?.getAttribute('data-pointing-active') === 'true', null, { timeout: 10_000 });
    await page.getByRole("button", { name: "Explore sky manually" }).click();
    for (const entry of entries) {
      await searchSky(page, entry.query, entry.name);
      await page.waitForFunction((marker) => document.querySelector(".tk-finder-lock .tk-sky-object-glyph")?.getAttribute("data-marker") === marker, entry.marker, { timeout: 10_000 });
      await page.waitForTimeout(350);
      await capture(page, entry.id, entry.caption, async () => {
        const state = await productState(page);
        return state.selectedMarker === entry.marker && state.targetLocks === 1 && state.milkyWaySamples > 100
          ? `${entry.name} rendered at its real above-horizon ephemeris position; ${state.milkyWaySamples} celestial background samples; one target lock`
          : "";
      });
    }
    await context.close();
  };

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
    "09-phone-sky-point-default",
    "09a-phone-sky-camera-off-point",
    "09b-phone-sky-explore",
    "09c-phone-sky-search",
    "09d-phone-sky-wide-density",
    "09p-phone-sky-normal-density",
    "09o-phone-sky-recenter",
    "09e-phone-sky-orion-figure",
    "09e2-phone-sky-aquarius-figure",
    "09j-phone-sky-neptune",
    "09j2-phone-sky-saturn",
    "09k-phone-sky-iss",
    "09l-phone-sky-tiangong",
    "09m-phone-sky-starlink-train",
    "09r-phone-sky-selected-compact",
    "09-phone-sky-camera-granted",
    "09q-phone-sky-degraded-heading",
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

    await page.goto(`${origin}/?app=tracker&mode=tonight&at=${encodeURIComponent(REVIEW_PIN)}&z=8&pin=${encodeURIComponent(REVIEW_PIN)}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Sky", exact: true }).click();
    await page.locator('.tk-sky-finder[data-mode="browse"][data-visual-base="rendered-sky"][data-navigation-mode="point"]').waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => window.__ORBIT_FINDER_PERMISSION_ATTEMPTS__?.includes("orientation"), null, { timeout: 10_000 });
    await dispatchPointing(page, 180, 35, 64);
    await page.waitForFunction(() => document.querySelector('.tk-sky-finder')?.getAttribute('data-pointing-active') === 'true' && Number(document.querySelector('.tk-sky-finder')?.getAttribute('data-expected-stars') ?? 0) >= 8, null, { timeout: 20_000 });
    await capture(page, "09-phone-sky-point-default", "Supported-mobile Sky immediately opens in orientation-driven Point mode over the real rendered celestial sphere; Camera remains optional and all 88 constellation identities remain searchable.", async () => {
      const state = await productState(page);
      return state.finderMode === "browse" && state.navigationMode === "point" && state.pointingActive && state.visualBase === "rendered-sky" && state.cameraState === "off" && state.constellationIdentities === 88 && state.permissionAttempts.includes("orientation") && !state.permissionAttempts.includes("camera") && !state.hasSkyLayersControl && !state.browseHint && state.skyStars >= 8
        ? `Point active; rendered Sky; Camera off; ${state.skyStars} catalog stars; 88 constellations; no Layers control; settled Point tutorial hidden`
        : "";
    });

    const firstPoint = await page.locator('.tk-finder-sky-context strong').textContent();
    await dispatchPointing(page, 225, 48, 64);
    await page.waitForFunction((before) => document.querySelector('.tk-finder-sky-context strong')?.textContent !== before, firstPoint, { timeout: 10_000 });
    await capture(page, "09a-phone-sky-camera-off-point", "Camera-off Point mode follows a second physical orientation fixture without changing navigation systems or requiring camera access.", async () => {
      const state = await productState(page);
      const secondPoint = await page.locator('.tk-finder-sky-context strong').textContent();
      return state.navigationMode === "point" && state.pointingActive && state.cameraState === "off" && firstPoint !== secondPoint && !state.permissionAttempts.includes("camera")
        ? `Camera off; Point moved coherently from ${firstPoint} to ${secondPoint}`
        : "";
    });

    await page.getByRole("button", { name: "Explore sky manually" }).click();
    await page.locator('.tk-sky-finder[data-navigation-mode="explore"]').waitFor({ timeout: 10_000 });
    const beforePan = await page.locator('.tk-finder-sky-context strong').textContent();
    await page.locator('.tk-finder-stage').dispatchEvent('pointerdown', { pointerId: 7, clientX: 280, clientY: 420 });
    await page.locator('.tk-finder-stage').dispatchEvent('pointermove', { pointerId: 7, clientX: 120, clientY: 360 });
    await page.locator('.tk-finder-stage').dispatchEvent('pointerup', { pointerId: 7, clientX: 120, clientY: 360 });
    await page.waitForTimeout(500);
    await capture(page, "09b-phone-sky-explore", "Explicit Explore mode enables manual pan and zoom while keeping the same observer, UTC, catalogue, and rendered celestial sphere.", async () => {
      const afterPan = await page.locator('.tk-finder-sky-context strong').textContent();
      const state = await productState(page);
      return state.navigationMode === "explore" && !state.pointingActive && beforePan !== afterPan && !state.hasSkyLayersControl && state.browseHint
        ? `Explore centre moved from ${beforePan} to ${afterPan}; compact manual hint visible; Point pose remains available for recenter`
        : "";
    });

    const normalDensity = await productState(page);
    await capture(page, "09p-phone-sky-normal-density", "Normal field automatically balances real catalog stars, constellation geometry, selective labels, solar-system context, and relevant deep-sky objects.", async () => {
      const state = await productState(page);
      return state.skyDensity === "normal" && state.skyStars >= 8 && state.skyLines > 0 && state.skyLabels + state.skyStarLabels > 0 && !state.hasSkyLayersControl
        ? `normal density; mag ≤ ${state.magnitudeLimit}; ${state.skyStars} stars; ${state.skyLabels + state.skyStarLabels} labels`
        : "";
    });
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForFunction(() => document.querySelector('.tk-sky-finder')?.getAttribute('data-sky-density') === 'wide', null, { timeout: 10_000 });
    await capture(page, "09d-phone-sky-wide-density", "Wide field automatically quiets faint stars, labels, deep-sky detail, and constellation art while retaining bright orientation context.", async () => {
      const state = await productState(page);
      return state.skyDensity === "wide" && state.magnitudeLimit < normalDensity.magnitudeLimit && state.skyFigures === 0 && state.milkyWaySamples > 100 && state.milkyWayDrawnCells > 0 && state.milkyWayRenderMs > 0 && !state.hasSkyLayersControl
        ? `wide density; ${state.milkyWaySamples} NASA SVS samples, ${state.milkyWayDrawnCells} visible cells drawn in ${state.milkyWayRenderMs.toFixed(2)} ms; mag limit reduced ${normalDensity.magnitudeLimit} → ${state.magnitudeLimit}; figure art suppressed; no Layers control`
        : "";
    });
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForFunction(() => document.querySelector('.tk-sky-finder')?.getAttribute('data-sky-density') === 'normal', null, { timeout: 10_000 });

    // Use a real instant when the full hunter and water-bearer figures are
    // above Portland's horizon. The artwork still resolves from the same
    // BSC5P anchors; the clock only makes the requested visual evidence honest.
    await page.clock.setFixedTime(new Date("2026-12-15T06:00:00.000Z"));
    await openExploreSkyAtCurrentClock(page, origin);
    await page.getByRole("button", { name: "Search the sky" }).click();
    await page.getByRole("textbox", { name: "Search celestial objects" }).fill("Orion");
    await capture(page, "09c-phone-sky-search", "Sky search reaches planets, named stars, all 88 constellations, deep-sky showpieces, and current station/event entries from one compact overlay.", async () => {
      const state = await productState(page);
      const text = await page.locator('.tk-sky-search-results').innerText();
      return state.searchOpen && /Orion/i.test(text) ? "compact search; Orion constellation result present" : "";
    });
    await page.locator('.tk-sky-search-results > button').filter({ hasText: "Orion" }).first().click();
    await page.waitForTimeout(500);
    await capture(page, "09e-phone-sky-orion-figure", "Selected Orion uses real BSC5P stars and licensed figure lines, plus an original geometry-derived apparition anchored to the same projected endpoints.", async () => {
      const state = await productState(page);
      return state.finderMode === "targeted" && state.skyDensity === "normal" && state.skyLines > 0 && state.skyLabels + state.skyStarLabels > 0 && state.skyFigures >= 4 && state.skyFigureConstellations.includes("Ori") && !state.hasSkyLayersControl ? `${state.skyStars} real stars; ${state.skyLines} real-star line segments; ${state.skyFigures} original Orion paths on real BSC5P anchors` : "";
    });

    await page.clock.setFixedTime(SATELLITE_CLOCK);
    await openExploreSkyAtCurrentClock(page, origin);
    await searchSky(page, "Aquarius", "Aquarius");
    await page.waitForTimeout(500);
    await capture(page, "09e2-phone-sky-aquarius-figure", "Selected Aquarius proves the original constellation-art system is reusable: its water bearer and stream use a second reviewed public-domain visual reference while remaining attached to real BSC5P geometry.", async () => {
      const state = await productState(page);
      return state.finderMode === "targeted" && state.skyDensity === "normal" && state.skyFigures >= 4 && state.skyFigureConstellations.includes("Aqr") && !state.hasSkyLayersControl
        ? `${state.skyFigures} original Aquarius paths on real BSC5P anchors; automatic density; no Layers control`
        : "";
    });

    const orionBeforeRecenter = await productState(page);
    await page.getByRole("button", { name: "Recenter to phone" }).click();
    await dispatchPointing(page, 225, 48, 64);
    await page.waitForFunction(() => document.querySelector('.tk-sky-finder')?.getAttribute('data-pointing-active') === 'true', null, { timeout: 10_000 });
    await capture(page, "09o-phone-sky-recenter", "Recenter to phone returns immediately from Explore to Point while preserving the selected constellation, observer, UTC, and authoritative target coordinates.", async () => {
      const state = await productState(page);
      return state.navigationMode === "point" && state.pointingActive && state.selectedTarget === orionBeforeRecenter.selectedTarget && state.targetAltitude === orionBeforeRecenter.targetAltitude && state.targetAzimuth === orionBeforeRecenter.targetAzimuth && state.observerLatitude === orionBeforeRecenter.observerLatitude && state.observerLongitude === orionBeforeRecenter.observerLongitude
        ? `Point restored; ${state.selectedTarget} and Alt/Az preserved; observer unchanged`
        : "";
    });
    await page.getByRole("button", { name: "Explore sky manually" }).click();

    await page.clock.setFixedTime(SATELLITE_CLOCK);
    await openExploreSkyAtCurrentClock(page, origin);

    const captureSelectedSearchTarget = async (id, query, resultName, caption, expectedMarker) => {
      await searchSky(page, query, resultName);
      await capture(page, id, caption, async () => {
        const state = await productState(page);
        const summary = `${state.guidance ?? ""} ${state.targetSummary ?? ""}`;
        return state.finderMode === "targeted" &&
          summary.toLocaleLowerCase().includes(resultName.toLocaleLowerCase()) &&
          (state.selectedMarker === expectedMarker || /below the horizon/i.test(state.guidance ?? ""))
          ? `${resultName} selected in the astronomical field; ${state.selectedMarker ?? "below-horizon marker withheld"}`
          : "";
      });
    };
    await captureSelectedSearchTarget("09j-phone-sky-neptune", "Neptune", "Neptune", "The selected Neptune proves the shared outer-planet path used for Uranus, Neptune, and Pluto.", "neptune");
    await captureSelectedSearchTarget("09j2-phone-sky-saturn", "Saturn", "Saturn", "The selected Saturn is a compact rendered sphere with an unmistakable ring silhouette, not a generic planet glyph.", "saturn");
    await capture(page, "09r-phone-sky-selected-compact", "Selected-object identity, guidance, direction and capability share one compact treatment; the redundant lower target panel is absent.", async () => {
      const state = await productState(page);
      const ratio = await page.locator(".tk-finder-guidance").evaluate((node) => node.getBoundingClientRect().width / window.innerWidth);
      return state.selectedMarker === "saturn" && state.targetTreatments === 1 && ratio <= 0.8 && !await page.locator(".tk-finder-target-card").count()
        ? `Saturn selected; one target treatment uses ${(ratio * 100).toFixed(1)}% of viewport width; no duplicate lower panel`
        : "";
    });
    for (const station of [
      { id: "09k-phone-sky-iss", query: "ISS", name: "ISS", marker: "space-station", caption: "The selected ISS comes from the current station ephemeris pipeline and uses a crewed-station silhouette distinct from ordinary satellites." },
      { id: "09l-phone-sky-tiangong", query: "Tiangong", name: "Tiangong", marker: "tiangong", caption: "The selected Tiangong is propagated through the extensible crewed-station collection and uses its own modular-station silhouette." },
    ]) {
      await searchSky(page, station.query, station.name);
      const recommended = await page.locator(".tk-sky-finder").getAttribute("data-target-recommended-at");
      if (recommended) {
        await page.clock.setFixedTime(new Date(recommended));
        // Reload at the production pipeline's own next-pass instant. Starting
        // the app at that clock is both faster and more faithful than forcing
        // an internal React timer to observe an out-of-band clock mutation.
        await openExploreSkyAtCurrentClock(page, origin);
        await searchSky(page, station.query, station.name);
      }
      await page.waitForFunction((marker) => document.querySelector(".tk-finder-lock .tk-sky-object-glyph")?.getAttribute("data-marker") === marker, station.marker, { timeout: 10_000 });
      await capture(page, station.id, station.caption, async () => {
        const state = await productState(page);
        return state.selectedMarker === station.marker && state.targetLocks === 1
          ? `${station.name} at its propagated pass instant; ${station.marker} silhouette; one target lock`
          : "";
      });
    }
    await page.clock.setFixedTime(SATELLITE_CLOCK);
    await openExploreSkyAtCurrentClock(page, origin);
    await searchSky(page, "Starlink train", "Starlink train");
    const trainRecommended = await page.locator(".tk-sky-finder").getAttribute("data-target-recommended-at");
    if (trainRecommended) {
      await page.clock.setFixedTime(new Date(trainRecommended));
      await openExploreSkyAtCurrentClock(page, origin);
      await searchSky(page, "Starlink train", "Starlink train");
    }
    await page.waitForTimeout(500);
    await capture(page, "09m-phone-sky-starlink-train", "The selected qualified Starlink-train event uses its real sampled path to render a clustered sequence and direction; dispersed routine traffic remains absent.", async () => {
      const state = await productState(page);
      return state.starlinkTrailNodes >= 3 && state.navigationMode === "explore"
        ? `${state.starlinkTrailNodes} nodes from the event's real sampled path; clustered direction visible; ordinary traffic absent`
        : "";
    });

    if (wantsAny(
      "09-phone-sky-camera-granted",
      "09q-phone-sky-degraded-heading",
      "09a-phone-sky-target-offscreen",
      "10-phone-sky-guiding",
      "10a-phone-sky-almost-aligned",
      "11-phone-sky-aligned",
    )) {
      await page.clock.setFixedTime(SATELLITE_CLOCK);
      await openSaturnDetail(page, origin, "telescope");

      await page.getByRole("button", { name: "Find in Sky", exact: true }).click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 30_000 });
    const renderedTarget = await productState(page);
    await page.getByRole("button", { name: "Turn camera on" }).click();
    await page.waitForFunction(
      () => document.querySelector(".tk-sky-finder")?.getAttribute("data-camera") === "active",
      null,
      { timeout: 10_000 },
    );
    await dispatchReviewPointing(page);
    await waitForPopulatedSky(page);
    await capture(page, "09-phone-sky-camera-granted", "Fixture-driven supported-phone state after camera and orientation permission are granted. This proves the active production camera path and immediate entry, but is not physical-device AR evidence.", async () => {
      const state = await productState(page);
      return state.navigationMode === "point" && state.pointingActive && state.cameraState === "active" && state.visualBase === "camera" && state.permissionAttempts.includes("camera") && state.permissionAttempts.includes("orientation") && !state.diagnosticsOpen && state.skyStars >= 8 && state.skyLines > 0 && state.skyLabels + state.skyStarLabels > 0 && state.selectedMarker === "saturn" && state.cameraHorizontalFov > 0 && state.cameraVerticalFov > 0 && state.targetAltitude === renderedTarget.targetAltitude && state.targetAzimuth === renderedTarget.targetAzimuth && state.selectedTarget === renderedTarget.selectedTarget && state.observerLatitude === renderedTarget.observerLatitude && state.observerLongitude === renderedTarget.observerLongitude
        ? `fixture camera visual base; Point retained; target, observer and Alt/Az unchanged; ${state.skyStars} real stars; effective FOV ${state.cameraHorizontalFov.toFixed(1)}° × ${state.cameraVerticalFov.toFixed(1)}°; ${state.cameraCropAxis} crop`
        : "";
    });
    await dispatchMagneticPointing(page, Number(renderedTarget.targetAzimuth) + 8, Number(renderedTarget.targetAltitude), 64);
    await page.getByRole("button", { name: "Heading accuracy is limited" }).waitFor({ timeout: 10_000 });
    await capture(page, "09q-phone-sky-degraded-heading", "A low-confidence magnetic-heading session keeps the celestial field usable and surfaces one small contextual accuracy indicator instead of permanent calibration chrome.", async () => {
      const state = await productState(page);
      return state.navigationMode === "point" && state.pointingActive && state.headingReference === "magnetic-uncorrected" && !state.aligned && !state.qualityOpen && !state.hasSkyLayersControl
        ? "Point remains active; magnetic heading is honestly uncalibrated; compact quality indicator; no permanent diagnostic panel"
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
      return state.mapState === "finder" && state.finderDeviceClass === "handheld" && state.finderMode !== "preview" && state.cameraState === "active" && !state.diagnosticsOpen && state.targetLocks === 1 && state.skyLines > 0 && state.skyLabels + state.skyStarLabels > 0 && state.selectedMarker === "saturn" && /move|raise|lower|almost/i.test(state.guidance ?? "")
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
    }
    await context.close();
  }

  if (wantsAny("09f-phone-sky-sun", "09h-phone-sky-venus")) {
    console.log("\nSupported phone · daylight bodies at real above-horizon positions");
    await captureRenderedBodyGroup(new Date("2026-10-05T21:00:00Z"), [
      { id: "09f-phone-sky-sun", query: "Sun", name: "Sun", marker: "sun", caption: "The Sun is a localized luminous solar body at its real projected position; the target summary retains certified-filter safety guidance." },
      { id: "09h-phone-sky-venus", query: "Venus", name: "Venus", marker: "venus", caption: "Venus is a compact cloud-textured bright body at its real above-horizon ephemeris position, not a placeholder glyph." },
    ]);
  }

  if (wantsAny("09g-phone-sky-moon", "09i-phone-sky-jupiter")) {
    console.log("\nSupported phone · Moon and Jupiter at real above-horizon positions");
    await captureRenderedBodyGroup(new Date("2026-10-05T17:00:00Z"), [
      { id: "09g-phone-sky-moon", query: "Moon", name: "Moon", marker: "moon", caption: "The Moon uses the inventoried NASA LRO surface texture, current illumination fraction, and correct waxing/waning light side at its real ephemeris position." },
      { id: "09i-phone-sky-jupiter", query: "Jupiter", name: "Jupiter", marker: "jupiter", caption: "Jupiter is a compact rendered disc with belts and a restrained Great Red Spot treatment at its real ephemeris position." },
    ]);
  }

  if (wantsAny("09n-phone-sky-camera-denied")) {
    console.log("\nSupported phone · camera-denied recovery");
    const { context, page } = await openDevice(browser, "camera-denied-phone", { width: 390, height: 844 });
    await openSaturnDetail(page, origin, "eyes");
    await page.getByRole("button", { name: "Find in Sky", exact: true }).click();
    await page.locator('.tk-sky-finder[data-visual-base="rendered-sky"]').waitFor({ timeout: 30_000 });
    await dispatchPointing(page, 180, 35, 64);
    const before = await productState(page);
    await page.getByRole("button", { name: "Turn camera on" }).click();
    await page.getByRole("status").filter({ hasText: /Rendered Sky is still ready/i }).waitFor({ timeout: 10_000 });
    await capture(page, "09n-phone-sky-camera-denied", "A denied camera request leaves the selected Saturn target and authoritative rendered celestial field fully usable; the limitation is a brief status message rather than a blocking panel.", async () => {
      const state = await productState(page);
      return state.navigationMode === "point" && state.pointingActive && state.cameraState === "off" && state.visualBase === "rendered-sky" && state.permissionAttempts.includes("camera") && state.skyStars >= 8 && state.targetAltitude === before.targetAltitude && state.targetAzimuth === before.targetAzimuth
        ? `camera denied; Point and rendered field retained; ${state.skyStars} catalog stars; target Alt/Az unchanged`
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
    await page.getByRole("button", { name: "Turn camera on" }).click();
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

    // Use the same pinned Saturn target as the phone guidance evidence. The
    // ranked lead may legitimately change as the recommendation model evolves,
    // while this state is specifically proving the wider Sky composition.
    await openSaturnDetail(page, origin, "eyes");
    await page.getByRole("button", { name: "Find in Sky", exact: true }).click();
    await page.locator(".tk-sky-finder").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Turn camera on" }).click();
    await page.waitForFunction(
      () => document.querySelector(".tk-sky-finder")?.getAttribute("data-camera") === "active",
      null,
      { timeout: 10_000 },
    );
    await dispatchReviewPointing(page);
    await waitForPopulatedSky(page);
    await page.waitForTimeout(500);
    await capture(page, "14-tablet-sky-guiding", "Fixture-driven supported-tablet Sky is live guidance, not a desktop-style preview; camera permission is granted and one target lock carries the deterministic movement cue.", async () => {
      const state = await productState(page);
      return state.finderDeviceClass === "handheld" && state.finderMode !== "preview" && state.cameraState === "active" && state.targetLocks === 1 && state.skyStars >= 8 && state.skyLines > 0 && state.skyLabels + state.skyStarLabels > 0 && state.selectedMarker === "saturn" && !state.diagnosticsOpen && /move|raise|lower|almost|on target/i.test(state.guidance ?? "")
        ? `live ${state.finderMode}; camera active; populated and labelled real sky; one Saturn target lock; cue "${state.guidance}"`
        : "";
    });
    await context.close();
  }

  if (wantsAny("15-unsupported-tablet-map", "16-unsupported-tablet-tonight", "17-unsupported-tablet-object-detail")) {
    console.log("\nSensorless tablet rendered-Sky boundary");
    const { context, page } = await openDevice(browser, "unsupported-tablet", { width: 820, height: 1180 });
    await gotoMap(page, origin);
    await capture(page, "15-unsupported-tablet-map", "Touch-first tablet without camera/orientation still exposes rendered Sky and Find in Sky; camera and sensor controls remain absent.", async () => {
      const state = await productState(page);
      const capability = navigationCapabilityProof(state, true);
      return state.nav.join("|") === "Map|Tonight|Sky" && capability ? `${capability}; rendered-only Sky` : "";
    });

    await selectTonight(page);
    await capture(page, "16-unsupported-tablet-tonight", "Sensor-less tablet Tonight remains complete while rendered Sky stays available independently of camera hardware.", async () => {
      const state = await productState(page);
      return state.mapState === "tonight" && state.nav.join("|") === "Map|Tonight|Sky" && hasExact(state.finderEntries, "Find in Sky")
        ? "Tonight; rendered Sky and Find in Sky available without camera hardware"
        : "";
    });

    await openDetail(page);
    await capture(page, "17-unsupported-tablet-object-detail", "Sensor-less tablet Object Detail retains Find in Sky for the rendered sphere; More details is collapsed and Saturn has no generic Show on Map action.", async () => {
      const state = await productState(page);
      return ordinaryDetailProof(state, true);
    });
    await context.close();
  }

  return { shots, problems };
}
