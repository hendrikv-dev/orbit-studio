import { create } from "zustand";
import {
  cartesianToKeplerian,
  isValidCartesian,
  isValidKeplerian,
  keplerianToCartesian,
} from "../physics/kepler";
import { tleToCartesian, validateTle } from "../physics/tle";
import type { CartesianState, KeplerianElements } from "../physics/types";
import { dateForNearRealTimeGibs } from "../data/earthLayers";
import type { EarthCloudMode, EarthLayerStatus } from "../data/earthLayers";
import { explainKeplerianChange, type OrbitExplanation } from "../lib/orbitEducation";
import { parseSimulationTimeUtc } from "../lib/format";
import {
  configureStudioPlaybackClock,
  readStudioPlaybackTimeIso,
  resetStudioPlaybackClock,
} from "./studioPlaybackClock";
import {
  createConstellation,
  createDefaultScenario,
  createGroundStation,
  createId,
  createRegion,
  createSampleKeplerian,
  createSampleCatalogLayer,
  createSatellite,
  normalizeImportedScenario,
  type CameraSettings,
  type CatalogLayerModel,
  type ConstellationModel,
  type CoverageSettings,
  type EducationalOverlay,
  type EditorMode,
  type GroundStationModel,
  type PropagationMode,
  type RegionModel,
  type RegionType,
  type RenderSettings,
  type SatelliteModel,
  type SatelliteSensorSettings,
  type SatelliteVisualization,
  type Scenario,
  type SelectedObjectType,
} from "../lib/scenario";

type VectorField = "positionKm" | "velocityKmS";
export type CoverageMode = "satellite" | "constellation" | "ground-station" | "combined";
export type LabelMode = "priority" | "selected" | "all" | "hidden";
export type HierarchySection =
  | "satellites"
  | "constellations"
  | "groundStations"
  | "regions"
  | "catalogLayers";

interface VisibilityFilters {
  selectedOnly: boolean;
  payloads: boolean;
  debris: boolean;
  rocketBodies: boolean;
  constellations: boolean;
  stations: boolean;
  regions: boolean;
  catalog: boolean;
}

interface WorkspaceState {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  focusMode: boolean;
  hierarchyExpanded: Record<HierarchySection, boolean>;
  expandedConstellationIds: string[];
  visibilityFilters: VisibilityFilters;
  coverageMode: CoverageMode;
  labelMode: LabelMode;
}

interface SimulationStore {
  scenario: Scenario;
  selectedSatelliteId: string | null;
  selectedGroundStationId: string | null;
  selectedRegionId: string | null;
  selectedConstellationId: string | null;
  isPlaying: boolean;
  importError: string | null;
  lastOrbitExplanation: OrbitExplanation | null;
  workspace: WorkspaceState;
  tick: (elapsedMs: number) => void;
  setPlaying: (isPlaying: boolean) => void;
  setTimeScale: (timeScale: number) => void;
  setReverse: (isReverse: boolean) => void;
  setSimulationTime: (isoString: string) => void;
  resetSimulationTime: () => void;
  setScenarioName: (name: string) => void;
  addSatellite: () => void;
  duplicateSatellite: (satelliteId: string) => void;
  deleteSatellite: (satelliteId: string) => void;
  selectSatellite: (satelliteId: string) => void;
  selectGroundStation: (stationId: string) => void;
  selectRegion: (regionId: string) => void;
  selectConstellation: (constellationId: string) => void;
  selectCatalogObject: (objectId: string) => void;
  clearSelection: () => void;
  setSelectedObject: (type: SelectedObjectType, objectId: string | null) => void;
  updateSatelliteName: (satelliteId: string, name: string) => void;
  updateSatelliteVisualization: (
    satelliteId: string,
    patch: Partial<SatelliteVisualization>,
  ) => void;
  updateSatelliteSensor: (satelliteId: string, patch: Partial<SatelliteSensorSettings>) => void;
  setEditorMode: (satelliteId: string, editorMode: EditorMode) => void;
  setPropagationMode: (satelliteId: string, propagationMode: PropagationMode) => void;
  updateKeplerian: (satelliteId: string, patch: Partial<KeplerianElements>) => void;
  updateCartesianVector: (
    satelliteId: string,
    field: VectorField,
    index: 0 | 1 | 2,
    value: number,
  ) => void;
  updateCartesianEpoch: (satelliteId: string, epoch: string) => void;
  updateTle: (
    satelliteId: string,
    patch: Partial<NonNullable<SatelliteModel["tle"]>>,
  ) => void;
  addGroundStation: () => void;
  deleteGroundStation: (stationId: string) => void;
  updateGroundStation: (stationId: string, patch: Partial<GroundStationModel>) => void;
  addRegion: () => void;
  deleteRegion: (regionId: string) => void;
  updateRegion: (regionId: string, patch: Partial<RegionModel>) => void;
  addConstellation: () => void;
  deleteConstellation: (constellationId: string) => void;
  updateConstellation: (constellationId: string, patch: Partial<ConstellationModel>) => void;
  setConstellationVisibilityMode: (constellationId: string | "all") => void;
  generateWalkerDelta: () => void;
  generateCircularRing: () => void;
  generatePolarNetwork: () => void;
  loadSampleCatalog: () => void;
  toggleCatalogLayer: (layerId: string) => void;
  toggleCatalogObject: (layerId: string, objectId: string) => void;
  setRenderSetting: <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) => void;
  setEarthCloudMode: (cloudMode: EarthCloudMode) => void;
  refreshEarthLiveLayer: () => void;
  setEarthLiveLayerStatus: (
    status: EarthLayerStatus,
    errorMessage?: string | null,
  ) => void;
  setCoverageSetting: <K extends keyof CoverageSettings>(key: K, value: CoverageSettings[K]) => void;
  setCoverageMode: (coverageMode: CoverageMode) => void;
  setLabelMode: (labelMode: LabelMode) => void;
  toggleHierarchySection: (section: HierarchySection) => void;
  toggleConstellationExpanded: (constellationId: string) => void;
  setPanelCollapsed: (panel: "left" | "right", collapsed: boolean) => void;
  setFocusMode: (focusMode: boolean) => void;
  toggleFocusMode: () => void;
  setVisibilityFilter: <K extends keyof VisibilityFilters>(
    key: K,
    value: VisibilityFilters[K],
  ) => void;
  setEducationalOverlay: (overlay: EducationalOverlay) => void;
  setTeacherMode: (teacherMode: boolean) => void;
  setViewPreset: (viewPreset: CameraSettings["viewPreset"]) => void;
  setCameraMode: (cameraMode: CameraSettings["cameraMode"]) => void;
  setFollowSelectedObject: (followSelectedObject: boolean) => void;
  loadScenario: (scenario: Scenario) => void;
  loadScenarioJson: (json: string) => void;
  clearImportError: () => void;
}

const initialScenario = createDefaultScenario();
resetStudioPlaybackClock({
  simulationTimeUtc: initialScenario.simulationTimeUtc,
  isPlaying: true,
  timeScale: initialScenario.timeScale,
  isReverse: initialScenario.isReverse,
});

function selectedSatelliteIdForScenario(scenario: Scenario): string | null {
  if (scenario.selectedObjectType === "satellite") {
    return scenario.selectedObjectId;
  }

  return null;
}

function selectedGroundStationIdForScenario(scenario: Scenario): string | null {
  if (scenario.selectedObjectType === "ground-station") {
    return scenario.selectedObjectId;
  }

  return null;
}

function selectedRegionIdForScenario(scenario: Scenario): string | null {
  if (scenario.selectedObjectType === "region") {
    return scenario.selectedObjectId;
  }

  return null;
}

function selectedConstellationIdForScenario(scenario: Scenario): string | null {
  if (scenario.selectedObjectType === "constellation") {
    return scenario.selectedObjectId;
  }

  return null;
}

function updateSatellite(
  scenario: Scenario,
  satelliteId: string,
  updater: (satellite: SatelliteModel) => SatelliteModel,
): Scenario {
  return {
    ...scenario,
    satellites: scenario.satellites.map((satellite) =>
      satellite.id === satelliteId ? updater(satellite) : satellite,
    ),
  };
}

function withValidKeplerianUpdate(
  satellite: SatelliteModel,
  keplerian: KeplerianElements,
): SatelliteModel {
  if (!isValidKeplerian(keplerian)) {
    return {
      ...satellite,
      keplerian,
      editorMode: "keplerian",
    };
  }

  return {
    ...satellite,
    keplerian,
    cartesian: keplerianToCartesian(keplerian),
    editorMode: "keplerian",
  };
}

function withValidCartesianUpdate(
  satellite: SatelliteModel,
  cartesian: CartesianState,
): SatelliteModel {
  if (!isValidCartesian(cartesian)) {
    return {
      ...satellite,
      cartesian,
      editorMode: "cartesian",
    };
  }

  return {
    ...satellite,
    cartesian,
    keplerian: cartesianToKeplerian(cartesian),
    editorMode: "cartesian",
  };
}

const palette = ["#5eead4", "#fbbf24", "#93c5fd", "#f472b6", "#a3e635", "#fb7185"];
const constellationPalette = ["#67e8f9", "#5eead4", "#a78bfa", "#38bdf8", "#2dd4bf"];
const initialWorkspace: WorkspaceState = {
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  focusMode: false,
  hierarchyExpanded: {
    satellites: false,
    constellations: true,
    groundStations: false,
    regions: false,
    catalogLayers: false,
  },
  expandedConstellationIds: [],
  visibilityFilters: {
    selectedOnly: false,
    payloads: true,
    debris: true,
    rocketBodies: true,
    constellations: true,
    stations: true,
    regions: true,
    catalog: true,
  },
  coverageMode: "constellation",
  labelMode: "priority",
};

function createGeneratedSatellite(
  name: string,
  epoch: Date,
  constellationId: string,
  color: string,
  keplerian: KeplerianElements,
): SatelliteModel {
  return createSatellite(name, epoch, {
    constellationId,
    keplerian,
    visualization: {
      color,
      visible: true,
      showTrail: true,
      showGroundTrack: false,
    },
    sensor: {
      enabled: true,
      halfAngleDeg: 20,
      maxRangeKm: null,
      showCone: false,
      showFootprint: true,
    },
  });
}

function addGeneratedConstellation(
  scenario: Scenario,
  name: string,
  color: string,
  generator: ConstellationModel["generator"],
  satellites: SatelliteModel[],
): Scenario {
  const constellation = createConstellation(
    name,
    satellites.map((satellite) => satellite.id),
    {
      color,
      generator,
    },
  );
  const linkedSatellites = satellites.map((satellite) => ({
    ...satellite,
    constellationId: constellation.id,
  }));

  return {
    ...scenario,
    satellites: [...scenario.satellites, ...linkedSatellites],
    constellations: [
      ...scenario.constellations.map((item) => ({ ...item, visible: false })),
      constellation,
    ],
    selectedObjectType: "constellation",
    selectedObjectId: constellation.id,
    coverageSettings: {
      ...scenario.coverageSettings,
      enabled: true,
      targetType: "constellation",
      targetId: constellation.id,
    },
  };
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  scenario: initialScenario,
  selectedSatelliteId: selectedSatelliteIdForScenario(initialScenario),
  selectedGroundStationId: selectedGroundStationIdForScenario(initialScenario),
  selectedRegionId: selectedRegionIdForScenario(initialScenario),
  selectedConstellationId: selectedConstellationIdForScenario(initialScenario),
  isPlaying: true,
  importError: null,
  lastOrbitExplanation: null,
  workspace: initialWorkspace,

  tick: () => {
    const state = get();
    if (!state.isPlaying) {
      return;
    }

    set((current) => {
      return {
        scenario: {
          ...current.scenario,
          simulationTimeUtc: readStudioPlaybackTimeIso(),
        },
      };
    });
  },

  setPlaying: (isPlaying) =>
    set((state) => ({
      isPlaying,
      scenario: {
        ...state.scenario,
        simulationTimeUtc: configureStudioPlaybackClock({ isPlaying }),
      },
    })),

  setTimeScale: (timeScale) => {
    const normalizedTimeScale = Math.max(1, Math.abs(timeScale));
    const simulationTimeUtc = configureStudioPlaybackClock({ timeScale: normalizedTimeScale });

    set((state) => ({
      scenario: {
        ...state.scenario,
        simulationTimeUtc,
        timeScale: normalizedTimeScale,
      },
    }));
  },

  setReverse: (isReverse) => {
    const simulationTimeUtc = configureStudioPlaybackClock({ isReverse });

    set((state) => ({
      scenario: {
        ...state.scenario,
        simulationTimeUtc,
        isReverse,
      },
    }));
  },

  setSimulationTime: (isoString) => {
    const simulationTimeUtc = parseSimulationTimeUtc(isoString);

    if (!simulationTimeUtc) {
      return;
    }

    configureStudioPlaybackClock({ simulationTimeUtc });
    set((state) => ({
      scenario: {
        ...state.scenario,
        simulationTimeUtc,
      },
    }));
  },

  resetSimulationTime: () => {
    const simulationTimeUtc = new Date(Date.now()).toISOString();
    configureStudioPlaybackClock({ simulationTimeUtc });

    set((state) => ({
      scenario: {
        ...state.scenario,
        simulationTimeUtc,
      },
    }));
  },

  setScenarioName: (name) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        name,
      },
    })),

  addSatellite: () =>
    set((state) => {
      const epoch = new Date(state.scenario.simulationTimeUtc);
      const index = state.scenario.satellites.length;
      const keplerian = {
        ...createSampleKeplerian(epoch),
        trueAnomalyDeg: (144 + index * 38) % 360,
        raanDeg: (38 + index * 17) % 360,
      };
      const satellite = createSatellite(`Satellite ${index + 1}`, epoch, {
        keplerian,
        visualization: {
          color: palette[index % palette.length],
          visible: true,
          showTrail: true,
          showGroundTrack: index < 3,
        },
      });

      return {
        scenario: {
          ...state.scenario,
          satellites: [...state.scenario.satellites, satellite],
          selectedObjectType: "satellite",
          selectedObjectId: satellite.id,
        },
        selectedSatelliteId: satellite.id,
      };
    }),

  duplicateSatellite: (satelliteId) =>
    set((state) => {
      const source = state.scenario.satellites.find((satellite) => satellite.id === satelliteId);
      if (!source) {
        return state;
      }

      const duplicate: SatelliteModel = {
        ...source,
        id: createId("sat"),
        name: `${source.name} Copy`,
        keplerian: {
          ...source.keplerian,
          trueAnomalyDeg: (source.keplerian.trueAnomalyDeg + 8) % 360,
        },
        visualization: {
          ...source.visualization,
          color: palette[state.scenario.satellites.length % palette.length],
        },
      };
      duplicate.cartesian = keplerianToCartesian(duplicate.keplerian);

      return {
        scenario: {
          ...state.scenario,
          satellites: [...state.scenario.satellites, duplicate],
          constellations: state.scenario.constellations.map((constellation) =>
            duplicate.constellationId === constellation.id
              ? {
                  ...constellation,
                  satelliteIds: [...constellation.satelliteIds, duplicate.id],
                }
              : constellation,
          ),
          selectedObjectType: "satellite",
          selectedObjectId: duplicate.id,
        },
        selectedSatelliteId: duplicate.id,
      };
    }),

  deleteSatellite: (satelliteId) =>
    set((state) => {
      const nextSatellites = state.scenario.satellites.filter(
        (satellite) => satellite.id !== satelliteId,
      );
      const selectedSatelliteId =
        state.selectedSatelliteId === satelliteId
          ? nextSatellites[0]?.id ?? null
          : state.selectedSatelliteId;

      return {
        scenario: {
          ...state.scenario,
          satellites: nextSatellites,
          constellations: state.scenario.constellations.map((constellation) => ({
            ...constellation,
            satelliteIds: constellation.satelliteIds.filter((id) => id !== satelliteId),
          })),
          selectedObjectType: selectedSatelliteId ? state.scenario.selectedObjectType : "ground-station",
          selectedObjectId: selectedSatelliteId ?? state.selectedGroundStationId,
        },
        selectedSatelliteId,
      };
    }),

  selectSatellite: (satelliteId) =>
    set((state) => ({
      selectedSatelliteId: satelliteId,
      selectedGroundStationId: null,
      selectedRegionId: null,
      selectedConstellationId: null,
      scenario: {
        ...state.scenario,
        selectedObjectType: "satellite",
        selectedObjectId: satelliteId,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          followSatelliteId: state.scenario.cameraSettings.followSelectedObject
            ? satelliteId
            : null,
        },
        coverageSettings: {
          ...state.scenario.coverageSettings,
          targetType: "satellite",
          targetId: satelliteId,
        },
      },
    })),

  selectGroundStation: (stationId) =>
    set((state) => ({
      selectedSatelliteId: null,
      selectedGroundStationId: stationId,
      selectedRegionId: null,
      selectedConstellationId: null,
      scenario: {
        ...state.scenario,
        selectedObjectType: "ground-station",
        selectedObjectId: stationId,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          followSelectedObject: false,
          followSatelliteId: null,
        },
        coverageSettings: {
          ...state.scenario.coverageSettings,
          targetType: "ground-station",
          targetId: stationId,
        },
      },
    })),

  selectRegion: (regionId) =>
    set((state) => ({
      selectedSatelliteId: null,
      selectedGroundStationId: null,
      selectedRegionId: regionId,
      selectedConstellationId: null,
      scenario: {
        ...state.scenario,
        selectedObjectType: "region",
        selectedObjectId: regionId,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          followSelectedObject: false,
          followSatelliteId: null,
        },
      },
    })),

  selectConstellation: (constellationId) =>
    set((state) => ({
      selectedSatelliteId: null,
      selectedGroundStationId: null,
      selectedRegionId: null,
      selectedConstellationId: constellationId,
      scenario: {
        ...state.scenario,
        constellations: state.scenario.constellations.map((constellation) => ({
          ...constellation,
          visible: constellation.id === constellationId,
        })),
        selectedObjectType: "constellation",
        selectedObjectId: constellationId,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          followSelectedObject: false,
          followSatelliteId: null,
        },
        coverageSettings: {
          ...state.scenario.coverageSettings,
          targetType: "constellation",
          targetId: constellationId,
        },
      },
    })),

  selectCatalogObject: (objectId) =>
    set((state) => ({
      selectedSatelliteId: null,
      selectedGroundStationId: null,
      selectedRegionId: null,
      selectedConstellationId: null,
      scenario: {
        ...state.scenario,
        selectedObjectType: "catalog-object",
        selectedObjectId: objectId,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          followSelectedObject: false,
          followSatelliteId: null,
        },
      },
    })),

  clearSelection: () =>
    set((state) => ({
      selectedSatelliteId: null,
      selectedGroundStationId: null,
      selectedRegionId: null,
      selectedConstellationId: null,
      scenario: {
        ...state.scenario,
        selectedObjectType: "none",
        selectedObjectId: null,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          followSelectedObject: false,
          followSatelliteId: null,
        },
      },
    })),

  setSelectedObject: (type, objectId) =>
    set((state) => ({
      selectedSatelliteId: type === "satellite" ? objectId : null,
      selectedGroundStationId: type === "ground-station" ? objectId : null,
      selectedRegionId: type === "region" ? objectId : null,
      selectedConstellationId: type === "constellation" ? objectId : null,
      scenario: {
        ...state.scenario,
        selectedObjectType: type,
        selectedObjectId: objectId,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          followSelectedObject:
            type === "satellite" ? state.scenario.cameraSettings.followSelectedObject : false,
          followSatelliteId:
            type === "satellite" ? state.scenario.cameraSettings.followSatelliteId ?? null : null,
        },
      },
    })),

  updateSatelliteName: (satelliteId, name) =>
    set((state) => ({
      scenario: updateSatellite(state.scenario, satelliteId, (satellite) => ({
        ...satellite,
        name,
      })),
    })),

  updateSatelliteVisualization: (satelliteId, patch) =>
    set((state) => ({
      scenario: updateSatellite(state.scenario, satelliteId, (satellite) => ({
        ...satellite,
        visualization: {
          ...satellite.visualization,
          ...patch,
        },
      })),
    })),

  updateSatelliteSensor: (satelliteId, patch) =>
    set((state) => ({
      scenario: updateSatellite(state.scenario, satelliteId, (satellite) => ({
        ...satellite,
        sensor: {
          ...satellite.sensor,
          ...patch,
        },
      })),
    })),

  setEditorMode: (satelliteId, editorMode) =>
    set((state) => ({
      scenario: updateSatellite(state.scenario, satelliteId, (satellite) => ({
        ...satellite,
        editorMode,
      })),
    })),

  setPropagationMode: (satelliteId, propagationMode) =>
    set((state) => ({
      scenario: updateSatellite(state.scenario, satelliteId, (satellite) => {
        if (propagationMode === "advanced") {
          return satellite;
        }

        return {
          ...satellite,
          propagationMode,
        };
      }),
    })),

  updateKeplerian: (satelliteId, patch) =>
    set((state) => {
      let explanation: OrbitExplanation | null = null;
      const scenario = updateSatellite(state.scenario, satelliteId, (satellite) => {
        const nextKeplerian = {
          ...satellite.keplerian,
          ...patch,
        };
        explanation = explainKeplerianChange(satellite.keplerian, nextKeplerian);

        return withValidKeplerianUpdate(satellite, nextKeplerian);
      });

      return {
        scenario,
        lastOrbitExplanation: explanation ?? state.lastOrbitExplanation,
      };
    }),

  updateCartesianVector: (satelliteId, field, index, value) =>
    set((state) => ({
      scenario: updateSatellite(state.scenario, satelliteId, (satellite) => {
        const vector = [...satellite.cartesian[field]] as [number, number, number];
        vector[index] = value;

        return withValidCartesianUpdate(satellite, {
          ...satellite.cartesian,
          [field]: vector,
        });
      }),
    })),

  updateCartesianEpoch: (satelliteId, epoch) =>
    set((state) => ({
      scenario: updateSatellite(state.scenario, satelliteId, (satellite) =>
        withValidCartesianUpdate(satellite, {
          ...satellite.cartesian,
          epoch,
        }),
      ),
    })),

  updateTle: (satelliteId, patch) =>
    set((state) => ({
      scenario: updateSatellite(state.scenario, satelliteId, (satellite) => {
        const tle = {
          name: satellite.tle?.name ?? satellite.name,
          line1: satellite.tle?.line1 ?? "",
          line2: satellite.tle?.line2 ?? "",
          ...patch,
        };

        const validationMessage = validateTle(tle);
        if (validationMessage) {
          return {
            ...satellite,
            tle,
            editorMode: "tle",
          };
        }

        try {
          const cartesian = tleToCartesian(tle, new Date(state.scenario.simulationTimeUtc));
          return {
            ...satellite,
            name: tle.name || satellite.name,
            tle,
            cartesian,
            keplerian: cartesianToKeplerian(cartesian),
            propagationMode: "sgp4",
            editorMode: "tle",
          };
        } catch {
          return {
            ...satellite,
            tle,
            editorMode: "tle",
          };
        }
      }),
    })),

  addGroundStation: () =>
    set((state) => {
      const index = state.scenario.groundStations.length;
      const station = createGroundStation(`Ground Station ${index + 1}`, 34.5, -117.3, {
        color: palette[(index + state.scenario.satellites.length) % palette.length],
        minimumElevationDeg: 10,
        showCoverageCone: true,
        showHorizonCircle: true,
        source: "User-created local scenario object.",
      });

      return {
        selectedGroundStationId: station.id,
        scenario: {
          ...state.scenario,
          groundStations: [...state.scenario.groundStations, station],
          selectedObjectType: "ground-station",
          selectedObjectId: station.id,
        },
      };
    }),

  deleteGroundStation: (stationId) =>
    set((state) => {
      const groundStations = state.scenario.groundStations.filter(
        (station) => station.id !== stationId,
      );
      const selectedGroundStationId =
        state.selectedGroundStationId === stationId
          ? groundStations[0]?.id ?? null
          : state.selectedGroundStationId;
      const selectedObjectType =
        state.scenario.selectedObjectType === "ground-station" &&
        state.scenario.selectedObjectId === stationId
          ? "satellite"
          : state.scenario.selectedObjectType;
      const selectedObjectId =
        state.scenario.selectedObjectType === "ground-station" &&
        state.scenario.selectedObjectId === stationId
          ? state.selectedSatelliteId
          : state.scenario.selectedObjectId;

      return {
        selectedGroundStationId,
        scenario: {
          ...state.scenario,
          groundStations,
          selectedObjectType,
          selectedObjectId,
        },
      };
    }),

  updateGroundStation: (stationId, patch) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        groundStations: state.scenario.groundStations.map((station) =>
          station.id === stationId ? { ...station, ...patch } : station,
        ),
      },
    })),

  addRegion: () =>
    set((state) => {
      const index = state.scenario.regions.length;
      const region = createRegion(
        `Custom Region ${index + 1}`,
        "custom-circle",
        {
          kind: "circle",
          centerLatitudeDeg: 39,
          centerLongitudeDeg: -98,
          radiusDeg: 4,
        },
        {
          color: constellationPalette[index % constellationPalette.length],
          source: "User-created simplified circular classroom region.",
        },
      );

      return {
        selectedRegionId: region.id,
        scenario: {
          ...state.scenario,
          regions: [...state.scenario.regions, region],
          selectedObjectType: "region",
          selectedObjectId: region.id,
        },
      };
    }),

  deleteRegion: (regionId) =>
    set((state) => {
      const regions = state.scenario.regions.filter((region) => region.id !== regionId);
      const selectedRegionId =
        state.selectedRegionId === regionId ? regions[0]?.id ?? null : state.selectedRegionId;

      return {
        selectedRegionId,
        scenario: {
          ...state.scenario,
          regions,
          selectedObjectType:
            state.scenario.selectedObjectType === "region" &&
            state.scenario.selectedObjectId === regionId
              ? "satellite"
              : state.scenario.selectedObjectType,
          selectedObjectId:
            state.scenario.selectedObjectType === "region" &&
            state.scenario.selectedObjectId === regionId
              ? state.selectedSatelliteId
              : state.scenario.selectedObjectId,
        },
      };
    }),

  updateRegion: (regionId, patch) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        regions: state.scenario.regions.map((region) =>
          region.id === regionId ? { ...region, ...patch } : region,
        ),
      },
    })),

  addConstellation: () =>
    set((state) => {
      const index = state.scenario.constellations.length;
      const constellation = createConstellation(`Constellation ${index + 1}`, [], {
        color: constellationPalette[index % constellationPalette.length],
      });

      return {
        selectedConstellationId: constellation.id,
        scenario: {
          ...state.scenario,
          constellations: [
            ...state.scenario.constellations.map((item) => ({ ...item, visible: false })),
            constellation,
          ],
          selectedObjectType: "constellation",
          selectedObjectId: constellation.id,
        },
      };
    }),

  deleteConstellation: (constellationId) =>
    set((state) => {
      const constellations = state.scenario.constellations.filter(
        (constellation) => constellation.id !== constellationId,
      );
      const selectedConstellationId =
        state.selectedConstellationId === constellationId
          ? constellations[0]?.id ?? null
          : state.selectedConstellationId;

      return {
        selectedConstellationId,
        scenario: {
          ...state.scenario,
          constellations,
          satellites: state.scenario.satellites.map((satellite) =>
            satellite.constellationId === constellationId
              ? { ...satellite, constellationId: null }
              : satellite,
          ),
          selectedObjectType:
            state.scenario.selectedObjectType === "constellation" &&
            state.scenario.selectedObjectId === constellationId
              ? "satellite"
              : state.scenario.selectedObjectType,
          selectedObjectId:
            state.scenario.selectedObjectType === "constellation" &&
            state.scenario.selectedObjectId === constellationId
              ? state.selectedSatelliteId
              : state.scenario.selectedObjectId,
        },
      };
    }),

  updateConstellation: (constellationId, patch) =>
    set((state) => {
      const nextColor = patch.color;
      return {
        scenario: {
          ...state.scenario,
          constellations: state.scenario.constellations.map((constellation) =>
            constellation.id === constellationId ? { ...constellation, ...patch } : constellation,
          ),
          satellites: state.scenario.satellites.map((satellite) => {
            if (satellite.constellationId !== constellationId) {
              return satellite;
            }

            return {
              ...satellite,
              visualization: {
                ...satellite.visualization,
                color: nextColor ?? satellite.visualization.color,
                visible:
                  typeof patch.visible === "boolean" ? patch.visible : satellite.visualization.visible,
              },
            };
          }),
        },
      };
    }),

  setConstellationVisibilityMode: (constellationId) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        constellations: state.scenario.constellations.map((constellation) => ({
          ...constellation,
          visible: constellationId === "all" || constellation.id === constellationId,
        })),
      },
    })),

  generateWalkerDelta: () =>
    set((state) => {
      const epoch = new Date(state.scenario.simulationTimeUtc);
      const color = constellationPalette[state.scenario.constellations.length % constellationPalette.length];
      const totalSatellites = 12;
      const planes = 3;
      const phasing = 1;
      const satsPerPlane = totalSatellites / planes;
      const placeholderConstellationId = createId("constellation");
      const satellites = Array.from({ length: totalSatellites }, (_, index) => {
        const plane = Math.floor(index / satsPerPlane);
        const slot = index % satsPerPlane;
        return createGeneratedSatellite(
          `Walker ${plane + 1}-${slot + 1}`,
          epoch,
          placeholderConstellationId,
          color,
          {
            semiMajorAxisKm: 6378.137 + 620,
            eccentricity: 0.001,
            inclinationDeg: 53,
            raanDeg: (plane * 360) / planes,
            argumentOfPeriapsisDeg: 0,
            trueAnomalyDeg: ((slot * 360) / satsPerPlane + plane * phasing * 10) % 360,
            epoch: epoch.toISOString(),
          },
        );
      });

      const nextScenario = addGeneratedConstellation(
        state.scenario,
        "Walker Delta",
        color,
        {
          kind: "walker-delta",
          totalSatellites,
          planes,
          phasing,
          altitudeKm: 620,
          inclinationDeg: 53,
          createdAt: epoch.toISOString(),
        },
        satellites,
      );

      return {
        scenario: nextScenario,
        selectedConstellationId: nextScenario.selectedObjectId,
      };
    }),

  generateCircularRing: () =>
    set((state) => {
      const epoch = new Date(state.scenario.simulationTimeUtc);
      const color = constellationPalette[state.scenario.constellations.length % constellationPalette.length];
      const count = 8;
      const altitudeKm = 700;
      const inclinationDeg = 45;
      const placeholderConstellationId = createId("constellation");
      const satellites = Array.from({ length: count }, (_, index) =>
        createGeneratedSatellite(`Ring ${index + 1}`, epoch, placeholderConstellationId, color, {
          semiMajorAxisKm: 6378.137 + altitudeKm,
          eccentricity: 0,
          inclinationDeg,
          raanDeg: 0,
          argumentOfPeriapsisDeg: 0,
          trueAnomalyDeg: (index * 360) / count,
          epoch: epoch.toISOString(),
        }),
      );
      const nextScenario = addGeneratedConstellation(
        state.scenario,
        "Circular Ring",
        color,
        {
          kind: "circular-ring",
          count,
          altitudeKm,
          inclinationDeg,
          createdAt: epoch.toISOString(),
        },
        satellites,
      );

      return {
        scenario: nextScenario,
        selectedConstellationId: nextScenario.selectedObjectId,
      };
    }),

  generatePolarNetwork: () =>
    set((state) => {
      const epoch = new Date(state.scenario.simulationTimeUtc);
      const color = constellationPalette[state.scenario.constellations.length % constellationPalette.length];
      const count = 10;
      const altitudeKm = 650;
      const inclinationDeg = 97.6;
      const placeholderConstellationId = createId("constellation");
      const satellites = Array.from({ length: count }, (_, index) =>
        createGeneratedSatellite(`Polar ${index + 1}`, epoch, placeholderConstellationId, color, {
          semiMajorAxisKm: 6378.137 + altitudeKm,
          eccentricity: 0.001,
          inclinationDeg,
          raanDeg: (index * 360) / count,
          argumentOfPeriapsisDeg: 0,
          trueAnomalyDeg: (index * 137.5) % 360,
          epoch: epoch.toISOString(),
        }),
      );
      const nextScenario = addGeneratedConstellation(
        state.scenario,
        "Polar Network",
        color,
        {
          kind: "polar-network",
          count,
          altitudeKm,
          inclinationDeg,
          createdAt: epoch.toISOString(),
        },
        satellites,
      );

      return {
        scenario: nextScenario,
        selectedConstellationId: nextScenario.selectedObjectId,
      };
    }),

  loadSampleCatalog: () =>
    set((state) => {
      const existing = state.scenario.catalogLayers.find(
        (layer) => layer.id === "sample-catalog-layer",
      );
      const catalogLayer: CatalogLayerModel = {
        ...(existing ?? createSampleCatalogLayer(new Date(state.scenario.simulationTimeUtc))),
        loaded: true,
        visible: true,
      };

      return {
        scenario: {
          ...state.scenario,
          catalogLayers: existing
            ? state.scenario.catalogLayers.map((layer) =>
                layer.id === catalogLayer.id ? catalogLayer : layer,
              )
            : [...state.scenario.catalogLayers, catalogLayer],
        },
      };
    }),

  toggleCatalogLayer: (layerId) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        catalogLayers: state.scenario.catalogLayers.map((layer) =>
          layer.id === layerId ? { ...layer, visible: !layer.visible } : layer,
        ),
      },
    })),

  toggleCatalogObject: (layerId, objectId) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        catalogLayers: state.scenario.catalogLayers.map((layer) =>
          layer.id === layerId
            ? {
                ...layer,
                objects: layer.objects.map((object) =>
                  object.id === objectId ? { ...object, visible: !object.visible } : object,
                ),
              }
            : layer,
        ),
      },
    })),

  setRenderSetting: (key, value) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        renderSettings: {
          ...state.scenario.renderSettings,
          [key]: value,
        },
      },
    })),

  setEarthCloudMode: (earthCloudMode) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        renderSettings: {
          ...state.scenario.renderSettings,
          earthCloudMode,
          showClouds: earthCloudMode !== "off",
          earthLiveLayerStatus:
            earthCloudMode === "live-nasa-gibs"
              ? "loading"
              : state.scenario.renderSettings.earthLiveLayerStatus,
          earthLiveLayerDate:
            earthCloudMode === "live-nasa-gibs"
              ? dateForNearRealTimeGibs()
              : state.scenario.renderSettings.earthLiveLayerDate,
          earthLiveLayerError:
            earthCloudMode === "live-nasa-gibs"
              ? null
              : state.scenario.renderSettings.earthLiveLayerError,
        },
      },
    })),

  refreshEarthLiveLayer: () =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        renderSettings: {
          ...state.scenario.renderSettings,
          earthCloudMode: "live-nasa-gibs",
          showClouds: true,
          earthLiveLayerDate: dateForNearRealTimeGibs(),
          earthLiveLayerStatus: "loading",
          earthLiveLayerError: null,
        },
      },
    })),

  setEarthLiveLayerStatus: (earthLiveLayerStatus, errorMessage = null) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        renderSettings: {
          ...state.scenario.renderSettings,
          earthLiveLayerStatus,
          earthLiveLayerUpdatedAt:
            earthLiveLayerStatus === "loaded"
              ? new Date().toISOString()
              : state.scenario.renderSettings.earthLiveLayerUpdatedAt,
          earthLiveLayerError:
            earthLiveLayerStatus === "error" ? errorMessage ?? "Live atmosphere layer unavailable" : null,
        },
      },
    })),

  setCoverageSetting: (key, value) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        coverageSettings: {
          ...state.scenario.coverageSettings,
          [key]: value,
        },
      },
    })),

  setCoverageMode: (coverageMode) =>
    set((state) => {
      const nextCoverage: CoverageSettings =
        coverageMode === "combined"
          ? {
              ...state.scenario.coverageSettings,
              enabled: true,
              targetType: "constellation",
              targetId: null,
            }
          : coverageMode === "constellation"
            ? {
                ...state.scenario.coverageSettings,
                enabled: true,
                targetType: "constellation",
                targetId: state.selectedConstellationId,
              }
            : coverageMode === "ground-station"
              ? {
                  ...state.scenario.coverageSettings,
                  enabled: true,
                  targetType: "ground-station",
                  targetId: state.selectedGroundStationId,
                }
              : {
                  ...state.scenario.coverageSettings,
                  enabled: true,
                  targetType: "satellite",
                  targetId: state.selectedSatelliteId,
                };

      return {
        workspace: {
          ...state.workspace,
          coverageMode,
        },
        scenario: {
          ...state.scenario,
          coverageSettings: nextCoverage,
          renderSettings: {
            ...state.scenario.renderSettings,
            showCoverageLayer: true,
          },
        },
      };
    }),

  setLabelMode: (labelMode) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        labelMode,
      },
    })),

  toggleHierarchySection: (section) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        hierarchyExpanded: {
          ...state.workspace.hierarchyExpanded,
          [section]: !state.workspace.hierarchyExpanded[section],
        },
      },
    })),

  toggleConstellationExpanded: (constellationId) =>
    set((state) => {
      const expanded = state.workspace.expandedConstellationIds.includes(constellationId);
      return {
        workspace: {
          ...state.workspace,
          expandedConstellationIds: expanded
            ? state.workspace.expandedConstellationIds.filter((id) => id !== constellationId)
            : [...state.workspace.expandedConstellationIds, constellationId],
        },
      };
    }),

  setPanelCollapsed: (panel, collapsed) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        leftPanelCollapsed: panel === "left" ? collapsed : state.workspace.leftPanelCollapsed,
        rightPanelCollapsed: panel === "right" ? collapsed : state.workspace.rightPanelCollapsed,
      },
    })),

  setFocusMode: (focusMode) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        focusMode,
        labelMode: focusMode ? "priority" : state.workspace.labelMode,
      },
    })),

  toggleFocusMode: () =>
    set((state) => {
      const focusMode = !state.workspace.focusMode;

      return {
        workspace: {
          ...state.workspace,
          focusMode,
          labelMode: focusMode ? "priority" : state.workspace.labelMode,
        },
      };
    }),

  setVisibilityFilter: (key, value) =>
    set((state) => ({
      workspace: {
        ...state.workspace,
        visibilityFilters: {
          ...state.workspace.visibilityFilters,
          [key]: value,
        },
      },
    })),

  setEducationalOverlay: (overlay) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        renderSettings: {
          ...state.scenario.renderSettings,
          educationalOverlay: overlay,
        },
      },
    })),

  setTeacherMode: (teacherMode) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        teacherMode,
        renderSettings: {
          ...state.scenario.renderSettings,
          showEciGrid: teacherMode ? false : state.scenario.renderSettings.showEciGrid,
          showEcefGrid: teacherMode ? false : state.scenario.renderSettings.showEcefGrid,
        },
      },
    })),

  setViewPreset: (viewPreset) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          viewPreset,
          cameraMode:
            viewPreset === "follow"
              ? "follow-satellite"
              : state.scenario.cameraSettings.cameraMode,
        },
      },
    })),

  setCameraMode: (cameraMode) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          cameraMode,
          viewPreset:
            cameraMode === "follow-satellite"
              ? "follow"
              : cameraMode === "free"
                ? "free"
                : state.scenario.cameraSettings.viewPreset,
          followSelectedObject:
            cameraMode === "follow-satellite"
              ? state.scenario.cameraSettings.followSelectedObject
              : false,
          followSatelliteId:
            cameraMode === "follow-satellite" && state.scenario.cameraSettings.followSelectedObject
              ? state.selectedSatelliteId
              : null,
        },
      },
    })),

  setFollowSelectedObject: (followSelectedObject) =>
    set((state) => ({
      scenario: {
        ...state.scenario,
        cameraSettings: {
          ...state.scenario.cameraSettings,
          followSelectedObject,
          cameraMode: followSelectedObject ? "follow-satellite" : "free",
          viewPreset: followSelectedObject ? "follow" : "free",
          followSatelliteId: followSelectedObject ? state.selectedSatelliteId : null,
        },
      },
    })),

  loadScenario: (scenario) => {
    resetStudioPlaybackClock({
      simulationTimeUtc: scenario.simulationTimeUtc,
      isPlaying: get().isPlaying,
      timeScale: scenario.timeScale,
      isReverse: scenario.isReverse,
    });

    set({
      scenario,
      selectedSatelliteId: selectedSatelliteIdForScenario(scenario),
      selectedGroundStationId: selectedGroundStationIdForScenario(scenario),
      selectedRegionId: selectedRegionIdForScenario(scenario),
      selectedConstellationId: selectedConstellationIdForScenario(scenario),
      importError: null,
      lastOrbitExplanation: null,
    });
  },

  loadScenarioJson: (json) => {
    try {
      const scenario = normalizeImportedScenario(JSON.parse(json));
      resetStudioPlaybackClock({
        simulationTimeUtc: scenario.simulationTimeUtc,
        isPlaying: get().isPlaying,
        timeScale: scenario.timeScale,
        isReverse: scenario.isReverse,
      });
      set({
        scenario,
        selectedSatelliteId: selectedSatelliteIdForScenario(scenario),
        selectedGroundStationId: selectedGroundStationIdForScenario(scenario),
        selectedRegionId: selectedRegionIdForScenario(scenario),
        selectedConstellationId: selectedConstellationIdForScenario(scenario),
        importError: null,
        lastOrbitExplanation: null,
      });
    } catch (error) {
      set({
        importError: error instanceof Error ? error.message : "Unable to import scenario.",
      });
    }
  },

  clearImportError: () => set({ importError: null }),
}));
