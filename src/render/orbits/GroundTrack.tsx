import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import type { SatelliteRecord, QualityLevel } from '../../state/types';
import { sampleGroundTrack } from './orbitSampling';

interface GroundTrackProps {
  satellite: SatelliteRecord;
  currentTimeMs: number;
  quality: QualityLevel;
}

export function GroundTrack({ satellite, currentTimeMs, quality }: GroundTrackProps) {
  const samples = quality === 'high' ? 300 : quality === 'medium' ? 180 : 96;
  const points = useMemo(
    () => sampleGroundTrack(satellite, currentTimeMs, samples),
    [currentTimeMs, samples, satellite]
  );

  if (points.length < 2) return null;

  return (
    <Line
      points={points}
      color={satellite.color}
      lineWidth={0.9}
      dashed
      dashSize={0.018}
      gapSize={0.012}
      transparent
      opacity={0.64}
    />
  );
}
