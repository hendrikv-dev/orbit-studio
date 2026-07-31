import { create } from 'zustand';
import { cartesianToKeplerian, keplerianToCartesian } from '../physics/orbits/conversions';
import type { CartesianState, KeplerianElements, PropagationMode } from '../physics/orbits/types';
import { createDefaultScenario, createSampleSatellite } from '../scenario/sample';
import { parseScenarioJson, serializeScenario } from '../scenario/schema';
import type { CameraPreset, QualityLevel, Satellite, ScenarioState } from './types';
import { createId } from '../utils/id';

type ImportFeedback = {
  type: 'idle' | 'success' | 'error';
  message: string;
};

type SimulationStore = ScenarioState & {
  isPlaying: boolean;
  lastTickMs: number;
  importFeedback: ImportFeedback;
  selectSatellite: (id: string | null) => void;
  addSatellite: () => void;
  duplicateSatellite: (id: string) => void;
  deleteSatellite: (id: string) => void;
  renameSatellite: (id: string, name: string) => void;
  updateSatelliteFlags: (id: string, patch: Partial<Pick<Satellite, 'visible' | 'showOrbitTrail' | 'showGroundTrack'>>) => void;
  updateSatelliteColor: (id: string, color: string) => void;
  updateKeplerian: (id: string, patch: Partial<KeplerianElements>) => void;
  updateCartesianPosition: (id: string, axis: 'x' | 'y' | 'z', value: number) => void;
  updateCartesianVelocity: (id: string, axis: 'x' | 'y' | 'z', value: number) => void;
  updateCartesianEpoch: (id: string, epoch: string) => void;
  updateTle: (id: string, field: 'name' | 'line1' | 'line2', value: string) => void;
  setEditorMode: (id: string, editorMode: Satellite['editorMode']) => void;
  setPropagationMode: (id: string, propagationMode: PropagationMode) => void;
  togglePlaying: () => void;
  setPlaying: (isPlaying: boolean) => void;
  setTimeScale: (timeScale: number) => void;
  tickSimulation: (nowMs?: number) => void;
  resetToNow: () => void;
  setCurrentTime: (isoTime: string) => void;
  setScenarioName: (name: string) => void;
  setQuality: (quality: QualityLevel) => void;
  setRenderSetting: (setting: 'cloudsEnabled' | 'nightLightsEnabled' | 'groundTracksEnabled', enabled: boolean) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  exportScenarioJson: () => string;
  importScenarioJson: (json: string) => ImportFeedback;
};

const defaultScenario = createDefaultScenario();

const withSelected = (
  satellites: Satellite[],
  selectedSatelliteId: string | null,
): Pick<ScenarioState, 'satellites' | 'selectedSatelliteId'> => ({
  satellites,
  selectedSatelliteId:
    selectedSatelliteId && satellites.some((satellite) => satellite.id === selectedSatelliteId)
      ? selectedSatelliteId
      : satellites[0]?.id ?? null,
});

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  ...defaultScenario,
  isPlaying: true,
  lastTickMs: Date.now(),
  importFeedback: {
    type: 'idle',
    message: '',
  },

  selectSatellite: (id) => set({ selectedSatelliteId: id }),

  addSatellite: () =>
    set((state) => {
      const satellite = createSampleSatellite(state.currentTime);
      satellite.name = `Satellite ${state.satellites.length + 1}`;
      satellite.color = ['#68d8ff', '#ffd166', '#7dffb2', '#ff7aa2', '#f4f1bb'][state.satellites.length % 5];
      return {
        satellites: [...state.satellites, satellite],
        selectedSatelliteId: satellite.id,
      };
    }),

  duplicateSatellite: (id) =>
    set((state) => {
      const source = state.satellites.find((satellite) => satellite.id === id);
      if (!source) {
        return {};
      }

      const duplicate: Satellite = {
        ...source,
        id: createId('sat'),
        name: `${source.name} Copy`,
        keplerian: {
          ...source.keplerian,
          raanDeg: (source.keplerian.raanDeg + 8) % 360,
          trueAnomalyDeg: (source.keplerian.trueAnomalyDeg + 18) % 360,
        },
      };
      duplicate.cartesian = keplerianToCartesian(duplicate.keplerian);

      return {
        satellites: [...state.satellites, duplicate],
        selectedSatelliteId: duplicate.id,
      };
    }),

  deleteSatellite: (id) =>
    set((state) =>
      withSelected(
        state.satellites.filter((satellite) => satellite.id !== id),
        state.selectedSatelliteId === id ? null : state.selectedSatelliteId,
      ),
    ),

  renameSatellite: (id, name) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) =>
        satellite.id === id ? { ...satellite, name: name.trimStart() } : satellite,
      ),
    })),

  updateSatelliteFlags: (id, patch) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) =>
        satellite.id === id ? { ...satellite, ...patch } : satellite,
      ),
    })),

  updateSatelliteColor: (id, color) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) =>
        satellite.id === id ? { ...satellite, color } : satellite,
      ),
    })),

  updateKeplerian: (id, patch) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) => {
        if (satellite.id !== id) {
          return satellite;
        }

        const keplerian = {
          ...satellite.keplerian,
          ...patch,
        };

        return {
          ...satellite,
          editorMode: 'keplerian',
          keplerian,
          cartesian: keplerianToCartesian(keplerian),
        };
      }),
    })),

  updateCartesianPosition: (id, axis, value) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) => {
        if (satellite.id !== id) {
          return satellite;
        }

        const cartesian: CartesianState = {
          ...satellite.cartesian,
          positionKm: {
            ...satellite.cartesian.positionKm,
            [axis]: value,
          },
        };

        return {
          ...satellite,
          editorMode: 'cartesian',
          cartesian,
          keplerian: cartesianToKeplerian(cartesian),
        };
      }),
    })),

  updateCartesianVelocity: (id, axis, value) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) => {
        if (satellite.id !== id) {
          return satellite;
        }

        const cartesian: CartesianState = {
          ...satellite.cartesian,
          velocityKmS: {
            ...satellite.cartesian.velocityKmS,
            [axis]: value,
          },
        };

        return {
          ...satellite,
          editorMode: 'cartesian',
          cartesian,
          keplerian: cartesianToKeplerian(cartesian),
        };
      }),
    })),

  updateCartesianEpoch: (id, epoch) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) => {
        if (satellite.id !== id) {
          return satellite;
        }
        const cartesian = { ...satellite.cartesian, epoch };
        return {
          ...satellite,
          editorMode: 'cartesian',
          cartesian,
          keplerian: cartesianToKeplerian(cartesian),
        };
      }),
    })),

  updateTle: (id, field, value) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) =>
        satellite.id === id
          ? {
              ...satellite,
              editorMode: 'tle',
              tle: {
                ...satellite.tle,
                [field]: value,
              },
            }
          : satellite,
      ),
    })),

  setEditorMode: (id, editorMode) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) =>
        satellite.id === id ? { ...satellite, editorMode } : satellite,
      ),
    })),

  setPropagationMode: (id, propagationMode) =>
    set((state) => ({
      satellites: state.satellites.map((satellite) =>
        satellite.id === id ? { ...satellite, propagationMode } : satellite,
      ),
    })),

  togglePlaying: () => set((state) => ({ isPlaying: !state.isPlaying, lastTickMs: Date.now() })),

  setPlaying: (isPlaying) => set({ isPlaying, lastTickMs: Date.now() }),

  setTimeScale: (timeScale) => set({ timeScale }),

  tickSimulation: (nowMs = Date.now()) =>
    set((state) => {
      if (!state.isPlaying) {
        return { lastTickMs: nowMs };
      }

      const elapsedMs = nowMs - state.lastTickMs;
      const currentMs = new Date(state.currentTime).getTime();
      const nextTime = new Date(currentMs + elapsedMs * state.timeScale).toISOString();

      return {
        currentTime: nextTime,
        lastTickMs: nowMs,
      };
    }),

  resetToNow: () => {
    const now = new Date().toISOString();
    set({
      currentTime: now,
      simulationEpoch: now,
      lastTickMs: Date.now(),
    });
  },

  setCurrentTime: (isoTime) => {
    const parsed = Date.parse(isoTime);
    if (Number.isFinite(parsed)) {
      set({ currentTime: new Date(parsed).toISOString(), lastTickMs: Date.now() });
    }
  },

  setScenarioName: (name) => set({ scenarioName: name }),

  setQuality: (quality) =>
    set((state) => ({
      renderSettings: {
        ...state.renderSettings,
        quality,
      },
    })),

  setRenderSetting: (setting, enabled) =>
    set((state) => ({
      renderSettings: {
        ...state.renderSettings,
        [setting]: enabled,
      },
    })),

  setCameraPreset: (preset) =>
    set((state) => ({
      cameraSettings: {
        ...state.cameraSettings,
        preset,
      },
    })),

  exportScenarioJson: () => serializeScenario(get()),

  importScenarioJson: (json) => {
    const result = parseScenarioJson(json);
    if (!result.ok) {
      const feedback = { type: 'error' as const, message: result.errors.join(' ') };
      set({ importFeedback: feedback });
      return feedback;
    }

    const feedback = { type: 'success' as const, message: 'Scenario imported.' };
    set({
      ...result.scenario,
      importFeedback: feedback,
      isPlaying: true,
      lastTickMs: Date.now(),
    });
    return feedback;
  },
}));
