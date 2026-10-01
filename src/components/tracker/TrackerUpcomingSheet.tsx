import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, ChevronRight, X } from "lucide-react";

import type { AuroraConditions } from "../../data/tracker/aurora";
import {
  UPCOMING_RANGES,
  upcomingLocalContext,
  upcomingPlanningRequest,
  upcomingRange,
  upcomingRangeEnd,
  type UpcomingRangeId,
} from "../../data/tracker/upcomingDiscovery";
import { buildUpcomingEvents, type UpcomingEvent } from "../../data/tracker/upcomingEvents";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";
import { TrackerPlanningStatus } from "./TrackerPlanningStatus";
import { useTrackerPlans } from "./useTrackerPlans";

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
  planAnchor: Date;
  now: Date;
  auroraConditions: AuroraConditions | null;
  onClose: () => void;
  onShowNight: (event: UpcomingEvent) => void;
}

function dateLabel(dateKey: string): { day: string; month: string; weekday: string } {
  const at = new Date(`${dateKey}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat(undefined, { day: "numeric", timeZone: "UTC" }).format(at),
    month: new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(at),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(at),
  };
}

function shortPlaceName(place: SelectedPlace): string {
  if (/^where you are$/i.test(place.name.trim())) return "your location";
  return place.name.split(",")[0]?.trim() || place.name;
}

/**
 * Future discovery without leaving the map.
 *
 * This is deliberately a non-modal dialog. The visual reference keeps the
 * location controls live above the sheet, and that is functionally important:
 * changing the observing place while Upcoming is open must replace the list in
 * place. A modal would make that acceptance criterion impossible by making the
 * location control inert.
 */
export function TrackerUpcomingSheet({
  place,
  clock,
  planAnchor,
  now,
  auroraConditions,
  onClose,
  onShowNight,
}: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [rangeId, setRangeId] = useState<UpcomingRangeId>("30-days");
  const [retryNonce, setRetryNonce] = useState(0);
  const range = upcomingRange(rangeId);
  const request = useMemo(
    () =>
      upcomingPlanningRequest({
        latitudeDeg: place.latitude,
        longitudeDeg: place.longitude,
        from: planAnchor,
        timeZone: clock.timeZone,
        range: rangeId,
      }),
    [clock.timeZone, place.latitude, place.longitude, planAnchor, rangeId],
  );
  const planning = useTrackerPlans(request, retryNonce);
  const events = useMemo(
    () =>
      planning.status === "ready"
        ? buildUpcomingEvents({
            plans: planning.plans,
            latitudeDeg: place.latitude,
            longitudeDeg: place.longitude,
            timeZone: clock.timeZone,
            auroraConditions,
            now,
            from: planAnchor,
            until: upcomingRangeEnd(planAnchor, rangeId),
            notableLimit: range.notableLimit,
          })
        : [],
    [
      auroraConditions,
      clock.timeZone,
      now,
      place.latitude,
      place.longitude,
      planAnchor,
      planning,
      range.notableLimit,
      rangeId,
    ],
  );

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const placeLabel = shortPlaceName(place);
  const countLabel =
    planning.status === "ready"
      ? `${events.length} notable ${events.length === 1 ? "event" : "events"}`
      : `Recomputing for ${placeLabel}`;

  return (
    <section
      className="tk-upcoming-sheet"
      role="dialog"
      aria-modal="false"
      aria-labelledby="tracker-upcoming-title"
      data-planning-state={planning.status}
      data-upcoming-observer={`${place.latitude},${place.longitude}`}
      data-upcoming-plan-observer={
        planning.status === "ready" && planning.plans[0]
          ? `${planning.plans[0].identity.latitudeDeg},${planning.plans[0].identity.longitudeDeg}`
          : undefined
      }
      data-upcoming-range={rangeId}
    >
      <span className="tk-upcoming-sheet-handle" aria-hidden />
      <header className="tk-upcoming-sheet-head">
        <div>
          <span className="tk-upcoming-sheet-kicker">
            <CalendarRange size={14} aria-hidden />
            {countLabel}
          </span>
          <h2 id="tracker-upcoming-title">Upcoming</h2>
          <p>Notable sky events from {placeLabel}, soonest first.</p>
        </div>
        <button
          ref={closeButton}
          type="button"
          className="tk-icon-button"
          onClick={onClose}
          aria-label="Close Upcoming"
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      <div className="tk-upcoming-ranges" aria-label="Upcoming range">
        {UPCOMING_RANGES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-label={`Show the next ${entry.days === 365 ? "year" : `${entry.days} days`}`}
            aria-pressed={rangeId === entry.id}
            onClick={() => setRangeId(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="tk-upcoming-sheet-body">
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
            onRetry={() => setRetryNonce((value) => value + 1)}
          />
        ) : events.length === 0 ? (
          <div className="tk-upcoming-empty" role="status">
            <strong>No notable events in this range.</strong>
            <span>Try a longer range. Tracker will not promote routine nights just to fill the list.</span>
          </div>
        ) : (
          <ol className="tk-upcoming-sheet-list">
            {events.map((event) => {
              const date = dateLabel(event.dateKey);
              return (
                <li key={event.id} data-upcoming-event={event.id}>
                  <button
                    type="button"
                    onClick={() => onShowNight(event)}
                    aria-label={`Show ${event.title} on ${event.dateKey} on the map`}
                  >
                    <time dateTime={event.dateKey} className="tk-upcoming-sheet-date">
                      <span>{date.weekday}</span>
                      <strong>{date.day}</strong>
                      <span>{date.month}</span>
                    </time>
                    <span className="tk-upcoming-sheet-copy">
                      <strong>{event.title}</strong>
                      <span className="tk-upcoming-sheet-timing">
                        {event.timing.label} · {event.timing.text ?? formatClockTime(event.timing.atUtc, clock)}
                      </span>
                      <span className="tk-upcoming-sheet-local">{upcomingLocalContext(event)}</span>
                      <span className="tk-upcoming-sheet-reason">{event.reason}</span>
                    </span>
                    <ChevronRight size={17} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
