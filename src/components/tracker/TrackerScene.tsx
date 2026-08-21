import {
  EXPECTED_VIEW_MODE_LABEL,
  IMAGERY_CLASS_LABEL,
  MEDIA_CLAIM_LABEL,
  type HeroImagery,
} from "../../data/tracker/imagery";

/**
 * The picture that makes somebody want to go outside.
 *
 * Almost all of it is photography now — real pictures of the real sky, by named
 * photographers, under CC BY 4.0. Drawn scenes were the previous answer and
 * they were the wrong one: they were honest and they were flat, and a product
 * whose whole job is to get somebody out of the house cannot afford to look
 * like a diagram.
 *
 * Three treatments, because three kinds of picture behave differently in a
 * frame:
 *
 * - **photo** — a landscape under the sky. Fills the frame, cropped to cover,
 *   with a per-image vertical focus so the crop keeps the subject.
 * - **subject** — a planet on black. Must not be cropped, or Saturn loses its
 *   rings, so it floats on a dark ground with room around it.
 * - **moon** — the one composite. NASA's lunar mosaic with tonight's actual
 *   terminator drawn over it, because a stock photograph of a full Moon on a
 *   night the Moon is a crescent is a lie the reader can check by looking up.
 */

interface Props {
  imagery: HeroImagery;
  /** Illuminated fraction, for the Moon. */
  illuminatedFraction?: number;
  /** True where the lit limb is on the left, i.e. a waning Moon. */
  waning?: boolean;
  className?: string;
  /** Heroes load eagerly; cards below the fold do not. */
  priority?: boolean;
  /**
   * Render the credit inside the frame.
   *
   * It belongs to the picture, so it lives in the picture's box. Positioned
   * against the hero instead, it floated over the copy the moment the phone
   * layout stopped overlaying them.
   */
  showCredit?: boolean;
}

/**
 * The unlit part of the Moon, as an SVG path.
 *
 * Exported so the four cases can be asserted: the sweep flags are the whole of
 * the logic and inverting either one produces a Moon that is confidently the
 * wrong shape, which is exactly what shipped once — a four-day-old crescent
 * drawn as a gibbous under a caption reading "a waxing crescent".
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

export function TrackerScene({
  imagery,
  illuminatedFraction = 0.5,
  waning = false,
  className,
  priority = false,
  showCredit = false,
}: Props) {
  if (imagery.treatment === "moon") {
    return (
      <div className={`${className ?? ""} tracker-media tracker-media-subject`}>
        <svg
          viewBox="-50 -50 100 100"
          role="img"
          aria-label={`The Moon, ${Math.round(illuminatedFraction * 100)}% lit, at tonight's phase.`}
        >
          <defs>
            <clipPath id="tracker-moon-disc">
              <circle cx="0" cy="0" r="34" />
            </clipPath>
            <radialGradient id="tracker-moon-halo">
              <stop offset="0%" stopColor="#dfe9f7" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#dfe9f7" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="0" cy="0" r="49" fill="url(#tracker-moon-halo)" />
          <g clipPath="url(#tracker-moon-disc)">
            <image
              href="/moon/nasa-lroc-color-1k.jpg"
              x="-34"
              y="-34"
              width="68"
              height="68"
              preserveAspectRatio="xMidYMid slice"
            />
            {/* Drawn over the surface rather than cut out of it, so the unlit
                part keeps a trace of earthshine instead of going pure black. */}
            <path d={moonShadowPath(34, illuminatedFraction, waning)} fill="#070b12" opacity="0.93" />
          </g>
        </svg>
        {showCredit ? <TrackerMediaContext imagery={imagery} /> : null}
        {showCredit ? <TrackerCredit imagery={imagery} /> : null}
      </div>
    );
  }

  return (
    <div
      className={`${className ?? ""} tracker-media tracker-media-${imagery.treatment}`}
    >
      <img
        src={imagery.src ?? ""}
        alt={imagery.title}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        // Cover for a landscape, contain for an object that must stay whole.
        style={{
          objectFit: imagery.treatment === "subject" ? "contain" : "cover",
          objectPosition: `center ${imagery.focusY}`,
        }}
      />
      {showCredit ? <TrackerMediaContext imagery={imagery} /> : null}
      {showCredit ? <TrackerCredit imagery={imagery} /> : null}
    </div>
  );
}

function TrackerMediaContext({ imagery }: { imagery: HeroImagery }) {
  const origin =
    imagery.origin === "historical-capture" && imagery.capturedAt
      ? `Historical capture · ${imagery.capturedAt}`
      : imagery.origin === "current-model"
        ? "Current event model"
        : "Live feed";
  return (
    <p className="tracker-media-context">
      <span>{MEDIA_CLAIM_LABEL[imagery.claim]}</span>
      <span>{origin}</span>
      <span>{EXPECTED_VIEW_MODE_LABEL[imagery.expectedMode]}</span>
      <span>{IMAGERY_CLASS_LABEL[imagery.classification]}</span>
    </p>
  );
}

/**
 * The credit line.
 *
 * ESO and ESA/Hubble both licence under CC BY 4.0 on condition that the credit
 * is presented "clearly and visibly" and is not hidden or separated from the
 * image. So this sits on the picture. It is a licence term, not a design
 * preference, and moving it behind a disclosure control would break the terms
 * the imagery ships under.
 */
export function TrackerCredit({ imagery }: { imagery: HeroImagery }) {
  return (
    <p className="tracker-credit">
      <a href={imagery.sourceUrl} target="_blank" rel="noreferrer noopener">
        {imagery.title}
      </a>{" "}
      · {imagery.credit} · {imagery.licence}
    </p>
  );
}
