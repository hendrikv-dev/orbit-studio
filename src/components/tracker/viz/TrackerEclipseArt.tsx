/**
 * The eclipse hero image: this eclipse, from this place, at maximum.
 *
 * The photograph library has one eclipse in it and it is a *lunar* eclipse.
 * Putting that on a solar eclipse card would be a picture of the wrong
 * phenomenon — the single most misleading thing an interface about eclipses
 * could do, and not fixable by a caption.
 *
 * So this is drawn from the same obscuration the map and the metrics are drawn
 * from. A 68% partial shows a Sun with 68% of its disc covered; totality shows
 * a black disc with a corona. It is labelled as a visualisation rather than a
 * photograph, and unlike a stock image it cannot be wrong about the event it
 * illustrates — which is the whole point of drawing it.
 *
 * ## Why the geometry is approximated here and nowhere else
 *
 * The Moon's disc is placed at the separation that produces the stated
 * obscuration, along an arbitrary bearing. The real position angle is
 * computable and is deliberately not used: at this size it would change which
 * side the bite is on and nothing else, and implying that level of fidelity in
 * a decorative frame invites reading the picture as an observing aid. The
 * number under it is the claim; the drawing illustrates it.
 */

const SUN_RADIUS = 58;

/**
 * Centre separation that hides a given fraction of the Sun.
 *
 * Inverted numerically rather than algebraically: the circle-intersection area
 * has no closed-form inverse, and a bisection over a monotone function is both
 * shorter and obviously correct.
 */
function separationFor(fraction: number, moonRadius: number): number {
  const overlap = (distance: number) => {
    if (distance >= SUN_RADIUS + moonRadius) return 0;
    if (distance <= Math.abs(moonRadius - SUN_RADIUS)) {
      return moonRadius >= SUN_RADIUS ? 1 : (moonRadius * moonRadius) / (SUN_RADIUS * SUN_RADIUS);
    }
    const a1 = Math.acos(
      (distance * distance + SUN_RADIUS * SUN_RADIUS - moonRadius * moonRadius) /
        (2 * distance * SUN_RADIUS),
    );
    const a2 = Math.acos(
      (distance * distance + moonRadius * moonRadius - SUN_RADIUS * SUN_RADIUS) /
        (2 * distance * moonRadius),
    );
    return (
      (SUN_RADIUS * SUN_RADIUS * (a1 - Math.sin(2 * a1) / 2) +
        moonRadius * moonRadius * (a2 - Math.sin(2 * a2) / 2)) /
      (Math.PI * SUN_RADIUS * SUN_RADIUS)
    );
  };

  let low = 0;
  let high = SUN_RADIUS + moonRadius;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (overlap(middle) > fraction) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function TrackerEclipseArt({
  obscurationFraction,
  kind,
}: {
  obscurationFraction: number;
  /** Total and annular are drawn from the geometry, not from the fraction. */
  kind: "total" | "annular" | "partial" | "none";
}) {
  // The Moon is slightly larger than the Sun at a total eclipse and slightly
  // smaller at an annular one, which is the entire difference between the two.
  const moonRadius = kind === "total" ? SUN_RADIUS * 1.03 : kind === "annular" ? SUN_RADIUS * 0.93 : SUN_RADIUS * 0.99;
  const separation =
    kind === "total" || kind === "annular" ? 0 : separationFor(obscurationFraction, moonRadius);
  // Up and to the left, which is where a northern-hemisphere morning eclipse
  // tends to start. Fixed rather than random, so the drawing is stable.
  const offsetX = -separation * 0.72;
  const offsetY = -separation * 0.69;

  return (
    <div className="tracker-media tracker-media-photo tk-eclipse-art">
      <svg
        viewBox="0 0 480 270"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={
          kind === "total"
            ? "A drawing of a total solar eclipse: the Sun completely covered, with the corona around it."
            : kind === "annular"
              ? "A drawing of an annular solar eclipse: a ring of Sun around the Moon."
              : `A drawing of the Sun with ${Math.round(obscurationFraction * 100)}% of its disc covered by the Moon, as it will be from here at maximum.`
        }
      >
        <defs>
          <radialGradient id="tk-eclipse-sky">
            <stop offset="0%" stopColor="#1a2440" />
            <stop offset="100%" stopColor="#070b16" />
          </radialGradient>
          <radialGradient id="tk-eclipse-corona">
            <stop offset="52%" stopColor="#e8f0ff" stopOpacity="0.85" />
            <stop offset="72%" stopColor="#cdd9f5" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#cdd9f5" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="tk-eclipse-glow">
            <stop offset="45%" stopColor="#ffdf9e" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffdf9e" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width="480" height="270" fill="url(#tk-eclipse-sky)" />

        <g transform="translate(240 135)">
          {kind === "total" ? (
            <circle cx="0" cy="0" r={SUN_RADIUS * 2.4} fill="url(#tk-eclipse-corona)" />
          ) : (
            <circle cx="0" cy="0" r={SUN_RADIUS * 1.9} fill="url(#tk-eclipse-glow)" />
          )}
          <circle cx="0" cy="0" r={SUN_RADIUS} fill="#ffcf6d" />
          {/* The Moon is opaque and the same colour as the sky, because that is
              what it looks like: a hole, not a grey disc. */}
          <circle cx={offsetX} cy={offsetY} r={moonRadius} fill="#0a0f1c" />
        </g>
      </svg>
    </div>
  );
}
