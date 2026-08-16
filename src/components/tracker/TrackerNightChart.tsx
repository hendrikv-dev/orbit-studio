import type { ObservationPeriod } from "../../data/tracker/observationPeriod";
import type { MeteorSample } from "../../data/tracker/meteorActivity";

/**
 * The night, as a strip you can read at a glance.
 *
 * V1 §6 requires the visual to be functional rather than decorative, and to help
 * with at least one of: where to look, how the phenomenon moves, when its
 * intensity improves or declines, what you are likely to perceive. This answers
 * the third for every phenomenon and the third *quantitatively* for meteors.
 *
 * It is deliberately not a sky map. A sky map answers "where", which the
 * guidance text already answers in words, and a chart of the night answers a
 * question nothing else here can: **when to go outside**. Darkness deepens and
 * fades, the Moon rises and sets, and the recommended moment sits somewhere in
 * that — a single time with no surrounding shape hides whether being an hour
 * late costs you the evening or nothing at all.
 *
 * V1 §6 also requires visuals to distinguish observation from forecast. The
 * twilight bands and the Moon are geometry and are drawn solid; the meteor rate
 * is an estimate and is drawn as a soft area with its own label, never as a
 * line implying a measured series.
 */

interface Props {
  period: ObservationPeriod;
  /** Meteor samples, where the highlighted opportunity is a meteor one. */
  rateSamples?: MeteorSample[];
  /** The moment being recommended, marked on the strip. */
  highlightUtc?: string;
  highlightLabel?: string;
}

/**
 * The plot stretches to its container and the viewBox does not preserve its
 * aspect ratio, which is correct for the bands and the rate curve: the x axis is
 * time and the y axis is arbitrary, so distorting them carries no meaning.
 *
 * It is wrong for anything with a shape of its own. A circle marker became an
 * ellipse and the hour labels came out condensed on a phone. So the shape-bearing
 * parts are not in the SVG: the hour axis is HTML positioned in percentages
 * underneath, and the marker cap is a bar rather than a dot.
 */
const WIDTH = 720;
const HEIGHT = 114;
const PADDING_LEFT = 8;
const PADDING_RIGHT = 8;

function fractionOf(period: ObservationPeriod, iso: string): number {
  const start = Date.parse(period.startUtc);
  const end = Date.parse(period.endUtc);
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (Date.parse(iso) - start) / (end - start)));
}

function x(fraction: number): number {
  return PADDING_LEFT + fraction * (WIDTH - PADDING_LEFT - PADDING_RIGHT);
}

/** Whole hours across the period, for a readable axis. */
function hourTicks(period: ObservationPeriod): { at: number; label: string }[] {
  const start = Date.parse(period.startUtc);
  const end = Date.parse(period.endUtc);
  const ticks: { at: number; label: string }[] = [];
  const first = new Date(Math.ceil(start / 3_600_000) * 3_600_000);
  for (let stamp = first.getTime(); stamp <= end; stamp += 3_600_000) {
    const hour = new Date(stamp).getUTCHours();
    // Every other hour on a short night would crowd; every two hours is enough.
    if (hour % 2 !== 0) continue;
    ticks.push({
      at: (stamp - start) / (end - start),
      label: `${String(hour).padStart(2, "0")}`,
    });
  }
  return ticks;
}

export function TrackerNightChart({
  period,
  rateSamples,
  highlightUtc,
  highlightLabel,
}: Props) {
  const plotHeight = HEIGHT;
  const bands = (["civil", "nautical", "astronomical"] as const)
    .map((band) => ({ band, window: period.darkness[band] }))
    .filter((entry): entry is { band: typeof entry.band; window: NonNullable<typeof entry.window> } =>
      Boolean(entry.window),
    );

  const peak = rateSamples?.reduce((max, sample) => Math.max(max, sample.totalPerHour), 0) ?? 0;
  const ratePath =
    rateSamples && rateSamples.length > 1 && peak > 0
      ? (() => {
          const points = rateSamples.map((sample) => {
            const px = x(fractionOf(period, sample.atUtc));
            const py = plotHeight - 10 - (sample.totalPerHour / peak) * (plotHeight - 30);
            return `${px.toFixed(1)},${py.toFixed(1)}`;
          });
          const first = x(fractionOf(period, rateSamples[0].atUtc));
          const last = x(fractionOf(period, rateSamples[rateSamples.length - 1].atUtc));
          return `M ${first},${plotHeight - 10} L ${points.join(" L ")} L ${last},${plotHeight - 10} Z`;
        })()
      : null;

  const moonWindows = rateSamples ? moonUpWindows(period, rateSamples) : [];
  const highlightX = highlightUtc ? x(fractionOf(period, highlightUtc)) : null;

  return (
    <figure className="tracker-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={describe(period, rateSamples, highlightUtc, highlightLabel)}
      >
        <rect x={0} y={0} width={WIDTH} height={plotHeight} className="tracker-chart-twilight" />
        {bands.map(({ band, window }) => (
          <rect
            key={band}
            x={x(fractionOf(period, window.startUtc))}
            y={0}
            width={x(fractionOf(period, window.endUtc)) - x(fractionOf(period, window.startUtc))}
            height={plotHeight}
            className={`tracker-chart-band tracker-chart-band-${band}`}
          />
        ))}

        {moonWindows.map((window, index) => (
          <rect
            key={index}
            x={x(fractionOf(period, window.startUtc))}
            y={0}
            width={x(fractionOf(period, window.endUtc)) - x(fractionOf(period, window.startUtc))}
            height={4}
            className="tracker-chart-moon"
          />
        ))}

        {ratePath ? <path d={ratePath} className="tracker-chart-rate" /> : null}

        {highlightX !== null ? (
          <g>
            <line
              x1={highlightX}
              x2={highlightX}
              y1={0}
              y2={plotHeight}
              className="tracker-chart-mark"
            />
            {/* A bar, not a dot: a circle in a stretched viewBox is an ellipse. */}
            <rect x={highlightX - 5} y={0} width={10} height={5} className="tracker-chart-mark-cap" />
          </g>
        ) : null}
      </svg>

      {/* Outside the SVG so the type is never stretched with the plot. */}
      <div className="tracker-chart-axis" aria-hidden="true">
        {hourTicks(period).map((tick) => (
          <span key={tick.label + tick.at} style={{ left: `${tick.at * 100}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      <figcaption>
        Sunset to sunrise, UTC. Darker shading is deeper twilight; the bar along the top is the
        Moon above the horizon.
        {ratePath ? " The filled curve is the estimated meteor rate — an estimate, not a measurement." : ""}
        {highlightLabel ? ` The marker is ${highlightLabel}.` : ""}
      </figcaption>
    </figure>
  );
}

/** Contiguous stretches with the Moon above the horizon. */
function moonUpWindows(
  period: ObservationPeriod,
  samples: MeteorSample[],
): { startUtc: string; endUtc: string }[] {
  const windows: { startUtc: string; endUtc: string }[] = [];
  let open: string | null = null;
  for (const sample of samples) {
    if (sample.moonAltitudeDeg > 0 && open === null) open = sample.atUtc;
    if (sample.moonAltitudeDeg <= 0 && open !== null) {
      windows.push({ startUtc: open, endUtc: sample.atUtc });
      open = null;
    }
  }
  if (open !== null) windows.push({ startUtc: open, endUtc: period.endUtc });
  return windows;
}

/**
 * The chart in words, for anyone not looking at it. A decorative image would be
 * `aria-hidden`; this one carries information, so it has to be readable.
 */
function describe(
  period: ObservationPeriod,
  rateSamples: MeteorSample[] | undefined,
  highlightUtc: string | undefined,
  highlightLabel: string | undefined,
): string {
  const parts = [
    `The night from ${period.startUtc.slice(11, 16)} to ${period.endUtc.slice(11, 16)} UTC.`,
  ];
  const astronomical = period.darkness.astronomical;
  if (astronomical) {
    parts.push(
      `Full darkness from ${astronomical.startUtc.slice(11, 16)} to ${astronomical.endUtc.slice(11, 16)}.`,
    );
  } else {
    parts.push("The sky never reaches full astronomical darkness tonight.");
  }
  if (rateSamples && rateSamples.length > 0) {
    const peak = rateSamples.reduce((best, sample) =>
      sample.totalPerHour > best.totalPerHour ? sample : best,
    );
    parts.push(
      `Meteor rate is estimated highest around ${peak.atUtc.slice(11, 16)}, at about ${Math.round(peak.totalPerHour)} an hour.`,
    );
  }
  if (highlightUtc) {
    parts.push(`${highlightLabel ?? "The recommended time"} is ${highlightUtc.slice(11, 16)}.`);
  }
  return parts.join(" ");
}
