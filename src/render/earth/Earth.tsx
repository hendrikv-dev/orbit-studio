import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { AdditiveBlending, BackSide, Color } from 'three';
import { gmstRadians } from '../../physics/coordinates/time';
import { EARTH_SCENE_RADIUS } from '../scale';
import type { QualityLevel } from '../../state/types';
import { createCloudTexture, createEarthTexture, createNightLightsTexture } from './textures';

type EarthProps = {
  currentTime: string;
  quality: QualityLevel;
  cloudsEnabled: boolean;
  nightLightsEnabled: boolean;
  children?: ReactNode;
};

const segmentsByQuality: Record<QualityLevel, number> = {
  low: 48,
  medium: 96,
  high: 160,
};

export function Earth({ currentTime, quality, cloudsEnabled, nightLightsEnabled, children }: EarthProps) {
  const earthTexture = useMemo(() => createEarthTexture(quality), [quality]);
  const cloudTexture = useMemo(() => createCloudTexture(quality), [quality]);
  const nightLightsTexture = useMemo(() => createNightLightsTexture(quality), [quality]);
  const rotation = gmstRadians(new Date(currentTime));
  const segments = segmentsByQuality[quality];

  return (
    <group rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[EARTH_SCENE_RADIUS, segments, segments / 2]} />
        <meshStandardMaterial
          map={earthTexture}
          roughness={0.86}
          metalness={0.02}
          color={new Color('#f9fbff')}
        />
      </mesh>
      {nightLightsEnabled ? (
        <mesh>
          <sphereGeometry args={[EARTH_SCENE_RADIUS + 0.002, segments, segments / 2]} />
          <meshBasicMaterial
            map={nightLightsTexture}
            transparent
            opacity={0.36}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {cloudsEnabled ? (
        <mesh>
          <sphereGeometry args={[EARTH_SCENE_RADIUS + 0.012, segments, segments / 2]} />
          <meshStandardMaterial
            map={cloudTexture}
            transparent
            opacity={0.28}
            roughness={0.92}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      <mesh>
        <sphereGeometry args={[EARTH_SCENE_RADIUS + 0.045, segments, segments / 2]} />
        <meshBasicMaterial
          color="#6ad7ff"
          transparent
          opacity={0.1}
          side={BackSide}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {children}
    </group>
  );
}
