import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Compass, Eye, EyeOff, List, Menu, Pause, Play, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ExplorerView } from "./components/explorer/ExplorerView";
import { OrbitControlsPanel } from "./components/OrbitControlsPanel";
import { PlaygroundSatelliteColumn } from "./components/PlaygroundSatelliteColumn";
import {
  createExplorerCurrentSnapshot,
  createExplorerScenario,
  currentExplorerSnapshot,
  explorerSnapshotForDateIso,
  type ExplorerSnapshot,
} from "./data/explorerCatalog";
import { createPlaygroundScenario } from "./lib/scenario";
import { SimulationScene } from "./rendering/SimulationScene";
import { useSimulationStore } from "./state/useSimulationStore";
import { readStudioPlaybackTimeIso } from "./state/studioPlaybackClock";
import { isOrbitStudioReviewMode } from "./review/reviewBridge";

type ProductMode = "explorer" | "playground";
type PlaygroundMobileSurface = "objects" | "orbit" | "playback" | null;
const playgroundMobileTimeScales = [1, 10, 100, 1000, 2500];
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
  if (isOrbitStudioReviewMode()) return currentExplorerSnapshot;

  if (import.meta.env.DEV && typeof window !== "undefined") {
    const diagnosticTime = new URLSearchParams(window.location.search).get("simulationTime");
    if (diagnosticTime) return explorerSnapshotForDateIso(diagnosticTime);
  }

  return createExplorerCurrentSnapshot(
    useSimulationStore.getState().scenario.simulationTimeUtc,
  );
}

function developmentCelestialPlaybackPaused(): boolean {
  return isOrbitStudioReviewMode() || (
    import.meta.env.DEV &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("celestialPaused") === "1"
  );
}

export function App() {
  const [productMode, setProductMode] = useState<ProductMode>("explorer");
  const [activeSnapshot, setActiveSnapshot] = useState<ExplorerSnapshot>(
    initialExplorerSnapshot,
  );
  const explorerScenario = useMemo(
    () => createExplorerScenario(activeSnapshot),
    [activeSnapshot],
  );
  const [playgroundUiVisible, setPlaygroundUiVisible] = useState(true);
  const [playgroundMobileSurface, setPlaygroundMobileSurface] =
    useState<PlaygroundMobileSurface>(null);
  const [playgroundMobileMenuOpen, setPlaygroundMobileMenuOpen] = useState(false);
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
  }, [configureExplorer, explorerScenario, loadScenario, setPlaying]);

  const selectExplorerSnapshot = useCallback((snapshot: ExplorerSnapshot) => {
    // Re-selecting the active milestone must still reset playback to its canonical UTC.
    // A fresh value prevents React from discarding that explicit timeline transition.
    setActiveSnapshot({ ...snapshot });
  }, []);

  const openExplorer = useCallback(() => {
    loadScenario(explorerScenario);
    setProductMode("explorer");
    setPlaygroundUiVisible(true);
    setPlaygroundMobileSurface(null);
    setPlaygroundMobileMenuOpen(false);
    configureExplorer(1);
  }, [configureExplorer, explorerScenario, loadScenario]);

  const openStudio = useCallback(() => {
    loadScenario(createPlaygroundScenario(new Date(readStudioPlaybackTimeIso())));
    setProductMode("playground");
    setPlaygroundUiVisible(true);
    setPlaygroundMobileSurface(null);
    setPlaygroundMobileMenuOpen(false);
    configurePlayground();
  }, [configurePlayground, loadScenario]);

  const openPlaygroundMobileSurface = useCallback((surface: Exclude<PlaygroundMobileSurface, null>) => {
    setPlaygroundMobileSurface(surface);
    setPlaygroundMobileMenuOpen(false);
  }, []);

  const closePlaygroundMobileSurface = useCallback(() => {
    setPlaygroundMobileSurface(null);
    setPlaygroundMobileMenuOpen(false);
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

  const auroraToastElement = <AuroraToast message={auroraToast} />;

  if (productMode === "explorer") {
    return (
      <>
        <ExplorerView
          activeSnapshot={activeSnapshot}
          auroraModeEnabled={auroraModeEnabled}
          onSelectSnapshot={selectExplorerSnapshot}
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
        playgroundUiVisible ? "" : "playground-ui-hidden"
      } playground-mobile-surface-${playgroundMobileSurface ?? "none"} ${
        playgroundMobileMenuOpen ? "playground-mobile-menu-open" : ""
      }`}
    >
      <AppErrorBoundary
        variant="renderer"
        fallbackTitle="Playground renderer failed to start"
        fallbackMessage="Playground controls remain available, but the shared Earth renderer failed to initialize."
      >
        <SimulationScene
          playgroundPresentation
          autoFrameSelections
          auroraModeEnabled={auroraModeEnabled}
        />
      </AppErrorBoundary>
      {playgroundUiVisible ? (
        <>
          <div className="playground-topline">
            <div className="playground-title">
              <span>OS</span>
              <div>
                <strong>Orbit Studio</strong>
                <small>Playground</small>
              </div>
            </div>
            <div className="playground-global-actions">
              <button type="button" title="Open Explorer" onClick={openExplorer}>
                <Compass size={15} />
                <span>Explorer</span>
              </button>
              <button type="button" onClick={() => setPlaygroundUiVisible(false)}>
                <EyeOff size={15} />
                <span>Hide UI</span>
              </button>
            </div>
          </div>
          <div className="playground-mobile-mode-menu">
            <button
              aria-expanded={playgroundMobileMenuOpen}
              aria-label="Open Playground menu"
              className={playgroundMobileMenuOpen ? "active" : ""}
              type="button"
              onClick={() => {
                setPlaygroundMobileMenuOpen((current) => !current);
                setPlaygroundMobileSurface(null);
              }}
            >
              <Menu size={16} />
            </button>
            {playgroundMobileMenuOpen && playgroundMobileSurface === null && (
              <div className="playground-mobile-mode-menu-panel" aria-label="Playground modes">
                <button type="button" onClick={() => openPlaygroundMobileSurface("objects")}>
                  <List size={15} />
                  <span>Objects</span>
                </button>
                <button type="button" onClick={() => openPlaygroundMobileSurface("orbit")}>
                  <SlidersHorizontal size={15} />
                  <span>Orbit</span>
                </button>
                <button type="button" onClick={() => openPlaygroundMobileSurface("playback")}>
                  {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                  <span>Playback</span>
                </button>
              </div>
            )}
          </div>
          {playgroundMobileSurface === null && !playgroundMobileMenuOpen && (
            <div className="playground-mobile-playback-pill" aria-label="Compact Playground playback">
              <button
                aria-label={isPlaying ? "Pause Playground playback" : "Start Playground playback"}
                className={isPlaying ? "running" : ""}
                type="button"
                onClick={() => setPlaying(!isPlaying)}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                aria-label="Open Playground playback controls"
                type="button"
                onClick={() => openPlaygroundMobileSurface("playback")}
              >
                {playgroundTimeScale.toLocaleString()}x
              </button>
            </div>
          )}
          {playgroundMobileSurface === "playback" && (
            <aside className="playground-mobile-playback-sheet" aria-label="Playground playback controls">
              <div className="playground-mobile-sheet-heading">
                <strong>Playback</strong>
                <button type="button" aria-label="Close playback controls" onClick={closePlaygroundMobileSurface}>
                  <X size={14} />
                </button>
              </div>
              <div className="playground-mobile-playback-actions">
                <button
                  className={`playback-toggle ${isPlaying ? "running" : ""}`}
                  type="button"
                  onClick={() => setPlaying(!isPlaying)}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                  <span>{isPlaying ? "Pause" : "Play"}</span>
                </button>
                <button
                  className={playgroundIsReverse ? "active" : ""}
                  type="button"
                  onClick={() => setReverse(!playgroundIsReverse)}
                >
                  <RotateCcw size={15} />
                  <span>Reverse</span>
                </button>
              </div>
              <div className="playground-mobile-speed-options" aria-label="Playback speed">
                {playgroundMobileTimeScales.map((scale) => (
                  <button
                    className={playgroundTimeScale === scale ? "active" : ""}
                    key={scale}
                    type="button"
                    onClick={() => setTimeScale(scale)}
                  >
                    {scale.toLocaleString()}x
                  </button>
                ))}
              </div>
            </aside>
          )}
          <OrbitControlsPanel
            onOpenExplorer={openExplorer}
            onMobileClose={closePlaygroundMobileSurface}
          />
        </>
      ) : (
        <button
          className="playground-show-ui"
          type="button"
          onClick={() => setPlaygroundUiVisible(true)}
        >
          <Eye size={15} />
          <span>Show UI</span>
        </button>
      )}
      </main>
      {auroraToastElement}
    </>
  );
}
