import type { ReactNode, RefObject } from "react";
import { CalendarDays, CalendarRange, ChevronRight, Compass } from "lucide-react";

import type { RailCard } from "../../data/tracker/observingRail";
import type { EquipmentRule } from "../../data/tracker/observingRules";
import { CardFigure } from "./media/CardFigures";
import type { RailFacts } from "./map/TrackerObservingRail";

interface Props {
  cards: RailCard[];
  place: string;
  dateLabel: string;
  onOpenDetail: (id: string) => void;
  onFindInSky: (id: string) => void;
  finderLabel: string;
  canFindInSky: (card: RailCard) => boolean;
  factsFor: (card: RailCard) => RailFacts;
  equipment: EquipmentRule;
  recovery: ReactNode;
  loading: boolean;
  upcoming: { onOpen: () => void; triggerRef?: RefObject<HTMLButtonElement> };
}

function equipmentContext(card: RailCard, configured: EquipmentRule): string {
  const needed = card.opportunity.guidance.equipment;
  if (needed === "telescope") return "Telescope recommended";
  if (needed === "binoculars") return "Binoculars recommended";
  if (configured === "telescope") return "Easy to find · telescope adds detail";
  if (configured === "binoculars") return "Easy to find · binoculars add detail";
  return "Naked eye";
}

function TonightRow({
  card,
  rank,
  configured,
  finderLabel,
  canFindInSky,
  onOpenDetail,
  onFindInSky,
}: {
  card: RailCard;
  rank: number;
  configured: EquipmentRule;
  finderLabel: string;
  canFindInSky: boolean;
  onOpenDetail: () => void;
  onFindInSky: () => void;
}) {
  const [when, , where] = card.presentation.metrics;
  return (
    <li className="tk-tonight-row" data-card={card.id} data-reason={card.reason}>
      <span className="tk-tonight-rank" aria-label={`Rank ${rank}`}>{rank}</span>
      <span className="tk-tonight-row-image" aria-hidden><CardFigure media={card.media} /></span>
      <button type="button" className="tk-tonight-row-main" onClick={onOpenDetail}>
        <strong>{card.presentation.shortTitle ?? card.presentation.title}</strong>
        <span>{when.value}</span>
        <span>{where.value} · {equipmentContext(card, configured)}</span>
      </button>
      <span className="tk-tonight-quality" data-tone={card.presentation.row.quality.tone}>
        {card.presentation.row.quality.value}
      </span>
      {canFindInSky ? (
        <button
          type="button"
          className="tk-tonight-row-finder"
          onClick={onFindInSky}
          aria-label={`${finderLabel}: ${card.presentation.title}`}
        >
          <Compass size={16} aria-hidden />
        </button>
      ) : (
        <ChevronRight size={16} aria-hidden className="tk-tonight-row-chevron" />
      )}
    </li>
  );
}

/**
 * A nightly briefing composed from the production ranking.
 *
 * This is not a rail moved into a tab. It gives the strongest answer its own
 * hierarchy, then renders the remaining ranked opportunities as a short
 * comparison list and planning as a distinct next step. Every value still
 * comes from `RailCard`/recovery/Upcoming, so only presentation changed.
 */
export function TrackerTonightBriefing({
  cards,
  place,
  dateLabel,
  onOpenDetail,
  onFindInSky,
  finderLabel,
  canFindInSky,
  factsFor,
  equipment,
  recovery,
  loading,
  upcoming,
}: Props) {
  const strongest = cards[0] ?? null;
  const leadFacts = strongest ? factsFor(strongest) : null;
  const bestWindow = strongest?.presentation.metrics[0].value ?? null;

  return (
    <section className="tk-tonight-surface" aria-labelledby="tk-tonight-title">
      <div className="tk-tonight-briefing">
        <header className="tk-tonight-heading">
          <p><CalendarDays size={14} aria-hidden /> {dateLabel} · {place}</p>
          <h1 id="tk-tonight-title">
            {strongest && bestWindow
              ? `Best window: ${bestWindow}`
              : "Plan the next clear window"}
          </h1>
          <span>
            {strongest
              ? strongest.presentation.recommendation
              : "Nothing clears Tracker’s observing threshold for this night. The nearest worthwhile opportunity comes first."}
          </span>
        </header>

        {loading ? (
          <div className="tk-tonight-loading" aria-label="Loading tonight's briefing">
            <span className="tk-map-skeleton is-title" />
            <span className="tk-map-skeleton is-line" />
          </div>
        ) : strongest ? (
          <>
            <article className="tk-tonight-lead" data-card={strongest.id} data-reason={strongest.reason}>
              <div className="tk-tonight-lead-visual" aria-hidden>
                <CardFigure media={strongest.media} />
              </div>
              <div className="tk-tonight-lead-copy">
                <div className="tk-tonight-lead-labels">
                  <span>Top recommendation</span>
                  <span className="tk-tonight-quality" data-tone={strongest.presentation.row.quality.tone}>
                    {strongest.presentation.row.quality.value}
                  </span>
                </div>
                <h2>{strongest.presentation.title}</h2>
                <p>{strongest.presentation.recommendation}</p>
                <dl>
                  {strongest.presentation.metrics.map((metric) => (
                    <div key={metric.label}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
                {leadFacts?.cloud ? (
                  <p className="tk-tonight-cloud" data-go-anyway={leadFacts.cloud.goAnyway ? "true" : undefined}>
                    {leadFacts.cloud.warning}
                  </p>
                ) : null}
                <p className="tk-tonight-equipment">{equipmentContext(strongest, equipment)}</p>
                <div className="tk-tonight-lead-actions">
                  <button type="button" onClick={() => onOpenDetail(strongest.id)}>View details</button>
                  {canFindInSky(strongest) ? (
                    <button type="button" className="is-finder" onClick={() => onFindInSky(strongest.id)}>
                      <Compass size={15} aria-hidden /> {finderLabel}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>

            {cards.length > 1 ? (
              <section className="tk-tonight-next" aria-labelledby="tk-tonight-next-title">
                <div className="tk-tonight-section-heading">
                  <h2 id="tk-tonight-next-title">Also worth your time</h2>
                  <span>Ranked for this place, night, and equipment</span>
                </div>
                <ol>
                  {cards.slice(1, 5).map((card, index) => (
                    <TonightRow
                      key={card.id}
                      card={card}
                      rank={index + 2}
                      configured={equipment}
                      finderLabel={finderLabel}
                      canFindInSky={canFindInSky(card)}
                      onOpenDetail={() => onOpenDetail(card.id)}
                      onFindInSky={() => onFindInSky(card.id)}
                    />
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        ) : (
          <div className="tk-tonight-recovery">{recovery}</div>
        )}

        <button
          ref={upcoming.triggerRef}
          type="button"
          className="tk-tonight-planning"
          data-card="upcoming"
          data-gateway="upcoming"
          onClick={upcoming.onOpen}
          aria-haspopup="dialog"
        >
          <span className="tk-tonight-planning-icon" aria-hidden><CalendarRange size={20} /></span>
          <span>
            <strong>Plan ahead</strong>
            <small>7 days · 30 days · 3 months · 1 year</small>
          </span>
          <ChevronRight size={17} aria-hidden />
        </button>
      </div>
    </section>
  );
}
