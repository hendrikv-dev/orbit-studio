import { eciToGeodetic } from '../coordinates/frames';
import { orbitalPeriodSeconds } from './conversions';
import type { GeodeticPosition, KeplerianElements } from './types';
import { propagateKeplerianTwoBody } from '../propagators/twoBody';

export type GroundTrackPoint = Pick<GeodeticPosition, 'latitudeDeg' | 'longitudeDeg'>;

export const sampleGroundTrack = (
  elements: KeplerianElements,
  startTime: Date,
  samples = 160,
  durationSeconds = orbitalPeriodSeconds(elements.semiMajorAxisKm),
): GroundTrackPoint[] => {
  const points: GroundTrackPoint[] = [];

  for (let index = 0; index < samples; index += 1) {
    const alpha = samples <= 1 ? 0 : index / (samples - 1);
    const date = new Date(startTime.getTime() + alpha * durationSeconds * 1000);
    const state = propagateKeplerianTwoBody(elements, date);
    const geodetic = eciToGeodetic(state.positionKm, date);
    points.push({
      latitudeDeg: geodetic.latitudeDeg,
      longitudeDeg: geodetic.longitudeDeg,
    });
  }

  return points;
};
