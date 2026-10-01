import { useMemo } from "react";
import type { ObservationPeriod } from "../../../data/tracker/observationPeriod";
import {
  describeAltitude,
  describeDirection,
  type GazeRegion,
  type SkyPath,
} from "../../../data/tracker/skyPath";
import { formatClockHour, formatClockTime, type PlaceClock } from "../../../lib/localTime";

/**
 * How high a target is through the night, for everything that has a position.
 *
 * Planets, the Moon and close pairings all answer the same observing question —
 * "is it high enough yet, and when is it best" — and altitude against time
 * answers it directly. The horizontal axis is the same observing period the
 * meteor graph uses, at the same scale, in the same box, so moving between a
 * shower and Saturn does not move the furniture.
 *
 * Altitude rather than a sky chart, in this slot, on purpose. A full horizon
 * view with compass bearings is the better drawing for *finding* something and
 * the worse one for *deciding when to go out*, and this panel is the decision.
 * The finding view is one control away, behind the hero's own action, where
 * somebody who has already decided will look for it.
 */

interface Props {
  path: SkyPath;
  period: ObservationPeriod;
  clock: PlaceClock;
  gaze: GazeRegion | null;
  title: string;
  timing: string;
  verdict: { headline: string; detail: string; tone: "good" | "fair" | "poor" | "unknown" };
}

const WIDTH = 620;
const HEIGHT = 150;
const HORIZON_Y = 116;
const SKY_TOP = 16;

function altitudeToY(altitudeDeg: number): number {
  const clamped = Math.min(90, Math.max(0, altitudeDeg));
  return HORIZON_Y - (clamped / 90) * (HORIZON_Y - SKY_TOP);
}

export function TrackerSkyPathPanel({
  path,
  period,
  clock,
  gaze,
  title,
  timing,
  verdict,
}: Props) {
  const layout = useMemo(() => {
    const start = Date.parse(period.startUtc);
    const end = Date.parse(period.endUtc);
    const span = Math.max(1, end - start);
    return {
      start,
      end,
      span,
      at: (utc: string) =>
        Math.max(0, Math.min(WIDTH, ((Date.parse(utc) - start) / span) * WIDTH)),
    };
  }, [period.endUtc, period.startUtc]);

  const hourTicks = useMemo(() => {
    const ticks: { x: number; label: string }[] = [];
    // Chosen from how many labels will fit rather than from the length of the
    // night. An axis is a drawing with a width, and ten hourly labels in the
    // 430 px a panel actually gets is ten labels touching each other.
    const hours = layout.span / 3_600_000;
    const stepHours = hours > 12 ? 3 : hours > 7 ? 2 : 1;
    for (
      let stamp = Math.ceil(layout.start / 3_600_000) * 3_600_000;
      stamp <= layout.end;
      stamp += stepHours * 3_600_000
    ) {
      const utc = new Date(stamp).toISOString();
      ticks.push({ x: layout.at(utc), label: formatClockHour(utc, clock) });
    }
    return ticks;
  }, [clock, layout]);

  const visible = path.points.filter((point) => point.altitudeDeg > 0);
  const peak = visible.reduce(
    (best, point) => (point.altitudeDeg > best.altitudeDeg ? point : best),
    visible[0] ?? path.points[0],
  );

  const line = (points: typeof path.points) =>
    points.length === 0
      ? ""
      : `M ${points
          .map(
            (point) =>
              `${layout.at(point.atUtc).toFixed(1)},${altitudeToY(point.altitudeDeg).toFixed(1)}`,
          )
          .join(" L ")}`;

  const lit = visible.filter(
    (point) =>
      path.windowStartUtc !== null &&
      path.windowEndUtc !== null &&
      point.atUtc >= path.windowStartUtc &&
      point.atUtc <= path.windowEndUtc,
  );

  const mark = (utc: string | null, text: string) => {
    if (!utc) return null;
    const point = path.points.find((entry) => entry.atUtc === utc);
    if (!point || point.altitudeDeg < 0) return null;
    const x = layout.at(utc);
    const y = altitudeToY(point.altitudeDeg);
    return (
      <g key={text}>
        <circle cx={x} cy={y} r={2.8} className="tk-skypath-mark" />
        <text
          x={Math.min(WIDTH - 24, Math.max(24, x))}
          y={y - 8}
          textAnchor="middle"
          className="tk-skypath-marklabel"
        >
          {text}
        </text>
      </g>
    );
  };

  return (
    <div className="tk-viz-panel tk-skypathpanel">
      <div className="tk-viz-head">
        <p className="tk-viz-title">{title}</p>
        <p className="tk-viz-timing">{timing}</p>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        className="tk-skypath-chart"
        aria-label={`${title}. It reaches ${Math.round(peak?.altitudeDeg ?? 0)} degrees above the horizon${
          path.culminationUtc ? ` at ${formatClockTime(path.culminationUtc, clock)}` : ""
        }.`}
      >
        {path.windowStartUtc && path.windowEndUtc ? (
          <rect
            x={layout.at(path.windowStartUtc)}
            y={SKY_TOP - 4}
            width={Math.max(6, layout.at(path.windowEndUtc) - layout.at(path.windowStartUtc))}
            height={HORIZON_Y - SKY_TOP + 4}
            className="tk-skypath-window"
            rx={3}
          />
        ) : null}

        {[30, 60].map((altitude) => (
          <g key={altitude}>
            <line
              x1={0}
              x2={WIDTH}
              y1={altitudeToY(altitude)}
              y2={altitudeToY(altitude)}
              className="tk-skypath-guide"
            />
            <text x={4} y={altitudeToY(altitude) - 4} className="tk-skypath-guidelabel">
              {altitude}°
            </text>
          </g>
        ))}

        <path d={line(visible)} className="tk-skypath-line" />
        <path d={line(lit)} className="tk-skypath-line-lit" />

        {path.kind === "target" ? (
          <>
            {mark(path.riseUtc, "rises")}
            {mark(path.culminationUtc, "highest")}
            {mark(path.setUtc, "sets")}
          </>
        ) : null}

        <line x1={0} x2={WIDTH} y1={HORIZON_Y} y2={HORIZON_Y} className="tk-skypath-horizon" />

        {hourTicks.map((tick) => (
          <text
            key={`${tick.label}-${tick.x}`}
            x={Math.min(WIDTH - 16, Math.max(16, tick.x))}
            y={HORIZON_Y + 16}
            textAnchor="middle"
            className="tk-skypath-tick"
          >
            {tick.label}
          </text>
        ))}
      </svg>

      <div className={`tk-viz-verdict is-${verdict.tone}`}>
        <p className="tk-viz-verdict-head">{verdict.headline}</p>
        <p className="tk-viz-verdict-detail">
          {verdict.detail}
          {/* The gaze sentence only where the headline is not already an
              instruction. Tonight's headline is now the observing instruction
              itself, and appending a second one put the same direction on the
              page three times — hero metric, hero sentence, and here — which
              reads as the interface stuttering rather than as emphasis. */}
          {gaze && !verdict.headline.toLowerCase().startsWith("look")
            ? ` ${describeDirection(gaze.centerAzimuthDeg, gaze.centerAltitudeDeg)}, ${describeAltitude(gaze.centerAltitudeDeg)}.`
            : ""}
        </p>
      </div>
    </div>
  );
}
