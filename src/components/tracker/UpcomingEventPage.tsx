import { Suspense, lazy, useMemo, useState } from "react";
import { conditionCards } from "../../data/tracker/conditionCards";
import {
  bestViewingWindow,
  type ConditionSnapshot,
  type EnvironmentalEvidenceStatus,
} from "../../data/tracker/conditions";
import {
  presentAuroraEvent,
  presentSolarEclipseEvent,
  presentTonightEvent,
  visibilityMetric,
  type EventPresentation,
} from "../../data/tracker/eventPresentation";
import { heroImageryFor } from "../../data/tracker/imagery";
import { lunarVisibilityField } from "../../data/tracker/lunarEclipse";
import {
  coverageField,
  mapExtentFor,
  traceCentralPath,
} from "../../data/tracker/solarEclipse";
import type { SkyAdjustedOpportunity } from "../../data/tracker/opportunity";
import { skyPathFor, gazeRegionFor, type SkyPath } from "../../data/tracker/skyPath";
import { assessAurora, type AuroraConditions } from "../../data/tracker/aurora";
import type { UpcomingEvent } from "../../data/tracker/upcomingEvents";
import { downloadCalendarFile } from "../../lib/trackerCalendar";
import { formatClockRange, formatClockTime, type PlaceClock } from "../../lib/localTime";
import { PhenomenonPage } from "./PhenomenonPage";
import { TrackerOverlay } from "./TrackerOverlay";
import { TrackerSkyChart } from "./TrackerSkyChart";
import { TrackerAuroraArt } from "./viz/TrackerAuroraArt";
import { TrackerEclipseArt } from "./viz/TrackerEclipseArt";
/** Lazy for the same reason as the aurora map: it carries the coastlines. */
const TrackerEclipseMap = lazy(() =>
  import("./viz/TrackerEclipseMap").then((module) => ({ default: module.TrackerEclipseMap })),
);
import { TrackerNightActivity } from "./viz/TrackerNightActivity";
import { TrackerSkyPathPanel } from "./viz/TrackerSkyPathPanel";
import type { SelectedPlace } from "./TrackerPlace";
import type { RelevantEventRow } from "./RelevantEventsList";
import type { HeroMedia } from "./EventHero";

/**
 * A future event, on the same page as tonight's.
 *
 * "Selecting any event should open the same universal event-detail system" is
 * the requirement, and this is the literal implementation of it: the component
 * builds the same `EventPresentation`, the same condition cards and the same
 * ranked list, and hands them to the same `PhenomenonPage`. There is no
 * upcoming-event layout, because there is no second layout.
 *
 * What genuinely differs is what is knowable. An eclipse in eighteen months has
 * geometry accurate to the second and no weather at all, so the condition cards
 * say "Forecast closer to date" three times and give the Moon's phase — which
 * is the true state of knowledge and looks, correctly, thinner than tonight's.
 */

interface Props {
  event: UpcomingEvent;
  events: UpcomingEvent[];
  place: SelectedPlace;
  clock: PlaceClock;
  now: Date;
  snapshots: ConditionSnapshot[];
  evidenceStatus: EnvironmentalEvidenceStatus;
  auroraConditions: AuroraConditions | null;
  onSelectEvent: (id: string) => void;
  onBack: () => void;
}

export function UpcomingEventPage({
  event,
  events,
  place,
  clock,
  now,
  snapshots,
  evidenceStatus,
  auroraConditions,
  onSelectEvent,
  onBack,
}: Props) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const built = useMemo(
    () => buildPresentation(event, place, clock, now, snapshots, evidenceStatus, auroraConditions),
    [auroraConditions, clock, event, evidenceStatus, now, place, snapshots],
  );

  const conditions = useMemo(
    () =>
      conditionCards({
        atUtc: built.presentation.atUtc,
        latitudeDeg: place.latitude,
        longitudeDeg: place.longitude,
        snapshots,
        evidenceStatus,
        now,
        pending: false,
      }),
    [built.presentation.atUtc, evidenceStatus, now, place, snapshots],
  );

  // Rows are built without their visualizations. Tracing a shadow path and
  // sampling a coverage grid costs the better part of a second, and a list of
  // ten events containing one eclipse would pay it for a drawing no row shows.
  const rows = useMemo<RelevantEventRow[]>(() => {
    const category = built.presentation.categoryId;
    const presented = events.map((entry) => ({
      entry,
      built: buildPresentation(
        entry,
        place,
        clock,
        now,
        snapshots,
        evidenceStatus,
        auroraConditions,
        false,
      ),
    }));
    const matching = presented.filter((row) => row.built.presentation.categoryId === category);
    const others = presented.filter((row) => row.built.presentation.categoryId !== category);
    return [...matching, ...others].slice(0, 6).map((row) => ({
      presentation: row.built.presentation,
      imagery: row.built.media.kind === "imagery" ? row.built.media.imagery : null,
      thumb: row.built.media.kind === "drawn" ? row.built.media.node : undefined,
      illuminatedFraction:
        row.built.media.kind === "imagery" ? row.built.media.illuminatedFraction : undefined,
      waning: row.built.media.kind === "imagery" ? row.built.media.waning : undefined,
      active: row.entry.id === event.id,
    }));
  }, [
    auroraConditions,
    built.presentation.categoryId,
    clock,
    evidenceStatus,
    event.id,
    events,
    now,
    place,
    snapshots,
  ]);

  return (
    <>
    <PhenomenonPage
      categoryId={built.presentation.categoryId}
      mode="upcoming"
      presentation={built.presentation}
      media={built.media}
      visualization={built.visualization}
      conditions={conditions}
      conditionsCaption="Eclipse and Moon geometry computed on this device. Weather is only claimed inside the forecast horizon."
      evidenceStatus={evidenceStatus}
      rows={rows}
      onSelectEvent={(id) => {
        setOverlayOpen(false);
        onSelectEvent(id);
      }}
      onPrimaryAction={() => setOverlayOpen(true)}
      onReminder={() =>
        downloadCalendarFile({
          title: built.presentation.reminder.title,
          description: built.presentation.reminder.description,
          startUtc: built.presentation.reminder.startUtc,
          durationMinutes: built.presentation.reminder.durationMinutes,
          remindMinutesBefore: 60,
        })
      }
      safety={built.safety}
      expectation={built.expectation}
      listHeading="Also coming up"
      listCaption="Sorted by date, and by what is actually visible from here."
      back={{ label: "Back to Upcoming", onSelect: onBack }}
    />

    <TrackerOverlay
      open={overlayOpen}
      onClose={() => setOverlayOpen(false)}
      title={
        built.skyPath
          ? `Where to look — ${built.presentation.title}`
          : built.presentation.primaryAction.label
      }
      subtitle={
        built.skyPath
          ? "Real altitude and bearing for that night, from your location."
          : "Computed geometry for your location."
      }
    >
      {built.skyPath ? (
        <TrackerSkyChart
          path={built.skyPath}
          clock={clock}
          tone={built.presentation.categoryId}
          label={built.presentation.title}
        />
      ) : (
        <div className="tk-overlay-map">{built.visualization}</div>
      )}
    </TrackerOverlay>
    </>
  );
}

interface BuiltEvent {
  presentation: EventPresentation;
  media: HeroMedia;
  visualization: React.ReactNode;
  safety: string | null;
  expectation: string | null;
  /**
   * The geometry behind the hero's primary action, where the event has any.
   *
   * Null means the action opens the map instead. What it must never mean is
   * that the action does nothing — a control that opens an empty overlay is
   * the dashboard furniture this interface is supposed to be free of.
   */
  skyPath: SkyPath | null;
}

/**
 * Solar viewing safety, stated wherever a solar event appears.
 *
 * `TRACKER_PRD` R5.6 makes this mandatory and unsuppressable, and the status
 * document notes that the mechanism existed with nothing setting it: "the first
 * solar event added must". This is that event, and this is where it is set.
 */
const SOLAR_SAFETY =
  "Never look at the Sun without a certified solar filter — not through sunglasses, exposed film, smoked glass, or an unfiltered telescope or camera. Eclipse glasses must meet ISO 12312-2.";

function buildPresentation(
  event: UpcomingEvent,
  place: SelectedPlace,
  clock: PlaceClock,
  now: Date,
  snapshots: ConditionSnapshot[],
  evidenceStatus: EnvironmentalEvidenceStatus,
  auroraConditions: AuroraConditions | null,
  /** False for list rows, which need the words and not the drawing. */
  withVisualization = true,
): BuiltEvent {
  if (event.kind === "solar-eclipse") {
    // The heavy geometry, computed only for the eclipse actually on screen.
    // Tracing a shadow path is a few hundred milliseconds of ephemeris work,
    // and doing it for every eclipse in the list would be paying it four times
    // for a page showing one.
    // Limits are needed only for the drawing, and cost a bisection per side per
    // point, so they follow the same flag as everything else visual.
    const centralPath = withVisualization ? traceCentralPath(event.event, 6, 240, true) : [];
    const bounds = mapExtentFor(place.latitude, place.longitude, centralPath);
    const coverage = withVisualization
      ? coverageField(event.event, bounds, 1.5)
      : { cells: [], stepDeg: 1.5, bounds };
    const presentation = presentSolarEclipseEvent(
      event.event,
      event.local,
      clock,
      place.name,
    );
    return {
      presentation,
      // Drawn, not photographed. The only eclipse photograph that ships is of a
      // *lunar* eclipse, and using it here would put a picture of the wrong
      // phenomenon on the card.
      media: {
        kind: "drawn",
        node: (
          <TrackerEclipseArt
            obscurationFraction={event.local.obscurationFraction}
            kind={event.local.kind}
          />
        ),
        claim: "Modelled for this event",
        credit: "Drawn from this eclipse's geometry at your location — not a photograph.",
      },
      visualization: withVisualization ? (
        <Suspense fallback={<div className="tk-viz-panel tk-viz-loading" aria-busy="true" />}>
        <TrackerEclipseMap
          kind="solar"
          event={event.event}
          coverage={coverage}
          centralPath={centralPath}
          local={event.local}
          bounds={bounds}
          observer={{
            latitudeDeg: place.latitude,
            longitudeDeg: place.longitude,
            label: place.name,
          }}
          clock={clock}
          onOpenFullMap={() => {}}
        />
        </Suspense>
      ) : null,
      safety: SOLAR_SAFETY,
      expectation:
        event.local.kind === "total"
          ? "Totality is a different phenomenon from a deep partial eclipse, not a stronger one: the corona is only visible when the last of the disc goes."
          : "A partial eclipse does not look like dusk. Without a filter you will notice almost nothing, which is exactly why the filter matters.",
      skyPath: null,
    };
  }

  if (event.kind === "aurora") {
    const assessment = assessAurora(
      auroraConditions,
      place.latitude,
      place.longitude,
      event.atUtc,
      now,
    );
    // No darkness window: a K-index forecast is about a date, and this page has
    // not computed that night's observing period. Passing null is what keeps the
    // support line from claiming a darkness interval it has not established.
    const presentation = presentAuroraEvent(assessment, event.atUtc, clock, null, {
      label: "Visibility",
      value: "Not known",
      tone: "unknown",
    });
    return {
      presentation,
      media: {
        kind: "drawn",
        node: <TrackerAuroraArt probabilityPercent={null} />,
        claim: "Forecast visualisation",
        credit: "Drawn from the NOAA planetary K-index forecast — not a photograph.",
      },
      visualization: (
        <div className="tk-viz-panel">
          <div className="tk-viz-head">
            <p className="tk-viz-title">Three-day outlook</p>
            <p className="tk-viz-timing">NOAA planetary K-index forecast</p>
          </div>
          <p className="tk-viz-empty">
            {assessment.certainty} There is no map for this night, because nothing yet
            knows where the oval will be — the nowcast that answers that is only issued
            about half an hour ahead.
          </p>
        </div>
      ),
      safety: null,
      expectation:
        "Kp describes how disturbed Earth's magnetic field will be, not what you will see. Check the nowcast on the night.",
      skyPath: null,
    };
  }

  const { notable } = event;
  const entry: SkyAdjustedOpportunity = {
    ...notable.entry,
    skyAccess: null,
    rankBeforeConditions: notable.entry.rank,
  };
  const { opportunity } = entry;
  // The same weather layering Tonight uses. Beyond the forecast's reach it
  // simply finds nothing and reports the window as astronomically derived,
  // which is the honest answer rather than a special case.
  const window = bestViewingWindow(
    opportunity.profile,
    snapshots,
    opportunity.transparency,
    entry.strength,
    now,
  );
  const presentation = presentTonightEvent(entry, window, false, {
    clock,
    now,
    meteors: notable.plan.meteors,
    evidenceStatus,
  });
  const imagery = heroImageryFor(opportunity.id, opportunity.kind);
  const skyPath = skyPathFor(opportunity, window);
  const gaze = gazeRegionFor(opportunity, skyPath);
  const timing = `${formatClockTime(notable.plan.period.startUtc, clock)} to ${formatClockTime(notable.plan.period.endUtc, clock)}`;
  const verdict = {
    headline: notable.reason,
    detail: window
      ? `Best around ${formatClockRange(window.startUtc, window.endUtc, clock)}.`
      : `Best around ${formatClockTime(opportunity.guidance.whenUtc, clock)}.`,
    tone: "unknown" as const,
  };

  let visualization: React.ReactNode = null;
  if (!withVisualization) {
    visualization = null;
  } else if (opportunity.kind === "lunar-eclipse" && opportunity.science?.kind === "lunar-eclipse") {
    const timingModel = opportunity.science.timing;
    const bounds = {
      south: Math.max(-85, place.latitude - 40),
      north: Math.min(85, place.latitude + 40),
      west: place.longitude - 70,
      east: place.longitude + 70,
    };
    visualization = (
      <Suspense fallback={<div className="tk-viz-panel tk-viz-loading" aria-busy="true" />}>
      <TrackerEclipseMap
        kind="lunar"
        title={opportunity.title}
        maximumUtc={timingModel.maximumUtc}
        visibility={lunarVisibilityField(timingModel, bounds, 5)}
        bounds={bounds}
        observer={{
          latitudeDeg: place.latitude,
          longitudeDeg: place.longitude,
          label: place.name,
        }}
        clock={clock}
        onOpenFullMap={() => {}}
        observerAltitudeDeg={
          opportunity.science.localContactAltitudesDeg?.maximum ??
          Object.values(opportunity.science.localContactAltitudesDeg ?? {})[0] ??
          0
        }
      />
      </Suspense>
    );
  } else if (opportunity.kind === "meteors") {
    visualization = (
      <TrackerNightActivity
        period={notable.plan.period}
        meteors={notable.plan.meteors}
        clock={clock}
        windowStartUtc={window?.startUtc ?? null}
        windowEndUtc={window?.endUtc ?? null}
        gaze={gaze}
        verdict={verdict}
        title="Meteor activity that night"
        timing={timing}
      />
    );
  } else if (skyPath) {
    visualization = (
      <TrackerSkyPathPanel
        path={skyPath}
        period={notable.plan.period}
        clock={clock}
        gaze={gaze}
        title={`${opportunity.title} that night`}
        timing={timing}
        verdict={verdict}
      />
    );
  } else {
    visualization = (
      <div className="tk-viz-panel">
        <div className="tk-viz-head">
          <p className="tk-viz-title">Nothing to plot</p>
          <p className="tk-viz-timing">{timing}</p>
        </div>
        <p className="tk-viz-empty">This event has no position to draw from here.</p>
      </div>
    );
  }

  return {
    presentation: {
      ...presentation,
      // Keyed by the calendar event rather than by the opportunity. Three New
      // Moons in a month are three different dates and one opportunity id, and
      // the list rendered them as duplicate React keys.
      id: event.id,
      // The list already reads chronologically, so the pill carries the date
      // rather than repeating "Tonight" on a night three weeks away.
      pills: [
        {
          label: new Intl.DateTimeFormat(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          }).format(new Date(`${event.dateKey}T12:00:00`)),
          tone: "state" as const,
        },
        { label: event.label, tone: "state" as const },
      ],
      support: notable.reason,
      row: { ...presentation.row, window: dateLabel(event.dateKey) },
    },
    media: {
      kind: "imagery",
      imagery,
      illuminatedFraction: opportunity.sceneHints?.illuminatedFraction ?? 0.5,
      waning: opportunity.sceneHints?.waning ?? false,
    },
    visualization,
    safety: opportunity.guidance.safety,
    expectation: imagery.eyeExpectation,
    skyPath: skyPath && skyPath.kind !== "rate" ? skyPath : null,
  };
}

function dateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(year, month - 1, day));
}

export { buildPresentation, dateLabel };
