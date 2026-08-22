import type { ReactNode } from "react";
import type { ConditionCard } from "../../data/tracker/conditionCards";
import { categoryOf, subtitleFor, type EventCategoryId } from "../../data/tracker/eventCategories";
import type { EventPresentation } from "../../data/tracker/eventPresentation";
import { ConditionsRow } from "./ConditionsRow";
import { EventHero, type HeroMedia } from "./EventHero";
import { RelevantEventsList, type RelevantEventRow } from "./RelevantEventsList";

/**
 * The page. There is only one.
 *
 * Heading, main row, conditions, ranked list — in that order, at those
 * proportions, for a meteor shower and for an eclipse and for anything added
 * later. The universality is structural rather than aspirational: this
 * component holds the geometry and accepts content, and a phenomenon has no way
 * to reach past it and rearrange anything.
 *
 * The main row is two thirds hero and one third visualization. That ratio is
 * fixed even where the visualization is a map, which is the specific drift this
 * design exists to prevent — a map given its head expands until it is the page,
 * and the reader ends up looking at cartography instead of at a recommendation.
 * A map that needs more room has a control to open it full size.
 */

interface Props {
  categoryId: EventCategoryId;
  mode: "tonight" | "upcoming";
  presentation: EventPresentation;
  media: HeroMedia;
  /** Whatever belongs in the fixed slot for this phenomenon. */
  visualization: ReactNode;
  conditions: ConditionCard[];
  conditionsCaption?: string | null;
  /** The forecast state behind the row, for the review harness and for tests. */
  evidenceStatus: string;
  rows: RelevantEventRow[];
  onSelectEvent: (id: string) => void;
  onPrimaryAction: () => void;
  onReminder: () => void;
  /** An extra hero control, where the event has a second distinct tool. */
  tertiaryAction?: { label: string; onSelect: () => void } | null;
  safety: string | null;
  expectation: string | null;
  /** Distinguishes one plan from another for the review harness. */
  planIdentity?: string;
  listHeading?: string;
  listCaption?: string;
  /** Rendered above the heading when this page was reached from Upcoming. */
  back?: { label: string; onSelect: () => void };
}

export function PhenomenonPage({
  categoryId,
  mode,
  presentation,
  media,
  visualization,
  conditions,
  conditionsCaption,
  evidenceStatus,
  rows,
  onSelectEvent,
  onPrimaryAction,
  onReminder,
  tertiaryAction = null,
  safety,
  expectation,
  planIdentity,
  listHeading,
  listCaption,
  back,
}: Props) {
  const category = categoryOf(categoryId);

  return (
    <div className="tk-page tk-tonight" data-plan-identity={planIdentity} data-category={categoryId}>
      <div className="tk-page-heading">
        {back ? (
          <button type="button" className="tk-back" onClick={back.onSelect}>
            ← {back.label}
          </button>
        ) : null}
        <h1>{category.heading}</h1>
        <p>{subtitleFor(categoryId, mode)}</p>
      </div>

      <div className="tk-main-row">
        <EventHero
          presentation={presentation}
          media={media}
          safety={safety}
          expectation={expectation}
          onPrimary={onPrimaryAction}
          onSecondary={onReminder}
          tertiary={tertiaryAction}
        />
        <aside className="tk-viz-slot" aria-label="Evidence">
          {visualization}
        </aside>
      </div>

      <ConditionsRow
        cards={conditions}
        caption={conditionsCaption}
        evidenceStatus={evidenceStatus}
      />

      <RelevantEventsList
        rows={rows}
        onSelect={onSelectEvent}
        heading={listHeading}
        caption={listCaption}
      />
    </div>
  );
}
