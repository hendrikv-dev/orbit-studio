import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { AdditiveBlending, Group, Vector3 } from "three";
import type { SatelliteModel } from "../lib/scenario";
import { isRenderableCartesianState, propagateSatellite } from "../lib/propagation";
import { eciToThreeVector } from "./coordinates";
import { readScenePlaybackTimeMs, readSceneSatelliteState } from "./sceneMotion";
import { readPopulationScenePosition } from "./populationMotion";
import type { SelectedOrbitFrame } from "./selectedOrbitFrame";
import { EARTH_RADIUS_KM } from "../physics/constants";

const MOTION_UP = new Vector3(0, 1, 0);

interface SatelliteMarkerProps {
  satellite: SatelliteModel;
  simulationTime: string;
  selected: boolean;
  onSelect: (satelliteId: string) => void;
  onHover: (satelliteId: string | null) => void;
  selectedOrbitFrame?: SelectedOrbitFrame | null;
  orbitAwareFraming?: boolean;
  staticPosition?: boolean;
  architectureFocus?: boolean;
  colorOverride?: string;
  hero?: boolean;
}

export function SatelliteMarker({
  satellite,
  simulationTime,
  selected,
  onSelect,
  onHover,
  selectedOrbitFrame,
  orbitAwareFraming = false,
  staticPosition = false,
  architectureFocus = false,
  colorOverride,
  hero = false,
}: SatelliteMarkerProps) {
  const visualRadius = hero
    ? selected ? 142 : 86
    : orbitAwareFraming && selectedOrbitFrame
      ? selected
        ? selectedOrbitFrame.selectedObjectRadiusKm
        : selectedOrbitFrame.contextObjectRadiusKm * (architectureFocus ? 0.72 : 1)
      : selected
        ? 108
        : 64;
  const groupRef = useRef<Group | null>(null);
  const heroVisualRef = useRef<Group | null>(null);
  const motionDirectionRef = useRef<Group | null>(null);
  const motionDirectionVectorRef = useRef(new Vector3());
  const motionDirectionPositionRef = useRef(new Vector3());
  const populationPositionRef = useRef(new Vector3());
  const displayedPositionRef = useRef<Vector3 | null>(null);
  const position = useMemo(() => {
    try {
      const state = propagateSatellite(satellite, new Date(simulationTime));
      if (!isRenderableCartesianState(state)) return null;
      return eciToThreeVector(state.positionKm);
    } catch {
      return null;
    }
  }, [satellite, simulationTime]);

  useEffect(() => {
    if (position && !displayedPositionRef.current) {
      displayedPositionRef.current = position.clone();
    }
  }, [position]);

  useFrame(({ camera }, delta) => {
    if (!groupRef.current) {
      return;
    }

    if (staticPosition) {
      if (position) groupRef.current.position.copy(position);
      return;
    }

    const playbackTimeMs = readScenePlaybackTimeMs();
    const hasPopulationPosition = readPopulationScenePosition(
      satellite,
      playbackTimeMs,
      populationPositionRef.current,
    );
    let nextPosition = hasPopulationPosition ? populationPositionRef.current : position;
    try {
      const state = readSceneSatelliteState(satellite);
      if (!hasPopulationPosition) nextPosition = eciToThreeVector(state.positionKm);
      if (motionDirectionRef.current) {
        const direction = motionDirectionVectorRef.current
          .set(state.velocityKmS[0], state.velocityKmS[2], state.velocityKmS[1])
          .normalize();
        motionDirectionRef.current.position.copy(
          motionDirectionPositionRef.current
            .copy(direction)
            .multiplyScalar(visualRadius * 3.2),
        );
        motionDirectionRef.current.quaternion.setFromUnitVectors(
          MOTION_UP,
          direction,
        );
      }
    } catch {
      return;
    }

    if (!nextPosition) {
      return;
    }

    if (!displayedPositionRef.current) {
      displayedPositionRef.current = nextPosition.clone();
    }

    if (selected) {
      displayedPositionRef.current.copy(nextPosition);
    } else {
      const alpha = 1 - Math.exp(-delta * 14);
      displayedPositionRef.current.lerp(nextPosition, alpha);
    }
    groupRef.current.position.copy(displayedPositionRef.current);

    if (hero && heroVisualRef.current) {
      const distance = camera.position.distanceTo(displayedPositionRef.current);
      const targetScale = Math.min(4.8, Math.max(0.82, distance / (EARTH_RADIUS_KM * 2.35)));
      const alpha = 1 - Math.exp(-delta * 8);
      const nextScale = heroVisualRef.current.scale.x +
        (targetScale - heroVisualRef.current.scale.x) * alpha;
      heroVisualRef.current.scale.setScalar(nextScale);
    }
  });

  if (!satellite.visualization.visible || !position) {
    return null;
  }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(satellite.id);
  };
  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(satellite.id);
  };
  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(null);
  };
  const hitRadius = Math.max(visualRadius * (hero ? (selected ? 3.2 : 2.6) : 2.2), selected ? 260 : 210);
  const color = colorOverride ?? satellite.visualization.color;

  const selectedIcon = selected && !hero ? (
    <group renderOrder={8}>
      <mesh renderOrder={8}>
        <sphereGeometry args={[visualRadius * 1.08, 20, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh renderOrder={9}>
        <sphereGeometry args={[visualRadius * 0.38, 16, 10]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <mesh renderOrder={7}>
        <sphereGeometry args={[visualRadius * 1.9, 24, 14]} />
        <meshBasicMaterial
          color={color}
          blending={AdditiveBlending}
          transparent
          opacity={0.28}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh renderOrder={6}>
        <sphereGeometry args={[visualRadius * 2.6, 24, 14]} />
        <meshBasicMaterial
          color={color}
          blending={AdditiveBlending}
          transparent
          opacity={0.06}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight color={color} intensity={1.6} distance={visualRadius * 10} />
    </group>
  ) : null;

  const heroIcon = hero ? (
    <group ref={heroVisualRef}>
      <mesh renderOrder={6}>
        <sphereGeometry args={[visualRadius, 24, 16]} />
        <meshBasicMaterial
          color={color}
          toneMapped={false}
          transparent={!selected}
          opacity={selected ? 1 : 0.66}
          depthWrite={selected}
        />
      </mesh>
      <mesh renderOrder={7} visible={selected}>
        <sphereGeometry args={[visualRadius * 0.46, 20, 12]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <mesh renderOrder={5} visible={selected}>
        <sphereGeometry args={[visualRadius * 1.75, 24, 16]} />
        <meshBasicMaterial
          color={color}
          blending={AdditiveBlending}
          transparent
          opacity={0.22}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh renderOrder={4} visible={selected}>
        <sphereGeometry args={[visualRadius * 2.5, 24, 16]} />
        <meshBasicMaterial
          color={color}
          blending={AdditiveBlending}
          transparent
          opacity={0.04}
          depthTest
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {selected && <pointLight color={color} intensity={2.8} distance={visualRadius * 15} />}
    </group>
  ) : null;

  return (
    <group ref={groupRef} position={displayedPositionRef.current ?? position}>
      <mesh onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
        {!selected && !hero && <sphereGeometry args={[visualRadius, 16, 8]} />}
        {!selected && !hero && (
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={architectureFocus ? 0.12 : orbitAwareFraming ? 0.34 : 0.68}
            roughness={0.25}
            transparent={orbitAwareFraming}
            opacity={orbitAwareFraming ? (architectureFocus ? 0.34 : 0.68) : 1}
          />
        )}
      </mesh>
      {heroIcon}
      {selectedIcon}
      {selected && orbitAwareFraming && (
        <group ref={motionDirectionRef} renderOrder={8}>
          <mesh>
            <coneGeometry args={[visualRadius * 0.34, visualRadius * 1.05, 10]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh>
            <coneGeometry args={[visualRadius * 0.62, visualRadius * 1.45, 10]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.18}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
      <mesh onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
        <sphereGeometry args={[hitRadius, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
