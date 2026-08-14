import { useMemo, useState } from "react";
import {
  CATASTROPHIC_EMR_J_PER_G,
  alongTrackDriftKm,
  assessEncounter,
  avoidanceDeltaVMetersPerSecond,
} from "../physics/encounters";

/**
 * What if something hit this satellite, and what would it take to move out of
 * the way.
 *
 * Explicitly hypothetical, and it belongs in Playground for that reason. Orbit
 * Studio has no current ephemerides and no covariance, so it cannot screen real
 * conjunctions and does not pretend to: nothing here is a probability, and no
 * real pair of objects is being described. What survives that limit is the
 * geometry and the energy, which are the parts worth understanding anyway.
 */

const HOUR = 3600;

/**
 * The breakup model is documented as order-of-magnitude, so its output is shown
 * to one significant figure with a tilde. "543 fragments" implies a count;
 * "~500" implies an estimate, which is what it is.
 */
function formatModelCount(value: number): string {
  if (value <= 0) return "0";
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const rounded = Math.round(value / magnitude) * magnitude;
  return `~${rounded >= 1000 ? `${rounded / 1000}k` : rounded.toLocaleString()}`;
}

/** Energy-to-mass ratio, also a model quantity: two significant figures. */
function formatEmr(value: number): string {
  if (value >= 100) return Math.round(value / 10) * 10 + "";
  if (value >= 10) return Math.round(value) + "";
  return value.toPrecision(2);
}

function formatLead(seconds: number): string {
  if (seconds < HOUR) return `${Math.round(seconds / 60)} min`;
  if (seconds < 48 * HOUR) return `${(seconds / HOUR).toFixed(0)} h`;
  return `${(seconds / (24 * HOUR)).toFixed(0)} days`;
}

const LEAD_TIMES = [600, HOUR, 6 * HOUR, 24 * HOUR, 3 * 24 * HOUR, 7 * 24 * HOUR];

/**
 * Avoidance burns span four orders of magnitude across the warning times
 * offered, and rounding the far end to two decimals of m/s prints "0.00" — a
 * burn that is very small is the finding here, and it must not read as free.
 */
function formatBurn(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond)) return "impossible";
  if (metersPerSecond < 0.1) return `${(metersPerSecond * 1000).toFixed(1)} mm/s`;
  if (metersPerSecond < 100) return `${metersPerSecond.toFixed(2)} m/s`;
  return `${metersPerSecond.toFixed(0)} m/s`;
}
const REQUIRED_MISS_KM = 5;

export function EncounterSection({ altitudeKm }: { altitudeKm: number }) {
  const [crossingAngleDeg, setCrossingAngleDeg] = useState(90);
  const [impactorMassKg, setImpactorMassKg] = useState(1);
  const [targetMassKg, setTargetMassKg] = useState(500);
  const [leadIndex, setLeadIndex] = useState(3);

  const assessment = useMemo(
    () => assessEncounter(altitudeKm, crossingAngleDeg, impactorMassKg, targetMassKg),
    [altitudeKm, crossingAngleDeg, impactorMassKg, targetMassKg],
  );

  const leadSeconds = LEAD_TIMES[leadIndex];
  const burn = avoidanceDeltaVMetersPerSecond(REQUIRED_MISS_KM, leadSeconds);
  const naiveDriftKm = (burn / 1000) * leadSeconds;
  const catastrophic = assessment.severity === "catastrophic";
  // Quoted as the upper bound of the same geometry, so the sentence stays true
  // whatever the slider says.
  const headOnSpeedKmS = assessEncounter(altitudeKm, 180, impactorMassKg, targetMassKg)
    .relativeSpeedKmS;

  return (
    <div className="encounter-section">
      <p className="encounter-preamble">
        A hypothetical impact on this orbit, for geometry and energy only. Without
        current ephemerides and covariance no collision probability can be computed,
        and none is shown here. No real object pair is described.
      </p>

      <label className="mission-slider">
        <span className="mission-slider-label">
          <span>Relative inclination</span>
          <output>{crossingAngleDeg.toFixed(0)}°</output>
        </span>
        <input aria-label="Relative inclination" type="range" min={0} max={180} step={1}
               value={crossingAngleDeg}
               onChange={(event) => setCrossingAngleDeg(Number.parseFloat(event.target.value))} />
      </label>

      <div className="encounter-masses">
        <label>
          <span>Impactor</span>
          <input aria-label="Impactor mass in kilograms" type="number" min={0.001} step={0.1}
                 value={impactorMassKg}
                 onChange={(event) =>
                   setImpactorMassKg(Math.max(0, Number.parseFloat(event.target.value) || 0))} />
          <small>kg</small>
        </label>
        <label>
          <span>This satellite</span>
          <input aria-label="Satellite mass in kilograms" type="number" min={1} step={10}
                 value={targetMassKg}
                 onChange={(event) =>
                   setTargetMassKg(Math.max(1, Number.parseFloat(event.target.value) || 1))} />
          <small>kg</small>
        </label>
      </div>

      <dl className="mission-budget">
        <div className="mission-budget-total">
          <dt>Closing speed</dt>
          <dd>{assessment.relativeSpeedKmS.toFixed(2)} km/s</dd>
        </div>
        <div>
          <dt>Energy-to-mass ratio</dt>
          <dd>{formatEmr(assessment.energyToMassRatioJPerG)} J/g</dd>
        </div>
      </dl>

      <p className={`encounter-verdict ${catastrophic ? "catastrophic" : "survivable"}`}>
        <strong>
          {catastrophic ? "Catastrophic — the satellite is fragmented" : "Below the fragmentation threshold"}
        </strong>
        <span>
          {catastrophic
            ? `Above ${CATASTROPHIC_EMR_J_PER_G} J/g the target breaks up rather than being
               damaged. On the NASA standard breakup model this makes roughly
               ${formatModelCount(assessment.fragmentsOver10cm)} fragments larger than 10 cm and
               ${formatModelCount(assessment.fragmentsOver1cm)} larger than 1 cm — the second
               number matters more, because those are lethal and almost none are tracked.`
            : `Under ${CATASTROPHIC_EMR_J_PER_G} J/g the impact craters the target instead of
               shattering it. Raise the crossing angle or the impactor mass to cross the
               threshold.`}
        </span>
      </p>

      {/* Closing speed comes from the angle alone, which is the result people
          are most often surprised by. */}
      <p className="mission-insight">
        <strong>Closing speed is governed by relative inclination.</strong>
        <span>
          Both objects orbit at the same speed. Co-planar and co-directional they
          barely close; at {crossingAngleDeg.toFixed(0)}° they close at{" "}
          {assessment.relativeSpeedKmS.toFixed(1)} km/s, and head-on at{" "}
          {headOnSpeedKmS.toFixed(1)} km/s. Altitude does not enter it.
        </span>
      </p>

      <label className="mission-slider">
        <span className="mission-slider-label">
          <span>Warning time</span>
          <output>{formatLead(leadSeconds)}</output>
        </span>
        <input aria-label="Warning time" type="range" min={0} max={LEAD_TIMES.length - 1} step={1}
               value={leadIndex}
               onChange={(event) => setLeadIndex(Number.parseInt(event.target.value, 10))} />
      </label>

      <dl className="mission-budget">
        <div className="mission-budget-total">
          <dt>Burn for a {REQUIRED_MISS_KM} km miss</dt>
          <dd>{formatBurn(burn)}</dd>
        </div>
        <div>
          <dt>Drift from that burn</dt>
          <dd>{alongTrackDriftKm(burn, leadSeconds).toFixed(1)} km</dd>
        </div>
      </dl>

      <p className="mission-insight">
        <strong>Along-track displacement grows at three times the burn rate.</strong>
        <span>
          The burn alone would displace {naiveDriftKm.toFixed(1)} km over{" "}
          {formatLead(leadSeconds)}; the actual displacement is{" "}
          {alongTrackDriftKm(burn, leadSeconds).toFixed(1)} km, because the change in
          semi-major axis alters the period and the offset accumulates each
          revolution. Warning time therefore buys more than propellant: the same miss
          distance costs{" "}
          {(avoidanceDeltaVMetersPerSecond(REQUIRED_MISS_KM, 600) / burn).toFixed(0)}×
          as much at ten minutes' notice.
        </span>
      </p>
    </div>
  );
}
