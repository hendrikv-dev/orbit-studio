import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Orbit, Pause, Play } from "lucide-react";
import { PlaybackSpeedSlider } from "./components/PlaybackSpeedSlider";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ExplorerView } from "./components/explorer/ExplorerView";
import { OrbitStudioHome } from "./components/home/OrbitStudioHome";
import { OrbitAppMenu, ShowInterfaceButton } from "./components/layout/OrbitAppMenu";
import { OrbitControlsPanel } from "./components/OrbitControlsPanel";
import {
  createExplorerCurrentSnapshot,
  createExplorerScenario,
  currentExplorerSnapshot,
  explorerCurrentCatalogMode,
  explorerSnapshotForDateIso,
  type ExplorerSnapshot,
} from "./data/explorerCatalog";
import { createPlaygroundScenario } from "./lib/scenario";
import { SimulationScene } from "./rendering/SimulationScene";
import {
  getSimulationStoreForEnvironment,
  setActiveSimulationEnvironment,
  useSimulationStore,
} from "./state/useSimulationStore";
import { readStudioPlaybackTimeIso } from "./state/studioPlaybackClock";
import { isOrbitStudioReviewMode } from "./review/reviewBridge";

type ProductMode = "home" | "explorer" | "playground";
type PlaygroundMobileSurface = "orbit" | null;
const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "KeyB",
  "KeyA",
] as const;

function keyTokenForKonami(event: KeyboardEvent): string | null {
  if (
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight"
  ) {
    return event.key;
  }

  const key = event.key.toLowerCase();

  if (event.code === "KeyB" || key === "b") return "KeyB";
  if (event.code === "KeyA" || key === "a") return "KeyA";

  return null;
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();

  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}

function AuroraToast({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="aurora-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

function initialExplorerSnapshot(): ExplorerSnapshot {
  if (
    isOrbitStudioReviewMode() ||
    explorerCurrentCatalogMode === "release-public-gcat"
  ) {
    return currentExplorerSnapshot;
  }

  if (import.meta.env.DEV && typeof window !== "undefined") {
    const diagnosticTime = new URLSearchParams(window.location.search).get("simulationTime");
    if (diagnosticTime) return explorerSnapshotForDateIso(diagnosticTime);
  }

  return createExplorerCurrentSnapshot(
    getSimulationStoreForEnvironment("explorer").getState().scenario.simulationTimeUtc,
  );
}

function readInitialProductMode(): ProductMode {
  if (isOrbitStudioReviewMode()) return "explorer";
  if (typeof window === "undefined") return "home";

  const requestedApp = new URLSearchParams(window.location.search).get("app");
  if (requestedApp === "explorer" || requestedApp === "playground") return requestedApp;
  return "home";
}

function appQueryHref(mode: ProductMode): string {
  const url = new URL(window.location.href);
  if (mode === "home") url.searchParams.delete("app");
  else url.searchParams.set("app", mode);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Switching apps has to leave a history entry behind, otherwise Back walks off
 * the site instead of returning to the previous app. Repeating the active mode
 * still replaces, so re-tapping the current app cannot stack duplicate entries.
 */
function recordAppQuery(mode: ProductMode): void {
  if (typeof window === "undefined") return;
  const href = appQueryHref(mode);
  if (mode === readInitialProductMode()) window.history.replaceState({ app: mode }, "", href);
  else window.history.pushState({ app: mode }, "", href);
}

function developmentCelestialPlaybackPaused(): boolean {
  return isOrbitStudioReviewMode() || (
    import.meta.env.DEV &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("celestialPaused") === "1"
  );
}

function resetPlaygroundStoreNow(): void {
  const store = getSimulationStoreForEnvironment("playground").getState();
  const scenario = createPlaygroundScenario(new Date(readStudioPlaybackTimeIso()));

  store.loadScenario(scenario);
  store.setPlaying(true);
  store.setFocusMode(false);
  store.setPanelCollapsed("left", false);
  store.setPanelCollapsed("right", false);
  store.setVisibilityFilter("selectedOnly", false);
  store.setVisibilityFilter("payloads", true);
  store.setVisibilityFilter("debris", false);
  store.setVisibilityFilter("rocketBodies", false);
  store.setVisibilityFilter("constellations", false);
  store.setVisibilityFilter("stations", false);
  store.setVisibilityFilter("regions", false);
  store.setVisibilityFilter("catalog", false);
  store.setLabelMode("hidden");
  store.setCoverageSetting("enabled", false);
  store.setRenderSetting("showCoverageLayer", false);
  store.setRenderSetting("showLatLonGrid", false);
  store.setRenderSetting("showEciGrid", false);
  store.setRenderSetting("showEcefGrid", false);
  store.setRenderSetting("showGeoValidationOverlay", false);
  store.setRenderSetting("showStarOcclusionDiagnostics", false);
  store.setRenderSetting("showAtmosphere", true);
}

function isCleanPlaygroundScenario(): boolean {
  const scenario = getSimulationStoreForEnvironment("playground").getState().scenario;
  return (
    scenario.environment === "playground" &&
    scenario.catalogLayers.length === 0 &&
    scenario.constellations.length === 0 &&
    scenario.satellites.every((satellite) => satellite.catalogMetadata === undefined)
  );
}

export function App() {
  const [productMode, setProductMode] = useState<ProductMode>(() => {
    const initialMode = readInitialProductMode();
    if (initialMode === "playground") resetPlaygroundStoreNow();
    return initialMode;
  });
  setActiveSimulationEnvironment(productMode === "explorer" ? "explorer" : "playground");

  const [activeSnapshot, setActiveSnapshot] = useState<ExplorerSnapshot>(
    initialExplorerSnapshot,
  );
  const explorerScenario = useMemo(
    () => (productMode === "explorer" ? createExplorerScenario(activeSnapshot) : null),
    [activeSnapshot, productMode],
  );
  const [interfaceVisible, setInterfaceVisible] = useState(true);
  const [playgroundSceneSession, setPlaygroundSceneSession] = useState(0);
  const [playgroundMobileSurface, setPlaygroundMobileSurface] =
    useState<PlaygroundMobileSurface>(null);
  const [auroraModeEnabled, setAuroraModeEnabled] = useState(false);
  const [auroraToast, setAuroraToast] = useState<string | null>(null);
  const auroraModeEnabledRef = useRef(false);
  const auroraToastTimeoutRef = useRef<number | null>(null);
  const explorerScenarioInitializedRef = useRef(false);
  const loadScenario = useSimulationStore((state) => state.loadScenario);
  const isPlaying = useSimulationStore((state) => state.isPlaying);
  const playgroundTimeScale = useSimulationStore((state) => state.scenario.timeScale);
  const playgroundIsReverse = useSimulationStore((state) => state.scenario.isReverse);
  const setPlaying = useSimulationStore((state) => state.setPlaying);
  const setTimeScale = useSimulationStore((state) => state.setTimeScale);
  const setReverse = useSimulationStore((state) => state.setReverse);
  const setFocusMode = useSimulationStore((state) => state.setFocusMode);
  const setPanelCollapsed = useSimulationStore((state) => state.setPanelCollapsed);
  const setVisibilityFilter = useSimulationStore((state) => state.setVisibilityFilter);
  const setLabelMode = useSimulationStore((state) => state.setLabelMode);
  const setCoverageSetting = useSimulationStore((state) => state.setCoverageSetting);
  const setRenderSetting = useSimulationStore((state) => state.setRenderSetting);

  const configureExplorer = useCallback((timeScale = 1, playing = true) => {
    setTimeScale(timeScale);
    setPlaying(playing);
    setFocusMode(false);
    setPanelCollapsed("left", false);
    setPanelCollapsed("right", false);
    setVisibilityFilter("selectedOnly", false);
    setVisibilityFilter("payloads", true);
    setVisibilityFilter("debris", true);
    setVisibilityFilter("rocketBodies", true);
    setVisibilityFilter("constellations", true);
    setVisibilityFilter("stations", true);
    setVisibilityFilter("regions", false);
    setVisibilityFilter("catalog", false);
    setLabelMode("hidden");
    setCoverageSetting("enabled", false);
    setRenderSetting("showCoverageLayer", false);
    setRenderSetting("showLatLonGrid", false);
    setRenderSetting("showEciGrid", false);
    setRenderSetting("showEcefGrid", false);
    setRenderSetting("showGeoValidationOverlay", false);
    setRenderSetting("showAtmosphere", true);
  }, [
    setCoverageSetting,
    setFocusMode,
    setLabelMode,
    setPanelCollapsed,
    setPlaying,
    setRenderSetting,
    setTimeScale,
    setVisibilityFilter,
  ]);

  const configurePlayground = useCallback(() => {
    setPlaying(true);
    setFocusMode(false);
    setPanelCollapsed("left", false);
    setPanelCollapsed("right", false);
    setVisibilityFilter("selectedOnly", false);
    setVisibilityFilter("payloads", true);
    setVisibilityFilter("debris", false);
    setVisibilityFilter("rocketBodies", false);
    setVisibilityFilter("constellations", false);
    setVisibilityFilter("stations", false);
    setVisibilityFilter("regions", false);
    setVisibilityFilter("catalog", false);
    setLabelMode("hidden");
    setCoverageSetting("enabled", false);
    setRenderSetting("showCoverageLayer", false);
    setRenderSetting("showLatLonGrid", false);
    setRenderSetting("showEciGrid", false);
    setRenderSetting("showEcefGrid", false);
    setRenderSetting("showGeoValidationOverlay", false);
    setRenderSetting("showStarOcclusionDiagnostics", false);
    setRenderSetting("showAtmosphere", true);
  }, [
    setCoverageSetting,
    setFocusMode,
    setLabelMode,
    setPanelCollapsed,
    setPlaying,
    setRenderSetting,
    setVisibilityFilter,
  ]);

  useLayoutEffect(() => {
    if (productMode !== "explorer" || explorerScenario === null) return;

    const playbackPaused = developmentCelestialPlaybackPaused();

    if (explorerScenarioInitializedRef.current) {
      loadScenario(explorerScenario);
      if (playbackPaused) setPlaying(false);
      return;
    }

    explorerScenarioInitializedRef.current = true;
    // Stop the existing clock before loading a deterministic review scenario so
    // its selected UTC is not advanced by the few milliseconds between calls.
    if (playbackPaused) configureExplorer(1, false);
    loadScenario(explorerScenario);
    if (!playbackPaused) configureExplorer(1, true);
  }, [configureExplorer, explorerScenario, loadScenario, productMode, setPlaying]);

  useLayoutEffect(() => {
    if (productMode !== "playground") return;

    // Repair any restored or legacy shared-store state before Playground renders.
    // Playground never accepts catalog-backed Explorer objects implicitly.
    if (!isCleanPlaygroundScenario()) resetPlaygroundStoreNow();
    configurePlayground();
    setPlaygroundSceneSession((session) => session + 1);
  }, [configurePlayground, productMode]);

  const selectExplorerSnapshot = useCallback((snapshot: ExplorerSnapshot) => {
    // Re-selecting the active milestone must still reset playback to its canonical UTC.
    // A fresh value prevents React from discarding that explicit timeline transition.
    setActiveSnapshot({ ...snapshot });
  }, []);

  // Shared by the in-app buttons and by history navigation, so a mode reached
  // through Back is set up exactly like one reached by clicking.
  const applyProductMode = useCallback((mode: ProductMode) => {
    if (mode === "playground") resetPlaygroundStoreNow();
    setProductMode(mode);
    setInterfaceVisible(true);
    setPlaygroundMobileSurface(null);
  }, []);

  const goToProductMode = useCallback(
    (mode: ProductMode) => {
      recordAppQuery(mode);
      applyProductMode(mode);
    },
    [applyProductMode],
  );

  useEffect(() => {
    const handlePopState = () => applyProductMode(readInitialProductMode());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyProductMode]);

  const openExplorer = useCallback(() => goToProductMode("explorer"), [goToProductMode]);
  const openStudio = useCallback(() => goToProductMode("playground"), [goToProductMode]);
  const openHome = useCallback(() => goToProductMode("home"), [goToProductMode]);
  /**
   * Tracker has its own entry point rather than a product mode, so reaching it
   * is a navigation. The homepage already did this inline; the app menu needs
   * the same route.
   */
  const openTracker = useCallback(
    () => window.location.assign(`${window.location.pathname}?app=tracker`),
    [],
  );

  const closePlaygroundMobileSurface = useCallback(() => {
    setPlaygroundMobileSurface(null);
  }, []);

  const showAuroraToast = useCallback((message: string) => {
    setAuroraToast(message);

    if (auroraToastTimeoutRef.current !== null) {
      window.clearTimeout(auroraToastTimeoutRef.current);
    }

    auroraToastTimeoutRef.current = window.setTimeout(() => {
      setAuroraToast(null);
      auroraToastTimeoutRef.current = null;
    }, 2400);
  }, []);

  const toggleAuroraMode = useCallback(() => {
    const nextEnabled = !auroraModeEnabledRef.current;

    auroraModeEnabledRef.current = nextEnabled;
    setAuroraModeEnabled(nextEnabled);
    showAuroraToast(nextEnabled ? "Aurora Mode Enabled" : "Aurora Mode Disabled");
  }, [showAuroraToast]);

  useEffect(() => {
    auroraModeEnabledRef.current = auroraModeEnabled;
  }, [auroraModeEnabled]);

  useEffect(
    () => () => {
      if (auroraToastTimeoutRef.current !== null) {
        window.clearTimeout(auroraToastTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const coarseMobilePointer = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

    if (coarseMobilePointer) return undefined;

    let sequenceIndex = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableKeyTarget(event.target)) return;

      const token = keyTokenForKonami(event);

      if (token === null) {
        sequenceIndex = 0;
        return;
      }

      if (token === KONAMI_SEQUENCE[sequenceIndex]) {
        sequenceIndex += 1;

        if (sequenceIndex === KONAMI_SEQUENCE.length) {
          sequenceIndex = 0;
          toggleAuroraMode();
        }

        return;
      }

      sequenceIndex = token === KONAMI_SEQUENCE[0] ? 1 : 0;
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleAuroraMode]);

  useEffect(() => {
    if (interfaceVisible || productMode === "home") return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInterfaceVisible(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [interfaceVisible, productMode]);

  useEffect(() => {
    if (productMode !== "playground") return undefined;

    const handlePageShow = () => {
      // Safari can restore an earlier JavaScript heap through its page cache.
      // Reassert the environment boundary instead of reviving Explorer state.
      if (!isCleanPlaygroundScenario()) {
        resetPlaygroundStoreNow();
        setPlaygroundSceneSession((session) => session + 1);
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [productMode]);

  const auroraToastElement = <AuroraToast message={auroraToast} />;

  if (productMode === "home") {
    return (
      <OrbitStudioHome
        onOpenExplorer={openExplorer}
        onOpenPlayground={openStudio}
        // A real navigation: Tracker is a separate bundle entry, so it cannot be
        // reached by changing state inside this one.
        onOpenTracker={openTracker}
        supportUrl={import.meta.env.VITE_SUPPORT_URL}
      />
    );
  }

  if (productMode === "explorer") {
    return (
      <>
        <ExplorerView
          activeSnapshot={activeSnapshot}
          auroraModeEnabled={auroraModeEnabled}
          interfaceVisible={interfaceVisible}
          onHideInterface={() => setInterfaceVisible(false)}
          onShowInterface={() => setInterfaceVisible(true)}
          onSelectSnapshot={selectExplorerSnapshot}
          onOpenHome={openHome}
          onOpenExplorer={openExplorer}
          onOpenPlayground={openStudio}
        />
        {auroraToastElement}
      </>
    );
  }

  return (
    <>
      <main
      className={`app-shell studio-mode-shell playground-shell ${
        interfaceVisible ? "" : "playground-ui-hidden"
      } playground-mobile-surface-${playgroundMobileSurface ?? "none"}`}
    >
      <AppErrorBoundary
        variant="renderer"
        fallbackTitle="Playground renderer failed to start"
        fallbackMessage="Playground controls remain available, but the shared Earth renderer failed to initialize."
      >
        <SimulationScene
          key={`playground-scene-${playgroundSceneSession}`}
          playgroundPresentation
          autoFrameSelections
          auroraModeEnabled={auroraModeEnabled}
        />
      </AppErrorBoundary>
      {interfaceVisible ? (
        <>
          <div className="playground-topline">
            <button
              aria-label="Open Orbit Studio home"
              className="playground-title playground-brand-button"
              type="button"
              onClick={openHome}
            >
              <img
                alt="Orbit Studio Playground"
                className="playground-brand-logo playground-brand-logo-full"
                src="/brand/orbit-studio-playground-logo.png"
              />
              <img
                alt=""
                aria-hidden="true"
                className="playground-brand-logo playground-brand-logo-icon"
                src="/brand/orbit-studio-playground-icon.png"
              />
            </button>
            <OrbitAppMenu
              activeApp="playground"
              onHideInterface={() => setInterfaceVisible(false)}
              onOpenExplorer={openExplorer}
              onOpenHome={openHome}
              onOpenPlayground={openStudio}
              onOpenTracker={openTracker}
            />
          </div>
          <button
            aria-expanded={playgroundMobileSurface === "orbit"}
            aria-label={
              playgroundMobileSurface === "orbit"
                ? "Close Playground orbit controls"
                : "Open Playground orbit controls"
            }
            className={`playground-mobile-orbit-trigger ${
              playgroundMobileSurface === "orbit" ? "active" : ""
            }`}
            type="button"
            onClick={() =>
              setPlaygroundMobileSurface((surface) =>
                surface === "orbit" ? null : "orbit",
              )
            }
          >
            <Orbit size={20} />
          </button>
          <div className="playground-playback-dock" aria-label="Playground playback controls">
            <button
              aria-label={isPlaying ? "Pause Playground playback" : "Start Playground playback"}
              aria-pressed={isPlaying}
              className={`playground-playback-dock-toggle ${isPlaying ? "running" : ""}`}
              type="button"
              onClick={() => setPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <PlaybackSpeedSlider
              className="playground-playback-dock-slider"
              value={playgroundTimeScale}
              onChange={setTimeScale}
              label="Playground playback speed"
            />
          </div>
          <OrbitControlsPanel
            onOpenExplorer={openExplorer}
            onMobileClose={closePlaygroundMobileSurface}
          />
        </>
      ) : (
        <ShowInterfaceButton onShow={() => setInterfaceVisible(true)} />
      )}
      </main>
      {auroraToastElement}
    </>
  );
}
