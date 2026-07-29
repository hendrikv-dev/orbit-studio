import { create } from 'zustand';
import { cartesianToKeplerian, keplerianToCartesian } from '../physics/orbits/conversions';
import type { CartesianState, KeplerianElements } from '../physics/orbits/types';
import { validateCartesian, validateKeplerian } from '../physics/orbits/validation';
import { parseTle, type TleInput } from '../physics/propagators/tle';
import {
  stateFromTleOrFallback,
  type PropagationMode,
  type SatelliteInputMode
} from '../physics/propagators/satellite';
import { createScenarioDocument, parseScenarioJson } from '../scenario/schema';
import { degToRad } from '../utils/math';
import { createSampleSatellite, createSatelliteFromTemplate } from './sample';
import type { CameraPreset, RenderSettings, SatelliteRecord } from './types';

interface ApsisState {
  scenarioName: string;
  simulationEpoch: string;
  currentTimeMs: number;
  playing: boolean;
  realtime: boolean;
  timeScale: number;
  timeDirection: 1 | -1;
  renderSettings: RenderSettings;
  cameraPreset: CameraPreset;
  selectedSatelliteId: string;
  satellites: SatelliteRecord[];
  lastImportError: string | null;
  tick: (deltaMs: number) => void;
  setPlaying: (playing: boolean) => void;
  setRealtime: () => void;
  setTimeScale: (scale: number) => void;
  setTimeDirection: (direction: 1 | -1) => void;
  setCurrentTime: (ms: number) => void;
  resetToNow: () => void;
  setCameraPreset: (preset: CameraPreset) => void;
  updateRenderSettings: (settings: Partial<RenderSettings>) => void;
  addSatellite: () => void;
  duplicateSatellite: (id: string) => void;
  deleteSatellite: (id: string) => void;
  selectSatellite: (id: string) => void;
  updateSatelliteMeta: (id: string, patch: Partial<Pick<SatelliteRecord, 'name' | 'color'>>) => void;
  updateSatelliteVisualization: (id: string, patch: Partial<SatelliteRecord['visualization']>) => void;
  setSatelliteInputMode: (id: string, inputMode: SatelliteInputMode) => void;
  setSatellitePropagationMode: (id: string, propagationMode: PropagationMode) => void;
  updateKeplerian: (id: string, patch: Partial<KeplerianElements>) => void;
  updateCartesian: (id: string, patch: Partial<CartesianState>) => void;
  updateTle: (id: string, patch: Partial<TleInput>) => void;
  exportScenarioJson: () => string;
  importScenarioJson: (json: string) => boolean;
}

const initialTime = Date.now();
const sampleSatellite = createSampleSatellite(new Date(initialTime).toISOString());
const palette = ['#59d4ff', '#f6c65b', '#77e58a', '#ff7f95', '#b6d3ff'];

export const useApsisStore = create<ApsisState>((set, get) => ({
  scenarioName: 'Untitled Apsis Scenario',
  simulationEpoch: new Date(initialTime).toISOString(),
  currentTimeMs: initialTime,
  playing: true,
  realtime: true,
  timeScale: 1,
  timeDirection: 1,
  renderSettings: {
    quality: 'high',
    clouds: true,
    nightLights: true,
    groundGrid: true
  },
  cameraPreset: 'free',
  selectedSatelliteId: sampleSatellite.id,
  satellites: [sampleSatellite],
  lastImportError: null,
  tick(deltaMs) {
    set((state) => {
      if (!state.playing) return {};
      if (state.realtime && state.timeScale === 1 && state.timeDirection === 1) {
        return { currentTimeMs: Date.now() };
      }
      return {
        currentTimeMs: state.currentTimeMs + deltaMs * state.timeScale * state.timeDirection,
        realtime: false
      };
    });
  },
  setPlaying(playing) {
    set({ playing });
  },
  setRealtime() {
    set({
      playing: true,
      realtime: true,
      timeScale: 1,
      timeDirection: 1,
      currentTimeMs: Date.now()
    });
  },
  setTimeScale(timeScale) {
    set({ timeScale, realtime: false });
  },
  setTimeDirection(timeDirection) {
    set({ timeDirection, realtime: false });
  },
  setCurrentTime(currentTimeMs) {
    set({ currentTimeMs, realtime: false });
  },
  resetToNow() {
    set({ currentTimeMs: Date.now(), realtime: true, timeScale: 1, timeDirection: 1 });
  },
  setCameraPreset(cameraPreset) {
    set({ cameraPreset });
  },
  updateRenderSettings(settings) {
    set((state) => ({
      renderSettings: { ...state.renderSettings, ...settings }
    }));
  },
  addSatellite() {
    set((state) => {
      const index = state.satellites.length + 1;
      const satellite = createSatelliteFromTemplate(
        `Satellite ${index}`,
        palette[index % palette.length],
        new Date(state.currentTimeMs).toISOString(),
        degToRad(index * 37)
      );
      return {
        satellites: [...state.satellites, satellite],
        selectedSatelliteId: satellite.id
      };
    });
  },
  duplicateSatellite(id) {
    set((state) => {
      const source = state.satellites.find((satellite) => satellite.id === id);
      if (!source) return {};
      const duplicate: SatelliteRecord = {
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} Copy`,
        keplerian: {
          ...source.keplerian,
          trueAnomaly: source.keplerian.trueAnomaly + degToRad(18)
        },
        tle: { ...source.tle },
        visualization: { ...source.visualization },
        validation: { ...source.validation }
      };
      duplicate.cartesian = keplerianToCartesian(duplicate.keplerian);
      return {
        satellites: [...state.satellites, duplicate],
        selectedSatelliteId: duplicate.id
      };
    });
  },
  deleteSatellite(id) {
    set((state) => {
      if (state.satellites.length <= 1) return {};
      const satellites = state.satellites.filter((satellite) => satellite.id !== id);
      return {
        satellites,
        selectedSatelliteId:
          state.selectedSatelliteId === id ? satellites[0].id : state.selectedSatelliteId
      };
    });
  },
  selectSatellite(selectedSatelliteId) {
    set({ selectedSatelliteId });
  },
  updateSatelliteMeta(id, patch) {
    updateSatellite(set, id, (satellite) => ({ ...satellite, ...patch }));
  },
  updateSatelliteVisualization(id, patch) {
    updateSatellite(set, id, (satellite) => ({
      ...satellite,
      visualization: { ...satellite.visualization, ...patch }
    }));
  },
  setSatelliteInputMode(id, inputMode) {
    updateSatellite(set, id, (satellite) => ({ ...satellite, inputMode }));
  },
  setSatellitePropagationMode(id, propagationMode) {
    updateSatellite(set, id, (satellite) => ({ ...satellite, propagationMode }));
  },
  updateKeplerian(id, patch) {
    updateSatellite(set, id, (satellite) => {
      const keplerian = { ...satellite.keplerian, ...patch };
      const errors = validateKeplerian(keplerian);
      if (errors.length > 0) {
        return {
          ...satellite,
          inputMode: 'keplerian',
          keplerian,
          validation: { ...satellite.validation, keplerian: errors }
        };
      }
      return {
        ...satellite,
        inputMode: 'keplerian',
        propagationMode: satellite.propagationMode === 'sgp4' ? 'two-body' : satellite.propagationMode,
        keplerian,
        cartesian: keplerianToCartesian(keplerian, new Date(keplerian.epoch)),
        validation: { ...satellite.validation, keplerian: [], cartesian: [] }
      };
    });
  },
  updateCartesian(id, patch) {
    updateSatellite(set, id, (satellite) => {
      const cartesian = { ...satellite.cartesian, ...patch };
      const errors = validateCartesian(cartesian);
      if (errors.length > 0) {
        return {
          ...satellite,
          inputMode: 'cartesian',
          cartesian,
          validation: { ...satellite.validation, cartesian: errors }
        };
      }
      return {
        ...satellite,
        inputMode: 'cartesian',
        propagationMode: satellite.propagationMode === 'sgp4' ? 'two-body' : satellite.propagationMode,
        cartesian,
        keplerian: cartesianToKeplerian(cartesian),
        validation: { ...satellite.validation, keplerian: [], cartesian: [] }
      };
    });
  },
  updateTle(id, patch) {
    const at = new Date(get().currentTimeMs);
    updateSatellite(set, id, (satellite) => {
      const tle = { ...satellite.tle, ...patch };
      const parsed = parseTle(tle);
      const nextState = stateFromTleOrFallback(tle, at, satellite.cartesian);
      return {
        ...satellite,
        name: patch.name ?? satellite.name,
        inputMode: 'tle',
        propagationMode: nextState.valid ? 'sgp4' : satellite.propagationMode,
        tle,
        cartesian: nextState.cartesian,
        keplerian: nextState.keplerian,
        validation: { ...satellite.validation, tle: parsed.error }
      };
    });
  },
  exportScenarioJson() {
    const state = get();
    return JSON.stringify(
      createScenarioDocument({
        scenarioName: state.scenarioName,
        simulationEpoch: state.simulationEpoch,
        currentTimeMs: state.currentTimeMs,
        timeScale: state.timeScale,
        playing: state.playing,
        renderSettings: state.renderSettings,
        cameraPreset: state.cameraPreset,
        satellites: state.satellites
      }),
      null,
      2
    );
  },
  importScenarioJson(json) {
    const result = parseScenarioJson(json);
    if (!result.ok || !result.value) {
      set({ lastImportError: result.errors.join(' ') });
      return false;
    }

    set({
      scenarioName: result.value.scenarioName,
      simulationEpoch: result.value.simulationEpoch,
      currentTimeMs: Date.parse(result.value.currentSimulationTime),
      timeScale: result.value.timeScale,
      playing: result.value.playing,
      realtime: false,
      renderSettings: result.value.renderSettings,
      cameraPreset: result.value.cameraSettings.preset,
      satellites: result.value.satellites,
      selectedSatelliteId: result.value.satellites[0]?.id ?? '',
      lastImportError: null
    });
    return true;
  }
}));

function updateSatellite(
  set: typeof useApsisStore.setState,
  id: string,
  updater: (satellite: SatelliteRecord) => SatelliteRecord
): void {
  set((state) => ({
    satellites: state.satellites.map((satellite) =>
      satellite.id === id ? updater(satellite) : satellite
    )
  }));
}
