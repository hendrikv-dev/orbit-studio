import { useMemo } from "react";
import { highestPoint, type SkyPath } from "../../data/tracker/skyPath";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";

/**
 * The sky graphic, drawn from real samples.
 *
 * Same visual language as the example on the entry screen — horizon, compass
 * bearings, elevation guides, a lit observing window — but every point here is
 * a computed horizontal coordinate rather than an interpolation between three
 * bearings. That distinction is the whole reason the sampling pipeline was
 * changed: the interface knew where Saturn was to a fraction of a degree and
 * was drawing a plausible curve instead.
 *
 * What is drawn depends on what the event is. A target gets a path with rise,
 * culmination and set marked, because those are moments you act on. A radiant
 * gets its climb and no marks, because you never point at a radiant — the
 * height it has reached is the thing that matters, since that is what sets the
 * rate.
 */

const WIDTH = 640;
const HEIGHT = 260;
const HORIZON_Y = 208;
const SKY_TOP = 26;
const PAD_X = 34;

const COMPASS = [
  { deg: 0, label: "N" },
  { deg: 45, label: "NE" },
  { deg: 90, label: "E" },
  { deg: 135, label: "SE" },
  { deg: 180, label: "S" },
  { deg: 225, label: "SW" },
  { deg: 270, label: "W" },
  { deg: 315, label: "NW" },
  { deg: 360, label: "N" },
];

function altitudeToY(altitudeDeg: number): number {
  const clamped = Math.min(90, Math.max(0, altitudeDeg));
  return HORIZON_Y - (clamped / 90) * (HORIZON_Y - SKY_TOP);
}

interface Props {
  path: SkyPath;
  clock: PlaceClock;
  /** Phenomenon hue, so the drawing matches the card it belongs to. */
  tone?: string;
  label: string;
}

export function TrackerSkyChart({ path, clock, tone = "neutral", label }: Props) {
  const view = useMemo(() => {
    // The horizontal axis spans only the bearings the object actually occupies,
    // padded a little. A fixed 0–360 axis squeezed every real path into a
    // narrow band in the middle and wasted three-quarters of the drawing —
    // most objects cross well under half the compass in one night.
    const azimuths = path.points.map((point) => point.azimuthDeg);
    let low = Math.min(...azimuths);
    let high = Math.max(...azimuths);
    // A path that crosses due north wraps from 359 to 1 and would otherwise be
    // read as spanning the entire sky the long way round.
    const wraps = high - low > 180;
    const unwrap = (deg: number) => (wraps && deg < 180 ? deg + 360 : deg);
    if (wraps) {
      const shifted = azimuths.map(unwrap);
      low = Math.min(...shifted);
      high = Math.max(...shifted);
    }
    // A wide-enough minimum that at least a couple of named compass points fall
    // inside the axis. A radiant can cross as little as ten degrees of bearing
    // in a night; drawn to fit, that put a single "NE" under the whole chart
    // and stretched a gentle climb into something that looked like a fault in
    // the drawing.
    const span = Math.max(90, high - low);
    const start = low - span * 0.12;
    const total = span * 1.24;
    return {
      unwrap,
      toX: (deg: number) => PAD_X + ((unwrap(deg) - start) / total) * (WIDTH - PAD_X * 2),
      start,
      total,
    };
  }, [path]);

  const pointsAt = (from: string | null, to: string | null) =>
    path.points.filter((point) => {
      if (from && point.atUtc < from) return false;
      if (to && point.atUtc > to) return false;
      return true;
    });

  const lineFor = (points: typeof path.points) =>
    points.length === 0
      ? ""
      : `M ${points
          .map((point) => `${view.toX(point.azimuthDeg).toFixed(1)},${altitudeToY(point.altitudeDeg).toFixed(1)}`)
          .join(" L ")}`;

  const visible = path.points.filter((point) => point.altitudeDeg > 0);
  const full = lineFor(visible);
  const lit = lineFor(
    pointsAt(path.windowStartUtc, path.windowEndUtc).filter((point) => point.altitudeDeg > 0),
  );
  const peak = highestPoint(path);

  // Only the compass points the drawing actually spans, so the axis is not
  // labelled with directions the object never goes near. Where too few named
  // points fall inside, bearings are numbered instead — an unlabelled axis
  // tells the reader nothing about which way to face, which is most of what
  // the drawing is for.
  const inRange = (deg: number) => {
    const x = view.toX(deg);
    return x >= PAD_X - 2 && x <= WIDTH - PAD_X + 2;
  };
  const named = COMPASS.filter((entry) => inRange(entry.deg));
  const ticks =
    named.length >= 3
      ? named
      : Array.from({ length: 9 }, (_, index) => {
          const deg = Math.ceil(view.start / 15) * 15 + index * 15;
          return { deg, label: `${((deg % 360) + 360) % 360}°` };
        }).filter((entry) => inRange(entry.deg));

  const mark = (utc: string | null, text: string) => {
    if (!utc) return null;
    const point = path.points.find((entry) => entry.atUtc === utc);
    if (!point || point.altitudeDeg < -1) return null;
    const x = view.toX(point.azimuthDeg);
    const y = altitudeToY(Math.max(0, point.altitudeDeg));
    return (
      <g key={text}>
        <circle cx={x} cy={y} r={2.6} className="tk-chart-mark" />
        <text x={x} y={y - 9} textAnchor="middle" className="tk-chart-marklabel">
          {text}
        </text>
      </g>
    );
  };

  return (
    <figure className="tk-chart" data-tone={tone}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={
          path.kind === "radiant"
            ? `${label}: the radiant climbs from ${Math.round(path.points[0].altitudeDeg)} degrees to ${Math.round(peak.altitudeDeg)} degrees through the night.`
            : `${label} reaches ${Math.round(peak.altitudeDeg)} degrees above the horizon${
                path.culminationUtc ? ` at ${formatClockTime(path.culminationUtc, clock)}` : ""
              }.`
        }
      >
        {[30, 60].map((altitude) => (
          <g key={altitude}>
            <line
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={altitudeToY(altitude)}
              y2={altitudeToY(altitude)}
              className="tk-chart-guide"
            />
            <text x={WIDTH - PAD_X + 6} y={altitudeToY(altitude) + 4} className="tk-chart-guidelabel">
              {altitude}°
            </text>
          </g>
        ))}

        {/* The whole path, then the part worth being outside for over it. */}
        <path d={full} className="tk-chart-path" />
        <path d={lit} className="tk-chart-path-lit" />

        {path.kind === "target" ? (
          <>
            {mark(path.riseUtc, "rises")}
            {mark(path.culminationUtc, "highest")}
            {mark(path.setUtc, "sets")}
          </>
        ) : null}

        {/* The peak, always labelled, because "how high does it get" is the
            question the elevation guides exist to answer. */}
        <line
          x1={view.toX(peak.azimuthDeg)}
          x2={view.toX(peak.azimuthDeg)}
          y1={altitudeToY(peak.altitudeDeg)}
          y2={HORIZON_Y}
          className="tk-chart-drop"
        />
        <text
          x={view.toX(peak.azimuthDeg)}
          y={altitudeToY(peak.altitudeDeg) - 14}
          textAnchor="middle"
          className="tk-chart-peak"
        >
          {Math.round(peak.altitudeDeg)}°
        </text>

        <line x1={0} x2={WIDTH} y1={HORIZON_Y} y2={HORIZON_Y} className="tk-chart-horizon" />
        <rect x={0} y={HORIZON_Y} width={WIDTH} height={HEIGHT - HORIZON_Y} className="tk-chart-ground" />

        {ticks.map((entry) => (
          <g key={`${entry.label}-${entry.deg}`}>
            <line
              x1={view.toX(entry.deg)}
              x2={view.toX(entry.deg)}
              y1={HORIZON_Y}
              y2={HORIZON_Y + 5}
              className="tk-chart-tick"
            />
            <text
              x={view.toX(entry.deg)}
              y={HORIZON_Y + 20}
              textAnchor="middle"
              className="tk-chart-compass"
            >
              {entry.label}
            </text>
          </g>
        ))}
      </svg>

      <figcaption className="tk-chart-caption">
        {path.kind === "radiant" ? (
          <>
            <span className="tk-chart-key" /> Where the meteors come from, climbing through the
            night. Watch the sky around it, not the point itself.
          </>
        ) : (
          <>
            <span className="tk-chart-key" /> Its path from where you are. The bright section is
            the window worth going out for.
          </>
        )}
      </figcaption>
    </figure>
  );
}
