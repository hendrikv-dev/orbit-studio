import { useEffect, useMemo, useState } from "react";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  BIELLIPTIC_ALWAYS_WORSE_RATIO,
  biellipticTransfer,
  exhaustVelocityKmS,
  planMission,
  propellantMassFraction,
} from "../physics/maneuvers";

/**
 * Plan a transfer from the satellite's current orbit to a target, then fly it.
 *
 * Playground's job is "what if", so this is not a calculator bolted to a
 * readout — the plan can be applied, and the orbit in the scene becomes the one
 * that was planned. The numbers worth noticing are the ones that contradict
 * intuition: where the plane change belongs, and how much of the vehicle the
 * budget eats.
 *
 * All impulsive two-body. No burn duration, no drag, no J2.
 */

function formatDuration(seconds: number): string {
  if (seconds < 5400) return `${(seconds / 60).toFixed(0)} min`;
  if (seconds < 86400 * 2) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

const ISP_SECONDS = 320;

/**
 * Altitude spans three orders of magnitude here — 200 km to lunar distance —
 * so the slider is logarithmic. A linear one either loses all resolution in LEO
 * or cannot reach the ratios where the three-burn transfer starts to win, which
 * is the whole reason for offering the range.
 */
const MIN_ALTITUDE_KM = 200;
const MAX_ALTITUDE_KM = 400000;
const toSlider = (altitudeKm: number) => Math.log10(altitudeKm);
const fromSlider = (value: number) => {
  const raw = 10 ** value;
  // Coarser steps the further out you go, so the readout is not spuriously precise.
  const step = raw < 1000 ? 5 : raw < 10000 ? 50 : raw < 100000 ? 500 : 5000;
  return Math.round(raw / step) * step;
};

export function MissionPlannerSection({
  currentAltitudeKm,
  currentInclinationDeg,
  onApply,
}: {
  currentAltitudeKm: number;
  currentInclinationDeg: number;
  onApply: (altitudeKm: number, inclinationDeg: number) => void;
}) {
  const [targetAltitudeKm, setTargetAltitudeKm] = useState(35786);
  const [targetInclinationDeg, setTargetInclinationDeg] = useState(0);
  // The planner describes a move from where the satellite is now. If the orbit
  // is changed by the sliders above, a stale plan would quietly describe a
  // departure that no longer exists.
  const [pinnedFrom, setPinnedFrom] = useState({
    altitudeKm: currentAltitudeKm,
    inclinationDeg: currentInclinationDeg,
  });
  useEffect(() => {
    setPinnedFrom({ altitudeKm: currentAltitudeKm, inclinationDeg: currentInclinationDeg });
  }, [currentAltitudeKm, currentInclinationDeg]);

  const fromRadius = EARTH_RADIUS_KM + pinnedFrom.altitudeKm;
  const toRadius = EARTH_RADIUS_KM + targetAltitudeKm;
  const planeChange = Math.abs(targetInclinationDeg - pinnedFrom.inclinationDeg);

  const plan = useMemo(
    () => planMission(fromRadius, toRadius, planeChange),
    [fromRadius, toRadius, planeChange],
  );

  // Above the classical ratio a three-burn transfer can undercut the two-burn
  // one, which is the result students least expect.
  const ratio = Math.max(fromRadius, toRadius) / Math.min(fromRadius, toRadius);
  const bielliptic = useMemo(() => {
    if (ratio <= BIELLIPTIC_ALWAYS_WORSE_RATIO) return null;
    const waypoint = Math.max(fromRadius, toRadius) * 4;
    const candidate = biellipticTransfer(fromRadius, toRadius, waypoint);
    return candidate.totalDeltaVKmS < plan.transfer.totalDeltaVKmS ? candidate : null;
  }, [fromRadius, plan.transfer.totalDeltaVKmS, ratio, toRadius]);

  const propellant = propellantMassFraction(plan.totalDeltaVKmS, exhaustVelocityKmS(ISP_SECONDS));
  const saving = plan.naiveDeltaVKmS - plan.totalDeltaVKmS;
  const unchanged =
    Math.abs(targetAltitudeKm - pinnedFrom.altitudeKm) < 1 && planeChange < 0.05;

  return (
    <div className="mission-planner">
      <label className="mission-slider">
        <span className="mission-slider-label">
          <span>Target altitude</span>
          <output>{targetAltitudeKm.toLocaleString()} km</output>
        </span>
        <input aria-label="Target altitude" type="range"
               min={toSlider(MIN_ALTITUDE_KM)} max={toSlider(MAX_ALTITUDE_KM)} step={0.001}
               value={toSlider(targetAltitudeKm)}
               onChange={(event) =>
                 setTargetAltitudeKm(fromSlider(Number.parseFloat(event.target.value)))} />
      </label>

      <label className="mission-slider">
        <span className="mission-slider-label">
          <span>Target inclination</span>
          <output>{targetInclinationDeg.toFixed(1)}°</output>
        </span>
        <input aria-label="Target inclination" type="range" min={0} max={180} step={0.5}
               value={targetInclinationDeg}
               onChange={(event) => setTargetInclinationDeg(Number.parseFloat(event.target.value))} />
      </label>

      <div className="mission-presets">
        {[
          { label: "GEO", altitude: 35786, inclination: 0 },
          { label: "Sun-sync 700", altitude: 700, inclination: 98.2 },
          { label: "ISS", altitude: 420, inclination: 51.6 },
          { label: "Lunar distance", altitude: 384400, inclination: 28.5 },
        ].map((preset) => (
          <button key={preset.label} type="button"
                  onClick={() => {
                    setTargetAltitudeKm(preset.altitude);
                    setTargetInclinationDeg(preset.inclination);
                  }}>
            {preset.label}
          </button>
        ))}
      </div>

      {unchanged ? (
        <p className="mission-idle">Target matches the current orbit — no manoeuvre needed.</p>
      ) : (
        <>
          <dl className="mission-budget">
            <div className="mission-budget-total">
              <dt>Total Δv</dt>
              <dd>{plan.totalDeltaVKmS.toFixed(3)} km/s</dd>
            </div>
            {plan.transfer.burns.map((burn) => (
              <div key={burn.id}>
                <dt>{burn.label}</dt>
                <dd>{burn.deltaVKmS.toFixed(3)} km/s</dd>
              </div>
            ))}
            <div>
              <dt>Transfer time</dt>
              <dd>{formatDuration(plan.transfer.transferTimeSeconds)}</dd>
            </div>
            <div>
              <dt>Propellant ({ISP_SECONDS} s Isp)</dt>
              <dd>{(propellant * 100).toFixed(0)}% of vehicle</dd>
            </div>
          </dl>

          {planeChange > 0.05 && (
            <p className="mission-insight">
              <strong>
                {(plan.planeChangeAtArrivalFraction * 100).toFixed(0)}% of the{" "}
                {planeChange.toFixed(1)}° turn belongs at the far burn.
              </strong>
              <span>
                Doing the whole plane change before departing would cost{" "}
                {plan.naiveDeltaVKmS.toFixed(2)} km/s — {saving.toFixed(2)} km/s more. A
                turn is cheapest where the spacecraft is slowest.
              </span>
            </p>
          )}

          {bielliptic && (
            <p className="mission-insight">
              <strong>A three-burn bi-elliptic transfer is cheaper here.</strong>
              <span>
                {bielliptic.totalDeltaVKmS.toFixed(3)} km/s against{" "}
                {plan.transfer.totalDeltaVKmS.toFixed(3)}, because the radius ratio is{" "}
                {ratio.toFixed(1)} — past about {BIELLIPTIC_ALWAYS_WORSE_RATIO.toFixed(1)} the
                Hohmann transfer stops being optimal. It takes{" "}
                {formatDuration(bielliptic.transferTimeSeconds)} instead of{" "}
                {formatDuration(plan.transfer.transferTimeSeconds)}.
              </span>
            </p>
          )}

          <button className="mission-apply" type="button"
                  onClick={() => onApply(targetAltitudeKm, targetInclinationDeg)}>
            Fly this transfer
          </button>
        </>
      )}

      <p className="mission-caveat">
        Impulsive two-body budget: instantaneous burns, no drag, no oblateness, no
        finite-thrust losses. It is the first number a mission is sized with, not the
        last.
      </p>
    </div>
  );
}
