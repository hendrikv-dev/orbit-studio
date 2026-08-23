import { Cloud, CloudDrizzle, CloudFog, Droplets, Flame, Moon, Thermometer, Wind } from "lucide-react";
import type { ConditionCard, ConditionCardId } from "../../data/tracker/conditionCards";

/**
 * The conditions that bear on tonight, and only those.
 *
 * Three are always here — cloud, moonlight, temperature — because they always
 * matter. The rest appear when they would change what somebody does and are
 * absent otherwise.
 *
 * This used to be a fixed row of four, on the reasoning that a constant row is
 * comparable between events and between nights. That was true and it cost more
 * than it bought: the fourth slot was smoke, smoke is negligible on most nights
 * almost everywhere, and so a quarter of the row spent every night saying "Not
 * reported" in order to be useful on the few nights it was. Comparability is
 * preserved where it is actually load-bearing — the three constants never move
 * — and the row now gets wider cards on an ordinary night instead of an empty
 * one.
 *
 * Absence is still rendered as absence where a card *is* shown: "Forecast
 * closer to date" beyond any useful horizon, "Not reported" where no provider
 * supplies the layer. Those are different sentences because they are different
 * situations, and neither is a number.
 */

const ICONS: Record<ConditionCardId, typeof Cloud> = {
  cloud: Cloud,
  moonlight: Moon,
  temperature: Thermometer,
  // Smoke gets its own mark rather than sharing haze's: they are different
  // claims from different models, and the row should not imply otherwise.
  smoke: Flame,
  haze: Wind,
  precipitation: CloudDrizzle,
  fog: CloudFog,
  dew: Droplets,
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
