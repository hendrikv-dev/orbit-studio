import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Layers3,
  Map,
  MapPin,
  Orbit,
  PanelLeftOpen,
  Plus,
  RadioTower,
  Satellite,
  Search,
  Sparkles,
  Trash2,
  Waypoints,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { OrbitalObjectCategory, SatelliteModel } from "../lib/scenario";
import type { HierarchySection } from "../state/useSimulationStore";
import { useSimulationStore } from "../state/useSimulationStore";
import { useSidebarScenario } from "../state/scenarioSubscriptions";

interface SectionHeaderProps {
  section: HierarchySection;
  icon: ReactNode;
  label: string;
  count: number;
  onAdd?: () => void;
  addTitle?: string;
}

function SectionHeader({ section, icon, label, count, onAdd, addTitle }: SectionHeaderProps) {
  const expanded = useSimulationStore((state) => state.workspace.hierarchyExpanded[section]);
  const toggleHierarchySection = useSimulationStore((state) => state.toggleHierarchySection);

  return (
    <div className="object-section-heading">
      <button
        className="section-toggle"
        type="button"
        onClick={() => toggleHierarchySection(section)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        <span>{label}</span>
        <strong>{count}</strong>
      </button>
      {onAdd && (
        <button className="icon-button primary" type="button" title={addTitle} onClick={onAdd}>
          <Plus size={17} />
        </button>
      )}
    </div>
  );
}

function orbitalCategory(satellite: SatelliteModel): OrbitalObjectCategory {
  return satellite.catalogMetadata?.categoryId ?? "payloads";
}

function matchesLayerVisibility(
  satellite: SatelliteModel,
  filters: ReturnType<typeof useSimulationStore.getState>["workspace"]["visibilityFilters"],
) {
  const category = orbitalCategory(satellite);
  if (category === "debris") return filters.debris;
  if (category === "rocket-bodies") return filters.rocketBodies;
  return filters.payloads;
}

function SceneLayerButton({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <strong>{count.toLocaleString()}</strong>
    </button>
  );
}

interface SatelliteListProps {
  readOnly?: boolean;
}

export function SatelliteList({ readOnly = false }: SatelliteListProps) {
  const [query, setQuery] = useState("");
  const scenario = useSidebarScenario();
  const workspace = useSimulationStore((state) => state.workspace);
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const selectedGroundStationId = useSimulationStore((state) => state.selectedGroundStationId);
  const selectedRegionId = useSimulationStore((state) => state.selectedRegionId);
  const selectedConstellationId = useSimulationStore((state) => state.selectedConstellationId);
  const addSatellite = useSimulationStore((state) => state.addSatellite);
  const selectSatellite = useSimulationStore((state) => state.selectSatellite);
  const updateSatelliteVisualization = useSimulationStore(
    (state) => state.updateSatelliteVisualization,
  );
  const addGroundStation = useSimulationStore((state) => state.addGroundStation);
  const deleteGroundStation = useSimulationStore((state) => state.deleteGroundStation);
  const selectGroundStation = useSimulationStore((state) => state.selectGroundStation);
  const updateGroundStation = useSimulationStore((state) => state.updateGroundStation);
  const addRegion = useSimulationStore((state) => state.addRegion);
  const deleteRegion = useSimulationStore((state) => state.deleteRegion);
  const selectRegion = useSimulationStore((state) => state.selectRegion);
  const updateRegion = useSimulationStore((state) => state.updateRegion);
  const addConstellation = useSimulationStore((state) => state.addConstellation);
  const deleteConstellation = useSimulationStore((state) => state.deleteConstellation);
  const selectConstellation = useSimulationStore((state) => state.selectConstellation);
  const setConstellationVisibilityMode = useSimulationStore(
    (state) => state.setConstellationVisibilityMode,
  );
  const generateWalkerDelta = useSimulationStore((state) => state.generateWalkerDelta);
  const generateCircularRing = useSimulationStore((state) => state.generateCircularRing);
  const generatePolarNetwork = useSimulationStore((state) => state.generatePolarNetwork);
  const loadSampleCatalog = useSimulationStore((state) => state.loadSampleCatalog);
  const toggleCatalogLayer = useSimulationStore((state) => state.toggleCatalogLayer);
  const toggleCatalogObject = useSimulationStore((state) => state.toggleCatalogObject);
  const selectCatalogObject = useSimulationStore((state) => state.selectCatalogObject);
  const setPanelCollapsed = useSimulationStore((state) => state.setPanelCollapsed);
  const setVisibilityFilter = useSimulationStore((state) => state.setVisibilityFilter);
  const toggleConstellationExpanded = useSimulationStore(
    (state) => state.toggleConstellationExpanded,
  );

  const sectionOpen = workspace.hierarchyExpanded;
  const filters = workspace.visibilityFilters;
  const showAll = !filters.selectedOnly;
  const normalizedQuery = query.trim().toLowerCase();
  const categoryCounts = useMemo(
    () =>
      scenario.satellites.reduce(
        (counts, satellite) => {
          const category = orbitalCategory(satellite);
          if (category === "debris") counts.debris += 1;
          else if (category === "rocket-bodies") counts.rocketBodies += 1;
          else counts.payloads += 1;
          return counts;
        },
        { payloads: 0, debris: 0, rocketBodies: 0 },
      ),
    [scenario.satellites],
  );
  const matchesSatelliteQuery = (satellite: SatelliteModel) => {
    if (!normalizedQuery) return true;
    return [
      satellite.name,
      satellite.catalogMetadata?.catalogNumber,
      satellite.catalogMetadata?.objectType,
      satellite.catalogMetadata?.operator,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  };
  const satellites = scenario.satellites.filter((satellite) => {
    if (orbitalCategory(satellite) === "debris") return false;
    const selected = satellite.id === selectedSatelliteId;
    return (
      (showAll || selected) &&
      (selected || matchesLayerVisibility(satellite, filters)) &&
      matchesSatelliteQuery(satellite)
    );
  });
  const constellations = scenario.constellations.filter(
    (constellation) => showAll || constellation.id === selectedConstellationId,
  );
  const stations = scenario.groundStations.filter(
    (station) => showAll || station.id === selectedGroundStationId,
  );
  const regions = scenario.regions.filter((region) => showAll || region.id === selectedRegionId);
  const loadedCatalogLayers = scenario.catalogLayers.filter((layer) => layer.loaded);
  const allConstellationsVisible = scenario.constellations.every((constellation) => constellation.visible);

  if (workspace.leftPanelCollapsed) {
    return (
      <aside className="panel left-panel panel-collapsed">
        <button
          className="icon-button primary"
          type="button"
          title="Expand scenario panel"
          onClick={() => setPanelCollapsed("left", false)}
        >
          <PanelLeftOpen size={17} />
        </button>
        <div className="rail-count">
          <Satellite size={15} />
          <span>{scenario.satellites.length}</span>
        </div>
        <div className="rail-count">
          <Layers3 size={15} />
          <span>{scenario.constellations.length}</span>
        </div>
        <div className="rail-count">
          <MapPin size={15} />
          <span>{scenario.regions.length}</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`panel left-panel ${readOnly ? "read-only-panel" : ""}`}>
      <div className="panel-heading compact-heading">
        <div>
          <span className="eyebrow">Playground</span>
          <h2>Scene Objects</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Collapse scenario panel"
          onClick={() => setPanelCollapsed("left", true)}
        >
          <ChevronLeftIcon />
        </button>
      </div>

      <div className="sandbox-layer-panel">
        <div className="sandbox-layer-heading">
          <span>Scene Layers</span>
          <strong>{scenario.satellites.length.toLocaleString()} orbital objects</strong>
        </div>
        <div className="sandbox-layer-grid">
          <SceneLayerButton
            active={filters.payloads}
            count={categoryCounts.payloads}
            icon={<Satellite size={14} />}
            label="Payloads"
            onClick={() => setVisibilityFilter("payloads", !filters.payloads)}
          />
          <SceneLayerButton
            active={filters.debris}
            count={categoryCounts.debris}
            icon={<Database size={14} />}
            label="Debris"
            onClick={() => setVisibilityFilter("debris", !filters.debris)}
          />
          <SceneLayerButton
            active={filters.rocketBodies}
            count={categoryCounts.rocketBodies}
            icon={<Orbit size={14} />}
            label="Bodies"
            onClick={() => setVisibilityFilter("rocketBodies", !filters.rocketBodies)}
          />
          <SceneLayerButton
            active={filters.stations}
            count={scenario.groundStations.length}
            icon={<RadioTower size={14} />}
            label="Stations"
            onClick={() => setVisibilityFilter("stations", !filters.stations)}
          />
          <SceneLayerButton
            active={filters.constellations}
            count={scenario.constellations.length}
            icon={<Layers3 size={14} />}
            label="Systems"
            onClick={() => setVisibilityFilter("constellations", !filters.constellations)}
          />
          <SceneLayerButton
            active={filters.regions}
            count={scenario.regions.length}
            icon={<MapPin size={14} />}
            label="Regions"
            onClick={() => setVisibilityFilter("regions", !filters.regions)}
          />
        </div>
        <div className="visibility-filter-row compact-filter-row">
          <button
            className={filters.selectedOnly ? "active" : ""}
            type="button"
            onClick={() => setVisibilityFilter("selectedOnly", !filters.selectedOnly)}
          >
            Selected context
          </button>
          <button
            className={!filters.debris ? "active" : ""}
            type="button"
            onClick={() => setVisibilityFilter("debris", !filters.debris)}
          >
            Debris {filters.debris ? "on" : "off"}
          </button>
        </div>
        <label className="sandbox-search-row">
          <Search size={14} />
          <input
            aria-label="Search Playground objects"
            placeholder="Search objects or systems"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="object-panel-scroll">
        <section className="object-section">
          <SectionHeader
            section="constellations"
            icon={<Layers3 size={15} />}
            label="Constellations"
            count={scenario.constellations.length}
            onAdd={readOnly ? undefined : addConstellation}
            addTitle="Create empty constellation"
          />
          {filters.constellations && sectionOpen.constellations && (
            <>
              <div className="constellation-scope-row" aria-label="Constellation visibility mode">
                <button
                  className={allConstellationsVisible ? "active" : ""}
                  type="button"
                  onClick={() => setConstellationVisibilityMode("all")}
                >
                  <Layers3 size={14} />
                  <span>All systems</span>
                </button>
                {selectedConstellationId && !allConstellationsVisible && (
                  <strong>Focused</strong>
                )}
              </div>
              {!readOnly && <div className="generator-row">
                <button type="button" onClick={generateWalkerDelta}>
                  <Sparkles size={14} />
                  <span>Walker</span>
                </button>
                <button type="button" onClick={generateCircularRing}>
                  <Orbit size={14} />
                  <span>Ring</span>
                </button>
                <button type="button" onClick={generatePolarNetwork}>
                  <Map size={14} />
                  <span>Polar</span>
                </button>
              </div>}

              <div className="satellite-list compact">
                {constellations.map((constellation) => {
                  const selected =
                    constellation.id === selectedConstellationId &&
                    scenario.selectedObjectType === "constellation";
                  const expanded = workspace.expandedConstellationIds.includes(constellation.id);
                  const childSatellites = scenario.satellites.filter((satellite) =>
                    constellation.satelliteIds.includes(satellite.id),
                  );

                  return (
                    <div className="hierarchy-group" key={constellation.id}>
                      <button
                        className={`satellite-row compact-row ${selected ? "selected" : ""}`}
                        type="button"
                        title={constellation.name}
                        onClick={() => selectConstellation(constellation.id)}
                      >
                        <span
                          className="satellite-color"
                          style={{ background: constellation.color }}
                        />
                        <span className="satellite-row-main">
                          <strong title={constellation.name}>{constellation.name}</strong>
                          <span>
                            {constellation.satelliteIds.length} satellites -{" "}
                            {constellation.visible ? "visible" : "hidden"}
                          </span>
                        </span>
                        <span className="row-actions constellation-actions">
                          <span
                            className={`mini-icon ${expanded ? "active" : ""}`}
                            title="Reveal satellites"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleConstellationExpanded(constellation.id);
                            }}
                          >
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </span>
                          {!readOnly && (
                            <span
                              className="mini-icon danger"
                              title="Delete constellation"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteConstellation(constellation.id);
                              }}
                            >
                              <Trash2 size={14} />
                            </span>
                          )}
                        </span>
                      </button>
                      {expanded && (
                        <div className="child-satellite-list">
                          {childSatellites.filter(matchesSatelliteQuery).map((satellite) => (
                            <button
                              className={`child-satellite-row ${
                                satellite.id === selectedSatelliteId ? "selected" : ""
                              }`}
                              key={satellite.id}
                              type="button"
                              title={satellite.name}
                              onClick={() => selectSatellite(satellite.id)}
                            >
                              <span title={satellite.name}>{satellite.name}</span>
                              <em>{satellite.keplerian.inclinationDeg.toFixed(1)} deg</em>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="object-section">
          <SectionHeader
            section="satellites"
            icon={<Satellite size={15} />}
            label="Objects"
            count={categoryCounts.payloads + categoryCounts.rocketBodies}
            onAdd={readOnly ? undefined : addSatellite}
            addTitle="Add satellite"
          />
          {sectionOpen.satellites && (
            <div className="satellite-list compact">
              {satellites.map((satellite) => {
                const selected =
                  satellite.id === selectedSatelliteId &&
                  scenario.selectedObjectType === "satellite";

                return (
                  <div
                    aria-label={`Select ${satellite.name}`}
                    aria-selected={selected}
                    className={`satellite-row satellite-object-row ${selected ? "selected" : ""}`}
                    key={satellite.id}
                    role="button"
                    tabIndex={0}
                    title={satellite.name}
                    onClick={() => selectSatellite(satellite.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectSatellite(satellite.id);
                      }
                    }}
                  >
                    <span
                      className="satellite-color"
                      style={{ background: satellite.visualization.color }}
                    />
                    <span className="satellite-row-main">
                      <strong title={satellite.name}>{satellite.name}</strong>
                      <span>
                        {satellite.propagationMode === "sgp4" ? "SGP4 / TLE" : "Two-body"} -{" "}
                        {satellite.keplerian.inclinationDeg.toFixed(1)} deg
                      </span>
                    </span>
                    {selected && (
                      <button
                        aria-label={
                          satellite.visualization.showTrail
                            ? `Hide orbit for ${satellite.name}`
                            : `Show orbit for ${satellite.name}`
                        }
                        aria-pressed={satellite.visualization.showTrail}
                        className={`satellite-row-action ${
                          satellite.visualization.showTrail ? "active" : ""
                        }`}
                        type="button"
                        title={
                          satellite.visualization.showTrail
                            ? `Hide orbit for ${satellite.name}`
                            : `Show orbit for ${satellite.name}`
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          updateSatelliteVisualization(satellite.id, {
                            showTrail: !satellite.visualization.showTrail,
                          });
                        }}
                      >
                        <Orbit size={14} />
                        <span>
                          {satellite.visualization.showTrail ? "Hide orbit" : "Show orbit"}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {filters.stations && (
          <section className="object-section">
            <SectionHeader
              section="groundStations"
              icon={<RadioTower size={15} />}
              label="Ground Stations"
              count={scenario.groundStations.length}
              onAdd={readOnly ? undefined : addGroundStation}
              addTitle="Add ground station"
            />
            {sectionOpen.groundStations && (
              <div className="satellite-list compact">
                {stations.map((station) => {
                  const selected =
                    station.id === selectedGroundStationId &&
                    scenario.selectedObjectType === "ground-station";

                  return (
                    <button
                      className={`satellite-row ${selected ? "selected" : ""}`}
                      key={station.id}
                      type="button"
                      title={station.name}
                      onClick={() => selectGroundStation(station.id)}
                    >
                      <span className="satellite-color" style={{ background: station.color }} />
                      <span className="satellite-row-main">
                        <strong title={station.name}>{station.name}</strong>
                        <span>
                          {station.latitudeDeg.toFixed(2)}, {station.longitudeDeg.toFixed(2)}
                        </span>
                      </span>
                      <span className="row-actions station-actions">
                        <span
                          className="mini-icon"
                          title={station.visible ? "Hide station" : "Show station"}
                          onClick={(event) => {
                            event.stopPropagation();
                            updateGroundStation(station.id, { visible: !station.visible });
                          }}
                        >
                          {station.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                        </span>
                        <span
                          className={`mini-icon ${station.showCoverageCone ? "active" : ""}`}
                          title="Toggle coverage"
                          onClick={(event) => {
                            event.stopPropagation();
                            updateGroundStation(station.id, {
                              showCoverageCone: !station.showCoverageCone,
                            });
                          }}
                        >
                          <Orbit size={14} />
                        </span>
                        <span
                          className={`mini-icon ${station.showHorizonCircle ? "active" : ""}`}
                          title="Toggle horizon circle"
                          onClick={(event) => {
                            event.stopPropagation();
                            updateGroundStation(station.id, {
                              showHorizonCircle: !station.showHorizonCircle,
                            });
                          }}
                        >
                          <Map size={14} />
                        </span>
                        {!readOnly && (
                          <span
                            className="mini-icon danger"
                            title="Delete station"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteGroundStation(station.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {filters.regions && (
          <section className="object-section">
            <SectionHeader
              section="regions"
              icon={<MapPin size={15} />}
              label="Regions"
              count={scenario.regions.length}
              onAdd={readOnly ? undefined : addRegion}
              addTitle="Add region"
            />
            {sectionOpen.regions && (
              <div className="satellite-list compact">
                {regions.map((region) => {
                  const selected =
                    region.id === selectedRegionId && scenario.selectedObjectType === "region";
                  return (
                    <button
                      className={`satellite-row compact-row ${selected ? "selected" : ""}`}
                      key={region.id}
                      type="button"
                      title={region.name}
                      onClick={() => selectRegion(region.id)}
                    >
                      <span className="satellite-color" style={{ background: region.color }} />
                      <span className="satellite-row-main">
                        <strong title={region.name}>{region.name}</strong>
                        <span>{region.type.replace("-", " ")}</span>
                      </span>
                      <span className="row-actions region-actions">
                        <span
                          className="mini-icon"
                          title={region.visible ? "Hide region" : "Show region"}
                          onClick={(event) => {
                            event.stopPropagation();
                            updateRegion(region.id, { visible: !region.visible });
                          }}
                        >
                          {region.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                        </span>
                        <span
                          className={`mini-icon ${region.showLabel ? "active" : ""}`}
                          title="Toggle region label"
                          onClick={(event) => {
                            event.stopPropagation();
                            updateRegion(region.id, { showLabel: !region.showLabel });
                          }}
                        >
                          <MapPin size={14} />
                        </span>
                        {!readOnly && (
                          <span
                            className="mini-icon danger"
                            title="Delete region"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteRegion(region.id);
                            }}
                          >
                            <Trash2 size={14} />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {filters.catalog && (
          <section className="object-section">
            <SectionHeader
              section="catalogLayers"
              icon={<Database size={15} />}
              label="Catalog Layers"
              count={loadedCatalogLayers.length}
            />
            {sectionOpen.catalogLayers && (
              <>
                {!readOnly && (
                  <button className="catalog-load-button" type="button" onClick={loadSampleCatalog}>
                    <Plus size={15} />
                    <span>Load Sample Catalog</span>
                  </button>
                )}
                {scenario.catalogLayers.map((layer) => (
                  <div className="catalog-layer-row" key={layer.id}>
                    <button
                      className={`catalog-layer-title ${
                        layer.visible && layer.loaded ? "active" : ""
                      }`}
                      type="button"
                      onClick={() => toggleCatalogLayer(layer.id)}
                    >
                      <Database size={14} />
                      <span>{layer.name}</span>
                      <strong>{layer.loaded ? `${layer.objects.length}` : "not loaded"}</strong>
                    </button>
                    {layer.loaded && (
                      <div className="catalog-object-list">
                        {layer.objects.map((object) => (
                          <button
                            className={`catalog-object-row ${
                              scenario.selectedObjectType === "catalog-object" &&
                              scenario.selectedObjectId === object.id
                                ? "selected"
                                : ""
                            }`}
                            key={object.id}
                            type="button"
                            title={object.name}
                            onClick={() => selectCatalogObject(object.id)}
                          >
                            <span title={object.name}>{object.name}</span>
                            <span
                              className={`mini-icon ${object.visible ? "active" : ""}`}
                              title="Toggle catalog object"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleCatalogObject(layer.id, object.id);
                              }}
                            >
                              {object.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </section>
        )}
      </div>

      <div className="panel-note">
        <Waypoints size={15} />
        <span>
          {(categoryCounts.payloads + categoryCounts.rocketBodies).toLocaleString()} listable -{" "}
          {categoryCounts.debris.toLocaleString()} debris layer -{" "}
          {scenario.groundStations.length} stations
        </span>
      </div>
    </aside>
  );
}

function ChevronLeftIcon() {
  return <ChevronRight size={16} className="collapse-left-icon" />;
}
