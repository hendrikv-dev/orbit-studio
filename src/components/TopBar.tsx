import { useRef } from "react";
import {
  Camera,
  BookOpen,
  Compass,
  Download,
  Eye,
  EyeOff,
  Focus,
  Globe2,
  GraduationCap,
  Import,
  Map,
  Moon,
  Navigation,
  Orbit,
  Radar,
  RadioTower,
  Settings,
  Shapes,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import type { CameraMode, QualityLevel, ViewPreset } from "../lib/scenario";
import type { CoverageMode, LabelMode } from "../state/useSimulationStore";
import { useSimulationStore } from "../state/useSimulationStore";

const viewPresets: Array<{ id: ViewPreset; label: string; icon: typeof Globe2 }> = [
  { id: "free", label: "Free", icon: Navigation },
  { id: "equatorial", label: "Equatorial", icon: Globe2 },
  { id: "polar", label: "Polar", icon: Radar },
  { id: "follow", label: "Follow", icon: Eye },
  { id: "ground-track", label: "Ground", icon: Moon },
];

const cameraModes: Array<{ id: CameraMode; label: string; icon: typeof Globe2; title: string }> = [
  { id: "free", label: "Free", icon: Camera, title: "Free camera mode" },
  { id: "follow-satellite", label: "Follow Sat", icon: Eye, title: "Follow satellite camera mode" },
  { id: "earth-fixed", label: "Earth Fixed", icon: Globe2, title: "Earth-fixed camera mode" },
  { id: "inertial", label: "Inertial", icon: Orbit, title: "Inertial camera mode" },
  {
    id: "ground-station",
    label: "Station",
    icon: RadioTower,
    title: "Ground station camera placeholder",
  },
];

function scenarioFilename(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "orbit-studio-scenario"}.json`;
}

interface TopBarProps {
  readOnly?: boolean;
  onOpenExplorer?: () => void;
  onOpenLibrary?: () => void;
  onReturnToGuided?: () => void;
}

export function TopBar({
  readOnly = false,
  onOpenExplorer,
  onOpenLibrary,
  onReturnToGuided,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scenario = useSimulationStore((state) => state.scenario);
  const importError = useSimulationStore((state) => state.importError);
  const setScenarioName = useSimulationStore((state) => state.setScenarioName);
  const setViewPreset = useSimulationStore((state) => state.setViewPreset);
  const setCameraMode = useSimulationStore((state) => state.setCameraMode);
  const setFollowSelectedObject = useSimulationStore((state) => state.setFollowSelectedObject);
  const setRenderSetting = useSimulationStore((state) => state.setRenderSetting);
  const setCoverageSetting = useSimulationStore((state) => state.setCoverageSetting);
  const setCoverageMode = useSimulationStore((state) => state.setCoverageMode);
  const setLabelMode = useSimulationStore((state) => state.setLabelMode);
  const setVisibilityFilter = useSimulationStore((state) => state.setVisibilityFilter);
  const setTeacherMode = useSimulationStore((state) => state.setTeacherMode);
  const setFocusMode = useSimulationStore((state) => state.setFocusMode);
  const workspace = useSimulationStore((state) => state.workspace);
  const loadScenarioJson = useSimulationStore((state) => state.loadScenarioJson);
  const clearImportError = useSimulationStore((state) => state.clearImportError);

  const exportScenario = () => {
    const payload = JSON.stringify(
      {
        ...scenario,
        productName: "Orbit Studio",
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = scenarioFilename(scenario.name);
    link.click();
    URL.revokeObjectURL(url);
  };

  const importScenario = async (file?: File) => {
    if (!file) {
      return;
    }

    loadScenarioJson(await file.text());
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <header className={`top-bar ${readOnly ? "read-only-top-bar" : ""}`}>
      <div className="brand-block">
        <div className="brand-mark">O</div>
        <div>
          <strong>Orbit Studio</strong>
          <span className="brand-subtitle">Playground · experiment and modify orbits</span>
          <input
            aria-label="Scenario name"
            readOnly={readOnly}
            value={scenario.name}
            onChange={(event) => setScenarioName(event.target.value)}
          />
        </div>
      </div>

      <div className="camera-control-cluster">
        <nav className="camera-mode-group" aria-label="Camera mode">
          {cameraModes.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                className={scenario.cameraSettings.cameraMode === mode.id ? "active" : ""}
                key={mode.id}
                type="button"
                title={mode.title}
                onClick={() => setCameraMode(mode.id)}
              >
                <Icon size={15} />
                <span>{mode.label}</span>
              </button>
            );
          })}
        </nav>

        <details className="toolbar-menu">
          <summary title="View and overlay options">
            <SlidersHorizontal size={15} />
            <span>View</span>
          </summary>
          <div className="toolbar-menu-panel">
            {!scenario.teacherMode && (
              <div className="menu-section">
                <span className="menu-section-label">Camera Presets</span>
                <nav className="preset-group" aria-label="Camera presets">
                  {viewPresets.map((preset) => {
                    const Icon = preset.icon;
                    return (
                      <button
                        className={scenario.cameraSettings.viewPreset === preset.id ? "active" : ""}
                        key={preset.id}
                        type="button"
                        title={`${preset.label} view`}
                        onClick={() => setViewPreset(preset.id)}
                      >
                        <Icon size={15} />
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            )}

            <div className="menu-section">
              <span className="menu-section-label">Viewport</span>
              <button
                className={`follow-toggle ${
                  scenario.cameraSettings.followSelectedObject ? "active" : ""
                }`}
                type="button"
                title="Camera follows selected satellite"
                onClick={() =>
                  setFollowSelectedObject(!scenario.cameraSettings.followSelectedObject)
                }
              >
                {scenario.cameraSettings.followSelectedObject ? (
                  <Eye size={15} />
                ) : (
                  <EyeOff size={15} />
                )}
                <span>
                  Follow {scenario.cameraSettings.followSelectedObject ? "On" : "Off"}
                </span>
              </button>
              <button
                className={workspace.visibilityFilters.selectedOnly ? "active" : ""}
                type="button"
                title="Show selected object only"
                onClick={() =>
                  setVisibilityFilter("selectedOnly", !workspace.visibilityFilters.selectedOnly)
                }
              >
                <Eye size={15} />
                <span>Selected Only</span>
              </button>
              <button
                className={scenario.teacherMode ? "active" : ""}
                type="button"
                title="Teacher Mode"
                onClick={() => setTeacherMode(!scenario.teacherMode)}
              >
                <GraduationCap size={15} />
                <span>Teacher</span>
              </button>
            </div>

            {!scenario.teacherMode && (
              <div className="menu-section">
                <span className="menu-section-label">Reference Grids</span>
                <div className="grid-toggle-group" aria-label="Reference grid toggles">
                  <button
                    className={scenario.renderSettings.showLatLonGrid ? "active" : ""}
                    type="button"
                    title="Latitude and longitude grid"
                    onClick={() =>
                      setRenderSetting("showLatLonGrid", !scenario.renderSettings.showLatLonGrid)
                    }
                  >
                    <Globe2 size={15} />
                    <span>Lat/Lon</span>
                  </button>
                  <button
                    className={scenario.renderSettings.showEciGrid ? "active" : ""}
                    type="button"
                    title="ECI reference grid"
                    onClick={() =>
                      setRenderSetting("showEciGrid", !scenario.renderSettings.showEciGrid)
                    }
                  >
                    <Orbit size={15} />
                    <span>ECI</span>
                  </button>
                  <button
                    className={scenario.renderSettings.showEcefGrid ? "active" : ""}
                    type="button"
                    title="ECEF reference grid"
                    onClick={() =>
                      setRenderSetting("showEcefGrid", !scenario.renderSettings.showEcefGrid)
                    }
                  >
                    <Map size={15} />
                    <span>ECEF</span>
                  </button>
                </div>
              </div>
            )}

            <div className="menu-section">
              <span className="menu-section-label">Analysis</span>
              <button
                className={scenario.coverageSettings.enabled ? "active" : ""}
                type="button"
                title="Coverage layer"
                onClick={() => {
                  const nextEnabled = !scenario.coverageSettings.enabled;
                  setCoverageSetting("enabled", nextEnabled);
                  setRenderSetting("showCoverageLayer", nextEnabled);
                }}
              >
                <Shapes size={15} />
                <span>Coverage</span>
              </button>
              <label className="mode-select overlay-select" title="Coverage mode">
                <Shapes size={15} />
                <select
                  value={workspace.coverageMode}
                  onChange={(event) => setCoverageMode(event.target.value as CoverageMode)}
                >
                  <option value="satellite">Satellite Coverage</option>
                  <option value="constellation">Constellation Coverage</option>
                  <option value="ground-station">Ground Station Coverage</option>
                  <option value="combined">Combined Coverage</option>
                </select>
              </label>
              <label className="mode-select label-select" title="Label mode">
                <SlidersHorizontal size={15} />
                <select
                  value={workspace.labelMode}
                  onChange={(event) => setLabelMode(event.target.value as LabelMode)}
                >
                  <option value="priority">Priority Labels</option>
                  <option value="selected">Selected Only</option>
                  <option value="all">All Labels</option>
                  <option value="hidden">Labels Hidden</option>
                </select>
              </label>
              <button
                className={
                  scenario.renderSettings.showStarOcclusionDiagnostics ? "active" : ""
                }
                type="button"
                title="Show Star Occlusion Diagnostics"
                onClick={() =>
                  setRenderSetting(
                    "showStarOcclusionDiagnostics",
                    !scenario.renderSettings.showStarOcclusionDiagnostics,
                  )
                }
              >
                <Eye size={15} />
                <span>Show Star Occlusion Diagnostics</span>
              </button>
              <button
                className={scenario.renderSettings.showGeoValidationOverlay ? "active" : ""}
                type="button"
                title="Show known-city and DSN geospatial validation markers"
                onClick={() =>
                  setRenderSetting(
                    "showGeoValidationOverlay",
                    !scenario.renderSettings.showGeoValidationOverlay,
                  )
                }
              >
                <Map size={15} />
                <span>Geo Validation</span>
              </button>
            </div>
          </div>
        </details>
      </div>

      <div className="top-actions">
        {onOpenExplorer && (
          <button type="button" title="Open Explorer" onClick={onOpenExplorer}>
            <Compass size={15} />
            <span>Explorer</span>
          </button>
        )}
        {onReturnToGuided && (
          <button type="button" title="Return to Guided Mode" onClick={onReturnToGuided}>
            <Compass size={15} />
            <span>Guided</span>
          </button>
        )}
        {onOpenLibrary && (
          <button type="button" title="Open Library" onClick={onOpenLibrary}>
            <BookOpen size={15} />
            <span>Library</span>
          </button>
        )}
        <button
          className={workspace.focusMode ? "active" : ""}
          type="button"
          title="Viewport Focus Mode"
          onClick={() => setFocusMode(!workspace.focusMode)}
        >
          <Focus size={15} />
          <span>Focus</span>
        </button>
        <label className="quality-select" title="Quality">
          <Settings size={15} />
          <select
            value={scenario.renderSettings.quality}
            onChange={(event) =>
              setRenderSetting("quality", event.target.value as QualityLevel)
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        {!readOnly && (
          <>
            <button
              type="button"
              title="Import scenario"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={15} />
              <span>Import</span>
            </button>
            <button type="button" title="Export scenario" onClick={exportScenario}>
              <Download size={15} />
              <span>Export</span>
            </button>
            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importScenario(event.currentTarget.files?.[0])}
            />
          </>
        )}
      </div>

      {importError && (
        <button className="import-error" type="button" onClick={clearImportError}>
          <Import size={14} />
          {importError}
        </button>
      )}
    </header>
  );
}
