import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { sampleGroundTrack, sampleOrbitPath, stateAtTime } from "../physics/orbit";
import { gmstRadians, sunDirectionEci } from "../physics/time";
import { useApsisStore } from "../store/useApsisStore";
import type { GroundTrackPoint, Satellite } from "../types/orbit";
import { Starfield } from "../render/earth/Starfield";
import { createCloudTexture, createEarthTexture, createNightLightsTexture } from "./textures";

const SCENE_SCALE = 1 / EARTH_RADIUS_KM;

export function ApsisScene() {
  const scenario = useApsisStore((state) => state.scenario);
  const selectedSatelliteId = useApsisStore((state) => state.selectedSatelliteId);

  return (
    <Canvas
      camera={{ position: [0, 2.35, 3.6], fov: 44, near: 0.01, far: 120 }}
      dpr={scenario.renderSettings.quality === "low" ? [1, 1.25] : [1, 2]}
      gl={{ antialias: scenario.renderSettings.quality !== "low" }}
    >
      <color attach="background" args={["#030711"]} />
      <ambientLight intensity={0.18} />
      <SceneLights time={scenario.currentTime} />
      <Starfield />
      <Earth time={scenario.currentTime} clouds={scenario.renderSettings.clouds} nightLights={scenario.renderSettings.nightLights} />
      <OrbitShell />
      {scenario.satellites.filter((satellite) => satellite.visible).map((satellite) => (
        <SatelliteVisual
          key={satellite.id}
          satellite={satellite}
          time={scenario.currentTime}
          selected={satellite.id === selectedSatelliteId}
          showGroundTrack={scenario.renderSettings.groundTracks && satellite.showGroundTrack}
        />
      ))}
      <CameraRig
        preset={scenario.cameraSettings.preset}
        selected={scenario.satellites.find((satellite) => satellite.id === selectedSatelliteId)}
        time={scenario.currentTime}
      />
    </Canvas>
  );
}

function SceneLights({ time }: { time: string }) {
  const direction = useMemo(() => sunDirectionEci(time), [time]);
  return (
    <directionalLight
      position={[direction[0] * 6, direction[2] * 6, direction[1] * 6]}
      intensity={3.2}
      color="#f8fbff"
    />
  );
}

function Earth({ time, clouds, nightLights }: { time: string; clouds: boolean; nightLights: boolean }) {
  const earthRef = useRef<THREE.Group>(null);
  const earthTexture = useMemo(() => createEarthTexture(), []);
  const cloudTexture = useMemo(() => createCloudTexture(), []);
  const lightsTexture = useMemo(() => createNightLightsTexture(), []);

  useFrame(() => {
    if (earthRef.current) {
      earthRef.current.rotation.y = -gmstRadians(time);
    }
  });

  return (
    <group ref={earthRef}>
      <mesh>
        <sphereGeometry args={[1, 96, 96]} />
        <meshStandardMaterial map={earthTexture} roughness={0.82} metalness={0.02} />
      </mesh>
      {nightLights ? (
        <mesh>
          <sphereGeometry args={[1.002, 96, 96]} />
          <meshBasicMaterial map={lightsTexture} transparent opacity={0.24} blending={THREE.AdditiveBlending} />
        </mesh>
      ) : null}
      {clouds ? (
        <mesh>
          <sphereGeometry args={[1.014, 96, 96]} />
          <meshStandardMaterial map={cloudTexture} transparent opacity={0.34} depthWrite={false} />
        </mesh>
      ) : null}
      <mesh>
        <sphereGeometry args={[1.06, 96, 96]} />
        <meshBasicMaterial color="#67b7ff" transparent opacity={0.09} side={THREE.BackSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function OrbitShell() {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0005, 1.0015, 192]} />
        <meshBasicMaterial color="#2a4058" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <ringGeometry args={[1.0008, 1.0018, 192]} />
        <meshBasicMaterial color="#1f354d" transparent opacity={0.22} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function SatelliteVisual({
  satellite,
  time,
  selected,
  showGroundTrack
}: {
  satellite: Satellite;
  time: string;
  selected: boolean;
  showGroundTrack: boolean;
}) {
  const state = useMemo(() => stateAtTime(satellite, time), [satellite, time]);
  const position = toScenePosition(state.position);
  const orbitPath = useMemo(
    () => sampleOrbitPath(satellite, time, satellite.propagationMode === "sgp4" ? 120 : 220).map(toScenePosition),
    [satellite, time]
  );
  const groundTrack = useMemo(() => sampleGroundTrack(satellite, time), [satellite, time]);

  return (
    <group>
      {satellite.showOrbitTrail ? <PathLine points={orbitPath} color={satellite.color} opacity={selected ? 0.92 : 0.5} /> : null}
      {showGroundTrack ? <GroundTrack points={groundTrack} color={satellite.color} /> : null}
      <mesh position={position}>
        <sphereGeometry args={[selected ? 0.022 : 0.017, 18, 18]} />
        <meshBasicMaterial color={satellite.color} toneMapped={false} />
      </mesh>
      <pointLight position={position} color={satellite.color} intensity={selected ? 1.4 : 0.65} distance={1.2} />
    </group>
  );
}

function PathLine({ points, color, opacity }: { points: [number, number, number][]; color: string; opacity: number }) {
  const line = useMemo(() => {
    const curvePoints = points.map((point) => new THREE.Vector3(point[0], point[1], point[2]));
    const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.Line(geometry, material);
  }, [color, opacity, points]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line]
  );

  return <primitive object={line} />;
}

function GroundTrack({ points, color }: { points: GroundTrackPoint[]; color: string }) {
  const scenePoints = useMemo(() => points.map((point) => latLonToScene(point.latitude, point.longitude, 1.018)), [points]);
  return <PathLine points={scenePoints} color={color} opacity={0.42} />;
}

function CameraRig({ preset, selected, time }: { preset: string; selected?: Satellite; time: string }) {
  const controls = useRef<any>(null);

  useEffect(() => {
    if (!controls.current) {
      return;
    }
    const object = controls.current.object as THREE.PerspectiveCamera;
    const target = controls.current.target as THREE.Vector3;
    if (preset === "equatorial") {
      object.position.set(0, 0.08, 4.1);
      target.set(0, 0, 0);
    }
    if (preset === "polar") {
      object.position.set(0.02, 4.15, 0.02);
      target.set(0, 0, 0);
    }
    if (preset === "follow" && selected) {
      const position = toScenePosition(stateAtTime(selected, time).position);
      object.position.set(position[0] + 0.55, position[1] + 0.3, position[2] + 0.55);
      target.set(position[0], position[1], position[2]);
    }
    if (preset === "ground-track") {
      object.position.set(0, 1.7, 3.25);
      target.set(0, 0, 0);
    }
    controls.current.update();
  }, [preset, selected, time]);

  return <OrbitControls ref={controls} enableDamping dampingFactor={0.06} minDistance={1.55} maxDistance={18} />;
}

function toScenePosition(positionKm: [number, number, number]): [number, number, number] {
  return [positionKm[0] * SCENE_SCALE, positionKm[2] * SCENE_SCALE, -positionKm[1] * SCENE_SCALE];
}

function latLonToScene(latitude: number, longitude: number, radius: number): [number, number, number] {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  const x = radius * Math.cos(lat) * Math.cos(lon);
  const z = -radius * Math.cos(lat) * Math.sin(lon);
  const y = radius * Math.sin(lat);
  return [x, y, z];
}
