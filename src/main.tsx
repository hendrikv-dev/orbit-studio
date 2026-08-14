import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { sanitizeLocalAppStateOnBoot } from "./lib/appStateReset";
import "./styles/app.css";

sanitizeLocalAppStateOnBoot();

const root = ReactDOM.createRoot(document.getElementById("root")!);
const mount = (node: React.ReactNode) =>
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>{node}</AppErrorBoundary>
    </React.StrictMode>,
  );

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
