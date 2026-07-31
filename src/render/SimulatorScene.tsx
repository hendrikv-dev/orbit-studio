import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { DirectionalLight, Vector3 } from 'three';
import { DEFAULT_SUN_DIRECTION } from '../physics/constants/earth';
import { propagateSatellite } from '../physics/propagators/satellite';
import { useApsisStore } from '../state/store';
import type { CameraPreset } from '../state/types';
import { Earth } from './earth/Earth';
import { Starfield } from './earth/Starfield';
import { GroundTrack } from './orbits/GroundTrack';
import { OrbitPath } from './orbits/OrbitPath';
import { eciToScene } from './sceneUtils';
import { SatelliteNode } from './satellites/SatelliteNode';

export function SimulatorScene() {
  const renderSettings = useApsisStore((state) => state.renderSettings);
  const dpr: [number, number] =
    renderSettings.quality === 'high' ? [1, 2] : renderSettings.quality === 'medium' ? [1, 1.5] : [1, 1];

  return (
    <Canvas
      className="scene-canvas"
      shadows
      dpr={dpr}
      camera={{ position: [3.6, 2.1, 3.9], fov: 43, near: 0.02, far: 120 }}
      gl={{
        antialias: renderSettings.quality !== 'low',
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true
      }}
    >
      <color attach="background" args={['#02050a']} />
      <Suspense fallback={null}>
        <SceneContents />
      </Suspense>
    </Canvas>
  );
}

function SceneContents() {
  const currentTimeMs = useApsisStore((state) => state.currentTimeMs);
  const satellites = useApsisStore((state) => state.satellites);
  const renderSettings = useApsisStore((state) => state.renderSettings);
  const selectedSatelliteId = useApsisStore((state) => state.selectedSatelliteId);
  const selectSatellite = useApsisStore((state) => state.selectSatellite);
  const sunPosition = useMemo(
    () => new Vector3(...DEFAULT_SUN_DIRECTION).normalize().multiplyScalar(8),
    []
  );
  const lightRef = useRef<DirectionalLight>(null);

  useFrame(() => {
    if (lightRef.current) lightRef.current.position.copy(sunPosition);
  });

  return (
    <>
      <ambientLight intensity={0.045} />
      <directionalLight ref={lightRef} position={sunPosition} intensity={3.2} castShadow />
      <Starfield />

      {satellites.map((satellite) =>
        satellite.visualization.visible && satellite.visualization.trail ? (
          <OrbitPath
            key={`${satellite.id}-orbit`}
            satellite={satellite}
            currentTimeMs={currentTimeMs}
            quality={renderSettings.quality}
          />
        ) : null
      )}

      <Earth currentTimeMs={currentTimeMs} renderSettings={renderSettings}>
        {satellites.map((satellite) =>
          satellite.visualization.visible && satellite.visualization.groundTrack ? (
            <GroundTrack
              key={`${satellite.id}-ground`}
              satellite={satellite}
              currentTimeMs={currentTimeMs}
              quality={renderSettings.quality}
            />
          ) : null
        )}
      </Earth>

      {satellites.map((satellite) =>
        satellite.visualization.visible ? (
          <SatelliteNode
            key={satellite.id}
            satellite={satellite}
            currentTimeMs={currentTimeMs}
            selected={satellite.id === selectedSatelliteId}
            onSelect={selectSatellite}
          />
        ) : null
      )}

      <CameraRig />
    </>
  );
}

function CameraRig() {
  const controlsRef = useRef<any>(null);
  const cameraPreset = useApsisStore((state) => state.cameraPreset);
  const currentTimeMs = useApsisStore((state) => state.currentTimeMs);
  const selectedSatelliteId = useApsisStore((state) => state.selectedSatelliteId);
  const satellites = useApsisStore((state) => state.satellites);
  const { camera } = useThree();
  const selectedSatellite = satellites.find((satellite) => satellite.id === selectedSatelliteId);

  useEffect(() => {
    const target = new Vector3(0, 0, 0);
    const position = presetPosition(cameraPreset);
    camera.position.set(position[0], position[1], position[2]);
    controlsRef.current?.target.copy(target);
    controlsRef.current?.update();
  }, [camera, cameraPreset]);

  useFrame(() => {
    if (cameraPreset !== 'follow' || !selectedSatellite) return;
    const propagated = propagateSatellite(selectedSatellite, new Date(currentTimeMs));
    if (!propagated) return;
    const position = new Vector3(...eciToScene(propagated.position));
    const offset = new Vector3(0.45, 0.22, 0.55);
    controlsRef.current?.target.lerp(position, 0.08);
    camera.position.lerp(position.clone().add(offset), 0.04);
    controlsRef.current?.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      minDistance={1.45}
      maxDistance={18}
      makeDefault
    />
  );
}

function presetPosition(preset: CameraPreset): [number, number, number] {
  switch (preset) {
    case 'equatorial':
      return [4.3, 0.35, 0.05];
    case 'polar':
      return [0.1, 5.3, 0.05];
    case 'ground-track':
      return [2.6, 1.25, 3.2];
    case 'follow':
      return [2.0, 1.3, 2.1];
    case 'free':
    default:
      return [3.6, 2.1, 3.9];
  }
}
