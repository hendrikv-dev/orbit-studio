import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Vector3 } from 'three';
import { useSimulationStore } from '../state/simulationStore';
import { Earth } from './earth/Earth';
import { Starfield } from './earth/Starfield';
import { OrbitLine } from './orbits/OrbitLine';
import { GroundTrackLine } from './orbits/GroundTrackLine';
import { SatelliteMarker } from './satellites/SatelliteMarker';
import { eciToSceneVector } from './scale';
import { propagateSgp4, propagateTwoBody } from '../physics/propagators';

function CameraRig() {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const cameraPreset = useSimulationStore((state) => state.cameraSettings.preset);
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const satellites = useSimulationStore((state) => state.satellites);
  const currentTime = useSimulationStore((state) => state.currentTime);
  const { camera } = useThree();

  useEffect(() => {
    if (cameraPreset === 'free') {
      return;
    }

    const positions = {
      equatorial: new Vector3(0, 0.1, 4.2),
      polar: new Vector3(0, 4.2, 0.05),
      'ground-track': new Vector3(0, 2.8, 2.3),
      follow: new Vector3(1.8, 1.2, 1.8),
    };
    const nextPosition = positions[cameraPreset] ?? positions.equatorial;
    camera.position.copy(nextPosition);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [camera, cameraPreset]);

  useFrame(() => {
    if (cameraPreset !== 'follow' || !controls.current || !selectedSatelliteId) {
      return;
    }

    const selected = satellites.find((satellite) => satellite.id === selectedSatelliteId);
    if (!selected) {
      return;
    }

    const result =
      selected.propagationMode === 'sgp4'
        ? propagateSgp4(selected.tle, new Date(currentTime))
        : propagateTwoBody(selected.keplerian, new Date(currentTime));
    const target = eciToSceneVector(result?.state.positionKm ?? selected.cartesian.positionKm);
    controls.current.target.lerp(target, 0.08);
    controls.current.update();
  });

  return <OrbitControls ref={controls} enablePan enableZoom enableRotate minDistance={1.5} maxDistance={10} />;
}

function SceneContents() {
  const currentTime = useSimulationStore((state) => state.currentTime);
  const renderSettings = useSimulationStore((state) => state.renderSettings);
  const satellites = useSimulationStore((state) => state.satellites);
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const selectSatellite = useSimulationStore((state) => state.selectSatellite);

  const dpr = useMemo<[number, number]>(() => {
    if (renderSettings.quality === 'low') {
      return [1, 1];
    }
    if (renderSettings.quality === 'medium') {
      return [1, 1.5];
    }
    return [1, 2];
  }, [renderSettings.quality]);

  return (
    <Canvas className="scene-canvas" shadows dpr={dpr} gl={{ antialias: renderSettings.quality !== 'low' }}>
      <PerspectiveCamera makeDefault position={[0.3, 1.65, 3.7]} fov={45} near={0.01} far={100} />
      <color attach="background" args={['#020711']} />
      <ambientLight intensity={0.24} />
      <directionalLight position={[4, 2, 3]} intensity={2.6} castShadow />
      <hemisphereLight args={['#7ac8ff', '#020711', 0.38]} />
      <Suspense fallback={null}>
        <Starfield />
        <Earth
          currentTime={currentTime}
          quality={renderSettings.quality}
          cloudsEnabled={renderSettings.cloudsEnabled}
          nightLightsEnabled={renderSettings.nightLightsEnabled}
        >
          {renderSettings.groundTracksEnabled
            ? satellites.map((satellite) => (
                <GroundTrackLine key={`ground-${satellite.id}`} satellite={satellite} currentTime={currentTime} />
              ))
            : null}
        </Earth>
        {satellites.map((satellite) => (
          <OrbitLine key={`orbit-${satellite.id}`} satellite={satellite} currentTime={currentTime} />
        ))}
        {satellites.map((satellite) => (
          <SatelliteMarker
            key={satellite.id}
            satellite={satellite}
            currentTime={currentTime}
            selected={satellite.id === selectedSatelliteId}
            onSelect={() => selectSatellite(satellite.id)}
          />
        ))}
      </Suspense>
      <CameraRig />
    </Canvas>
  );
}

export function SimulationScene() {
  return (
    <div className="scene-shell">
      <SceneContents />
    </div>
  );
}
