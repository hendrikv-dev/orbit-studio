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

function usefulMetric(value: string): boolean {
  return !/^not known$/i.test(value.trim());
}

function TonightRow({
  card,
  rank,
  featured,
  configured,
  finderLabel,
  canFindInSky,
  onOpenDetail,
  onFindInSky,
}: {
  card: RailCard;
  rank: number;
  featured: boolean;
  configured: EquipmentRule;
  finderLabel: string;
  canFindInSky: boolean;
  onOpenDetail: () => void;
  onFindInSky: () => void;
}) {
  const [when, , where] = card.presentation.metrics;
  const quality = card.presentation.row.quality;
  return (
    <li
      className={`tk-tonight-row${featured ? " tk-tonight-lead" : ""}`}
      data-card={card.id}
      data-reason={card.reason}
      data-primary={featured ? "true" : undefined}
    >
      <span className="tk-tonight-rank" aria-label={`Rank ${rank}`}>{rank}</span>
      <span className="tk-tonight-row-image" aria-hidden><CardFigure media={card.media} /></span>
      <button type="button" className="tk-tonight-row-main" onClick={onOpenDetail}>
        <strong>{card.presentation.shortTitle ?? card.presentation.title}</strong>
        <span>{when.value} · {where.value}</span>
        <small>
          {quality.tone !== "unknown" && usefulMetric(quality.value) ? `${quality.value} · ` : ""}
          {featured ? card.presentation.recommendation : equipmentContext(card, configured)}
        </small>
      </button>
      {quality.tone !== "unknown" && usefulMetric(quality.value) ? (
        <span className="tk-tonight-quality" data-tone={quality.tone}>
          {quality.value}
        </span>
      ) : null}
      {canFindInSky ? (
        <button
          type="button"
          className={`tk-tonight-row-finder${featured ? " is-finder" : ""}`}
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
 * hierarchy, then renders the full ranked briefing as one composed list and
 * planning as a distinct next step. Every value still
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

  return (
    <section className="tk-tonight-surface" aria-labelledby="tk-tonight-title">
      <div className="tk-tonight-briefing">
        <header className="tk-tonight-heading">
          {strongest ? (
            <div className="tk-tonight-atmosphere" aria-hidden>
              <img src="/sky/eso-potw1033a-night-sky-detail.webp" alt="" />
              <small>Representative long-exposure · ESO/S. Guisard</small>
            </div>
          ) : null}
          <div className="tk-tonight-heading-copy">
            <p><CalendarDays size={14} aria-hidden /> {dateLabel} · {place}</p>
            <h1 id="tk-tonight-title">
              {strongest
                ? `${strongest.presentation.shortTitle ?? strongest.presentation.title} leads tonight’s sky`
                : "Plan the next clear window"}
            </h1>
            <span>
              {strongest
                ? "Your strongest observing window, followed by the night in rank order."
                : "Nothing clears Tracker’s observing threshold for this night. The nearest worthwhile opportunity comes first."}
            </span>
          </div>
        </header>

        {loading ? (
          <div className="tk-tonight-loading" aria-label="Loading tonight's briefing">
            <span className="tk-map-skeleton is-title" />
            <span className="tk-map-skeleton is-line" />
          </div>
        ) : strongest ? (
          <>
            <section className="tk-tonight-next" aria-labelledby="tk-tonight-next-title">
              <div className="tk-tonight-section-heading">
                <h2 id="tk-tonight-next-title">Tonight, in order</h2>
                <span>Ranked for this place and equipment</span>
              </div>
              <ol>
                {cards.slice(0, 5).map((card, index) => (
                  <TonightRow
                    key={card.id}
                    card={card}
                    rank={index + 1}
                    featured={index === 0}
                    configured={equipment}
                    finderLabel={finderLabel}
                    canFindInSky={canFindInSky(card)}
                    onOpenDetail={() => onOpenDetail(card.id)}
                    onFindInSky={() => onFindInSky(card.id)}
                  />
                ))}
              </ol>
            </section>
            {leadFacts?.cloud && leadFacts.cloud.warning ? (
              <p className="tk-tonight-cloud" data-go-anyway={leadFacts.cloud.goAnyway ? "true" : undefined}>
                {leadFacts.cloud.warning}
              </p>
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
