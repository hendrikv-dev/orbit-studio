import { ChevronDown, ChevronUp, Plus, Satellite as SatelliteIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { useSimulationStore } from "../state/useSimulationStore";
import { useSidebarScenario } from "../state/scenarioSubscriptions";

interface PlaygroundSatelliteColumnProps {
  onMobileClose?: () => void;
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 743px)").matches;
}

export function PlaygroundSatelliteColumn({ onMobileClose }: PlaygroundSatelliteColumnProps = {}) {
  const [collapsed, setCollapsed] = useState(false);
  const scenario = useSidebarScenario();
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const addSatellite = useSimulationStore((state) => state.addSatellite);
  const deleteSatellite = useSimulationStore((state) => state.deleteSatellite);
  const selectSatellite = useSimulationStore((state) => state.selectSatellite);
  const deleteDisabled = scenario.satellites.length <= 1;

  return (
    <aside
      className={`playground-satellite-column ${collapsed ? "collapsed" : ""}`}
      aria-label="Playground satellites"
    >
      <div className="playground-satellite-column-heading">
        <div>
          <span>Satellites</span>
          <strong>{scenario.satellites.length}</strong>
        </div>
        <button
          aria-expanded={!collapsed}
          className="icon-button playground-panel-toggle playground-panel-toggle-left"
          type="button"
          title={collapsed ? "Expand satellite list" : "Collapse satellite list"}
          onClick={() => {
            if (onMobileClose && isMobileViewport()) {
              onMobileClose();
              return;
            }

            setCollapsed(!collapsed);
          }}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {!collapsed && (
        <>
          <button type="button" className="playground-satellite-add" onClick={addSatellite}>
            <Plus size={15} />
            <span>Add Satellite</span>
          </button>

          <div className="playground-satellite-column-rows">
            {scenario.satellites.map((satellite, index) => {
              const active = satellite.id === selectedSatelliteId;
              const altitudeKm = satellite.keplerian.semiMajorAxisKm - EARTH_RADIUS_KM;

              return (
                <div
                  aria-current={active ? "true" : undefined}
                  className={`playground-satellite-column-row ${active ? "active" : ""}`}
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
                  <i style={{ background: satellite.visualization.color }} />
                  <span>
                    <strong>{satellite.name || `Satellite ${index + 1}`}</strong>
                    <small>
                      {altitudeKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km ·{" "}
                      {satellite.keplerian.inclinationDeg.toFixed(1)} deg
                    </small>
                  </span>
                  <SatelliteIcon size={13} />
                  <button
                    className="playground-satellite-delete"
                    type="button"
                    title={
                      deleteDisabled
                        ? "Keep at least one satellite"
                        : `Delete ${satellite.name || `Satellite ${index + 1}`}`
                    }
                    disabled={deleteDisabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteSatellite(satellite.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
