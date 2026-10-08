import { useMemo } from "react";
import { Bell, CalendarClock, ChevronRight, CloudOff, Telescope } from "lucide-react";

import type { AuroraConditions } from "../../../data/tracker/aurora";
import type { EnvironmentalEvidence } from "../../../data/tracker/conditions";
import {
  NEXT_BEST_HORIZON_NIGHTS,
  chanceDateLabel,
  findNextBestChance,
  recoveryContent,
  recoveryCopy,
  type NextBestChance,
} from "../../../data/tracker/nextBestChance";
import type { EquipmentRule } from "../../../data/tracker/observingRules";
import {
  upcomingPlanningRequest,
  upcomingRangeEnd,
} from "../../../data/tracker/upcomingDiscovery";
import { buildUpcomingEvents } from "../../../data/tracker/upcomingEvents";
import { trackerPlanningKey } from "../../../data/tracker/planningProtocol";
import { formatClockRange, formatClockTime, type PlaceClock } from "../../../lib/localTime";
import { downloadCalendarFile } from "../../../lib/trackerCalendar";
import type { SelectedPlace } from "../TrackerPlace";
import { useTrackerPlans } from "../useTrackerPlans";

interface Props {
  place: SelectedPlace;
  clock: PlaceClock;
  planAnchor: Date;
  anchorPlanIdentityKey: string;
  selectedDate: string;
  today: string;
  now: Date;
  evidence: EnvironmentalEvidence;
  equipment: EquipmentRule;
  artificialLightRadiance: number | null;
  auroraConditions: AuroraConditions | null;
  withheldByCloud: number;
  currentRecommendationCount: number;
  onShowChance: (chance: NextBestChance) => void;
  onOpenUpcoming: () => void;
}

const QUALITY_LABEL = { excellent: "Excellent", good: "Good" } as const;

/**
 * Tonight's recovery path, mounted only while the current recommendation list
 * is empty. Its 30-night request is exactly the request Upcoming makes, so the
 * expensive plan is shared and opening the sheet is warm rather than parallel.
 * The planner remains authoritative; this component only gives its answer a
 * purpose-built briefing hierarchy instead of disguising it as a rail card.
 */
export function TrackerRecoveryBriefing({
  place,
  clock,
  planAnchor,
  anchorPlanIdentityKey,
  selectedDate,
  today,
  now,
  evidence,
  equipment,
  artificialLightRadiance,
  auroraConditions,
  withheldByCloud,
  currentRecommendationCount,
  onShowChance,
  onOpenUpcoming,
}: Props) {
  const request = useMemo(
    () =>
      upcomingPlanningRequest({
        latitudeDeg: place.latitude,
        longitudeDeg: place.longitude,
        from: planAnchor,
        timeZone: clock.timeZone,
        range: "30-days",
      }),
    [clock.timeZone, place.latitude, place.longitude, planAnchor],
  );
  const planning = useTrackerPlans(request);
  const planningKey = trackerPlanningKey(request);
  const observerIdentity = `${place.latitude},${place.longitude}`;

  const chance = useMemo(
    () =>
      planning.status === "ready"
        ? findNextBestChance({
            plans: planning.plans,
            evidence,
            equipment,
            observer: {
              latitudeDeg: place.latitude,
              longitudeDeg: place.longitude,
              timeZone: clock.timeZone,
            },
            anchorPlanIdentityKey,
            artificialLightRadiance,
            now,
            horizonNights: NEXT_BEST_HORIZON_NIGHTS,
          })
        : null,
    [
      anchorPlanIdentityKey,
      artificialLightRadiance,
      clock.timeZone,
      equipment,
      evidence,
      now,
      place.latitude,
      place.longitude,
      planning,
    ],
  );

  const upcomingEvents = useMemo(
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
            until: upcomingRangeEnd(planAnchor, "30-days"),
            notableLimit: 24,
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
    ],
  );

  const summary = recoveryCopy({ withheldByCloud, selectedDate, today });
  const content = recoveryContent({
    currentRecommendationCount,
    chance,
    upcomingEvents,
  });

  const contextCard = (
    <aside
      className="tk-recovery-context"
      data-card="recovery-summary"
      data-recovery-reason={withheldByCloud > 0 ? "cloud" : "ineligible"}
      data-recovery-observer={observerIdentity}
      data-recovery-planning-key={planningKey}
    >
      <div className="tk-recovery-context-copy">
        <span className="tk-recovery-icon" aria-hidden>
          {withheldByCloud > 0 ? <CloudOff size={21} /> : <Telescope size={21} />}
        </span>
        <span>
          <strong>{summary.title}</strong>
          <small>{summary.detail}</small>
        </span>
      </div>
    </aside>
  );

  const futureCard = planning.status === "loading" ? (
        <article
          className="tk-recovery-answer is-loading"
          data-card="recovery-loading"
          data-recovery-kind="loading"
          data-recovery-observer={observerIdentity}
          data-recovery-planning-key={planningKey}
          aria-hidden
        >
          <span className="tk-map-skeleton is-title" />
          <span className="tk-map-skeleton is-line" />
        </article>
      ) : content?.kind === "chance" ? (
        <ChanceCard
          chance={content.chance}
          clock={clock}
          selectedDate={selectedDate}
          today={today}
          observerIdentity={observerIdentity}
          planningKey={planningKey}
          onShow={() => onShowChance(content.chance)}
        />
      ) : content?.kind === "upcoming" ? (
        <article
          className="tk-recovery-answer"
          data-card="recovery-upcoming"
          data-recovery-kind="upcoming"
          data-recovery-date={content.event.dateKey}
          data-recovery-target={content.event.id}
          data-recovery-observer={observerIdentity}
          data-recovery-planning-key={planningKey}
        >
          <button
            type="button"
            className="tk-recovery-answer-main"
            onClick={onOpenUpcoming}
            aria-label={`Open Upcoming for ${content.event.title}`}
          >
            <span className="tk-recovery-icon" aria-hidden>
              <CalendarClock size={21} />
            </span>
            <span className="tk-recovery-answer-copy">
              <span className="tk-recovery-kicker">Next notable event</span>
              <strong>{content.event.title}</strong>
              <span>
                {chanceDateLabel(content.event.dateKey, selectedDate, today)} · {formatClockTime(content.event.atUtc, clock)}
              </span>
              <small>{content.event.label} · Open Upcoming</small>
            </span>
            <ChevronRight size={15} aria-hidden />
          </button>
        </article>
      ) : (
        <article
          className="tk-recovery-answer"
          data-card="recovery-none"
          data-recovery-kind={planning.status === "error" ? "error" : "none"}
          data-recovery-observer={observerIdentity}
          data-recovery-planning-key={planningKey}
        >
          <button
            type="button"
            className="tk-recovery-answer-main"
            onClick={onOpenUpcoming}
            aria-label="Open Upcoming to look farther ahead"
          >
            <span className="tk-recovery-icon" aria-hidden>
              <CalendarClock size={21} />
            </span>
            <span className="tk-recovery-answer-copy">
              <span className="tk-recovery-kicker">Look farther ahead</span>
              <strong>Open Upcoming</strong>
              <span>No forecast-backed chance in 7 nights</span>
              <small>Browse notable events without lowering the bar</small>
            </span>
            <ChevronRight size={15} aria-hidden />
          </button>
        </article>
      );

  return (
    <>
      {/* The answer comes first in DOM and visual order. On a phone this keeps
          the next useful opportunity in the initial viewport without a swipe;
          tonight's miss remains concise supporting context. */}
      {futureCard}
      {contextCard}
    </>
  );
}

function ChanceCard({
  chance,
  clock,
  selectedDate,
  today,
  observerIdentity,
  planningKey,
  onShow,
}: {
  chance: NextBestChance;
  clock: PlaceClock;
  selectedDate: string;
  today: string;
  observerIdentity: string;
  planningKey: string;
  onShow: () => void;
}) {
  const when = chance.brief
    ? formatClockTime(chance.peakUtc, clock)
    : formatClockRange(chance.startUtc, chance.endUtc, clock);
  return (
    <article
      className="tk-recovery-answer"
      data-card="next-best-chance"
      data-recovery-kind="chance"
      data-plan-identity={chance.planIdentityKey}
      data-chance-date={chance.dateKey}
      data-chance-target={chance.opportunityId}
      data-recovery-date={chance.dateKey}
      data-recovery-target={chance.opportunityId}
      data-recovery-observer={observerIdentity}
      data-recovery-planning-key={planningKey}
    >
      <button
        type="button"
        className="tk-recovery-answer-main"
        onClick={onShow}
        aria-label={`Show ${chance.title} on ${chance.dateKey}`}
      >
        <span className="tk-recovery-icon" aria-hidden>
          <CalendarClock size={21} />
        </span>
        <span className="tk-recovery-answer-copy">
          <span className="tk-recovery-kicker">Next best chance</span>
          <strong>{chance.title}</strong>
          <span>
            {chanceDateLabel(chance.dateKey, selectedDate, today)} · {when}
          </span>
          <small>
            {chance.where} · {QUALITY_LABEL[chance.quality]}
          </small>
        </span>
        <ChevronRight size={15} aria-hidden />
      </button>
      <div className="tk-recovery-meta">
        <span>{chance.forecastNote}</span>
        <button
          type="button"
          onClick={() =>
            downloadCalendarFile({
              ...chance.reminder,
              remindMinutesBefore: 20,
            })
          }
        >
          <Bell size={12} aria-hidden />
          Remind me
        </button>
      </div>
    </article>
  );
}
