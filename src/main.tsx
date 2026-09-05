import React from "react";
import ReactDOM from "react-dom/client";
import { APP_READY_EVENT } from "./lib/appReady";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { sanitizeLocalAppStateOnBoot } from "./lib/appStateReset";
// Typefaces, self-hosted rather than linked. A font CDN is a third-party
// request on every load, a privacy leak, and a silent fallback to the system
// stack whenever it is blocked — which for a dark interface read at night is a
// visible change, not a graceful degradation.
//
// Variable weights for the two text families so the whole scale comes from one
// file each; Space Mono has no variable cut and ships as two static weights.
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "./styles/app.css";

sanitizeLocalAppStateOnBoot();

const root = ReactDOM.createRoot(document.getElementById("root")!);

/**
 * Clear the static boot indicator once something is actually drawn.
 *
 * Removing it at mount was not enough: React mounts as soon as the catalog has
 * parsed, but the WebGL scene needs several seconds more, so the indicator
 * vanished and left exactly the blank viewport it exists to cover. It waits for
 * a rendering surface to appear and paint, with a cap so a headless or
 * WebGL-less environment cannot strand it.
 */
function clearBootIndicatorWhenPainted(): void {
  const indicator = document.getElementById("boot-indicator");
  if (!indicator) return;
  const started = performance.now();
  const remove = () => indicator.remove();
  const check = () => {
    if (!indicator.isConnected) return;
    if (performance.now() - started > 15000) return remove();
    // Every surface announces itself; the DOM cannot tell. The check loop only
    // enforces the timeout now.
    requestAnimationFrame(check);
  };
  window.addEventListener(APP_READY_EVENT, remove, { once: true });
  requestAnimationFrame(check);
}
const mount = (node: React.ReactNode) => {
  clearBootIndicatorWhenPainted();
  return root.render(
    <React.StrictMode>
      <AppErrorBoundary>{node}</AppErrorBoundary>
    </React.StrictMode>,
  );
};

/**
 * FEASIBILITY SPIKE mount, at the entry point rather than inside App.
 *
 * Mounting it inside App looked equivalent and was not: the early return still
 * evaluated App's whole import graph, so a page drawing one SVG downloaded the
 * 17 MB satellite catalog, drei and a star catalog before rendering. Anything
 * observer-facing has to be reachable without importing the catalog at all.
 */
const requestedApp = new URLSearchParams(window.location.search).get("app");

/**
 * Tracker is a sibling entry, not a mode inside App. App imports the 16 MB
 * satellite catalog, and TRACKER_PRD R7.1 requires an observer page not to pay
 * for data it never shows, so the two are separated here rather than by a
 * branch further in.
 */
if (requestedApp === "tracker") {
  void import("./components/tracker/TrackerApp").then(({ TrackerApp }) => {
    mount(<TrackerApp />);
  });
} else if (new URLSearchParams(window.location.search).get("spike") === "tracker") {
  void import("./components/tracker/TrackerSpike").then(({ TrackerSpike }) => {
    mount(<TrackerSpike />);
  });
} else {
  void import("./App").then(({ App }) => mount(<App />));
}

if (new URLSearchParams(window.location.search).has("profileFrames")) {
  void import("./performance/frameProfiler").then(({ startFrameProfiler }) => {
    startFrameProfiler();
  });
}
