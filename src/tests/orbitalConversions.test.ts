import { describe, expect, it } from 'vitest';
import { eciToEcef } from '../physics/coordinates/frames';
import {
  cartesianToKeplerian,
  keplerianToCartesian,
  orbitalPeriodSeconds,
} from '../physics/orbits/conversions';
import type { KeplerianElements } from '../physics/orbits/types';
import { magnitude } from '../physics/orbits/vector';

const angleDifference = (a: number, b: number): number => {
  const delta = Math.abs(((a - b + 540) % 360) - 180);
  return Math.min(delta, 360 - delta);
};

const sampleElements: KeplerianElements = {
  semiMajorAxisKm: 7000,
  eccentricity: 0.004,
  inclinationDeg: 51.6,
  raanDeg: 40,
  argPeriapsisDeg: 25,
  trueAnomalyDeg: 18,
  epoch: '2026-06-01T00:00:00.000Z',
};

describe('orbital conversion utilities', () => {
  it('converts Keplerian elements to a plausible Cartesian state', () => {
    const state = keplerianToCartesian(sampleElements);

    expect(magnitude(state.positionKm)).toBeGreaterThan(6900);
    expect(magnitude(state.positionKm)).toBeLessThan(7050);
    expect(magnitude(state.velocityKmS)).toBeGreaterThan(7.4);
    expect(magnitude(state.velocityKmS)).toBeLessThan(7.7);
  });

  it('converts Cartesian state back to Keplerian elements', () => {
    const state = keplerianToCartesian(sampleElements);
    const elements = cartesianToKeplerian(state);

    expect(elements.semiMajorAxisKm).toBeCloseTo(sampleElements.semiMajorAxisKm, 5);
    expect(elements.eccentricity).toBeCloseTo(sampleElements.eccentricity, 6);
    expect(elements.inclinationDeg).toBeCloseTo(sampleElements.inclinationDeg, 5);
    expect(angleDifference(elements.raanDeg, sampleElements.raanDeg)).toBeLessThan(1e-5);
    expect(angleDifference(elements.argPeriapsisDeg, sampleElements.argPeriapsisDeg)).toBeLessThan(1e-5);
  });

  it('keeps round-trip state conversion within tolerance', () => {
    const initialState = keplerianToCartesian(sampleElements);
    const elements = cartesianToKeplerian(initialState);
    const finalState = keplerianToCartesian(elements);

    expect(magnitude({
      x: finalState.positionKm.x - initialState.positionKm.x,
      y: finalState.positionKm.y - initialState.positionKm.y,
      z: finalState.positionKm.z - initialState.positionKm.z,
    })).toBeLessThan(1e-6);
    expect(magnitude({
      x: finalState.velocityKmS.x - initialState.velocityKmS.x,
      y: finalState.velocityKmS.y - initialState.velocityKmS.y,
      z: finalState.velocityKmS.z - initialState.velocityKmS.z,
    })).toBeLessThan(1e-9);
  });

  it('calculates orbital period for a 7000 km orbit', () => {
    expect(orbitalPeriodSeconds(7000)).toBeCloseTo(5828.5166, 3);
  });

  it('rotates ECI to ECEF without changing vector magnitude', () => {
    const eci = { x: 7000, y: 120, z: -40 };
    const ecef = eciToEcef(eci, new Date('2026-06-01T00:00:00.000Z'));

    expect(magnitude(ecef)).toBeCloseTo(magnitude(eci), 8);
    expect(ecef.z).toBeCloseTo(eci.z, 10);
  });
});
