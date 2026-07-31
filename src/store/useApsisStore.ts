import { create } from "zustand";
import { cartesianToKeplerian, keplerianToCartesian, validateCartesian, validateKeplerian } from "../physics/orbit";
import { tleToKeplerian, validateTle } from "../physics/tle";
import { createDefaultScenario, createSampleSatellite } from "../scenario/defaultScenario";
import type { CameraPreset, RenderQuality, Scenario } from "../scenario/schema";
import type { CartesianState, KeplerianElements, PropagationMode, Satellite, SatelliteInputMode, TleSource } from "../types/orbit";

interface ApsisState {
  scenario: Scenario;
  selectedSatelliteId: string;
  validation: Record<string, string[]>;
  selectSatellite: (id: string) => void;
  addSatellite: () => void;
  duplicateSatellite: (id: string) => void;
  deleteSatellite: (id: string) => void;
  updateSatellite: (id: string, patch: Partial<Satellite>) => void;
  updateKeplerian: (id: string, patch: Partial<KeplerianElements>) => void;
  updateCartesian: (id: string, patch: Partial<CartesianState>) => void;
  updateTle: (id: string, tle: TleSource) => void;
  setInputMode: (id: string, mode: SatelliteInputMode) => void;
  setPropagationMode: (id: string, mode: PropagationMode) => void;
  setTimeScale: (scale: number) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (isoTime: string) => void;
  resetTimeToNow: () => void;
  tick: (realSeconds: number) => void;
  setRenderSetting: <K extends keyof Scenario["renderSettings"]>(key: K, value: Scenario["renderSettings"][K]) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  setScenario: (scenario: Scenario) => void;
  setScenarioName: (name: string) => void;
}

const initialScenario = createDefaultScenario();

export const useApsisStore = create<ApsisState>((set, get) => ({
  scenario: initialScenario,
  selectedSatelliteId: initialScenario.satellites[0]?.id ?? "",
  validation: {},
  selectSatellite: (id) => set({ selectedSatelliteId: id }),
  addSatellite: () =>
    set((state) => {
      const satellite = createSampleSatellite();
      satellite.name = `Satellite ${state.scenario.satellites.length + 1}`;
      satellite.color = nextColor(state.scenario.satellites.length);
      return {
        scenario: {
          ...state.scenario,
          satellites: [...state.scenario.satellites, satellite]
        },
        selectedSatelliteId: satellite.id
      };
    }),
  duplicateSatellite: (id) =>
    set((state) => {
      const original = state.scenario.satellites.find((satellite) => satellite.id === id);
      if (!original) {
        return state;
      }
      const clone: Satellite = {
        ...structuredClone(original),
        id: crypto.randomUUID(),
        name: `${original.name} Copy`,
        color: nextColor(state.scenario.satellites.length)
      };
      return {
        scenario: {
          ...state.scenario,
          satellites: [...state.scenario.satellites, clone]
        },
        selectedSatelliteId: clone.id
      };
    }),
  deleteSatellite: (id) =>
    set((state) => {
      const satellites = state.scenario.satellites.filter((satellite) => satellite.id !== id);
      return {
        scenario: {
          ...state.scenario,
          satellites
        },
        selectedSatelliteId:
          state.selectedSatelliteId === id ? satellites[0]?.id ?? "" : state.selectedSatelliteId
      };
    }),
  updateSatellite: (id, patch) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        satellites: state.scenario.satellites.map((satellite) =>
          satellite.id === id ? { ...satellite, ...patch } : satellite
        )
      }
    })),
  updateKeplerian: (id, patch) =>
    set((state) => {
      const validation = { ...state.validation };
      const satellites = state.scenario.satellites.map((satellite) => {
        if (satellite.id !== id) {
          return satellite;
        }
        const keplerian = { ...satellite.keplerian, ...patch };
        const errors = validateKeplerian(keplerian);
        validation[id] = errors;
        const updated: Satellite = {
          ...satellite,
          inputMode: "keplerian" as const,
          propagationMode: satellite.propagationMode === "sgp4" ? "two-body" : satellite.propagationMode,
          keplerian,
          cartesian: errors.length === 0 ? keplerianToCartesian(keplerian) : satellite.cartesian
        };
        return updated;
      });
      return {
        validation,
        scenario: { ...state.scenario, satellites }
      };
    }),
  updateCartesian: (id, patch) =>
    set((state) => {
      const validation = { ...state.validation };
      const satellites = state.scenario.satellites.map((satellite) => {
        if (satellite.id !== id) {
          return satellite;
        }
        const cartesian = { ...satellite.cartesian, ...patch };
        const errors = validateCartesian(cartesian);
        validation[id] = errors;
        const updated: Satellite = {
          ...satellite,
          inputMode: "cartesian" as const,
          propagationMode: satellite.propagationMode === "sgp4" ? "two-body" : satellite.propagationMode,
          cartesian,
          keplerian: errors.length === 0 ? cartesianToKeplerian(cartesian) : satellite.keplerian
        };
        return updated;
      });
      return {
        validation,
        scenario: { ...state.scenario, satellites }
      };
    }),
  updateTle: (id, tle) =>
    set((state) => {
      const validation = { ...state.validation };
      const satellites = state.scenario.satellites.map((satellite) => {
        if (satellite.id !== id) {
          return satellite;
        }
        const errors = validateTle(tle);
        const date = state.scenario.currentTime;
        const tleKeplerian = errors.length === 0 ? tleToKeplerian(tle, date) : null;
        validation[id] = errors;
        const updated: Satellite = {
          ...satellite,
          name: tle.name || satellite.name,
          inputMode: "tle" as const,
          propagationMode: "sgp4" as const,
          tle,
          keplerian: tleKeplerian ?? satellite.keplerian,
          cartesian: tleKeplerian ? keplerianToCartesian(tleKeplerian) : satellite.cartesian
        };
        return updated;
      });
      return {
        validation,
        scenario: { ...state.scenario, satellites }
      };
    }),
  setInputMode: (id, mode) => get().updateSatellite(id, { inputMode: mode }),
  setPropagationMode: (id, mode) => get().updateSatellite(id, { propagationMode: mode }),
  setTimeScale: (scale) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        timeScale: scale
      }
    })),
  setPlaying: (playing) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        isPlaying: playing
      }
    })),
  setCurrentTime: (isoTime) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        currentTime: isoTime
      }
    })),
  resetTimeToNow: () =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        currentTime: new Date().toISOString(),
        timeScale: 1,
        isPlaying: true
      }
    })),
  tick: (realSeconds) =>
    set((state) => {
      if (!state.scenario.isPlaying) {
        return state;
      }
      return {
        scenario: {
          ...state.scenario,
          currentTime: new Date(
            new Date(state.scenario.currentTime).getTime() + realSeconds * state.scenario.timeScale * 1000
          ).toISOString()
        }
      };
    }),
  setRenderSetting: (key, value) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        renderSettings: {
          ...state.scenario.renderSettings,
          [key]: value
        }
      }
    })),
  setCameraPreset: (preset) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          preset
        }
      }
    })),
  setScenario: (scenario) =>
    set({
      scenario,
      selectedSatelliteId: scenario.satellites[0]?.id ?? "",
      validation: {}
    }),
  setScenarioName: (name) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        name
      }
    }))
}));

function nextColor(index: number): string {
  return ["#2de2b8", "#78a8ff", "#ffcf5a", "#ff7f9f", "#a4f86f", "#e6e8ff"][index % 6];
}

export function selectSelectedSatellite(state: ApsisState): Satellite | undefined {
  return state.scenario.satellites.find((satellite) => satellite.id === state.selectedSatelliteId);
}

export type { ApsisState, RenderQuality };
