import { EARTH_RADIUS } from '../physics/constants/earth';
import { keplerianToCartesian } from '../physics/orbits/conversions';
import type { KeplerianElements } from '../physics/orbits/types';
import { degToRad } from '../utils/math';
import type { SatelliteRecord } from './types';

export function createSampleSatellite(epoch = new Date().toISOString()): SatelliteRecord {
  const keplerian: KeplerianElements = {
    semiMajorAxis: EARTH_RADIUS + 550_000,
    eccentricity: 0.0012,
    inclination: degToRad(51.64),
    raan: degToRad(32),
    argumentOfPeriapsis: degToRad(78),
    trueAnomaly: degToRad(12),
    epoch
  };

  return {
    id: crypto.randomUUID(),
    name: 'Apsis Demo LEO',
    color: '#59d4ff',
    inputMode: 'keplerian',
    propagationMode: 'two-body',
    keplerian,
    cartesian: keplerianToCartesian(keplerian),
    tle: {
      name: 'No TLE — project-authored two-body sample',
      line1: '',
      line2: ''
    },
    visualization: {
      visible: true,
      trail: true,
      groundTrack: true
    },
    validation: {}
  };
}

export function createSatelliteFromTemplate(
  name: string,
  color: string,
  epoch = new Date().toISOString(),
  offsetRadians = 0
): SatelliteRecord {
  const base = createSampleSatellite(epoch);
  const keplerian = {
    ...base.keplerian,
    raan: (base.keplerian.raan + offsetRadians) % (Math.PI * 2),
    trueAnomaly: (base.keplerian.trueAnomaly + offsetRadians * 0.7) % (Math.PI * 2)
  };
  return {
    ...base,
    id: crypto.randomUUID(),
    name,
    color,
    keplerian,
    cartesian: keplerianToCartesian(keplerian),
    tle: { name, line1: '', line2: '' }
  };
}
