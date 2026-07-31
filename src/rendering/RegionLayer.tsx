import { useMemo } from "react";
import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  computeNextRegionVisibility,
  computeRegionCoverage,
  targetSetForCoverage,
} from "../physics/regionCoverage";
import type { RegionModel, Scenario } from "../lib/scenario";
import { latLonToThreeVector } from "./coordinates";
import { SurfaceCircle } from "./SurfaceCircle";

interface RegionLayerProps {
  scenario: Scenario;
  selectedRegionId: string | null;
  selectedOnly: boolean;
  onSelect: (regionId: string) => void;
  onHover: (regionId: string | null) => void;
}

function regionCenter(region: RegionModel): { latitudeDeg: number; longitudeDeg: number } {
  if (region.boundary.kind === "circle") {
    return {
      latitudeDeg: region.boundary.centerLatitudeDeg,
      longitudeDeg: region.boundary.centerLongitudeDeg,
    };
  }

  if (region.boundary.points.length === 0) {
    return { latitudeDeg: 0, longitudeDeg: 0 };
  }

  const points = region.boundary.points;
  return points.reduce(
    (accumulator, point) => ({
      latitudeDeg: accumulator.latitudeDeg + point.latitudeDeg / points.length,
      longitudeDeg: accumulator.longitudeDeg + point.longitudeDeg / points.length,
    }),
    { latitudeDeg: 0, longitudeDeg: 0 },
  );
}

function polygonPoints(region: RegionModel) {
  if (region.boundary.kind !== "polygon") {
    return [];
  }

  return [...region.boundary.points, region.boundary.points[0]].map((point) =>
    latLonToThreeVector(point, EARTH_RADIUS_KM + 34),
  );
}

export function RegionLayer({
  scenario,
  selectedRegionId,
  selectedOnly,
  onSelect,
  onHover,
}: RegionLayerProps) {
  const coverage = useMemo(() => {
    const date = new Date(scenario.simulationTimeUtc);
    const targetConstellation = scenario.constellations.find(
      (constellation) => constellation.id === scenario.coverageSettings.targetId,
    );
    const target = targetSetForCoverage(
      scenario.coverageSettings,
      scenario.satellites,
      scenario.groundStations,
      targetConstellation?.satelliteIds ?? [],
    );

    return new Map(
      scenario.regions.map((region) => {
        const current = computeRegionCoverage(region, target, scenario.coverageSettings, date);
        return [
          region.id,
          {
            ...current,
            nextVisibilityTime: computeNextRegionVisibility(
              region,
              target,
              scenario.coverageSettings,
              date,
            ),
          },
        ];
      }),
    );
  }, [scenario]);
  const coverageEnabled =
    scenario.renderSettings.showCoverageLayer && scenario.coverageSettings.enabled;

  return (
    <>
      {scenario.regions
        .filter((region) => region.visible && (!selectedOnly || region.id === selectedRegionId))
        .map((region) => {
          const state = coverage.get(region.id);
          const selected = region.id === selectedRegionId;
          const covered = coverageEnabled && Boolean(state?.visibleNow);
          const color = covered ? "#67e8f9" : selected ? region.color : "#64748b";
          const opacity = covered ? 0.28 : selected ? 0.36 : 0.09;
          const center = regionCenter(region);
          const markerPosition = latLonToThreeVector(center, EARTH_RADIUS_KM + 96);
          const handleClick = (event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation();
            onSelect(region.id);
          };
          const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            onHover(region.id);
          };
          const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            onHover(null);
          };

          return (
            <group key={region.id}>
              {region.boundary.kind === "circle" ? (
                <SurfaceCircle
                  latitudeDeg={region.boundary.centerLatitudeDeg}
                  longitudeDeg={region.boundary.centerLongitudeDeg}
                  angularRadiusDeg={region.boundary.radiusDeg}
                  color={color}
                  opacity={opacity}
                  lineWidth={covered || selected ? 1.12 : 0.5}
                  altitudeKm={34}
                />
              ) : (
                <Line
                  points={polygonPoints(region)}
                  color={color}
                  lineWidth={covered || selected ? 1.02 : 0.48}
                  transparent
                  opacity={opacity}
                />
              )}
              <mesh
                position={markerPosition}
                onClick={handleClick}
                onPointerOver={handlePointerOver}
                onPointerOut={handlePointerOut}
              >
                <sphereGeometry args={[covered || selected ? 92 : 58, 16, 8]} />
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={covered || selected ? 0.95 : 0.22}
                  transparent
                  opacity={covered || selected ? 0.82 : 0.36}
                />
              </mesh>
            </group>
          );
        })}
    </>
  );
}
