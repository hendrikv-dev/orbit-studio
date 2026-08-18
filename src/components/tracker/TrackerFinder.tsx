import { highestPoint, type SkyPath } from "../../data/tracker/skyPath";

/**
 * Where to face, and how high — as an instrument rather than a plot.
 *
 * The chart this replaces put a 13° arc in the corner of a large empty
 * rectangle with dashed guides and an axis, and asked the reader to decode a
 * graph in order to learn "south-west, low down". The area was mostly frame.
 *
 * This is built from the same real altitude/azimuth samples. What changed is
 * the question it answers: not "plot altitude against bearing" but "which way
 * do I turn, and how far up do I tilt my head". So it is a horizon with the
 * object on it — the compass runs along the bottom because that is the thing
 * you physically turn to, the height is read against a small elevation scale,
 * and the arc shows only the part of the path worth being outside for.
 *
 * Nothing is drawn that a reader cannot act on. There is no plotting frame, no
 * gridlines and no legend.
 */

const WIDTH = 560;
const HEIGHT = 180;
const HORIZON_Y = 138;
const PAD_X = 26;

const POINTS = [
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

interface Props {
  path: SkyPath;
  label: string;
}

export function TrackerFinder({ path, label }: Props) {
  const visible = path.points.filter((point) => point.altitudeDeg > 0);
  if (visible.length === 0) return null;

  const peak = highestPoint(path);

  // The dial spans a window around where the object actually is, wide enough
  // to place it against named directions but not so wide that a low object
  // becomes a smear at one end.
  const azimuths = visible.map((point) => point.azimuthDeg);
  const centre = azimuths.reduce((sum, value) => sum + value, 0) / azimuths.length;
  const halfSpan = 78;
  const toX = (deg: number) => {
    let delta = ((deg - centre + 540) % 360) - 180;
    delta = Math.max(-halfSpan, Math.min(halfSpan, delta));
    return WIDTH / 2 + (delta / halfSpan) * (WIDTH / 2 - PAD_X);
  };
  // Altitude is compressed above 60°, because the difference between 70° and
  // 80° does not change what a person does and the difference between 5° and
  // 15° very much does.
  const toY = (altitudeDeg: number) => {
    const clamped = Math.max(0, Math.min(90, altitudeDeg));
    const eased = Math.sqrt(clamped / 90);
    return HORIZON_Y - eased * (HORIZON_Y - 34);
  };

  const line = (points: typeof path.points) =>
    points.length === 0
      ? ""
      : `M ${points.map((p) => `${toX(p.azimuthDeg).toFixed(1)},${toY(p.altitudeDeg).toFixed(1)}`).join(" L ")}`;

  const lit = visible.filter(
    (point) =>
      (!path.windowStartUtc || point.atUtc >= path.windowStartUtc) &&
      (!path.windowEndUtc || point.atUtc <= path.windowEndUtc),
  );

  const near = POINTS.filter((point) => {
    const delta = Math.abs((((point.deg - centre + 540) % 360) - 180));
    return delta <= halfSpan - 6;
  });

  const peakX = toX(peak.azimuthDeg);
  const peakY = toY(peak.altitudeDeg);

  return (
    <figure className="tk-finder">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${label} is ${Math.round(peak.altitudeDeg)} degrees above the horizon at its best, towards the ${near.length ? near.reduce((closest, entry) => Math.abs(toX(entry.deg) - peakX) < Math.abs(toX(closest.deg) - peakX) ? entry : closest).label : "horizon"}.`}
      >
        {/* Elevation reference: two marks, not a grid. A fist at arm's length
            is about ten degrees, which is how people actually measure this. */}
        {[30, 60].map((altitude) => (
          <g key={altitude}>
            <line
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={toY(altitude)}
              y2={toY(altitude)}
              className="tk-finder-ref"
            />
            <text x={PAD_X - 4} y={toY(altitude) + 3} textAnchor="end" className="tk-finder-reflabel">
              {altitude}°
            </text>
          </g>
        ))}

        <path d={line(visible)} className="tk-finder-track" />
        <path d={line(lit)} className="tk-finder-track-lit" />

        {/* The object at its best, with its height called out where it sits. */}
        <line x1={peakX} x2={peakX} y1={peakY} y2={HORIZON_Y} className="tk-finder-drop" />
        <circle cx={peakX} cy={peakY} r={5} className="tk-finder-object" />
        <text x={peakX} y={peakY - 13} textAnchor="middle" className="tk-finder-alt">
          {Math.round(peak.altitudeDeg)}°
        </text>

        {/* The horizon is the ground line, and the compass sits on it, because
            the bearing is the thing you turn your body to. */}
        <line x1={0} x2={WIDTH} y1={HORIZON_Y} y2={HORIZON_Y} className="tk-finder-horizon" />
        {near.map((point) => (
          <text
            key={`${point.label}-${point.deg}`}
            x={toX(point.deg)}
            y={HORIZON_Y + 22}
            textAnchor="middle"
            className={
              Math.abs(toX(point.deg) - peakX) < 34
                ? "tk-finder-compass is-facing"
                : "tk-finder-compass"
            }
          >
            {point.label}
          </text>
        ))}
      </svg>
    </figure>
  );
}
