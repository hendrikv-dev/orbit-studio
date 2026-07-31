import { EARTH_RADIUS_KM, degreesToRadians, radiansToDegrees } from "./constants";
import { ecefToGeodetic, eciToEcef } from "./coordinates";
import { sensorFootprintAngularRadiusDeg } from "./coverage";
import { altitudeKm } from "./kepler";
import type {
  CoverageSettings,
  GroundStationModel,
  RegionModel,
  SatelliteModel,
} from "../lib/scenario";
import { propagateSatellite } from "../lib/propagation";

export interface RegionCoverageState {
  regionId: string;
  coveredPercent: number;
  visibleNow: boolean;
  nextVisibilityTime: string | null;
}

export interface CoverageTargetSet {
  satellites: SatelliteModel[];
  groundStations: GroundStationModel[];
}

function regionSamplePoints(region: RegionModel): Array<{ latitudeDeg: number; longitudeDeg: number }> {
  if (region.boundary.kind === "circle") {
    const center = {
      latitudeDeg: region.boundary.centerLatitudeDeg,
      longitudeDeg: region.boundary.centerLongitudeDeg,
    };
    const radius = region.boundary.radiusDeg;
    return [
      center,
      { latitudeDeg: center.latitudeDeg + radius, longitudeDeg: center.longitudeDeg },
      { latitudeDeg: center.latitudeDeg - radius, longitudeDeg: center.longitudeDeg },
      { latitudeDeg: center.latitudeDeg, longitudeDeg: center.longitudeDeg + radius },
      { latitudeDeg: center.latitudeDeg, longitudeDeg: center.longitudeDeg - radius },
    ];
  }

  const points = region.boundary.points;
  if (points.length === 0) {
    return [];
  }

  const center = points.reduce(
    (accumulator, point) => ({
      latitudeDeg: accumulator.latitudeDeg + point.latitudeDeg / points.length,
      longitudeDeg: accumulator.longitudeDeg + point.longitudeDeg / points.length,
    }),
    { latitudeDeg: 0, longitudeDeg: 0 },
  );

  return [center, ...points];
}

function angularDistanceDeg(
  a: { latitudeDeg: number; longitudeDeg: number },
  b: { latitudeDeg: number; longitudeDeg: number },
): number {
  const lat1 = degreesToRadians(a.latitudeDeg);
  const lat2 = degreesToRadians(b.latitudeDeg);
  const dLat = lat2 - lat1;
  const dLon = degreesToRadians(b.longitudeDeg - a.longitudeDeg);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return radiansToDegrees(2 * Math.asin(Math.min(1, Math.sqrt(h))));
}

function coveredBySatellite(
  region: RegionModel,
  satellite: SatelliteModel,
  date: Date,
  requireEnabledSensor: boolean,
): number {
  if (!satellite.visualization.visible || (requireEnabledSensor && !satellite.sensor.enabled)) {
    return 0;
  }

  const state = propagateSatellite(satellite, date);
  const subpoint = ecefToGeodetic(eciToEcef(state, date));
  const radiusDeg = sensorFootprintAngularRadiusDeg(
    altitudeKm(state),
    satellite.sensor.halfAngleDeg,
  );
  const samples = regionSamplePoints(region);
  if (samples.length === 0 || radiusDeg <= 0) {
    return 0;
  }

  const covered = samples.filter((point) => angularDistanceDeg(point, subpoint) <= radiusDeg);
  return (covered.length / samples.length) * 100;
}

function coveredByGroundStation(
  region: RegionModel,
  station: GroundStationModel,
): number {
  if (!station.visible) {
    return 0;
  }

  const horizonRadiusDeg = Math.max(8, Math.min(86, 90 - station.minimumElevationDeg));
  const samples = regionSamplePoints(region);
  const stationPoint = {
    latitudeDeg: station.latitudeDeg,
    longitudeDeg: station.longitudeDeg,
  };
  const covered = samples.filter((point) => angularDistanceDeg(point, stationPoint) <= horizonRadiusDeg);

  return samples.length > 0 ? (covered.length / samples.length) * 100 : 0;
}

function coverageAtDate(
  region: RegionModel,
  target: CoverageTargetSet,
  settings: CoverageSettings,
  date: Date,
): number {
  if (!settings.enabled || !region.visible) {
    return 0;
  }

  if (settings.targetType === "ground-station") {
    const station = target.groundStations[0];
    return station ? coveredByGroundStation(region, station) : 0;
  }

  const requireEnabledSensor = settings.targetType === "sensor";
  const satelliteCoverage = Math.max(
    0,
    ...target.satellites.map((satellite) =>
      coveredBySatellite(region, satellite, date, requireEnabledSensor),
    ),
  );
  const stationCoverage = Math.max(
    0,
    ...target.groundStations.map((station) => coveredByGroundStation(region, station)),
  );

  return Math.max(satelliteCoverage, stationCoverage);
}

export function computeRegionCoverage(
  region: RegionModel,
  target: CoverageTargetSet,
  settings: CoverageSettings,
  date: Date,
): RegionCoverageState {
  const coveredPercent = coverageAtDate(region, target, settings, date);
  return {
    regionId: region.id,
    coveredPercent,
    visibleNow: coveredPercent >= 1,
    nextVisibilityTime: null,
  };
}

export function computeNextRegionVisibility(
  region: RegionModel,
  target: CoverageTargetSet,
  settings: CoverageSettings,
  date: Date,
): string | null {
  if (!settings.showFutureVisibility || settings.lookAheadMinutes <= 0) {
    return null;
  }

  const stepMinutes = 5;
  for (let minute = stepMinutes; minute <= settings.lookAheadMinutes; minute += stepMinutes) {
    const sampleDate = new Date(date.getTime() + minute * 60000);
    if (coverageAtDate(region, target, settings, sampleDate) >= 1) {
      return sampleDate.toISOString();
    }
  }

  return null;
}

export function targetSetForCoverage(
  settings: CoverageSettings,
  satellites: SatelliteModel[],
  groundStations: GroundStationModel[],
  constellationSatelliteIds: string[] = [],
): CoverageTargetSet {
  if (settings.targetType === "constellation") {
    return {
      satellites:
        settings.targetId === null
          ? satellites
          : satellites.filter((satellite) => constellationSatelliteIds.includes(satellite.id)),
      groundStations: settings.targetId === null ? groundStations : [],
    };
  }

  if (settings.targetType === "ground-station") {
    return {
      satellites: [],
      groundStations: groundStations.filter((station) => station.id === settings.targetId),
    };
  }

  return {
    satellites: satellites.filter((satellite) =>
      settings.targetId ? satellite.id === settings.targetId : true,
    ),
    groundStations: [],
  };
}

export function sensorFootprintRadiusKm(satellite: SatelliteModel, date: Date): number {
  const state = propagateSatellite(satellite, date);
  const angularRadiusDeg = sensorFootprintAngularRadiusDeg(
    altitudeKm(state),
    satellite.sensor.halfAngleDeg,
  );

  return (degreesToRadians(angularRadiusDeg) * EARTH_RADIUS_KM);
}
