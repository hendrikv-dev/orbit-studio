import type { GazeRegion } from "../../data/tracker/skyPath";

/**
 * Which way to face, as a picture rather than a sentence.
 *
 * "Keep the north-east in view" is a instruction a reader has to translate into
 * a direction while standing in the dark. This is the same instruction already
 * translated: a compass arc with the useful region shaded across it.
 *
 * The radiant is drawn on it, and drawn differently — outlined, small, labelled
 * as where the meteors come *from*. It has to be shown, because a reader who
 * knows the shower will look for it and its position is what governs the rate.
 * It must not be shown as a destination, because pointing your eyes at it is
 * the one thing that reliably makes a meteor watch worse.
 *
 * The geometry comes from GazeRegion, which is deliberately device-agnostic:
 * a bearing, a tolerance and an altitude. The same values would drive a phone
 * compass without this component being involved at all.
 */

const WIDTH = 300;
const HEIGHT = 168;
const CX = WIDTH / 2;
const CY = 132;
const R = 104;

/** Compass bearing to a point on the dial, with north at the top. */
function dial(azimuthDeg: number, radius: number) {
  // The dial shows the half of the horizon centred on the gaze direction, so
  // bearings are drawn relative to it rather than absolutely.
  const radians = ((azimuthDeg - 90) * Math.PI) / 180;
  return { x: CX + Math.cos(radians) * radius, y: CY + Math.sin(radians) * radius };
}

const POINTS = [
  { deg: 0, label: "N" },
  { deg: 45, label: "NE" },
  { deg: 90, label: "E" },
  { deg: 135, label: "SE" },
  { deg: 180, label: "S" },
  { deg: 225, label: "SW" },
  { deg: 270, label: "W" },
  { deg: 315, label: "NW" },
];

interface Props {
  gaze: GazeRegion;
  /** Where the radiant is, for showers. Omitted for anything else. */
  radiantAzimuthDeg?: number;
  radiantAltitudeDeg?: number;
}

export function TrackerOrientation({ gaze, radiantAzimuthDeg, radiantAltitudeDeg }: Props) {
  // Rotated so the recommended direction is at the top of the dial. A reader
  // holding this up is being shown "face this way", and putting the answer
  // anywhere but straight ahead makes them do the arithmetic.
  const rotate = (deg: number) => ((deg - gaze.centerAzimuthDeg + 540) % 360) - 180;

  const from = dial(rotate(gaze.centerAzimuthDeg - gaze.azimuthSpreadDeg), R);
  const to = dial(rotate(gaze.centerAzimuthDeg + gaze.azimuthSpreadDeg), R);
  const largeArc = gaze.azimuthSpreadDeg > 90 ? 1 : 0;
  const wedge = `M ${CX} ${CY} L ${from.x.toFixed(1)} ${from.y.toFixed(1)} A ${R} ${R} 0 ${largeArc} 1 ${to.x.toFixed(1)} ${to.y.toFixed(1)} Z`;

  const visiblePoints = POINTS.filter((point) => Math.abs(rotate(point.deg)) <= 96);

  return (
    <figure className="tk-orient">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Face ${Math.round(gaze.centerAzimuthDeg)} degrees, about ${Math.round(gaze.centerAltitudeDeg)} degrees up. ${gaze.reason}`}
      >
        {/* The region worth watching. Broad on purpose. */}
        <path d={wedge} className="tk-orient-wedge" />

        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          className="tk-orient-arc"
        />
        <line x1={CX - R} x2={CX + R} y1={CY} y2={CY} className="tk-chart-horizon" />

        {visiblePoints.map((point) => {
          const at = dial(rotate(point.deg), R + 13);
          return (
            <text
              key={point.label}
              x={at.x}
              y={at.y + 4}
              textAnchor="middle"
              className={
                Math.abs(rotate(point.deg)) < 12
                  ? "tk-orient-point is-facing"
                  : "tk-orient-point"
              }
            >
              {point.label}
            </text>
          );
        })}

        {/* Where to look: centre of the wedge, at the recommended altitude. */}
        {(() => {
          const at = dial(0, R * (1 - gaze.centerAltitudeDeg / 110));
          return (
            <g>
              <circle cx={at.x} cy={at.y} r={7} className="tk-orient-gaze" />
              <text x={at.x} y={at.y - 13} textAnchor="middle" className="tk-orient-gaze-label">
                {Math.round(gaze.centerAltitudeDeg)}° up
              </text>
            </g>
          );
        })()}

        {/* The radiant, if this is a shower. Outlined, not filled: it is a
            reference point, not a destination. */}
        {radiantAzimuthDeg !== undefined && radiantAltitudeDeg !== undefined
          ? (() => {
              const at = dial(
                rotate(radiantAzimuthDeg),
                R * (1 - Math.max(0, radiantAltitudeDeg) / 110),
              );
              return (
                <g>
                  <circle cx={at.x} cy={at.y} r={5} className="tk-orient-radiant" />
                  <text
                    x={at.x}
                    y={at.y - 11}
                    textAnchor="middle"
                    className="tk-orient-radiant-label"
                  >
                    radiant
                  </text>
                </g>
              );
            })()
          : null}
      </svg>
      <figcaption className="tk-orient-caption">{gaze.reason}</figcaption>
    </figure>
  );
}
