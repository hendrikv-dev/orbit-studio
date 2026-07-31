import { useMemo } from 'react';
import { BufferGeometry, CatmullRomCurve3, Color, Line as ThreeLine, LineBasicMaterial } from 'three';
import { orbitalPeriodSeconds } from '../../physics/orbits/conversions';
import type { Satellite } from '../../state/types';
import { eciToSceneVector } from '../scale';
import { propagateKeplerianTwoBody } from '../../physics/propagators/twoBody';
import { propagateSgp4 } from '../../physics/propagators';

type OrbitLineProps = {
  satellite: Satellite;
  currentTime: string;
};

export function OrbitLine({ satellite, currentTime }: OrbitLineProps) {
  const line = useMemo(() => {
    const start = new Date(currentTime);
    const duration =
      satellite.propagationMode === 'two-body'
        ? orbitalPeriodSeconds(satellite.keplerian.semiMajorAxisKm)
        : 92 * 60;
    const samples = 220;
    const points = Array.from({ length: samples }, (_, index) => {
      const alpha = index / (samples - 1);
      const date = new Date(start.getTime() + alpha * duration * 1000);
      const state =
        satellite.propagationMode === 'sgp4'
          ? propagateSgp4(satellite.tle, date)?.state
          : propagateKeplerianTwoBody(satellite.keplerian, date);
      return eciToSceneVector(state?.positionKm ?? satellite.cartesian.positionKm);
    });
    const curve = new CatmullRomCurve3(points, true, 'centripetal', 0.2);
    const geometry = new BufferGeometry().setFromPoints(curve.getPoints(samples));
    const material = new LineBasicMaterial({
      color: new Color(satellite.color),
      transparent: true,
      opacity: 0.78,
    });

    return new ThreeLine(geometry, material);
  }, [satellite, currentTime]);

  if (!satellite.visible || !satellite.showOrbitTrail) {
    return null;
  }

  return <primitive object={line} />;
}
