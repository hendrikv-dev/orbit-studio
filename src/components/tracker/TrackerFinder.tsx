import { describeAltitude, describeDirection, highestPoint, type SkyPath } from "../../data/tracker/skyPath";

/**
 * Where to turn and how far up to tilt your head.
 *
 * The version this replaces was still a plot: 30/60-degree gridlines, an
 * altitude axis, a curve through the data and a numeric point on it. The
 * geometry was real and the presentation was a chart, so a reader had to
 * interpret it before they could act on it — which is exactly what the words
 * beside it had stopped asking them to do.
 *
 * This says the same thing the sentence says. A horizon you can see, the
 * direction to face written large on it, and the target sitting at a believable
 * height in an open field of sky. There is no grid, no axis, no plotted path
 * and no data point. The degrees are still there, small, underneath — precision
 * for anyone who wants it and ignorable for everyone who does not.
 *
 * The real altitude and azimuth still drive every position. Only the drawing
 * changed.
 */

const WIDTH = 560;
const HEIGHT = 210;
const HORIZON_Y = 150;


interface Props {
  path: SkyPath;
  label: string;
}

export function TrackerFinder({ path, label }: Props) {
  const visible = path.points.filter((point) => point.altitudeDeg > 0);
  if (visible.length === 0) return null;

  const peak = highestPoint(path);
  const facing = describeDirection(peak.azimuthDeg, peak.altitudeDeg);
  const height = describeAltitude(peak.altitudeDeg);

  // Height in the field, eased so the low end has room. The difference between
  // 5 and 15 degrees changes what a person does — over a rooftop or behind it —
  // while 70 and 80 do not, so the scale spends its space where the decision is.
  const eased = Math.sqrt(Math.max(0, Math.min(90, peak.altitudeDeg)) / 90);
  const y = HORIZON_Y - eased * (HORIZON_Y - 46);

  return (
    <figure className="tk-finder">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${facing}. ${height}. ${label} reaches ${Math.round(peak.altitudeDeg)} degrees.`}
      >
        {/* A band of sky, darkening towards the horizon the way it actually
            does. It is the field the target sits in, not a plotting area. */}
        <defs>
          <linearGradient id="tk-finder-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(126, 166, 207, 0.13)" />
            <stop offset="100%" stopColor="rgba(126, 166, 207, 0.02)" />
          </linearGradient>
        </defs>
        <rect x={0} y={10} width={WIDTH} height={HORIZON_Y - 10} fill="url(#tk-finder-sky)" rx={10} />

        {/* The target. One mark, at a believable height, with a soft halo so it
            reads as a thing in the sky rather than a plotted point. */}
        <circle cx={WIDTH / 2} cy={y} r={17} className="tk-finder-halo" />
        <circle cx={WIDTH / 2} cy={y} r={5.5} className="tk-finder-object" />

        {/* Ground, and the direction to face written on it. */}
        <rect x={0} y={HORIZON_Y} width={WIDTH} height={HEIGHT - HORIZON_Y} className="tk-finder-ground" rx={4} />
        <line x1={0} x2={WIDTH} y1={HORIZON_Y} y2={HORIZON_Y} className="tk-finder-horizon" />
        <text x={WIDTH / 2} y={HORIZON_Y + 30} textAnchor="middle" className="tk-finder-facing">
          {facing}
        </text>
      </svg>

      <figcaption className="tk-finder-caption">
        {height}
        <span className="tk-finder-precise">{Math.round(peak.altitudeDeg)}° above the horizon</span>
      </figcaption>
    </figure>
  );
}
