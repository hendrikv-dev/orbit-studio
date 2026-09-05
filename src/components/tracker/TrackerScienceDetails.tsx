import type { Opportunity } from "../../data/tracker/opportunity";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function TrackerScienceDetails({
  opportunity,
  clock,
}: {
  opportunity: Opportunity;
  clock: PlaceClock;
}) {
  const science = opportunity.science;
  if (!science) return null;

  if (science.kind === "lunar-phase") {
    const { phase } = science;
    return (
      <dl className="tracker-science-details" aria-label="Moon phase details">
        <div><dt>Phase</dt><dd>{phase.name}</dd></div>
        <div><dt>Illumination</dt><dd>{percent(Number(phase.illuminatedFraction))}</dd></div>
        <div>
          <dt>Direction</dt>
          <dd>{phase.direction.charAt(0).toUpperCase() + phase.direction.slice(1)}</dd>
        </div>
      </dl>
    );
  }

  if (science.kind === "lunar-eclipse") {
    const { timing } = science;
    return (
      <div className="tracker-science-block">
        <dl className="tracker-science-details" aria-label="Lunar eclipse contact times">
          <div>
            <dt>Penumbral start</dt>
            <dd>{formatClockTime(timing.penumbral.startUtc, clock)}</dd>
          </div>
          {timing.partial ? (
            <div>
              <dt>Partial start</dt>
              <dd>{formatClockTime(timing.partial.startUtc, clock)}</dd>
            </div>
          ) : null}
          {timing.totality ? (
            <div>
              <dt>Totality start</dt>
              <dd>{formatClockTime(timing.totality.startUtc, clock)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Maximum</dt>
            <dd>{formatClockTime(timing.maximumUtc, clock)}</dd>
          </div>
          {timing.totality ? (
            <div>
              <dt>Totality end</dt>
              <dd>{formatClockTime(timing.totality.endUtc, clock)}</dd>
            </div>
          ) : null}
          {timing.partial ? (
            <div>
              <dt>Partial end</dt>
              <dd>{formatClockTime(timing.partial.endUtc, clock)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Penumbral end</dt>
            <dd>{formatClockTime(timing.penumbral.endUtc, clock)}</dd>
          </div>
          <div>
            <dt>Visible phase duration</dt>
            <dd>{Math.round(Number(timing.observablePhase.durationMinutes))} minutes</dd>
          </div>
        </dl>
        <p className="tracker-science-limitation">
          Contact times are converted to this location&rsquo;s clock. Local visibility is checked at
          each contact, and the visibility footprint beside this page is computed
          from the same Moon altitudes.
        </p>
      </div>
    );
  }

  if (science.kind === "planet" && science.event?.kind === "opposition") {
    return (
      <dl className="tracker-science-details" aria-label="Planetary event details">
        <div><dt>Event</dt><dd>Opposition</dd></div>
        <div><dt>Alignment</dt><dd>{formatClockTime(science.event.atUtc, clock)}</dd></div>
      </dl>
    );
  }

  if (science.kind === "conjunction") {
    return (
      <dl className="tracker-science-details" aria-label="Conjunction details">
        <div><dt>Event</dt><dd>Conjunction</dd></div>
        <div><dt>Angular separation</dt><dd>{Number(science.separationDeg).toFixed(1)}°</dd></div>
      </dl>
    );
  }

  return null;
}
