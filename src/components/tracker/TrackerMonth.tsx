import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterNotableEvents,
  type PhenomenonCategoryId,
} from "../../data/tracker/phenomenonCategories";
import type { TrackerPlanningRequest } from "../../data/tracker/planningProtocol";
import { notableEvents, type NotableEvent } from "../../data/tracker/schedule";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import { downloadCalendarFile } from "../../lib/trackerCalendar";
import type { SelectedPlace } from "./TrackerPlace";
import { TrackerPlanningStatus } from "./TrackerPlanningStatus";
import { TrackerScienceDetails } from "./TrackerScienceDetails";
import { useTrackerPlans } from "./useTrackerPlans";

/** Desktop month index plus an intentional small-screen event agenda. */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
  now: Date;
  category: PhenomenonCategoryId;
  /**
   * Open the event on the universal page.
   *
   * Calendar used to be the end of the road: it showed a date, a summary and a
   * reminder button, and everything the rest of the product knows about that
   * event was unreachable from here. Selecting now hands the event to the same
   * page Tonight uses, so a shower peak found on a calendar square gets the
   * activity graph and the conditions row like any other.
   */
  onSelectEvent: (event: NotableEvent) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const KIND_MARK: Record<NotableEvent["kind"], string> = {
  eclipse: "Eclipse",
  "shower-peak": "Meteor peak",
  conjunction: "Conjunction",
  "moon-phase": "Moon phase",
  opposition: "Opposition",
};

function dateFromKey(dateKey: string): Date {
  return new Date(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(5, 7)) - 1,
    Number(dateKey.slice(8, 10)),
  );
}

function fullDate(dateKey: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dateFromKey(dateKey));
}

function eventKey(event: NotableEvent): string {
  return `${event.plan.dateKey}:${event.entry.opportunity.id}`;
}

export function TrackerMonth({ place, clock, now, category, onSelectEvent }: Props) {
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: clock.timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const todayYear = Number(todayParts.find((part) => part.type === "year")?.value);
  const todayMonth = Number(todayParts.find((part) => part.type === "month")?.value);
  const [cursor, setCursor] = useState({ year: todayYear, month: todayMonth });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setCursor({ year: todayYear, month: todayMonth });
    setSelectedKey(null);
  }, [clock.timeZone, todayMonth, todayYear]);

  const request = useMemo<TrackerPlanningRequest>(
    () => ({
      kind: "month",
      latitudeDeg: place.latitude,
      longitudeDeg: place.longitude,
      year: cursor.year,
      month: cursor.month,
      timeZone: clock.timeZone,
    }),
    [place.latitude, place.longitude, cursor.year, cursor.month, clock.timeZone],
  );
  const planning = useTrackerPlans(request, retryNonce);
  const rankedEvents = useMemo(
    () =>
      planning.status === "ready"
        ? filterNotableEvents(notableEvents(planning.plans, 20), category)
        : [],
    [category, planning],
  );
  // Calendar answers "what happens when", unlike Highlights which is
  // intentionally significance-ranked. The agenda is chronological, while
  // the most significant event still represents a multiply-marked grid date.
  const events = useMemo(
    () => [...rankedEvents].sort((a, b) =>
        a.entry.opportunity.guidance.whenUtc.localeCompare(b.entry.opportunity.guidance.whenUtc),
      ),
    [rankedEvents],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, NotableEvent[]>();
    for (const event of rankedEvents) {
      const entries = map.get(event.plan.dateKey) ?? [];
      entries.push(event);
      map.set(event.plan.dateKey, entries);
    }
    return map;
  }, [rankedEvents]);

  // A date can contain more than one event (for example an eclipse and a Moon
  // phase). Date-only selection made every event on that date announce itself
  // as pressed even though the detail showed only one of them.
  const selected = selectedKey
    ? rankedEvents.find((event) => eventKey(event) === selectedKey)
    : undefined;
  const featured = selected ?? rankedEvents[0];
  const featuredKey = featured ? eventKey(featured) : null;
  const sameDateEvents = featured ? byDate.get(featured.plan.dateKey) ?? [] : [];
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

  const selectEvent = (event: NotableEvent) => {
    setSelectedKey(eventKey(event));
    requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
  };

  return (
    <div className="tk-month" data-planning-state={planning.status}>
      <section className="tk-month-grid-wrap" aria-label={monthLabel}>
        <div className="tk-month-bar">
          <button type="button" className="tk-month-step" onClick={() => step(-1)} aria-label="Previous month">
            ←
          </button>
          <h2 className="tk-month-name" aria-live="polite">{monthLabel}</h2>
          <button type="button" className="tk-month-step" onClick={() => step(1)} aria-label="Next month">
            →
          </button>
        </div>

        {planning.status === "loading" ? (
          <TrackerPlanningStatus status="loading" completed={planning.completed} total={planning.total} />
        ) : planning.status === "error" ? (
          <TrackerPlanningStatus
            status="error"
            completed={planning.completed}
            total={planning.total}
            message={planning.message}
            onRetry={() => setRetryNonce((value) => value + 1)}
          />
        ) : (
          <>
            <div className="tk-month-grid" aria-label={`${monthLabel} notable events`}>
              {WEEKDAYS.map((day) => (
                <span key={day} className="tk-month-weekday" aria-hidden="true">{day}</span>
              ))}
              {Array.from({ length: firstWeekday }, (_, index) => (
                <span key={`pad-${index}`} className="tk-day-pad" aria-hidden="true" />
              ))}
              {Array.from({ length: dayCount }, (_, index) => {
                const day = index + 1;
                const dateKey = key(day);
                const dateEvents = byDate.get(dateKey);
                if (!dateEvents) {
                  return (
                    <span key={day} className="tk-day" aria-hidden="true">
                      <time className="tk-day-num" dateTime={dateKey}>{day}</time>
                    </span>
                  );
                }
                const event = dateEvents[0];
                const chosen = dateEvents.some((entry) => eventKey(entry) === featuredKey);
                const eventNames = dateEvents
                  .map((entry) => `${KIND_MARK[entry.kind]}: ${entry.entry.opportunity.title}`)
                  .join("; ");
                return (
                  <button
                    key={day}
                    type="button"
                    className="tk-day is-marked"
                    aria-label={`${fullDate(dateKey)} — ${dateEvents.length} ${dateEvents.length === 1 ? "event" : "events"}: ${eventNames}`}
                    aria-pressed={chosen}
                    data-kind={event.kind}
                    onClick={() => selectEvent(event)}
                  >
                    <time className="tk-day-num" dateTime={dateKey}>{day}</time>
                    <span className="tk-day-mark" aria-hidden="true">
                      {KIND_MARK[event.kind]}{dateEvents.length > 1 ? ` +${dateEvents.length - 1}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <ol className="tk-month-agenda" aria-label={`${monthLabel} notable events`}>
              {events.map((event) => {
                const dateKey = event.plan.dateKey;
                const chosen = eventKey(event) === featuredKey;
                return (
                  <li key={eventKey(event)}>
                    <button
                      type="button"
                      className="tk-agenda-item"
                      aria-pressed={chosen}
                      onClick={() => selectEvent(event)}
                    >
                      <time dateTime={dateKey}>{fullDate(dateKey)}</time>
                      <strong>{event.entry.opportunity.title}</strong>
                      <span>{KIND_MARK[event.kind]} · {formatClockTime(event.entry.opportunity.guidance.whenUtc, clock)}</span>
                    </button>
                  </li>
                );
              })}
              {events.length === 0 ? (
                <li className="tk-agenda-empty">No supported events match this filter in {monthLabel}.</li>
              ) : null}
            </ol>
          </>
        )}
      </section>

      <aside className="tk-month-detail" aria-label="Selected event" tabIndex={-1} ref={detailRef}>
        {planning.status === "ready" && featured ? (
          <>
            <p className="tk-feature-kind">
              {KIND_MARK[featured.kind]} · {fullDate(featured.plan.dateKey)}
            </p>
            <h2 className="tk-feature-name">{featured.entry.opportunity.title}</h2>
            {sameDateEvents.length > 1 ? (
              <div className="tk-date-events" aria-label={`Events on ${fullDate(featured.plan.dateKey)}`}>
                <p>Also on this date</p>
                {sameDateEvents.map((event) => (
                  <button
                    key={eventKey(event)}
                    type="button"
                    aria-pressed={eventKey(event) === featuredKey}
                    onClick={() => selectEvent(event)}
                  >
                    {event.entry.opportunity.title}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="tk-feature-why">{featured.reason}</p>
            <p className="tk-feature-summary">{featured.entry.opportunity.summary}</p>

            <dl className="tk-feature-facts">
              <div>
                <dt>Best around</dt>
                <dd>{formatClockTime(featured.entry.opportunity.guidance.whenUtc, clock)}</dd>
              </div>
              <div>
                <dt>Where</dt>
                <dd>{featured.entry.opportunity.guidance.direction ?? "Overhead"}</dd>
              </div>
            </dl>

            <TrackerScienceDetails opportunity={featured.entry.opportunity} clock={clock} />
            <p className="tk-feature-guidance">{featured.entry.opportunity.guidance.elevation}</p>
            <p className="tk-media-expectation">
              <strong>What you can expect:</strong> {featured.entry.opportunity.guidance.appearance}
            </p>

            <div className="tk-month-actions">
            <button
              type="button"
              className="tk-action is-primary"
              onClick={() => onSelectEvent(featured)}
            >
              Open event
            </button>
            <button
              type="button"
              className="tracker-secondary tk-feature-action"
              onClick={() => {
                const opportunity = featured.entry.opportunity;
                downloadCalendarFile({
                  title: `${opportunity.title} — Orbit Studio Tracker`,
                  description: [
                    opportunity.summary,
                    opportunity.guidance.direction ? `Face ${opportunity.guidance.direction}.` : "",
                    opportunity.guidance.elevation,
                    opportunity.guidance.appearance,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                  startUtc: opportunity.guidance.whenUtc,
                  durationMinutes: opportunity.guidance.durationMinutes,
                  remindMinutesBefore: 20,
                });
              }}
            >
              Remind me
            </button>
            </div>
          </>
        ) : planning.status === "ready" ? (
          <p className="tk-view-lede">
            Nothing in {monthLabel} matches this supported phenomenon filter from {place.name}.
          </p>
        ) : (
          <p className="tk-view-lede">The selected event will appear when planning is complete.</p>
        )}
      </aside>
    </div>
  );
}
