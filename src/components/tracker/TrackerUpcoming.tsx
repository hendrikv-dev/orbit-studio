import { useMemo, useState } from "react";
import {
  SELECTABLE_PHENOMENON_CATEGORIES,
  type PhenomenonCategoryId,
} from "../../data/tracker/phenomenonCategories";
import type { TrackerLocation } from "../../data/tracker/trackerNavigation";
import {
  buildUpcomingEvents,
  filterUpcoming,
} from "../../data/tracker/upcomingEvents";
import type { AuroraConditions } from "../../data/tracker/aurora";
import type {
  ConditionSnapshot,
  EnvironmentalEvidenceStatus,
} from "../../data/tracker/conditions";
import { DEFAULT_HORIZON_NIGHTS } from "../../data/tracker/schedule";
import type { TrackerPlanningRequest } from "../../data/tracker/planningProtocol";
import type { PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";
import { TrackerHighlights } from "./TrackerHighlights";
import { TrackerUpcomingList } from "./TrackerUpcomingList";
import { TrackerMonth } from "./TrackerMonth";
import { TrackerPlanningStatus } from "./TrackerPlanningStatus";
import { UpcomingEventPage } from "./UpcomingEventPage";
import { useTrackerPlans } from "./useTrackerPlans";

/**
 * Everything beyond tonight, in two ways of looking at the same data.
 *
 * List and Calendar are representations, not destinations. That is the whole
 * reason Calendar is here rather than in the header: "what falls on the 14th"
 * is not a different question from "what is coming up", it is the same answer
 * arranged by date, and promoting it to a global mode implied Tracker had four
 * things to say when it has two.
 *
 * ## One pipeline
 *
 * This component owns the event generation for both. It used to own it for
 * neither: List merged its own sources here and Calendar ran a second,
 * unrelated pipeline inside itself, so the two disagreed about what an event
 * was — solar eclipses existed in one and not the other. Now the range changes
 * with the mode, the planner is asked once, `buildUpcomingEvents` produces one
 * array, and the two children render it differently.
 *
 * Selecting anything in either representation opens the universal event page —
 * the same component Tonight uses, with the same geometry.
 */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
  planAnchor: Date;
  now: Date;
  auroraConditions: AuroraConditions | null;
  snapshots: ConditionSnapshot[];
  evidenceStatus: EnvironmentalEvidenceStatus;
  /**
   * Browse state, owned by the history rather than by this component.
   *
   * Mode, filter, month and the opened event used to be local `useState`, which
   * is why Back could not restore them: they existed nowhere the browser could
   * see. They are props now so that one entry describes one screen.
   */
  location: TrackerLocation;
  onNavigate: (next: Partial<TrackerLocation>, options?: { replace?: boolean }) => void;
  onBack: (fallback: Partial<TrackerLocation>) => void;
}

export function TrackerUpcoming({
  place,
  clock,
  planAnchor,
  now,
  auroraConditions,
  snapshots,
  evidenceStatus,
  location,
  onNavigate,
  onBack,
}: Props) {
  const [retryNonce, setRetryNonce] = useState(0);

  const mode = location.mode;
  const category = location.category;
  const selectedId = location.eventId;
  const setMode = (next: "gallery" | "list" | "calendar") => onNavigate({ mode: next });
  const setCategory = (next: PhenomenonCategoryId) => onNavigate({ category: next });
  const setSelectedId = (id: string | null) => onNavigate({ eventId: id });

  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: clock.timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  // The month defaults to the one the reader is in, but once they have moved it
  // the location carries it, so Back onto this page returns to the month they
  // were looking at rather than to today.
  const cursor = {
    year: location.year ?? Number(todayParts.find((part) => part.type === "year")?.value),
    month: location.month ?? Number(todayParts.find((part) => part.type === "month")?.value),
  };
  const setCursor = (next: { year: number; month: number }) =>
    onNavigate({ year: next.year, month: next.month });

  /**
   * What the planner is asked for, which follows the mode.
   *
   * A list wants the next month of nights from now; a calendar wants the month
   * on screen. Both produce `NightPlan[]`, and everything downstream treats
   * them identically — the range is the only difference between the two views
   * at the data layer.
   */
  const request = useMemo<TrackerPlanningRequest>(
    () =>
      mode === "calendar"
        ? {
            kind: "month",
            latitudeDeg: place.latitude,
            longitudeDeg: place.longitude,
            year: cursor.year,
            month: cursor.month,
            timeZone: clock.timeZone,
          }
        : {
            kind: "nights",
            latitudeDeg: place.latitude,
            longitudeDeg: place.longitude,
            fromUtc: planAnchor.toISOString(),
            nights: DEFAULT_HORIZON_NIGHTS,
            timeZone: clock.timeZone,
          },
    [mode, cursor.year, cursor.month, place.latitude, place.longitude, planAnchor, clock.timeZone],
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
            // A month view can legitimately hold more than the list features.
            // The gallery is bounded by how many cards fit; a list is bounded
            // by how much is worth planning for, which is more.
            notableLimit: mode === "calendar" ? 20 : mode === "list" ? 24 : 12,
          })
        : [],
    [
      auroraConditions,
      clock.timeZone,
      mode,
      now,
      place.latitude,
      place.longitude,
      planAnchor,
      planning,
    ],
  );

  const visible = useMemo(() => filterUpcoming(events, category), [category, events]);

  const selected = selectedId
    ? events.find((event) => event.id === selectedId) ?? null
    : null;

  if (selected) {
    return (
      <section className="tk-view tk-upcoming" aria-label="Upcoming">
        <UpcomingEventPage
          event={selected}
          events={visible.length > 0 ? visible : events}
          place={place}
          clock={clock}
          now={now}
          snapshots={snapshots}
          evidenceStatus={evidenceStatus}
          auroraConditions={auroraConditions}
          onSelectEvent={(id) => onNavigate({ eventId: id, drill: null })}
          onBack={() => onBack({ eventId: null, drill: null })}
          drill={location.drill}
          onOpenDrill={(kind) => onNavigate({ drill: kind })}
          onCloseDrill={() => onBack({ drill: null })}
        />
      </section>
    );
  }

  return (
    <section className="tk-view tk-upcoming" aria-label="Upcoming">
      <div className="tk-upcoming-bar">
        <div>
          <h1 className="tk-upcoming-title">Upcoming</h1>
          <p className="tk-upcoming-lede">
            {mode !== "calendar"
              ? `Worth planning for from ${place.name}, soonest first.`
              : `Marked dates are the ones worth knowing about from ${place.name}.`}
          </p>
        </div>
        <div className="tk-upcoming-controls">
          <label className="tk-phenomenon-filter">
            <span>Show</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as PhenomenonCategoryId)}
            >
              <option value="all">All phenomena</option>
              {SELECTABLE_PHENOMENON_CATEGORIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                  {entry.support === "partial" ? " (limited horizon)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="tk-mode" role="tablist" aria-label="How to browse">
            {(["gallery", "list", "calendar"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={mode === entry}
                aria-controls={`tracker-${entry}-panel`}
                id={`tracker-${entry}-tab`}
                className="tk-mode-item"
                onClick={() => setMode(entry)}
              >
                {entry === "gallery" ? "Gallery" : entry === "list" ? "List" : "Calendar"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        role="tabpanel"
        id={`tracker-${mode}-panel`}
        aria-labelledby={`tracker-${mode}-tab`}
        className="tk-upcoming-panel"
      >
        {mode !== "calendar" ? (
          planning.status === "loading" ? (
            <div className="tk-highlights" data-planning-state="loading">
              <TrackerPlanningStatus
                status="loading"
                completed={planning.completed}
                total={planning.total}
              />
            </div>
          ) : planning.status === "error" ? (
            <div className="tk-highlights" data-planning-state="error">
              <TrackerPlanningStatus
                status="error"
                completed={planning.completed}
                total={planning.total}
                message={planning.message}
                onRetry={() => setRetryNonce((value) => value + 1)}
              />
            </div>
          ) : mode === "list" && visible.length > 0 ? (
            <TrackerUpcomingList
              events={visible}
              place={place}
              clock={clock}
              onSelect={setSelectedId}
            />
          ) : (
            <TrackerHighlights
              events={visible}
              place={place}
              clock={clock}
              category={category}
              onSelect={setSelectedId}
              onGoTonight={() =>
                onNavigate({ view: "tonight", eventId: null, drill: null })
              }
            />
          )
        ) : (
          <TrackerMonth
            place={place}
            clock={clock}
            now={now}
            events={visible}
            cursor={cursor}
            onNavigate={setCursor}
            planning={planning}
            onRetry={() => setRetryNonce((value) => value + 1)}
            onSelectEvent={setSelectedId}
          />
        )}
      </div>
    </section>
  );
}
