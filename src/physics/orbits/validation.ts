import { EARTH_RADIUS_KM } from '../constants/earth';
import type { CartesianState, KeplerianElements } from './types';
import { magnitude } from './vector';

export type ValidationResult = {
  valid: boolean;
  errors: Partial<Record<keyof KeplerianElements | keyof CartesianState | string, string>>;
};

export const validateKeplerian = (elements: KeplerianElements): ValidationResult => {
  const errors: ValidationResult['errors'] = {};

  if (!Number.isFinite(elements.semiMajorAxisKm) || elements.semiMajorAxisKm <= EARTH_RADIUS_KM) {
    errors.semiMajorAxisKm = 'Semi-major axis must be above Earth radius.';
  }

  if (!Number.isFinite(elements.eccentricity) || elements.eccentricity < 0 || elements.eccentricity >= 1) {
    errors.eccentricity = 'Eccentricity must be in [0, 1).';
  }

  if (!Number.isFinite(elements.inclinationDeg) || elements.inclinationDeg < 0 || elements.inclinationDeg > 180) {
    errors.inclinationDeg = 'Inclination must be between 0 and 180 degrees.';
  }

  if (!Number.isFinite(Date.parse(elements.epoch))) {
    errors.epoch = 'Epoch must be a valid date.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
};

export const validateCartesian = (state: CartesianState): ValidationResult => {
  const errors: ValidationResult['errors'] = {};

  if (!Number.isFinite(state.positionKm.x) || !Number.isFinite(state.positionKm.y) || !Number.isFinite(state.positionKm.z)) {
    errors.positionKm = 'Position vector must contain finite values.';
  }

  if (!Number.isFinite(state.velocityKmS.x) || !Number.isFinite(state.velocityKmS.y) || !Number.isFinite(state.velocityKmS.z)) {
    errors.velocityKmS = 'Velocity vector must contain finite values.';
  }

  if (magnitude(state.positionKm) <= EARTH_RADIUS_KM) {
    errors.altitude = 'Position altitude must be above Earth surface.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
};
