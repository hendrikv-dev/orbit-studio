import { useMemo } from "react";
import type { MeteorNight } from "../../../data/tracker/meteorActivity";
import type { ObservationPeriod } from "../../../data/tracker/observationPeriod";
import type { GazeRegion } from "../../../data/tracker/skyPath";
import { formatClockHour, formatClockTime, type PlaceClock } from "../../../lib/localTime";

/**
 * Activity through the night: the meteor page's visualization, and the one the
 * whole system was designed around.
 *
 * The question it answers is "when should I be outside", and it answers it by
 * shape rather than by number. Bars stand at their true position across the
 * observing period, their heights are the modelled rate at that quarter hour,
 * and the stretch worth going out for is lit while the rest is not. Somebody
 * who reads nothing else can see that the night gets better after midnight.
 *
 * ## Why these are the real rates
 *
 * Each bar is `MeteorSample.totalPerHour` — every active shower's contribution
 * at that instant plus the sporadic background, reduced for radiant altitude,
 * twilight and moonlight. It is not the shower's headline ZHR spread across the
 * night, which is the mistake this drawing exists to avoid: a shower two days
 * past maximum has a genuinely lower curve, and the curve here is lower.
 *
 * ## Where to look, kept separate from when
 *
 * The line beneath carries both and never merges them. A radiant sets the rate
 * and is the one place you should not stare, so the direction comes from the
 * gaze region rather than from the radiant's bearing, and it says how wide a
 * piece of sky to take in rather than giving a heading to point at.
 */

interface Props {
  period: ObservationPeriod;
  meteors: MeteorNight;
  clock: PlaceClock;
  /** The recommended interval, drawn lit against the rest of the night. */
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  /** Where to face, which is deliberately not the radiant. */
  gaze: GazeRegion | null;
  /** One sentence beneath, from the page's own judgement of conditions. */
  verdict: { headline: string; detail: string; tone: "good" | "fair" | "poor" | "unknown" };
  title: string;
  timing: string;
}

const WIDTH = 620;
const HEIGHT = 150;
const BASELINE = 116;

export function TrackerNightActivity({
  period,
  meteors,
  clock,
  windowStartUtc,
  windowEndUtc,
  gaze,
  verdict,
  title,
  timing,
}: Props) {
  const layout = useMemo(() => {
    const start = Date.parse(period.startUtc);
    const end = Date.parse(period.endUtc);
    const span = Math.max(1, end - start);
    const at = (utc: string) => ((Date.parse(utc) - start) / span) * WIDTH;
    const peak = meteors.samples.reduce((top, sample) => Math.max(top, sample.totalPerHour), 0);
    return { start, end, span, at, peak };
  }, [meteors.samples, period.endUtc, period.startUtc]);

  // Hour marks at the reader's own clock, not at fractions of the period. An
  // axis labelled "25% of the night" is a chart about itself.
  const hourTicks = useMemo(() => {
    const ticks: { x: number; label: string }[] = [];
    const first = new Date(Math.ceil(layout.start / 3_600_000) * 3_600_000);
    // Chosen from how many labels will fit rather than from the length of the
    // night. An axis is a drawing with a width, and ten hourly labels in the
    // 430 px a panel actually gets is ten labels touching each other.
    const hours = layout.span / 3_600_000;
    const stepHours = hours > 12 ? 3 : hours > 7 ? 2 : 1;
    for (
      let stamp = first.getTime();
      stamp <= layout.end;
      stamp += stepHours * 3_600_000
    ) {
      const utc = new Date(stamp).toISOString();
      ticks.push({ x: layout.at(utc), label: formatClockHour(utc, clock) });
    }
    return ticks;
  }, [clock, layout]);

  const moonUp = useMemo(
    () =>
      meteors.samples.filter(
        (sample) => sample.moonAltitudeDeg > 0 && sample.moonIlluminatedFraction > 0.12,
      ),
    [meteors.samples],
  );

  if (meteors.samples.length === 0 || layout.peak <= 0) {
    return (
      <div className="tk-viz-panel tk-nightactivity">
        <div className="tk-viz-head">
          <p className="tk-viz-title">{title}</p>
          <p className="tk-viz-timing">{timing}</p>
        </div>
        <p className="tk-viz-empty">
          The sky does not get dark enough here tonight for a meteor rate to mean anything.
        </p>
      </div>
    );
  }

  const barWidth = Math.max(3, (WIDTH / meteors.samples.length) * 0.62);
  const inWindow = (utc: string) =>
    windowStartUtc !== null &&
    windowEndUtc !== null &&
    utc >= windowStartUtc &&
    utc <= windowEndUtc;

  return (
    <div className="tk-viz-panel tk-nightactivity">
      <div className="tk-viz-head">
        <p className="tk-viz-title">{title}</p>
        <p className="tk-viz-timing">{timing}</p>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        className="tk-nightactivity-chart"
        aria-label={
          windowStartUtc && windowEndUtc
            ? `Meteor activity rises through the night. The best stretch runs ${formatClockTime(windowStartUtc, clock)} to ${formatClockTime(windowEndUtc, clock)}, when the modelled rate peaks near ${Math.round(layout.peak)} an hour.`
            : `Meteor activity across the night, peaking near ${Math.round(layout.peak)} an hour.`
        }
      >
        {/* The lit stretch, behind the bars, so the bars read as being inside
            it rather than as being a different colour for no stated reason. */}
        {windowStartUtc && windowEndUtc ? (
          <rect
            x={layout.at(windowStartUtc)}
            y={12}
            width={Math.max(6, layout.at(windowEndUtc) - layout.at(windowStartUtc))}
            height={BASELINE - 12}
            className="tk-nightactivity-window"
            rx={3}
          />
        ) : null}

        {meteors.samples.map((sample) => {
          const height = Math.max(2, (sample.totalPerHour / layout.peak) * (BASELINE - 22));
          const x = layout.at(sample.atUtc) - barWidth / 2;
          return (
            <rect
              key={sample.atUtc}
              x={x}
              y={BASELINE - height}
              width={barWidth}
              height={height}
              rx={Math.min(2, barWidth / 2)}
              className={
                inWindow(sample.atUtc)
                  ? "tk-nightactivity-bar is-best"
                  : "tk-nightactivity-bar"
              }
            />
          );
        })}

        <line x1={0} x2={WIDTH} y1={BASELINE} y2={BASELINE} className="tk-nightactivity-axis" />

        {hourTicks.map((tick) => (
          <text
            key={tick.label + tick.x}
            x={Math.min(WIDTH - 16, Math.max(16, tick.x))}
            y={BASELINE + 16}
            textAnchor="middle"
            className="tk-nightactivity-tick"
          >
            {tick.label}
          </text>
        ))}

        {/* The Moon, under the axis, as the interval it is actually up for.
            It is a condition over a stretch of the night, not a moment. */}
        {moonUp.length > 1 ? (
          <g className="tk-nightactivity-moon">
            <line
              x1={layout.at(moonUp[0].atUtc)}
              x2={layout.at(moonUp[moonUp.length - 1].atUtc)}
              y1={BASELINE + 26}
              y2={BASELINE + 26}
            />
            <circle cx={layout.at(moonUp[0].atUtc)} cy={BASELINE + 26} r={3.2} />
          </g>
        ) : null}
      </svg>

      <div className={`tk-viz-verdict is-${verdict.tone}`}>
        <p className="tk-viz-verdict-head">{verdict.headline}</p>
        <p className="tk-viz-verdict-detail">
          {verdict.detail}
          {gaze ? ` ${gazeSentence(gaze)}` : ""}
        </p>
      </div>
    </div>
  );
}

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
];

/**
 * Where to look, said as a region rather than a heading.
 *
 * "Face north-east and take in as much sky as you can" is the whole of the
 * correct advice for a shower. A bearing on its own invites somebody to point
 * at one spot, which is the least productive thing they could do with their
 * eyes.
 */
function gazeSentence(gaze: GazeRegion): string {
  const name = COMPASS[Math.round((((gaze.centerAzimuthDeg % 360) + 360) % 360) / 45) % 8];
  return gaze.azimuthSpreadDeg > 30
    ? `Face ${name} and take in as much sky as you can — do not fix on one spot.`
    : `Face ${name}, about ${Math.round(gaze.centerAltitudeDeg)}° up.`;
}
