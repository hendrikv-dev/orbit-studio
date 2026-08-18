import { useMemo, useState } from "react";
import { notableEvents, planMonth, type NotableEvent } from "../../data/tracker/schedule";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";

/**
 * A month as an index of dates worth knowing about, beside the one selected.
 *
 * The previous calendar rendered every day as a bordered card carrying a
 * quality badge, which made a month of ordinary nights look like thirty-one
 * events and left nowhere for the two that mattered to stand out. It also ran
 * past the bottom of the viewport, because thirty-one cards do not fit in the
 * space a month has.
 *
 * Sparsity is the mechanism here. Most dates are a number and nothing else —
 * that is what an ordinary night looks like — and significance shows up as the
 * only marks on the grid. A reader should be able to find the eclipse without
 * reading anything.
 *
 * The month and the selected event are one composition rather than a grid with
 * a panel bolted underneath: choosing a marked date fills the right-hand side,
 * and both halves stay inside the viewport.
 */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * One taxonomy: every marker names the kind of event.
 *
 * These were a jumble of different concepts — ECLIPSE was an event type, PEAK
 * an event phase, MOON a phenomenon category, PAIRING an informal name, and
 * BEST a quality judgement sitting among them as though it were the same sort
 * of word. A reader could not tell what dimension they were reading.
 *
 * They are all event types now, and they match Curated exactly, so the same
 * event is not a "Pairing" in one view and a "Conjunction" in the other.
 */
const KIND_MARK: Record<NotableEvent["kind"], string> = {
  eclipse: "Eclipse",
  "shower-peak": "Meteor peak",
  conjunction: "Conjunction",
  "moon-phase": "Moon phase",
  "best-placement": "Opposition",
};

export function TrackerMonth({ place, clock }: Props) {
  const today = new Date();
  const [cursor, setCursor] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // The same notability layer Curated uses, so a date marked here is a date
  // that would be featured there. Two views of one judgement.
  const events = useMemo(() => {
    const plans = planMonth(place.latitude, place.longitude, cursor.year, cursor.month, clock.timeZone);
    return notableEvents(plans, 12);
  }, [place.latitude, place.longitude, cursor.year, cursor.month, clock.timeZone]);

  const byDate = useMemo(() => {
    const map = new Map<string, NotableEvent>();
    for (const event of events) {
      const held = map.get(event.plan.dateKey);
      if (!held) map.set(event.plan.dateKey, event);
    }
    return map;
  }, [events]);

  const selected = selectedKey ? byDate.get(selectedKey) : undefined;
  const featured = selected ?? events[0];

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(cursor.year, cursor.month - 1, 1));

  const firstWeekday = (new Date(cursor.year, cursor.month - 1, 1).getDay() + 6) % 7;
  const dayCount = new Date(cursor.year, cursor.month, 0).getDate();
  const key = (day: number) =>
    `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const step = (delta: number) => {
    setSelectedKey(null);
    setCursor((current) => {
      const next = current.month + delta;
      if (next < 1) return { year: current.year - 1, month: 12 };
      if (next > 12) return { year: current.year + 1, month: 1 };
      return { year: current.year, month: next };
    });
  };

  return (
    <div className="tk-month">
      <section className="tk-month-grid-wrap" aria-label={monthLabel}>
        <div className="tk-month-bar">
          <button type="button" className="tk-month-step" onClick={() => step(-1)}>
            ←<span className="tracker-visually-hidden"> Previous month</span>
          </button>
          <h2 className="tk-month-name">{monthLabel}</h2>
          <button type="button" className="tk-month-step" onClick={() => step(1)}>
            →<span className="tracker-visually-hidden"> Next month</span>
          </button>
        </div>

        <div className="tk-month-grid" role="grid" aria-label={monthLabel}>
          {WEEKDAYS.map((day) => (
            <div key={day} className="tk-month-weekday" role="columnheader">
              {day}
            </div>
          ))}
          {Array.from({ length: firstWeekday }, (_, index) => (
            <div key={`pad-${index}`} aria-hidden />
          ))}
          {Array.from({ length: dayCount }, (_, index) => {
            const day = index + 1;
            const dateKey = key(day);
            const event = byDate.get(dateKey);
            // An ordinary date is a number. Only marked dates are pressable,
            // because only they lead anywhere.
            if (!event) {
              return (
                <div key={day} className="tk-day" role="gridcell">
                  <span className="tk-day-num">{day}</span>
                </div>
              );
            }
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                className="tk-day is-marked"
                aria-current={featured?.plan.dateKey === dateKey ? "date" : undefined}
                data-kind={event.kind}
                onClick={() => setSelectedKey(dateKey)}
              >
                <span className="tk-day-num">{day}</span>
                <span className="tk-day-mark">{KIND_MARK[event.kind]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="tk-month-detail" aria-label="Selected event">
        {featured ? (
          <>
            <p className="tk-feature-kind">
              {KIND_MARK[featured.kind]} ·{" "}
              {new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(
                new Date(
                  Number(featured.plan.dateKey.slice(0, 4)),
                  Number(featured.plan.dateKey.slice(5, 7)) - 1,
                  Number(featured.plan.dateKey.slice(8, 10)),
                ),
              )}
            </p>
            <h3 className="tk-feature-name">{featured.entry.opportunity.title}</h3>
            <p className="tk-feature-why">{featured.reason}</p>
            <p className="tk-feature-summary">{featured.entry.opportunity.summary}</p>

            <dl className="tk-feature-facts">
              <div>
                <dt>Best around</dt>
                <dd>{formatClockTime(featured.entry.opportunity.guidance.whenUtc, clock)}</dd>
              </div>
              <div>
                <dt>Needs</dt>
                <dd>
                  {featured.entry.opportunity.guidance.equipment === "eyes"
                    ? "Eyes only"
                    : featured.entry.opportunity.guidance.equipment === "binoculars"
                      ? "Binoculars"
                      : "Telescope"}
                </dd>
              </div>
              <div>
                <dt>Where</dt>
                <dd>{featured.entry.opportunity.guidance.direction ?? "Overhead"}</dd>
              </div>
            </dl>

            <p className="tk-feature-guidance">{featured.entry.opportunity.guidance.elevation}</p>

            <button type="button" className="tracker-primary tk-feature-action">
              Remind me
            </button>
          </>
        ) : (
          <p className="tk-view-lede">
            Nothing in {monthLabel} is worth marking from {place.name}. Move a month either way, or
            check what is up tonight.
          </p>
        )}
      </aside>
    </div>
  );
}
