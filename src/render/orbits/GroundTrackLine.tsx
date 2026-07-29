import { useMemo } from 'react';
import { BufferGeometry, Color, Line as ThreeLine, LineBasicMaterial } from 'three';
import { sampleGroundTrack } from '../../physics/orbits/groundTrack';
import type { Satellite } from '../../state/types';
import { latLonToSceneVector } from '../scale';

type GroundTrackLineProps = {
  satellite: Satellite;
  currentTime: string;
};

export function GroundTrackLine({ satellite, currentTime }: GroundTrackLineProps) {
  const line = useMemo(() => {
    const points = sampleGroundTrack(satellite.keplerian, new Date(currentTime), 180).map((point) =>
      latLonToSceneVector(point.latitudeDeg, point.longitudeDeg, 1.018),
    );
    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new LineBasicMaterial({
      color: new Color(satellite.color),
      transparent: true,
      opacity: 0.42,
    });

    return new ThreeLine(geometry, material);
  }, [satellite.color, satellite.keplerian, currentTime]);

  if (!satellite.visible || !satellite.showGroundTrack) {
    return null;
  }

  return <primitive object={line} />;
}
