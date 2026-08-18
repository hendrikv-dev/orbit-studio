import type { MeteorNight } from "../../data/tracker/meteorActivity";
import type { SkyPath } from "../../data/tracker/skyPath";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";

/**
 * When the shower is best, and why.
 *
 * A meteor shower's quality is a function of time, not of bearing. Drawing its
 * radiant against azimuth answered a question nobody asks and produced a hooked
 * curve that looked like a fault in the drawing. What actually governs the rate
 * is how high the radiant has climbed — the standard reduction is proportional
 * to the sine of its altitude — so altitude against time is the honest axis
 * pair, and it makes the shape of the night legible: low and quiet early, best
 * in the hours before dawn.
 *
 * Everything layered on it is a reason the rate changes:
 *
 * - twilight, because a shower during nautical twilight is largely wasted
 * - the Moon, because a bright Moon above the horizon removes faint meteors,
 *   which are most of them
 * - the recommended window, so the advice and the curve visibly agree
 *
 * Weather is deliberately not drawn here. Cloud is not part of the rate — the
 * rate is a dark-sky ceiling — and overlaying a forecast on this curve would
 * imply the two had been combined when they are applied separately and on
 * purpose.
 */

const WIDTH = 640;
const HEIGHT = 200;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 150;
const PAD_X = 38;

interface Props {
  path: SkyPath;
  meteors: MeteorNight;
  clock: PlaceClock;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
}

export function TrackerMeteorTimeline({
  path,
  meteors,
  clock,
  windowStartUtc,
  windowEndUtc,
}: Props) {
  const samples = meteors.samples;
  if (samples.length < 2 || path.points.length < 2) return null;

  const startMs = Date.parse(samples[0].atUtc);
  const endMs = Date.parse(samples[samples.length - 1].atUtc);
  const span = Math.max(1, endMs - startMs);
  const toX = (utc: string) =>
    PAD_X + ((Date.parse(utc) - startMs) / span) * (WIDTH - PAD_X * 2);
  const toY = (altitudeDeg: number) =>
    PLOT_BOTTOM - (Math.max(0, Math.min(90, altitudeDeg)) / 90) * (PLOT_BOTTOM - PLOT_TOP);

  // The radiant's own climb, resampled onto the rate samples so the two layers
  // share an axis exactly rather than approximately.
  const radiantByTime = new Map(path.points.map((point) => [point.atUtc, point.altitudeDeg]));
  const climb = samples
    .map((sample) => ({ atUtc: sample.atUtc, altitudeDeg: radiantByTime.get(sample.atUtc) }))
    .filter((entry): entry is { atUtc: string; altitudeDeg: number } => entry.altitudeDeg !== undefined);
  if (climb.length < 2) return null;

  const line = `M ${climb.map((entry) => `${toX(entry.atUtc).toFixed(1)},${toY(entry.altitudeDeg).toFixed(1)}`).join(" L ")}`;
  const area = `${line} L ${toX(climb[climb.length - 1].atUtc).toFixed(1)},${PLOT_BOTTOM} L ${toX(climb[0].atUtc).toFixed(1)},${PLOT_BOTTOM} Z`;

  const lit = climb.filter(
    (entry) =>
      (!windowStartUtc || entry.atUtc >= windowStartUtc) &&
      (!windowEndUtc || entry.atUtc <= windowEndUtc),
  );
  const litLine =
    lit.length > 1
      ? `M ${lit.map((entry) => `${toX(entry.atUtc).toFixed(1)},${toY(entry.altitudeDeg).toFixed(1)}`).join(" L ")}`
      : "";

  // Twilight and moonlight as bands along the foot, each drawn only where it
  // actually applies. A legend that is always present implies a condition that
  // is always present.
  const runs = (test: (index: number) => boolean) => {
    const spans: { from: string; to: string }[] = [];
    let open: string | null = null;
    samples.forEach((sample, index) => {
      if (test(index)) {
        open ??= sample.atUtc;
      } else if (open) {
        spans.push({ from: open, to: sample.atUtc });
        open = null;
      }
    });
    if (open) spans.push({ from: open, to: samples[samples.length - 1].atUtc });
    return spans;
  };

  const twilight = runs((index) => samples[index].sunAltitudeDeg > -18);
  const moonUp = runs(
    (index) => samples[index].moonAltitudeDeg > 0 && samples[index].moonIlluminatedFraction > 0.15,
  );

  const peakRate = samples.reduce((best, sample) => Math.max(best, sample.totalPerHour), 0);
  const bestSample = samples.reduce((best, sample) =>
    sample.totalPerHour > best.totalPerHour ? sample : best,
  );

  const hours = samples.filter((_, index) => index % Math.ceil(samples.length / 6) === 0);

  return (
    <figure className="tk-timeline">
      <figcaption className="tk-timeline-title">
        How the shower builds through the night
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`The radiant climbs through the night, and the rate rises with it, reaching about ${Math.round(peakRate)} an hour around ${formatClockTime(bestSample.atUtc, clock)}.`}
      >
        {twilight.map((span) => (
          <rect
            key={`tw-${span.from}`}
            x={toX(span.from)}
            y={PLOT_TOP}
            width={Math.max(0, toX(span.to) - toX(span.from))}
            height={PLOT_BOTTOM - PLOT_TOP}
            className="tk-timeline-twilight"
          />
        ))}

        {[30, 60].map((altitude) => (
          <g key={altitude}>
            <line
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={toY(altitude)}
              y2={toY(altitude)}
              className="tk-chart-guide"
            />
            <text x={WIDTH - PAD_X + 6} y={toY(altitude) + 4} className="tk-chart-guidelabel">
              {altitude}°
            </text>
          </g>
        ))}

        <path d={area} className="tk-timeline-area" />
        <path d={line} className="tk-chart-path" />
        {litLine ? <path d={litLine} className="tk-chart-path-lit" /> : null}

        <line x1={0} x2={WIDTH} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} className="tk-chart-horizon" />

        {/* Moon interference, as a bar rather than a wash: it is a condition
            over an interval, not a value at a height. */}
        {moonUp.map((span) => (
          <rect
            key={`moon-${span.from}`}
            x={toX(span.from)}
            y={PLOT_BOTTOM + 6}
            width={Math.max(0, toX(span.to) - toX(span.from))}
            height={5}
            rx={2.5}
            className="tk-timeline-moon"
          />
        ))}

        {twilight.map((span) => {
          const width = toX(span.to) - toX(span.from);
          if (width < 44) return null;
          return (
            <text
              key={`twl-${span.from}`}
              x={toX(span.from) + width / 2}
              y={PLOT_TOP + 14}
              textAnchor="middle"
              className="tk-timeline-inline"
            >
              not dark yet
            </text>
          );
        })}

        {moonUp.map((span) => {
          const width = toX(span.to) - toX(span.from);
          if (width < 60) return null;
          return (
            <text
              key={`mnl-${span.from}`}
              x={toX(span.from) + width / 2}
              y={PLOT_BOTTOM + 24}
              textAnchor="middle"
              className="tk-timeline-inline is-moon"
            >
              Moon up
            </text>
          );
        })}

        {/* The best moment, named on the curve rather than in a caption. */}
        <g>
          <circle
            cx={toX(bestSample.atUtc)}
            cy={toY(radiantByTime.get(bestSample.atUtc) ?? 0)}
            r={3.4}
            className="tk-timeline-peak"
          />
          <text
            x={toX(bestSample.atUtc)}
            y={toY(radiantByTime.get(bestSample.atUtc) ?? 0) - 12}
            textAnchor="middle"
            className="tk-timeline-peaklabel"
          >
            best · ~{Math.round(peakRate)}/hr
          </text>
        </g>

        {hours.map((sample) => (
          <text
            key={sample.atUtc}
            x={toX(sample.atUtc)}
            y={HEIGHT - 8}
            textAnchor="middle"
            className="tk-chart-compass"
          >
            {formatClockTime(sample.atUtc, clock)}
          </text>
        ))}
      </svg>

    </figure>
  );
}
