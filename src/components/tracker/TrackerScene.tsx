import { useMemo } from "react";
import type { HeroImagery } from "../../data/tracker/imagery";

/**
 * The picture that makes someone want to go outside.
 *
 * Drawn rather than photographed, for a reason that is editorial as much as
 * practical: a photograph of a meteor shower is minutes of exposure stacked
 * together, and a photograph of Saturn is a telescope's view, not a person's.
 * Publishing either as the hero teaches the wrong expectation before a word of
 * guidance is read. A drawn scene can be beautiful and still be a scene rather
 * than a promise, and it says which it is.
 *
 * Two things are real rather than decorative: the Moon uses NASA's LROC mosaic
 * lit to tonight's actual phase, and the meteor radiant sits where the radiant
 * actually is. Everything else is composed for the feeling of the night.
 *
 * The scenes scale to any aspect: they are built from a full-bleed gradient, a
 * star field, and a horizon that sits at a fixed fraction of the height, so a
 * wide desktop hero and a tall phone hero are both intentional rather than one
 * being a crop of the other.
 */

interface Props {
  imagery: HeroImagery;
  /** Where to put the radiant or the target, as a compass bearing. */
  bearingDeg?: number | null;
  /** How high the target sits, 0–90, used to place it above the horizon. */
  altitudeDeg?: number | null;
  /** Illuminated fraction, for the Moon. */
  illuminatedFraction?: number;
  /** True where the lit limb is on the left, i.e. a waning Moon. */
  waning?: boolean;
  /** Rate per hour, which sets how busy the meteor scene looks. */
  intensity?: number;
  className?: string;
}

/** Deterministic pseudo-random, so the sky does not reshuffle on every render. */
function seeded(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

/**
 * The scene is composed for a wide frame, not a square one.
 *
 * It was drawn in a 100×100 viewBox first, which gave the `<svg>` an intrinsic
 * 1:1 aspect ratio — so at 1792px wide it claimed 1792px of height, pushed the
 * whole panel below the fold and blew every star up to the size of a coin. A
 * hero image is a wide thing; the coordinate system should say so.
 */
const SCENE_WIDTH = 160;
const SCENE_HEIGHT = 90;
const HORIZON_Y = 68;

function StarField({ seed, count }: { seed: number; count: number }) {
  const stars = useMemo(() => {
    const random = seeded(seed);
    return Array.from({ length: count }, () => {
      const y = random() * HORIZON_Y;
      return {
        x: random() * SCENE_WIDTH,
        y,
        // Fainter and smaller towards the horizon, the way atmosphere actually
        // works. Kept small: at hero scale a 0.5-unit star is a 5px disc, which
        // reads as a blob of paint rather than a star.
        r: (0.05 + random() * 0.17) * (0.55 + (1 - y / HORIZON_Y) * 0.6),
        o: 0.22 + random() * 0.72,
      };
    });
  }, [seed, count]);

  return (
    <g>
      {stars.map((star, index) => (
        <circle
          key={index}
          cx={star.x}
          cy={star.y}
          r={star.r}
          fill="#eaf3ff"
          opacity={star.o}
        />
      ))}
    </g>
  );
}

/** A ridge line, so the sky has somewhere to end and a sense of standing under it. */
function Horizon({ seed }: { seed: number }) {
  const path = useMemo(() => {
    const random = seeded(seed);
    const points: string[] = [`0,${HORIZON_Y + 4}`];
    for (let x = 0; x <= SCENE_WIDTH; x += 6) {
      const ridge = HORIZON_Y + 1.6 + Math.sin(x / 17 + seed) * 2.2 + random() * 1.6;
      points.push(`${x},${ridge.toFixed(2)}`);
    }
    points.push(`${SCENE_WIDTH},${SCENE_HEIGHT}`, `0,${SCENE_HEIGHT}`);
    return `M ${points.join(" L ")} Z`;
  }, [seed]);
  return <path d={path} fill="#04070c" />;
}

/**
 * Bearing to a horizontal position in the frame.
 *
 * Measured from south, because south is where most of what this app recommends
 * actually is from the northern hemisphere — and because a mapping centred on
 * north puts its discontinuity exactly at south, which sent Saturn off the
 * right-hand edge of the picture.
 *
 * The span is deliberately narrow, and narrower than looks right on a desktop.
 * The frame is cropped to cover, so a phone sees only the middle third of the
 * scene's width — a subject placed "accurately" towards the edge simply is not
 * there on a phone. This is a scene, not a sky chart: it has to put the subject
 * somewhere plausible and always in frame, and the second half of that matters
 * more.
 */
function bearingToX(bearingDeg: number): number {
  let fromSouth = (((bearingDeg - 180) % 360) + 360) % 360;
  if (fromSouth > 180) fromSouth -= 360;
  return SCENE_WIDTH / 2 - (fromSouth / 180) * (SCENE_WIDTH * 0.15);
}

function altitudeToY(altitudeDeg: number): number {
  return HORIZON_Y - (Math.min(85, Math.max(2, altitudeDeg)) / 90) * (HORIZON_Y - 8);
}

export function TrackerScene({
  imagery,
  bearingDeg,
  altitudeDeg,
  illuminatedFraction = 0.5,
  waning = false,
  intensity = 10,
  className,
}: Props) {
  const { scene } = imagery;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={sceneDescription(imagery, bearingDeg, altitudeDeg)}
    >
      <defs>
        <linearGradient id="tracker-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#050a14" />
          <stop offset="45%" stopColor="#0a1526" />
          <stop offset="78%" stopColor="#123048" />
          <stop offset="100%" stopColor="#1d4a62" />
        </linearGradient>
        <radialGradient id="tracker-glow" cx="50%" cy="100%" r="70%">
          <stop offset="0%" stopColor="#2f7d97" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#2f7d97" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="tracker-saturn" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#f6e4bd" />
          <stop offset="60%" stopColor="#d9bd85" />
          <stop offset="100%" stopColor="#8a6f45" />
        </radialGradient>
        <radialGradient id="tracker-jupiter" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#f7e9d6" />
          <stop offset="65%" stopColor="#d8b18b" />
          <stop offset="100%" stopColor="#8a6248" />
        </radialGradient>
        <radialGradient id="tracker-mars" cx="35%" cy="32%">
          <stop offset="0%" stopColor="#f0a06a" />
          <stop offset="60%" stopColor="#c9603a" />
          <stop offset="100%" stopColor="#6f2d1c" />
        </radialGradient>
        <radialGradient id="tracker-venus" cx="38%" cy="32%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f4ead2" />
          <stop offset="100%" stopColor="#bda884" />
        </radialGradient>
        <radialGradient id="tracker-point" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="35%" stopColor="#dceaff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#dceaff" stopOpacity="0" />
        </radialGradient>
        <clipPath id="tracker-moon-clip">
          <circle cx="0" cy="0" r="12" />
        </clipPath>
      </defs>

      <rect x="0" y="0" width={SCENE_WIDTH} height={SCENE_HEIGHT} fill="url(#tracker-sky)" />
      <rect x="0" y="0" width={SCENE_WIDTH} height={SCENE_HEIGHT} fill="url(#tracker-glow)" />
      <StarField seed={scene.length * 97 + 13} count={scene === "meteors" ? 210 : 160} />

      {scene === "meteors" ? (
        <MeteorScene bearingDeg={bearingDeg ?? 45} altitudeDeg={altitudeDeg ?? 50} intensity={intensity} />
      ) : null}
      {scene === "moon" || scene === "lunar-eclipse" ? (
        <MoonScene
          eclipsed={scene === "lunar-eclipse"}
          illuminatedFraction={illuminatedFraction}
          waning={waning}
          bearingDeg={bearingDeg ?? 180}
          altitudeDeg={altitudeDeg ?? 40}
        />
      ) : null}
      {scene.startsWith("planet-") ? (
        <PlanetScene scene={scene} bearingDeg={bearingDeg ?? 180} altitudeDeg={altitudeDeg ?? 40} />
      ) : null}
      {scene === "conjunction" ? (
        <ConjunctionScene bearingDeg={bearingDeg ?? 250} altitudeDeg={altitudeDeg ?? 30} />
      ) : null}

      <Horizon seed={scene.length + 3} />
    </svg>
  );
}

function MeteorScene({
  bearingDeg,
  altitudeDeg,
  intensity,
}: {
  bearingDeg: number;
  altitudeDeg: number;
  intensity: number;
}) {
  const radiantX = bearingToX(bearingDeg);
  const radiantY = altitudeToY(altitudeDeg);

  // More meteors for a better night, but capped: a sky full of streaks would be
  // a lie about even the Geminids at maximum.
  const count = Math.max(4, Math.min(11, Math.round(3 + Math.log10(1 + intensity) * 5)));

  const streaks = useMemo(() => {
    const random = seeded(Math.round(bearingDeg) * 31 + count);
    return Array.from({ length: count }, () => {
      const angle = random() * Math.PI * 2;
      // Meteors appear some way from the radiant; right at it they are dots.
      const near = 10 + random() * 34;
      const length = 8 + random() * 26;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const at = (distance: number) => ({
        x: radiantX + dx * distance,
        y: radiantY + dy * distance * 0.72,
      });
      const start = at(near);
      const end = at(near + length);
      // The bright head is the last third. A meteor is not a uniform scratch:
      // it brightens as it burns and stops, and drawing it as one flat line at
      // full width was the single thing making the sky look scribbled on.
      const headStart = at(near + length * 0.62);
      return {
        start,
        end,
        headStart,
        width: 0.08 + random() * 0.13,
        opacity: 0.3 + random() * 0.45,
      };
    });
  }, [radiantX, radiantY, count, bearingDeg]);

  return (
    <g>
      {/* No marker on the radiant. The converging streaks already say where it
          is, and a bloom over it read as a smudge of fog rather than a point on
          the sky. */}
      {streaks.map((streak, index) => (
        <g key={index}>
          <line
            x1={streak.start.x}
            y1={streak.start.y}
            x2={streak.end.x}
            y2={streak.end.y}
            stroke="#cfe2f7"
            strokeWidth={streak.width}
            strokeLinecap="round"
            opacity={streak.opacity * 0.45}
          />
          <line
            x1={streak.headStart.x}
            y1={streak.headStart.y}
            x2={streak.end.x}
            y2={streak.end.y}
            stroke="#ffffff"
            strokeWidth={streak.width * 1.5}
            strokeLinecap="round"
            opacity={streak.opacity}
          />
        </g>
      ))}
    </g>
  );
}

/**
 * The unlit part of the Moon, as an SVG path.
 *
 * Exported so the four cases can be asserted: the sweep flags are the whole of
 * the logic and inverting either one produces a Moon that is confidently the
 * wrong shape, which is exactly what shipped — a four-day-old crescent drawn as
 * a gibbous under a caption reading "waxing crescent".
 */
export function moonShadowPath(radius: number, illuminatedFraction: number, waning: boolean): string {
  const fraction = Math.min(1, Math.max(0, illuminatedFraction));
  const k = 1 - 2 * fraction;
  const terminatorRadius = radius * Math.abs(k);
  // Waxing means lit on the right, so the dark side is the left semicircle.
  const darkSideSweep = waning ? 1 : 0;
  // A crescent's terminator bulges towards the lit side; a gibbous away from it.
  const terminatorSweep = waning ? (k > 0 ? 1 : 0) : k > 0 ? 0 : 1;
  return (
    `M 0,${-radius} ` +
    `A ${radius},${radius} 0 0 ${darkSideSweep} 0,${radius} ` +
    `A ${terminatorRadius.toFixed(3)},${radius} 0 0 ${terminatorSweep} 0,${-radius} Z`
  );
}

/**
 * The Moon, using NASA's lunar mosaic and lit to tonight's real phase.
 *
 * The terminator is drawn as an ellipse whose width follows the illuminated
 * fraction, which is what a phase geometrically is — a sphere lit from the side,
 * seen from an angle. A crescent is the same ellipse the other way round, which
 * is why one path handles both instead of two cases that disagree at quarter.
 */
function MoonScene({
  eclipsed,
  illuminatedFraction,
  waning,
  bearingDeg,
  altitudeDeg,
}: {
  eclipsed: boolean;
  illuminatedFraction: number;
  waning: boolean;
  bearingDeg: number;
  altitudeDeg: number;
}) {
  const x = bearingToX(bearingDeg);
  const y = altitudeToY(altitudeDeg);
  const radius = 12;

  // The phase, built as the *dark* region: an outer semicircle on the unlit
  // side, closed by the terminator ellipse.
  //
  // `k` runs from +1 at new to −1 at full, and its magnitude is the terminator's
  // semi-minor axis. Its sign is what decides which way the terminator bulges,
  // and getting that backwards is how a four-day-old crescent came to be drawn
  // as a gibbous Moon under a caption reading "waxing crescent".
  //
  //   waxing  → lit on the right, so the dark side is the left semicircle
  //   crescent (f < 0.5) → terminator bulges towards the lit side
  //   gibbous  (f > 0.5) → terminator bulges away from it
  const fraction = Math.min(1, Math.max(0, illuminatedFraction));
  const shadowPath = moonShadowPath(radius, fraction, waning);

  return (
    <g transform={`translate(${x} ${y}) scale(${eclipsed ? 1.05 : 0.95})`}>
      <circle cx="0" cy="0" r={radius * 1.9} fill="url(#tracker-point)" opacity={eclipsed ? 0.18 : 0.4} />
      <g clipPath="url(#tracker-moon-clip)">
        <image
          href="/moon/nasa-lroc-color-1k.jpg"
          x={-radius}
          y={-radius}
          width={radius * 2}
          height={radius * 2}
          preserveAspectRatio="xMidYMid slice"
        />
        {eclipsed ? (
          <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} fill="#8c2f1b" opacity={0.62} />
        ) : null}
      </g>
      {/* The unlit part, drawn over the surface rather than cut out of it, so
          the earthshine of a thin crescent still shows through faintly. */}
      {!eclipsed && fraction < 0.985 ? (
        <path d={shadowPath} fill="#05080e" opacity={0.9} />
      ) : null}
      <circle cx="0" cy="0" r={radius} fill="none" stroke="#0b1119" strokeWidth="0.4" />
    </g>
  );
}

function PlanetScene({
  scene,
  bearingDeg,
  altitudeDeg,
}: {
  scene: string;
  bearingDeg: number;
  altitudeDeg: number;
}) {
  const x = bearingToX(bearingDeg);
  const y = altitudeToY(altitudeDeg);
  const radius = 9;

  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="0" cy="0" r={radius * 2.6} fill="url(#tracker-point)" opacity={0.34} />

      {scene === "planet-saturn" ? (
        <>
          {/* Rings behind, then the globe, then rings in front — the only way
              the ring plane reads as passing behind the planet. */}
          <ellipse cx="0" cy="0" rx={radius * 2.1} ry={radius * 0.52} fill="none" stroke="#e2cfa4" strokeWidth="2.1" opacity="0.75" transform="rotate(-16)" />
          <ellipse cx="0" cy="0" rx={radius * 1.62} ry={radius * 0.4} fill="none" stroke="#0a0f16" strokeWidth="0.7" opacity="0.9" transform="rotate(-16)" />
          <circle cx="0" cy="0" r={radius} fill="url(#tracker-saturn)" />
          <path d={`M ${-radius * 2.1} 0 A ${radius * 2.1} ${radius * 0.52} 0 0 0 ${radius * 2.1} 0`} fill="none" stroke="#e2cfa4" strokeWidth="2.1" opacity="0.85" transform="rotate(-16)" />
        </>
      ) : null}

      {scene === "planet-jupiter" ? (
        <>
          <circle cx="0" cy="0" r={radius} fill="url(#tracker-jupiter)" />
          <g clipPath="none" opacity="0.55">
            <ellipse cx="0" cy={-radius * 0.42} rx={radius * 0.93} ry={radius * 0.11} fill="#a97a58" />
            <ellipse cx="0" cy={-radius * 0.1} rx={radius * 0.99} ry={radius * 0.13} fill="#b98a63" />
            <ellipse cx="0" cy={radius * 0.28} rx={radius * 0.95} ry={radius * 0.1} fill="#a4714f" />
            <ellipse cx={radius * 0.34} cy={radius * 0.28} rx={radius * 0.22} ry={radius * 0.1} fill="#c4623f" />
          </g>
          {/* The Galilean moons, which is what binoculars actually add. */}
          {[-2.6, -1.9, 1.7, 2.5].map((offset) => (
            <circle key={offset} cx={radius * offset} cy={radius * 0.08 * offset} r="0.75" fill="#f2f7ff" />
          ))}
        </>
      ) : null}

      {scene === "planet-mars" ? (
        <>
          <circle cx="0" cy="0" r={radius * 0.82} fill="url(#tracker-mars)" />
          <ellipse cx={-radius * 0.16} cy={radius * 0.1} rx={radius * 0.36} ry={radius * 0.2} fill="#8a3d26" opacity="0.55" />
          <ellipse cx="0" cy={-radius * 0.62} rx={radius * 0.3} ry={radius * 0.14} fill="#f4f7ff" opacity="0.78" />
        </>
      ) : null}

      {scene === "planet-venus" ? (
        <>
          <circle cx="0" cy="0" r={radius * 4} fill="url(#tracker-point)" opacity="0.45" />
          <circle cx="0" cy="0" r={radius * 0.66} fill="url(#tracker-venus)" />
        </>
      ) : null}
    </g>
  );
}

function ConjunctionScene({ bearingDeg, altitudeDeg }: { bearingDeg: number; altitudeDeg: number }) {
  const x = bearingToX(bearingDeg);
  const y = altitudeToY(altitudeDeg);
  return (
    <g>
      <circle cx={x - 2.6} cy={y} r={8} fill="url(#tracker-point)" opacity={0.6} />
      <circle cx={x - 2.6} cy={y} r={1.2} fill="#ffffff" />
      <circle cx={x + 3} cy={y - 1.9} r={6} fill="url(#tracker-point)" opacity={0.5} />
      <circle cx={x + 3} cy={y - 1.9} r={0.95} fill="#fdf3dc" />
    </g>
  );
}

/**
 * The scene in words. It carries information — where to look, what is up —
 * so it is described rather than hidden from a screen reader.
 */
function sceneDescription(
  imagery: HeroImagery,
  bearingDeg?: number | null,
  altitudeDeg?: number | null,
): string {
  const where =
    bearingDeg != null && altitudeDeg != null
      ? ` It sits about ${Math.round(altitudeDeg)}° above the horizon.`
      : "";
  switch (imagery.scene) {
    case "meteors":
      return `An illustration of tonight's night sky with meteors streaking away from the shower's radiant.${where}`;
    case "moon":
      return `The Moon at tonight's phase, over a dark horizon.${where}`;
    case "lunar-eclipse":
      return `The Moon in Earth's shadow, deep copper red, over a dark horizon.${where}`;
    case "conjunction":
      return `Two bright points close together low in a twilit sky.${where}`;
    case "planet-saturn":
      return `An illustration of Saturn and its rings against the night sky.${where}`;
    case "planet-jupiter":
      return `An illustration of Jupiter with its cloud bands and four moons.${where}`;
    case "planet-mars":
      return `An illustration of Mars, orange with a bright polar cap.${where}`;
    case "planet-venus":
      return `An illustration of Venus, brilliant white against a twilit sky.${where}`;
    default:
      return "An illustration of a dark night sky above a low horizon.";
  }
}
