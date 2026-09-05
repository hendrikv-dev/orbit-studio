import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  conditionCards,
  type ConditionSubject,
} from "../../data/tracker/conditionCards";
import {
  bestViewingWindow,
  type ConditionSnapshot,
  type EnvironmentalEvidenceStatus,
} from "../../data/tracker/conditions";
import {
  VISIBILITY_LABEL,
  presentAuroraEvent,
  presentSolarEclipseEvent,
  presentTonightEvent,
  visibilityMetric,
  type EventPresentation,
} from "../../data/tracker/eventPresentation";
import { eclipseDestinations } from "../../data/tracker/eclipseDestinations";
import { heroImageryFor } from "../../data/tracker/imagery";
import {
  lunarGeographicVisibility,
  lunarLocalVisibility,
} from "../../data/tracker/lunarEclipse";
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
import { TrackerConjunctionScene } from "./viz/TrackerConjunctionScene";
import { TrackerSkyChart } from "./TrackerSkyChart";
import { TrackerAuroraArt } from "./viz/TrackerAuroraArt";
import { TrackerEclipseArt } from "./viz/TrackerEclipseArt";
/** Lazy for the same reason as the aurora map: it carries the coastlines. */
import { TrackerNightActivity } from "./viz/TrackerNightActivity";
import { TrackerSkyPathPanel } from "./viz/TrackerSkyPathPanel";
import type { SelectedPlace } from "./TrackerPlace";
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
  /**
   * Which drill-in is open, from the browser's history rather than local state.
   *
   * Local state is why Back from an open map left Tracker: the map was not an
   * entry, so there was nothing behind it but the page load.
   */
  drill: "sky" | "field" | null;
  onOpenDrill: (kind: "sky" | "field") => void;
  onCloseDrill: () => void;
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
  drill,
  onOpenDrill,
  onCloseDrill,
}: Props) {
  /**
   * A place the reader is asking about, which is not where they live.
   *
   * Held here rather than in `TrackerLocation` on purpose. It is not
   * navigation: it does not name a page, nobody would expect Back to step
   * through a series of pin drops, and putting it in the URL would make a
   * throwaway question look like a destination. It is cleared whenever the map
   * closes, which is also what guarantees it can never be mistaken later for
   * the confirmed place — `setPlace` is never called from here, and the
   * persisted location is written by the place picker alone.
   */
  const [inspected, setInspected] = useState<{
    latitudeDeg: number;
    longitudeDeg: number;
  } | null>(null);

  useEffect(() => {
    if (drill !== "field") setInspected(null);
  }, [drill]);
  // A different event is a different question; the old pin does not belong to it.
  useEffect(() => setInspected(null), [event.id]);

  /**
   * The tab is named after what is on it.
   *
   * Tonight's title effect is the only one there was, so opening a solar
   * eclipse from the calendar left a tab still called "Saturn tonight" — the
   * wrong event, on the wrong date, in the place a reader looks to find this
   * page again in a row of tabs or in their history.
   */
  useEffect(() => {
    document.title = `${event.title} — Orbit Studio Tracker`;
    return () => {
      document.title = "Orbit Studio Tracker";
    };
  }, [event.title]);

  const inspection = useMemo(
    () => ({
      point: inspected,
      onSelect: (latitudeDeg: number, longitudeDeg: number) =>
        setInspected({ latitudeDeg, longitudeDeg }),
    }),
    [inspected],
  );

  const built = useMemo(
    () =>
      buildPresentation(
        event,
        place,
        clock,
        now,
        snapshots,
        evidenceStatus,
        auroraConditions,
        true,
        "card",
        () => onOpenDrill("field"),
      ),
    [auroraConditions, clock, event, evidenceStatus, now, onOpenDrill, place, snapshots],
  );

  /**
   * The same event drawn for a full screen rather than for a third of a row.
   *
   * Built only while the map is open, because the wider extent samples a larger
   * area at a finer step and there is no reason to pay for it behind a closed
   * overlay. This is what makes "Open full map" worth opening: it is a larger
   * piece of the world at higher resolution, not the card scaled up.
   */
  const expanded = useMemo(
    () =>
      drill === "field"
        ? buildPresentation(
            event,
            place,
            clock,
            now,
            snapshots,
            evidenceStatus,
            auroraConditions,
            true,
            "full",
            null,
            inspection,
          ).visualization
        : null,
    [auroraConditions, clock, drill, event, evidenceStatus, inspection, now, place, snapshots],
  );

  /**
   * No air-quality reading here, and so no health card.
   *
   * The NowCast needs the hourly PM2.5 series and this page is handed merged
   * snapshots, which carry one value per hour with no window behind them. An
   * Upcoming event is also typically days out, where a twelve-hour NowCast is a
   * projection of a projection.
   *
   * Omitting it is the honest option rather than a gap: the alternative was the
   * defect being fixed — taking whatever single value happened to be nearest
   * and calling it an index.
   */
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
        subject: built.conditionSubject,
      }),
    [built.presentation.atUtc, evidenceStatus, now, place, snapshots],
  );

  return (
    <>
    <PhenomenonPage
      categoryId={built.presentation.categoryId}
      /**
       * This page is always about a specific future night, so it names it.
       *
       * Kept valid rather than left dangling: nothing routes to this component
       * since the date control replaced the Upcoming destination, and it is
       * outside the compiler's reach because the typecheck follows imports
       * from the entry point. A file left half-edited on the way past is a trap
       * for whoever turns it back on.
       */
      nightWord={`on ${new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
      }).format(new Date(built.presentation.atUtc))}`}
      presentation={built.presentation}
      media={built.media}
      visualization={built.visualization}
      conditions={conditions}
      conditionsCaption="Eclipse and Moon geometry computed on this device. Weather is only claimed inside the forecast horizon."
      evidenceStatus={evidenceStatus}
      onPrimaryAction={() =>
        // The action's own `kind` decides, rather than whatever geometry
        // happened to be available. A control that says "View visibility map"
        // opens the geographic map even for an event that also has a sky path.
        onOpenDrill(built.presentation.primaryAction.kind === "sky-map" ? "sky" : "field")
      }
      tertiaryAction={
        // Where both tools exist, both are reachable, each under its own name.
        built.skyPath && built.presentation.primaryAction.kind !== "sky-map"
          ? { label: "Where to look", onSelect: () => onOpenDrill("sky") }
          : null
      }
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
      open={drill === "sky" && built.skyPath !== null}
      onClose={onCloseDrill}
      title={`Where to look — ${built.presentation.title}`}
      subtitle="Real altitude and bearing for that night, from your location."
    >
      {built.skyPath ? (
        <TrackerSkyChart
          path={built.skyPath}
          clock={clock}
          tone={built.presentation.categoryId}
          label={built.presentation.title}
        />
      ) : null}
    </TrackerOverlay>

    <TrackerOverlay
      open={drill === "field"}
      onClose={onCloseDrill}
      title={`${built.presentation.primaryAction.label} — ${built.presentation.title}`}
      subtitle={built.mapSubtitle}
    >
      <div className="tk-overlay-map">{expanded ?? built.visualization}</div>
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
  /** What the expanded map is, said in the overlay's own subtitle. */
  mapSubtitle: string;
  /** What the event is, so the conditions row can decide what bears on it. */
  conditionSubject: ConditionSubject;
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
  /**
   * How much of the world to draw.
   *
   * "card" is the third-of-a-row panel beside the hero. "full" is the drill-in:
   * a wider extent sampled at a finer step, so that opening the map shows more
   * of the phenomenon rather than the same picture at twice the size.
   */
  extent: "card" | "full" = "card",
  /** Null on the expanded map itself, and on rows that draw nothing. */
  onOpenFullMap: (() => void) | null = null,
  /** Present only on the expanded map, which is the one a reader can explore. */
  inspection: {
    point: { latitudeDeg: number; longitudeDeg: number } | null;
    onSelect: (latitudeDeg: number, longitudeDeg: number) => void;
  } | null = null,
): BuiltEvent {
  const full = extent === "full";
  if (event.kind === "solar-eclipse") {
    // The heavy geometry, computed only for the eclipse actually on screen.
    // Tracing a shadow path is a few hundred milliseconds of ephemeris work,
    // and doing it for every eclipse in the list would be paying it four times
    // for a page showing one.
    // Limits are needed only for the drawing, and cost a bisection per side per
    // point, so they follow the same flag as everything else visual.
    const centralPath = withVisualization
      ? traceCentralPath(event.event, full ? 3 : 6, full ? 360 : 240, true)
      : [];
    // A full map opens out to a hemisphere-scale view of the track; the card
    // stays close enough to the reader's own place to be about them.
    const bounds = mapExtentFor(
      place.latitude,
      place.longitude,
      centralPath,
      full ? 48 : 26,
      full ? 130 : 72,
    );
    const coverageStep = full ? 0.9 : 1.5;
    const coverage = withVisualization
      ? coverageField(event.event, bounds, coverageStep)
      : { cells: [], stepDeg: coverageStep, bounds };
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
      /**
       * No geographic panel on this retired surface.
       *
       * Upcoming is not a destination any more — nothing routes to it — and the
       * hand-written eclipse renderer it used has been deleted along with the
       * rest of Tracker's second cartography. If this surface is ever revived it
       * gets `TrackerEventMapPanel` like every other page, rather than a
       * parallel visual language kept alive for a page nobody can reach.
       */
      visualization: null,

      mapSubtitle:
        "Where the Moon's shadow falls, computed from the ephemeris. The centre line is the shadow axis; shading is the fraction of the Sun covered.",
      // The Moon is the occulting body, not a competing light. Reporting its
      // phase as glare on a solar eclipse page would be doubly wrong: it is
      // new by definition, and the event is in daylight.
      conditionSubject: { categoryId: "eclipses", moonIsTheTarget: true, moonlightSensitivity: "low" },
      safety: SOLAR_SAFETY,
      expectation:
        event.local.kind === "total"
          ? "Totality is a different phenomenon from a deep partial eclipse, not a stronger one: the corona is only visible when the last of the disc goes."
          : "A partial eclipse does not look like dusk. Without a filter you would barely notice it was happening, and looking without one is what causes the damage.",
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
      label: VISIBILITY_LABEL,
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
      mapSubtitle:
        "NOAA planetary K-index forecast. There is no field to map this far ahead — the nowcast that locates the oval is issued about half an hour before it applies.",
      conditionSubject: { categoryId: "auroras", moonIsTheTarget: false, moonlightSensitivity: "high" },
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
  const gaze = gazeRegionFor(opportunity, skyPath, window?.peakUtc ?? opportunity.guidance.whenUtc);
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
    // A lunar eclipse is visible from a whole hemisphere, so the card shows the
    // reader's part of it and the full map opens out far enough to hold the
    // entire visible region rather than a window onto the middle of it.
    const bounds = full
      ? { south: -85, north: 85, west: place.longitude - 175, east: place.longitude + 175 }
      : {
          south: Math.max(-85, place.latitude - 40),
          north: Math.min(85, place.latitude + 40),
          west: place.longitude - 70,
          east: place.longitude + 70,
        };
    const localVisibility = lunarLocalVisibility(timingModel, place.latitude, place.longitude);
    visualization = null; // See the note above: no second cartography here.

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
    conditionSubject: {
      categoryId:
        presentation.categoryId === "auroras" ? "auroras" : presentation.categoryId,
      moonIsTheTarget:
        opportunity.kind === "lunar-eclipse" ||
        opportunity.kind === "moon" ||
        (opportunity.science?.kind === "conjunction" &&
          opportunity.science.bodies.some((body) => body === "the Moon")),
      moonlightSensitivity: opportunity.transparency === "high" ? "high" : "low",
    },
    mapSubtitle:
      opportunity.kind === "lunar-eclipse"
        ? "Where the Moon is above the horizon while the eclipse runs, from its real contact times. The dashed curves are the horizon at first and last contact."
        : "Computed geometry for your location.",
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
    media:
      opportunity.science?.kind === "conjunction"
        ? {
            // Drawn from this pairing rather than illustrated with another
            // one. See `TrackerConjunctionScene`.
            kind: "drawn",
            node: (
              <TrackerConjunctionScene
                positions={opportunity.science.positions}
                separationDeg={opportunity.science.separationDeg}
                moon={opportunity.science.moon}
                direction={opportunity.guidance.direction ?? "the horizon"}
              />
            ),
            credit:
              "Drawn from this pairing's own positions at the recommended moment. Discs are enlarged to be legible; the separation between them is to scale.",
          }
        : {
            kind: "imagery",
            imagery,
            illuminatedFraction: opportunity.sceneHints?.illuminatedFraction ?? 0.5,
            waning: opportunity.sceneHints?.waning ?? false,
          },
    visualization,
    safety: opportunity.guidance.safety,
    expectation:
      opportunity.science?.kind === "conjunction"
        ? "Two points of light close together, and nothing like this size. The drawing enlarges both so they can be told apart; what your eyes see is the Moon at this phase with a steady point beside it, separated by about the width shown."
        : imagery.eyeExpectation,
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
