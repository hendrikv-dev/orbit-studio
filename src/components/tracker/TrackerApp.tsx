import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { signalAppReady } from "../../lib/appReady";
import { downloadCalendarFile } from "../../lib/trackerCalendar";
import {
  clockForCoordinates,
  deviceClock,
  formatClockRange,
  formatClockTime,
  type PlaceClock,
} from "../../lib/localTime";
import { planNight, type NightPlan } from "../../data/tracker/schedule";
import { gazeRegionFor, skyPathFor } from "../../data/tracker/skyPath";
import {
  applySkyAccess,
  chooseHero,
  type SkyAdjustedOpportunity,
} from "../../data/tracker/opportunity";
import {
  bestViewingWindow,
  environmentalEvidence,
  hasPassedTonight,
  nearestSnapshot,
  skyAccess,
  unavailableEnvironmentalEvidence,
  type BestWindow,
  type ConditionSnapshot,
  type WeatherSourceInfo,
} from "../../data/tracker/conditions";
import { adaptersFor, conditionsForLocation } from "../../data/tracker/weatherProviders";
import { heroImageryFor } from "../../data/tracker/imagery";
import { conditionCards } from "../../data/tracker/conditionCards";
import {
  presentAuroraEvent,
  presentTonightEvent,
  visibilityMetric,
  type EventPresentation,
} from "../../data/tracker/eventPresentation";
import { categoryForOpportunityKind } from "../../data/tracker/eventCategories";
import {
  assessAurora,
  fetchAuroraGrid,
  fetchAuroraIndex,
  NOAA_SWPC_SOURCE,
  type AuroraConditions,
} from "../../data/tracker/aurora";
import {
  loadConfirmedPlace,
  persistConfirmedPlace,
} from "../../data/tracker/trackerPersistence";
import { TrackerHeader, type TrackerView } from "./TrackerHeader";
import { TrackerEntry } from "./TrackerEntry";
import { TrackerPlace, type SelectedPlace } from "./TrackerPlace";
import { PhenomenonPage } from "./PhenomenonPage";
import { TrackerOverlay } from "./TrackerOverlay";
import { TrackerSkyChart } from "./TrackerSkyChart";
import { TrackerExperience, experienceFor } from "./TrackerExperience";
import { TrackerUpcoming } from "./TrackerUpcoming";
import { TrackerNightActivity } from "./viz/TrackerNightActivity";
import { TrackerSkyPathPanel } from "./viz/TrackerSkyPathPanel";
/**
 * The maps carry the coastline data, and most pages never draw one.
 *
 * Natural Earth's land polygons are 142 kB before compression. A meteor page
 * has no map on it and must not pay for one — the same rule that keeps Tracker
 * out of App's satellite catalogue applies inside Tracker too.
 */
const TrackerAuroraMap = lazy(() =>
  import("./viz/TrackerAuroraMap").then((module) => ({ default: module.TrackerAuroraMap })),
);
import { TrackerAuroraArt } from "./viz/TrackerAuroraArt";
import type { RelevantEventRow } from "./RelevantEventsList";
import type { HeroMedia } from "./EventHero";

/**
 * Orbit Studio Tracker.
 *
 * Mounted at the entry point rather than inside App, because App imports the
 * 16 MB satellite catalog and an observer page must not pay for it.
 *
 * ## One page, two questions
 *
 * Tracker asks two things and nothing else: what about tonight, and what about
 * later. Everything under both is the same page — heading, hero, evidence,
 * conditions, ranked list — with different content in the slots. A phenomenon
 * cannot introduce a layout here; it can only fill what `PhenomenonPage`
 * already holds open for it.
 *
 * That is the whole architecture, and it replaces a set of per-phenomenon
 * screens that had drifted apart from each other. The astronomy underneath is
 * unchanged: the same ranking, the same weather layering, the same refusal to
 * state anything a source cannot support.
 *
 * Times are the selected place's local clock, never UTC and not necessarily the
 * device's: somebody planning a trip to a dark-sky site needs that site's
 * midnight, not their own.
 */

const EMPTY_SNAPSHOTS: ConditionSnapshot[] = [];

/**
 * One client for the page.
 *
 * The forecast is worth keeping for an hour — it is a grid-cell forecast, not a
 * per-user one, and both providers ask callers to cache. Aurora overrides that
 * per query, because a nowcast an hour old is not a nowcast.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 60_000,
      gcTime: 2 * 60 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
    },
  },
});

function useConditions(place: SelectedPlace | null) {
  const adapters = place ? adaptersFor(place.latitude, place.longitude) : [];
  return useQuery({
    queryKey: [
      "conditions",
      adapters.map((adapter) => adapter.source.id).join(",") || "none",
      // Rounded, so two observers in the same forecast cell share one entry and
      // a precise location is never used as a cache key.
      place ? place.latitude.toFixed(2) : null,
      place ? place.longitude.toFixed(2) : null,
    ],
    enabled: Boolean(place),
    queryFn: async ({ signal }) => {
      if (!place) throw new Error("No location");
      return conditionsForLocation(place.latitude, place.longitude, signal, adapters);
    },
  });
}

/**
 * The space-weather products, on their own clock and as two queries.
 *
 * Global rather than per-location — NOAA publishes one grid for the planet — so
 * the query keys carry no coordinates at all, and every observer shares one
 * fetch. Five minutes of staleness matches the publication cadence; an hour
 * would be showing a nowcast that has stopped being one.
 *
 * Two queries rather than one because they fail separately. The 900 kB grid is
 * the request that actually drops, and behind a single combined query a dropped
 * grid still resolved successfully with nothing in it — so nothing retried and
 * the map stayed missing for the session.
 */
function useAurora(enabled: boolean): { data: AuroraConditions | null } {
  const grid = useQuery({
    queryKey: ["aurora", "ovation"],
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchInterval: enabled ? 5 * 60_000 : false,
    queryFn: ({ signal }) => fetchAuroraGrid(signal),
  });
  const index = useQuery({
    queryKey: ["aurora", "planetary-k-index"],
    enabled,
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    refetchInterval: enabled ? 15 * 60_000 : false,
    queryFn: ({ signal }) => fetchAuroraIndex(signal),
  });

  return useMemo(() => {
    if (!grid.data && !index.data) return { data: null };
    const failures: { product: string; message: string }[] = [];
    if (grid.isError) failures.push({ product: "ovation-nowcast", message: "Nowcast unavailable" });
    if (index.isError) {
      failures.push({ product: "planetary-k-index", message: "K-index unavailable" });
    }
    return {
      data: {
        grid: grid.data ?? null,
        currentKp: index.data?.currentKp ?? null,
        kpForecast: index.data?.kpForecast ?? [],
        fetchedAtUtc: new Date().toISOString(),
        source: NOAA_SWPC_SOURCE,
        failures,
      },
    };
  }, [grid.data, grid.isError, index.data, index.isError]);
}

export function TrackerApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrackerScreen />
    </QueryClientProvider>
  );
}

/** What the hero is currently showing, and where it came from. */
type Overlay = null | "sky-map" | "field-map";

interface TonightEvent {
  id: string;
  presentation: EventPresentation;
  media: HeroMedia;
  expectation: string | null;
  safety: string | null;
  /** Ordering value in the same 0–1 space the ranking uses. */
  strength: number;
  entry: SkyAdjustedOpportunity | null;
  window: BestWindow | null;
  passed: boolean;
}

function TrackerScreen() {
  const [place, setPlace] = useState<SelectedPlace | null>(() => loadConfirmedPlace());
  const [view, setView] = useState<TrackerView>("tonight");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [now, setNow] = useState(() => new Date());
  const [planAnchor, setPlanAnchor] = useState(() => new Date());

  useEffect(() => {
    signalAppReady();
  }, []);

  useEffect(() => {
    if (place) persistConfirmedPlace(place);
  }, [place]);

  // Time is an explicit input to every current-state projection. Recompute it
  // on a bounded cadence instead of sprinkling untracked `new Date()` reads
  // across memoized state that would otherwise never invalidate.
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(new Date()), 60_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const clock: PlaceClock = useMemo(() => {
    if (!place) return deviceClock();
    // The device knows its own zone exactly; anywhere else is resolved from
    // coordinates rather than guessed from longitude.
    return place.fromDevice
      ? deviceClock()
      : clockForCoordinates(place.latitude, place.longitude);
  }, [place]);

  const weather = useConditions(place);
  const aurora = useAurora(Boolean(place));

  const night = useMemo(
    () =>
      place
        ? planNight(place.latitude, place.longitude, planAnchor, clock.timeZone)
        : null,
    [place, clock.timeZone, planAnchor],
  );

  // The plan changes only when an authoritative input changes or the observing
  // period ends. Selected UI state is derived and cannot survive that identity.
  useEffect(() => {
    setSelectedId(null);
    if (!night) return;
    const delay = Math.min(
      Math.max(1_000, Date.parse(night.period.endUtc) - Date.now() + 1_000),
      2_147_000_000,
    );
    const timer = globalThis.setTimeout(() => setPlanAnchor(new Date()), delay);
    return () => globalThis.clearTimeout(timer);
  }, [night?.identity.key]);

  const environment = useMemo(() => {
    if (!place) {
      return unavailableEnvironmentalEvidence(
        "not-supported",
        "Choose a location to request a forecast.",
      );
    }
    if (weather.isError) {
      return unavailableEnvironmentalEvidence(
        "request-failed",
        weather.error instanceof Error ? weather.error.message : "Forecast request failed.",
      );
    }
    if (!weather.data) {
      return unavailableEnvironmentalEvidence("unavailable", "Forecast request is still pending.");
    }
    if (weather.data.snapshots.length > 0) {
      return environmentalEvidence(
        weather.data.snapshots,
        now,
        weather.data.adapter?.source ?? null,
      );
    }
    if (weather.data.attempts.some((attempt) => attempt.outcome === "failed")) {
      return unavailableEnvironmentalEvidence(
        "request-failed",
        "All eligible forecast providers failed.",
      );
    }
    return unavailableEnvironmentalEvidence(
      weather.data.attempts.length === 0 ? "not-supported" : "unavailable",
      weather.data.attempts.length === 0
        ? "No supported forecast provider covers this location."
        : "Forecast providers returned no usable conditions.",
    );
  }, [now, place, weather.data, weather.error, weather.isError]);

  const snapshots = environment.snapshots ?? EMPTY_SNAPSHOTS;
  // "Not asked yet" is not "asked and failed". Conflating them is what made the
  // interface claim conditions were unavailable while it was still fetching.
  const conditionsPending = weather.isPending && !weather.data;

  const withSky = useMemo(() => {
    if (!night) return null;
    const windows = new Map<string, BestWindow>();
    const access = new Map<string, number>();
    const passed = new Set<string>();
    for (const entry of night.ranking.ranked) {
      const { opportunity } = entry;
      if (hasPassedTonight(opportunity.profile, now)) {
        passed.add(opportunity.id);
        access.set(opportunity.id, 0);
        continue;
      }
      const found = bestViewingWindow(
        opportunity.profile,
        environment,
        opportunity.transparency,
        entry.strength,
        now,
      );
      if (found) {
        windows.set(opportunity.id, found);
        const snapshot = nearestSnapshot(snapshots, found.peakUtc);
        if (snapshot) access.set(opportunity.id, skyAccess(snapshot, opportunity.transparency));
      }
    }
    return { ranked: applySkyAccess(night.ranking.ranked, access), windows, passed };
  }, [environment, night, now, snapshots]);

  /**
   * The dark hours, which is the window every aurora statement is about.
   *
   * Aurora has no rise or set and no peak the way a planet does. What it has is
   * a requirement — a dark sky — so the honest window is the darkness itself.
   */
  const darkWindow = useMemo(() => {
    if (!night) return null;
    const dark = night.period.darkness.astronomical;
    return {
      startUtc: dark?.startUtc ?? night.period.startUtc,
      endUtc: dark?.endUtc ?? night.period.endUtc,
    };
  }, [night]);

  const auroraAssessment = useMemo(() => {
    if (!place || !darkWindow) return null;
    // Assessed at the moment the reader can act on: now if it is already dark,
    // otherwise the start of darkness. Which of the two it is decides whether
    // the nowcast or the three-day forecast is the source, and the assessment
    // says which it used.
    const at =
      now.getTime() >= Date.parse(darkWindow.startUtc) ? now.toISOString() : darkWindow.startUtc;
    return assessAurora(aurora.data ?? null, place.latitude, place.longitude, at, now);
  }, [aurora.data, darkWindow, now, place]);

  const tonightEvents = useMemo<TonightEvent[]>(() => {
    if (!night || !withSky || !place) return [];
    const context = {
      clock,
      now,
      meteors: night.meteors,
      evidenceStatus: environment.status,
    };

    const events: TonightEvent[] = withSky.ranked.map((entry) => {
      const window = withSky.windows.get(entry.opportunity.id) ?? null;
      const passed = withSky.passed.has(entry.opportunity.id);
      const imagery = heroImageryFor(entry.opportunity.id, entry.opportunity.kind);
      return {
        id: entry.opportunity.id,
        presentation: presentTonightEvent(entry, window, passed, context),
        media: {
          kind: "imagery" as const,
          imagery,
          illuminatedFraction:
            entry.opportunity.sceneHints?.illuminatedFraction ??
            night.meteors.best?.moonIlluminatedFraction ??
            0.5,
          waning: entry.opportunity.sceneHints?.waning ?? false,
        },
        expectation: imagery.eyeExpectation,
        safety: entry.opportunity.guidance.safety,
        // Passed events sink rather than disappear: "the Moon is already down"
        // is worth being able to see, and it is not a recommendation.
        strength: passed ? -1 : entry.strength,
        entry,
        window,
        passed,
      };
    });

    // Aurora joins the same ranking rather than being pinned above or below it.
    // The strength is NOAA's own probability mapped into the ranking's 0–1
    // space, so a quiet night puts it below Saturn and a G3 storm puts it on
    // top — which is the correct behaviour in both cases and needs no special
    // rule for either.
    if (auroraAssessment && auroraAssessment.outlook !== "unknown" && darkWindow) {
      const probability = auroraAssessment.probabilityPercent;
      const kp = auroraAssessment.kp;
      const strength =
        probability !== null
          ? Math.min(1, probability / 55)
          : kp !== null
            ? Math.max(0, Math.min(1, (kp - 3.5) / 4))
            : 0;
      if (strength > 0.08) {
        const windowText = formatClockRange(darkWindow.startUtc, darkWindow.endUtc, clock);
        const snapshot = nearestSnapshot(snapshots, darkWindow.startUtc);
        events.push({
          id: "aurora",
          presentation: presentAuroraEvent(
            auroraAssessment,
            now.getTime() >= Date.parse(darkWindow.startUtc)
              ? now.toISOString()
              : darkWindow.startUtc,
            clock,
            windowText,
            // Aurora is as demanding of a transparent sky as meteors are, so the
            // same reading is used rather than a softer one.
            snapshot
              ? visibilityMetric(
                  {
                    startUtc: darkWindow.startUtc,
                    endUtc: darkWindow.endUtc,
                    peakUtc: darkWindow.startUtc,
                    brief: false,
                    movedByWeather: false,
                    viewability: {
                      band:
                        skyAccess(snapshot, "high") > 0.7
                          ? "excellent"
                          : skyAccess(snapshot, "high") > 0.45
                            ? "good"
                            : skyAccess(snapshot, "high") > 0.2
                              ? "possible"
                              : "unlikely",
                      access: skyAccess(snapshot, "high"),
                      reading: { condition: "clear", label: "", phrase: "", smokeDominant: false },
                      freshness: "current",
                      evidenceStatus: "available",
                      limitedBySky: false,
                    },
                  },
                  environment.status,
                  false,
                )
              : { label: "Visibility", value: "Not known", tone: "unknown" },
          ),
          media: {
            kind: "drawn" as const,
            node: <TrackerAuroraArt probabilityPercent={probability} />,
            claim: "Forecast visualisation",
            credit: "Drawn from the NOAA OVATION nowcast — not a photograph.",
          },
          expectation:
            "To the eye, aurora at these latitudes is usually a pale grey-green glow low in the sky. Cameras see the colour long before you do.",
          safety: null,
          strength,
          entry: null,
          window: null,
          passed: false,
        });
      }
    }

    return events.sort((left, right) => right.strength - left.strength);
  }, [
    auroraAssessment,
    clock,
    darkWindow,
    environment.status,
    night,
    now,
    place,
    snapshots,
    withSky,
  ]);

  const heroEvent = useMemo(() => {
    if (tonightEvents.length === 0) return null;
    if (selectedId) {
      const found = tonightEvents.find((event) => event.id === selectedId);
      if (found) return found;
    }
    // The ranking's own hero rule still decides the default: nothing below the
    // floor is promoted merely to fill the position, and a telescope target
    // never displaces a naked-eye one.
    if (withSky) {
      const chosen = chooseHero(withSky.ranked, withSky.passed);
      const matched = chosen
        ? tonightEvents.find((event) => event.id === chosen.opportunity.id)
        : null;
      // Aurora can lead only by out-scoring the astronomical hero, never by
      // default, because a nowcast is the least certain thing on the page.
      const leader = tonightEvents[0];
      if (matched && (!leader || leader.strength <= matched.strength)) return matched;
    }
    return tonightEvents[0];
  }, [selectedId, tonightEvents, withSky]);

  /**
   * The ranked list, favouring the category currently on the hero.
   *
   * "Favouring" is a stable partition rather than a re-score: events of the
   * active category keep their own order and come first, then everything else
   * keeps its own order. The ranking is never rewritten to flatter the page you
   * happen to be on — a meteor page with nothing observable still shows Saturn
   * above a shower that has finished.
   */
  const rows = useMemo<RelevantEventRow[]>(() => {
    if (!heroEvent) return [];
    const category = heroEvent.presentation.categoryId;
    const matching = tonightEvents.filter(
      (event) => event.presentation.categoryId === category,
    );
    const others = tonightEvents.filter(
      (event) => event.presentation.categoryId !== category,
    );
    return [...matching, ...others].slice(0, 6).map((event) => ({
      presentation: event.presentation,
      imagery: event.media.kind === "imagery" ? event.media.imagery : null,
      thumb: event.media.kind === "drawn" ? event.media.node : undefined,
      illuminatedFraction:
        event.media.kind === "imagery" ? event.media.illuminatedFraction : undefined,
      waning: event.media.kind === "imagery" ? event.media.waning : undefined,
      active: event.id === heroEvent.id,
    }));
  }, [heroEvent, tonightEvents]);

  const conditions = useMemo(() => {
    if (!place || !heroEvent) return [];
    return conditionCards({
      atUtc: heroEvent.presentation.atUtc,
      latitudeDeg: place.latitude,
      longitudeDeg: place.longitude,
      snapshots,
      evidenceStatus: environment.status,
      now,
      pending: conditionsPending,
    });
  }, [conditionsPending, environment.status, heroEvent, now, place, snapshots]);

  /** How stale the freshest live reading behind this page is. */
  const freshnessMinutes = useMemo(() => {
    const stamps: number[] = [];
    if (snapshots.length > 0) stamps.push(Date.parse(snapshots[0].issuedUtc));
    if (aurora.data?.grid) stamps.push(Date.parse(aurora.data.grid.observationUtc));
    if (stamps.length === 0) return null;
    return (now.getTime() - Math.max(...stamps)) / 60_000;
  }, [aurora.data, now, snapshots]);

  const sources = useMemo<WeatherSourceInfo[]>(() => {
    const found: WeatherSourceInfo[] = [];
    if (environment.source) found.push(environment.source);
    if (aurora.data?.grid) found.push(NOAA_SWPC_SOURCE);
    return found;
  }, [aurora.data, environment.source]);

  // The tab title is how this page is found again in a row of tabs, in history
  // and in a shared link. "Orbit Studio" on every view told nobody anything.
  useEffect(() => {
    document.title = heroEvent
      ? `${heroEvent.presentation.title} tonight — Orbit Studio Tracker`
      : "Orbit Studio Tracker";
  }, [heroEvent]);

  const remind = useCallback((presentation: EventPresentation) => {
    downloadCalendarFile({
      title: presentation.reminder.title,
      description: presentation.reminder.description,
      startUtc: presentation.reminder.startUtc,
      durationMinutes: presentation.reminder.durationMinutes,
      remindMinutesBefore: 20,
    });
  }, []);

  const skyPath = useMemo(
    () =>
      heroEvent?.entry
        ? skyPathFor(heroEvent.entry.opportunity, heroEvent.window)
        : null,
    [heroEvent],
  );
  const gaze = useMemo(
    () => (heroEvent?.entry ? gazeRegionFor(heroEvent.entry.opportunity, skyPath) : null),
    [heroEvent, skyPath],
  );

  const visualization = useMemo(() => {
    if (!heroEvent || !night || !place) return null;
    const timing = `${formatClockTime(night.period.startUtc, clock)} to ${formatClockTime(night.period.endUtc, clock)}`;
    const quality = heroEvent.presentation.metrics[2];
    const verdict = {
      headline:
        quality.tone === "good"
          ? "Conditions are good tonight"
          : quality.tone === "fair"
            ? "Conditions are mixed tonight"
            : quality.tone === "poor"
              ? "The sky is the limit tonight, not the target"
              : "Conditions are not known",
      detail: heroEvent.presentation.support ?? "",
      tone: quality.tone === "plain" ? ("unknown" as const) : quality.tone,
    };

    if (heroEvent.id === "aurora") {
      if (auroraAssessment && aurora.data?.grid) {
        return (
          <Suspense fallback={<div className="tk-viz-panel tk-viz-loading" aria-busy="true" />}>
          <TrackerAuroraMap
            grid={aurora.data.grid}
            assessment={auroraAssessment}
            bounds={auroraBounds(place.latitude, place.longitude)}
            observer={{
              latitudeDeg: place.latitude,
              longitudeDeg: place.longitude,
              label: place.name,
            }}
            clock={clock}
            onOpenFullMap={() => setOverlay("field-map")}
          />
          </Suspense>
        );
      }
      return (
        <div className="tk-viz-panel">
          <div className="tk-viz-head">
            <p className="tk-viz-title">Aurora nowcast</p>
            <p className="tk-viz-timing">Unavailable</p>
          </div>
          <p className="tk-viz-empty">
            {auroraAssessment?.certainty ??
              "No space-weather product reached this device, so nothing can be said about the oval."}
          </p>
        </div>
      );
    }

    if (heroEvent.entry?.opportunity.kind === "meteors") {
      // Which streams are actually running, named from the same contributions
      // the rate is summed from. On most nights this is empty and the sentence
      // says so, rather than the panel implying a shower that is not there.
      const running = night.meteors.contributions
        .filter((entry) => entry.perHour >= 1)
        .map((entry) => entry.name);
      const streams =
        running.length === 0
          ? "No shower is running; this is the background rate."
          : running.length === 1
            ? `${running[0]} is running.`
            : `${running.slice(0, -1).join(", ")} and ${running[running.length - 1]} are running.`;
      return (
        <TrackerNightActivity
          period={night.period}
          meteors={night.meteors}
          clock={clock}
          windowStartUtc={heroEvent.window?.startUtc ?? null}
          windowEndUtc={heroEvent.window?.endUtc ?? null}
          gaze={gaze}
          verdict={{ ...verdict, detail: streams }}
          title="Meteor activity tonight"
          timing={timing}
        />
      );
    }

    if (skyPath) {
      return (
        <TrackerSkyPathPanel
          path={skyPath}
          period={night.period}
          clock={clock}
          gaze={gaze}
          title={`${heroEvent.presentation.title} tonight`}
          timing={timing}
          verdict={verdict}
        />
      );
    }

    return (
      <div className="tk-viz-panel">
        <div className="tk-viz-head">
          <p className="tk-viz-title">Nothing to plot</p>
          <p className="tk-viz-timing">{timing}</p>
        </div>
        <p className="tk-viz-empty">
          This event has no position above the horizon tonight, so there is no path to draw.
        </p>
      </div>
    );
  }, [aurora.data, auroraAssessment, clock, gaze, heroEvent, night, place, skyPath]);

  if (!place) {
    return (
      <main className="tracker-shell">
        <TrackerHeader
          place={null}
          onSelectPlace={setPlace}
          view={view}
          onSelectView={setView}
          freshnessMinutes={null}
          sources={[]}
        />
        <TrackerEntry onSelect={setPlace} />
      </main>
    );
  }

  return (
    <main className="tracker-shell">
      <a className="tracker-skip" href="#tracker-more">
        Skip to tonight&rsquo;s list
      </a>
      <TrackerHeader
        place={place}
        onSelectPlace={setPlace}
        view={view}
        onSelectView={setView}
        freshnessMinutes={freshnessMinutes}
        sources={sources}
      />

      {view === "upcoming" ? (
        <TrackerUpcoming
          place={place}
          clock={clock}
          planAnchor={planAnchor}
          now={now}
          auroraConditions={aurora.data ?? null}
          snapshots={snapshots}
          evidenceStatus={environment.status}
        />
      ) : heroEvent && night ? (
        <>
          <PhenomenonPage
            categoryId={heroEvent.presentation.categoryId}
            mode="tonight"
            presentation={heroEvent.presentation}
            media={heroEvent.media}
            visualization={visualization}
            conditions={conditions}
            conditionsCaption={conditionsCaption(environment.source, aurora.data ?? null)}
            evidenceStatus={environment.status}
            rows={rows}
            onSelectEvent={(id) => {
              // A drill-in belongs to the event it was opened from. Leaving it
              // up while the hero changes underneath shows one event's map over
              // another event's page.
              setOverlay(null);
              setSelectedId(id);
            }}
            onPrimaryAction={() =>
              setOverlay(
                heroEvent.presentation.primaryAction.kind === "sky-map" ? "sky-map" : "field-map",
              )
            }
            onReminder={() => remind(heroEvent.presentation)}
            safety={heroEvent.safety}
            expectation={heroEvent.expectation}
            planIdentity={night.identity.key}
          />

          <TrackerOverlay
            open={overlay === "sky-map"}
            onClose={() => setOverlay(null)}
            title={`Where to look — ${heroEvent.presentation.title}`}
            subtitle={
              gaze
                ? gaze.reason
                : "Real altitude and bearing, from the same geometry the recommendation used."
            }
          >
            {/* A rate curve is not a place. On a night with no active shower the
                path carries zeroed coordinates because there is no radiant, and
                plotting them draws a flat line along the horizon labelled 0° —
                a confident instruction to stare at the ground, assembled out of
                placeholders. */}
            {skyPath && skyPath.kind !== "rate" ? (
              <>
                <TrackerSkyChart
                  path={skyPath}
                  clock={clock}
                  tone={heroEvent.entry?.opportunity.kind ?? "neutral"}
                  label={heroEvent.presentation.title}
                />
                <dl className="tk-overlay-facts">
                  <div>
                    <dt>Observing window</dt>
                    <dd>
                      {heroEvent.window
                        ? formatClockRange(
                            heroEvent.window.startUtc,
                            heroEvent.window.endUtc,
                            clock,
                          )
                        : formatClockTime(
                            heroEvent.entry?.opportunity.guidance.whenUtc ??
                              night.period.startUtc,
                            clock,
                          )}
                    </dd>
                  </div>
                  <div>
                    <dt>Horizon</dt>
                    <dd>
                      Sunset {formatClockTime(night.period.startUtc, clock)} · dawn{" "}
                      {formatClockTime(night.period.endUtc, clock)}
                    </dd>
                  </div>
                  {heroEvent.entry?.opportunity.guidance.elevation ? (
                    <div>
                      <dt>How high</dt>
                      <dd>{heroEvent.entry.opportunity.guidance.elevation}</dd>
                    </div>
                  ) : null}
                </dl>
              </>
            ) : (
              <div className="tk-overlay-nowhere">
                <p className="tk-viz-empty">
                  There is nothing to point at tonight. No shower is running, so what
                  you would be watching is the sporadic background — meteors that
                  belong to no stream and arrive from every direction.
                </p>
                <p className="tk-viz-empty">
                  Face away from any light, take in as much sky as you can, and give it
                  at least half an hour. Rates rise towards dawn as your side of Earth
                  turns to face the direction it is travelling.
                </p>
              </div>
            )}

            {/* What it actually looks like, where verified footage exists.
                It belongs behind this control rather than on the page: it is
                context for the decision somebody has already made, and putting
                a looping video in the main row would make historical footage
                compete with tonight's forecast for the same attention. */}
            {(() => {
              const experience = heroEvent.entry
                ? experienceFor(heroEvent.entry.opportunity.kind)
                : null;
              return experience ? (
                <div className="tk-overlay-footage">
                  <TrackerExperience media={experience} />
                </div>
              ) : null;
            })()}
          </TrackerOverlay>

          <TrackerOverlay
            open={overlay === "field-map"}
            onClose={() => setOverlay(null)}
            title={
              heroEvent.id === "aurora" ? "Aurora forecast map" : "Visibility map"
            }
            subtitle={
              heroEvent.id === "aurora"
                ? "NOAA OVATION nowcast, valid for roughly the next half hour."
                : "Computed geometry for your location."
            }
          >
            <div className="tk-overlay-map">{visualization}</div>
          </TrackerOverlay>
        </>
      ) : (
        <div className="tk-page tk-tonight" data-plan-identity={night?.identity.key}>
          <div className="tk-page-heading">
            <h1>A quiet night</h1>
            <p>
              {night?.period.kind === "polar-day"
                ? "The Sun does not set here today, so there is no dark sky to look at."
                : `Nothing above the horizon tonight is worth a special trip from ${place.name}.`}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * The map extent for aurora.
 *
 * Wide in longitude and biased poleward, because the oval is a band around the
 * magnetic pole and the useful question is how far down from it you are. A box
 * centred on the observer would put the answer off the top edge for anybody
 * south of about fifty degrees, which is most people who ask.
 */
function auroraBounds(latitudeDeg: number, longitudeDeg: number) {
  const poleward = latitudeDeg >= 0 ? 1 : -1;
  return {
    south: Math.max(-88, latitudeDeg - poleward * 14),
    north: Math.min(88, latitudeDeg + poleward * 34),
    west: longitudeDeg - 42,
    east: longitudeDeg + 42,
  };
}

/** One attribution line for the whole conditions row. */
function conditionsCaption(
  source: WeatherSourceInfo | null,
  aurora: AuroraConditions | null,
): string | null {
  const parts: string[] = [];
  if (source) parts.push(source.attribution);
  if (aurora?.grid) parts.push(NOAA_SWPC_SOURCE.attribution);
  parts.push("Moon phase and altitude computed on this device.");
  return parts.join(" ");
}

export type { NightPlan };
