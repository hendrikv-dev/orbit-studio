import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleDot,
  Database,
  Eye,
  EyeOff,
  Layers3,
  Map,
  MapPin,
  Orbit,
  Palette,
  PanelRightOpen,
  RadioTower,
  Scan,
  Shapes,
} from "lucide-react";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { computeGroundContact } from "../physics/coverage";
import {
  computeNextRegionVisibility,
  computeRegionCoverage,
  targetSetForCoverage,
} from "../physics/regionCoverage";
import { isValidCartesian, isValidKeplerian } from "../physics/kepler";
import { validateTle } from "../physics/tle";
import {
  formatNumber,
  formatSignedNumber,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "../lib/format";
import { getSatelliteReadouts, propagateSatellite } from "../lib/propagation";
import type {
  CatalogObjectModel,
  ConstellationModel,
  EditorMode,
  PropagationMode,
  RegionModel,
  Scenario,
} from "../lib/scenario";
import { useSimulationStore } from "../state/useSimulationStore";
import { NumberField } from "./NumberField";

const editorModes: Array<{ id: EditorMode; label: string }> = [
  { id: "keplerian", label: "Keplerian" },
  { id: "cartesian", label: "Cartesian" },
  { id: "tle", label: "TLE" },
  { id: "visualization", label: "Visual" },
];
const INSPECTOR_TIME_REFRESH_MS = 500;

function isTimeOnlyScenarioUpdate(next: Scenario, previous: Scenario): boolean {
  return (
    next.simulationTimeUtc !== previous.simulationTimeUtc &&
    next.appVersion === previous.appVersion &&
    next.name === previous.name &&
    next.simulationEpoch === previous.simulationEpoch &&
    next.timeScale === previous.timeScale &&
    next.isReverse === previous.isReverse &&
    next.renderSettings === previous.renderSettings &&
    next.cameraSettings === previous.cameraSettings &&
    next.teacherMode === previous.teacherMode &&
    next.coverageSettings === previous.coverageSettings &&
    next.selectedObjectType === previous.selectedObjectType &&
    next.selectedObjectId === previous.selectedObjectId &&
    next.satellites === previous.satellites &&
    next.constellations === previous.constellations &&
    next.groundStations === previous.groundStations &&
    next.regions === previous.regions &&
    next.catalogLayers === previous.catalogLayers
  );
}

function useInspectorScenario(): Scenario {
  const [scenario, setScenario] = useState(() => useSimulationStore.getState().scenario);
  const pendingScenarioRef = useRef<Scenario | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () =>
      useSimulationStore.subscribe((state, previousState) => {
        const nextScenario = state.scenario;
        const previousScenario = previousState.scenario;

        if (nextScenario === previousScenario) {
          return;
        }

        if (!isTimeOnlyScenarioUpdate(nextScenario, previousScenario)) {
          if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          pendingScenarioRef.current = null;
          setScenario(nextScenario);
          return;
        }

        pendingScenarioRef.current = nextScenario;
        if (timerRef.current !== null) {
          return;
        }

        timerRef.current = window.setTimeout(() => {
          if (pendingScenarioRef.current) {
            setScenario(pendingScenarioRef.current);
          }
          pendingScenarioRef.current = null;
          timerRef.current = null;
        }, INSPECTOR_TIME_REFRESH_MS);
      }),
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return scenario;
}

function semiMajorAxisMessage(value: number): string | null {
  if (!Number.isFinite(value)) return "Required";
  return value > EARTH_RADIUS_KM ? null : `Must exceed ${EARTH_RADIUS_KM.toFixed(0)} km`;
}

function eccentricityMessage(value: number): string | null {
  if (!Number.isFinite(value)) return "Required";
  return value >= 0 && value < 1 ? null : "Use 0 <= e < 1";
}

function inclinationMessage(value: number): string | null {
  if (!Number.isFinite(value)) return "Required";
  return value >= 0 && value <= 180 ? null : "Use 0-180 deg";
}

function finiteMessage(value: number): string | null {
  return Number.isFinite(value) ? null : "Required";
}

function propagationLabel(mode: PropagationMode): string {
  if (mode === "sgp4") return "SGP4 / TLE";
  if (mode === "advanced") return "Advanced";
  return "Two-body";
}

function selectedCatalogObject(
  objects: CatalogObjectModel[],
  selectedObjectId: string | null,
): CatalogObjectModel | undefined {
  return objects.find((object) => object.id === selectedObjectId);
}

function selectedRegion(
  regions: RegionModel[],
  selectedObjectId: string | null,
): RegionModel | undefined {
  return regions.find((region) => region.id === selectedObjectId);
}

function selectedConstellation(
  constellations: ConstellationModel[],
  selectedObjectId: string | null,
): ConstellationModel | undefined {
  return constellations.find((constellation) => constellation.id === selectedObjectId);
}

function RightPanelCollapseButton() {
  const setPanelCollapsed = useSimulationStore((state) => state.setPanelCollapsed);

  return (
    <button
      className="panel-collapse-button right"
      type="button"
      title="Collapse details panel"
      onClick={() => setPanelCollapsed("right", true)}
    >
      <PanelRightOpen size={15} />
    </button>
  );
}

interface SatelliteEditorProps {
  readOnly?: boolean;
}

export function SatelliteEditor({ readOnly = false }: SatelliteEditorProps) {
  const scenario = useInspectorScenario();
  const workspace = useSimulationStore((state) => state.workspace);
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const selectedGroundStationId = useSimulationStore((state) => state.selectedGroundStationId);
  const selectedRegionId = useSimulationStore((state) => state.selectedRegionId);
  const updateSatelliteName = useSimulationStore((state) => state.updateSatelliteName);
  const updateSatelliteVisualization = useSimulationStore(
    (state) => state.updateSatelliteVisualization,
  );
  const updateSatelliteSensor = useSimulationStore((state) => state.updateSatelliteSensor);
  const setEditorMode = useSimulationStore((state) => state.setEditorMode);
  const setPropagationMode = useSimulationStore((state) => state.setPropagationMode);
  const updateKeplerian = useSimulationStore((state) => state.updateKeplerian);
  const updateCartesianVector = useSimulationStore((state) => state.updateCartesianVector);
  const updateCartesianEpoch = useSimulationStore((state) => state.updateCartesianEpoch);
  const updateTle = useSimulationStore((state) => state.updateTle);
  const updateGroundStation = useSimulationStore((state) => state.updateGroundStation);
  const updateRegion = useSimulationStore((state) => state.updateRegion);
  const updateConstellation = useSimulationStore((state) => state.updateConstellation);
  const setCoverageSetting = useSimulationStore((state) => state.setCoverageSetting);
  const setPanelCollapsed = useSimulationStore((state) => state.setPanelCollapsed);
  const lastOrbitExplanation = useSimulationStore((state) => state.lastOrbitExplanation);

  const selectedSatellite = scenario.satellites.find((item) => item.id === selectedSatelliteId);
  const selectedGroundStation = scenario.groundStations.find(
    (item) => item.id === selectedGroundStationId,
  );
  const activeRegion =
    scenario.selectedObjectType === "region"
      ? selectedRegion(scenario.regions, scenario.selectedObjectId) ??
        scenario.regions.find((region) => region.id === selectedRegionId)
      : scenario.regions.find((region) => region.id === selectedRegionId);
  const activeConstellation =
    scenario.selectedObjectType === "constellation"
      ? selectedConstellation(scenario.constellations, scenario.selectedObjectId)
      : undefined;
  const catalogObject = selectedCatalogObject(
    scenario.catalogLayers.flatMap((layer) => layer.objects),
    scenario.selectedObjectId,
  );
  const satellite =
    scenario.selectedObjectType === "satellite"
      ? scenario.satellites.find((item) => item.id === scenario.selectedObjectId) ?? selectedSatellite
      : selectedSatellite;
  const station =
    scenario.selectedObjectType === "ground-station"
      ? scenario.groundStations.find((item) => item.id === scenario.selectedObjectId) ??
        selectedGroundStation
      : selectedGroundStation;

  const readouts = useMemo(() => {
    if (!satellite) return null;
    try {
      return getSatelliteReadouts(satellite, new Date(scenario.simulationTimeUtc));
    } catch {
      return null;
    }
  }, [satellite, scenario.simulationTimeUtc]);

  const contact = useMemo(() => {
    if (!satellite || !station) return null;
    try {
      const date = new Date(scenario.simulationTimeUtc);
      return computeGroundContact(propagateSatellite(satellite, date), station, date);
    } catch {
      return null;
    }
  }, [satellite, station, scenario.simulationTimeUtc]);

  const coverageRows = useMemo(() => {
    const date = new Date(scenario.simulationTimeUtc);
    const targetConstellation = scenario.constellations.find(
      (constellation) => constellation.id === scenario.coverageSettings.targetId,
    );
    const target = targetSetForCoverage(
      scenario.coverageSettings,
      scenario.satellites,
      scenario.groundStations,
      targetConstellation?.satelliteIds ?? [],
    );

    return scenario.regions
      .filter((region) => region.visible)
      .map((region) => {
        const current = computeRegionCoverage(region, target, scenario.coverageSettings, date);
        return {
          region,
          ...current,
          nextVisibilityTime: computeNextRegionVisibility(
            region,
            target,
            scenario.coverageSettings,
            date,
          ),
        };
      })
      .sort((a, b) => b.coveredPercent - a.coveredPercent);
  }, [scenario]);

  const coverageTimeline = useMemo(() => {
    const targetConstellation = scenario.constellations.find(
      (constellation) => constellation.id === scenario.coverageSettings.targetId,
    );
    const target = targetSetForCoverage(
      scenario.coverageSettings,
      scenario.satellites,
      scenario.groundStations,
      targetConstellation?.satelliteIds ?? [],
    );
    const samples = [
      { label: "Now", minutes: 0 },
      { label: "Next Hour", minutes: 60 },
      { label: "Next Day", minutes: 1440 },
    ];

    return samples.map((sample) => {
      const date = new Date(
        new Date(scenario.simulationTimeUtc).getTime() + sample.minutes * 60000,
      );
      const coverages = scenario.regions
        .filter((region) => region.visible)
        .map((region) =>
          computeRegionCoverage(region, target, scenario.coverageSettings, date).coveredPercent,
        );
      const average =
        coverages.length > 0
          ? coverages.reduce((total, value) => total + value, 0) / coverages.length
          : 0;

      return {
        ...sample,
        value: average,
      };
    });
  }, [scenario]);

  const selectedRegionAssets = useMemo(() => {
    if (!activeRegion) {
      return [];
    }

    const date = new Date(scenario.simulationTimeUtc);
    const satelliteAssets = scenario.satellites
      .map((asset) => ({
        name: asset.name,
        kind: "satellite" as const,
        covered: computeRegionCoverage(
          activeRegion,
          { satellites: [asset], groundStations: [] },
          {
            ...scenario.coverageSettings,
            enabled: true,
            targetType: "satellite",
            targetId: asset.id,
          },
          date,
        ).coveredPercent,
      }))
      .filter((asset) => asset.covered > 0);
    const stationAssets = scenario.groundStations
      .map((asset) => ({
        name: asset.name,
        kind: "station" as const,
        covered: computeRegionCoverage(
          activeRegion,
          { satellites: [], groundStations: [asset] },
          {
            ...scenario.coverageSettings,
            enabled: true,
            targetType: "ground-station",
            targetId: asset.id,
          },
          date,
        ).coveredPercent,
      }))
      .filter((asset) => asset.covered > 0);

    return [...satelliteAssets, ...stationAssets]
      .sort((a, b) => b.covered - a.covered)
      .slice(0, 5);
  }, [activeRegion, scenario]);

  const selectedRegionCoverage = activeRegion
    ? coverageRows.find((row) => row.region.id === activeRegion.id)
    : undefined;
  const coverageTrend =
    coverageTimeline[1] && coverageTimeline[0]
      ? coverageTimeline[1].value > coverageTimeline[0].value + 1
        ? "Increasing"
        : coverageTimeline[1].value < coverageTimeline[0].value - 1
          ? "Decreasing"
          : "Stable"
      : "Stable";

  const coverageTargetLabel =
    scenario.coverageSettings.targetType === "constellation"
      ? scenario.constellations.find((item) => item.id === scenario.coverageSettings.targetId)
          ?.name ?? "Constellation"
      : scenario.coverageSettings.targetType === "ground-station"
        ? scenario.groundStations.find((item) => item.id === scenario.coverageSettings.targetId)
            ?.name ?? "Ground station"
        : scenario.satellites.find((item) => item.id === scenario.coverageSettings.targetId)?.name ??
          "Satellite";
  const showCoverageReadout =
    !readOnly || (scenario.coverageSettings.enabled && coverageRows.length > 0);

  if (workspace.rightPanelCollapsed) {
    return (
      <aside className="panel right-panel panel-collapsed">
        <button
          className="icon-button primary"
          type="button"
          title="Expand details panel"
          onClick={() => setPanelCollapsed("right", false)}
        >
          <PanelRightOpen size={17} />
        </button>
        <div className="rail-count">
          <Shapes size={15} />
          <span>{coverageRows.filter((row) => row.visibleNow).length}</span>
        </div>
        <div className="rail-count">
          <MapPin size={15} />
          <span>{scenario.regions.length}</span>
        </div>
      </aside>
    );
  }

  if (scenario.selectedObjectType === "constellation" && activeConstellation) {
    return (
      <aside className={`panel right-panel ${readOnly ? "read-only-panel" : ""}`}>
        <RightPanelCollapseButton />
        <div className="panel-heading editor-title">
          <div>
            <span className="eyebrow">Selected Constellation</span>
            <input
              className="satellite-name-input"
              readOnly={readOnly}
              value={activeConstellation.name}
              onChange={(event) =>
                updateConstellation(activeConstellation.id, { name: event.target.value })
              }
            />
          </div>
          <span className="status-pill valid">Group</span>
        </div>

        {!readOnly && <div className="editor-toolbar">
          <label className="color-control" title="Constellation color">
            <Palette size={15} />
            <input
              type="color"
              value={activeConstellation.color}
              onChange={(event) =>
                updateConstellation(activeConstellation.id, { color: event.target.value })
              }
            />
          </label>
          <button
            className={activeConstellation.visible ? "active" : ""}
            type="button"
            onClick={() =>
              updateConstellation(activeConstellation.id, {
                visible: !activeConstellation.visible,
              })
            }
          >
            {activeConstellation.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            <span>Visible</span>
          </button>
          <button
            className={
              scenario.coverageSettings.targetType === "constellation" &&
              scenario.coverageSettings.targetId === activeConstellation.id
                ? "active"
                : ""
            }
            type="button"
            onClick={() => {
              setCoverageSetting("targetType", "constellation");
              setCoverageSetting("targetId", activeConstellation.id);
              setCoverageSetting("enabled", true);
            }}
          >
            <Shapes size={15} />
            <span>Analyze</span>
          </button>
        </div>}

        <section className="readout-section catalog-details">
          <div className="section-header">
            <span className="eyebrow">Generator</span>
            <Layers3 size={16} />
          </div>
          <div className="readout-grid">
            <span>Type</span>
            <strong>{activeConstellation.generator.kind}</strong>
            <span>Satellites</span>
            <strong>{activeConstellation.satelliteIds.length}</strong>
            <span>Altitude</span>
            <strong>
              {activeConstellation.generator.altitudeKm
                ? `${activeConstellation.generator.altitudeKm} km`
                : "--"}
            </strong>
            <span>Inclination</span>
            <strong>
              {activeConstellation.generator.inclinationDeg
                ? `${activeConstellation.generator.inclinationDeg} deg`
                : "--"}
            </strong>
          </div>
        </section>

        {showCoverageReadout && <section className="readout-section coverage-section">
          <div className="section-header">
            <span className="eyebrow">Coverage Layer</span>
            <strong>{coverageTargetLabel}</strong>
          </div>
          <div className="coverage-list">
            {coverageRows.slice(0, 5).map((row) => (
              <div className="coverage-row" key={row.region.id}>
                <span>{row.region.name}</span>
                <strong>{row.visibleNow ? "Visible" : "Not visible"}</strong>
                <em>{row.coveredPercent.toFixed(0)}%</em>
              </div>
            ))}
          </div>
          <div className="coverage-timeline">
            {coverageTimeline.map((sample) => (
              <div className="timeline-row" key={sample.label}>
                <span>{sample.label}</span>
                <div>
                  <i style={{ width: `${Math.min(100, sample.value).toFixed(0)}%` }} />
                </div>
                <strong>{sample.value.toFixed(0)}%</strong>
              </div>
            ))}
          </div>
        </section>}
      </aside>
    );
  }

  if (scenario.selectedObjectType === "region" && activeRegion) {
    const boundary = activeRegion.boundary;
    return (
      <aside className={`panel right-panel ${readOnly ? "read-only-panel" : ""}`}>
        <RightPanelCollapseButton />
        <div className="panel-heading editor-title">
          <div>
            <span className="eyebrow">Selected Region</span>
            <input
              className="satellite-name-input"
              readOnly={readOnly}
              value={activeRegion.name}
              onChange={(event) => updateRegion(activeRegion.id, { name: event.target.value })}
            />
          </div>
          <span className={`status-pill ${selectedRegionCoverage?.visibleNow ? "valid" : ""}`}>
            {selectedRegionCoverage?.visibleNow ? "Visible" : "Region"}
          </span>
        </div>

        {!readOnly && <div className="editor-toolbar">
          <label className="color-control" title="Region color">
            <Palette size={15} />
            <input
              type="color"
              value={activeRegion.color}
              onChange={(event) => updateRegion(activeRegion.id, { color: event.target.value })}
            />
          </label>
          <button
            className={activeRegion.visible ? "active" : ""}
            type="button"
            onClick={() => updateRegion(activeRegion.id, { visible: !activeRegion.visible })}
          >
            {activeRegion.visible ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button
            className={activeRegion.showLabel ? "active" : ""}
            type="button"
            onClick={() => updateRegion(activeRegion.id, { showLabel: !activeRegion.showLabel })}
          >
            <MapPin size={15} />
          </button>
        </div>}

        {!readOnly && <div className="editor-section">
          <label className="field wide-field">
            <span className="field-label">Region type</span>
            <select
              value={activeRegion.type}
              onChange={(event) =>
                updateRegion(activeRegion.id, {
                  type: event.target.value as RegionModel["type"],
                })
              }
            >
              <option value="country">Country</option>
              <option value="state">State</option>
              <option value="city">City</option>
              <option value="custom-circle">Custom Circle</option>
              <option value="custom-polygon">Custom Polygon placeholder</option>
            </select>
          </label>
          {boundary.kind === "circle" ? (
            <>
              <NumberField
                label="Latitude"
                unit="deg"
                value={boundary.centerLatitudeDeg}
                step={0.1}
                invalidMessage={finiteMessage(boundary.centerLatitudeDeg)}
                onChange={(value) =>
                  updateRegion(activeRegion.id, {
                    boundary: { ...boundary, centerLatitudeDeg: value },
                  })
                }
              />
              <NumberField
                label="Longitude"
                unit="deg"
                value={boundary.centerLongitudeDeg}
                step={0.1}
                invalidMessage={finiteMessage(boundary.centerLongitudeDeg)}
                onChange={(value) =>
                  updateRegion(activeRegion.id, {
                    boundary: { ...boundary, centerLongitudeDeg: value },
                  })
                }
              />
              <NumberField
                label="Radius"
                unit="deg"
                value={boundary.radiusDeg}
                step={0.1}
                invalidMessage={boundary.radiusDeg > 0 ? null : "Use a positive radius"}
                onChange={(value) =>
                  updateRegion(activeRegion.id, {
                    boundary: { ...boundary, radiusDeg: value },
                  })
                }
              />
            </>
          ) : (
            <p className="panel-microcopy wide-field">
              Custom polygon editing is a placeholder in this PRD. This simplified boundary is
              stored in the scenario and rendered on the globe.
            </p>
          )}
        </div>}

        <section className="readout-section coverage-section">
          <div className="section-header">
            <span className="eyebrow">Region Visibility</span>
            <strong>{coverageTargetLabel}</strong>
          </div>
          <div className="readout-grid">
            <span>Visible now</span>
            <strong>{selectedRegionCoverage?.visibleNow ? "Yes" : "No"}</strong>
            <span>Covered</span>
            <strong>{(selectedRegionCoverage?.coveredPercent ?? 0).toFixed(0)}%</strong>
            <span>Next opportunity</span>
            <strong>
              {selectedRegionCoverage?.nextVisibilityTime
                ? new Date(selectedRegionCoverage.nextVisibilityTime).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "--"}
            </strong>
            <span>Visible assets</span>
            <strong>{selectedRegionAssets.length}</strong>
            <span>Ground contact</span>
            <strong>
              {selectedRegionAssets.some((asset) => asset.kind === "station") ? "Yes" : "No"}
            </strong>
            <span>Coverage trend</span>
            <strong>{coverageTrend}</strong>
          </div>
          <div className="asset-list">
            {selectedRegionAssets.length > 0 ? (
              selectedRegionAssets.map((asset) => (
                <span key={asset.name}>
                  {asset.name} <strong>{asset.covered.toFixed(0)}%</strong>
                </span>
              ))
            ) : (
              <span>No visible assets right now</span>
            )}
          </div>
        </section>
      </aside>
    );
  }

  if (scenario.selectedObjectType === "ground-station" && station) {
    return (
      <aside className={`panel right-panel ${readOnly ? "read-only-panel" : ""}`}>
        <RightPanelCollapseButton />
        <div className="panel-heading editor-title">
          <div>
            <span className="eyebrow">Selected Ground Station</span>
            <input
              className="satellite-name-input"
              readOnly={readOnly}
              value={station.name}
              onChange={(event) => updateGroundStation(station.id, { name: event.target.value })}
            />
          </div>
          <span className="status-pill valid">Station</span>
        </div>

        {!readOnly && <div className="editor-toolbar">
          <label className="color-control" title="Ground station color">
            <Palette size={15} />
            <input
              type="color"
              value={station.color}
              onChange={(event) => updateGroundStation(station.id, { color: event.target.value })}
            />
          </label>
          <button
            className={station.visible ? "active" : ""}
            type="button"
            title="Visibility"
            onClick={() => updateGroundStation(station.id, { visible: !station.visible })}
          >
            {station.visible ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button
            className={station.showCoverageCone ? "active" : ""}
            type="button"
            title="Coverage cone"
            onClick={() =>
              updateGroundStation(station.id, { showCoverageCone: !station.showCoverageCone })
            }
          >
            <Orbit size={15} />
          </button>
          <button
            className={station.showHorizonCircle ? "active" : ""}
            type="button"
            title="Horizon circle"
            onClick={() =>
              updateGroundStation(station.id, { showHorizonCircle: !station.showHorizonCircle })
            }
          >
            <Map size={15} />
          </button>
        </div>}

        {!readOnly && <div className="editor-section">
          <NumberField
            label="Latitude"
            unit="deg"
            value={station.latitudeDeg}
            step={0.01}
            min={-90}
            max={90}
            invalidMessage={
              station.latitudeDeg >= -90 && station.latitudeDeg <= 90 ? null : "Use -90 to 90"
            }
            onChange={(value) => updateGroundStation(station.id, { latitudeDeg: value })}
          />
          <NumberField
            label="Longitude"
            unit="deg"
            value={station.longitudeDeg}
            step={0.01}
            min={-180}
            max={180}
            invalidMessage={
              station.longitudeDeg >= -180 && station.longitudeDeg <= 180
                ? null
                : "Use -180 to 180"
            }
            onChange={(value) => updateGroundStation(station.id, { longitudeDeg: value })}
          />
          <NumberField
            label="Altitude"
            unit="m"
            value={station.altitudeMeters}
            step={1}
            invalidMessage={finiteMessage(station.altitudeMeters)}
            onChange={(value) => updateGroundStation(station.id, { altitudeMeters: value })}
          />
          <NumberField
            label="Min elevation"
            unit="deg"
            value={station.minimumElevationDeg}
            step={1}
            min={0}
            max={90}
            invalidMessage={
              station.minimumElevationDeg >= 0 && station.minimumElevationDeg <= 90
                ? null
                : "Use 0-90 deg"
            }
            onChange={(value) =>
              updateGroundStation(station.id, { minimumElevationDeg: value })
            }
          />
          <NumberField
            label="Antenna range"
            unit="km"
            value={station.antennaRangeKm ?? 0}
            step={100}
            invalidMessage={null}
            onChange={(value) =>
              updateGroundStation(station.id, {
                antennaRangeKm: value > 0 ? value : null,
              })
            }
          />
          <label className="field wide-field">
            <span className="field-label">Source / notes</span>
            <textarea
              value={station.source ?? station.notes ?? ""}
              onChange={(event) =>
                updateGroundStation(station.id, { source: event.target.value })
              }
            />
          </label>
        </div>}

        <section className="readout-section">
          <div className="section-header">
            <span className="eyebrow">Contact With Selected Satellite</span>
            <strong>{contact?.inContact ? "In contact" : "No contact"}</strong>
          </div>
          <div className="readout-grid">
            <span>Satellite</span>
            <strong>{satellite?.name ?? "--"}</strong>
            <span>Range</span>
            <strong>{contact ? `${formatNumber(contact.rangeKm, 1)} km` : "--"}</strong>
            <span>Azimuth</span>
            <strong>{contact ? `${formatNumber(contact.azimuthDeg, 1)} deg` : "--"}</strong>
            <span>Elevation</span>
            <strong>{contact ? `${formatSignedNumber(contact.elevationDeg, 1)} deg` : "--"}</strong>
            <span>Minimum</span>
            <strong>{formatNumber(station.minimumElevationDeg, 1)} deg</strong>
          </div>
        </section>
      </aside>
    );
  }

  if (scenario.selectedObjectType === "catalog-object" && catalogObject) {
    return (
      <aside className={`panel right-panel ${readOnly ? "read-only-panel" : ""}`}>
        <RightPanelCollapseButton />
        <div className="panel-heading editor-title">
          <div>
            <span className="eyebrow">Selected Catalog Object</span>
            <strong className="catalog-title">{catalogObject.name}</strong>
          </div>
          <span className="status-pill valid">Sample</span>
        </div>
        <section className="readout-section catalog-details">
          <div className="section-header">
            <span className="eyebrow">Catalog Metadata</span>
            <Database size={16} />
          </div>
          <div className="readout-grid">
            <span>NORAD</span>
            <strong>{catalogObject.noradCatalogNumber ?? "--"}</strong>
            <span>Type</span>
            <strong>{catalogObject.objectType ?? "--"}</strong>
            <span>Launch date</span>
            <strong>{catalogObject.launchDate ?? "--"}</strong>
            <span>Epoch</span>
            <strong>{catalogObject.tleEpoch ?? "--"}</strong>
            <span>Mode</span>
            <strong>{propagationLabel(catalogObject.propagationMode)}</strong>
          </div>
          <p className="panel-microcopy">
            Full current catalog and historical catalog population require local/imported TLE or
            snapshot sources. Orbit Studio is only propagating loaded sample objects here.
          </p>
        </section>
      </aside>
    );
  }

  if (!satellite) {
    return (
      <aside className="panel right-panel panel-collapsed empty-editor contextual-rail">
        <CircleDot size={20} />
        <span>Select</span>
      </aside>
    );
  }

  const tleData = satellite.tle ?? { name: satellite.name, line1: "", line2: "" };
  const tleMessage = validateTle(tleData);
  const keplerianValid = isValidKeplerian(satellite.keplerian);
  const cartesianValid = isValidCartesian(satellite.cartesian);
  const activeEditorModeLabel =
    editorModes.find((mode) => mode.id === satellite.editorMode)?.label ?? "Keplerian";

  return (
    <aside className={`panel right-panel satellite-editor-panel ${readOnly ? "read-only-panel" : ""}`}>
      <RightPanelCollapseButton />
      <div className="panel-heading editor-title">
        <div>
          <span className="eyebrow">Selected Satellite</span>
          <input
            className="satellite-name-input"
            readOnly={readOnly}
            value={satellite.name}
            onChange={(event) => updateSatelliteName(satellite.id, event.target.value)}
          />
        </div>
        <span className={`status-pill ${keplerianValid && cartesianValid ? "valid" : "invalid"}`}>
          {keplerianValid && cartesianValid ? "Valid" : "Check inputs"}
        </span>
      </div>

      {!readOnly && <div className="studio-edit-heading">
        <span>
          <strong>Orbital Editing</strong>
          <small>Primary workspace</small>
        </span>
        <em>{activeEditorModeLabel}</em>
      </div>}

      {!readOnly && <div className="segmented" role="tablist" aria-label="Input mode">
        {editorModes
          .filter((mode) =>
            scenario.teacherMode ? mode.id === "keplerian" || mode.id === "visualization" : true,
          )
          .map((mode) => (
          <button
            className={satellite.editorMode === mode.id ? "active" : ""}
            key={mode.id}
            type="button"
            onClick={() => setEditorMode(satellite.id, mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>}

      {!readOnly && <div className="editor-section">
        {satellite.editorMode === "keplerian" && (
          <>
            <NumberField
              label="Semi-major axis"
              unit="km"
              value={satellite.keplerian.semiMajorAxisKm}
              step={1}
              invalidMessage={semiMajorAxisMessage(satellite.keplerian.semiMajorAxisKm)}
              onChange={(value) => updateKeplerian(satellite.id, { semiMajorAxisKm: value })}
            />
            <NumberField
              label="Eccentricity"
              value={satellite.keplerian.eccentricity}
              step={0.0001}
              min={0}
              max={0.999}
              invalidMessage={eccentricityMessage(satellite.keplerian.eccentricity)}
              onChange={(value) => updateKeplerian(satellite.id, { eccentricity: value })}
            />
            <NumberField
              label="Inclination"
              unit="deg"
              value={satellite.keplerian.inclinationDeg}
              step={0.1}
              min={0}
              max={180}
              invalidMessage={inclinationMessage(satellite.keplerian.inclinationDeg)}
              onChange={(value) => updateKeplerian(satellite.id, { inclinationDeg: value })}
            />
            <NumberField
              label="RAAN"
              unit="deg"
              value={satellite.keplerian.raanDeg}
              step={0.1}
              invalidMessage={finiteMessage(satellite.keplerian.raanDeg)}
              onChange={(value) => updateKeplerian(satellite.id, { raanDeg: value })}
            />
            <NumberField
              label="Arg. periapsis"
              unit="deg"
              value={satellite.keplerian.argumentOfPeriapsisDeg}
              step={0.1}
              invalidMessage={finiteMessage(satellite.keplerian.argumentOfPeriapsisDeg)}
              onChange={(value) =>
                updateKeplerian(satellite.id, { argumentOfPeriapsisDeg: value })
              }
            />
            <NumberField
              label="True anomaly"
              unit="deg"
              value={satellite.keplerian.trueAnomalyDeg}
              step={0.1}
              invalidMessage={finiteMessage(satellite.keplerian.trueAnomalyDeg)}
              onChange={(value) => updateKeplerian(satellite.id, { trueAnomalyDeg: value })}
            />
            <label className="field">
              <span className="field-label">Epoch (local)</span>
              <input
                type="datetime-local"
                value={toDateTimeLocalValue(satellite.keplerian.epoch)}
                onChange={(event) => {
                  const epoch = fromDateTimeLocalValue(event.target.value);

                  if (epoch) {
                    updateKeplerian(satellite.id, { epoch });
                  }
                }}
              />
            </label>
          </>
        )}

        {satellite.editorMode === "cartesian" && (
          <>
            <div className="subsection-label">Position ECI</div>
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <NumberField
                key={`position-${axis}`}
                label={axis}
                unit="km"
                value={satellite.cartesian.positionKm[index]}
                step={1}
                invalidMessage={finiteMessage(satellite.cartesian.positionKm[index])}
                onChange={(value) =>
                  updateCartesianVector(satellite.id, "positionKm", index as 0 | 1 | 2, value)
                }
              />
            ))}
            <div className="subsection-label">Velocity ECI</div>
            {(["VX", "VY", "VZ"] as const).map((axis, index) => (
              <NumberField
                key={`velocity-${axis}`}
                label={axis}
                unit="km/s"
                value={satellite.cartesian.velocityKmS[index]}
                step={0.001}
                invalidMessage={finiteMessage(satellite.cartesian.velocityKmS[index])}
                onChange={(value) =>
                  updateCartesianVector(satellite.id, "velocityKmS", index as 0 | 1 | 2, value)
                }
              />
            ))}
            <label className="field">
              <span className="field-label">Epoch (local)</span>
              <input
                type="datetime-local"
                value={toDateTimeLocalValue(satellite.cartesian.epoch)}
                onChange={(event) => {
                  const epoch = fromDateTimeLocalValue(event.target.value);

                  if (epoch) {
                    updateCartesianEpoch(satellite.id, epoch);
                  }
                }}
              />
            </label>
          </>
        )}

        {satellite.editorMode === "tle" && (
          <div className="tle-editor">
            <label className="field">
              <span className="field-label">Satellite name</span>
              <input
                value={tleData.name}
                onChange={(event) => updateTle(satellite.id, { name: event.target.value })}
              />
            </label>
            <label className={`field ${tleMessage ? "field-invalid" : ""}`}>
              <span className="field-label">Line 1</span>
              <textarea
                spellCheck={false}
                value={tleData.line1}
                onChange={(event) => updateTle(satellite.id, { line1: event.target.value })}
              />
            </label>
            <label className={`field ${tleMessage ? "field-invalid" : ""}`}>
              <span className="field-label">Line 2</span>
              <textarea
                spellCheck={false}
                value={tleData.line2}
                onChange={(event) => updateTle(satellite.id, { line2: event.target.value })}
              />
              {tleMessage && <span className="field-error">{tleMessage}</span>}
            </label>
          </div>
        )}

        {satellite.editorMode === "visualization" && (
          <>
            <div className="subsection-label">Simple nadir sensor model</div>
            <button
              className={satellite.sensor.enabled ? "active" : ""}
              type="button"
              onClick={() => updateSatelliteSensor(satellite.id, { enabled: !satellite.sensor.enabled })}
            >
              <Scan size={15} />
              <span>Sensor</span>
            </button>
            <button
              className={satellite.sensor.showCone ? "active" : ""}
              type="button"
              onClick={() =>
                updateSatelliteSensor(satellite.id, { showCone: !satellite.sensor.showCone })
              }
            >
              <Orbit size={15} />
              <span>Cone</span>
            </button>
            <button
              className={satellite.sensor.showFootprint ? "active" : ""}
              type="button"
              onClick={() =>
                updateSatelliteSensor(satellite.id, {
                  showFootprint: !satellite.sensor.showFootprint,
                })
              }
            >
              <Map size={15} />
              <span>Footprint</span>
            </button>
            <NumberField
              label="Half-angle"
              unit="deg"
              value={satellite.sensor.halfAngleDeg}
              step={1}
              min={1}
              max={80}
              invalidMessage={
                satellite.sensor.halfAngleDeg > 0 && satellite.sensor.halfAngleDeg <= 80
                  ? null
                  : "Use 1-80 deg"
              }
              onChange={(value) => updateSatelliteSensor(satellite.id, { halfAngleDeg: value })}
            />
            <NumberField
              label="Max range"
              unit="km"
              value={satellite.sensor.maxRangeKm ?? 0}
              step={10}
              invalidMessage={null}
              onChange={(value) =>
                updateSatelliteSensor(satellite.id, { maxRangeKm: value > 0 ? value : null })
              }
            />
          </>
        )}
      </div>}

      {!readOnly && <div className="editor-toolbar">
        <label className="color-control" title="Satellite color">
          <Palette size={15} />
          <input
            type="color"
            value={satellite.visualization.color}
            onChange={(event) =>
              updateSatelliteVisualization(satellite.id, { color: event.target.value })
            }
          />
        </label>
        <button
          className={satellite.visualization.visible ? "active" : ""}
          type="button"
          title="Visibility"
          onClick={() =>
            updateSatelliteVisualization(satellite.id, {
              visible: !satellite.visualization.visible,
            })
          }
        >
          {satellite.visualization.visible ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button
          className={satellite.visualization.showTrail ? "active" : ""}
          type="button"
          title="Orbit trail"
          onClick={() =>
            updateSatelliteVisualization(satellite.id, {
              showTrail: !satellite.visualization.showTrail,
            })
          }
        >
          <Orbit size={15} />
        </button>
        <button
          className={satellite.visualization.showGroundTrack ? "active" : ""}
          type="button"
          title="Ground track"
          onClick={() =>
            updateSatelliteVisualization(satellite.id, {
              showGroundTrack: !satellite.visualization.showGroundTrack,
            })
          }
        >
          <Map size={15} />
        </button>
        <label className="mode-select">
          <RadioTower size={15} />
          <select
            value={satellite.propagationMode}
            onChange={(event) =>
              setPropagationMode(satellite.id, event.target.value as PropagationMode)
            }
          >
            <option value="two-body">Two-body</option>
            <option value="sgp4">SGP4 / TLE</option>
            <option value="advanced" disabled>
              Advanced placeholder
            </option>
          </select>
        </label>
      </div>}

      <details className="readout-section studio-secondary-section" open={readOnly}>
        <summary>
          <span>Live Readouts</span>
          <strong>{propagationLabel(satellite.propagationMode)}</strong>
        </summary>
        <div className="readout-grid">
          <span>Altitude</span>
          <strong>{readouts ? `${formatNumber(readouts.altitudeKm, 1)} km` : "--"}</strong>
          <span>Velocity</span>
          <strong>{readouts ? `${formatNumber(readouts.velocityKmS, 3)} km/s` : "--"}</strong>
          <span>Period</span>
          <strong>{readouts ? `${formatNumber(readouts.periodMinutes, 2)} min` : "--"}</strong>
          <span>Inclination</span>
          <strong>{formatNumber(satellite.keplerian.inclinationDeg, 2)} deg</strong>
          <span>Eccentricity</span>
          <strong>{formatNumber(satellite.keplerian.eccentricity, 5)}</strong>
          <span>Latitude</span>
          <strong>{readouts ? `${formatSignedNumber(readouts.latitudeDeg, 2)} deg` : "--"}</strong>
          <span>Longitude</span>
          <strong>{readouts ? `${formatSignedNumber(readouts.longitudeDeg, 2)} deg` : "--"}</strong>
          <span>Station contact</span>
          <strong>{contact?.inContact ? "Yes" : "No"}</strong>
        </div>
      </details>

      {showCoverageReadout && <details className="readout-section coverage-section studio-secondary-section">
        <summary>
          <span>Coverage Layer</span>
          <strong>{coverageTargetLabel}</strong>
        </summary>
        <div className="coverage-list">
          {coverageRows.slice(0, 4).map((row) => (
            <div className="coverage-row" key={row.region.id}>
              <span>{row.region.name}</span>
              <strong>{row.visibleNow ? "Visible" : "Not visible"}</strong>
              <em>{row.coveredPercent.toFixed(0)}%</em>
            </div>
          ))}
        </div>
        <div className="coverage-timeline">
          {coverageTimeline.map((sample) => (
            <div className="timeline-row" key={sample.label}>
              <span>{sample.label}</span>
              <div>
                <i style={{ width: `${Math.min(100, sample.value).toFixed(0)}%` }} />
              </div>
              <strong>{sample.value.toFixed(0)}%</strong>
            </div>
          ))}
        </div>
      </details>}

      <details className="readout-section why-section studio-secondary-section">
        <summary>
          <span>Why?</span>
          <strong>{lastOrbitExplanation ? "Updated" : "Ready"}</strong>
        </summary>
        {lastOrbitExplanation ? (
          <>
            <p className="why-title">{lastOrbitExplanation.title}</p>
            <ul className="why-list">
              {lastOrbitExplanation.effects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="panel-microcopy">
            Change altitude, inclination, or eccentricity to see deterministic classroom notes.
          </p>
        )}
      </details>
    </aside>
  );
}
