export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type Vector3Tuple = [number, number, number];

export type CartesianState = {
  positionKm: Vector3;
  velocityKmS: Vector3;
  epoch: string;
};

export type KeplerianElements = {
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  argPeriapsisDeg: number;
  trueAnomalyDeg: number;
  epoch: string;
};

export type GeodeticPosition = {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
};

export type PropagationMode = 'two-body' | 'sgp4';

export type PropagationResult = {
  state: CartesianState;
  geodetic: GeodeticPosition;
};
