import type { ConjunctionPosition } from "../../../data/tracker/opportunity";

/**
 * A conjunction, drawn from the conjunction.
 *
 * ## Why this replaces a photograph
 *
 * Every conjunction used to show one stock image of the Moon beside Venus. For
 * "The Moon and Saturn" that is the wrong planet; for any date other than the
 * one it was taken on it is the wrong lunar phase; and the two bodies sat at
 * whatever separation they happened to have that evening rather than the one
 * being forecast. A "Representative example" badge was attached, which is a
 * disclosure and not a licence — a badge does not stop a picture contradicting
 * the event printed beside it.
 *
 * So the scene is computed. Both altitudes and azimuths come from the same
 * evaluation that produced the separation quoted in the copy, and the Moon is
 * drawn at the illumination it actually has at that instant.
 *
 * ## What is honest about it, and what is not
 *
 * Position, separation, orientation, phase and direction are real. Two things
 * are deliberately not to scale, because at true scale they would be invisible:
 * the discs, and nothing else. A 0.5° Moon rendered against a 40° field would
 * be four pixels across, so the bodies are drawn as symbols at a legible size
 * and the *distance between them* carries the geometry.
 *
 * That is why this is drawn as a diagram rather than as a rendering. A picture
 * that looks photographic makes an implicit claim about apparent size; a
 * labelled illustration with a stated separation does not. The visual language
 * is the disclosure.
 */

interface Props {
  positions: readonly [ConjunctionPosition, ConjunctionPosition];
  separationDeg: number;
  /** Real illumination at the instant, when the Moon is one of the pair. */
  moon: { illuminatedFraction: number; waning: boolean } | null;
  /** Compass direction to face, from the same guidance the copy quotes. */
  direction: string;
}

const WIDTH = 520;
const HEIGHT = 340;

/** Compass bearing to a cardinal-and-a-half label, for the horizon marks. */
function compassLabel(azimuthDeg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8];
}

/**
 * The lit limb of the Moon at a given illumination.
 *
 * Two arcs: the outer edge, and the terminator, which is an ellipse seen
 * edge-on and so has a horizontal semi-axis of `r·|1−2f|`. The sign of that
 * quantity is what flips the crescent from lit-on-one-side to lit-on-the-other
 * at half phase, which is why it is not an absolute value.
 */
function moonPath(radius: number, illuminatedFraction: number, waning: boolean): string {
  const fraction = Math.min(1, Math.max(0, illuminatedFraction));
  // Waxing lights the western limb, which faces the setting Sun — drawn right
  // here; waning lights the other. Getting this backwards draws a Moon that is
  // the mirror image of the real one, which is exactly the kind of quiet
  // wrongness this component exists to stop.
  const lightFromRight = !waning;
  const terminator = radius * (1 - 2 * fraction);
  const sweepOuter = lightFromRight ? 1 : 0;
  const sweepInner = terminator >= 0 ? sweepOuter : 1 - sweepOuter;
  return [
    `M 0 ${-radius}`,
    `A ${radius} ${radius} 0 0 ${sweepOuter} 0 ${radius}`,
    `A ${Math.abs(terminator)} ${radius} 0 0 ${sweepInner} 0 ${-radius}`,
    "Z",
  ].join(" ");
}

export function TrackerConjunctionScene({ positions, separationDeg, moon, direction }: Props) {
  const [a, b] = positions;

  // Sky-to-panel scale. The field is sized from the pair's own separation so a
  // 0.4° pairing and a 5° one both read clearly, with a floor so a very close
  // pair does not fill the panel with two enormous discs.
  const fieldDeg = Math.max(6, separationDeg * 3.4);
  const pixelsPerDeg = (HEIGHT * 0.52) / fieldDeg;

  // Azimuth difference has to be taken the short way round the compass, or a
  // pair straddling north lands on opposite sides of the drawing.
  const azimuthGap = (((b.azimuthDeg - a.azimuthDeg + 540) % 360) - 180);
  // Azimuth compresses towards the zenith by the cosine of altitude: two bodies
  // 2° apart in azimuth are less than 2° apart in the sky when they are high.
  const meanAltitude = ((a.altitudeDeg + b.altitudeDeg) / 2) * (Math.PI / 180);
  const dx = azimuthGap * Math.cos(meanAltitude) * pixelsPerDeg;
  const dy = -(b.altitudeDeg - a.altitudeDeg) * pixelsPerDeg;

  const centreX = WIDTH / 2 - dx / 2;
  const centreY = HEIGHT * 0.42 - dy / 2;
  const first = { x: centreX, y: centreY };
  const second = { x: centreX + dx, y: centreY + dy };

  const moonIsFirst = a.body === "the Moon";
  const moonIsSecond = b.body === "the Moon";
  const horizonY = HEIGHT - 46;
  // Where the horizon sits relative to the pair, so "low in the west" is
  // something the drawing shows rather than only says.
  const altitudeLabel = `${Math.round((a.altitudeDeg + b.altitudeDeg) / 2)}° up`;

  const bodySymbol = (position: ConjunctionPosition, at: { x: number; y: number }, isMoon: boolean) => {
    if (isMoon && moon) {
      const radius = 16;
      return (
        <g transform={`translate(${at.x} ${at.y})`}>
          {/* The unlit disc, faint — the Moon's night side is not invisible
              against a dark sky, and drawing only the crescent would imply it
              is. */}
          <circle r={radius} className="tk-conj-moon-dark" />
          <path d={moonPath(radius, moon.illuminatedFraction, moon.waning)} className="tk-conj-moon-lit" />
        </g>
      );
    }
    return (
      <g transform={`translate(${at.x} ${at.y})`}>
        <circle r={9} className="tk-conj-glow" />
        <circle r={3.2} className="tk-conj-body" />
      </g>
    );
  };

  return (
    <svg
      className="tk-conj"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={
        `${a.body} and ${b.body}, ${separationDeg.toFixed(1)} degrees apart, ` +
        `about ${Math.round((a.altitudeDeg + b.altitudeDeg) / 2)} degrees above the ${direction} horizon` +
        (moon
          ? `. The Moon is ${Math.round(moon.illuminatedFraction * 100)} per cent lit and ${moon.waning ? "waning" : "waxing"}.`
          : ".")
      }
    >
      <defs>
        <linearGradient id="tk-conj-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#070c1a" />
          <stop offset="72%" stopColor="#0d1730" />
          <stop offset="100%" stopColor="#1a2140" />
        </linearGradient>
      </defs>

      <rect width={WIDTH} height={HEIGHT} fill="url(#tk-conj-sky)" />

      {/* The horizon, and the direction to face. Both are the reader's
          orientation instructions, so they are part of the geometry rather
          than decoration. */}
      <line x1={0} y1={horizonY} x2={WIDTH} y2={horizonY} className="tk-conj-horizon" />
      <text x={WIDTH / 2} y={horizonY + 26} textAnchor="middle" className="tk-conj-compass">
        {direction.toUpperCase()} · {compassLabel(a.azimuthDeg)}
      </text>

      {/* The separation, drawn and stated. This is the number the event is
          about, so it is the annotation the drawing is built around. */}
      <line
        x1={first.x}
        y1={first.y}
        x2={second.x}
        y2={second.y}
        className="tk-conj-separation"
      />
      <text
        x={(first.x + second.x) / 2 + 14}
        y={(first.y + second.y) / 2 - 8}
        className="tk-conj-separation-label"
      >
        {separationDeg.toFixed(1)}°
      </text>

      {bodySymbol(a, first, moonIsFirst)}
      {bodySymbol(b, second, moonIsSecond)}

      <text x={first.x} y={first.y - 26} textAnchor="middle" className="tk-conj-name">
        {a.body === "the Moon" ? "Moon" : a.body}
      </text>
      <text x={second.x} y={second.y + 34} textAnchor="middle" className="tk-conj-name">
        {b.body === "the Moon" ? "Moon" : b.body}
      </text>

      <text x={16} y={HEIGHT - 14} className="tk-conj-note">
        {altitudeLabel} · discs enlarged for legibility
      </text>
    </svg>
  );
}
