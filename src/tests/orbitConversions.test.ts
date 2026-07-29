import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS } from '../physics/constants/earth';
import { eciToEcef } from '../physics/coordinates/frames';
import { calculateOrbitalPeriod, cartesianToKeplerian, keplerianToCartesian } from '../physics/orbits/conversions';
import { magnitude } from '../physics/orbits/vector';
import { angleDelta, degToRad } from '../utils/math';

const sample = {
  semiMajorAxis: EARTH_RADIUS + 650_000,
  eccentricity: 0.012,
  inclination: degToRad(63.4),
  raan: degToRad(41),
  argumentOfPeriapsis: degToRad(118),
  trueAnomaly: degToRad(22),
  epoch: '2026-06-01T12:00:00.000Z'
};

describe('orbital conversions', () => {
  it('converts Keplerian elements to a plausible Cartesian state', () => {
    const state = keplerianToCartesian(sample);
    expect(magnitude(state.position)).toBeGreaterThan(EARTH_RADIUS);
    expect(magnitude(state.velocity)).toBeGreaterThan(7000);
    expect(magnitude(state.velocity)).toBeLessThan(9000);
  });

  it('converts Cartesian state back to Keplerian elements', () => {
    const state = keplerianToCartesian(sample);
    const elements = cartesianToKeplerian(state);
    expect(elements.semiMajorAxis).toBeCloseTo(sample.semiMajorAxis, -1);
    expect(elements.eccentricity).toBeCloseTo(sample.eccentricity, 8);
    expect(angleDelta(elements.inclination, sample.inclination)).toBeCloseTo(0, 8);
  });

  it('round-trips angular elements within tolerance', () => {
    const elements = cartesianToKeplerian(keplerianToCartesian(sample));
    expect(angleDelta(elements.raan, sample.raan)).toBeCloseTo(0, 8);
    expect(angleDelta(elements.argumentOfPeriapsis, sample.argumentOfPeriapsis)).toBeCloseTo(0, 8);
    expect(angleDelta(elements.trueAnomaly, sample.trueAnomaly)).toBeCloseTo(0, 8);
  });

  it('calculates orbital period', () => {
    const period = calculateOrbitalPeriod(EARTH_RADIUS + 550_000);
    expect(period / 60).toBeGreaterThan(90);
    expect(period / 60).toBeLessThan(100);
  });

  it('rotates ECI to ECEF while preserving vector length and z axis', () => {
    const eci: [number, number, number] = [7_000_000, 1_200_000, 600_000];
    const ecef = eciToEcef(eci, new Date('2026-06-01T12:00:00.000Z'));
    expect(magnitude(ecef)).toBeCloseTo(magnitude(eci), 5);
    expect(ecef[2]).toBeCloseTo(eci[2], 8);
  });
});
