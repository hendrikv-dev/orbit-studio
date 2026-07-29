import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { sanitizeLocalAppStateOnBoot } from "./lib/appStateReset";
import "./styles/app.css";

sanitizeLocalAppStateOnBoot();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);

if (new URLSearchParams(window.location.search).has("profileFrames")) {
  void import("./performance/frameProfiler").then(({ startFrameProfiler }) => {
    startFrameProfiler();
  });
}
