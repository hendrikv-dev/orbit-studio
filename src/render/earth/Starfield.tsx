import { useMemo } from 'react';
import { BufferAttribute, BufferGeometry, PointsMaterial } from 'three';
import { starCatalogPointsForQuality } from '../../rendering/StarField';

export function Starfield() {
  const [geometry, material] = useMemo(() => {
    const stars = starCatalogPointsForQuality('high').filter((star) => star.magnitude <= 5);
    const count = stars.length;
    const radius = 70;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    stars.forEach(({ direction, magnitude }, index) => {
      const intensity = Math.max(0.25, Math.min(1, Math.pow(2.512, -magnitude) * 18));

      positions[index * 3] = radius * direction.x;
      positions[index * 3 + 1] = radius * direction.y;
      positions[index * 3 + 2] = radius * direction.z;
      colors[index * 3] = intensity;
      colors[index * 3 + 1] = intensity * 0.96;
      colors[index * 3 + 2] = intensity * 0.88;
    });

    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new BufferAttribute(positions, 3));
    starGeometry.setAttribute('color', new BufferAttribute(colors, 3));
    const starMaterial = new PointsMaterial({
      size: 0.028,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.78,
      depthTest: true,
      depthWrite: false,
      vertexColors: true,
    });

    return [starGeometry, starMaterial];
  }, []);

  return <points geometry={geometry} material={material} />;
}
