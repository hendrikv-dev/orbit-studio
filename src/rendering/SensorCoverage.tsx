import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { altitudeKm } from "../physics/kepler";
import { ecefToEci, ecefToGeodetic, eciToEcef, geodeticToEcef } from "../physics/coordinates";
import { sensorFootprintAngularRadiusDeg } from "../physics/coverage";
import type { SatelliteModel } from "../lib/scenario";
import { propagateSatellite } from "../lib/propagation";
import { eciToThreeVector } from "./coordinates";
import { destinationPoint, SurfaceCircle } from "./SurfaceCircle";

interface SensorCoverageProps {
  satellite: SatelliteModel;
  simulationTime: string;
  priority?: boolean;
}

export function SensorFootprint({
  satellite,
  simulationTime,
  priority = false,
}: SensorCoverageProps) {
  const footprint = useMemo(() => {
    if (
      !satellite.visualization.visible ||
      !satellite.sensor.enabled ||
      !satellite.sensor.showFootprint
    ) {
      return null;
    }

    try {
      const date = new Date(simulationTime);
      const state = propagateSatellite(satellite, date);
      const geodetic = ecefToGeodetic(eciToEcef(state, date));
      return {
        ...geodetic,
        angularRadiusDeg: sensorFootprintAngularRadiusDeg(
          altitudeKm(state),
          satellite.sensor.halfAngleDeg,
        ),
      };
    } catch {
      return null;
    }
  }, [satellite, simulationTime]);

  if (!footprint) {
    return null;
  }

  return (
    <SurfaceCircle
      latitudeDeg={footprint.latitudeDeg}
      longitudeDeg={footprint.longitudeDeg}
      angularRadiusDeg={footprint.angularRadiusDeg}
      color={satellite.visualization.color}
      opacity={priority ? 0.34 : 0.16}
      lineWidth={priority ? 0.88 : 0.5}
      altitudeKm={20}
    />
  );
}

export function SensorCone({
  satellite,
  simulationTime,
  priority = false,
}: SensorCoverageProps) {
  const cone = useMemo(() => {
    if (
      !satellite.visualization.visible ||
      !satellite.sensor.enabled ||
      !satellite.sensor.showCone
    ) {
      return null;
    }

    try {
      const date = new Date(simulationTime);
      const state = propagateSatellite(satellite, date);
      const subpoint = ecefToGeodetic(eciToEcef(state, date));
      const angularRadiusDeg = sensorFootprintAngularRadiusDeg(
        altitudeKm(state),
        satellite.sensor.halfAngleDeg,
      );
      const satellitePoint = eciToThreeVector(state.positionKm);
      const nadirPoint = eciToThreeVector(
        ecefToEci(
          geodeticToEcef({
            latitudeDeg: subpoint.latitudeDeg,
            longitudeDeg: subpoint.longitudeDeg,
            altitudeKm: 20,
          }),
          date,
        ),
      );
      const spokes = Array.from({ length: 12 }, (_, index) => {
        const rimPoint = destinationPoint(
          subpoint.latitudeDeg,
          subpoint.longitudeDeg,
          angularRadiusDeg,
          (index / 12) * 360,
        );

        return [
          satellitePoint,
          eciToThreeVector(
            ecefToEci(
              geodeticToEcef({
                ...rimPoint,
                altitudeKm: 20,
              }),
              date,
            ),
          ),
        ];
      });

      return {
        nadir: [satellitePoint, nadirPoint],
        spokes,
      };
    } catch {
      return null;
    }
  }, [satellite, simulationTime]);

  if (!cone) {
    return null;
  }

  return (
    <>
      <Line
        points={cone.nadir}
        color={satellite.visualization.color}
        lineWidth={priority ? 0.62 : 0.38}
        transparent
        opacity={priority ? 0.3 : 0.14}
      />
      {cone.spokes.map((points, index) => (
        <Line
          key={index}
          points={points}
          color={satellite.visualization.color}
          lineWidth={priority ? 0.42 : 0.28}
          transparent
          opacity={priority ? 0.16 : 0.08}
        />
      ))}
    </>
  );
}
