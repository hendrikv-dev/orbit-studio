import { useId } from "react";

import type { CardMedia, MarkPhenomenon } from "../../../data/tracker/cardMedia";
import { moonShadowPath } from "../TrackerScene";

/**
 * The drawings a card falls back to when no photograph depicts the event.
 *
 * All of them are small — a rail card's slot is about forty pixels — so each is
 * built to survive at that size: two shapes at most, no labels, no gradients
 * that vanish. They are drawn from the event's own numbers wherever the event
 * has numbers, which is what separates them from decoration.
 */

const MOON_TEXTURE = "/moon/nasa-lroc-color-1k.jpg";

/** The Moon at a real phase, clipped to its disc. */
export function MoonFigure({
  illuminatedFraction,
  waning,
  radius = 34,
}: {
  illuminatedFraction: number;
  waning: boolean;
  radius?: number;
}) {
  const clip = useId();
  return (
    <svg className="tk-figure" viewBox="-40 -40 80 80" aria-hidden>
      <defs>
        <clipPath id={clip}>
          <circle cx="0" cy="0" r={radius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <image
          href={MOON_TEXTURE}
          x={-radius}
          y={-radius}
          width={radius * 2}
          height={radius * 2}
          preserveAspectRatio="xMidYMid slice"
        />
        <path d={moonShadowPath(radius, illuminatedFraction, waning)} fill="#070b12" opacity="0.93" />
      </g>
    </svg>
  );
}

/**
 * A close pairing, drawn as the two bodies it is actually between.
 *
 * The pair used to be illustrated with one photograph of the Moon beside Venus,
 * whatever the real bodies were, and later with nothing at all. This draws the
 * Moon at its real phase where the Moon is involved, the companion as a disc
 * scaled to how much fainter it is, and the gap between them widened from the
 * true separation — a 2° pairing is two touching pixels at this size, so the
 * separation is legible rather than to scale, which the caption says.
 */
export function PairFigure({ media }: { media: Extract<CardMedia, { kind: "pair" }> }) {
  const clip = useId();
  const { moon, bodies } = media;
  const companion = bodies.find((body) => body.toLowerCase() !== "moon") ?? bodies[1];
  const tint = companionTint(companion);
  const gap = 21;

  return (
    <svg className="tk-figure" viewBox="-40 -40 80 80" aria-hidden>
      <defs>
        <clipPath id={clip}>
          <circle cx={-gap * 0.45} cy="4" r="21" />
        </clipPath>
        <radialGradient id={`${clip}-glow`}>
          <stop offset="0%" stopColor={tint} stopOpacity="0.85" />
          <stop offset="100%" stopColor={tint} stopOpacity="0" />
        </radialGradient>
      </defs>

      {moon ? (
        <g clipPath={`url(#${clip})`}>
          <image
            href={MOON_TEXTURE}
            x={-gap * 0.45 - 21}
            y={4 - 21}
            width={42}
            height={42}
            preserveAspectRatio="xMidYMid slice"
          />
          <g transform={`translate(${-gap * 0.45}, 4)`}>
            <path
              d={moonShadowPath(21, moon.illuminatedFraction, moon.waning)}
              fill="#070b12"
              opacity="0.93"
            />
          </g>
        </g>
      ) : (
        <circle cx={-gap * 0.45} cy="4" r="9" fill="#cfd8ea" />
      )}

      {/* The companion: a glow and a small hard disc, which is what a bright
          planet looks like to the eye beside the Moon. */}
      <circle cx={gap * 0.72} cy={-11} r="15" fill={`url(#${clip}-glow)`} />
      <circle cx={gap * 0.72} cy={-11} r="4.2" fill={tint} />
    </svg>
  );
}

/** Rough colour of the companion, so Saturn and Mars do not look identical. */
function companionTint(body: string): string {
  const name = body.toLowerCase();
  if (name.includes("mars")) return "#e08159";
  if (name.includes("saturn")) return "#e8cf9a";
  if (name.includes("jupiter")) return "#efd9b4";
  if (name.includes("venus")) return "#f4f1e4";
  if (name.includes("mercury")) return "#cbc6bd";
  return "#dfe7f5";
}

/**
 * A solar eclipse at the coverage the reader's own position actually gets.
 *
 * The Moon's disc is offset so the uncovered crescent matches the obscuration,
 * which makes the card's picture and the card's percentage the same statement.
 * Annularity is drawn as a concentric ring because that is precisely what
 * distinguishes it from totality, and the difference is the whole reason the
 * two have different names.
 */
export function EclipseFigure({ media }: { media: Extract<CardMedia, { kind: "eclipse" }> }) {
  const sun = 22;
  const covered = Math.max(0, Math.min(1, media.obscuration));
  // Annular: the Moon is smaller than the Sun and centred, leaving a ring.
  const annular = media.variant === "annular";
  const moonRadius = annular ? sun * 0.88 : sun;
  // For a partial eclipse the discs are offset; a total one is concentric.
  const offset =
    media.variant === "total" || annular ? 0 : sun * 2 * (1 - covered) * 0.85;

  return (
    <svg className="tk-figure" viewBox="-40 -40 80 80" aria-hidden>
      <defs>
        <radialGradient id="tk-eclipse-corona">
          <stop offset="55%" stopColor="#ffd79a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffd79a" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* The corona only shows when the disc is actually covered. */}
      {media.variant === "total" ? (
        <circle cx="0" cy="0" r="36" fill="url(#tk-eclipse-corona)" />
      ) : null}
      <circle cx="0" cy="0" r={sun} fill="#f7c667" />
      <circle cx={offset} cy={-offset * 0.35} r={moonRadius} fill="#0a0e17" />
    </svg>
  );
}

/**
 * The mark for a class Tracker has no photograph and no geometry for.
 *
 * Deliberately a symbol rather than a picture: it is better for a card to say
 * "a deep-sky object" in shorthand than to show a photograph of a different
 * object, which is what the generic star field did.
 *
 * The deep-sky variant is now a fallback rather than the normal case. Every
 * showpiece Tracker offers has a photograph of that object, checked against the
 * archive's own record of what the picture shows, and `cardMediaFor` reaches
 * for it first — so a card only falls back to the oval when something has gone
 * wrong, which is a state worth being able to see rather than one to disguise.
 */
export function MarkFigure({ phenomenon }: { phenomenon: MarkPhenomenon }) {
  return (
    <svg className="tk-figure is-mark" viewBox="-40 -40 80 80" aria-hidden>
      {phenomenon === "deep-sky" ? (
        <>
          <ellipse cx="0" cy="0" rx="26" ry="12" fill="none" stroke="#8ea3c8" strokeWidth="2.4" />
          <circle cx="0" cy="0" r="5" fill="#cfe0f7" />
        </>
      ) : (
        <>
          <circle cx="-12" cy="-8" r="2.6" fill="#cfe0f7" />
          <circle cx="9" cy="-14" r="1.8" fill="#9fb6d8" />
          <circle cx="14" cy="7" r="3" fill="#cfe0f7" />
          <circle cx="-6" cy="13" r="1.8" fill="#9fb6d8" />
          <circle cx="1" cy="-1" r="1.4" fill="#7f93b3" />
        </>
      )}
    </svg>
  );
}

/** One entry point, so no surface has to know the union. */
export function CardFigure({ media }: { media: CardMedia }) {
  switch (media.kind) {
    case "photo":
      return <img className="tk-figure" src={media.src} alt="" />;
    case "moon":
      return <MoonFigure illuminatedFraction={media.illuminatedFraction} waning={media.waning} />;
    case "pair":
      return <PairFigure media={media} />;
    case "eclipse":
      return <EclipseFigure media={media} />;
    case "mark":
      return <MarkFigure phenomenon={media.phenomenon} />;
  }
}
