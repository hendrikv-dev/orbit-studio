import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  Droplets,
  Flame,
  Moon,
  Thermometer,
  TriangleAlert,
  Wind,
} from "lucide-react";
import type { ConditionCard, ConditionCardId } from "../../data/tracker/conditionCards";

/**
 * The conditions that bear on tonight, and only those.
 *
 * Three are always here — cloud, moonlight, temperature — because all three are
 * always answerable and none is ever irrelevant. Between and after them the row
 * carries what is actually true: the atmospheric slot when something measures
 * the sky above this location, and an air-quality warning when the air is bad
 * enough to carry published advice.
 *
 * This has been a fixed four twice, on the reasoning that a constant row is
 * comparable between events and between nights. That reasoning is right about
 * the cards a reader learns and wrong about a slot held open on principle,
 * because something has to go in it — and what went in it was "Smoke / haze ·
 * Not reported", every night, everywhere no aerosol model reaches.
 * Comparability is preserved where it is load-bearing: the standing three never
 * move, and the row widens its cards rather than leaving a gap.
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
  // The one card in the row that is about the reader rather than the sky, so
  // it is the one card that is marked as a warning rather than as weather.
  "air-quality": TriangleAlert,
  haze: Wind,
  precipitation: CloudDrizzle,
  fog: CloudFog,
  dew: Droplets,
};

export function ConditionsRow({
  cards,
  caption,
  evidenceStatus,
  atUtc,
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
  /**
   * The instant these numbers describe.
   *
   * The row is not about now. It is about the moment the recommendation is for,
   * which is some hours into the night — and that is not visible from the
   * outside, so a harness stubbing an hourly feed had no way to know which hour
   * the page would actually read. It anchored its fixture to the wall clock
   * instead, and quietly tested nothing on any night whose best event fell at a
   * different hour. Exposed for the same reason `data-evidence-status` is.
   */
  atUtc?: string;
}) {
  return (
    <section
      className="tk-conditions tracker-condition"
      aria-label="Conditions"
      data-evidence-status={evidenceStatus}
      data-at-utc={atUtc}
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
