export type Vector3Tuple = [number, number, number];

export type PropagationMode = "two-body" | "sgp4" | "advanced";
export type SatelliteInputMode = "keplerian" | "cartesian" | "tle";

export interface CartesianState {
  position: Vector3Tuple;
  velocity: Vector3Tuple;
  epoch: string;
}

export interface KeplerianElements {
  semiMajorAxis: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argumentOfPeriapsis: number;
  trueAnomaly: number;
  epoch: string;
}

export interface TleSource {
  name: string;
  line1: string;
  line2: string;
}

export interface Satellite {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  showOrbitTrail: boolean;
  showGroundTrack: boolean;
  inputMode: SatelliteInputMode;
  propagationMode: PropagationMode;
  keplerian: KeplerianElements;
  cartesian: CartesianState;
  tle?: TleSource;
}

export interface GroundTrackPoint {
  latitude: number;
  longitude: number;
  altitude: number;
  time: string;
}

export interface SatelliteReadouts {
  altitude: number;
  velocity: number;
  period: number | null;
  inclination: number;
  eccentricity: number;
  latitude: number;
  longitude: number;
  propagationMode: PropagationMode;
}
