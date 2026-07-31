import type { CartesianState, KeplerianElements, PropagationMode } from '../physics/orbits/types';
import type { TleData } from '../physics/propagators/tle';

export type EditorMode = 'keplerian' | 'cartesian' | 'tle';
export type CameraPreset = 'free' | 'equatorial' | 'polar' | 'follow' | 'ground-track';
export type QualityLevel = 'low' | 'medium' | 'high';

export type Satellite = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  showOrbitTrail: boolean;
  showGroundTrack: boolean;
  propagationMode: PropagationMode;
  editorMode: EditorMode;
  keplerian: KeplerianElements;
  cartesian: CartesianState;
  tle: TleData;
};

export type RenderSettings = {
  quality: QualityLevel;
  cloudsEnabled: boolean;
  nightLightsEnabled: boolean;
  groundTracksEnabled: boolean;
};

export type CameraSettings = {
  preset: CameraPreset;
  followSatelliteId: string | null;
};

export type ScenarioState = {
  appVersion: string;
  scenarioName: string;
  simulationEpoch: string;
  currentTime: string;
  timeScale: number;
  renderSettings: RenderSettings;
  cameraSettings: CameraSettings;
  satellites: Satellite[];
  selectedSatelliteId: string | null;
};

export type SatellitePatch = Partial<Omit<Satellite, 'id' | 'keplerian' | 'cartesian' | 'tle'>> & {
  keplerian?: Partial<KeplerianElements>;
  cartesian?: Partial<CartesianState>;
  tle?: Partial<TleData>;
};
