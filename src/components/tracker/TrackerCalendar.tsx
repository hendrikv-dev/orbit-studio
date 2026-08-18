import { useMemo, useState } from "react";
import { distinguishingOpportunity, planMonth } from "../../data/tracker/schedule";
import type { PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";

/**
 * Date-oriented browsing of the sky.
 *
 * The other views ask "what should I do"; this one answers "what happens on the
 * 14th". That is a different question and it needs a different shape — a month
 * you can move through, not a ranked list with dates attached.
 *
 * Each month is computed when it is asked for. Precomputing a range would mean
 * choosing one, and any fixed range is simultaneously too much work for the
 * reader who looks at two months and too little for the one who scrolls past
 * its edge.
 *
 * Nothing here is weather-adjusted. A calendar is consulted well before any
 * forecast exists for the square being looked at, and an event's astronomy is
 * knowable in a way its cloud cover never is.
 */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TrackerCalendar({ place, clock }: Props) {
  const today = new Date();
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });

  const plans = useMemo(
    () => planMonth(place.latitude, place.longitude, cursor.year, cursor.month, clock.timeZone),
    [place.latitude, place.longitude, cursor.year, cursor.month, clock.timeZone],
  );

  const byDate = useMemo(
    () => new Map(plans.map((plan) => [plan.dateKey, plan])),
    [plans],
  );

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(cursor.year, cursor.month - 1, 1));

  // Monday-first, which is what the weekday row says. Sunday is 0 in JS, so it
  // has to be mapped to the end rather than the start or every month is
  // rendered a day out.
  const firstWeekday = (new Date(cursor.year, cursor.month - 1, 1).getDay() + 6) % 7;
  const dayCount = new Date(cursor.year, cursor.month, 0).getDate();

  const step = (delta: number) =>
    setCursor((current) => {
      const next = current.month + delta;
      if (next < 1) return { year: current.year - 1, month: 12 };
      if (next > 12) return { year: current.year + 1, month: 1 };
      return { year: current.year, month: next };
    });

  const key = (day: number) =>
    `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return (
    <section className="tk-view tk-calendar" aria-label="Calendar">
      <div className="tk-view-head">
        <h1 className="tk-display">What happens when</h1>
        <p className="tk-view-lede">
          Computed for {place.name}. Positions and events are astronomical, so they hold whatever
          the weather does.
        </p>
      </div>

      <div className="tk-cal-bar">
        <button type="button" className="tk-cal-step" onClick={() => step(-1)}>
          ← Previous
        </button>
        <h2 className="tk-cal-month">{monthLabel}</h2>
        <button type="button" className="tk-cal-step" onClick={() => step(1)}>
          Next →
        </button>
      </div>

      <div className="tk-cal-grid" role="grid" aria-label={monthLabel}>
        {WEEKDAYS.map((day) => (
          <div key={day} className="tk-cal-weekday" role="columnheader">
            {day}
          </div>
        ))}
        {Array.from({ length: firstWeekday }, (_, index) => (
          <div key={`pad-${index}`} className="tk-cal-pad" aria-hidden />
        ))}
        {Array.from({ length: dayCount }, (_, index) => {
          const day = index + 1;
          const plan = byDate.get(key(day));
          // Same comparison Upcoming sorts by, so a square and the list
          // agree about what a night is for.
          const lead = plan ? distinguishingOpportunity(plan) : null;
          return (
            <div
              key={day}
              className="tk-cal-cell"
              role="gridcell"
              data-band={lead?.band ?? undefined}
            >
              <span className="tk-cal-daynum">{day}</span>
              {lead ? (
                <>
                  <span className="tk-cal-lead">{lead.opportunity.title}</span>
                  <span className="tk-cal-band" data-band={lead.band}>
                    {lead.band}
                  </span>
                </>
              ) : (
                <span className="tk-cal-quiet">—</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
