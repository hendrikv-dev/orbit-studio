import { Download, Eye, FileUp, Gauge, Globe2, Satellite, Settings2 } from 'lucide-react';
import { useRef } from 'react';
import { useSimulationStore } from '../../state/simulationStore';
import type { CameraPreset, QualityLevel } from '../../state/types';

const cameraPresets: Array<{ value: CameraPreset; label: string }> = [
  { value: 'free', label: 'Free' },
  { value: 'equatorial', label: 'Equatorial' },
  { value: 'polar', label: 'Polar' },
  { value: 'follow', label: 'Follow' },
  { value: 'ground-track', label: 'Ground' },
];

const qualities: QualityLevel[] = ['low', 'medium', 'high'];

export function TopBar() {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const scenarioName = useSimulationStore((state) => state.scenarioName);
  const cameraPreset = useSimulationStore((state) => state.cameraSettings.preset);
  const renderSettings = useSimulationStore((state) => state.renderSettings);
  const setCameraPreset = useSimulationStore((state) => state.setCameraPreset);
  const setQuality = useSimulationStore((state) => state.setQuality);
  const setRenderSetting = useSimulationStore((state) => state.setRenderSetting);
  const exportScenarioJson = useSimulationStore((state) => state.exportScenarioJson);
  const importScenarioJson = useSimulationStore((state) => state.importScenarioJson);

  const handleExport = () => {
    const blob = new Blob([exportScenarioJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'apsis-scenario'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    importScenarioJson(await file.text());
    if (fileInput.current) {
      fileInput.current.value = '';
    }
  };

  return (
    <header className="top-bar">
      <div className="brand-block">
        <Globe2 size={22} />
        <div>
          <div className="brand-name">Apsis</div>
          <div className="brand-tagline">Design, simulate, and share orbital systems.</div>
        </div>
      </div>

      <div className="toolbar-group" aria-label="View presets">
        <Eye size={16} />
        {cameraPresets.map((preset) => (
          <button
            key={preset.value}
            className={cameraPreset === preset.value ? 'segmented active' : 'segmented'}
            onClick={() => setCameraPreset(preset.value)}
            title={`${preset.label} view`}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="toolbar-group compact" aria-label="Render settings">
        <Gauge size={16} />
        <select value={renderSettings.quality} onChange={(event) => setQuality(event.target.value as QualityLevel)}>
          {qualities.map((quality) => (
            <option key={quality} value={quality}>
              {quality[0].toUpperCase() + quality.slice(1)}
            </option>
          ))}
        </select>
        <label className="icon-toggle" title="Cloud layer">
          <input
            type="checkbox"
            checked={renderSettings.cloudsEnabled}
            onChange={(event) => setRenderSetting('cloudsEnabled', event.target.checked)}
          />
          <Settings2 size={16} />
        </label>
        <label className="icon-toggle" title="Night lights layer">
          <input
            type="checkbox"
            checked={renderSettings.nightLightsEnabled}
            onChange={(event) => setRenderSetting('nightLightsEnabled', event.target.checked)}
          />
          <Satellite size={16} />
        </label>
      </div>

      <div className="toolbar-group action-cluster">
        <button className="icon-button label-button" onClick={() => fileInput.current?.click()} title="Import scenario" type="button">
          <FileUp size={16} />
          Import
        </button>
        <button className="icon-button label-button primary" onClick={handleExport} title="Export scenario" type="button">
          <Download size={16} />
          Export
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void handleImport(event.target.files?.[0])}
        />
      </div>
    </header>
  );
}
