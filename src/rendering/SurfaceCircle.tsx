import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { EARTH_RADIUS_KM, degreesToRadians, radiansToDegrees } from "../physics/constants";
import { latLonToThreeVector } from "./coordinates";

interface SurfaceCircleProps {
  latitudeDeg: number;
  longitudeDeg: number;
  angularRadiusDeg: number;
  color: string;
  opacity?: number;
  lineWidth?: number;
  altitudeKm?: number;
}

export function destinationPoint(
  latitudeDeg: number,
  longitudeDeg: number,
  angularDistanceDeg: number,
  bearingDeg: number,
): { latitudeDeg: number; longitudeDeg: number } {
  const lat1 = degreesToRadians(latitudeDeg);
  const lon1 = degreesToRadians(longitudeDeg);
  const distance = degreesToRadians(angularDistanceDeg);
  const bearing = degreesToRadians(bearingDeg);
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinDistance = Math.sin(distance);
  const cosDistance = Math.cos(distance);
  const lat2 = Math.asin(
    sinLat1 * cosDistance + cosLat1 * sinDistance * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * sinDistance * cosLat1,
      cosDistance - sinLat1 * Math.sin(lat2),
    );

  return {
    latitudeDeg: radiansToDegrees(lat2),
    longitudeDeg: ((radiansToDegrees(lon2) + 540) % 360) - 180,
  };
}

export function SurfaceCircle({
  latitudeDeg,
  longitudeDeg,
  angularRadiusDeg,
  color,
  opacity = 0.7,
  lineWidth = 1,
  altitudeKm = 12,
}: SurfaceCircleProps) {
  const points = useMemo(() => {
    const radius = EARTH_RADIUS_KM + altitudeKm;
    const clampedAngularRadius = Math.max(0.1, Math.min(88, angularRadiusDeg));

    return Array.from({ length: 145 }, (_, index) => {
      const bearing = (index / 144) * 360;
      const point = destinationPoint(latitudeDeg, longitudeDeg, clampedAngularRadius, bearing);
      return latLonToThreeVector(point, radius);
    });
  }, [altitudeKm, angularRadiusDeg, latitudeDeg, longitudeDeg]);

  return <Line points={points} color={color} lineWidth={lineWidth} transparent opacity={opacity} />;
}
