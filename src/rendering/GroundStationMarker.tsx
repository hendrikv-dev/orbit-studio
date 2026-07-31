import type { ThreeEvent } from "@react-three/fiber";
import { EARTH_RADIUS_KM } from "../physics/constants";
import type { GroundStationModel } from "../lib/scenario";
import { latLonToThreeVector } from "./coordinates";
import { SurfaceCircle } from "./SurfaceCircle";

interface GroundStationMarkerProps {
  station: GroundStationModel;
  selected: boolean;
  onSelect: (stationId: string) => void;
  onHover: (stationId: string | null) => void;
  colorOverride?: string;
}

export function GroundStationMarker({
  station,
  selected,
  onSelect,
  onHover,
  colorOverride,
}: GroundStationMarkerProps) {
  if (!station.visible) {
    return null;
  }

  const position = latLonToThreeVector(
    {
      latitudeDeg: station.latitudeDeg,
      longitudeDeg: station.longitudeDeg,
    },
    EARTH_RADIUS_KM + station.altitudeMeters / 1000 + 52,
  );
  const horizonAngularRadius = Math.max(12, Math.min(86, 90 - station.minimumElevationDeg));
  const color = colorOverride ?? station.color;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(station.id);
  };
  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(station.id);
  };
  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(null);
  };

  return (
    <group>
      {station.showHorizonCircle && (
        <SurfaceCircle
          latitudeDeg={station.latitudeDeg}
          longitudeDeg={station.longitudeDeg}
          angularRadiusDeg={horizonAngularRadius}
          color={color}
          opacity={selected ? 0.46 : 0.18}
          lineWidth={selected ? 1.05 : 0.48}
        />
      )}
      {station.showCoverageCone && (
        <SurfaceCircle
          latitudeDeg={station.latitudeDeg}
          longitudeDeg={station.longitudeDeg}
          angularRadiusDeg={Math.max(6, horizonAngularRadius * 0.42)}
          color={color}
          opacity={selected ? 0.2 : 0.08}
          lineWidth={selected ? 0.62 : 0.38}
          altitudeKm={70}
        />
      )}
      <group position={position}>
        <mesh onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
          {selected ? (
            <cylinderGeometry args={[70, 112, 150, 12]} />
          ) : (
            <sphereGeometry args={[82, 14, 8]} />
          )}
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={selected ? 1.7 : 0.85}
          />
        </mesh>
        {selected && (
          <>
            <mesh position={[0, 118, 0]} rotation={[Math.PI / 5, 0, 0]}>
              <sphereGeometry args={[116, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshBasicMaterial color={color} wireframe />
            </mesh>
            <mesh>
              <sphereGeometry args={[270, 20, 12]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.25} wireframe depthWrite={false} />
            </mesh>
            <pointLight color={color} intensity={2} distance={1600} />
          </>
        )}
      </group>
    </group>
  );
}
