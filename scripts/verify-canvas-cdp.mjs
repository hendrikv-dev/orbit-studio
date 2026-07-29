const endpoint = 'http://127.0.0.1:9222';
const appUrl = process.argv[2] ?? 'http://localhost:5173/';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const tabs = await fetchJson(`${endpoint}/json`);
  const page = tabs.find((tab) => tab.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('No debuggable Chrome page found.');
  }

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const desktop = await verifyViewport(cdp, 'desktop', 1440, 980, false);
  const ipadMiniPortrait = await verifyViewport(cdp, 'ipad-mini-portrait', 744, 1133, false);
  const ipadLandscape = await verifyViewport(cdp, 'ipad-landscape', 1180, 820, false);
  const unsupportedSmall = await verifyUnsupportedSmallViewport(cdp);

  console.log(JSON.stringify({ desktop, ipadMiniPortrait, ipadLandscape, unsupportedSmall }, null, 2));
  cdp.close();
}

async function verifyUnsupportedSmallViewport(cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send('Page.navigate', { url: appUrl });
  await waitForGate(cdp);

  const passed = await cdp.evaluate(`(() => {
    const gate = document.querySelector('.small-viewport-gate');
    const text = gate?.textContent ?? '';
    const display = gate ? getComputedStyle(gate).display : 'none';
    return display !== 'none' &&
      text.includes('Orbit Studio is designed for tablets and larger screens.') &&
      text.includes('Continue anyway') &&
      text.includes('Learn more') &&
      text.includes('Open on tablet or desktop');
  })()`);

  if (!passed) {
    throw new Error('unsupported-small viewport gate check failed');
  }

  return { passed };
}

async function verifyViewport(cdp, name, width, height, useCompactDeviceMetrics) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: useCompactDeviceMetrics
  });
  await cdp.send('Page.navigate', { url: appUrl });
  await waitForCanvas(cdp);
  await sleep(1800);

  const before = await canvasStats(cdp);
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === '1000x');
    button?.click();
  })()`);
  await sleep(1000);
  const after = await canvasStats(cdp);

  const passed =
    before.width >= width &&
    before.height >= height &&
    before.nonDarkRatio > 0.025 &&
    before.uniqueBuckets > 18 &&
    after.hash !== before.hash &&
    after.meanDelta > 0.35;

  if (!passed) {
    throw new Error(`${name} canvas check failed: ${JSON.stringify({ before, after })}`);
  }

  return { passed, before, after };
}

async function waitForCanvas(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await cdp.evaluate(`(() => {
      const canvas = document.querySelector('canvas');
      return Boolean(canvas && canvas.width > 0 && canvas.height > 0 && document.readyState !== 'loading');
    })()`);
    if (result === true) return;
    await sleep(100);
  }
  throw new Error('Canvas did not become ready.');
}

async function waitForGate(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await cdp.evaluate(`(() => {
      const gate = document.querySelector('.small-viewport-gate');
      return Boolean(gate && getComputedStyle(gate).display !== 'none');
    })()`);
    if (result === true) return;
    await sleep(100);
  }
  throw new Error('Small viewport gate did not become ready.');
}

async function canvasStats(cdp) {
  return cdp.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const sample = document.createElement('canvas');
    sample.width = 96;
    sample.height = 96;
    const ctx = sample.getContext('2d');
    ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
    let nonDark = 0;
    let total = 0;
    let hash = 2166136261;
    const buckets = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      total += luma;
      if (luma > 18) nonDark += 1;
      buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      hash ^= r + (g << 8) + (b << 16);
      hash = Math.imul(hash, 16777619);
    }
    const mean = total / (data.length / 4);
    const previous = window.__apsisMean ?? mean;
    window.__apsisMean = mean;
    return {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      nonDarkRatio: nonDark / (data.length / 4),
      uniqueBuckets: buckets.size,
      hash: hash >>> 0,
      mean,
      meanDelta: Math.abs(mean - previous)
    };
  })()`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json();
}

async function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const callbacks = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const callback = callbacks.get(message.id);
    if (!callback) return;
    callbacks.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  return {
    send(method, params = {}) {
      const messageId = ++id;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => callbacks.set(messageId, { resolve, reject }));
    },
    async evaluate(expression) {
      const result = await this.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? 'Runtime evaluation failed.');
      }
      return result.result.value;
    },
    close() {
      socket.close();
    }
  };
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
