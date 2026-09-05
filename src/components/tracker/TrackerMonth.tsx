import { useEffect, useMemo, useRef, useState } from "react";
import { groupUpcomingByDate, type UpcomingEvent } from "../../data/tracker/upcomingEvents";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import { downloadCalendarFile } from "../../lib/trackerCalendar";
import type { SelectedPlace } from "./TrackerPlace";
import { TrackerPlanningStatus } from "./TrackerPlanningStatus";
import { TrackerScienceDetails } from "./TrackerScienceDetails";
import type { TrackerPlansState } from "./useTrackerPlans";

/**
 * The month index, and an intentional small-screen agenda beside it.
 *
 * ## What changed, and why it matters
 *
 * This component used to run its own pipeline: its own planning request, its
 * own call to `notableEvents`, its own idea of what counted. The consequence
 * was not a styling difference — it was that List and Calendar *disagreed*.
 * A solar eclipse appeared in one and not the other, because eclipses are
 * produced by an eclipse search rather than by a night plan and only List knew
 * that. The aurora category could be selected here and could never match.
 *
 * Calendar is now a rendering of the same `UpcomingEvent[]` the list renders,
 * grouped by date. It generates nothing. If an event is in the array and falls
 * in the visible month, it is on the grid; if it is not in the array, it is not
 * an event, and that decision is made in one place for both views.
 */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
  now: Date;
  /** The canonical list, already filtered by category upstream. */
  events: UpcomingEvent[];
  /** Which month is on screen, owned by the parent so the plan can follow it. */
  cursor: { year: number; month: number };
  onNavigate: (cursor: { year: number; month: number }) => void;
  planning: TrackerPlansState;
  onRetry: () => void;
  /**
   * Open the event on the universal page.
   *
   * Calendar used to be the end of the road: it showed a date, a summary and a
   * reminder button, and everything the rest of the product knows about that
   * event was unreachable from here.
   */
  onSelectEvent: (id: string) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

/** The opportunity behind a notable event, where there is one. */
function opportunityOf(event: UpcomingEvent) {
  return event.kind === "notable" ? event.notable.entry.opportunity : null;
}

export function TrackerMonth({
  place,
  clock,
  now,
  events,
  cursor,
  onNavigate,
  planning,
  onRetry,
  onSelectEvent,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  const monthPrefix = `${cursor.year}-${String(cursor.month).padStart(2, "0")}`;
  // Only what falls in the visible month. The array itself spans whatever the
  // parent asked the planner for, which is deliberately not the same thing.
  const monthEvents = useMemo(
    () => events.filter((event) => event.dateKey.startsWith(monthPrefix)),
    [events, monthPrefix],
  );

  useEffect(() => {
    setSelectedId(null);
  }, [monthPrefix]);

  const byDate = useMemo(() => groupUpcomingByDate(monthEvents), [monthEvents]);

  const selected = selectedId
    ? monthEvents.find((event) => event.id === selectedId)
    : undefined;
  const featured = selected ?? monthEvents[0];
  const featuredId = featured?.id ?? null;
  const sameDateEvents = featured ? byDate.get(featured.dateKey) ?? [] : [];

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(cursor.year, cursor.month - 1, 1));
  const firstWeekday = (new Date(cursor.year, cursor.month - 1, 1).getDay() + 6) % 7;
  const dayCount = new Date(cursor.year, cursor.month, 0).getDate();
  const key = (day: number) =>
    `${monthPrefix}-${String(day).padStart(2, "0")}`;

  // Whether the whole month is behind us, so an empty grid can say why rather
  // than looking like a failure to load.
  const monthIsPast =
    new Date(cursor.year, cursor.month, 0, 23, 59, 59).getTime() < now.getTime();

  const step = (delta: number) => {
    setSelectedId(null);
    const next = cursor.month + delta;
    if (next < 1) onNavigate({ year: cursor.year - 1, month: 12 });
    else if (next > 12) onNavigate({ year: cursor.year + 1, month: 1 });
    else onNavigate({ year: cursor.year, month: next });
  };

  const selectEvent = (event: UpcomingEvent) => {
    setSelectedId(event.id);
    requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
  };

  const featuredOpportunity = featured ? opportunityOf(featured) : null;

  return (
    <div className="tk-month" data-planning-state={planning.status}>
      <section className="tk-month-grid-wrap" aria-label={monthLabel}>
        <div className="tk-month-bar">
          <button
            type="button"
            className="tk-month-step"
            onClick={() => step(-1)}
            aria-label="Previous month"
          >
            ←
          </button>
          <h3 className="tk-month-name" aria-live="polite">
            {monthLabel}
          </h3>
          <button
            type="button"
            className="tk-month-step"
            onClick={() => step(1)}
            aria-label="Next month"
          >
            →
          </button>
        </div>

        {planning.status === "loading" ? (
          <TrackerPlanningStatus
            status="loading"
            completed={planning.completed}
            total={planning.total}
          />
        ) : planning.status === "error" ? (
          <TrackerPlanningStatus
            status="error"
            completed={planning.completed}
            total={planning.total}
            message={planning.message}
            onRetry={onRetry}
          />
        ) : (
          <>
            <div className="tk-month-grid" aria-label={`${monthLabel} notable events`}>
              {WEEKDAYS.map((day) => (
                <span key={day} className="tk-month-weekday" aria-hidden="true">
                  {day}
                </span>
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
                      <time className="tk-day-num" dateTime={dateKey}>
                        {day}
                      </time>
                    </span>
                  );
                }
                const event = dateEvents[0];
                const chosen = dateEvents.some((entry) => entry.id === featuredId);
                const eventNames = dateEvents
                  .map((entry) => `${entry.label}: ${entry.title}`)
                  .join("; ");
                return (
                  <button
                    key={day}
                    type="button"
                    className="tk-day is-marked"
                    aria-label={`${fullDate(dateKey)} — ${dateEvents.length} ${
                      dateEvents.length === 1 ? "event" : "events"
                    }: ${eventNames}`}
                    aria-pressed={chosen}
                    data-kind={event.category}
                    onClick={() => selectEvent(event)}
                  >
                    <time className="tk-day-num" dateTime={dateKey}>
                      {day}
                    </time>
                    <span className="tk-day-mark" aria-hidden="true">
                      {event.label}
                      {dateEvents.length > 1 ? ` +${dateEvents.length - 1}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <ol className="tk-month-agenda" aria-label={`${monthLabel} notable events`}>
              {monthEvents.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    className="tk-agenda-item"
                    aria-pressed={event.id === featuredId}
                    onClick={() => selectEvent(event)}
                  >
                    <time dateTime={event.dateKey}>{fullDate(event.dateKey)}</time>
                    <strong>{event.title}</strong>
                    <span>
                      {event.label} · {formatClockTime(event.atUtc, clock)}
                    </span>
                  </button>
                </li>
              ))}
              {monthEvents.length === 0 ? (
                <li className="tk-agenda-empty">
                  {monthIsPast
                    ? `${monthLabel} has been and gone. Upcoming shows what is still ahead.`
                    : `Nothing in ${monthLabel} matches this filter from ${place.name}.`}
                </li>
              ) : null}
            </ol>
          </>
        )}
      </section>

      <aside className="tk-month-detail" aria-label="Selected event" tabIndex={-1} ref={detailRef}>
        {planning.status === "ready" && featured ? (
          <>
            <p className="tk-feature-kind">
              {featured.label} · {fullDate(featured.dateKey)}
            </p>
            <h3 className="tk-feature-name">{featured.title}</h3>
            {sameDateEvents.length > 1 ? (
              <div
                className="tk-date-events"
                aria-label={`Events on ${fullDate(featured.dateKey)}`}
              >
                <p>Also on this date</p>
                {sameDateEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    aria-pressed={event.id === featuredId}
                    onClick={() => selectEvent(event)}
                  >
                    {event.title}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="tk-feature-why">{featured.reason}</p>
            {featuredOpportunity ? (
              <p className="tk-feature-summary">{featuredOpportunity.summary}</p>
            ) : null}

            <dl className="tk-feature-facts">
              <div>
                <dt>Best around</dt>
                <dd>{formatClockTime(featured.atUtc, clock)}</dd>
              </div>
              <div>
                <dt>Where</dt>
                <dd>{featuredOpportunity?.guidance.direction ?? "Overhead"}</dd>
              </div>
            </dl>

            {featuredOpportunity ? (
              <>
                <TrackerScienceDetails opportunity={featuredOpportunity} clock={clock} />
                <p className="tk-feature-guidance">{featuredOpportunity.guidance.elevation}</p>
                <p className="tk-media-expectation">
                  <strong>What you can expect:</strong> {featuredOpportunity.guidance.appearance}
                </p>
              </>
            ) : null}

            <div className="tk-month-actions">
              <button
                type="button"
                className="tk-action is-primary"
                onClick={() => onSelectEvent(featured.id)}
              >
                Open event
              </button>
              <button
                type="button"
                className="tracker-secondary tk-feature-action"
                onClick={() =>
                  downloadCalendarFile({
                    title: `${featured.title} — Orbit Studio Tracker`,
                    description: [
                      featured.reason,
                      featuredOpportunity?.summary ?? "",
                      featuredOpportunity?.guidance.direction
                        ? `Face ${featuredOpportunity.guidance.direction}.`
                        : "",
                      featuredOpportunity?.guidance.appearance ?? "",
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                    startUtc: featured.atUtc,
                    durationMinutes: featuredOpportunity?.guidance.durationMinutes ?? 60,
                    remindMinutesBefore: 20,
                  })
                }
              >
                Remind me
              </button>
            </div>
          </>
        ) : planning.status === "ready" ? (
          <p className="tk-view-lede">
            {monthIsPast
              ? `${monthLabel} is behind us. Tracker shows what is still ahead rather than what has already happened.`
              : `Nothing in ${monthLabel} matches this filter from ${place.name}.`}
          </p>
        ) : (
          <p className="tk-view-lede">The selected event will appear when planning is complete.</p>
        )}
      </aside>
    </div>
  );
}
