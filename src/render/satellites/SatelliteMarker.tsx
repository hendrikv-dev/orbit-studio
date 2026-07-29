import { useMemo } from 'react';
import { Color } from 'three';
import type { Satellite } from '../../state/types';
import { eciToSceneVector } from '../scale';
import { propagateSgp4, propagateTwoBody } from '../../physics/propagators';

type SatelliteMarkerProps = {
  satellite: Satellite;
  currentTime: string;
  selected: boolean;
  onSelect: () => void;
};

export function SatelliteMarker({ satellite, currentTime, selected, onSelect }: SatelliteMarkerProps) {
  const position = useMemo(() => {
    const date = new Date(currentTime);
    const result =
      satellite.propagationMode === 'sgp4'
        ? propagateSgp4(satellite.tle, date)
        : propagateTwoBody(satellite.keplerian, date);
    return eciToSceneVector(result?.state.positionKm ?? satellite.cartesian.positionKm);
  }, [satellite, currentTime]);

  if (!satellite.visible) {
    return null;
  }

  return (
    <group position={position} onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}>
      <mesh>
        <sphereGeometry args={[selected ? 0.035 : 0.026, 20, 12]} />
        <meshStandardMaterial
          color={new Color(satellite.color)}
          emissive={new Color(satellite.color)}
          emissiveIntensity={selected ? 1.2 : 0.6}
          roughness={0.3}
        />
      </mesh>
      <mesh>
        <ringGeometry args={[selected ? 0.052 : 0.042, selected ? 0.058 : 0.047, 32]} />
        <meshBasicMaterial color={new Color(satellite.color)} transparent opacity={selected ? 0.82 : 0.42} />
      </mesh>
    </group>
  );
}
