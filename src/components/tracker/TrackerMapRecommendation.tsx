import { ChevronRight, Compass, MoonStar } from "lucide-react";

import type { RailCard } from "../../data/tracker/observingRail";
import { CardFigure } from "./media/CardFigures";

interface Props {
  card: RailCard | null;
  loading: boolean;
  finderLabel: string;
  canFindInSky: boolean;
  onOpenDetail: () => void;
  onFindInSky: () => void;
  onOpenTonight: () => void;
}

/**
 * Map's one observing answer.
 *
 * This is intentionally not the observing rail with most of its children
 * hidden. Map needs one restrained decision surface while geography remains
 * dominant; Tonight owns comparison and planning. The card still reads the
 * exact same ranked `RailCard`, so changing presentation creates no second
 * recommendation authority.
 */
export function TrackerMapRecommendation({
  card,
  loading,
  finderLabel,
  canFindInSky,
  onOpenDetail,
  onFindInSky,
  onOpenTonight,
}: Props) {
  if (loading) {
    return (
      <aside className="tk-map-recommendation is-loading" aria-label="Loading tonight's recommendation">
        <span className="tk-map-skeleton is-title" />
        <span className="tk-map-skeleton is-line" />
      </aside>
    );
  }

  if (!card) {
    return (
      <aside className="tk-map-recommendation is-empty" data-card="map-no-recommendation">
        <span className="tk-map-recommendation-icon" aria-hidden><MoonStar size={18} /></span>
        <span className="tk-map-recommendation-copy">
          <span className="tk-map-recommendation-kicker">Tonight</span>
          <strong>No worthwhile target right now</strong>
          <span>See the nearest better observing window.</span>
        </span>
        <button type="button" onClick={onOpenTonight} aria-label="Plan the next observing window">
          <ChevronRight size={18} aria-hidden />
        </button>
      </aside>
    );
  }

  const [when, , where] = card.presentation.metrics;
  const quality = card.presentation.row.quality;
  return (
    <aside
      className="tk-map-recommendation"
      data-card={card.id}
      data-reason={card.reason}
      aria-label={`Best recommendation: ${card.presentation.title}`}
    >
      <span className="tk-map-recommendation-image" aria-hidden>
        <CardFigure media={card.media} />
      </span>
      <span className="tk-map-recommendation-copy">
        <span className="tk-map-recommendation-kicker">Best thing to see tonight</span>
        <strong>{card.presentation.shortTitle ?? card.presentation.title}</strong>
        <span>{when.value} · {where.value}</span>
      </span>
      {quality.tone !== "unknown" && !/^not known$/i.test(quality.value) ? (
        <span className="tk-map-recommendation-quality">{quality.value}</span>
      ) : null}
      <span className="tk-map-recommendation-actions">
        <button type="button" onClick={onOpenDetail}>Details</button>
        {canFindInSky ? (
          <button type="button" className="is-finder" onClick={onFindInSky}>
            <Compass size={14} aria-hidden /> {finderLabel}
          </button>
        ) : null}
      </span>
    </aside>
  );
}
