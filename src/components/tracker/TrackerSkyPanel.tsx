import { useMemo } from "react";

/**
 * The observing composition — Tracker's functional sky graphic.
 *
 * This is the piece that replaces the full-bleed photograph. A photograph of
 * somebody else's observatory says nothing about what a reader can see from
 * their own garden; this says exactly that, and it is the same drawing whether
 * it is showing an example or tonight's real arc.
 *
 * It is drawn as an instrument rather than an infographic. Everything on it is
 * a quantity an observer acts on:
 *
 * - the horizon, with the compass bearings they will actually face
 * - elevation guides at 30° and 60°, because "two fists up" needs a reference
 * - the object's arc across the night, so its rise and set are legible
 * - the observing window as a lit segment of that arc
 * - peak time, altitude and bearing, called out where the peak is
 *
 * Nothing decorative is added, and nothing is drawn that the reader cannot use.
 */

export interface SkyArc {
  /** Compass bearing where it rises, degrees from north. */
  riseAzimuthDeg: number;
  /** Bearing at its highest. */
  peakAzimuthDeg: number;
  setAzimuthDeg: number;
  /** Altitude at its highest, degrees. */
  peakAltitudeDeg: number;
  /** Fraction of the arc, 0–1, that the observing window covers. */
  windowStart: number;
  windowEnd: number;
  label: string;
  /** "1:20 AM" — already formatted in the place's own clock. */
  peakTime: string | null;
  /** Which phenomenon, for the accent colour. */
  tone: "meteor" | "planet" | "moon" | "neutral";
}

interface Props {
  arc: SkyArc;
  /**
   * True where this is a demonstration rather than tonight's sky. The label is
   * rendered, not implied: an example that looks like a measurement is the one
   * thing this panel must never be.
   */
  example?: boolean;
  className?: string;
}

const WIDTH = 320;
const HEIGHT = 132;
const HORIZON_Y = 104;
const SKY_TOP = 16;

/** Bearings the observer will actually be told to face. */
const COMPASS = [
  { deg: 45, label: "NE" },
  { deg: 90, label: "E" },
  { deg: 135, label: "SE" },
  { deg: 180, label: "S" },
  { deg: 225, label: "SW" },
  { deg: 270, label: "W" },
  { deg: 315, label: "NW" },
];

/** The panel shows the half of the sky from north-east round to north-west. */
function azimuthToX(azimuthDeg: number): number {
  const clamped = Math.min(325, Math.max(35, azimuthDeg));
  return 18 + ((clamped - 35) / 290) * (WIDTH - 36);
}

function altitudeToY(altitudeDeg: number): number {
  const clamped = Math.min(90, Math.max(0, altitudeDeg));
  return HORIZON_Y - (clamped / 90) * (HORIZON_Y - SKY_TOP);
}

/** A point on the arc, parameterised 0 (rise) to 1 (set). */
function arcPoint(arc: SkyArc, t: number): { x: number; y: number } {
  const azimuth =
    t <= 0.5
      ? arc.riseAzimuthDeg + (arc.peakAzimuthDeg - arc.riseAzimuthDeg) * (t / 0.5)
      : arc.peakAzimuthDeg + (arc.setAzimuthDeg - arc.peakAzimuthDeg) * ((t - 0.5) / 0.5);
  // A sine gives the shape a real diurnal arc has: steep near the horizon,
  // flattening through culmination.
  const altitude = arc.peakAltitudeDeg * Math.sin(Math.PI * t);
  return { x: azimuthToX(azimuth), y: altitudeToY(altitude) };
}

function pathThrough(arc: SkyArc, from: number, to: number): string {
  const steps = 32;
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const t = from + ((to - from) * index) / steps;
    const { x, y } = arcPoint(arc, t);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

export function TrackerSkyPanel({ arc, example = false, className }: Props) {
  const peak = useMemo(() => arcPoint(arc, 0.5), [arc]);
  const full = useMemo(() => pathThrough(arc, 0, 1), [arc]);
  const window = useMemo(() => pathThrough(arc, arc.windowStart, arc.windowEnd), [arc]);
  const bearing = COMPASS.reduce((closest, entry) =>
    Math.abs(entry.deg - arc.peakAzimuthDeg) < Math.abs(closest.deg - arc.peakAzimuthDeg)
      ? entry
      : closest,
  );

  return (
    <figure className={`tk-sky ${className ?? ""}`} data-tone={arc.tone}>
      {/* A real sky behind a real instrument. The photograph is a sky-only crop
          — no observatory, no telescope silhouette — because Tracker is about
          what the reader can see from where they stand. */}
      <div className="tk-sky-frame">
        <div className="tk-sky-plate" aria-hidden>
          {/* Eager, and high priority. This is the first thing on the entry
              screen; lazily loaded it arrived after the panel had already been
              painted flat, so the first look at the page had no photograph in
              it at all. */}
          <img
            src="/sky/eso-potw1033a-night-sky-detail.webp"
            alt=""
            decoding="async"
            fetchPriority="high"
          />
        </div>
        <p className="tk-sky-credit">
          <a
            href="https://www.eso.org/public/images/potw1033a/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Sky: ESO/S. Guisard
          </a>{" "}
          · CC BY 4.0
        </p>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={
            example
              ? "An example of how Tracker shows an object's path across the sky, with its horizon, compass bearings, elevation and best viewing window."
              : `${arc.label} rises in the ${bearing.label.toLowerCase()}, reaching ${Math.round(arc.peakAltitudeDeg)} degrees${arc.peakTime ? ` at ${arc.peakTime}` : ""}.`
          }
        >
          {/* Elevation guides. An observer is told "four fists up"; these are what
              that measures against. */}
          {[30, 60].map((altitude) => (
            <g key={altitude}>
              <line
                x1={18}
                x2={WIDTH - 18}
                y1={altitudeToY(altitude)}
                y2={altitudeToY(altitude)}
                className="tk-sky-guide"
              />
              <text x={WIDTH - 14} y={altitudeToY(altitude) + 3} className="tk-sky-guide-label">
                {altitude}°
              </text>
            </g>
          ))}

          <path d={full} className="tk-sky-arc" />
          <path d={window} className="tk-sky-arc-window" />

          {/* The peak, and the three numbers an observer needs at it. */}
          <line x1={peak.x} x2={peak.x} y1={peak.y} y2={HORIZON_Y} className="tk-sky-drop" />
          <circle cx={peak.x} cy={peak.y} r={3.4} className="tk-sky-peak" />
          <g transform={`translate(${Math.min(peak.x + 8, WIDTH - 96)} ${Math.max(peak.y - 8, 12)})`}>
            <text className="tk-sky-callout">
              {arc.peakTime ? `${arc.peakTime} · ` : ""}
              {Math.round(arc.peakAltitudeDeg)}° · {bearing.label}
            </text>
          </g>

          {/* Horizon, with a low ridge so the sky has ground beneath it. */}
          <path
            d={`M 0,${HORIZON_Y} L 46,${HORIZON_Y - 2} L 92,${HORIZON_Y + 1} L 148,${HORIZON_Y - 3} L 208,${HORIZON_Y} L 262,${HORIZON_Y - 2} L ${WIDTH},${HORIZON_Y + 1} L ${WIDTH},${HEIGHT} L 0,${HEIGHT} Z`}
            className="tk-sky-ground"
          />
          <line x1={0} x2={WIDTH} y1={HORIZON_Y} y2={HORIZON_Y} className="tk-sky-horizon" />

          {COMPASS.map((entry) => (
            <g key={entry.label}>
              <line
                x1={azimuthToX(entry.deg)}
                x2={azimuthToX(entry.deg)}
                y1={HORIZON_Y}
                y2={HORIZON_Y + 4}
                className="tk-sky-tick"
              />
              <text
                x={azimuthToX(entry.deg)}
                y={HORIZON_Y + 15}
                textAnchor="middle"
                className={
                  entry.label === bearing.label ? "tk-sky-compass is-active" : "tk-sky-compass"
                }
              >
                {entry.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <figcaption className="tk-sky-caption">
        {example ? (
          <>
            <span className="tk-tag">Example</span>
            Every recommendation is drawn like this: where it rises, how high it gets, which way to
            face, and the window worth going out for.
          </>
        ) : (
          <>
            <span className="tk-sky-caption-key">
              <span className="tk-sky-swatch" /> best window
            </span>
            Path across tonight&rsquo;s sky, from where you are.
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** A neutral arc for the entry state. Illustrative, and labelled as such. */
export const EXAMPLE_ARC: SkyArc = {
  riseAzimuthDeg: 58,
  peakAzimuthDeg: 168,
  setAzimuthDeg: 292,
  peakAltitudeDeg: 62,
  windowStart: 0.34,
  windowEnd: 0.78,
  label: "Example object",
  peakTime: null,
  tone: "neutral",
};
