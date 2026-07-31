import { Activity, Gauge, MapPinned, Orbit, Timer } from 'lucide-react';
import { cartesianToKeplerian, orbitalPeriodSeconds } from '../../physics/orbits/conversions';
import { altitudeKm, speedKmS } from '../../physics/orbits/derived';
import { propagateSgp4, propagateTwoBody } from '../../physics/propagators';
import type { Satellite } from '../../state/types';
import { formatDuration, formatNumber } from '../../utils/format';

type ReadoutsProps = {
  satellite: Satellite;
  currentTime: string;
};

export function Readouts({ satellite, currentTime }: ReadoutsProps) {
  const date = new Date(currentTime);
  const propagation =
    satellite.propagationMode === 'sgp4'
      ? propagateSgp4(satellite.tle, date)
      : propagateTwoBody(satellite.keplerian, date);
  const state = propagation?.state ?? satellite.cartesian;
  const elements = Number.isFinite(state.positionKm.x) ? cartesianToKeplerian(state) : satellite.keplerian;

  const items = [
    { icon: Gauge, label: 'Altitude', value: `${formatNumber(altitudeKm(state), 1)} km` },
    { icon: Activity, label: 'Velocity', value: `${formatNumber(speedKmS(state), 3)} km/s` },
    { icon: Timer, label: 'Period', value: formatDuration(orbitalPeriodSeconds(elements.semiMajorAxisKm)) },
    { icon: Orbit, label: 'Inclination', value: `${formatNumber(elements.inclinationDeg, 2)} deg` },
    { icon: Orbit, label: 'Eccentricity', value: formatNumber(elements.eccentricity, 5) },
    {
      icon: MapPinned,
      label: 'Latitude',
      value: `${formatNumber(propagation?.geodetic.latitudeDeg ?? 0, 2)} deg`,
    },
    {
      icon: MapPinned,
      label: 'Longitude',
      value: `${formatNumber(propagation?.geodetic.longitudeDeg ?? 0, 2)} deg`,
    },
    {
      icon: Orbit,
      label: 'Propagation',
      value: satellite.propagationMode === 'sgp4' ? 'SGP4 / TLE' : 'Two-body',
    },
  ];

  return (
    <div className="readout-grid">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className="readout" key={item.label}>
            <Icon size={15} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        );
      })}
    </div>
  );
}
