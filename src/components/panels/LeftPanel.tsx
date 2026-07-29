import { Copy, Eye, EyeOff, Plus, Route, Trash2 } from 'lucide-react';
import { useSimulationStore } from '../../state/simulationStore';

export function LeftPanel() {
  const satellites = useSimulationStore((state) => state.satellites);
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const scenarioName = useSimulationStore((state) => state.scenarioName);
  const importFeedback = useSimulationStore((state) => state.importFeedback);
  const setScenarioName = useSimulationStore((state) => state.setScenarioName);
  const selectSatellite = useSimulationStore((state) => state.selectSatellite);
  const addSatellite = useSimulationStore((state) => state.addSatellite);
  const duplicateSatellite = useSimulationStore((state) => state.duplicateSatellite);
  const deleteSatellite = useSimulationStore((state) => state.deleteSatellite);
  const updateSatelliteFlags = useSimulationStore((state) => state.updateSatelliteFlags);

  return (
    <aside className="side-panel left-panel">
      <div className="panel-heading">
        <span>Scenario</span>
        <button className="icon-button primary" onClick={addSatellite} title="Add satellite" type="button">
          <Plus size={16} />
        </button>
      </div>
      <label className="field">
        <span className="field-label">Name</span>
        <input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
      </label>
      {importFeedback.type !== 'idle' ? (
        <div className={importFeedback.type === 'error' ? 'feedback error' : 'feedback'}>
          {importFeedback.message}
        </div>
      ) : null}

      <div className="panel-heading satellites-heading">
        <span>Satellites</span>
        <span className="count-pill">{satellites.length}</span>
      </div>
      <div className="satellite-list">
        {satellites.map((satellite) => (
          <div
            key={satellite.id}
            className={satellite.id === selectedSatelliteId ? 'satellite-row active' : 'satellite-row'}
            onClick={() => selectSatellite(satellite.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                selectSatellite(satellite.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <span className="satellite-swatch" style={{ background: satellite.color }} />
            <span className="satellite-row-main">
              <span className="satellite-name">{satellite.name}</span>
              <span className="satellite-meta">{satellite.propagationMode === 'sgp4' ? 'SGP4 / TLE' : 'Two-body'}</span>
            </span>
            <span className="row-actions" onClick={(event) => event.stopPropagation()}>
              <button
                className="ghost-icon"
                onClick={() => updateSatelliteFlags(satellite.id, { visible: !satellite.visible })}
                title={satellite.visible ? 'Hide satellite' : 'Show satellite'}
                type="button"
              >
                {satellite.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <button
                className="ghost-icon"
                onClick={() => updateSatelliteFlags(satellite.id, { showGroundTrack: !satellite.showGroundTrack })}
                title="Toggle ground track"
                type="button"
              >
                <Route size={15} />
              </button>
              <button className="ghost-icon" onClick={() => duplicateSatellite(satellite.id)} title="Duplicate satellite" type="button">
                <Copy size={15} />
              </button>
              <button className="ghost-icon danger" onClick={() => deleteSatellite(satellite.id)} title="Delete satellite" type="button">
                <Trash2 size={15} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
