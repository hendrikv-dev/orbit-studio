import { eciToGeodetic } from '../coordinates/frames';
import { cartesianToKeplerian } from '../orbits/conversions';
import type { CartesianState, KeplerianElements, PropagationResult } from '../orbits/types';
import { propagateKeplerianTwoBody } from './twoBody';
import { propagateTle, type TleData } from './tle';

export const propagateCartesianTwoBody = (
  initialState: CartesianState,
  targetTime: Date,
): PropagationResult => {
  const elements = cartesianToKeplerian(initialState);
  const state = propagateKeplerianTwoBody(elements, targetTime);
  return {
    state,
    geodetic: eciToGeodetic(state.positionKm, targetTime),
  };
};

export const propagateTwoBody = (
  elements: KeplerianElements,
  targetTime: Date,
): PropagationResult => {
  const state = propagateKeplerianTwoBody(elements, targetTime);
  return {
    state,
    geodetic: eciToGeodetic(state.positionKm, targetTime),
  };
};

export const propagateSgp4 = (tle: TleData, targetTime: Date): PropagationResult | null =>
  propagateTle(tle, targetTime);
