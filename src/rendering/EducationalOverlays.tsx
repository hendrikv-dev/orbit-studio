import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { Vector3 } from "three";
import { EARTH_RADIUS_KM, degreesToRadians } from "../physics/constants";
import { ecefToEci, ecefToGeodetic, eciToEcef, geodeticToEcef } from "../physics/coordinates";
import { keplerianToCartesian } from "../physics/kepler";
import type { EducationalOverlay, SatelliteModel } from "../lib/scenario";
import { propagateSatellite } from "../lib/propagation";
import { eciToThreeVector } from "./coordinates";

interface EducationalOverlaysProps {
  overlay: EducationalOverlay;
  satellite?: SatelliteModel;
  simulationTime: string;
}

function ringPoints(radiusKm: number, inclinationDeg = 0): Vector3[] {
  const inclination = degreesToRadians(inclinationDeg);
  return Array.from({ length: 145 }, (_, index) => {
    const angle = (index / 144) * Math.PI * 2;
    const x = radiusKm * Math.cos(angle);
    const y = radiusKm * Math.sin(angle) * Math.sin(inclination);
    const z = radiusKm * Math.sin(angle) * Math.cos(inclination);
    return new Vector3(x, y, z);
  });
}

const CENTER = new Vector3();

export function EducationalOverlays({
  overlay,
  satellite,
  simulationTime,
}: EducationalOverlaysProps) {
  const diagram = useMemo(() => {
    if (!satellite || overlay === "none") {
      return null;
    }

    try {
      const date = new Date(simulationTime);
      const state = propagateSatellite(satellite, date);
      const satellitePoint = eciToThreeVector(state.positionKm);
      const subpoint = ecefToGeodetic(eciToEcef(state, date));
      const surfacePoint = eciToThreeVector(
        ecefToEci(
          geodeticToEcef({
            latitudeDeg: subpoint.latitudeDeg,
            longitudeDeg: subpoint.longitudeDeg,
            altitudeKm: 0,
          }),
          date,
        ),
      );
      const pointAtAnomaly = (trueAnomalyDeg: number) =>
        eciToThreeVector(
          keplerianToCartesian({
            ...satellite.keplerian,
            trueAnomalyDeg,
          }).positionKm,
        );
      const orbit = Array.from({ length: 145 }, (_, index) =>
        pointAtAnomaly((index / 144) * 360),
      );
      const periapsis = pointAtAnomaly(0);
      const apoapsis = pointAtAnomaly(180);
      const ascendingNode = pointAtAnomaly(-satellite.keplerian.argumentOfPeriapsisDeg);
      const nodeDirection = ascendingNode.clone().normalize().multiplyScalar(EARTH_RADIUS_KM * 1.72);

      return {
        satellitePoint,
        surfacePoint,
        equator: ringPoints(EARTH_RADIUS_KM * 1.22),
        inclined: ringPoints(EARTH_RADIUS_KM * 1.28, satellite.keplerian.inclinationDeg),
        orbit,
        periapsis,
        apoapsis,
        nodeLine: [nodeDirection.clone().multiplyScalar(-1), nodeDirection],
      };
    } catch {
      return null;
    }
  }, [overlay, satellite, simulationTime]);

  if (!diagram || !satellite) {
    return null;
  }

  return (
    <group>
      {overlay === "altitude" && (
        <Line
          points={[diagram.surfacePoint, diagram.satellitePoint]}
          color="#67e8f9"
          lineWidth={1.2}
          transparent
          opacity={0.74}
        />
      )}
      {overlay === "inclination" && (
        <>
          <Line points={diagram.equator} color="#64748b" lineWidth={0.7} transparent opacity={0.44} />
          <Line points={diagram.inclined} color="#a78bfa" lineWidth={1.05} transparent opacity={0.72} />
        </>
      )}
      {overlay === "raan" && (
        <>
          <Line points={diagram.equator} color="#64748b" lineWidth={0.7} transparent opacity={0.4} />
          <Line points={diagram.orbit} color="#67e8f9" lineWidth={1.2} transparent opacity={0.72} />
          <Line points={diagram.nodeLine} color="#f6b94e" lineWidth={1.35} transparent opacity={0.9} />
        </>
      )}
      {overlay === "argument-of-periapsis" && (
        <>
          <Line points={diagram.orbit} color="#67e8f9" lineWidth={0.8} transparent opacity={0.44} />
          <Line points={[CENTER, diagram.periapsis]} color="#f472b6" lineWidth={1.55} transparent opacity={0.9} />
          <mesh position={diagram.periapsis}>
            <sphereGeometry args={[105, 18, 12]} />
            <meshBasicMaterial color="#f472b6" toneMapped={false} />
          </mesh>
        </>
      )}
      {overlay === "true-anomaly" && (
        <>
          <Line points={diagram.orbit} color="#67e8f9" lineWidth={0.72} transparent opacity={0.34} />
          <Line points={[CENTER, diagram.periapsis]} color="#f472b6" lineWidth={0.7} transparent opacity={0.42} />
          <Line points={[CENTER, diagram.satellitePoint]} color="#f8fafc" lineWidth={1.5} transparent opacity={0.86} />
          <mesh position={diagram.satellitePoint}>
            <sphereGeometry args={[120, 18, 12]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
        </>
      )}
      {overlay === "eccentricity" && (
        <>
          <Line points={diagram.orbit} color="#a78bfa" lineWidth={1.35} transparent opacity={0.78} />
          <Line points={[diagram.periapsis, diagram.apoapsis]} color="#f8fafc" lineWidth={0.75} transparent opacity={0.42} />
          {[diagram.periapsis, diagram.apoapsis].map((point, index) => (
            <mesh key={index} position={point}>
              <sphereGeometry args={[82, 16, 10]} />
              <meshBasicMaterial color={index === 0 ? "#f472b6" : "#a78bfa"} toneMapped={false} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}
