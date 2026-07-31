import { calculateOrbitalPeriod } from '../../physics/orbits/conversions';
import { propagateSatellite } from '../../physics/propagators/satellite';
import type { SatelliteRecord } from '../../state/types';
import { eciToScene, geodeticToScene } from '../sceneUtils';

export function sampleOrbitPath(
  satellite: SatelliteRecord,
  currentTimeMs: number,
  samples: number
): [number, number, number][] {
  const period = calculateOrbitalPeriod(satellite.keplerian.semiMajorAxis);
  const spanMs = Number.isFinite(period) ? period * 1000 : 92 * 60 * 1000;
  const startMs = currentTimeMs - spanMs * 0.08;
  const points: [number, number, number][] = [];

  for (let index = 0; index <= samples; index += 1) {
    const at = new Date(startMs + (spanMs * index) / samples);
    const propagated = propagateSatellite(satellite, at);
    if (propagated) points.push(eciToScene(propagated.position));
  }

  return points;
}

export function sampleGroundTrack(
  satellite: SatelliteRecord,
  currentTimeMs: number,
  samples: number
): [number, number, number][] {
  const period = calculateOrbitalPeriod(satellite.keplerian.semiMajorAxis);
  const spanMs = Number.isFinite(period) ? period * 1000 * 1.25 : 100 * 60 * 1000;
  const startMs = currentTimeMs - spanMs * 0.42;
  const points: [number, number, number][] = [];

  for (let index = 0; index <= samples; index += 1) {
    const at = new Date(startMs + (spanMs * index) / samples);
    const propagated = propagateSatellite(satellite, at);
    if (propagated) points.push(geodeticToScene(propagated.geodetic, 1.009));
  }

  return points;
}
