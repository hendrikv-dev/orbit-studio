import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const url = process.argv[2] ?? "http://127.0.0.1:5175/";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "ipad-mini-portrait", width: 744, height: 1133 },
  { name: "ipad-portrait", width: 834, height: 1194 },
];
const unsupportedViewport = { name: "unsupported-small", width: 390, height: 844 };

await mkdir("screenshots", { recursive: true });

const browser = await chromium.launch();
const results = [];

for (const viewport of viewports) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas", { timeout: 10000 });
  await page.waitForTimeout(1400);
  await page.screenshot({
    path: `screenshots/apsis-${viewport.name}.png`,
    fullPage: true,
  });

  const canvasMetrics = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      return { ok: false, reason: "No canvas found" };
    }

    const rect = canvas.getBoundingClientRect();
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) {
      return { ok: false, reason: "No WebGL context", rect };
    }

    const sample = new Uint8Array(4);
    let brightPixels = 0;
    let alphaPixels = 0;
    const xs = [0.2, 0.35, 0.5, 0.65, 0.8];
    const ys = [0.25, 0.4, 0.55, 0.7, 0.85];

    for (const xRatio of xs) {
      for (const yRatio of ys) {
        const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width * xRatio)));
        const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height * yRatio)));
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
        const brightness = sample[0] + sample[1] + sample[2];
        if (sample[3] > 0) alphaPixels += 1;
        if (brightness > 20) brightPixels += 1;
      }
    }

    return {
      ok: rect.width > 100 && rect.height > 100 && alphaPixels > 0 && brightPixels > 0,
      rect: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      },
      alphaPixels,
      brightPixels,
    };
  });

  results.push({ viewport: viewport.name, ...canvasMetrics });
  await page.close();
}

const unsupportedPage = await browser.newPage({
  viewport: { width: unsupportedViewport.width, height: unsupportedViewport.height },
  deviceScaleFactor: 1,
});
await unsupportedPage.goto(url, { waitUntil: "domcontentloaded" });
await unsupportedPage.waitForSelector(".small-viewport-gate", { timeout: 10000 });
await unsupportedPage.waitForTimeout(600);
await unsupportedPage.screenshot({
  path: `screenshots/apsis-${unsupportedViewport.name}.png`,
  fullPage: true,
});

const unsupportedGate = await unsupportedPage.evaluate(() => {
  const gate = document.querySelector(".small-viewport-gate");
  const text = gate?.textContent ?? "";
  const style = gate ? window.getComputedStyle(gate) : null;

  return {
    ok:
      Boolean(gate) &&
      style?.display !== "none" &&
      text.includes("Orbit Studio is designed for tablets and larger screens.") &&
      text.includes("Continue anyway") &&
      text.includes("Learn more") &&
      text.includes("Open on tablet or desktop"),
    display: style?.display ?? null,
  };
});

results.push({ viewport: unsupportedViewport.name, ...unsupportedGate });
await unsupportedPage.close();

await browser.close();

console.log(JSON.stringify(results, null, 2));

if (!results.every((result) => result.ok)) {
  process.exitCode = 1;
}
