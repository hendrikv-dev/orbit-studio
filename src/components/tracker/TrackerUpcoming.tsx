import { useMemo, useState } from "react";
import {
  DEFAULT_HORIZON_NIGHTS,
  distinguishingOpportunity,
  nightDistinction,
  planNights,
  type NightPlan,
} from "../../data/tracker/schedule";
import type { PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";
import { TrackerCalendar } from "./TrackerCalendar";

/**
 * Ranked opportunities across the nights ahead.
 *
 * Built from the same generation and ranking layer Tonight uses, one full night
 * at a time — not from Tonight's list re-sorted, which would be the same
 * evening wearing thirty different dates.
 *
 * ## Astronomy is certain here; weather is not
 *
 * No forecast is applied. A forecast reaches a few days out at best, and this
 * view looks a month ahead, so applying one where it exists and silently
 * dropping it where it does not would make the first three entries mean
 * something different from the rest without saying so. Instead every night is
 * presented as what it is — an astronomical prediction, which is about as
 * certain as predictions get — and conditions are left to Tonight, which is the
 * view where a forecast is actually load-bearing.
 */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
  onOpenNight: (plan: NightPlan) => void;
  /** Nights to look ahead. Defaults to the data layer's own horizon. */
  horizonNights?: number;
}

/** "Fri 21 Aug", in the observer's own clock. */
function labelFor(dateKey: string): { weekday: string; day: string; month: string } {
  // Parsed as a local calendar date rather than an instant: the key is already
  // in the observer's clock, and re-interpreting it as UTC would shift it a day
  // west of Greenwich.
  const [year, month, day] = dateKey.split("-").map(Number);
  const at = new Date(year, month - 1, day);
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(at),
    day: String(day),
    month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(at),
  };
}

export function TrackerUpcoming({ place, clock, onOpenNight, horizonNights }: Props) {
  const [mode, setMode] = useState<"curated" | "calendar">("curated");
  const plans = useMemo(
    () =>
      planNights(
        place.latitude,
        place.longitude,
        new Date(),
        horizonNights ?? DEFAULT_HORIZON_NIGHTS,
        clock.timeZone,
      ),
    [place.latitude, place.longitude, horizonNights, clock.timeZone],
  );

  // Ordered by what distinguishes each night, not by its best opportunity's
  // strength. Sorting on strength put a Moon phase at the top of nearly all
  // thirty nights — true, and useless for choosing one.
  const byWorth = useMemo(
    () =>
      [...plans]
        .filter((plan) => plan.ranking.ranked.length > 0)
        .sort((left, right) => nightDistinction(right) - nightDistinction(left)),
    [plans],
  );

  return (
    <section className="tk-view tk-upcoming" aria-label="Upcoming">
      <div className="tk-upcoming-bar">
        <div className="tk-view-head">
          <h1 className="tk-display">
            {mode === "curated" ? "Worth planning for" : "What happens when"}
          </h1>
          <p className="tk-view-lede">
            {mode === "curated"
              ? `Notable nights from ${place.name}. Positions are computed; the sky is only forecast a few days out, so conditions are not applied here.`
              : `Computed for ${place.name}. Astronomical events hold whatever the weather does.`}
          </p>
        </div>
        {/* Two ways of looking at the same future, not two destinations. */}
        <div className="tk-mode" role="tablist" aria-label="How to browse">
          {(["curated", "calendar"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={mode === entry}
              className="tk-mode-item"
              onClick={() => setMode(entry)}
            >
              {entry === "curated" ? "Curated" : "Calendar"}
            </button>
          ))}
        </div>
      </div>

      {mode === "calendar" ? <TrackerCalendar place={place} clock={clock} /> : null}
      {mode === "curated" ? (
        <>

      <ol className="tk-night-list">
        {byWorth.map((plan) => {
          // The opportunity that earned the night its place, which on the night
          // of an eclipse is not the top-ranked target. Showing the ranked lead
          // would have the list assert one thing and be sorted by another.
          const lead = distinguishingOpportunity(plan)!;
          const date = labelFor(plan.dateKey);
          const others = plan.ranking.ranked
            .filter((entry) => entry.opportunity.id !== lead.opportunity.id)
            .slice(0, 3);
          return (
            <li key={plan.dateKey}>
              <button
                type="button"
                className="tk-night"
                data-band={lead.band}
                onClick={() => onOpenNight(plan)}
              >
                <span className="tk-night-date">
                  <span className="tk-night-weekday">{date.weekday}</span>
                  <span className="tk-night-day">{date.day}</span>
                  <span className="tk-night-month">{date.month}</span>
                </span>
                <span className="tk-night-body">
                  <span className="tk-night-lead">{lead.opportunity.title}</span>
                  <span className="tk-night-summary">{lead.opportunity.summary}</span>
                  {others.length > 0 ? (
                    <span className="tk-night-also">
                      also {others.map((entry) => entry.opportunity.title).join(" · ")}
                    </span>
                  ) : null}
                </span>
                <span className="tk-night-band" data-band={lead.band}>
                  {lead.band}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
        </>
      ) : null}
    </section>
  );
}
