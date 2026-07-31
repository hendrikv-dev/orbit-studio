import { useMemo } from 'react';
import { propagateSatellite } from '../../physics/propagators/satellite';
import type { SatelliteRecord } from '../../state/types';
import { eciToScene } from '../sceneUtils';

interface SatelliteNodeProps {
  satellite: SatelliteRecord;
  currentTimeMs: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function SatelliteNode({
  satellite,
  currentTimeMs,
  selected,
  onSelect
}: SatelliteNodeProps) {
  const propagated = useMemo(
    () => propagateSatellite(satellite, new Date(currentTimeMs)),
    [currentTimeMs, satellite]
  );

  if (!propagated) return null;

  const position = eciToScene(propagated.position);
  const scale = selected ? 0.034 : 0.025;

  return (
    <group position={position}>
      <mesh onClick={(event) => {
        event.stopPropagation();
        onSelect(satellite.id);
      }}>
        <sphereGeometry args={[scale, 24, 16]} />
        <meshStandardMaterial
          color={satellite.color}
          emissive={satellite.color}
          emissiveIntensity={selected ? 1.25 : 0.62}
        />
      </mesh>
    </group>
  );
}
