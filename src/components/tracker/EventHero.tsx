import type { ReactNode } from "react";
import type { EventPresentation } from "../../data/tracker/eventPresentation";
import { MEDIA_CLAIM_LABEL, type HeroImagery } from "../../data/tracker/imagery";
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
      /** What the drawing is claiming to be. Never "photograph". */
      claim: string;
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
}

export function EventHero({
  presentation,
  media,
  safety,
  expectation,
  onPrimary,
  onSecondary,
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

        <h1 className="tk-hero-name">{presentation.title}</h1>

        <div className="tk-hero-pills">
          {presentation.pills.map((pill) => (
            <span key={pill.label} className={`tk-pill is-${pill.tone}`}>
              {pill.tone === "live" ? <i className="tk-pill-dot" aria-hidden /> : null}
              {pill.label}
            </span>
          ))}
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

        {expectation ? <p className="tracker-expect">{expectation}</p> : null}

        <div className="tk-hero-actions">
          <button type="button" className="tk-action is-primary" onClick={onPrimary}>
            {presentation.primaryAction.label}
          </button>
          <button type="button" className="tk-action" onClick={onSecondary}>
            {presentation.secondaryAction.label}
          </button>
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
            <figcaption className="tk-hero-media-claim">
              {MEDIA_CLAIM_LABEL[media.imagery.claim]}
            </figcaption>
            <TrackerCredit imagery={media.imagery} />
          </>
        ) : (
          <>
            {media.node}
            <figcaption className="tk-hero-media-claim">{media.claim}</figcaption>
            {media.credit ? <p className="tracker-credit">{media.credit}</p> : null}
          </>
        )}
      </figure>
    </section>
  );
}
