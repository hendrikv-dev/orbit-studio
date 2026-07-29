import { eciToGeodetic } from '../coordinates/frames';
import type { CartesianState, PropagationResult } from '../orbits/types';
import { propagate, twoline2satrec } from 'satellite.js';

export type TleData = {
  name: string;
  line1: string;
  line2: string;
};

export const propagateTle = (tle: TleData, date: Date): PropagationResult | null => {
  try {
    const satrec = twoline2satrec(tle.line1.trim(), tle.line2.trim());
    const propagated = propagate(satrec, date);

    if (
      !propagated ||
      typeof propagated.position === 'boolean' ||
      typeof propagated.velocity === 'boolean'
    ) {
      return null;
    }

    const state: CartesianState = {
      positionKm: {
        x: propagated.position.x,
        y: propagated.position.y,
        z: propagated.position.z,
      },
      velocityKmS: {
        x: propagated.velocity.x,
        y: propagated.velocity.y,
        z: propagated.velocity.z,
      },
      epoch: date.toISOString(),
    };

    return {
      state,
      geodetic: eciToGeodetic(state.positionKm, date),
    };
  } catch {
    return null;
  }
};
