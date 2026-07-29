import { EARTH_RADIUS_KM } from '../constants/earth';
import type { CartesianState } from './types';
import { magnitude } from './vector';

export const altitudeKm = (state: CartesianState): number => magnitude(state.positionKm) - EARTH_RADIUS_KM;

export const speedKmS = (state: CartesianState): number => magnitude(state.velocityKmS);
