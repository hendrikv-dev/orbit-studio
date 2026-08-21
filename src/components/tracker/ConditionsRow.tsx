import { Cloud, Moon, Thermometer, Wind } from "lucide-react";
import type { ConditionCard, ConditionCardId } from "../../data/tracker/conditionCards";

/**
 * Four cards, in the same four places, for every event.
 *
 * The row is a constant. It does not gain a card when more is known or lose one
 * when less is, because its job is comparison — between events, and between
 * nights — and a row that changes width cannot be compared with itself.
 *
 * Absence is rendered as absence: "Forecast closer to date" for a date beyond
 * any useful forecast, "Not reported" where no provider supplies the layer.
 * Those are different sentences because they are different situations, and
 * neither is a number.
 */

const ICONS: Record<ConditionCardId, typeof Cloud> = {
  cloud: Cloud,
  smoke: Wind,
  moonlight: Moon,
  temperature: Thermometer,
};

export function ConditionsRow({
  cards,
  caption,
  evidenceStatus,
}: {
  cards: ConditionCard[];
  /** Where the numbers came from, stated once for the whole row. */
  caption?: string | null;
  /**
   * Whether a forecast is behind this row at all.
   *
   * Exposed as an attribute because it is an invariant the review harness
   * checks — an unknown sky must never sit under a confident recommendation —
   * and because the row itself is now the single place that state is rendered.
   * It used to be repeated on every ranked item, where five copies read as five
   * separate warnings about five separate forecasts.
   */
  evidenceStatus?: string;
}) {
  return (
    <section
      className="tk-conditions tracker-condition"
      aria-label="Conditions"
      data-evidence-status={evidenceStatus}
    >
      <ul className="tk-conditions-row">
        {cards.map((card) => {
          const Icon = ICONS[card.id];
          return (
            <li key={card.id} className={`tk-condition-card is-${card.tone}`}>
              <span className="tk-condition-icon" aria-hidden>
                <Icon size={20} />
              </span>
              <span className="tk-condition-body">
                <span className="tk-condition-label">{card.label}</span>
                <span className="tk-condition-value">
                  {card.value}
                  {card.interpretation ? (
                    <>
                      <span aria-hidden> · </span>
                      <em className="tk-condition-note">{card.interpretation}</em>
                    </>
                  ) : null}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {caption ? <p className="tk-conditions-caption">{caption}</p> : null}
    </section>
  );
}
