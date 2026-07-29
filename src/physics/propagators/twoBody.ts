import { EARTH_MU_KM3_S2 } from '../constants/earth';
import type { CartesianState, KeplerianElements } from '../orbits/types';
import {
  eccentricAnomalyToTrueAnomaly,
  keplerianToCartesian,
  solveKeplerEquation,
  trueAnomalyToEccentricAnomaly,
} from '../orbits/conversions';
import { degToRad, normalizeDegrees, normalizeRadians, radToDeg } from '../orbits/angles';

export const propagateKeplerianTwoBody = (
  initialElements: KeplerianElements,
  targetTime: Date,
  muKm3S2 = EARTH_MU_KM3_S2,
): CartesianState => {
  const epochTime = new Date(initialElements.epoch).getTime();
  const elapsedSeconds = (targetTime.getTime() - epochTime) / 1000;
  const semiMajorAxisKm = initialElements.semiMajorAxisKm;
  const eccentricity = initialElements.eccentricity;
  const meanMotionRadS = Math.sqrt(muKm3S2 / semiMajorAxisKm ** 3);
  const initialEccentricAnomaly = trueAnomalyToEccentricAnomaly(
    degToRad(initialElements.trueAnomalyDeg),
    eccentricity,
  );
  const initialMeanAnomaly =
    initialEccentricAnomaly - eccentricity * Math.sin(initialEccentricAnomaly);
  const meanAnomaly = normalizeRadians(initialMeanAnomaly + meanMotionRadS * elapsedSeconds);
  const eccentricAnomaly = solveKeplerEquation(meanAnomaly, eccentricity);
  const trueAnomaly = eccentricAnomalyToTrueAnomaly(eccentricAnomaly, eccentricity);

  return keplerianToCartesian({
    ...initialElements,
    trueAnomalyDeg: normalizeDegrees(radToDeg(trueAnomaly)),
    epoch: targetTime.toISOString(),
  });
};
