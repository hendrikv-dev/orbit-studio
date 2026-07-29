import type { Satellite } from "../types/orbit";
import { keplerianToCartesian } from "../physics/orbit";
import type { Scenario } from "./schema";
import { APP_VERSION } from "./schema";

const now = new Date().toISOString();

export const issLikeKeplerian = {
  semiMajorAxis: 6796.8,
  eccentricity: 0.00067,
  inclination: 51.64,
  raan: 122.2,
  argumentOfPeriapsis: 87.4,
  trueAnomaly: 42.0,
  epoch: now
};

export function createSampleSatellite(id: string = crypto.randomUUID()): Satellite {
  const keplerian = { ...issLikeKeplerian, epoch: new Date().toISOString() };
  return {
    id,
    name: "Apsis Demo LEO",
    color: "#2de2b8",
    visible: true,
    showOrbitTrail: true,
    showGroundTrack: true,
    inputMode: "keplerian",
    propagationMode: "two-body",
    keplerian,
    cartesian: keplerianToCartesian(keplerian)
  };
}

export function createDefaultScenario(): Scenario {
  const satellite = createSampleSatellite("apsis-demo-leo");
  const timestamp = new Date().toISOString();
  return {
    appVersion: APP_VERSION,
    name: "Default Apsis Scenario",
    simulationEpoch: timestamp,
    currentTime: timestamp,
    timeScale: 1,
    isPlaying: true,
    renderSettings: {
      clouds: true,
      nightLights: true,
      groundTracks: true,
      quality: "high"
    },
    cameraSettings: {
      preset: "free",
      followSatelliteId: satellite.id
    },
    satellites: [satellite]
  };
}
