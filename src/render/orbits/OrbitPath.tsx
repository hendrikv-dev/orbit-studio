import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import type { SatelliteRecord, QualityLevel } from '../../state/types';
import { sampleOrbitPath } from './orbitSampling';

interface OrbitPathProps {
  satellite: SatelliteRecord;
  currentTimeMs: number;
  quality: QualityLevel;
}

export function OrbitPath({ satellite, currentTimeMs, quality }: OrbitPathProps) {
  const samples = quality === 'high' ? 320 : quality === 'medium' ? 220 : 128;
  const points = useMemo(
    () => sampleOrbitPath(satellite, currentTimeMs, samples),
    [currentTimeMs, samples, satellite]
  );

  if (points.length < 2) return null;

  return (
    <Line
      points={points}
      color={satellite.color}
      lineWidth={1.4}
      transparent
      opacity={0.74}
    />
  );
}
