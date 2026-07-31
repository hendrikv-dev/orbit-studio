import { SECONDS_PER_DAY } from '../constants/earth';
import { normalizeRadians } from '../orbits/angles';

export const julianDate = (date: Date): number => date.getTime() / 86400000 + 2440587.5;

export const gmstRadians = (date: Date): number => {
  const jd = julianDate(date);
  const centuriesSinceJ2000 = (jd - 2451545.0) / 36525.0;
  const gmstSeconds =
    67310.54841 +
    (876600 * 3600 + 8640184.812866) * centuriesSinceJ2000 +
    0.093104 * centuriesSinceJ2000 ** 2 -
    6.2e-6 * centuriesSinceJ2000 ** 3;

  return normalizeRadians((gmstSeconds / SECONDS_PER_DAY) * Math.PI * 2);
};
