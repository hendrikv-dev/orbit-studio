import { cartesianToKeplerian } from '../orbits/conversions';
import type { CartesianState, KeplerianElements, PropagationResult } from '../orbits/types';
import { propagateTle, type TleInput } from './tle';
import { propagateKeplerian, propagationResultFromState } from './twoBody';

export type PropagationMode = 'two-body' | 'sgp4' | 'advanced';
export type SatelliteInputMode = 'keplerian' | 'cartesian' | 'tle';

export interface PropagatableSatellite {
  inputMode: SatelliteInputMode;
  propagationMode: PropagationMode;
  keplerian: KeplerianElements;
  cartesian: CartesianState;
  tle: TleInput;
}

export function propagateSatellite(
  satellite: PropagatableSatellite,
  at: Date
): PropagationResult | null {
  if (satellite.propagationMode === 'sgp4' || satellite.inputMode === 'tle') {
    const tleState = propagateTle(satellite.tle, at);
    if (tleState) {
      return propagationResultFromState(tleState, at, null, 'sgp4');
    }
  }

  if (satellite.propagationMode === 'advanced') {
    return null;
  }

  try {
    return propagateKeplerian(satellite.keplerian, at);
  } catch {
    return null;
  }
}

export function stateFromTleOrFallback(
  tle: TleInput,
  at: Date,
  fallback: CartesianState
): { cartesian: CartesianState; keplerian: KeplerianElements; valid: boolean } {
  const state = propagateTle(tle, at);
  if (!state) {
    return {
      cartesian: fallback,
      keplerian: cartesianToKeplerian(fallback),
      valid: false
    };
  }

  return {
    cartesian: state,
    keplerian: cartesianToKeplerian(state),
    valid: true
  };
}
