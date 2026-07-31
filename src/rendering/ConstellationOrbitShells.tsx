import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { DoubleSide } from "three";
import {
  representativePlaneIndices,
  representativePlaneRaanDeg,
  resolveConstellationShellGeometries,
  shellLatitudeLimitDeg,
  type ResolvedConstellationShellGeometry,
} from "../data/explorerConstellationGeometry";
import { representativeConstellationSatellites } from "../data/explorerVisibility";
import type { ConstellationModel, SatelliteModel } from "../lib/scenario";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { keplerianToCartesian } from "../physics/kepler";
import { eciToThreeVector, latLonToThreeVector } from "./coordinates";
import { OrbitPath } from "./OrbitPath";

interface ConstellationOrbitShellsProps {
  orbitConstellationIds: readonly string[];
  shellConstellationIds: readonly string[];
  constellations: ConstellationModel[];
  satellites: SatelliteModel[];
  simulationTime: string;
  quality: "low" | "medium" | "high";
  selectedConstellationId?: string | null;
}

function latitudeRingPoints(radiusKm: number, latitudeDeg: number) {
  return Array.from({ length: 181 }, (_, index) =>
    latLonToThreeVector(
      {
        latitudeDeg,
        longitudeDeg: (index * 360) / 180,
      },
      radiusKm,
    ),
  );
}

function densitySampleCount(population: number): number {
  return Math.min(92, Math.max(12, Math.round(Math.log10(population + 1) * 25)));
}

function densityPositionsForShell(geometry: ResolvedConstellationShellGeometry): Float32Array {
  const shell = geometry.definition;
  const densityCount = densitySampleCount(shell.population);
  const planeIndices = representativePlaneIndices({
    ...shell,
    representativePlanes: Math.min(shell.planeCount, densityCount),
  });
  const points: number[] = [];

  for (let index = 0; index < densityCount; index += 1) {
    const planeIndex = planeIndices[index % planeIndices.length];
    const raanDeg = representativePlaneRaanDeg(shell, planeIndex);
    const trueAnomalyDeg = (index * 137.508) % 360;
    const position = eciToThreeVector(
      keplerianToCartesian({
        semiMajorAxisKm: EARTH_RADIUS_KM + geometry.altitudeKm,
        eccentricity: 0.0004,
        inclinationDeg: geometry.inclinationDeg,
        raanDeg,
        argumentOfPeriapsisDeg: 0,
        trueAnomalyDeg,
        epoch: "2026-06-08T12:00:00.000Z",
      }).positionKm,
    );
    points.push(position.x, position.y, position.z);
  }

  return new Float32Array(points);
}

function ShellEnvelope({
  geometry,
  selected,
}: {
  geometry: ResolvedConstellationShellGeometry;
  selected: boolean;
}) {
  const shell = geometry.definition;
  const radiusKm = EARTH_RADIUS_KM + geometry.altitudeKm;
  const latitudeLimitDeg = shellLatitudeLimitDeg(geometry.inclinationDeg);
  const visibleLatitudeLimitDeg = Math.max(1.5, latitudeLimitDeg);
  const thetaStart = ((90 - visibleLatitudeLimitDeg) * Math.PI) / 180;
  const thetaLength = (visibleLatitudeLimitDeg * 2 * Math.PI) / 180;
  const equatorPoints = useMemo(() => latitudeRingPoints(radiusKm, 0), [radiusKm]);
  const northBoundary = useMemo(
    () => latitudeRingPoints(radiusKm, latitudeLimitDeg),
    [latitudeLimitDeg, radiusKm],
  );
  const southBoundary = useMemo(
    () => latitudeRingPoints(radiusKm, -latitudeLimitDeg),
    [latitudeLimitDeg, radiusKm],
  );
  const showBoundaryRails = latitudeLimitDeg >= 2;

  return (
    <group>
      <mesh>
        <sphereGeometry
          args={[radiusKm, selected ? 96 : 64, selected ? 32 : 20, 0, Math.PI * 2, thetaStart, thetaLength]}
        />
        <meshBasicMaterial
          color={shell.color}
          depthWrite={false}
          opacity={selected ? 0.024 : 0.011}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <Line
        points={equatorPoints}
        color={shell.color}
        depthWrite={false}
        lineWidth={selected ? 1.35 : 0.9}
        opacity={selected ? 0.72 : 0.38}
        transparent
      />
      {showBoundaryRails && (
        <>
          <Line
            points={northBoundary}
            color={shell.color}
            depthWrite={false}
            lineWidth={selected ? 0.9 : 0.62}
            opacity={selected ? 0.48 : 0.26}
            transparent
          />
          <Line
            points={southBoundary}
            color={shell.color}
            depthWrite={false}
            lineWidth={selected ? 0.9 : 0.62}
            opacity={selected ? 0.48 : 0.26}
            transparent
          />
        </>
      )}
    </group>
  );
}

function ShellPopulation({
  geometry,
  selected,
}: {
  geometry: ResolvedConstellationShellGeometry;
  selected: boolean;
}) {
  const shell = geometry.definition;
  const positions = useMemo(() => densityPositionsForShell(geometry), [geometry]);
  const radiusKm = EARTH_RADIUS_KM + geometry.altitudeKm;

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={shell.color}
        depthWrite={false}
        opacity={selected ? 0.8 : 0.4}
        size={Math.max(30, radiusKm * 0.0018)}
        sizeAttenuation
        transparent
      />
    </points>
  );
}

function ConstellationShellArchitecture({
  constellation,
  satellites,
  selected,
}: {
  constellation: ConstellationModel;
  satellites: SatelliteModel[];
  selected: boolean;
}) {
  const geometries = useMemo(
    () => resolveConstellationShellGeometries(constellation, satellites),
    [constellation, satellites],
  );
  if (geometries.length === 0) return null;

  return (
    <>
      {geometries.map((geometry) => (
        <group key={`${constellation.id}:${geometry.definition.id}`}>
          <ShellEnvelope geometry={geometry} selected={selected} />
          <ShellPopulation geometry={geometry} selected={selected} />
        </group>
      ))}
    </>
  );
}

export function ConstellationOrbitShells({
  orbitConstellationIds,
  shellConstellationIds,
  constellations,
  satellites,
  simulationTime,
  quality,
  selectedConstellationId,
}: ConstellationOrbitShellsProps) {
  const representativePlanes = useMemo(() => {
    const visibleIds = new Set(orbitConstellationIds);
    if (selectedConstellationId) visibleIds.add(selectedConstellationId);

    return constellations
      .filter((constellation) => visibleIds.has(constellation.id))
      .flatMap((constellation) =>
        representativeConstellationSatellites(constellation, satellites).map((satellite) => ({
          satellite,
          selected: constellation.id === selectedConstellationId,
        })),
      );
  }, [constellations, orbitConstellationIds, satellites, selectedConstellationId]);
  const shellConstellations = useMemo(() => {
    const visibleIds = new Set(shellConstellationIds);
    if (selectedConstellationId) visibleIds.add(selectedConstellationId);
    return constellations.filter((constellation) => visibleIds.has(constellation.id));
  }, [constellations, selectedConstellationId, shellConstellationIds]);

  return (
    <>
      {shellConstellations.map((constellation) => (
        <ConstellationShellArchitecture
          key={`shell-architecture-${constellation.id}`}
          constellation={constellation}
          satellites={satellites}
          selected={constellation.id === selectedConstellationId}
        />
      ))}
      {representativePlanes.map(({ satellite, selected }) => (
        <OrbitPath
          key={satellite.id}
          satellite={satellite}
          simulationTime={simulationTime}
          quality={quality}
          representative={selected ? "focus-plane" : "plane"}
          visible
        />
      ))}
    </>
  );
}
