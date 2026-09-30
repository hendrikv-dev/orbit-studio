import type { ReactNode } from "react";
import type { ConditionCard } from "../../data/tracker/conditionCards";
import type { EventCategoryId } from "../../data/tracker/eventCategories";
import type { EventPresentation } from "../../data/tracker/eventPresentation";
import { ConditionsRow } from "./ConditionsRow";
import { EventHero, type HeroMedia } from "./EventHero";

/**
 * The page. There is only one.
 *
 * Back, object hero, concise conditions, advanced disclosure — in that order,
 * for a meteor shower and for an eclipse and for anything added later. The
 * universality is structural rather than aspirational: this component holds
 * the geometry and accepts content, and a phenomenon has no way to reach past
 * it and rearrange anything.
 *
 * ## One left edge
 *
 * Every row starts where the page starts. The back control is part of that
 * column rather than a pill floating over it — when it floated, the heading had
 * to be pushed clear of it with a hard-coded indent, so the title alone stood a
 * hundred and sixty-eight pixels right of everything below it, and the number
 * was the width of one particular English label.
 *
 * ## What is deliberately no longer here
 *
 * The cross-event list — "Best tonight", with rows and a grade each. It was a
 * second ranking of the same night, running beside the observing rail that the
 * reader chose this event *from*, on a page whose whole job is this one event.
 * Two ranking systems for one night is a thing this project already keeps
 * carefully in step in two other places; a third copy on the detail page bought
 * nothing and competed with the subject.
 *
 * The default row is the object-first hero alone. Charts, cartography,
 * provenance and the full condition set stay in More details so the observing
 * decision is not visually outranked by its evidence. Phenomenon-specific map
 * actions remain available only when geographic meaning genuinely exists.
 */

interface Props {
  categoryId: EventCategoryId;
  presentation: EventPresentation;
  media: HeroMedia;
  /** Whatever belongs in the fixed slot for this phenomenon. */
  visualization: ReactNode;
  conditions: ConditionCard[];
  conditionsCaption?: string | null;
  /** The forecast state behind the row, for the review harness and for tests. */
  evidenceStatus: string;
  mapAction?: { label: string; onSelect: () => void } | null;
  onPrimaryAction: () => void;
  onReminder: () => void;
  /** An extra hero control, where the event has a second distinct tool. */
  tertiaryAction?: { label: string; onSelect: () => void } | null;
  finderAction?: { label: string; onSelect: () => void } | null;
  safety: string | null;
  expectation: string | null;
  /** Distinguishes one plan from another for the review harness. */
  planIdentity?: string;
  /** The way back, rendered as the first row of the page's own column. */
  back?: { label: string; onSelect: () => void };
}

export function PhenomenonPage({
  categoryId,
  presentation,
  media,
  visualization,
  conditions,
  conditionsCaption,
  evidenceStatus,
  mapAction = null,
  onPrimaryAction,
  onReminder,
  tertiaryAction = null,
  finderAction = null,
  safety,
  expectation,
  planIdentity,
  back,
}: Props) {
  const conciseConditions = conditions.filter((condition) => condition.tone !== "unknown").slice(0, 2);

  return (
    <div className="tk-page tk-tonight" data-plan-identity={planIdentity} data-category={categoryId}>
      <div className="tk-page-heading">
        {back ? (
          <button type="button" className="tk-back" onClick={back.onSelect}>
            ← {back.label}
          </button>
        ) : null}
      </div>

      <div className="tk-main-row is-concise">
        <EventHero
          presentation={presentation}
          media={media}
          safety={safety}
          expectation={expectation}
          mapAction={mapAction}
          finder={finderAction}
        />
      </div>

      {conciseConditions.length > 0 ? (
        <ul className="tk-detail-key-conditions" aria-label="Key observing conditions">
          {conciseConditions.map((condition) => (
            <li key={condition.id} data-tone={condition.tone}>
              <span>{condition.label}</span>
              <strong>{condition.value}</strong>
              {condition.interpretation ? <small>{condition.interpretation}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <details className="tk-detail-more">
        <summary>More details</summary>
        <div className="tk-detail-tools" aria-label="Advanced sky tools">
          <button type="button" onClick={onPrimaryAction}>
            {presentation.primaryAction.label}
          </button>
          {tertiaryAction ? (
            <button type="button" onClick={tertiaryAction.onSelect}>
              {tertiaryAction.label}
            </button>
          ) : null}
          <button type="button" onClick={onReminder}>
            {presentation.secondaryAction.label}
          </button>
        </div>
        <div className="tk-detail-more-grid">
          <aside className="tk-viz-slot" aria-label="Sky and event evidence">
            {visualization}
          </aside>
          <ConditionsRow
            cards={conditions}
            caption={conditionsCaption}
            evidenceStatus={evidenceStatus}
            // The moment the recommendation is for, which is what the row is about.
            atUtc={presentation.atUtc}
          />
        </div>
      </details>

    </div>
  );
}
