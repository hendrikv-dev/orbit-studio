import {
  AstroTime,
  Body,
  GeoVector,
  Illumination,
  KM_PER_AU,
  RotateVector,
  Rotation_EQD_EQJ,
  Rotation_EQJ_EQD,
  SiderealTime,
  Vector as AstronomyVector,
} from "astronomy-engine";
import { Matrix4, Quaternion, Vector3 } from "three";

export const CELESTIAL_MODEL_ID = "Astronomy Engine 2.1.19";
export const CELESTIAL_MODEL_SUPPORTED_START_ISO = "1600-01-01T00:00:00.000Z";
export const CELESTIAL_MODEL_SUPPORTED_END_ISO = "2200-01-01T00:00:00.000Z";
export const STAR_CATALOG_ID = "HYG Database v4.1, V<=5.1";
export const STAR_CATALOG_EPOCH = "J2000.0";
export const STAR_CATALOG_FRAME = "ICRS-compatible J2000 mean equator/equinox (EQJ)";

export const CELESTIAL_FRAME_DESCRIPTION = Object.freeze({
  inertial: "EQJ: geocentric J2000 mean equator/equinox; +X toward the J2000 equinox, +Y toward RA 6h, +Z north; right-handed.",
  earthFixed: "ECEF: +X at latitude 0/longitude 0, +Y at latitude 0/longitude +90 east, +Z north; right-handed.",
  scene: "Three.js world: +X=EQJ +X, +Y=EQJ +Z (north), +Z=EQJ -Y; right-handed, Y-up.",
  earthTexture: "Equirectangular, north-up, east-positive geography; local +X is longitude 0 and local -Z is longitude +90 east.",
});

export interface CelestialTimeScales {
  utcIso: string;
  julianDateUtc: number;
  ut1DaysSinceJ2000: number;
  julianDateUt1: number;
  terrestrialTimeDaysSinceJ2000: number;
  julianDateTt: number;
  deltaTSeconds: number;
  tdbUsage: "not exposed; Astronomy Engine evaluates its ephemeris from TT internally";
}

export interface CelestialState {
  time: CelestialTimeScales;
  greenwichApparentSiderealTimeDeg: number;
  earthFixedToSceneQuaternion: Quaternion;
  sunEqjAu: Vector3;
  sunEqjDirection: Vector3;
  sunSceneDirection: Vector3;
  sunEarthLocalDirection: Vector3;
  subsolarLatitudeDeg: number;
  subsolarLongitudeDeg: number;
  moonEqjAu: Vector3;
  moonEqjDirection: Vector3;
  moonSceneDirection: Vector3;
  moonDistanceKm: number;
  moonPhaseAngleDeg: number;
  moonIlluminatedFraction: number;
}

const J2000_JULIAN_DATE = 2_451_545;
const UNIX_EPOCH_JULIAN_DATE = 2_440_587.5;

function normalizeLongitude(longitudeDeg: number): number {
  return ((longitudeDeg + 540) % 360) - 180;
}

export function parseCanonicalSimulationTime(value: string | Date | number): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  const timeMs = date.getTime();
  if (!Number.isFinite(timeMs)) {
    throw new RangeError(`Invalid canonical simulation timestamp: ${String(value)}`);
  }

  const earliest = Date.parse(CELESTIAL_MODEL_SUPPORTED_START_ISO);
  const latest = Date.parse(CELESTIAL_MODEL_SUPPORTED_END_ISO);
  if (timeMs < earliest || timeMs > latest) {
    throw new RangeError(
      `Simulation timestamp ${date.toISOString()} is outside the validated celestial range ${CELESTIAL_MODEL_SUPPORTED_START_ISO}..${CELESTIAL_MODEL_SUPPORTED_END_ISO}.`,
    );
  }

  return date;
}

function astronomyVectorToThree(vector: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(vector.x, vector.z, -vector.y);
}

export function eqjVectorToScene(vector: Vector3, target = new Vector3()): Vector3 {
  return target.set(vector.x, vector.z, -vector.y);
}

export function sceneVectorToEqj(vector: Vector3, target = new Vector3()): Vector3 {
  return target.set(vector.x, -vector.z, vector.y);
}

function ecefDirectionToEqj(
  direction: Vector3,
  time: AstroTime,
  gastRad: number,
): Vector3 {
  const cosGast = Math.cos(gastRad);
  const sinGast = Math.sin(gastRad);
  const eqd = new AstronomyVector(
    cosGast * direction.x - sinGast * direction.y,
    sinGast * direction.x + cosGast * direction.y,
    direction.z,
    time,
  );
  const eqj = RotateVector(Rotation_EQD_EQJ(time), eqd);
  return new Vector3(eqj.x, eqj.y, eqj.z).normalize();
}

export function earthFixedToSceneQuaternionAt(
  value: string | Date | number,
  target = new Quaternion(),
): Quaternion {
  const date = parseCanonicalSimulationTime(value);
  const time = new AstroTime(date);
  const gastRad = SiderealTime(time) * Math.PI / 12;
  const worldX = eqjVectorToScene(
    ecefDirectionToEqj(new Vector3(1, 0, 0), time, gastRad),
  );
  const worldY = eqjVectorToScene(
    ecefDirectionToEqj(new Vector3(0, 0, 1), time, gastRad),
  );
  const worldZ = eqjVectorToScene(
    ecefDirectionToEqj(new Vector3(0, -1, 0), time, gastRad),
  );

  return target.setFromRotationMatrix(new Matrix4().makeBasis(worldX, worldY, worldZ)).normalize();
}

export function computeCelestialState(value: string | Date | number): CelestialState {
  const date = parseCanonicalSimulationTime(value);
  const time = new AstroTime(date);
  const sun = GeoVector(Body.Sun, time, true);
  const moon = GeoVector(Body.Moon, time, true);
  const moonIllumination = Illumination(Body.Moon, time);
  const sunEqjAu = new Vector3(sun.x, sun.y, sun.z);
  const moonEqjAu = new Vector3(moon.x, moon.y, moon.z);
  const sunEqjDirection = sunEqjAu.clone().normalize();
  const moonEqjDirection = moonEqjAu.clone().normalize();
  const sunSceneDirection = astronomyVectorToThree(sun).normalize();
  const moonSceneDirection = astronomyVectorToThree(moon).normalize();
  const gastDeg = SiderealTime(time) * 15;
  const sunOfDate = RotateVector(Rotation_EQJ_EQD(time), sun);
  const rightAscensionDeg = Math.atan2(sunOfDate.y, sunOfDate.x) * 180 / Math.PI;
  const subsolarLatitudeDeg = Math.asin(
    sunOfDate.z / Math.hypot(sunOfDate.x, sunOfDate.y, sunOfDate.z),
  ) * 180 / Math.PI;
  const earthFixedToSceneQuaternion = earthFixedToSceneQuaternionAt(date);
  const sunEarthLocalDirection = sunSceneDirection
    .clone()
    .applyQuaternion(earthFixedToSceneQuaternion.clone().invert())
    .normalize();
  const julianDateUtc = date.getTime() / 86_400_000 + UNIX_EPOCH_JULIAN_DATE;

  return {
    time: {
      utcIso: date.toISOString(),
      julianDateUtc,
      ut1DaysSinceJ2000: time.ut,
      julianDateUt1: time.ut + J2000_JULIAN_DATE,
      terrestrialTimeDaysSinceJ2000: time.tt,
      julianDateTt: time.tt + J2000_JULIAN_DATE,
      deltaTSeconds: (time.tt - time.ut) * 86_400,
      tdbUsage: "not exposed; Astronomy Engine evaluates its ephemeris from TT internally",
    },
    greenwichApparentSiderealTimeDeg: gastDeg,
    earthFixedToSceneQuaternion,
    sunEqjAu,
    sunEqjDirection,
    sunSceneDirection,
    sunEarthLocalDirection,
    subsolarLatitudeDeg,
    subsolarLongitudeDeg: normalizeLongitude(rightAscensionDeg - gastDeg),
    moonEqjAu,
    moonEqjDirection,
    moonSceneDirection,
    moonDistanceKm: moon.Length() * KM_PER_AU,
    moonPhaseAngleDeg: moonIllumination.phase_angle,
    moonIlluminatedFraction: moonIllumination.phase_fraction,
  };
}
