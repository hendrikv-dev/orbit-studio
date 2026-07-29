import { Palette, Radio, Save, SlidersHorizontal } from 'lucide-react';
import { validateKeplerian } from '../../physics/orbits/validation';
import { useSimulationStore } from '../../state/simulationStore';
import type { EditorMode, Satellite } from '../../state/types';
import { NumberField } from '../ui/NumberField';
import { ToggleRow } from '../ui/ToggleRow';
import { Readouts } from './Readouts';

const editorModes: Array<{ value: EditorMode; label: string }> = [
  { value: 'keplerian', label: 'Keplerian' },
  { value: 'cartesian', label: 'Cartesian' },
  { value: 'tle', label: 'TLE' },
];

function PropagationSelector({ satellite }: { satellite: Satellite }) {
  const setPropagationMode = useSimulationStore((state) => state.setPropagationMode);

  return (
    <label className="field">
      <span className="field-label">Propagation</span>
      <select
        value={satellite.propagationMode}
        onChange={(event) => setPropagationMode(satellite.id, event.target.value as Satellite['propagationMode'])}
      >
        <option value="two-body">Two-body</option>
        <option value="sgp4">SGP4 / TLE</option>
        <option disabled>Advanced - Coming later</option>
      </select>
    </label>
  );
}

export function SatelliteEditor() {
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const satellite = useSimulationStore((state) =>
    state.satellites.find((candidate) => candidate.id === selectedSatelliteId),
  );
  const currentTime = useSimulationStore((state) => state.currentTime);
  const renameSatellite = useSimulationStore((state) => state.renameSatellite);
  const updateSatelliteFlags = useSimulationStore((state) => state.updateSatelliteFlags);
  const updateSatelliteColor = useSimulationStore((state) => state.updateSatelliteColor);
  const updateKeplerian = useSimulationStore((state) => state.updateKeplerian);
  const updateCartesianPosition = useSimulationStore((state) => state.updateCartesianPosition);
  const updateCartesianVelocity = useSimulationStore((state) => state.updateCartesianVelocity);
  const updateCartesianEpoch = useSimulationStore((state) => state.updateCartesianEpoch);
  const updateTle = useSimulationStore((state) => state.updateTle);
  const setEditorMode = useSimulationStore((state) => state.setEditorMode);

  if (!satellite) {
    return (
      <aside className="side-panel right-panel">
        <div className="empty-panel">No satellite selected.</div>
      </aside>
    );
  }

  const validation = validateKeplerian(satellite.keplerian);

  return (
    <aside className="side-panel right-panel">
      <div className="panel-heading">
        <span>Satellite</span>
        <Radio size={17} />
      </div>

      <label className="field">
        <span className="field-label">Name</span>
        <input value={satellite.name} onChange={(event) => renameSatellite(satellite.id, event.target.value)} />
      </label>

      <div className="editor-row">
        <label className="color-field" title="Satellite color">
          <Palette size={16} />
          <input type="color" value={satellite.color} onChange={(event) => updateSatelliteColor(satellite.id, event.target.value)} />
        </label>
        <PropagationSelector satellite={satellite} />
      </div>

      <div className="toggle-stack">
        <ToggleRow
          label="Visible"
          checked={satellite.visible}
          onChange={(checked) => updateSatelliteFlags(satellite.id, { visible: checked })}
        />
        <ToggleRow
          label="Orbit trail"
          checked={satellite.showOrbitTrail}
          onChange={(checked) => updateSatelliteFlags(satellite.id, { showOrbitTrail: checked })}
        />
        <ToggleRow
          label="Ground track"
          checked={satellite.showGroundTrack}
          onChange={(checked) => updateSatelliteFlags(satellite.id, { showGroundTrack: checked })}
        />
      </div>

      <div className="mode-tabs" aria-label="Input mode">
        <SlidersHorizontal size={16} />
        {editorModes.map((mode) => (
          <button
            key={mode.value}
            className={satellite.editorMode === mode.value ? 'segmented active' : 'segmented'}
            onClick={() => setEditorMode(satellite.id, mode.value)}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </div>

      {satellite.editorMode === 'keplerian' ? (
        <div className="editor-section">
          <NumberField
            label="Semi-major axis"
            unit="km"
            value={satellite.keplerian.semiMajorAxisKm}
            step={1}
            error={validation.errors.semiMajorAxisKm}
            onChange={(value) => updateKeplerian(satellite.id, { semiMajorAxisKm: value })}
          />
          <NumberField
            label="Eccentricity"
            value={satellite.keplerian.eccentricity}
            step={0.0001}
            min={0}
            max={0.99}
            error={validation.errors.eccentricity}
            onChange={(value) => updateKeplerian(satellite.id, { eccentricity: value })}
          />
          <NumberField
            label="Inclination"
            unit="deg"
            value={satellite.keplerian.inclinationDeg}
            step={0.1}
            min={0}
            max={180}
            error={validation.errors.inclinationDeg}
            onChange={(value) => updateKeplerian(satellite.id, { inclinationDeg: value })}
          />
          <NumberField
            label="RAAN"
            unit="deg"
            value={satellite.keplerian.raanDeg}
            step={0.1}
            onChange={(value) => updateKeplerian(satellite.id, { raanDeg: value })}
          />
          <NumberField
            label="Argument of periapsis"
            unit="deg"
            value={satellite.keplerian.argPeriapsisDeg}
            step={0.1}
            onChange={(value) => updateKeplerian(satellite.id, { argPeriapsisDeg: value })}
          />
          <NumberField
            label="True anomaly"
            unit="deg"
            value={satellite.keplerian.trueAnomalyDeg}
            step={0.1}
            onChange={(value) => updateKeplerian(satellite.id, { trueAnomalyDeg: value })}
          />
          <label className="field">
            <span className="field-label">Epoch</span>
            <input
              type="datetime-local"
              value={satellite.keplerian.epoch.slice(0, 19)}
              onChange={(event) => {
                const date = new Date(event.target.value);
                if (Number.isFinite(date.getTime())) {
                  updateKeplerian(satellite.id, { epoch: date.toISOString() });
                }
              }}
            />
          </label>
        </div>
      ) : null}

      {satellite.editorMode === 'cartesian' ? (
        <div className="editor-section">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <NumberField
              key={`position-${axis}`}
              label={`Position ${axis.toUpperCase()}`}
              unit="km"
              value={satellite.cartesian.positionKm[axis]}
              step={1}
              onChange={(value) => updateCartesianPosition(satellite.id, axis, value)}
            />
          ))}
          {(['x', 'y', 'z'] as const).map((axis) => (
            <NumberField
              key={`velocity-${axis}`}
              label={`Velocity ${axis.toUpperCase()}`}
              unit="km/s"
              value={satellite.cartesian.velocityKmS[axis]}
              step={0.001}
              onChange={(value) => updateCartesianVelocity(satellite.id, axis, value)}
            />
          ))}
          <label className="field">
            <span className="field-label">Epoch</span>
            <input
              type="datetime-local"
              value={satellite.cartesian.epoch.slice(0, 19)}
              onChange={(event) => {
                const date = new Date(event.target.value);
                if (Number.isFinite(date.getTime())) {
                  updateCartesianEpoch(satellite.id, date.toISOString());
                }
              }}
            />
          </label>
        </div>
      ) : null}

      {satellite.editorMode === 'tle' ? (
        <div className="editor-section">
          <label className="field">
            <span className="field-label">Satellite name</span>
            <input value={satellite.tle.name} onChange={(event) => updateTle(satellite.id, 'name', event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Line 1</span>
            <textarea value={satellite.tle.line1} rows={3} onChange={(event) => updateTle(satellite.id, 'line1', event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Line 2</span>
            <textarea value={satellite.tle.line2} rows={3} onChange={(event) => updateTle(satellite.id, 'line2', event.target.value)} />
          </label>
        </div>
      ) : null}

      <div className="panel-heading readout-heading">
        <span>Readouts</span>
        <Save size={16} />
      </div>
      <Readouts satellite={satellite} currentTime={currentTime} />
    </aside>
  );
}
