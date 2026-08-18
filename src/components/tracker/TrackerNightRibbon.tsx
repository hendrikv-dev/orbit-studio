import type { MeteorNight } from "../../data/tracker/meteorActivity";
import type { ObservationPeriod } from "../../data/tracker/observationPeriod";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";

/**
 * When to go out, as a strip of the night rather than a chart.
 *
 * This replaces a plotted rate curve with axes, gridlines and a legend. The
 * curve was accurate and answered a question nobody standing outside asks —
 * "what is the modelled hourly rate at 01:20" — while the question they do ask,
 * "when should I go", had to be read off it. Rate samples existing is not a
 * reason to draw a graph.
 *
 * So the night is a single line, laid out in proportion to real time, carrying
 * only the moments a person acts on: when it gets dark, whether the sky is
 * improving or deteriorating, when the Moon is in the way, the window worth
 * going out for, and when it ends. Everything is placed at its true position
 * along the night, so the spacing itself carries information.
 */

interface Props {
  period: ObservationPeriod;
  meteors: MeteorNight;
  clock: PlaceClock;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
}

export function TrackerNightRibbon({
  period,
  meteors,
  clock,
  windowStartUtc,
  windowEndUtc,
}: Props) {
  const start = Date.parse(period.startUtc);
  const end = Date.parse(period.endUtc);
  const span = Math.max(1, end - start);
  const at = (utc: string) => ((Date.parse(utc) - start) / span) * 100;

  const dark = period.darkness.astronomical?.startUtc ?? null;

  // Whether the shower is building or fading through its own window, said in
  // words. The reader does not need the gradient, only its direction.
  const trend = (() => {
    if (!windowStartUtc || !windowEndUtc) return null;
    const inside = meteors.samples.filter(
      (sample) => sample.atUtc >= windowStartUtc && sample.atUtc <= windowEndUtc,
    );
    if (inside.length < 2) return null;
    const first = inside[0].totalPerHour;
    const last = inside[inside.length - 1].totalPerHour;
    if (last > first * 1.25) return "improving through the night";
    if (first > last * 1.25) return "best early, fading after";
    return "steady through the window";
  })();

  // The Moon only earns a mark when it is actually in the way.
  const moonUp = meteors.samples.filter(
    (sample) => sample.moonAltitudeDeg > 0 && sample.moonIlluminatedFraction > 0.15,
  );
  const moonFrom = moonUp[0]?.atUtc ?? null;
  const moonTo = moonUp[moonUp.length - 1]?.atUtc ?? null;

  const windowLeft = windowStartUtc ? at(windowStartUtc) : null;
  const windowWidth =
    windowStartUtc && windowEndUtc ? at(windowEndUtc) - at(windowStartUtc) : null;

  return (
    <div className="tk-ribbon">
      <div className="tk-ribbon-track">
        {/* The Moon's stretch sits under the line, because it is a condition
            over an interval rather than a moment. */}
        {moonFrom && moonTo ? (
          <span
            className="tk-ribbon-moon"
            style={{ left: `${at(moonFrom)}%`, width: `${at(moonTo) - at(moonFrom)}%` }}
          />
        ) : null}

        {windowLeft !== null && windowWidth !== null ? (
          <span
            className="tk-ribbon-window"
            style={{ left: `${windowLeft}%`, width: `${Math.max(2, windowWidth)}%` }}
          />
        ) : null}

        <span className="tk-ribbon-line" />

        {[
          { at: 0, label: "Sunset", value: formatClockTime(period.startUtc, clock) },
          dark
            ? { at: at(dark), label: "Dark", value: formatClockTime(dark, clock) }
            : null,
          { at: 100, label: "Dawn", value: formatClockTime(period.endUtc, clock) },
        ]
          .filter((mark): mark is { at: number; label: string; value: string } => mark !== null)
          .map((mark) => (
            <span
              key={mark.label}
              className="tk-ribbon-mark"
              style={{ left: `${mark.at}%` }}
              data-edge={mark.at === 0 ? "start" : mark.at === 100 ? "end" : undefined}
            >
              <b>{mark.value}</b>
              <i>{mark.label}</i>
            </span>
          ))}
      </div>

      {windowStartUtc && windowEndUtc ? (
        <p className="tk-ribbon-verdict">
          <b>
            {formatClockTime(windowStartUtc, clock)}–{formatClockTime(windowEndUtc, clock)}
          </b>{" "}
          is the window worth going out for{trend ? ` — ${trend}` : ""}.
          {moonFrom && moonTo ? " The Moon is up early and washes out the faint ones." : ""}
        </p>
      ) : null}
    </div>
  );
}
