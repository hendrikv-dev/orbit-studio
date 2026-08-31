import type { ReactNode } from "react";
import type { EventPresentation } from "../../data/tracker/eventPresentation";
import type { HeroImagery } from "../../data/tracker/imagery";
import { TrackerScene, TrackerCredit } from "./TrackerScene";

/**
 * The hero card. One shape, every phenomenon.
 *
 * Its structure is fixed by the specification and enforced by the
 * `EventPresentation` type rather than by convention: a name, one or two state
 * pills, the recommendation, an optional supporting line, exactly three
 * metrics, and two actions along the bottom. A phenomenon cannot add a panel
 * here, because there is nowhere to add one.
 *
 * That rigidity is the feature. The previous Tracker hero grew a safety line, a
 * verdict, an eyebrow, a summary, a four-item fact list, a directions line, a
 * conclusion, an expectation, a science disclosure and a media note, in that
 * order, and every one of them was individually defensible. Together they were
 * a wall of text where a decision should have been.
 *
 * ## The one line that survived the cut
 *
 * `expectation` — what your eyes will actually do, as opposed to what the
 * photograph did. It stays because it is the difference between a product that
 * sets somebody up for Saturn and one that sets them up for disappointment, and
 * because it has to be read *before* the reminder rather than after it. Every
 * other paragraph the old hero carried is gone.
 *
 * ## The picture
 *
 * Representative photography, labelled as such on the image itself. Credits sit
 * on the image because the CC BY terms these are used under require it, not as
 * a stylistic choice.
 */

export type HeroMedia =
  | {
      kind: "imagery";
      imagery: HeroImagery;
      illuminatedFraction?: number;
      waning?: boolean;
    }
  | {
      kind: "drawn";
      node: ReactNode;
      /**
       * The note under the drawing.
       *
       * This is the place for anything that stops the picture misleading —
       * chiefly that discs are enlarged while separations are to scale. It is
       * not the place for what kind of asset this is: "Computed for this event"
       * described Tracker's internals, not the sky.
       */
      credit: string | null;
    };

interface Props {
  presentation: EventPresentation;
  media: HeroMedia;
  /** Rendered above everything, unsuppressed, where the phenomenon sets it. */
  safety: string | null;
  /** How the eye differs from the picture, where the two differ. */
  expectation: string | null;
  onPrimary: () => void;
  onSecondary: () => void;
  /**
   * A third control, where the event has two genuinely different tools.
   *
   * An eclipse is the case that forced this. "View visibility map" answers
   * *where on Earth*, and the altitude-and-bearing chart answers *where in the
   * sky* — one control cannot be both, and making it try is how a button
   * labelled "View visibility map" came to open a sky chart.
   */
  tertiary?: { label: string; onSelect: () => void } | null;
}

export function EventHero({
  presentation,
  media,
  safety,
  expectation,
  onPrimary,
  onSecondary,
  tertiary = null,
}: Props) {
  return (
    <section
      className="tk-hero tracker-hero"
      aria-label="The recommendation"
      data-recommendation={presentation.recommendationLevel}
    >
      <div className="tk-hero-body">
        {/* Solar viewing safety is mandatory and unsuppressable, and it renders
            before anything else on the card. Reserved position, so a phenomenon
            that sets it cannot have it end up below the fold. */}
        {safety ? (
          <p className="tracker-safety" role="alert">
            {safety}
          </p>
        ) : null}

        {/* An h2, not an h1.
        
            The page already has one: the category heading above. Two
            document-level headings on one page is not a styling question — it
            leaves a screen-reader user with no single answer to "what is this
            page", and both were competing for it because both are visually
            large. The category names the page; the event is a section of it.
            Nothing about the appearance changes. */}
        {/* Name and state on one line.
        
            They were stacked, which spent a whole row on two or three short
            words and pushed everything below it down by about thirty pixels —
            paid on every page, to no benefit, since the pills are short by
            construction. */}
        <div className="tk-hero-head">
          <h2 className="tk-hero-name">{presentation.title}</h2>
          <div className="tk-hero-pills">
            {presentation.pills.map((pill) => (
              <span key={pill.label} className={`tk-pill is-${pill.tone}`}>
                {pill.tone === "live" ? <i className="tk-pill-dot" aria-hidden /> : null}
                {pill.label}
              </span>
            ))}
          </div>
        </div>

        <p className="tk-hero-recommendation">{presentation.recommendation}</p>
        {presentation.support ? (
          <p className="tk-hero-support">{presentation.support}</p>
        ) : null}

        <dl className="tk-hero-metrics">
          {presentation.metrics.map((metric) => (
            <div key={metric.label} className="tk-metric">
              <dt>{metric.label}</dt>
              <dd className={`tk-metric-value is-${metric.tone}`}>{metric.value}</dd>
            </div>
          ))}
        </dl>

        {/* What your eyes will actually see.
        
            Briefly moved behind a disclosure to buy back seventy-five pixels
            for the one-screen contract, and moved back: this is the correction
            to an image that would otherwise mislead — "this is Hubble; to your
            eyes Saturn is a steady yellow point" — and a correction that is
            closed by default is a correction most readers never see. The
            accessibility gate caught it, which is the right place for it to
            have been caught.
        
            The pixels came from the list's thumbnails instead, which carry no
            information the row's name does not. */}
        {expectation ? <p className="tracker-expect">{expectation}</p> : null}

        <div className="tk-hero-actions">
          <button type="button" className="tk-action is-primary" onClick={onPrimary}>
            {presentation.primaryAction.label}
          </button>
          <button type="button" className="tk-action" onClick={onSecondary}>
            {presentation.secondaryAction.label}
          </button>
          {tertiary ? (
            <button type="button" className="tk-action" onClick={tertiary.onSelect}>
              {tertiary.label}
            </button>
          ) : null}
        </div>
      </div>

      <figure className="tk-hero-media">
        {media.kind === "imagery" ? (
          <>
            <TrackerScene
              imagery={media.imagery}
              className="tk-hero-scene"
              priority
              illuminatedFraction={media.illuminatedFraction}
              waning={media.waning}
            />
            {/* No claim badge. "Representative example" told the reader which
                bucket the asset came from, which is a fact about how Tracker is
                built rather than about the night. What the image is *of*, and
                who made it, stay — those are attribution and they are real. */}
            <TrackerCredit imagery={media.imagery} />
          </>
        ) : (
          <>
            {media.node}
            {media.credit ? <p className="tracker-credit">{media.credit}</p> : null}
          </>
        )}
      </figure>
    </section>
  );
}
