export type Vector3Tuple = [number, number, number];

export interface CartesianState {
  positionKm: Vector3Tuple;
  velocityKmS: Vector3Tuple;
  epoch: string;
}

export interface KeplerianElements {
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  argumentOfPeriapsisDeg: number;
  trueAnomalyDeg: number;
  epoch: string;
}

export interface GeodeticPosition {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}

export interface GroundTrackPoint extends GeodeticPosition {
  time: string;
}
