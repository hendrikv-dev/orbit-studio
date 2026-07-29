import { keplerianToCartesian } from '../physics/orbits/conversions';
import type { KeplerianElements } from '../physics/orbits/types';
import type { Satellite, ScenarioState } from '../state/types';
import { createId } from '../utils/id';

export const APP_VERSION = '0.1.0';

const SAMPLE_TLE = {
  name: 'No TLE — project-authored two-body sample',
  line1: '',
  line2: '',
};

export const createSampleSatellite = (epoch = new Date().toISOString()): Satellite => {
  const keplerian: KeplerianElements = {
    semiMajorAxisKm: 6878.137,
    eccentricity: 0.0014,
    inclinationDeg: 51.64,
    raanDeg: 37,
    argPeriapsisDeg: 84,
    trueAnomalyDeg: 12,
    epoch,
  };

  return {
    id: createId('sat'),
    name: 'Apsis DemoSat',
    color: '#68d8ff',
    visible: true,
    showOrbitTrail: true,
    showGroundTrack: true,
    propagationMode: 'two-body',
    editorMode: 'keplerian',
    keplerian,
    cartesian: keplerianToCartesian(keplerian),
    tle: SAMPLE_TLE,
  };
};

export const createDefaultScenario = (): ScenarioState => {
  const now = new Date().toISOString();
  const satellite = createSampleSatellite(now);

  return {
    appVersion: APP_VERSION,
    scenarioName: 'Untitled Mission',
    simulationEpoch: now,
    currentTime: now,
    timeScale: 1,
    renderSettings: {
      quality: 'high',
      cloudsEnabled: true,
      nightLightsEnabled: true,
      groundTracksEnabled: true,
    },
    cameraSettings: {
      preset: 'free',
      followSatelliteId: null,
    },
    satellites: [satellite],
    selectedSatelliteId: satellite.id,
  };
};
