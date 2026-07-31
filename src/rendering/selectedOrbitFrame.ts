import { Box3, Vector3 } from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { keplerianToCartesian } from "../physics/kepler";
import type { SatelliteModel } from "../lib/scenario";
import { eciToThreeVector } from "./coordinates";

export type SelectedOrbitClass =
  | "LEO"
  | "MEO"
  | "GEO"
  | "GTO"
  | "Molniya"
  | "HEO";

export interface SelectedOrbitFrame {
  key: string;
  satelliteId: string;
  orbitClass: SelectedOrbitClass;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  eccentricity: number;
  framingRadiusKm: number;
  target: Vector3;
  viewDirection: Vector3;
  cameraDistanceKm: number;
  earthEmphasis: number;
  selectedOrbitLineWidth: number;
  selectedObjectRadiusKm: number;
  contextObjectRadiusKm: number;
  samplePoints: Vector3[];
}

const DEFAULT_VIEW_DIRECTION = new Vector3(0.68, 0.34, 0.64).normalize();
const DEFAULT_FOV_DEG = 42;
const DEFAULT_ASPECT = 16 / 9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function orbitClassFor(satellite: SatelliteModel): SelectedOrbitClass {
  const { semiMajorAxisKm: a, eccentricity: e, inclinationDeg } = satellite.keplerian;
  const perigeeAltitudeKm = a * (1 - e) - EARTH_RADIUS_KM;
  const apogeeAltitudeKm = a * (1 + e) - EARTH_RADIUS_KM;

  if (e >= 0.5 && inclinationDeg >= 55 && inclinationDeg <= 70 && apogeeAltitudeKm >= 30000) {
    return "Molniya";
  }
  if (e >= 0.18 && perigeeAltitudeKm < 5000 && apogeeAltitudeKm >= 20000) {
    return "GTO";
  }
  if (Math.abs(a - 42164) < 2500 && e < 0.08) {
    return "GEO";
  }
  if (e >= 0.18 || apogeeAltitudeKm >= 42000) {
    return "HEO";
  }
  if (apogeeAltitudeKm <= 2000) {
    return "LEO";
  }
  return "MEO";
}

function sampleOrbit(satellite: SatelliteModel, count = 360): Vector3[] {
  return Array.from({ length: count + 1 }, (_, index) =>
    eciToThreeVector(
      keplerianToCartesian({
        ...satellite.keplerian,
        trueAnomalyDeg: (index / count) * 360,
      }).positionKm,
    ),
  );
}

function orbitPointAt(satellite: SatelliteModel, trueAnomalyDeg: number): Vector3 {
  return eciToThreeVector(
    keplerianToCartesian({
      ...satellite.keplerian,
      trueAnomalyDeg,
    }).positionKm,
  );
}

export function cameraDistanceForSelectedOrbitFrame(
  frame: Pick<SelectedOrbitFrame, "framingRadiusKm">,
  fovDeg = DEFAULT_FOV_DEG,
  aspect = DEFAULT_ASPECT,
): number {
  const verticalHalfFov = (fovDeg * Math.PI) / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(0.1, aspect));
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  return (frame.framingRadiusKm / Math.sin(limitingHalfFov)) * 1.1;
}

export function createSelectedOrbitFrame(satellite: SatelliteModel): SelectedOrbitFrame {
  const points = sampleOrbit(satellite);
  const box = new Box3().setFromPoints(points);
  box.expandByPoint(new Vector3(EARTH_RADIUS_KM, EARTH_RADIUS_KM, EARTH_RADIUS_KM));
  box.expandByPoint(new Vector3(-EARTH_RADIUS_KM, -EARTH_RADIUS_KM, -EARTH_RADIUS_KM));

  const boundsCenter = box.getCenter(new Vector3());
  const a = satellite.keplerian.semiMajorAxisKm;
  const e = satellite.keplerian.eccentricity;
  const perigeeAltitudeKm = a * (1 - e) - EARTH_RADIUS_KM;
  const apogeeAltitudeKm = a * (1 + e) - EARTH_RADIUS_KM;
  const maximumRadiusEarths = (apogeeAltitudeKm + EARTH_RADIUS_KM) / EARTH_RADIUS_KM;
  const centerWeight = clamp((maximumRadiusEarths - 1.4) / 7 + e * 0.55, 0, 0.82);
  const target = boundsCenter.multiplyScalar(centerWeight);
  const framingRadiusKm = Math.max(
    EARTH_RADIUS_KM + target.length(),
    ...points.map((point) => point.distanceTo(target)),
  );

  const periapsis = orbitPointAt(satellite, 0);
  const quarterOrbit = orbitPointAt(satellite, 90);
  const apoapsis = orbitPointAt(satellite, 180);
  const selectedObjectPosition = orbitPointAt(satellite, satellite.keplerian.trueAnomalyDeg);
  const majorAxis = apoapsis.clone().sub(periapsis).normalize();
  const planeNormal = periapsis.clone().cross(quarterOrbit).normalize();
  if (planeNormal.dot(DEFAULT_VIEW_DIRECTION) < 0) {
    planeNormal.multiplyScalar(-1);
  }
  if (majorAxis.dot(selectedObjectPosition) < 0) {
    majorAxis.multiplyScalar(-1);
  }

  const cinematicDirection = planeNormal
    .clone()
    .multiplyScalar(0.88)
    .add(majorAxis.multiplyScalar(0.34))
    .add(new Vector3(0, 0.12, 0))
    .normalize();
  const leoBlend = clamp((maximumRadiusEarths - 1.05) / 1.5, 0, 1);
  const viewDirection = DEFAULT_VIEW_DIRECTION.clone()
    .lerp(cinematicDirection, 0.58 + leoBlend * 0.42)
    .normalize();
  const earthEmphasis = clamp(1.03 - Math.log2(Math.max(1, maximumRadiusEarths)) * 0.085, 0.72, 1);
  const screenScaleRadius = framingRadiusKm * 0.008;

  return {
    key: [
      satellite.id,
      a.toFixed(3),
      e.toFixed(6),
      satellite.keplerian.inclinationDeg.toFixed(4),
      satellite.keplerian.raanDeg.toFixed(4),
      satellite.keplerian.argumentOfPeriapsisDeg.toFixed(4),
    ].join(":"),
    satelliteId: satellite.id,
    orbitClass: orbitClassFor(satellite),
    perigeeAltitudeKm,
    apogeeAltitudeKm,
    eccentricity: e,
    framingRadiusKm,
    target,
    viewDirection,
    cameraDistanceKm: cameraDistanceForSelectedOrbitFrame({ framingRadiusKm }),
    earthEmphasis,
    selectedOrbitLineWidth: clamp(2.5 - Math.log2(Math.max(1, maximumRadiusEarths)) * 0.08, 2.05, 2.5),
    selectedObjectRadiusKm: clamp(screenScaleRadius, 108, 720),
    contextObjectRadiusKm: clamp(screenScaleRadius * 0.42, 44, 280),
    samplePoints: points,
  };
}
