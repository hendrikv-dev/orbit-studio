import { useMemo, useState } from "react";
import {
  SELECTABLE_PHENOMENON_CATEGORIES,
  type PhenomenonCategoryId,
} from "../../data/tracker/phenomenonCategories";
import {
  auroraRiskFor,
  filterUpcoming,
  mergeUpcoming,
  notableUpcomingEvents,
  solarEclipsesFor,
  type UpcomingEvent,
} from "../../data/tracker/upcomingEvents";
import { categoryForOpportunityKind } from "../../data/tracker/eventCategories";
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
 * Selecting anything in either representation opens the universal event page —
 * the same component Tonight uses, with the same geometry — rather than a
 * detail panel that only exists here.
 */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
  planAnchor: Date;
  now: Date;
  auroraConditions: AuroraConditions | null;
  snapshots: ConditionSnapshot[];
  evidenceStatus: EnvironmentalEvidenceStatus;
}

export function TrackerUpcoming({
  place,
  clock,
  planAnchor,
  now,
  auroraConditions,
  snapshots,
  evidenceStatus,
}: Props) {
  const [mode, setMode] = useState<"list" | "calendar">("list");
  const [category, setCategory] = useState<PhenomenonCategoryId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Events opened from a month the horizon list never reached.
   *
   * Calendar navigates by month and computes on demand, so it can surface a
   * night in November that the thirty-night list has no entry for. Adopting it
   * here keeps one selection model — everything that can be opened lives in one
   * array — instead of Calendar growing a second, parallel way to open things.
   */
  const [adopted, setAdopted] = useState<UpcomingEvent[]>([]);

  const request = useMemo<TrackerPlanningRequest>(
    () => ({
      kind: "nights",
      latitudeDeg: place.latitude,
      longitudeDeg: place.longitude,
      fromUtc: planAnchor.toISOString(),
      nights: DEFAULT_HORIZON_NIGHTS,
      timeZone: clock.timeZone,
    }),
    [place.latitude, place.longitude, planAnchor, clock.timeZone],
  );
  const [retryNonce, setRetryNonce] = useState(0);
  const planning = useTrackerPlans(request, retryNonce);

  /**
   * Eclipses of the Sun, computed here rather than in the planning worker.
   *
   * The worker generates observing *nights*, and a solar eclipse happens in
   * daylight — it belongs to no night and would never appear in a plan however
   * far ahead the worker looked. This is the layer where that structural gap is
   * closed, and it is also why the previous version had no solar events at all.
   */
  const solarEclipses = useMemo(
    () => solarEclipsesFor(place.latitude, place.longitude, planAnchor, clock.timeZone),
    [clock.timeZone, place.latitude, place.longitude, planAnchor],
  );

  const auroraRisk = useMemo(
    () => auroraRiskFor(auroraConditions, now, clock.timeZone),
    [auroraConditions, clock.timeZone, now],
  );

  const events = useMemo(() => {
    const notable = planning.status === "ready" ? notableUpcomingEvents(planning.plans, 12) : [];
    const known = new Set(notable.map((entry) => entry.id));
    return mergeUpcoming(
      notable,
      solarEclipses,
      auroraRisk,
      adopted.filter((entry) => !known.has(entry.id)),
    );
  }, [adopted, auroraRisk, planning, solarEclipses]);

  const visible = useMemo(
    () => filterUpcoming(events, category === "all" ? "all" : category),
    [category, events],
  );

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
          onSelectEvent={(id) => setSelectedId(id)}
          onBack={() => setSelectedId(null)}
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
            {mode === "list"
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
            {(["list", "calendar"] as const).map((entry) => (
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
                {entry === "list" ? "List" : "Calendar"}
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
        {mode === "list" ? (
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
          ) : (
            <TrackerHighlights
              events={visible}
              place={place}
              clock={clock}
              onSelect={setSelectedId}
            />
          )
        ) : (
          <TrackerMonth
            place={place}
            clock={clock}
            now={now}
            category={category}
            onSelectEvent={(notable) => {
              const id = `${notable.plan.dateKey}:${notable.entry.opportunity.id}`;
              if (!events.some((entry) => entry.id === id)) {
                setAdopted((current) => [
                  ...current,
                  {
                    kind: "notable",
                    id,
                    dateKey: notable.plan.dateKey,
                    atUtc: notable.entry.opportunity.guidance.whenUtc,
                    category: categoryForOpportunityKind(notable.entry.opportunity.kind),
                    title: notable.entry.opportunity.title,
                    label: "Calendar event",
                    reason: notable.reason,
                    notable,
                  },
                ]);
              }
              setSelectedId(id);
            }}
          />
        )}
      </div>
    </section>
  );
}
