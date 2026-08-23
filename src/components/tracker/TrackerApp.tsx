import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  fetchAerosol,
  OPEN_METEO_AIR_QUALITY_SOURCE,
  withAerosol,
} from "../../data/tracker/airQuality";
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
  auroraRankingStrength,
  auroraVisibility,
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
import { rankTonight, visibleRanked } from "../../data/tracker/tonightRanking";
import { TrackerConjunctionScene } from "./viz/TrackerConjunctionScene";
import { TrackerOverlay } from "./TrackerOverlay";
import { useTrackerHistory } from "./useTrackerHistory";
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
 * Aerosol, as its own query.
 *
 * Separate from the weather providers because it is a separate model from a
 * separate operator, and because a failure here must cost the smoke card and
 * nothing else. Cached for an hour like the forecast: it is a model output on
 * a grid, not a per-user measurement.
 */
function useAerosol(place: SelectedPlace | null) {
  return useQuery({
    queryKey: [
      "aerosol",
      place ? place.latitude.toFixed(2) : null,
      place ? place.longitude.toFixed(2) : null,
    ],
    enabled: Boolean(place),
    queryFn: ({ signal }) => {
      if (!place) throw new Error("No location");
      return fetchAerosol(place.latitude, place.longitude, signal);
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
  /**
   * Canonical position in tonight's ranking, 1-based.
   *
   * Assigned once, where the sort happens, and carried from there. It used to
   * be the row's index at render time, which meant the list could not be
   * reordered for any reason without silently renumbering the ranking — and it
   * was reordered, to hoist the open event's category to the top. Opening
   * Meteors made Meteors rank 1. Rank is a property of the night, not of what
   * the reader is looking at.
   */
  rank: number;
  entry: SkyAdjustedOpportunity | null;
  window: BestWindow | null;
  passed: boolean;
}

/**
 * The shortest form of a place name that still identifies it.
 *
 * Saved locations come from a geocoder and can be long — "97201, Downtown,
 * Portland, Multnomah, Oregon, United States". The subtitle wants the bit a
 * person would say out loud.
 */
function shortPlaceName(place: SelectedPlace): string {
  const name = place.name.trim();
  // A device fix has no name worth quoting; the context line carries accuracy.
  if (/^where you are$/i.test(name)) return "your location";
  // Geocoders often return "A, B, C"; the first part is the specific one.
  return name.split(",")[0].trim() || name;
}

function TrackerScreen() {
  const [place, setPlace] = useState<SelectedPlace | null>(() => loadConfirmedPlace());
  /**
   * Every navigable thing about this screen, in the browser's history.
   *
   * Was three `useState` calls here and four more in the children, none of
   * which the browser knew about — so Back left Tracker rather than walking
   * back through it. See `useTrackerHistory`.
   */
  const { location, navigate, back } = useTrackerHistory();
  const view: TrackerView = location.view;
  const selectedId = location.view === "tonight" ? location.eventId : null;
  const overlay: Overlay =
    location.view === "tonight" && location.drill === "sky"
      ? "sky-map"
      : location.view === "tonight" && location.drill === "field"
        ? "field-map"
        : null;

  /**
   * A place the reader is asking about on the expanded map.
   *
   * Never written to storage and never passed to `setPlace`: the saved location
   * has exactly one writer, the place picker, and this is a question rather
   * than a move. Cleared when the map closes.
   */
  const [inspected, setInspected] = useState<{
    latitudeDeg: number;
    longitudeDeg: number;
  } | null>(null);
  useEffect(() => {
    if (location.drill !== "field") setInspected(null);
  }, [location.drill]);

  // Read by the plan-identity effect, which must not re-run when the reader
  // picks a different event — only when the night itself changes.
  const selectedIdRef = useRef(selectedId);
  const drillRef = useRef(location.drill);
  const viewRef = useRef(location.view);
  selectedIdRef.current = selectedId;
  drillRef.current = location.drill;
  viewRef.current = location.view;
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
  const aerosol = useAerosol(place);
  const aurora = useAurora(Boolean(place));

  const night = useMemo(
    () =>
      place
        ? planNight(place.latitude, place.longitude, planAnchor, clock.timeZone)
        : null,
    [place, clock.timeZone, planAnchor],
  );

  // The plan changes only when an authoritative input changes or the observing
  // period ends. Tonight's selection is derived from that plan and cannot
  // survive its identity.
  //
  // Three conditions, each of which was a bug without it:
  //
  //  - Not on the first run. The night is computed on mount, so an unguarded
  //    effect fired immediately and wiped an event that had been deep-linked or
  //    restored by a refresh — the reader typed a URL for an eclipse and landed
  //    on the list.
  //  - Only in Tonight. An Upcoming event is a date, not a member of tonight's
  //    plan, and has no reason to be cleared when the night rolls over.
  //  - Replacing rather than pushing, because the reader did not navigate: the
  //    night moved under them, and an entry they never chose is one they would
  //    have to press Back through.
  const planSettled = useRef(false);
  useEffect(() => {
    const first = !planSettled.current;
    planSettled.current = true;
    if (
      !first &&
      viewRef.current === "tonight" &&
      (selectedIdRef.current !== null || drillRef.current !== null)
    ) {
      navigate({ eventId: null, drill: null }, { replace: true });
    }
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

  /**
   * The forecast with aerosol folded in.
   *
   * Two models, matched by time rather than by index, and a snapshot with no
   * aerosol within tolerance keeps its nulls. The merge lives here rather than
   * in the provider layer so that losing the aerosol request degrades exactly
   * one card instead of the whole row.
   */
  const snapshots = useMemo(() => {
    const base = environment.snapshots ?? EMPTY_SNAPSHOTS;
    return aerosol.data ? withAerosol(base, aerosol.data) : base;
  }, [aerosol.data, environment.snapshots]);
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

    const events: Omit<TonightEvent, "rank">[] = withSky.ranked.map((entry) => {
      const window = withSky.windows.get(entry.opportunity.id) ?? null;
      const passed = withSky.passed.has(entry.opportunity.id);
      const imagery = heroImageryFor(entry.opportunity.id, entry.opportunity.kind);
      const science = entry.opportunity.science;
      /**
       * A conjunction is drawn from its own geometry rather than illustrated.
       *
       * The stock photograph this replaces showed the Moon beside Venus for
       * every pairing — the wrong planet for "The Moon and Saturn", and the
       * wrong lunar phase for every date but one.
       */
      const media =
        science?.kind === "conjunction"
          ? {
              kind: "drawn" as const,
              node: (
                <TrackerConjunctionScene
                  positions={science.positions}
                  separationDeg={science.separationDeg}
                  moon={science.moon}
                  direction={entry.opportunity.guidance.direction ?? "the horizon"}
                />
              ),
              claim: "Computed for this event",
              credit:
                "Drawn from this pairing's own positions at the recommended moment. Discs are enlarged to be legible; the separation between them is to scale.",
            }
          : {
              kind: "imagery" as const,
              imagery,
              illuminatedFraction:
                entry.opportunity.sceneHints?.illuminatedFraction ??
                night.meteors.best?.moonIlluminatedFraction ??
                0.5,
              waning: entry.opportunity.sceneHints?.waning ?? false,
            };
      return {
        id: entry.opportunity.id,
        presentation: presentTonightEvent(entry, window, passed, context),
        media,
        // The photograph's caption does not describe a diagram. Left as it
        // was, a computed conjunction carried the night-sky image's note about
        // long exposures and observatory sites.
        expectation:
          media.kind === "drawn" && science?.kind === "conjunction"
            ? "Two points of light close together, and nothing like this size. The drawing enlarges both so they can be told apart; what your eyes see is the Moon at this phase with a steady point beside it, separated by about the width shown."
            : imagery.eyeExpectation,
        safety: entry.opportunity.guidance.safety,
        // Passed events sink rather than disappear: "the Moon is already down"
        // is worth being able to see, and it is not a recommendation.
        strength: passed ? -1 : entry.strength,
        entry,
        window,
        passed,
      };
    });

    // Aurora joins the same ranking rather than being pinned above or below it,
    // through a transformation that lives in `auroraRankingStrength` and says in
    // its own documentation that it is Tracker's editorial judgement rather than
    // anything NOAA published.
    //
    // A stale nowcast scores zero there, so it cannot outrank an event with
    // current evidence. It is listed anyway, and so is a quiet one: the row
    // states what the field is doing, and "unlikely tonight" or "the nowcast
    // has expired" are both answers, where an absent row is not.
    if (auroraAssessment && darkWindow) {
      const ranking = auroraRankingStrength(auroraAssessment);
      const expired =
        auroraAssessment.freshness === "stale" || auroraAssessment.freshness === "unavailable";
      // Whether tonight is a night *for* aurora, which decides where it ranks
      // rather than whether it appears at all.
      //
      // It used to decide both, and that was the defect: on a quiet night the
      // aurora entry vanished, so a reader who wanted to know about aurora was
      // told nothing — not "unlikely tonight", which is a real and useful
      // answer, but nothing. Silence is not an answer a reader can act on, and
      // it is indistinguishable from Tracker being unable to say. So the entry
      // is always present when there is a dark sky to see it in, and a quiet
      // field sorts it below everything with something happening.
      const worthListing =
        ranking.strength > 0.08 ||
        (expired && (auroraAssessment.reportedProbabilityPercent ?? 0) >= 10);

      {
        // The instant the assessment is actually about. Once darkness has begun
        // that is now; before it, the start of darkness. Everything downstream —
        // the weather sample, the conditions row, the reminder — hangs off this
        // one value so a nowcast about 2 AM cannot be paired with the weather at
        // dusk, which is exactly what the previous version did.
        const assessedAtUtc =
          now.getTime() >= Date.parse(darkWindow.startUtc)
            ? now.toISOString()
            : darkWindow.startUtc;
        const snapshot = expired ? null : nearestSnapshot(snapshots, assessedAtUtc);
        const access = snapshot ? skyAccess(snapshot, "high") : null;

        events.push({
          id: "aurora",
          presentation: presentAuroraEvent(
            auroraAssessment,
            assessedAtUtc,
            clock,
            darkWindow,
            // Aurora is as demanding of a transparent sky as meteors are, so the
            // same reading is used rather than a softer one — sampled at the
            // moment being assessed, not at the start of the night.
            snapshot && access !== null
              ? visibilityMetric(
                  {
                    startUtc: assessedAtUtc,
                    endUtc: assessedAtUtc,
                    peakUtc: assessedAtUtc,
                    brief: true,
                    movedByWeather: false,
                    viewability: {
                      band:
                        access > 0.7
                          ? "excellent"
                          : access > 0.45
                            ? "good"
                            : access > 0.2
                              ? "possible"
                              : "unlikely",
                      access,
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
            // Whether it could be seen from here, which is the reader's
            // question and not the one OVATION answers.
            auroraVisibility(
              auroraAssessment,
              aurora.data?.grid ?? null,
              place.latitude,
              place.longitude,
            ),
          ),
          media: {
            kind: "drawn" as const,
            node: (
              <TrackerAuroraArt
                probabilityPercent={auroraAssessment.probabilityPercent}
              />
            ),
            claim: "Forecast visualisation",
            credit: "Drawn from the NOAA OVATION nowcast — not a photograph.",
          },
          expectation:
            "To the eye, aurora at these latitudes is usually a pale grey-green glow low in the sky. Cameras see the colour long before you do.",
          safety: null,
          // Expired data is listed last rather than ranked. 0.05 is below the
          // 0.08 floor everything else must clear, so it can never displace an
          // event that has current evidence behind it.
          // Present but last, when there is nothing to report. -0.5 sits below
          // every live recommendation and above events that have already set,
          // which is where "unlikely tonight" belongs.
          strength: !worthListing ? -0.5 : expired ? 0.05 : ranking.strength,
          entry: null,
          window: null,
          passed: false,
        });
      }
    }

    // The canonical ranking, decided in one place and carried from there.
    // `rankTonight` has no parameter for the selection, so no future caller can
    // accidentally make rank depend on what the reader opened.
    return rankTonight(events);
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
    /**
     * The canonical order, unmodified.
     *
     * This used to hoist everything sharing the open event's category to the
     * front, which — with rank rendered from the row index — meant opening an
     * event promoted it to rank 1. Two bugs that only became visible together:
     * either alone would have been survivable, and the pair falsified the one
     * number the product exists to provide.
     *
     * The selected row is highlighted in place instead. Where it falls outside
     * the visible window it is appended rather than promoted, so it is reachable
     * and still carries the rank it actually holds.
     */
    return visibleRanked(tonightEvents, heroEvent.id, 6).map((event) => ({
      presentation: event.presentation,
      imagery: event.media.kind === "imagery" ? event.media.imagery : null,
      thumb: event.media.kind === "drawn" ? event.media.node : undefined,
      illuminatedFraction:
        event.media.kind === "imagery" ? event.media.illuminatedFraction : undefined,
      waning: event.media.kind === "imagery" ? event.media.waning : undefined,
      active: event.id === heroEvent.id,
      rank: event.rank,
    }));
  }, [heroEvent, tonightEvents]);

  const conditions = useMemo(() => {
    if (!place || !heroEvent) return [];
    const opportunity = heroEvent.entry?.opportunity ?? null;
    const category = heroEvent.presentation.categoryId;
    return conditionCards({
      atUtc: heroEvent.presentation.atUtc,
      latitudeDeg: place.latitude,
      longitudeDeg: place.longitude,
      snapshots,
      evidenceStatus: environment.status,
      now,
      pending: conditionsPending,
      subject: {
        categoryId: category === "auroras" ? "auroras" : category,
        // The Moon is the subject on its own page, in a lunar eclipse, and in
        // any pairing it is half of.
        moonIsTheTarget:
          category === "moon" ||
          opportunity?.kind === "lunar-eclipse" ||
          (opportunity?.science?.kind === "conjunction" &&
            opportunity.science.bodies.some((body) => body === "the Moon")),
        // Aurora and meteors are wide-field and faint; the same `transparency`
        // demand the ranking already uses says which is which, so this cannot
        // drift away from how the event is actually scored.
        moonlightSensitivity:
          heroEvent.id === "aurora" || opportunity?.transparency === "high" ? "high" : "low",
      },
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
    if (aerosol.data && aerosol.data.length > 0) found.push(OPEN_METEO_AIR_QUALITY_SOURCE);
    if (aurora.data?.grid) found.push(NOAA_SWPC_SOURCE);
    return found;
  }, [aerosol.data, aurora.data, environment.source]);

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

  /**
   * Whether the reader could actually see it, which is not what OVATION asked.
   *
   * Kept beside the assessment rather than inside the map so the page and the
   * drawing quote one answer. See `auroraVisibility` for why overhead
   * probability alone is the wrong question.
   */
  const auroraLocalVisibility = useMemo(
    () =>
      auroraAssessment && place
        ? auroraVisibility(
            auroraAssessment,
            aurora.data?.grid ?? null,
            place.latitude,
            place.longitude,
          )
        : null,
    [aurora.data, auroraAssessment, place],
  );

  /**
   * The exploratory twin of the aurora panel.
   *
   * Built separately rather than reusing the card's element, because the card
   * shares a scroll surface with the page and must not capture drags, while
   * this one has the screen to itself and should. Only aurora needs it here —
   * every other Tonight visualization is a chart rather than a map.
   */
  const expandedVisualization = useMemo(() => {
    if (heroEvent?.id !== "aurora" || !auroraAssessment || !aurora.data?.grid || !place) {
      return null;
    }
    return (
      <Suspense fallback={<div className="tk-viz-panel tk-viz-loading" aria-busy="true" />}>
        <TrackerAuroraMap
          grid={aurora.data.grid}
          assessment={auroraAssessment}
          // Opened out: the oval is continental, and a panel-sized window on it
          // cannot answer "how far north would I have to go".
          bounds={{
            south: Math.max(-90, place.latitude - 38),
            north: Math.min(90, place.latitude + 38),
            west: place.longitude - 62,
            east: place.longitude + 62,
          }}
          observer={{
            latitudeDeg: place.latitude,
            longitudeDeg: place.longitude,
            label: place.name,
          }}
          clock={clock}
          onOpenFullMap={null}
          interactive
          inspection={{
            point: inspected,
            onSelect: (latitudeDeg, longitudeDeg) => setInspected({ latitudeDeg, longitudeDeg }),
          }}
          visibility={auroraLocalVisibility}
        />
      </Suspense>
    );
  }, [
    aurora.data,
    auroraAssessment,
    auroraLocalVisibility,
    clock,
    heroEvent?.id,
    inspected,
    place,
  ]);

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
            onOpenFullMap={() => navigate({ drill: "field" })}
            visibility={auroraLocalVisibility}
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
          onSelectView={(next) => navigate({ view: next, eventId: null, drill: null })}
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
        onSelectView={(next) => navigate({ view: next, eventId: null, drill: null })}
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
          location={location}
          onNavigate={navigate}
          onBack={back}
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
            conditionsCaption={conditionsCaption(sources)}
            evidenceStatus={environment.status}
            rows={rows}
            onSelectEvent={(id) => {
              // A drill-in belongs to the event it was opened from. Leaving it
              // up while the hero changes underneath shows one event's map over
              // another event's page.
              navigate({ eventId: id, drill: null });
            }}
            onPrimaryAction={() =>
              navigate({
                drill: heroEvent.presentation.primaryAction.kind === "sky-map" ? "sky" : "field",
              })
            }
            onReminder={() => remind(heroEvent.presentation)}
            safety={heroEvent.safety}
            expectation={heroEvent.expectation}
            // The place is context for the ranking, not its title. Kept short:
            // a saved location can be a full postal description, and repeating
            // it at length under a heading two lines from the header's copy of
            // it reads as a stutter.
            listCaption={`From ${shortPlaceName(place)} · ranked by overall observing opportunity`}
            planIdentity={night.identity.key}
          />

          <TrackerOverlay
            open={overlay === "sky-map"}
            onClose={() => back({ drill: null })}
            title={`${heroEvent.presentation.primaryAction.label} — ${heroEvent.presentation.title}`}
            subtitle={
              // The subtitle has to describe the state below it. On a night
              // with no radiant it promised "real altitude and bearing" above a
              // panel that correctly contains neither.
              skyPath && skyPath.kind !== "rate"
                ? (gaze?.reason ??
                  "Real altitude and bearing, from the same geometry the recommendation used.")
                : "No radiant tonight, so no direction to face. What to do instead, and when."
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
              </>
            ) : (
              /* Composed, rather than two paragraphs adrift in a wide panel.
              
                 The sporadic state had no chart, so the modal rendered a
                 half-empty two-column shape that read as content failing to
                 load. What it actually has to say is a short set of practical
                 instructions, and those are laid out as instructions — which
                 also fills the space honestly instead of padding it. */
              <div className="tk-howto">
                <p className="tk-howto-lede">
                  No shower is running tonight, so there is no radiant to face. What
                  you would be watching is the sporadic background — meteors that
                  belong to no stream and arrive from every direction.
                </p>
                <ol className="tk-howto-steps">
                  <li>
                    <b>Face away from any light.</b> A wall or a hedge between you and
                    the nearest street lamp does more than any equipment.
                  </li>
                  <li>
                    <b>Take in as much sky as you can.</b> Lie back if you can. Looking
                    at one spot is the one mistake that costs meteors.
                  </li>
                  <li>
                    <b>Give it half an hour.</b> Your eyes need about twenty minutes to
                    adapt, and the rate is an average over a long wait.
                  </li>
                  <li>
                    <b>Go later if you can.</b> Rates rise towards dawn, as your side of
                    Earth turns to face the direction it is travelling.
                  </li>
                </ol>
              </div>
            )}

            {/* When to be outside, in both states.
            
                These were nested inside the charted branch, so the sporadic
                panel had no facts at all — which is most of why it read as a
                layout with its right-hand side missing. The window and the
                horizon are as useful without a radiant as with one. */}
            <dl className="tk-overlay-facts">
              <div>
                <dt>Observing window</dt>
                <dd>
                  {heroEvent.window
                    ? formatClockRange(heroEvent.window.startUtc, heroEvent.window.endUtc, clock)
                    : formatClockTime(
                        heroEvent.entry?.opportunity.guidance.whenUtc ?? night.period.startUtc,
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
            onClose={() => back({ drill: null })}
            title={
              heroEvent.id === "aurora" ? "Aurora forecast map" : "Visibility map"
            }
            subtitle={
              heroEvent.id !== "aurora"
                ? "Computed geometry for your location."
                : auroraAssessment?.freshness === "stale" ||
                    auroraAssessment?.freshness === "unavailable"
                  ? // The drill-in inherits the same field the card shows, so it
                    // inherits the same obligation not to describe an expired
                    // nowcast as one that is valid for the next half hour.
                    "NOAA OVATION nowcast, expired. Shown as what was last published, not as now."
                  : "NOAA OVATION nowcast, valid for roughly the next half hour."
            }
          >
            <div className="tk-overlay-map">{expandedVisualization ?? visualization}</div>
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

/**
 * One attribution line for the whole conditions row.
 *
 * Built from the sources that actually answered, so a provider that failed is
 * not credited for numbers it did not supply. The last clause distinguishes the
 * computed value from the fetched ones, which is the distinction the row's
 * whole credibility rests on.
 */
function conditionsCaption(sources: WeatherSourceInfo[]): string | null {
  const parts = sources.map((source) => source.attribution);
  parts.push("Moon phase and altitude computed on this device.");
  return parts.join(" ");
}

export type { NightPlan };
