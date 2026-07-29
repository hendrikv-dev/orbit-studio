import { useMemo } from "react";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { latLonToThreeVector } from "./coordinates";
import { GEO_VALIDATION_POINTS } from "./geoValidation";

export function GeoValidationOverlay() {
  const markers = useMemo(
    () =>
      GEO_VALIDATION_POINTS.map((point) => ({
        point,
        position: latLonToThreeVector(point, EARTH_RADIUS_KM + 84),
      })),
    [],
  );

  return (
    <group name="OrbitStudioGeoValidationOverlay">
      {markers.map(({ point, position }) => {
        const color = point.kind === "dsn" ? "#fbbf24" : "#2dd4bf";
        const radius = point.kind === "dsn" ? 78 : 62;

        return (
          <mesh key={point.id} position={position} frustumCulled={false}>
            <sphereGeometry args={[radius, 18, 10]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={1.15}
              roughness={0.55}
              metalness={0}
            />
          </mesh>
        );
      })}
    </group>
  );
}
