import React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Box,
  ChevronRight,
  Clock,
  CircleDot,
  Crosshair,
  Eye,
  ExternalLink,
  Filter,
  ImageOff,
  Menu,
  Palette,
  Pause,
  Play,
  RadioTower,
  Rocket,
  Satellite,
  Search,
  Settings,
  SkipBack,
  Sparkles,
  StepBack,
  StepForward,
  X,
} from "lucide-react";
import {
  explorerCategoryHierarchy,
  explorerCategoryLabel,
  currentExplorerSnapshot,
  explorerEntryForId,
  explorerCurrentCatalogMode,
  explorerLatestPublicCatalogDate,
  filterExplorerCatalogSnapshot,
  prioritizeExplorerSearchResults,
  explorerSnapshotForYear,
  explorerSnapshotView,
  explorerTimelineSnapshots,
  explorerVisibleTimelinePosition,
  type ExplorerCatalogDataCoverage,
  type ExplorerCatalogEntry,
  type ExplorerCategoryId,
  type ExplorerSnapshot,
} from "../../data/explorerCatalog";
import { explorerHistoricalCatalog } from "../../data/explorerHistoricalCatalog";
import {
  explorerDiscoveryCollections,
  explorerEntriesForDiscoveryCollection,
  type ExplorerDiscoveryCollectionId,
} from "../../data/explorerDiscovery";
import {
  explorerEntryMatchesFilters,
  explorerFilterChangeShouldReframe,
  explorerFilterConflict,
  explorerRegimeForEntry,
  type ExplorerRegimeFilter,
} from "../../data/explorerFilters";
import {
  createExplorerVisibilityState,
  explorerVisibilityLayer,
  isExplorerEntryVisible,
  resolveExplorerVisibility,
  summarizeExplorerConstellation,
  type ExplorerVisibilityState,
} from "../../data/explorerVisibility";
import {
  explorerEducationForEntry,
  type ExplorerHeroMedia,
  type ExplorerKeyFact,
  type ExplorerOfficialSource,
} from "../../data/explorerEducation";
import { formatNumber } from "../../lib/format";
import { getSatelliteReadouts } from "../../lib/propagation";
import { SimulationScene } from "../../rendering/SimulationScene";
import { createSelectedOrbitFrame } from "../../rendering/selectedOrbitFrame";
import { useSimulationStore } from "../../state/useSimulationStore";
import { readStudioPlaybackTimeIso } from "../../state/studioPlaybackClock";
import {
  ORBIT_STUDIO_REVIEW_SCHEMA_VERSION,
  explorerHistoricalWarningState,
  isOrbitStudioReviewMode,
  mergeExplorerRendererState,
  type ExplorerReviewState,
} from "../../review/reviewBridge";
import { readExplorerRendererStats } from "../../rendering/explorerRendererDiagnostics";
import { AppErrorBoundary } from "../AppErrorBoundary";
import { OrbitAppMenu, ShowInterfaceButton } from "../layout/OrbitAppMenu";
import {
  explorerMarkerStyle,
  type ExplorerColorMode,
  type ExplorerFocusPreset,
} from "../../data/explorerVisuals";
import { useMobileSheetDrag } from "../../lib/useMobileSheetDrag";
import { PlaybackSpeedSlider } from "../PlaybackSpeedSlider";

interface ExplorerViewProps {
  activeSnapshot: ExplorerSnapshot;
  auroraModeEnabled?: boolean;
  interfaceVisible: boolean;
  onHideInterface: () => void;
  onShowInterface: () => void;
  onSelectSnapshot: (snapshot: ExplorerSnapshot) => void;
  onOpenHome: () => void;
  onOpenExplorer: () => void;
  onOpenPlayground: () => void;
}

const CATALOG_ROW_HEIGHT = 68;
const CATALOG_OVERSCAN_ROWS = 5;
const EXPLORER_SEARCH_LISTBOX_ID = "explorer-search-results";
const explorerFramePresets: Array<{ id: ExplorerRegimeFilter; label: string; focusPreset: ExplorerFocusPreset }> = [
  { id: "all", label: "All", focusPreset: "earth-orbit" },
  { id: "leo", label: "LEO", focusPreset: "leo" },
  { id: "meo", label: "MEO", focusPreset: "meo" },
  { id: "geo", label: "GEO", focusPreset: "geo" },
  { id: "heo", label: "HEO", focusPreset: "earth-orbit" },
];
const explorerObjectTypeFilters = [
  { id: "", label: "All Objects", shortLabel: "All" },
  { id: "payloads", label: "Spacecraft", shortLabel: "Spacecraft" },
  { id: "components", label: "Components", shortLabel: "Components" },
  { id: "debris", label: "Debris", shortLabel: "Debris" },
  { id: "ground-stations", label: "Ground Stations", shortLabel: "Stations" },
  { id: "rocket-bodies", label: "Launch Vehicles", shortLabel: "Launch" },
] as const satisfies ReadonlyArray<{
  id: ExplorerCategoryId | "";
  label: string;
  shortLabel: string;
}>;
const explorerColorModes: Array<{ id: ExplorerColorMode; label: string; tooltip: string }> = [
  {
    id: "type",
    label: "By Type",
    tooltip: "Colors satellites by object classification.",
  },
  {
    id: "constellation",
    label: "By Constellation",
    tooltip: "Colors satellites by constellation or operator.",
  },
  {
    id: "white",
    label: "Neutral",
    tooltip: "Displays all satellites using a neutral color.",
  },
];
const defaultExplorerSpeed = 1;
const followExplorerSpeed = 100;

function initialExplorerPlaybackRunning(): boolean {
  return !(isOrbitStudioReviewMode() || (
    import.meta.env.DEV &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("celestialPaused") === "1"
  ));
}


function isExplorerSceneEntry(entry: ExplorerCatalogEntry): boolean {
  return (
    entry.selectionKind === "satellite" ||
    entry.selectionKind === "ground-station" ||
    entry.selectionKind === "constellation"
  );
}

function isExplorerCatalogResult(entry: ExplorerCatalogEntry): boolean {
  return isExplorerRenderableEntry(entry) || entry.visualRole === "catalog-reference";
}

function explorerAvailabilityNote(
  entry: ExplorerCatalogEntry,
  activeSnapshot: ExplorerSnapshot,
  satelliteAvailable: boolean,
  entryInSnapshot: boolean,
): string | null {
  const selectedDateLabel = new Date(activeSnapshot.timestampIso).toISOString().slice(0, 10);
  const launchDate = entry.launchDate ?? (
    /^\d{4}$/.test(entry.launched) ? `${entry.launched}-01-01` : undefined
  );
  const launchMs = launchDate ? Date.parse(launchDate) : Number.NaN;
  const selectedMs = Date.parse(activeSnapshot.timestampIso);

  if (Number.isFinite(launchMs) && Number.isFinite(selectedMs) && launchMs > selectedMs) {
    return `This record is outside the selected timeline date. It had not launched by ${selectedDateLabel}; launch date: ${launchDate?.slice(0, 10) ?? "not loaded"}.`;
  }

  if (entry.selectionKind === "catalog-object") {
    if (entry.categoryId === "missions" || /deep-space|l2|lagrange|voyager|webb|jwst/i.test(`${entry.objectType} ${entry.summary} ${entry.name}`)) {
      return "This mission/reference record is outside Earth orbit, so Explorer opens details without rendering it around Earth.";
    }

    return "This reference record lacks renderable Earth-orbit data, so Explorer opens details without adding a scene object.";
  }

  if (entry.selectionKind === "satellite" && !satelliteAvailable) {
    if (!entryInSnapshot) {
      return `This object is not part of the loaded catalog snapshot for ${selectedDateLabel}.`;
    }

    return `This object exists in the loaded catalog for ${selectedDateLabel}, but no source-backed position is available for that date.`;
  }

  if (!entryInSnapshot) {
    return `This catalog record is not part of the loaded catalog snapshot for ${selectedDateLabel}.`;
  }

  return null;
}

function explorerSceneLayerCount(
  records: ExplorerCatalogEntry[],
  layerId: ExplorerCategoryId,
): number {
  if (layerId === "constellations") {
    return records.filter(
      (entry) => entry.selectionKind === "constellation" || Boolean(entry.constellationId),
    ).length;
  }

  return records.filter(
    (entry) => isExplorerRenderableEntry(entry) && explorerVisibilityLayer(entry) === layerId,
  ).length;
}

function explorerSceneLayerLabel(layerId: ExplorerCategoryId): string {
  if (layerId === "payloads") return "Satellites";
  if (layerId === "constellations") return "Constellation systems";
  return explorerCategoryLabel(layerId);
}

function explorerResultKindLabel(entry: ExplorerCatalogEntry): string {
  if (entry.selectionKind === "constellation") return "Orbital system";
  if (entry.selectionKind === "ground-station") return "Ground station";
  if (entry.categoryId === "missions") return "Mission";
  if (entry.categoryId === "concepts") return "Reference";
  if (entry.selectionKind === "satellite") return "Satellite";
  return explorerCategoryLabel(entry.categoryId);
}

function explorerOrbitVisualizationSummary(
  coverage: ExplorerCatalogDataCoverage,
  renderableOrbitStateCount: number,
): string {
  if (coverage.status === "historical-loaded") {
    const sourceBackedOrbitStateCount = coverage.exactHistoricalOrbitStateCount ?? 0;
    const reconstructedOrbitStateCount =
      coverage.reconstructedHistoricalOrbitStateCount ?? 0;
    const parts: string[] = [];

    if (sourceBackedOrbitStateCount > 0) {
      parts.push(`${sourceBackedOrbitStateCount.toLocaleString()} source-backed historical orbit ${
        sourceBackedOrbitStateCount === 1 ? "state" : "states"
      }`);
    }

    if (reconstructedOrbitStateCount > 0) {
      parts.push(`${reconstructedOrbitStateCount.toLocaleString()} reconstructed`);
    }

    if ((coverage.catalogOnlyObjectCount ?? 0) > 0) {
      parts.push(`${coverage.catalogOnlyObjectCount!.toLocaleString()} position unavailable`);
    }

    return parts.length > 0 ? parts.join(" · ") : "0 orbit visualizations";
  }

  if (coverage.status === "current-loaded") {
    return `${renderableOrbitStateCount.toLocaleString()} current source-backed ${
      renderableOrbitStateCount === 1 ? "orbit" : "orbits"
    }`;
  }

  if (coverage.status === "latest-public-catalog") {
    return `${renderableOrbitStateCount.toLocaleString()} reconstructed educational ${
      renderableOrbitStateCount === 1 ? "position" : "positions"
    }`;
  }

  return `${renderableOrbitStateCount.toLocaleString()} orbit ${
    renderableOrbitStateCount === 1 ? "visualization" : "visualizations"
  }`;
}

function regimeEmphasis(
  entry: ExplorerCatalogEntry,
  focusPreset: ExplorerFocusPreset | undefined,
): number {
  if (!entry.orbit || !focusPreset || focusPreset === "earth-orbit") return 1;

  const altitudeKm = entry.orbit.altitudeKm;
  const matches =
    focusPreset === "leo"
      ? altitudeKm <= 2_000
      : focusPreset === "meo"
        ? altitudeKm > 2_000 && altitudeKm < 30_000
        : focusPreset === "geo"
          ? Math.abs(altitudeKm - 35_786) < 3_000 && entry.orbit.eccentricity < 0.18
          : true;

  return matches ? 1 : 0.08;
}

function ExplorerObjectTypeIcon({
  id,
  size = 16,
}: {
  id: ExplorerCategoryId | "";
  size?: number;
}) {
  if (id === "payloads") return <Satellite size={size} />;
  if (id === "components") return <Box size={size} />;
  if (id === "debris") return <Sparkles size={size} />;
  if (id === "ground-stations") return <RadioTower size={size} />;
  if (id === "rocket-bodies") return <Rocket size={size} />;
  return <Box size={size} />;
}
function ExplorerPanelCloseButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="explorer-panel-close"
      title={label}
      type="button"
      onClick={onClick}
    >
      <X size={15} />
    </button>
  );
}

function ExplorerTimeChip({ activeSnapshot }: { activeSnapshot: ExplorerSnapshot }) {
  const [simulationTimeIso, setSimulationTimeIso] = useState(activeSnapshot.timestampIso);

  useEffect(() => {
    const update = () => setSimulationTimeIso(readStudioPlaybackTimeIso());
    update();
    const intervalId = window.setInterval(update, 1_000);
    return () => window.clearInterval(intervalId);
  }, [activeSnapshot.id]);

  const simulationDate = new Date(simulationTimeIso);
  const simulationUtcLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(simulationDate);
  return (
    <div className="explorer-time-chip" aria-label={`Simulation UTC: ${simulationUtcLabel}`}>
      <Clock size={15} />
      <span>{simulationUtcLabel} UTC</span>
    </div>
  );
}

function ExplorerPanelHeader({
  title,
  eyebrow,
  supporting,
  closeLabel,
  onClose,
  titleLevel = "h2",
  className = "",
  dragHandleProps,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  supporting?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  titleLevel?: "h1" | "h2";
  className?: string;
  dragHandleProps?: ReturnType<typeof useMobileSheetDrag>["dragHandleProps"];
}) {
  return (
    <header className={`explorer-panel-header ${className}`.trim()}>
      {dragHandleProps && (
        <button
          aria-label={closeLabel}
          className="explorer-mobile-sheet-handle"
          title={`${closeLabel}. Drag down or tap to close.`}
          type="button"
          {...dragHandleProps}
          onClick={onClose}
        >
          <span aria-hidden="true" />
        </button>
      )}
      <div className="explorer-panel-heading-copy">
        {eyebrow && <span className="explorer-panel-eyebrow">{eyebrow}</span>}
        {titleLevel === "h1" ? <h1>{title}</h1> : <h2>{title}</h2>}
        {supporting && <div className="explorer-panel-supporting">{supporting}</div>}
      </div>
      <ExplorerPanelCloseButton label={closeLabel} onClick={onClose} />
    </header>
  );
}

function useExplorerPanelController(setOpen: Dispatch<SetStateAction<boolean>>) {
  const invokerRef = useRef<HTMLElement | null>(null);

  const openFrom = useCallback((invoker: HTMLElement | null) => {
    invokerRef.current = invoker;
    setOpen(true);
  }, [setOpen]);

  const toggleFrom = useCallback((invoker: HTMLElement) => {
    setOpen((open) => {
      if (!open) invokerRef.current = invoker;
      return !open;
    });
  }, [setOpen]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (!restoreFocus) return;

    window.requestAnimationFrame(() => {
      if (invokerRef.current?.isConnected) invokerRef.current.focus();
    });
  }, [setOpen]);

  return useMemo(
    () => ({ close, invokerRef, openFrom, toggleFrom }),
    [close, openFrom, toggleFrom],
  );
}

function isExplorerRenderableEntry(entry: ExplorerCatalogEntry): boolean {
  return (
    (entry.selectionKind === "satellite" &&
      entry.visualRole === "selectable-orbital-object") ||
    entry.selectionKind === "ground-station"
  );
}

function VirtualizedCatalogList({
  entries,
  selectedObjectId,
  isSceneVisible,
  onSelect,
}: {
  entries: ExplorerCatalogEntry[];
  selectedObjectId: string | null;
  isSceneVisible: (entry: ExplorerCatalogEntry) => boolean;
  onSelect: (entry: ExplorerCatalogEntry, invoker: HTMLElement) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => setViewportHeight(container.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [entries]);

  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / CATALOG_ROW_HEIGHT) - CATALOG_OVERSCAN_ROWS,
  );
  const endIndex = Math.min(
    entries.length,
    Math.ceil((scrollTop + viewportHeight) / CATALOG_ROW_HEIGHT) + CATALOG_OVERSCAN_ROWS,
  );
  const visibleEntries = entries.slice(startIndex, endIndex);

  if (entries.length === 0) {
    return (
      <div className="explorer-catalog-empty">
        <Search size={17} />
        <strong>No objects match this view</strong>
        <span>Try another type, clear a refinement, or choose a different year in space history.</span>
      </div>
    );
  }

  return (
    <div
      className="explorer-catalog-list"
      ref={containerRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="explorer-catalog-list-spacer"
        style={{ height: `${entries.length * CATALOG_ROW_HEIGHT}px` }}
      >
        {visibleEntries.map((entry, offset) => (
          <button
            className={[
              entry.id === selectedObjectId ? "selected" : "",
              !isSceneVisible(entry) ? "scene-hidden" : "",
            ].filter(Boolean).join(" ")}
            key={entry.id}
            style={{ top: `${(startIndex + offset) * CATALOG_ROW_HEIGHT}px` }}
            title={entry.name}
            type="button"
            onClick={(event) => onSelect(entry, event.currentTarget)}
          >
            <i
              className={entry.visualRole === "catalog-reference" ? "reference-record" : ""}
              style={{ background: entry.orbit?.color }}
            />
            <span>
              <strong>{entry.name}</strong>
              <small>
                {entry.catalogNumber ? `NORAD ${entry.catalogNumber} · ` : ""}
                {explorerResultKindLabel(entry)} · {entry.objectType}
                {!isSceneVisible(entry) ? " · Hidden from view" : ""}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ExplorerSelectedVisibility({
  entry,
  visibility,
  onChange,
}: {
  entry?: ExplorerCatalogEntry;
  visibility: ExplorerVisibilityState;
  onChange: (updater: (current: ExplorerVisibilityState) => ExplorerVisibilityState) => void;
}) {
  if (!entry || (entry.selectionKind !== "satellite" && entry.selectionKind !== "ground-station")) {
    return null;
  }

  return (
    <div className="explorer-selected-visibility">
      <span>Selected object</span>
      <strong title={entry.name}>{entry.name}</strong>
      <label>
        <input
          checked={visibility.objects[entry.id] !== false}
          type="checkbox"
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              objects: { ...current.objects, [entry.id]: event.target.checked },
            }))
          }
        />
        <span>Shown</span>
      </label>
      {entry.selectionKind === "satellite" && (
        <label>
          <input
            checked={visibility.selectedOrbitVisible}
            type="checkbox"
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                selectedOrbitVisible: event.target.checked,
              }))
            }
          />
          <span>Show orbit</span>
        </label>
      )}
    </div>
  );
}

const loadedExplorerMediaUrls = new Set<string>();

export function ExplorerHeroMediaFrame({
  hero,
  imageUrl,
  imageStatus,
  onLoad,
  onError,
}: {
  hero: ExplorerHeroMedia;
  imageUrl: string;
  imageStatus: "loading" | "loaded" | "failed";
  onLoad: () => void;
  onError: () => void;
}) {
  return (
    <figure
      aria-busy={imageStatus === "loading"}
      className={`explorer-hero-media has-image is-${imageStatus}`}
    >
      {imageStatus === "loading" && (
        <div className="explorer-hero-media-placeholder" aria-label="Loading image" role="status">
          <span />
        </div>
      )}
      {imageStatus === "failed" && (
        <div className="explorer-hero-media-fallback" role="status">
          <ImageOff aria-hidden="true" size={16} />
          <span>Image unavailable</span>
        </div>
      )}
      <img
        alt={hero.imageAlt}
        decoding="async"
        src={imageUrl}
        onError={onError}
        onLoad={onLoad}
      />
      {(hero.credit || hero.sourceUrl) && (
        <figcaption>
          {hero.sourceUrl ? (
            <a href={hero.sourceUrl} target="_blank" rel="noreferrer">
              {hero.credit ?? "Official image"}
              <ExternalLink size={10} />
            </a>
          ) : (
            hero.credit
          )}
        </figcaption>
      )}
    </figure>
  );
}

function ExplorerHeroMediaView({ hero }: { hero: ExplorerHeroMedia }) {
  const forceFailure = import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("failExplorerMedia");
  const imageUrl = forceFailure ? "/__orbit-studio-missing-media__.jpg" : hero.imageUrl;
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "failed">(() =>
    imageUrl && loadedExplorerMediaUrls.has(imageUrl) ? "loaded" : "loading",
  );

  useEffect(() => {
    setImageStatus(imageUrl && loadedExplorerMediaUrls.has(imageUrl) ? "loaded" : "loading");
  }, [imageUrl]);

  if (!imageUrl) return null;

  return (
    <ExplorerHeroMediaFrame
      hero={hero}
      imageStatus={imageStatus}
      imageUrl={imageUrl}
      onError={() => setImageStatus("failed")}
      onLoad={() => {
          loadedExplorerMediaUrls.add(imageUrl);
          setImageStatus("loaded");
      }}
    />
  );
}

function ExplorerKeyFactGrid({ facts }: { facts: ExplorerKeyFact[] }) {
  return (
    <div className="explorer-key-facts">
      {facts.slice(0, 4).map((fact) => (
        <span key={`${fact.label}-${fact.value}`}>
          <small>{fact.label}</small>
          <strong>{fact.value}</strong>
        </span>
      ))}
    </div>
  );
}

function ExplorerSourceLinks({ sources }: { sources: ExplorerOfficialSource[] }) {
  return (
    <div className="explorer-source-links">
      <span>Official sources</span>
      <div>
        {sources.slice(0, 3).map((source) => (
          <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
            {source.label}
            <ExternalLink size={10} />
          </a>
        ))}
      </div>
    </div>
  );
}

function ExplorerInspector({
  activeSnapshot,
  filterConflictMessage,
  onClearSelection,
  onResolveFilterConflict,
}: {
  activeSnapshot: ExplorerSnapshot;
  filterConflictMessage: string | null;
  onClearSelection: () => void;
  onResolveFilterConflict: () => void;
}) {
  const scenario = useSimulationStore((state) => state.scenario);
  const snapshotView = useMemo(() => explorerSnapshotView(activeSnapshot), [activeSnapshot]);
  const entry = scenario.selectedObjectId
    ? explorerEntryForId(scenario.selectedObjectId, activeSnapshot)
    : undefined;
  const satellite =
    scenario.selectedObjectType === "satellite"
      ? scenario.satellites.find((item) => item.id === scenario.selectedObjectId)
      : undefined;
  const constellation =
    scenario.selectedObjectType === "constellation"
      ? scenario.constellations.find((item) => item.id === scenario.selectedObjectId)
      : undefined;
  const constellationSummary = useMemo(
    () => constellation
      ? summarizeExplorerConstellation(constellation, scenario.satellites)
      : null,
    [constellation, scenario.satellites],
  );
  const readouts = useMemo(() => {
    if (!satellite) {
      return null;
    }
    try {
      return getSatelliteReadouts(satellite, new Date(scenario.simulationTimeUtc));
    } catch {
      return null;
    }
  }, [satellite, scenario.simulationTimeUtc]);
  const selectedOrbitFrame = useMemo(
    () => satellite ? createSelectedOrbitFrame(satellite) : null,
    [satellite],
  );
  const education = useMemo(
    () => entry ? explorerEducationForEntry(entry) : null,
    [entry],
  );
  const availabilityNote = useMemo(() => {
    if (!entry) return null;
    return explorerAvailabilityNote(
      entry,
      activeSnapshot,
      Boolean(satellite),
      snapshotView.byId.has(entry.id),
    );
  }, [activeSnapshot, entry, satellite, snapshotView.byId]);
  const keyFacts = useMemo<ExplorerKeyFact[]>(() => {
    if (!entry) return [];
    if (education?.keyFacts?.length) return education.keyFacts;

    if (constellationSummary) {
      return [
        { label: "Purpose", value: constellationSummary.purpose },
        { label: "Orbit", value: constellationSummary.orbitalClassification },
        { label: "Objects shown", value: constellationSummary.memberCount.toLocaleString() },
        { label: "Status", value: entry.status },
      ];
    }

    if (entry.groundStation) {
      return [
        {
          label: "Location",
          value: `${entry.groundStation.latitudeDeg.toFixed(1)}°, ${entry.groundStation.longitudeDeg.toFixed(1)}°`,
        },
        { label: "Purpose", value: entry.objectType },
        { label: "Network role", value: entry.operator },
        { label: "Status", value: entry.status },
      ];
    }

    if (satellite) {
      return [
        { label: "Object type", value: entry.objectType },
        { label: "Orbit", value: selectedOrbitFrame?.orbitClass ?? "Tracked orbit" },
        {
          label: "Altitude",
          value: readouts ? `${formatNumber(readouts.altitudeKm, 0)} km` : "Tracked orbit",
        },
        { label: "Status", value: entry.status },
      ];
    }

    return [
      { label: "Type", value: entry.objectType },
      { label: "Operator", value: entry.operator },
      { label: "Year", value: entry.launched },
      { label: "Status", value: entry.status },
    ];
  }, [constellationSummary, education?.keyFacts, entry, readouts, satellite, selectedOrbitFrame]);
  const [activeInspectorTab, setActiveInspectorTab] =
    useState<"overview" | "data">("overview");
  const overviewTabRef = useRef<HTMLButtonElement | null>(null);
  const dataTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setActiveInspectorTab("overview");
  }, [entry?.id]);

  const selectInspectorTab = useCallback((tab: "overview" | "data", focus = false) => {
    setActiveInspectorTab(tab);
    if (focus) {
      window.requestAnimationFrame(() => {
        (tab === "overview" ? overviewTabRef.current : dataTabRef.current)?.focus();
      });
    }
  }, []);

  const handleInspectorTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      let nextTab: "overview" | "data" | null = null;
      if (event.key === "ArrowLeft" || event.key === "Home") nextTab = "overview";
      if (event.key === "ArrowRight" || event.key === "End") nextTab = "data";
      if (!nextTab) return;
      event.preventDefault();
      selectInspectorTab(nextTab, true);
    },
    [selectInspectorTab],
  );

  if (!entry) return null;

  if (!education) return null;

  return (
    <aside
      aria-label="Object details"
      className="explorer-inspector explorer-selection-card"
      data-explorer-catalog-context
      tabIndex={-1}
    >
      <section className="explorer-object-title explorer-inspector-primer">
        <ExplorerPanelHeader
          className="explorer-inspector-heading"
          closeLabel="Close details"
          eyebrow={explorerResultKindLabel(entry)}
          supporting={(
            <strong>
              <CircleDot size={12} />
              {entry.status}
            </strong>
          )}
          title={entry.name}
          titleLevel="h1"
          onClose={onClearSelection}
        />
      </section>

      <div className="explorer-inspector-tabs" role="tablist" aria-label="Object information">
        <button
          aria-controls="explorer-inspector-overview"
          aria-selected={activeInspectorTab === "overview"}
          id="explorer-inspector-overview-tab"
          ref={overviewTabRef}
          role="tab"
          tabIndex={activeInspectorTab === "overview" ? 0 : -1}
          type="button"
          onClick={() => selectInspectorTab("overview")}
          onKeyDown={handleInspectorTabKeyDown}
        >
          Overview
        </button>
        <button
          aria-controls="explorer-inspector-data"
          aria-selected={activeInspectorTab === "data"}
          id="explorer-inspector-data-tab"
          ref={dataTabRef}
          role="tab"
          tabIndex={activeInspectorTab === "data" ? 0 : -1}
          type="button"
          onClick={() => selectInspectorTab("data")}
          onKeyDown={handleInspectorTabKeyDown}
        >
          Orbit &amp; data
        </button>
      </div>

      <div
        aria-labelledby={
          activeInspectorTab === "overview"
            ? "explorer-inspector-overview-tab"
            : "explorer-inspector-data-tab"
        }
        className="explorer-inspector-scroll"
        id={
          activeInspectorTab === "overview"
            ? "explorer-inspector-overview"
            : "explorer-inspector-data"
        }
        role="tabpanel"
      >
        {activeInspectorTab === "overview" ? (
          <div className="explorer-inspector-overview">
            <ExplorerHeroMediaView hero={education.hero} />
            <p className="explorer-inspector-intro">{education.intro}</p>
            {availabilityNote && <p className="explorer-availability-note">{availabilityNote}</p>}
            {filterConflictMessage && (
              <div className="explorer-filter-conflict" role="status">
                <span>{filterConflictMessage}</span>
                <button type="button" onClick={onResolveFilterConflict}>
                  Show in filters
                </button>
              </div>
            )}
            <ExplorerKeyFactGrid facts={keyFacts} />
            <section className="explorer-inspector-overview-why">
              <h3>Why it matters</h3>
              <p className="explorer-prose">{education.whyItMatters}</p>
            </section>
            {education.sections?.map((section) => (
              <details key={section.title}>
                <summary>{section.title}</summary>
                <p className="explorer-prose">{section.body}</p>
              </details>
            ))}
            <ExplorerSourceLinks sources={education.sources} />
          </div>
        ) : (
          <div className="explorer-inspector-data">
            {satellite && (
              <>
                <section className="explorer-inspector-data-section">
                  <h3>Current orbit</h3>
                  <dl>
                    <div><dt>Altitude</dt><dd>{readouts ? `${formatNumber(readouts.altitudeKm, 1)} km` : "--"}</dd></div>
                    <div><dt>Velocity</dt><dd>{readouts ? `${formatNumber(readouts.velocityKmS, 3)} km/s` : "--"}</dd></div>
                    <div><dt>Period</dt><dd>{readouts ? `${formatNumber(readouts.periodMinutes, 1)} min` : "--"}</dd></div>
                    <div><dt>Orbit class</dt><dd>{selectedOrbitFrame?.orbitClass ?? "--"}</dd></div>
                    <div><dt>Perigee</dt><dd>{selectedOrbitFrame ? `${formatNumber(selectedOrbitFrame.perigeeAltitudeKm, 1)} km` : "--"}</dd></div>
                    <div><dt>Apogee</dt><dd>{selectedOrbitFrame ? `${formatNumber(selectedOrbitFrame.apogeeAltitudeKm, 1)} km` : "--"}</dd></div>
                  </dl>
                </section>
                <section className="explorer-inspector-data-section">
                  <h3>Orbital elements</h3>
                  <dl>
                    <div><dt>Inclination</dt><dd>{formatNumber(satellite.keplerian.inclinationDeg, 2)}°</dd></div>
                    <div><dt>Eccentricity</dt><dd>{satellite.keplerian.eccentricity.toFixed(5)}</dd></div>
                    <div><dt>Semi-major axis</dt><dd>{formatNumber(satellite.keplerian.semiMajorAxisKm, 1)} km</dd></div>
                    <div><dt>RAAN</dt><dd>{formatNumber(satellite.keplerian.raanDeg, 1)}°</dd></div>
                  </dl>
                </section>
              </>
            )}
            {entry.groundStation && (
              <section className="explorer-inspector-data-section">
                <h3>Ground station role</h3>
                <dl>
                  <div>
                    <dt>Location</dt>
                    <dd>{entry.groundStation.latitudeDeg.toFixed(2)}°, {entry.groundStation.longitudeDeg.toFixed(2)}°</dd>
                  </div>
                  <div><dt>Altitude</dt><dd>{formatNumber(entry.groundStation.altitudeMeters, 0)} m</dd></div>
                  <div><dt>Minimum elevation</dt><dd>{formatNumber(entry.groundStation.minimumElevationDeg, 0)}°</dd></div>
                  <div><dt>Supports</dt><dd>{entry.id === "explorer-goldstone" ? "Deep-space missions" : "Tracking and communications"}</dd></div>
                  <div><dt>Network role</dt><dd>{entry.operator}</dd></div>
                </dl>
              </section>
            )}
            {constellationSummary && (
              <>
                <section className="explorer-inspector-data-section">
                  <h3>System architecture</h3>
                  <div className="explorer-architecture-explanation">
                    <strong>{constellationSummary.purpose}</strong>
                    <p>{constellationSummary.teachingSummary}</p>
                    <small>
                      Highlighted planes and shells describe the loaded system architecture controls,
                      not individual spacecraft trails.
                    </small>
                  </div>
                  <dl>
                    <div><dt>Objects shown</dt><dd>{constellationSummary.memberCount.toLocaleString()}</dd></div>
                    <div><dt>Orbital class</dt><dd>{constellationSummary.orbitalClassification}</dd></div>
                    <div><dt>Representative shells</dt><dd>{constellationSummary.shellCount}</dd></div>
                    <div><dt>Orbital planes</dt><dd>{constellationSummary.planeCount}</dd></div>
                    <div>
                      <dt>Altitude range</dt>
                      <dd>
                        {constellationSummary.altitudeRangeKm[0] === constellationSummary.altitudeRangeKm[1]
                          ? `${formatNumber(constellationSummary.altitudeRangeKm[0], 0)} km`
                          : `${formatNumber(constellationSummary.altitudeRangeKm[0], 0)}–${formatNumber(constellationSummary.altitudeRangeKm[1], 0)} km`}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section className="explorer-inspector-data-section">
                  <h3>Inclination families</h3>
                  <div className="explorer-architecture-families">
                    {constellationSummary.shells.map((shell) => (
                      <span key={shell.id} style={{ borderColor: `${shell.color}66`, color: shell.color }}>
                        <i style={{ background: shell.color, color: shell.color }} />
                        {formatNumber(shell.inclinationDeg, 1)}°
                      </span>
                    ))}
                  </div>
                  {constellationSummary.shells.length > 0 && (
                    <div className="explorer-architecture-shell-list">
                      {constellationSummary.shells.map((shell) => (
                        <div key={shell.id}>
                          <i style={{ background: shell.color, color: shell.color }} />
                          <span>
                            <strong>{shell.label}</strong>
                            <small>
                              {formatNumber(shell.altitudeKm, 0)} km · {formatNumber(shell.inclinationDeg, 1)}°
                            </small>
                            <small>
                              {shell.geometrySourceLabel} · {shell.displayedMatchCount.toLocaleString()} shown in Explorer
                            </small>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
            <section className="explorer-inspector-data-section">
              <h3>Catalog record</h3>
              <dl>
                <div><dt>Object type</dt><dd>{entry.objectType}</dd></div>
                <div><dt>Operator</dt><dd>{entry.operator}</dd></div>
                <div><dt>Region</dt><dd>{entry.country}</dd></div>
                <div><dt>Launch year</dt><dd>{entry.launched}</dd></div>
                {entry.catalogNumber && <div><dt>NORAD catalog</dt><dd>{entry.catalogNumber}</dd></div>}
                {entry.internationalDesignator && (
                  <div><dt>International designator</dt><dd>{entry.internationalDesignator}</dd></div>
                )}
                {entry.decayDate && <div><dt>Decay/reentry</dt><dd>{entry.decayDate.slice(0, 10)}</dd></div>}
                <div>
                  <dt>Source</dt>
                  <dd>{entry.sourceAttribution?.join(", ") ?? entry.sourceId}</dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}

function ExplorerTimeline({
  activeSnapshot,
  onSelectSnapshot,
  explorerPlaybackRunning,
  explorerPlaybackSpeed,
  onChangePlaybackSpeed,
  onTogglePlayback,
  visibleCatalogObjectCount,
  visibleRenderableOrbitStateCount,
}: {
  activeSnapshot: ExplorerSnapshot;
  onSelectSnapshot: (snapshot: ExplorerSnapshot) => void;
  explorerPlaybackRunning: boolean;
  explorerPlaybackSpeed: number;
  onChangePlaybackSpeed: (speed: number) => void;
  onTogglePlayback: () => void;
  visibleCatalogObjectCount: number;
  visibleRenderableOrbitStateCount: number;
}) {
  const controlRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const pendingTimelineSelectionRef = useRef<{ clientX: number; snap: boolean } | null>(null);
  const timelineAnimationFrameRef = useRef<number | null>(null);
  const firstTimelineYear = Number(explorerTimelineSnapshots[0].year);
  const lastTimelineYear = Number(explorerTimelineSnapshots[explorerTimelineSnapshots.length - 1].year);
  const activePosition = explorerVisibleTimelinePosition(activeSnapshot);
  const matchingSnapshotIndex = explorerTimelineSnapshots.findIndex(
    (snapshot) => snapshot.id === activeSnapshot.id,
  );
  const activeSnapshotIndex = matchingSnapshotIndex >= 0
    ? matchingSnapshotIndex
    : explorerTimelineSnapshots.length - 1;
  const activeSnapshotView = useMemo(() => explorerSnapshotView(activeSnapshot), [activeSnapshot]);
  const activeCoverage = activeSnapshotView.dataCoverage;
  const timelineSummary =
    `${visibleCatalogObjectCount.toLocaleString()} catalog objects · ${explorerOrbitVisualizationSummary(
      activeCoverage,
      visibleRenderableOrbitStateCount,
    )}`;
  const timelineMarkerCoverage = activeCoverage.status === "historical-loaded"
    ? [
        (activeCoverage.exactHistoricalOrbitStateCount ?? 0) > 0
          ? `${activeCoverage.exactHistoricalOrbitStateCount!.toLocaleString()} exact`
          : null,
        (activeCoverage.reconstructedHistoricalOrbitStateCount ?? 0) > 0
          ? `${activeCoverage.reconstructedHistoricalOrbitStateCount!.toLocaleString()} reconstructed`
          : null,
        (activeCoverage.catalogOnlyObjectCount ?? 0) > 0
          ? `${activeCoverage.catalogOnlyObjectCount!.toLocaleString()} unavailable`
          : null,
      ].filter(Boolean).join(" · ")
    : activeCoverage.status === "latest-public-catalog"
      ? `${visibleRenderableOrbitStateCount.toLocaleString()} reconstructed`
      : `${visibleRenderableOrbitStateCount.toLocaleString()} source-backed`;
  const historicalCatalogOnly = activeCoverage.status === "historical-loaded" &&
    activeCoverage.catalogObjectCount > 0 && activeCoverage.renderableOrbitStateCount === 0;
  const coverageMessage = historicalCatalogOnly
    ? `${activeCoverage.label}; positions unavailable`
    : activeCoverage.status === "historical-loaded"
        ? `${activeCoverage.label}; source and reconstructed states are identified separately`
        : activeCoverage.status === "historical-not-loaded"
          ? `No historical catalog loaded for ${activeSnapshot.year}`
          : activeCoverage.status === "latest-public-catalog"
            ? "Complete GCAT membership · reconstructed educational positions"
            : activeCoverage.label;
  const selectFromClientX = useCallback((clientX: number, snap: boolean) => {
    const bounds = controlRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    onSelectSnapshot(
      explorerSnapshotForYear(firstTimelineYear + ratio * (lastTimelineYear - firstTimelineYear), { snap }),
    );
  }, [firstTimelineYear, lastTimelineYear, onSelectSnapshot]);
  const scheduleTimelineSelection = useCallback((clientX: number, snap: boolean) => {
    pendingTimelineSelectionRef.current = { clientX, snap };

    if (timelineAnimationFrameRef.current !== null) return;

    timelineAnimationFrameRef.current = window.requestAnimationFrame(() => {
      timelineAnimationFrameRef.current = null;
      const pending = pendingTimelineSelectionRef.current;
      pendingTimelineSelectionRef.current = null;
      if (pending) selectFromClientX(pending.clientX, pending.snap);
    });
  }, [selectFromClientX]);

  useEffect(() => () => {
    if (timelineAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(timelineAnimationFrameRef.current);
    }
  }, []);

  const selectTimelineIndex = useCallback(
    (index: number) => {
      const boundedIndex = Math.max(0, Math.min(explorerTimelineSnapshots.length - 1, index));
      onSelectSnapshot(explorerTimelineSnapshots[boundedIndex]);
    },
    [onSelectSnapshot],
  );

  // Milestone bands tile the whole track, so they sit on top of the scrub line.
  // A press resolves to the milestone, but dragging out of one has to keep
  // scrubbing rather than dead-end on the dot the finger started from.
  const milestoneDragRef = useRef<{ startX: number; scrubbing: boolean } | null>(null);
  const MILESTONE_DRAG_SLOP_PX = 6;

  const handleMilestonePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    milestoneDragRef.current = { startX: event.clientX, scrubbing: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleMilestonePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = milestoneDragRef.current;
      if (!drag) return;
      if (!drag.scrubbing && Math.abs(event.clientX - drag.startX) < MILESTONE_DRAG_SLOP_PX) return;
      drag.scrubbing = true;
      scheduleTimelineSelection(event.clientX, false);
    },
    [scheduleTimelineSelection],
  );

  const handleMilestonePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const drag = milestoneDragRef.current;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!drag?.scrubbing) return;
      if (timelineAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineAnimationFrameRef.current);
        timelineAnimationFrameRef.current = null;
        pendingTimelineSelectionRef.current = null;
      }
      selectFromClientX(event.clientX, true);
    },
    [selectFromClientX],
  );

  return (
    <footer className="explorer-timeline">
      <div className="explorer-timeline-playback" aria-label="Explorer playback">
        <button
          aria-label="Jump to first historical snapshot"
          type="button"
          onClick={() => selectTimelineIndex(0)}
        >
          <SkipBack size={15} />
        </button>
        <button
          aria-label="Previous historical snapshot"
          type="button"
          onClick={() => selectTimelineIndex(activeSnapshotIndex - 1)}
        >
          <StepBack size={15} />
        </button>
        <button
          aria-label={explorerPlaybackRunning ? "Pause Explorer playback" : "Start Explorer playback"}
          aria-pressed={explorerPlaybackRunning}
          className={`explorer-timeline-play ${explorerPlaybackRunning ? "running" : ""}`}
          type="button"
          onClick={onTogglePlayback}
        >
          {explorerPlaybackRunning ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button
          aria-label="Next historical snapshot"
          type="button"
          onClick={() => selectTimelineIndex(activeSnapshotIndex + 1)}
        >
          <StepForward size={15} />
        </button>
      </div>
      <div className="explorer-timeline-label">
        <strong>{activeSnapshot.year}</strong>
        <small>{timelineSummary}</small>
        <small>{coverageMessage}</small>
      </div>
      <div
        aria-label="Historical catalog year"
        aria-valuemax={lastTimelineYear}
        aria-valuemin={firstTimelineYear}
        aria-valuenow={Number(activeSnapshot.year)}
        className="explorer-timeline-control"
        ref={controlRef}
        role="slider"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const nextYear = Math.min(
            lastTimelineYear,
            Math.max(firstTimelineYear, Number(activeSnapshot.year) + direction),
          );
          onSelectSnapshot(
            explorerSnapshotForYear(nextYear),
          );
        }}
        onPointerDown={(event) => {
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          selectFromClientX(event.clientX, false);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) {
            scheduleTimelineSelection(event.clientX, false);
          }
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          if (timelineAnimationFrameRef.current !== null) {
            window.cancelAnimationFrame(timelineAnimationFrameRef.current);
            timelineAnimationFrameRef.current = null;
            pendingTimelineSelectionRef.current = null;
          }
          selectFromClientX(event.clientX, true);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <div className="explorer-timeline-plot">
          <span className="explorer-timeline-baseline" aria-hidden="true" />
          <i
            className={`explorer-timeline-marker ${
              activePosition >= 0.995 ? "last" : ""
            }`}
            style={{ left: `${activePosition * 100}%` }}
          >
            <strong>
              <span>{activeSnapshot.year}</span>
              <small>{timelineMarkerCoverage}</small>
            </strong>
          </i>
        </div>
        <div className="explorer-milestones">
          {explorerTimelineSnapshots.map((snapshot, index) => {
            // Milestones are only a few years apart in places, so fixed-width hit
            // boxes overlapped and stole each other's taps. Each button instead
            // owns the strip running to the midpoint of each neighbour: the bands
            // tile the track without overlapping, every point resolves to its
            // nearest milestone, and the dot still marks the true year.
            const position = explorerVisibleTimelinePosition(snapshot);
            const previous = explorerTimelineSnapshots[index - 1];
            const next = explorerTimelineSnapshots[index + 1];
            const bandStart = previous
              ? (explorerVisibleTimelinePosition(previous) + position) / 2
              : 0;
            const bandEnd = next ? (position + explorerVisibleTimelinePosition(next)) / 2 : 1;
            const bandWidth = Math.max(bandEnd - bandStart, Number.EPSILON);
            // The end milestones sit on the track edge, so their band is half-width
            // by construction. Nothing competes beyond the track, so let them reach
            // a little further out rather than leave a 9px target.
            const outerReachPx = 12;
            const left = previous
              ? `${bandStart * 100}%`
              : `calc(${bandStart * 100}% - ${outerReachPx}px)`;
            const width = `calc(${bandWidth * 100}% + ${previous && next ? 0 : outerReachPx}px)`;

            return (
              <button
                aria-current={snapshot.id === activeSnapshot.id ? "date" : undefined}
                className={[
                  snapshot.id === activeSnapshot.id ? "active" : "",
                  index === 0 ? "first" : "",
                  index === explorerTimelineSnapshots.length - 1 ? "last" : "",
                ].filter(Boolean).join(" ")}
                key={snapshot.id}
                style={{
                  left,
                  width,
                  transform: "none",
                  // The dot's true position, expressed within its own band. Used by
                  // the stylesheet to place the dot and anchor the edge labels. The
                  // end bands reach `outerReachPx` past their milestone, so their
                  // dot is that far in from the extended edge.
                  "--milestone-dot": !previous
                    ? `${outerReachPx}px`
                    : !next
                      ? `calc(100% - ${outerReachPx}px)`
                      : `${((position - bandStart) / bandWidth) * 100}%`,
                } as CSSProperties}
                title={snapshot.label}
                type="button"
                // The surrounding scrubber captures the pointer on pointerdown and
                // derives a year from the raw x position, which overrode the
                // milestone before its click could ever fire.
                onPointerDown={handleMilestonePointerDown}
                onPointerMove={handleMilestonePointerMove}
                onPointerUp={handleMilestonePointerUp}
                onClick={() => {
                  // A drag already resolved to a scrubbed year; don't snap back.
                  if (milestoneDragRef.current?.scrubbing) {
                    milestoneDragRef.current = null;
                    return;
                  }
                  milestoneDragRef.current = null;
                  onSelectSnapshot(snapshot);
                }}
              >
                <i />
                <strong>{snapshot.year}</strong>
                <span>{snapshot.milestone}</span>
              </button>
            );
          })}
        </div>
      </div>
      <PlaybackSpeedSlider
        className="explorer-timeline-speed-slider"
        value={explorerPlaybackSpeed}
        onChange={onChangePlaybackSpeed}
        label="Explorer timeline playback speed"
      />
    </footer>
  );
}

export function ExplorerView({
  activeSnapshot,
  auroraModeEnabled = false,
  interfaceVisible,
  onHideInterface,
  onShowInterface,
  onSelectSnapshot,
  onOpenHome,
  onOpenExplorer,
  onOpenPlayground,
}: ExplorerViewProps) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedSearchIndex, setHighlightedSearchIndex] = useState(0);
  const [mobileSearchViewportHeight, setMobileSearchViewportHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!searchOpen || typeof window === "undefined") {
      setMobileSearchViewportHeight(null);
      return;
    }

    const viewport = window.visualViewport;
    const updateViewportHeight = () => {
      setMobileSearchViewportHeight(Math.round(viewport?.height ?? window.innerHeight));
    };

    updateViewportHeight();
    viewport?.addEventListener("resize", updateViewportHeight);
    viewport?.addEventListener("scroll", updateViewportHeight);
    window.addEventListener("orientationchange", updateViewportHeight);

    return () => {
      viewport?.removeEventListener("resize", updateViewportHeight);
      viewport?.removeEventListener("scroll", updateViewportHeight);
      window.removeEventListener("orientationchange", updateViewportHeight);
    };
  }, [searchOpen]);
  const [typeFilters, setTypeFilters] = useState<ExplorerCategoryId[]>([]);
  const [colorMode, setColorMode] = useState<ExplorerColorMode>("type");
  const [regimeFilter, setRegimeFilter] = useState<ExplorerRegimeFilter>("all");
  const [focusPreset, setFocusPreset] = useState<ExplorerFocusPreset>("earth-orbit");
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [explorerPlaybackSpeed, setExplorerPlaybackSpeed] = useState(defaultExplorerSpeed);
  const [explorerPlaybackRunning, setExplorerPlaybackRunning] = useState(
    initialExplorerPlaybackRunning,
  );
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogCollectionId, setCatalogCollectionId] =
    useState<ExplorerDiscoveryCollectionId>("featured");
  const [layersOpen, setLayersOpen] = useState(false);
  const [orbitSheetOpen, setOrbitSheetOpen] = useState(false);
  const [playbackSheetOpen, setPlaybackSheetOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [contactAnalysisEnabled, setContactAnalysisEnabled] = useState(false);
  const [starFieldVisible, setStarFieldVisible] = useState(true);
  const [sceneVisibility, setSceneVisibility] = useState(createExplorerVisibilityState);
  const catalogPanelRef = useRef<HTMLElement | null>(null);
  const layersPanelRef = useRef<HTMLElement | null>(null);
  const catalogLauncherRef = useRef<HTMLButtonElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailsInvokerRef = useRef<{ entryId: string; element: HTMLElement } | null>(null);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    const input = searchInputRef.current;
    if (input && document.activeElement === input) input.blur();
  }, []);
  const catalogPanel = useExplorerPanelController(setCatalogOpen);
  const layersPanel = useExplorerPanelController(setLayersOpen);
  const orbitPanel = useExplorerPanelController(setOrbitSheetOpen);
  const playbackPanel = useExplorerPanelController(setPlaybackSheetOpen);
  const filterMenu = useExplorerPanelController(setFilterMenuOpen);
  const scenario = useSimulationStore((state) => state.scenario);
  const isPlaying = useSimulationStore((state) => state.isPlaying);
  const selectSatellite = useSimulationStore((state) => state.selectSatellite);
  const selectGroundStation = useSimulationStore((state) => state.selectGroundStation);
  const selectConstellation = useSimulationStore((state) => state.selectConstellation);
  const selectCatalogObject = useSimulationStore((state) => state.selectCatalogObject);
  const clearSelection = useSimulationStore((state) => state.clearSelection);
  const setPlaying = useSimulationStore((state) => state.setPlaying);
  const setTimeScale = useSimulationStore((state) => state.setTimeScale);
  const setFollowSelectedObject = useSimulationStore((state) => state.setFollowSelectedObject);
  const currentColorMode =
    explorerColorModes.find((mode) => mode.id === colorMode) ?? explorerColorModes[0];
  const selectedObjectTypeFilter =
    explorerObjectTypeFilters.find((filter) => filter.id === (typeFilters[0] ?? "")) ??
    explorerObjectTypeFilters[0];
  const explorerAnimate = explorerPlaybackRunning;
  const applyExplorerRegimeFilter = useCallback(
    (regime: ExplorerRegimeFilter) => {
      setSearchOpen(false);
      setRegimeFilter(regime);

      if (!explorerFilterChangeShouldReframe(scenario.selectedObjectId)) return;

      const preset = explorerFramePresets.find((item) => item.id === regime) ?? explorerFramePresets[0];
      setFollowSelectedObject(false);
      setFocusPreset(preset.focusPreset);
      setFocusRequestKey((current) => current + 1);
    },
    [scenario.selectedObjectId, setFollowSelectedObject],
  );
  const changeExplorerPlaybackSpeed = useCallback(
    (speed: number) => {
      const normalizedSpeed = Math.max(1, Math.min(3000, Math.round(speed)));
      setExplorerPlaybackSpeed(normalizedSpeed);
      setTimeScale(normalizedSpeed);
    },
    [setTimeScale],
  );
  const toggleExplorerPlayback = useCallback(() => {
    setExplorerPlaybackRunning((running) => {
      const next = !running;
      setPlaying(next);
      if (next) setTimeScale(explorerPlaybackSpeed);
      return next;
    });
  }, [explorerPlaybackSpeed, setPlaying, setTimeScale]);
  const selectExplorerTimelineSnapshot = useCallback((snapshot: ExplorerSnapshot) => {
    onSelectSnapshot(snapshot);
    if (explorerPlaybackRunning) {
      setPlaying(true);
      setTimeScale(explorerPlaybackSpeed);
    }
  }, [explorerPlaybackRunning, explorerPlaybackSpeed, onSelectSnapshot, setPlaying, setTimeScale]);
  const snapshotView = useMemo(() => explorerSnapshotView(activeSnapshot), [activeSnapshot]);
  const typeFilterSet = useMemo(() => new Set(typeFilters), [typeFilters]);
  const matchesExplorerFilters = useCallback(
    (entry: ExplorerCatalogEntry) =>
      explorerEntryMatchesFilters(entry, regimeFilter, typeFilterSet),
    [regimeFilter, typeFilterSet],
  );
  const dropdownFiltersActive = typeFilters.length > 0;
  const searchActive = query.trim() !== "";
  const activeDiscoveryCollection =
    explorerDiscoveryCollections.find((collection) => collection.id === catalogCollectionId) ??
    explorerDiscoveryCollections[0];
  const visibleCatalogEntries = useMemo(() => {
    const records = searchActive
      ? prioritizeExplorerSearchResults(
          filterExplorerCatalogSnapshot(snapshotView, {
            query,
            categoryId: "all",
            status: "all",
            operator: "all",
            constellationId: "all",
          }),
          query,
        )
      : explorerEntriesForDiscoveryCollection(
          snapshotView.records.filter(isExplorerCatalogResult),
          catalogCollectionId,
        );

    return records.filter(matchesExplorerFilters);
  }, [
    catalogCollectionId,
    matchesExplorerFilters,
    query,
    searchActive,
    snapshotView,
  ]);
  const sceneFiltered = useMemo(() => {
    return snapshotView.records.filter(
      (entry) => isExplorerSceneEntry(entry) && matchesExplorerFilters(entry),
    );
  }, [matchesExplorerFilters, snapshotView.records]);
  const resolvedVisibility = useMemo(
    () =>
      resolveExplorerVisibility(
        snapshotView,
        sceneFiltered,
        sceneVisibility,
        Number.POSITIVE_INFINITY,
        scenario.selectedObjectId,
      ),
    [scenario.selectedObjectId, sceneFiltered, sceneVisibility, snapshotView],
  );
  const contactGroundStationIds = useMemo(
    () =>
      contactAnalysisEnabled
        ? sceneFiltered
            .filter(
              (entry) =>
                entry.selectionKind === "ground-station" &&
                entry.groundStation &&
                sceneVisibility.objects[entry.id] !== false,
            )
            .map((entry) => entry.id)
        : [],
    [contactAnalysisEnabled, sceneFiltered, sceneVisibility.objects],
  );
  const contactGroundStationIdSet = useMemo(
    () => new Set(contactGroundStationIds),
    [contactGroundStationIds],
  );
  const explorerVisibleGroundStationIds = contactAnalysisEnabled
    ? contactGroundStationIds
    : resolvedVisibility.groundStationIds;
  const isCatalogEntrySceneVisible = useCallback(
    (entry: ExplorerCatalogEntry) =>
      isExplorerEntryVisible(entry, sceneVisibility) ||
      (contactAnalysisEnabled && contactGroundStationIdSet.has(entry.id)),
    [contactAnalysisEnabled, contactGroundStationIdSet, sceneVisibility],
  );
  const selectedSceneEntry = scenario.selectedObjectId
    ? snapshotView.byId.get(scenario.selectedObjectId)
    : undefined;
  const selectedFilterConflict = useMemo(
    () => selectedSceneEntry
      ? explorerFilterConflict(selectedSceneEntry, regimeFilter, typeFilterSet)
      : null,
    [regimeFilter, selectedSceneEntry, typeFilterSet],
  );
  const selectedFilterConflictMessage = useMemo(() => {
    if (!selectedFilterConflict) return null;

    const activeLabels = [
      selectedFilterConflict.regime
        ? explorerFramePresets.find((preset) => preset.id === regimeFilter)?.label
        : null,
      selectedFilterConflict.objectType ? selectedObjectTypeFilter.label : null,
    ].filter(Boolean);

    return `Selected object is outside the active ${activeLabels.join(" and ")} ${
      activeLabels.length === 1 ? "filter" : "filters"
    }. It remains visible while selected.`;
  }, [regimeFilter, selectedFilterConflict, selectedObjectTypeFilter.label]);
  const globalSearchResults = useMemo(
    () =>
      searchActive
        ? prioritizeExplorerSearchResults(
            filterExplorerCatalogSnapshot(snapshotView, {
              query,
              categoryId: "all",
              status: "all",
              operator: "all",
              constellationId: "all",
            }),
            query,
          ).slice(0, 10)
        : [],
    [query, searchActive, snapshotView],
  );
  useEffect(() => {
    setHighlightedSearchIndex(0);
  }, [globalSearchResults.length, query, searchOpen]);
  const constellationColors = useMemo(
    () => new Map(scenario.constellations.map((constellation) => [constellation.id, constellation.color])),
    [scenario.constellations],
  );
  const markerStyles = useMemo(
    () =>
      new Map(
        snapshotView.records
          .filter(
            (entry) =>
              entry.selectionKind === "satellite" || entry.selectionKind === "ground-station",
          )
          .map((entry) => {
            const style = explorerMarkerStyle(entry, colorMode, constellationColors);
            return [
              entry.id,
              { ...style, emphasis: regimeEmphasis(entry, focusPreset) },
            ];
          }),
      ),
    [colorMode, constellationColors, focusPreset, snapshotView.records],
  );
  const selectedSatelliteAvailable = scenario.selectedObjectType === "satellite";
  const loadedCatalogObjectCount = snapshotView.catalogObjectCount;
  const loadedRenderableOrbitStateCount = snapshotView.renderableOrbitStateCount;
  const historicalCatalogOnly = explorerHistoricalWarningState({
    catalogObjectCount: loadedCatalogObjectCount,
    renderableOrbitStateCount: loadedRenderableOrbitStateCount,
    dataCoverage: snapshotView.dataCoverage,
  }) === "historical-catalog-only";
  const loadedOrbitVisualizationSummary = explorerOrbitVisualizationSummary(
    snapshotView.dataCoverage,
    loadedRenderableOrbitStateCount,
  );
  const loadedCoverageLabel = snapshotView.dataCoverage.label;
  const historicalCatalogDate = new Date(activeSnapshot.timestampIso).toISOString().slice(0, 10);
  const sceneSatelliteIds = useMemo(
    () => new Set(scenario.satellites.map((satellite) => satellite.id)),
    [scenario.satellites],
  );
  const sceneGroundStationIds = useMemo(
    () => new Set(scenario.groundStations.map((station) => station.id)),
    [scenario.groundStations],
  );
  const sceneConstellationIds = useMemo(
    () => new Set(scenario.constellations.map((constellation) => constellation.id)),
    [scenario.constellations],
  );
  const clearExplorerSelection = useCallback(() => {
    clearSelection();
    setFollowSelectedObject(false);
    setFocusPreset("earth-orbit");
    setFocusRequestKey((current) => current + 1);
  }, [clearSelection, setFollowSelectedObject]);

  const resolveSelectedFilterConflict = useCallback(() => {
    if (!selectedFilterConflict) return;
    if (selectedFilterConflict.regime) setRegimeFilter("all");
    if (selectedFilterConflict.objectType) setTypeFilters([]);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".explorer-selection-card .explorer-panel-close")
        ?.focus();
    });
  }, [selectedFilterConflict]);

  const closeExplorerDetails = useCallback(() => {
    const selectedObjectId = scenario.selectedObjectId;
    clearExplorerSelection();
    window.requestAnimationFrame(() => {
      const invoker = detailsInvokerRef.current;
      if (invoker?.entryId === selectedObjectId && invoker.element.isConnected) {
        invoker.element.focus();
      } else {
        catalogLauncherRef.current?.focus();
      }
    });
  }, [clearExplorerSelection, scenario.selectedObjectId]);

  useEffect(() => {
    if (!scenario.selectedObjectId) return;
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(".explorer-selection-card .explorer-panel-close")
        ?.focus();
    });
  }, [scenario.selectedObjectId]);

  const catalogSheetDrag = useMobileSheetDrag(catalogPanel.close);
  const layersSheetDrag = useMobileSheetDrag(layersPanel.close);
  const orbitSheetDrag = useMobileSheetDrag(orbitPanel.close);
  const playbackSheetDrag = useMobileSheetDrag(playbackPanel.close);

  const closeExplorerSheets = useCallback(() => {
    setCatalogOpen(false);
    setLayersOpen(false);
    setOrbitSheetOpen(false);
    setPlaybackSheetOpen(false);
    setMobileMenuOpen(false);
  }, []);

  const selectEntry = useCallback((entry: ExplorerCatalogEntry, invoker?: HTMLElement) => {
    if (invoker) detailsInvokerRef.current = { entryId: entry.id, element: invoker };
    closeSearch();
    closeExplorerSheets();
    if (entry.selectionKind !== "satellite") setFollowSelectedObject(false);
    if (entry.selectionKind === "satellite" && sceneSatelliteIds.has(entry.id)) {
      selectSatellite(entry.id);
      setFocusPreset("object");
      setFocusRequestKey((current) => current + 1);
    } else if (entry.selectionKind === "ground-station" && sceneGroundStationIds.has(entry.id)) {
      selectGroundStation(entry.id);
      setFocusPreset("object");
      setFocusRequestKey((current) => current + 1);
    } else if (entry.selectionKind === "constellation" && sceneConstellationIds.has(entry.id)) {
      selectConstellation(entry.id);
      setFocusPreset("constellation");
      setFocusRequestKey((current) => current + 1);
    }
    else {
      setFollowSelectedObject(false);
      selectCatalogObject(entry.id);
    }
  }, [
    closeExplorerSheets,
    closeSearch,
    sceneConstellationIds,
    sceneGroundStationIds,
    sceneSatelliteIds,
    selectCatalogObject,
    selectConstellation,
    selectGroundStation,
    selectSatellite,
    setFollowSelectedObject,
  ]);

  const explorerReviewState = useMemo<ExplorerReviewState>(() => {
    const selectedEntry = scenario.selectedObjectId
      ? snapshotView.byId.get(scenario.selectedObjectId)
      : undefined;
    const selectedTimelineMs = Date.parse(activeSnapshot.timestampIso);
    const simulationTimeMs = Date.parse(scenario.simulationTimeUtc);
    const timelineAndSimulationAligned =
      Number.isFinite(selectedTimelineMs) &&
      Number.isFinite(simulationTimeMs) &&
      selectedTimelineMs === simulationTimeMs;
    const historicalVersionParts = [
      `schema-${explorerHistoricalCatalog.schemaVersion}`,
      explorerHistoricalCatalog.importVersion ?? "unversioned",
      explorerHistoricalCatalog.generatedAt ?? "undated",
      explorerHistoricalCatalog.sourceFingerprint ?? "no-fingerprint",
    ];

    const resolvedEntries = resolvedVisibility.satelliteIds
      .map((id) => snapshotView.byId.get(id))
      .filter((entry): entry is ExplorerCatalogEntry => Boolean(entry));
    const initialRenderer = readExplorerRendererStats();
    return {
      schemaVersion: ORBIT_STUDIO_REVIEW_SCHEMA_VERSION,
      ready: false,
      workspace: "explorer",
      snapshotId: activeSnapshot.id,
      selectedYear: activeSnapshot.year,
      selectedTimelineTime: activeSnapshot.timestampIso,
      simulationTime: scenario.simulationTimeUtc,
      timelineAndSimulationAligned,
      visibleObjectCount: resolvedVisibility.satelliteIds.length,
      catalogObjectCount: snapshotView.catalogObjectCount,
      catalogResultCount: visibleCatalogEntries.length,
      renderableOrbitStateCount: snapshotView.renderableOrbitStateCount,
      exactHistoricalOrbitStateCount:
        snapshotView.dataCoverage.exactHistoricalOrbitStateCount ?? 0,
      reconstructedHistoricalOrbitStateCount:
        snapshotView.dataCoverage.reconstructedHistoricalOrbitStateCount ?? 0,
      catalogOnlyObjectCount: snapshotView.dataCoverage.catalogOnlyObjectCount ?? 0,
      resolvedExactOrbitStateCount: resolvedEntries.filter(
        (entry) =>
          entry.orbitAvailability === "exact-historical-orbit" ||
          entry.orbitAvailability === "nearest-historical-orbit",
      ).length,
      resolvedReconstructedOrbitStateCount: resolvedEntries.filter(
        (entry) => entry.orbitAvailability === "reconstructed-historical-orbit",
      ).length,
      categoryCounts: Object.fromEntries(
        explorerCategoryHierarchy.map((category) => [
          category.id,
          snapshotView.categoryCounts.get(category.id) ?? 0,
        ]),
      ) as Record<ExplorerCategoryId, number>,
      selectedObject: selectedEntry
        ? {
            id: selectedEntry.id,
            name: selectedEntry.name,
            selectionKind: selectedEntry.selectionKind,
            catalogNumber: selectedEntry.catalogNumber ?? null,
            categoryId: selectedEntry.categoryId,
          }
        : null,
      query,
      discoveryCollectionId: catalogCollectionId,
      activeFilter:
        explorerFramePresets.find((preset) => preset.id === regimeFilter)?.label ?? regimeFilter,
      regimeFilter,
      objectTypeFilters: [...typeFilters],
      playback: {
        isPlaying,
        speed: `${explorerPlaybackSpeed.toLocaleString()}×`,
        timeScale: scenario.timeScale,
      },
      dataCoverage: {
        status: snapshotView.dataCoverage.status,
        label: snapshotView.dataCoverage.label,
        sourceLabels: [...snapshotView.dataCoverage.sourceLabels],
      },
      warningState: "none",
      renderer: {
        ...initialRenderer,
        settled: false,
        expectedRenderedInstanceCount: resolvedVisibility.satelliteIds.length,
      },
      datasets: {
        catalogVersion: `gcat-satcat-${explorerLatestPublicCatalogDate}`,
        currentCatalogMode: explorerCurrentCatalogMode,
        currentCatalogRecordCount: 0,
        latestPublicCatalogMembershipCount:
          snapshotView.dataCoverage.status === "latest-public-catalog"
            ? snapshotView.dataCoverage.catalogObjectCount
            : 0,
        historicalDatasetVersion: historicalVersionParts.join(":"),
        historicalGeneratedAt: explorerHistoricalCatalog.generatedAt,
        historicalSourceFingerprint: explorerHistoricalCatalog.sourceFingerprint ?? null,
      },
    };
  }, [
    activeSnapshot,
    explorerPlaybackSpeed,
    catalogCollectionId,
    isPlaying,
    query,
    regimeFilter,
    resolvedVisibility.satelliteIds.length,
    scenario.selectedObjectId,
    scenario.simulationTimeUtc,
    scenario.timeScale,
    snapshotView,
    typeFilters,
    visibleCatalogEntries.length,
  ]);
  const explorerReviewStateRef = useRef(explorerReviewState);
  explorerReviewStateRef.current = explorerReviewState;

  useEffect(() => {
    if (!isOrbitStudioReviewMode()) return undefined;

    const bridge = {
      schemaVersion: ORBIT_STUDIO_REVIEW_SCHEMA_VERSION,
      getState: () => mergeExplorerRendererState(
        explorerReviewStateRef.current,
        readStudioPlaybackTimeIso(),
        readExplorerRendererStats(),
      ),
      setTimelineYear: (year: number | "current") => {
        selectExplorerTimelineSnapshot(
          year === "current" ? currentExplorerSnapshot : explorerSnapshotForYear(year),
        );
      },
      setTimelineSnapshot: (snapshotId: string) => {
        const snapshot = explorerTimelineSnapshots.find((item) => item.id === snapshotId);
        if (!snapshot) throw new Error(`Unknown Explorer timeline snapshot: ${snapshotId}`);
        selectExplorerTimelineSnapshot(snapshot);
      },
      setRegimeFilter: (filter: ExplorerRegimeFilter) => {
        applyExplorerRegimeFilter(filter);
      },
      clearReviewContext: () => {
        setQuery("");
        setSearchOpen(false);
        setCatalogCollectionId("featured");
        setCatalogOpen(false);
        setLayersOpen(false);
        setOrbitSheetOpen(false);
        setPlaybackSheetOpen(false);
        clearExplorerSelection();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      },
      setPlayback: (playing: boolean) => {
        setExplorerPlaybackRunning(playing);
        setPlaying(playing);
        if (playing) setTimeScale(explorerPlaybackSpeed);
      },
      setPlaybackSpeed: (speed) => {
        const reviewSpeeds = { "1x": 1, "10x": 10, "100x": 100, "1000x": 1000, max: 3000 } as const;
        changeExplorerPlaybackSpeed(reviewSpeeds[speed]);
      },
    } satisfies Window["__ORBIT_STUDIO_REVIEW__"];

    window.__ORBIT_STUDIO_REVIEW__ = bridge;

    return () => {
      if (window.__ORBIT_STUDIO_REVIEW__ === bridge) {
        delete window.__ORBIT_STUDIO_REVIEW__;
      }
    };
  }, [
    applyExplorerRegimeFilter,
    changeExplorerPlaybackSpeed,
    clearExplorerSelection,
    explorerPlaybackSpeed,
    selectExplorerTimelineSnapshot,
    setPlaying,
    setTimeScale,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!interfaceVisible || event.key !== "Escape") return;
      if (filterMenuOpen) {
        filterMenu.close();
      } else if (searchOpen) {
        closeSearch();
      } else if (catalogOpen) {
        catalogPanel.close();
      } else if (layersOpen) {
        layersPanel.close();
      } else if (orbitSheetOpen) {
        orbitPanel.close();
      } else if (playbackSheetOpen) {
        playbackPanel.close();
      } else if (mobileMenuOpen) {
        setMobileMenuOpen(false);
        window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
      } else {
        clearExplorerSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    catalogOpen,
    catalogPanel,
    clearExplorerSelection,
    closeSearch,
    filterMenu,
    filterMenuOpen,
    layersOpen,
    layersPanel,
    mobileMenuOpen,
    orbitPanel,
    orbitSheetOpen,
    playbackPanel,
    playbackSheetOpen,
    searchOpen,
    interfaceVisible,
  ]);

  useEffect(() => {
    if (!catalogOpen) return;
    window.requestAnimationFrame(() => catalogPanelRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const isCatalogContext =
        target instanceof Element && Boolean(target.closest("[data-explorer-catalog-context]"));
      if (
        !catalogPanelRef.current?.contains(target) &&
        !catalogPanel.invokerRef.current?.contains(target) &&
        !isCatalogContext
      ) {
        catalogPanel.close(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [catalogOpen, catalogPanel]);

  useEffect(() => {
    if (!layersOpen) return;
    window.requestAnimationFrame(() => layersPanelRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !layersPanelRef.current?.contains(target) &&
        !layersPanel.invokerRef.current?.contains(target)
      ) {
        layersPanel.close(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [layersOpen, layersPanel]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!filterMenuRef.current?.contains(target)) filterMenu.close(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [filterMenu, filterMenuOpen]);

  // Touch platforms do not reliably fire `blur` when the user taps a non-focusable
  // surface, which otherwise left the field expanded with the keyboard dismissed.
  useEffect(() => {
    if (!searchOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (searchWrapRef.current?.contains(target)) return;
      closeSearch();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [closeSearch, searchOpen]);

  useEffect(() => {
    setPlaying(explorerPlaybackRunning);
    if (explorerPlaybackRunning) setTimeScale(explorerPlaybackSpeed);
  }, [
    activeSnapshot.id,
    explorerPlaybackSpeed,
    explorerPlaybackRunning,
    setPlaying,
    setTimeScale,
  ]);
  return (
    <main className={`explorer-shell ${interfaceVisible ? "" : "interface-hidden"}`}>
      <header className="explorer-header">
        <button
          aria-label="Open Orbit Studio home"
          className="explorer-brand explorer-brand-button"
          type="button"
          onClick={onOpenHome}
        >
          <img
            alt="Orbit Studio Explorer"
            className="explorer-brand-logo explorer-brand-logo-full"
            src="/brand/orbit-studio-explorer-logo.png"
          />
          <img
            alt=""
            aria-hidden="true"
            className="explorer-brand-logo explorer-brand-logo-icon"
            src="/brand/orbit-studio-explorer-icon.png"
          />
        </button>
        <div
          ref={searchWrapRef}
          className="explorer-global-search"
          data-explorer-catalog-context
          data-search-open={searchOpen ? "true" : "false"}
          data-search-active={searchActive ? "true" : "false"}
          style={
            mobileSearchViewportHeight
              ? ({
                  "--explorer-search-viewport-height": `${mobileSearchViewportHeight}px`,
                } as CSSProperties)
              : undefined
          }
          onBlur={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (nextTarget && event.currentTarget.contains(nextTarget)) return;
            setSearchOpen(false);
          }}
        >
          <label>
            <Search size={16} />
            <input
              ref={searchInputRef}
              aria-activedescendant={
                searchOpen && globalSearchResults[highlightedSearchIndex]
                  ? `explorer-search-option-${highlightedSearchIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={searchOpen && searchActive ? EXPLORER_SEARCH_LISTBOX_ID : undefined}
              aria-expanded={searchOpen && searchActive}
              aria-label="Search satellites, missions, and systems"
              placeholder="Search satellites, missions, or systems"
              role="combobox"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
                if (event.target.value.trim()) {
                  setFollowSelectedObject(false);
                  setRegimeFilter("all");
                  setFocusPreset("earth-orbit");
                  setFocusRequestKey((current) => current + 1);
                }
              }}
              onFocus={() => {
                setMobileMenuOpen(false);
                setSearchOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && searchOpen) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeSearch();
                  return;
                }

                if (!searchActive) return;

                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  event.stopPropagation();
                  setSearchOpen(true);
                  setHighlightedSearchIndex((current) => {
                    if (globalSearchResults.length === 0) return 0;
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    return (current + direction + globalSearchResults.length) % globalSearchResults.length;
                  });
                  return;
                }

                if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  event.stopPropagation();
                  setSearchOpen(true);
                  setHighlightedSearchIndex(
                    event.key === "Home" ? 0 : Math.max(0, globalSearchResults.length - 1),
                  );
                  return;
                }

                if (event.key === "Enter" && searchOpen) {
                  const highlighted = globalSearchResults[highlightedSearchIndex];
                  if (!highlighted) return;
                  event.preventDefault();
                  event.stopPropagation();
                  selectEntry(highlighted, event.currentTarget);
                }
              }}
            />
            {searchActive && (
              <button
                aria-label="Clear search"
                title="Clear search"
                type="button"
                onClick={() => {
                  setQuery("");
                  setHighlightedSearchIndex(0);
                  searchInputRef.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </label>
          {searchOpen && searchActive && (
            <div
              className="explorer-search-dropdown"
              id={EXPLORER_SEARCH_LISTBOX_ID}
              role="listbox"
            >
              <div className="explorer-search-dropdown-status" role="status">
                {globalSearchResults.length
                  ? `${globalSearchResults.length.toLocaleString()} matches`
                  : "No matches"}
              </div>
              {globalSearchResults.map((entry, index) => (
                <button
                  aria-selected={index === highlightedSearchIndex}
                  className={index === highlightedSearchIndex ? "active" : ""}
                  id={`explorer-search-option-${index}`}
                  key={entry.id}
                  role="option"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedSearchIndex(index)}
                  onClick={(event) => selectEntry(entry, event.currentTarget)}
                >
                  <i style={{ background: markerStyles.get(entry.id)?.color ?? entry.orbit?.color }} />
                  <span>
                    <strong>{entry.name}</strong>
                    <small>{explorerResultKindLabel(entry)} · {entry.objectType}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
              {globalSearchResults.length === 0 && (
                <p>Try a catalog number, operator, category, or constellation name.</p>
              )}
            </div>
          )}
        </div>
        <div
          className="explorer-regime-control"
          aria-label="Orbit regime filter"
          data-explorer-catalog-context
          role="group"
        >
          {explorerFramePresets.map((preset) => (
            <button
              aria-pressed={regimeFilter === preset.id}
              className={regimeFilter === preset.id ? "active" : ""}
              key={preset.id}
              type="button"
              onClick={() => applyExplorerRegimeFilter(preset.id)}
            >
              {preset.label}
            </button>
          ))}
          <div className="explorer-type-filter-wrap" ref={filterMenuRef}>
            <button
              aria-expanded={filterMenuOpen}
              aria-haspopup="menu"
              aria-label={`Filter by object type: ${selectedObjectTypeFilter.label}`}
              className={filterMenuOpen || typeFilters.length > 0 ? "active" : ""}
              type="button"
              onClick={(event) => {
                setSearchOpen(false);
                filterMenu.toggleFrom(event.currentTarget);
              }}
            >
              <ExplorerObjectTypeIcon id={selectedObjectTypeFilter.id} />
              <ChevronRight size={14} />
            </button>
            {filterMenuOpen && (
              <div className="explorer-type-filter-menu" role="menu">
                {explorerObjectTypeFilters.map((filter) => (
                  <button
                    aria-checked={selectedObjectTypeFilter.id === filter.id}
                    className={selectedObjectTypeFilter.id === filter.id ? "active" : ""}
                    key={filter.label}
                    role="menuitemradio"
                    type="button"
                    onClick={() => {
                      setTypeFilters(filter.id ? [filter.id] : []);
                      filterMenu.close();
                    }}
                  >
                    <ExplorerObjectTypeIcon id={filter.id} />
                    <span>{filter.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <ExplorerTimeChip activeSnapshot={activeSnapshot} />
        <div className="explorer-header-actions">
          <OrbitAppMenu
            activeApp="explorer"
            onHideInterface={onHideInterface}
            onOpenExplorer={onOpenExplorer}
            onOpenHome={onOpenHome}
            onOpenPlayground={onOpenPlayground}
          />
        </div>
      </header>

      <button
        ref={catalogLauncherRef}
        aria-controls="explorer-catalog-panel"
        aria-hidden={catalogOpen}
        className={`explorer-catalog-launcher ${catalogOpen ? "panel-open" : ""}`}
        aria-expanded={catalogOpen}
        tabIndex={catalogOpen ? -1 : 0}
        type="button"
        onClick={(event) => {
          catalogPanel.toggleFrom(event.currentTarget);
          setMobileMenuOpen(false);
          setLayersOpen(false);
          setOrbitSheetOpen(false);
          setPlaybackSheetOpen(false);
        }}
      >
        <Menu size={18} />
        <span>Explore</span>
      </button>

      <button
        className={`explorer-display-launcher ${layersOpen ? "active" : ""}`}
        aria-label="Display Settings"
        aria-controls="explorer-display-settings-panel"
        aria-expanded={layersOpen}
        title="Display Settings"
        type="button"
        onClick={(event) => {
          layersPanel.toggleFrom(event.currentTarget);
          setMobileMenuOpen(false);
          setCatalogOpen(false);
        }}
      >
        <Settings size={20} />
      </button>

      {catalogOpen && (
      <aside
        id="explorer-catalog-panel"
        ref={catalogPanelRef}
        aria-label="Explore the catalog"
        className="explorer-catalog-panel explorer-overlay-panel"
        style={catalogSheetDrag.sheetStyle}
        tabIndex={-1}
      >
        <ExplorerPanelHeader
          className="explorer-mobile-sheet-drag-region"
          closeLabel="Close Explore"
          dragHandleProps={catalogSheetDrag.dragHandleProps}
          supporting={`${loadedCatalogObjectCount.toLocaleString()} objects in this snapshot`}
          title="Explore"
          onClose={catalogPanel.close}
        />
        <div className="explorer-catalog-summary" aria-label="Discovery collection summary">
          <label className="explorer-collection-picker">
            <span>Collection</span>
            <select
              aria-label="Explore collection"
              value={catalogCollectionId}
              onChange={(event) => {
                setCatalogCollectionId(
                  event.target.value as ExplorerDiscoveryCollectionId,
                );
                setQuery("");
              }}
            >
              {explorerDiscoveryCollections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            {searchActive
              ? "Showing matches across every catalog collection."
              : activeDiscoveryCollection.description}
          </p>
          <small>
            {selectedObjectTypeFilter.label} · {loadedCoverageLabel}
          </small>
        </div>
        <div className="explorer-browse-content">
          <div className="explorer-results-heading">
            <span>
              {searchActive
                ? "Search results"
                : dropdownFiltersActive
                  ? `Filtered ${activeDiscoveryCollection.label}`
                  : activeDiscoveryCollection.label}
            </span>
            <strong>{visibleCatalogEntries.length.toLocaleString()}</strong>
          </div>
          <VirtualizedCatalogList
            entries={visibleCatalogEntries}
            selectedObjectId={scenario.selectedObjectId}
            isSceneVisible={isCatalogEntrySceneVisible}
            onSelect={selectEntry}
          />
        </div>
      </aside>
      )}

      {layersOpen && (
        <aside
          id="explorer-display-settings-panel"
          ref={layersPanelRef}
          className="explorer-layers-popover explorer-overlay-panel"
          aria-label="Display settings"
          style={layersSheetDrag.sheetStyle}
          tabIndex={-1}
        >
          <ExplorerPanelHeader
            className="explorer-mobile-sheet-drag-region"
            closeLabel="Close display settings"
            dragHandleProps={layersSheetDrag.dragHandleProps}
            title="Display"
            onClose={layersPanel.close}
          />
          <section className="explorer-layer-options">
            <span>Objects</span>
            {explorerCategoryHierarchy
              .filter(
                (layer) =>
                  layer.id !== "missions" &&
                  layer.id !== "concepts" &&
                  layer.id !== "ground-stations" &&
                  layer.id !== "constellations",
              )
              .map((layer) => {
                const count = explorerSceneLayerCount(snapshotView.records, layer.id);

                return (
                  <label key={layer.id}>
                    <input
                      checked={sceneVisibility.layers[layer.id]}
                      type="checkbox"
                      onChange={(event) =>
                        setSceneVisibility((current) => ({
                          ...current,
                          layers: { ...current.layers, [layer.id]: event.target.checked },
                        }))
                      }
                    />
                    <span>
                      <strong>{explorerSceneLayerLabel(layer.id)}</strong>
                      <small>
                        {count.toLocaleString()} available in this view
                      </small>
                    </span>
                  </label>
                );
              })}
          </section>
          <section className="explorer-layer-options">
            <span>Collections</span>
            <label className="explorer-layer-dependent">
              <input
                checked={sceneVisibility.layers.constellations}
                disabled={!sceneVisibility.layers.payloads}
                type="checkbox"
                onChange={(event) =>
                  setSceneVisibility((current) => ({
                    ...current,
                    layers: {
                      ...current.layers,
                      constellations: event.target.checked,
                    },
                  }))
                }
              />
              <span>
                <strong>Constellation systems</strong>
                <small>
                  {!sceneVisibility.layers.payloads
                    ? "Requires Satellites"
                    : `${explorerSceneLayerCount(
                        snapshotView.records,
                        "constellations",
                      ).toLocaleString()} objects in loaded systems`}
                </small>
              </span>
            </label>
          </section>
          <section className="explorer-analysis-options">
            <span>Reference Layers</span>
            <label>
              <input
                checked={contactAnalysisEnabled}
                type="checkbox"
                onChange={(event) => setContactAnalysisEnabled(event.target.checked)}
              />
              <span>Ground station contact</span>
            </label>
            {contactAnalysisEnabled && (
              <p>
                Ground stations represent Earth-based antenna sites used to evaluate line-of-sight
                contact and coverage with selected satellites.
              </p>
            )}
            <label>
              <input
                checked={starFieldVisible}
                type="checkbox"
                onChange={(event) => setStarFieldVisible(event.target.checked)}
              />
              <span>Stars</span>
            </label>
          </section>
          <section className="explorer-visualization-options">
            <span>Visualization</span>
            <div role="group" aria-label="Catalog color mode">
              {explorerColorModes.map((mode) => (
                <button
                  aria-pressed={colorMode === mode.id}
                  className={colorMode === mode.id ? "active" : ""}
                  key={mode.id}
                  title={mode.tooltip}
                  type="button"
                  onClick={() => setColorMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </section>
          <ExplorerSelectedVisibility
            entry={selectedSceneEntry}
            visibility={sceneVisibility}
            onChange={setSceneVisibility}
          />
        </aside>
      )}

      {orbitSheetOpen && (
        <aside
          className="explorer-mobile-sheet explorer-mobile-orbit-sheet"
          aria-label="Orbit view controls"
          style={orbitSheetDrag.sheetStyle}
        >
          <ExplorerPanelHeader
            className="explorer-mobile-sheet-drag-region"
            closeLabel="Close orbit view controls"
            dragHandleProps={orbitSheetDrag.dragHandleProps}
            title="Orbit View"
            onClose={orbitPanel.close}
          />
          <section className="explorer-mobile-sheet-options" aria-label="Frame orbital extent">
            {explorerFramePresets.map((preset) => (
              <button
                aria-pressed={regimeFilter === preset.id}
                className={regimeFilter === preset.id ? "active" : ""}
                key={preset.id}
                type="button"
                onClick={() => applyExplorerRegimeFilter(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </section>
        </aside>
      )}

      {playbackSheetOpen && (
        <>
          <button
            aria-label="Close playback controls"
            className="explorer-mobile-playback-backdrop"
            type="button"
            onClick={() => playbackPanel.close()}
          />
          <aside
            className="explorer-mobile-sheet explorer-mobile-playback-sheet"
            aria-label="Explorer playback controls"
            style={playbackSheetDrag.sheetStyle}
          >
            <button
              aria-label="Close playback controls"
              className="explorer-mobile-sheet-handle"
              title="Close playback controls. Drag down or tap to close."
              type="button"
              {...playbackSheetDrag.dragHandleProps}
              onClick={() => playbackPanel.close()}
            >
              <span aria-hidden="true" />
            </button>
            <section className="explorer-mobile-playback-options">
              <button
                aria-label={explorerPlaybackRunning ? "Pause Explorer playback" : "Start Explorer playback"}
                aria-pressed={explorerPlaybackRunning}
                className={`explorer-mobile-playback-toggle ${explorerPlaybackRunning ? "running" : ""}`}
                type="button"
                onClick={toggleExplorerPlayback}
              >
                {explorerPlaybackRunning ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <PlaybackSpeedSlider
                className="explorer-mobile-playback-slider"
                value={explorerPlaybackSpeed}
                onChange={changeExplorerPlaybackSpeed}
                label="Explorer playback speed"
              />
            </section>
          </aside>
        </>
      )}

      <section className="explorer-globe" aria-label="Orbital environment globe">
        <div className={`explorer-mobile-menu ${mobileMenuOpen ? "open" : ""}`}>
          <button
            ref={mobileMenuButtonRef}
            aria-expanded={mobileMenuOpen}
            aria-haspopup="menu"
            aria-label="Open Explorer menu"
            className={mobileMenuOpen ? "active" : ""}
            type="button"
            onClick={() => {
              setSearchOpen(false);
              filterMenu.close(false);
              setMobileMenuOpen((current) => !current);
            }}
          >
            <Menu size={16} />
          </button>
          {mobileMenuOpen && !catalogOpen && !layersOpen && !orbitSheetOpen && !playbackSheetOpen && (
            <div className="explorer-mobile-menu-panel" aria-label="Explorer modes" role="menu">
              <button
                role="menuitem"
                title="Open orbit view controls"
                type="button"
                onClick={() => {
                  orbitPanel.openFrom(mobileMenuButtonRef.current);
                  setCatalogOpen(false);
                  setLayersOpen(false);
                  setPlaybackSheetOpen(false);
                  setMobileMenuOpen(false);
                }}
              >
                <Crosshair size={15} />
                <span>Orbit</span>
              </button>
              <button
                role="menuitem"
                title="Open display settings"
                type="button"
                onClick={() => {
                  layersPanel.openFrom(mobileMenuButtonRef.current);
                  setCatalogOpen(false);
                  setOrbitSheetOpen(false);
                  setPlaybackSheetOpen(false);
                  setMobileMenuOpen(false);
                }}
              >
                <Filter size={15} />
                <span>Display</span>
              </button>
              <button
                role="menuitem"
                title="Explore the catalog"
                type="button"
                onClick={() => {
                  catalogPanel.openFrom(mobileMenuButtonRef.current);
                  setLayersOpen(false);
                  setOrbitSheetOpen(false);
                  setPlaybackSheetOpen(false);
                  setMobileMenuOpen(false);
                }}
              >
                <Search size={15} />
                <span>Explore</span>
              </button>
              <button
                role="menuitem"
                title="Open playback controls"
                type="button"
                onClick={() => {
                  playbackPanel.openFrom(mobileMenuButtonRef.current);
                  setCatalogOpen(false);
                  setLayersOpen(false);
                  setOrbitSheetOpen(false);
                  setMobileMenuOpen(false);
                }}
              >
                {explorerPlaybackRunning ? <Pause size={15} /> : <Play size={15} />}
                <span>Playback</span>
              </button>
            </div>
          )}
        </div>
        {!playbackSheetOpen && !catalogOpen && !layersOpen && !orbitSheetOpen && !mobileMenuOpen && (
          <div className="explorer-mobile-playback-pill" aria-label="Compact Explorer playback">
            <button
              aria-label={explorerPlaybackRunning ? "Pause Explorer playback" : "Start Explorer playback"}
              aria-pressed={explorerPlaybackRunning}
              className={explorerPlaybackRunning ? "running" : ""}
              type="button"
              onClick={toggleExplorerPlayback}
            >
              {explorerPlaybackRunning ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button
              aria-label="Open playback speed controls"
              aria-expanded={playbackSheetOpen}
              type="button"
              onClick={() => {
                // The compact pill unmounts while the sheet is open, so restore focus to the persistent menu trigger.
                playbackPanel.openFrom(mobileMenuButtonRef.current);
                setCatalogOpen(false);
                setLayersOpen(false);
                setOrbitSheetOpen(false);
                setMobileMenuOpen(false);
              }}
            >
              {explorerPlaybackSpeed.toLocaleString()}×
            </button>
          </div>
        )}
        <nav className="explorer-mobile-dock" aria-label="Explorer controls">
          <button
            aria-pressed={orbitSheetOpen}
            className={orbitSheetOpen ? "active" : ""}
            type="button"
            onClick={() => {
              orbitSheetOpen ? orbitPanel.close() : orbitPanel.openFrom(mobileMenuButtonRef.current);
              setCatalogOpen(false);
              setLayersOpen(false);
              setPlaybackSheetOpen(false);
              setMobileMenuOpen(false);
            }}
          >
            <Crosshair size={19} />
            <span>Orbit</span>
          </button>
          <button
            aria-pressed={layersOpen}
            className={layersOpen ? "active" : ""}
            type="button"
            onClick={() => {
              layersOpen ? layersPanel.close() : layersPanel.openFrom(mobileMenuButtonRef.current);
              setCatalogOpen(false);
              setOrbitSheetOpen(false);
              setPlaybackSheetOpen(false);
              setMobileMenuOpen(false);
            }}
          >
            <Filter size={19} />
            <span>Display</span>
          </button>
          <button
            aria-pressed={catalogOpen}
            className={catalogOpen ? "active" : ""}
            type="button"
            onClick={() => {
              catalogOpen ? catalogPanel.close() : catalogPanel.openFrom(catalogLauncherRef.current);
              setLayersOpen(false);
              setOrbitSheetOpen(false);
              setPlaybackSheetOpen(false);
              setMobileMenuOpen(false);
            }}
          >
            <Search size={19} />
            <span>Explore</span>
          </button>
          <button
            aria-pressed={playbackSheetOpen}
            className={playbackSheetOpen ? "active" : ""}
            type="button"
            onClick={() => {
              playbackSheetOpen ? playbackPanel.close() : playbackPanel.openFrom(mobileMenuButtonRef.current);
              setCatalogOpen(false);
              setLayersOpen(false);
              setOrbitSheetOpen(false);
              setMobileMenuOpen(false);
            }}
          >
            {explorerPlaybackRunning ? <Pause size={19} /> : <Play size={19} />}
            <span>Playback</span>
          </button>
        </nav>
        <div className="explorer-globe-toolbar">
          <div className="explorer-control-group explorer-workspace-controls" aria-label="Explorer workspace panels">
            <button
              aria-expanded={catalogOpen}
              className={catalogOpen ? "active" : ""}
              title="Explore the catalog"
              type="button"
              onClick={(event) => {
                catalogPanel.toggleFrom(event.currentTarget);
                setLayersOpen(false);
                setOrbitSheetOpen(false);
                setPlaybackSheetOpen(false);
              }}
            >
              <Search size={13} />
              Explore
            </button>
            <button
              className={layersOpen ? "active" : ""}
              title="Open display settings"
              type="button"
              onClick={(event) => {
                layersPanel.toggleFrom(event.currentTarget);
                setCatalogOpen(false);
                setOrbitSheetOpen(false);
                setPlaybackSheetOpen(false);
              }}
            >
              <Filter size={13} />
              Display
            </button>
          </div>
          <div className="explorer-control-group" aria-label="Frame orbital extent">
            <span><Crosshair size={13} />Frame</span>
            {explorerFramePresets.map((preset) => (
              <button
                aria-pressed={regimeFilter === preset.id}
                className={regimeFilter === preset.id ? "active" : ""}
                key={preset.id}
                title={`Frame ${preset.label}`}
                type="button"
                onClick={() => applyExplorerRegimeFilter(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <details className="explorer-control-group explorer-control-disclosure" aria-label="Catalog color mode">
            <summary title="Choose catalog color mode">
              <span><Palette size={13} />Color</span>
              <strong>{currentColorMode.label}</strong>
            </summary>
            <div className="explorer-control-menu">
              {explorerColorModes.map((mode) => (
                <button
                  aria-pressed={colorMode === mode.id}
                  className={colorMode === mode.id ? "active" : ""}
                  key={mode.id}
                  title={mode.tooltip}
                  type="button"
                  onClick={() => setColorMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </details>
          <div className="explorer-control-group explorer-motion-controls" aria-label="Explorer playback">
            <button
              aria-pressed={explorerPlaybackRunning}
              className={`explorer-playback-toggle ${explorerPlaybackRunning ? "running" : ""}`}
              title={explorerPlaybackRunning ? "Pause Explorer playback" : "Start Explorer playback"}
              type="button"
              onClick={toggleExplorerPlayback}
            >
              {explorerPlaybackRunning ? <Pause size={13} /> : <Play size={13} />}
              <span>{explorerPlaybackRunning ? "Running" : "Paused"}</span>
            </button>
            <PlaybackSpeedSlider
              className="explorer-desktop-speed-slider"
              value={explorerPlaybackSpeed}
              onChange={changeExplorerPlaybackSpeed}
              label="Explorer playback speed"
            />
            {selectedSatelliteAvailable && (
              <button
                aria-pressed={scenario.cameraSettings.followSelectedObject}
                className={scenario.cameraSettings.followSelectedObject ? "active follow-active" : ""}
                type="button"
                onClick={() => {
                  const next = !scenario.cameraSettings.followSelectedObject;
                  setFollowSelectedObject(next);
                  if (next && !explorerPlaybackRunning) {
                    changeExplorerPlaybackSpeed(followExplorerSpeed);
                    setExplorerPlaybackRunning(true);
                    setPlaying(true);
                    setTimeScale(followExplorerSpeed);
                  }
                }}
              >
                <Eye size={13} />
                {scenario.cameraSettings.followSelectedObject ? "Following" : "Follow Sat"}
              </button>
            )}
          </div>
        </div>
        <AppErrorBoundary
          variant="renderer"
          fallbackTitle="Explorer globe failed to start"
          fallbackMessage="The catalog is available, but the shared Earth renderer failed to initialize."
        >
          <SimulationScene
            earthVisualPreset="orbit-focus"
            explorerSelectedOrbitVisible={sceneVisibility.selectedOrbitVisible}
            explorerVisibleGroundStationIds={explorerVisibleGroundStationIds}
            explorerVisibleSatelliteIds={resolvedVisibility.satelliteIds}
            explorerAnimate={explorerAnimate && isPlaying}
            explorerFocusPreset={focusPreset}
            explorerFocusRequestKey={focusRequestKey}
            explorerMarkerStyles={markerStyles}
            explorerColorMode={colorMode}
            orbitAwareFraming
            scaleCatalogRendering
            representativeOrbitConstellationIds={
              resolvedVisibility.representativeOrbitConstellationIds
            }
            shellConstellationIds={resolvedVisibility.shellConstellationIds}
            auroraModeEnabled={auroraModeEnabled}
            selectedArchitectureConstellationId={
              scenario.selectedObjectType === "constellation" &&
              scenario.selectedObjectId &&
              resolvedVisibility.visibleObjectIds.has(scenario.selectedObjectId)
                ? scenario.selectedObjectId
                : null
            }
            showStarField={starFieldVisible}
            showVisualContextLegend={false}
            onClearSelection={clearExplorerSelection}
          />
        </AppErrorBoundary>
        {historicalCatalogOnly && (
          <div className="explorer-historical-data-notice" role="status" aria-live="polite">
            <strong>Historical positions unavailable</strong>
            <span>
              No loaded orbit records match {historicalCatalogDate}; catalog membership is shown without positions.
            </span>
          </div>
        )}
      </section>

      <ExplorerInspector
        activeSnapshot={activeSnapshot}
        filterConflictMessage={selectedFilterConflictMessage}
        onClearSelection={closeExplorerDetails}
        onResolveFilterConflict={resolveSelectedFilterConflict}
      />
      <ExplorerTimeline
        activeSnapshot={activeSnapshot}
        onSelectSnapshot={selectExplorerTimelineSnapshot}
        explorerPlaybackRunning={explorerPlaybackRunning}
        explorerPlaybackSpeed={explorerPlaybackSpeed}
        onChangePlaybackSpeed={changeExplorerPlaybackSpeed}
        onTogglePlayback={toggleExplorerPlayback}
        visibleCatalogObjectCount={loadedCatalogObjectCount}
        visibleRenderableOrbitStateCount={loadedRenderableOrbitStateCount}
      />
      {!interfaceVisible && <ShowInterfaceButton onShow={onShowInterface} />}
    </main>
  );
}
