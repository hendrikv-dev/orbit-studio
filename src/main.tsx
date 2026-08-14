import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { sanitizeLocalAppStateOnBoot } from "./lib/appStateReset";
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
    // A canvas-based view announces its own first drawn frame; the DOM cannot
    // tell, because the canvas is present and sized while still blank. Views
    // without a renderer (the Observe spike) fall back to a drawn SVG.
    if (!document.querySelector("#root canvas")) {
      const drawn = [...document.querySelectorAll("#root svg")].find(
        (node) => node.getBoundingClientRect().width >= 240,
      );
      if (drawn) return requestAnimationFrame(() => requestAnimationFrame(remove));
    }
    requestAnimationFrame(check);
  };
  window.addEventListener("orbit-studio:first-frame", remove, { once: true });
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
if (new URLSearchParams(window.location.search).get("spike") === "observe") {
  void import("./components/observe/ObserveSpike").then(({ ObserveSpike }) => {
    mount(<ObserveSpike />);
  });
} else {
  void import("./App").then(({ App }) => mount(<App />));
}

if (new URLSearchParams(window.location.search).has("profileFrames")) {
  void import("./performance/frameProfiler").then(({ startFrameProfiler }) => {
    startFrameProfiler();
  });
}
