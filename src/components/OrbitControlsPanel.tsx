import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Palette,
  Orbit,
  Pause,
  Play,
  Plus,
  Route,
  Satellite as SatelliteIcon,
  StepBack,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useMobileSheetDrag } from "../lib/useMobileSheetDrag";
import { MissionPlannerSection } from "./MissionPlannerSection";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "../lib/format";
import { useSimulationStore } from "../state/useSimulationStore";
import { useSidebarScenario } from "../state/scenarioSubscriptions";

interface OrbitControlsPanelProps {
  onOpenExplorer: () => void;
  onMobileClose?: () => void;
}

const timeScales = [1, 10, 100, 1000, 2500];
const ALTITUDE_SLIDER_MIN_KM = 120;
const ALTITUDE_SLIDER_MAX_KM = 36000;
const ECCENTRICITY_SLIDER_MAX = 0.85;

function altitudeMessage(value: number): string | null {
  if (!Number.isFinite(value)) return "Required";
  return value > 120 ? null : "Use an altitude above 120 km";
}

function eccentricityMessage(value: number): string | null {
  if (!Number.isFinite(value)) return "Required";
  return value >= 0 && value < 1 ? null : "Use 0 to 0.999";
}

function inclinationMessage(value: number): string | null {
  if (!Number.isFinite(value)) return "Required";
  return value >= 0 && value <= 180 ? null : "Use 0 to 180 deg";
}

function angleMessage(value: number): string | null {
  if (!Number.isFinite(value)) return "Required";
  return value >= 0 && value <= 360 ? null : "Use 0 to 360 deg";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
}

function formatSliderValue(value: number, precision: number, unit?: string): string {
  if (!Number.isFinite(value)) return "--";
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
  });

  return unit ? `${formatted} ${unit}` : formatted;
}

function ControlSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="orbit-control-section">
      <h3>{label}</h3>
      <div className="orbit-section-fields">{children}</div>
    </section>
  );
}

function OrbitSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  precision,
  invalidMessage,
  onChange,
  onInteractionChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  precision: number;
  invalidMessage?: string | null;
  onChange: (value: number) => void;
  onInteractionChange?: (active: boolean) => void;
}) {
  const sliderValue = Number.isFinite(value) ? clamp(value, min, max) : min;

  return (
    <label
      className={`orbit-slider-control ${invalidMessage ? "field-invalid" : ""}`}
      onPointerEnter={() => onInteractionChange?.(true)}
      onPointerLeave={() => onInteractionChange?.(false)}
    >
      <span className="orbit-slider-label">
        <span>{label}</span>
        <output>{formatSliderValue(value, precision, unit)}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onFocus={() => onInteractionChange?.(true)}
        onBlur={() => onInteractionChange?.(false)}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
      <input
        aria-label={`${label} value`}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onFocus={() => onInteractionChange?.(true)}
        onBlur={() => onInteractionChange?.(false)}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
      {invalidMessage && <span className="field-error">{invalidMessage}</span>}
    </label>
  );
}

export function OrbitControlsPanel({
  onOpenExplorer: _onOpenExplorer,
  onMobileClose,
}: OrbitControlsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const mobileSheetDrag = useMobileSheetDrag(() => onMobileClose?.());
  const [selectorOpen, setSelectorOpen] = useState(false);
  const scenario = useSidebarScenario();
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const isPlaying = useSimulationStore((state) => state.isPlaying);
  const timeScale = useSimulationStore((state) => state.scenario.timeScale);
  const isReverse = useSimulationStore((state) => state.scenario.isReverse);
  const addSatellite = useSimulationStore((state) => state.addSatellite);
  const selectSatellite = useSimulationStore((state) => state.selectSatellite);
  const setPlaying = useSimulationStore((state) => state.setPlaying);
  const setTimeScale = useSimulationStore((state) => state.setTimeScale);
  const setReverse = useSimulationStore((state) => state.setReverse);
  const setEducationalOverlay = useSimulationStore((state) => state.setEducationalOverlay);
  const updateSatelliteVisualization = useSimulationStore(
    (state) => state.updateSatelliteVisualization,
  );
  const updateKeplerian = useSimulationStore((state) => state.updateKeplerian);

  const satellite =
    scenario.satellites.find((item) => item.id === selectedSatelliteId) ??
    scenario.satellites[0];

  if (!satellite) {
    return (
      <section className="orbit-controls-panel compact" aria-label="Orbit controls">
        <button className="add-satellite-button" type="button" onClick={addSatellite}>
          <Plus size={17} />
          <span>Add Satellite</span>
        </button>
      </section>
    );
  }

  const altitudeKm = satellite.keplerian.semiMajorAxisKm - EARTH_RADIUS_KM;
  const altitudeSliderMax = Math.max(
    ALTITUDE_SLIDER_MAX_KM,
    Math.ceil((altitudeKm + 1000) / 1000) * 1000,
  );
  const eccentricitySliderMax = Math.min(
    0.999,
    Math.max(ECCENTRICITY_SLIDER_MAX, Math.ceil((satellite.keplerian.eccentricity + 0.02) * 100) / 100),
  );
  const explain = (overlay: Parameters<typeof setEducationalOverlay>[0]) =>
    (active: boolean) => setEducationalOverlay(active ? overlay : "none");

  return (
    <section
      className={`orbit-controls-panel ${collapsed ? "collapsed" : ""}`}
      aria-label="Orbit controls"
      style={mobileSheetDrag.sheetStyle}
    >
      <div className="orbit-controls-heading">
        <button
          aria-label="Close orbit controls"
          className="explorer-mobile-sheet-handle playground-mobile-sheet-handle"
          title="Close orbit controls. Drag down or tap to close."
          type="button"
          {...mobileSheetDrag.dragHandleProps}
          onClick={() => onMobileClose?.()}
        >
          <span aria-hidden="true" />
        </button>
        <div>
          <span>Orbit controls</span>
          <strong>{satellite.name}</strong>
        </div>
        <button
          aria-expanded={!collapsed}
          className="icon-button playground-panel-toggle playground-panel-toggle-right"
          type="button"
          title={collapsed ? "Expand orbit controls" : "Collapse orbit controls"}
          onClick={() => {
            if (onMobileClose && isMobileViewport()) {
              onMobileClose();
              return;
            }

            setCollapsed(!collapsed);
          }}
        >
          <Orbit size={18} />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="playground-satellite-selector-row">
            <button
              className="playground-satellite-selector"
              type="button"
              aria-expanded={selectorOpen}
              onClick={() => setSelectorOpen((open) => !open)}
            >
              <SatelliteIcon size={15} />
              <span><small>Selected satellite</small><strong>{satellite.name}</strong></span>
              <ChevronDown size={14} />
            </button>
            <button className="playground-inline-add" type="button" onClick={addSatellite}>
              <Plus size={15} /><span>Add Satellite</span>
            </button>
            {selectorOpen && (
              <div className="playground-satellite-selector-menu" role="listbox">
                {scenario.satellites.map((item) => (
                  <button
                    className={item.id === satellite.id ? "active" : ""}
                    key={item.id}
                    role="option"
                    aria-selected={item.id === satellite.id}
                    type="button"
                    onClick={() => { selectSatellite(item.id); setSelectorOpen(false); }}
                  >
                    <i style={{ background: item.visualization.color }} />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <ControlSection label="Shape">
            <OrbitSlider
              label="Altitude"
              unit="km"
              value={altitudeKm}
              step={10}
              min={ALTITUDE_SLIDER_MIN_KM}
              max={altitudeSliderMax}
              precision={0}
              invalidMessage={altitudeMessage(altitudeKm)}
              onInteractionChange={explain("altitude")}
              onChange={(value) =>
                updateKeplerian(satellite.id, {
                  semiMajorAxisKm: EARTH_RADIUS_KM + value,
                })
              }
            />
            <OrbitSlider
              label="Eccentricity"
              value={satellite.keplerian.eccentricity}
              step={0.001}
              min={0}
              max={eccentricitySliderMax}
              precision={3}
              invalidMessage={eccentricityMessage(satellite.keplerian.eccentricity)}
              onInteractionChange={explain("eccentricity")}
              onChange={(value) => updateKeplerian(satellite.id, { eccentricity: value })}
            />
          </ControlSection>
          <ControlSection label="Orientation">
            <OrbitSlider
              label="Inclination"
              unit="deg"
              value={satellite.keplerian.inclinationDeg}
              step={0.1}
              min={0}
              max={180}
              precision={1}
              invalidMessage={inclinationMessage(satellite.keplerian.inclinationDeg)}
              onInteractionChange={explain("inclination")}
              onChange={(value) => updateKeplerian(satellite.id, { inclinationDeg: value })}
            />
            <OrbitSlider
              label="RAAN"
              unit="deg"
              value={satellite.keplerian.raanDeg}
              step={0.1}
              min={0}
              max={360}
              precision={1}
              invalidMessage={angleMessage(satellite.keplerian.raanDeg)}
              onInteractionChange={explain("raan")}
              onChange={(value) => updateKeplerian(satellite.id, { raanDeg: value })}
            />
            <OrbitSlider
              label="Argument of Periapsis"
              unit="deg"
              value={satellite.keplerian.argumentOfPeriapsisDeg}
              step={0.1}
              min={0}
              max={360}
              precision={1}
              invalidMessage={angleMessage(satellite.keplerian.argumentOfPeriapsisDeg)}
              onInteractionChange={explain("argument-of-periapsis")}
              onChange={(value) =>
                updateKeplerian(satellite.id, { argumentOfPeriapsisDeg: value })
              }
            />
          </ControlSection>
          <ControlSection label="Position">
            <OrbitSlider
              label="True Anomaly"
              unit="deg"
              value={satellite.keplerian.trueAnomalyDeg}
              step={0.1}
              min={0}
              max={360}
              precision={1}
              invalidMessage={angleMessage(satellite.keplerian.trueAnomalyDeg)}
              onInteractionChange={explain("true-anomaly")}
              onChange={(value) => updateKeplerian(satellite.id, { trueAnomalyDeg: value })}
            />
          </ControlSection>

          {/* Mission design: the same orbit expressed as somewhere to go, and
              what it costs to get there. */}
          <ControlSection label="Mission">
            <MissionPlannerSection
              currentAltitudeKm={altitudeKm}
              currentInclinationDeg={satellite.keplerian.inclinationDeg}
              onApply={(targetAltitudeKm, targetInclinationDeg) =>
                updateKeplerian(satellite.id, {
                  semiMajorAxisKm: EARTH_RADIUS_KM + targetAltitudeKm,
                  eccentricity: 0,
                  inclinationDeg: targetInclinationDeg,
                })
              }
            />
          </ControlSection>

          <ControlSection label="Appearance">
            <div className="appearance-property-group">
              <label className="orbit-color-control" title="Color">
                <span>
                  <Palette size={14} />
                  Color
                </span>
                <input
                  aria-label="Color"
                  type="color"
                  value={satellite.visualization.color}
                  onChange={(event) =>
                    updateSatelliteVisualization(satellite.id, { color: event.target.value })
                  }
                />
              </label>
              <button
                className={`appearance-toggle ${satellite.visualization.showTrail ? "active" : ""}`}
                type="button"
                aria-pressed={satellite.visualization.showTrail}
                onClick={() =>
                  updateSatelliteVisualization(satellite.id, {
                    showTrail: !satellite.visualization.showTrail,
                  })
                }
              >
                {satellite.visualization.showTrail ? <Eye size={15} /> : <EyeOff size={15} />}
                <span>Trail</span>
              </button>
              <button
                className={`appearance-toggle ${satellite.visualization.showGroundTrack ? "active" : ""}`}
                type="button"
                aria-pressed={satellite.visualization.showGroundTrack}
                onClick={() =>
                  updateSatelliteVisualization(satellite.id, {
                    showGroundTrack: !satellite.visualization.showGroundTrack,
                  })
                }
              >
                <Route size={15} />
                <span>Ground track</span>
              </button>
            </div>
          </ControlSection>

          <ControlSection label="Playback">
            <div className="playground-playback wide-field" aria-label="Playback controls">
              <button
                className="playback-toggle"
                type="button"
                onClick={() => setPlaying(!isPlaying)}
              >
                {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                <span>{isPlaying ? "Pause" : "Play"}</span>
              </button>
              <button
                className={isReverse ? "active" : ""}
                type="button"
                onClick={() => setReverse(!isReverse)}
              >
                <StepBack size={15} />
                <span>Reverse</span>
              </button>
            </div>
            <div className="playground-speed-presets wide-field" aria-label="Playback speed">
              {timeScales.map((scale) => (
                <button
                  className={timeScale === scale ? "active" : ""}
                  key={scale}
                  type="button"
                  onClick={() => setTimeScale(scale)}
                >{scale.toLocaleString()}×</button>
              ))}
            </div>
          </ControlSection>
        </>
      )}
    </section>
  );
}
