import { useMemo, useState } from "react";
import { heroImageryFor } from "../../data/tracker/imagery";
import {
  DEFAULT_HORIZON_NIGHTS,
  notableEvents,
  planNights,
  type NotableEvent,
} from "../../data/tracker/schedule";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";
import { TrackerScene } from "./TrackerScene";

/**
 * One future event worth planning around, with a strip to change which one.
 *
 * This replaces a vertical list of future nights. The list was the wrong
 * interaction model rather than a badly styled one: it invited scrolling
 * through thirty rows to compare nights that were mostly the same night, and
 * because it ranked by what was above the horizon, Saturn appeared on five
 * consecutive dates as five separate things to consider.
 *
 * A diary does not work like that. There are a handful of dates in a month that
 * are worth moving something for, and the rest are ordinary. So one event holds
 * the screen, a short strip offers the others, and choosing one swaps the
 * feature in place — no scrolling, and no implication that the strip's contents
 * are of equal weight to the thing above them.
 *
 * Ordering is by significance and the interface says so, because a list that
 * mixed rarity and chronology silently would be unreadable in either direction.
 */

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
  horizonNights?: number;
}

/** "Thu 27 Aug", from a local calendar date. */
function dateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, day));
}

/** The same taxonomy the calendar marks dates with. One word per event type. */
const KIND_LABEL: Record<NotableEvent["kind"], string> = {
  eclipse: "Eclipse",
  "shower-peak": "Meteor peak",
  conjunction: "Conjunction",
  "moon-phase": "Moon phase",
  "best-placement": "Opposition",
};

export function TrackerCurated({ place, clock, horizonNights }: Props) {
  const events = useMemo(() => {
    const plans = planNights(
      place.latitude,
      place.longitude,
      new Date(),
      horizonNights ?? DEFAULT_HORIZON_NIGHTS,
      clock.timeZone,
    );
    return notableEvents(plans, 5);
  }, [place.latitude, place.longitude, horizonNights, clock.timeZone]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const featured =
    events.find((event) => `${event.plan.dateKey}:${event.entry.opportunity.id}` === selectedKey) ??
    events[0];

  if (!featured) {
    return (
      <div className="tk-curated tk-curated-empty">
        <h1 className="tk-display">Nothing to put in the diary</h1>
        <p className="tk-view-lede">
          No eclipse, shower peak or close pairing falls in the next month from {place.name}.
          Tonight is still worth checking.
        </p>
      </div>
    );
  }

  const { opportunity, guidance } = {
    opportunity: featured.entry.opportunity,
    guidance: featured.entry.opportunity.guidance,
  };
  const imagery = heroImageryFor(opportunity.id, opportunity.kind);

  return (
    <div className="tk-curated">
      <article className="tk-feature">
        <div className="tk-feature-text">
          <p className="tk-feature-kind">
            {KIND_LABEL[featured.kind]} · {dateLabel(featured.plan.dateKey)}
          </p>
          <h1 className="tk-feature-name">{opportunity.title}</h1>
          <p className="tk-feature-why">{featured.reason}</p>
          <p className="tk-feature-summary">{opportunity.summary}</p>

          <dl className="tk-feature-facts">
            <div>
              <dt>Best around</dt>
              <dd>{formatClockTime(guidance.whenUtc, clock)}</dd>
            </div>
            <div>
              <dt>Needs</dt>
              <dd>
                {guidance.equipment === "eyes"
                  ? "Eyes only"
                  : guidance.equipment === "binoculars"
                    ? "Binoculars"
                    : "Telescope"}
              </dd>
            </div>
            <div>
              <dt>From here</dt>
              <dd>{guidance.direction ?? "Overhead"}</dd>
            </div>
          </dl>

          <button type="button" className="tracker-primary tk-feature-action">
            Remind me
          </button>
        </div>

        {/* The media region. Static for now — see the note in the report about
            which motion assets are still missing; nothing here is fabricated to
            fill the space. */}
        <figure className="tk-feature-media">
          <TrackerScene
            imagery={imagery}
            priority
            showCredit
            illuminatedFraction={opportunity.sceneHints?.illuminatedFraction ?? 0.5}
            waning={opportunity.sceneHints?.waning ?? false}
          />
        </figure>
      </article>

      {/* Navigation between features, not a collection of equal cards. */}
      {events.length > 1 ? (
        <nav className="tk-strip" aria-label="Other notable events">
          <p className="tk-strip-label">Also worth planning for · most significant first</p>
          <ul>
            {events.map((event) => {
              const key = `${event.plan.dateKey}:${event.entry.opportunity.id}`;
              const isFeatured = event === featured;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="tk-strip-item"
                    aria-current={isFeatured ? "true" : undefined}
                    onClick={() => setSelectedKey(key)}
                  >
                    <span className="tk-strip-date">{dateLabel(event.plan.dateKey)}</span>
                    <span className="tk-strip-name">{event.entry.opportunity.title}</span>
                    <span className="tk-strip-kind">{KIND_LABEL[event.kind]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
