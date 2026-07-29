import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { latLonToThreeVector } from "./coordinates";

interface LatLonGridProps {
  color?: string;
}

export function LatLonGrid({ color = "#7dd3fc" }: LatLonGridProps) {
  const lines = useMemo(() => {
    const radius = EARTH_RADIUS_KM * 1.014;
    const segments = 144;
    const result = [];

    for (let lat = -60; lat <= 60; lat += 30) {
      result.push(
        Array.from({ length: segments + 1 }, (_, index) =>
          latLonToThreeVector(
            {
              latitudeDeg: lat,
              longitudeDeg: -180 + (index / segments) * 360,
            },
            radius,
          ),
        ),
      );
    }

    for (let lon = -150; lon <= 180; lon += 30) {
      result.push(
        Array.from({ length: 73 }, (_, index) =>
          latLonToThreeVector(
            {
              latitudeDeg: -90 + (index / 72) * 180,
              longitudeDeg: lon,
            },
            radius,
          ),
        ),
      );
    }

    return result;
  }, []);

  return (
    <>
      {lines.map((points, index) => (
        <Line
          key={index}
          points={points}
          color={color}
          lineWidth={0.35}
          transparent
          opacity={0.12}
        />
      ))}
    </>
  );
}
