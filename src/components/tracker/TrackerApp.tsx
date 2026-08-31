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
  readAirQuality,
  withAerosol,
} from "../../data/tracker/airQuality";
import { heroImageryFor } from "../../data/tracker/imagery";
import { conditionCards } from "../../data/tracker/conditionCards";
import { geocoderFor } from "../../data/tracker/geocoding";
import {
  VISIBILITY_LABEL,
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
import type { TrackerView } from "./TrackerHeader";
import { TrackerEntry } from "./TrackerEntry";
import { TrackerPlace, type SelectedPlace } from "./TrackerPlace";
import { PhenomenonPage } from "./PhenomenonPage";
import {
  auroraEligibility,
  generalEligibility,
  meteorEligibility,
  moonEligibility,
  type EligibilityVerdict,
} from "../../data/tracker/bestTonightEligibility";
import {
  describeDate,
  instantForDate,
  todayIn,
} from "../../data/tracker/skyContext";
import { rankTonight, visibleRanked } from "../../data/tracker/tonightRanking";
import { auroraSignificance, priorityFor } from "../../data/tracker/significance";
import {
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  type TrackerMapLocation,
} from "../../data/tracker/mapNavigation";
import { TrackerConjunctionScene } from "./viz/TrackerConjunctionScene";
import { TrackerOverlay } from "./TrackerOverlay";
import { useTrackerMapHistory } from "./useTrackerMapHistory";
import { TrackerMapCanvas } from "./map/TrackerMapCanvas";
import {
  MAP_LAYER_IDS,
  TrackerMapLayers,
  type MapLayerId,
} from "./map/TrackerMapLayers";
import { TrackerEventFinder } from "./map/TrackerEventFinder";
import {
  catalogue,
  eventDate,
  type CatalogueEvent,
} from "../../data/tracker/eventCatalogue";
import {
  buildEventOverlay,
  overlayTitle,
  readEventAt,
} from "../../data/tracker/eventOverlay";
import { TrackerDate } from "./TrackerDate";
import { auroraProbabilityAt } from "../../data/tracker/aurora";
import {
  coverageField,
  localSolarCircumstances,
  mapExtentFor,
  nextSolarEclipses,
  traceCentralPath,
} from "../../data/tracker/solarEclipse";
import {
  describeLightPollution,
  loadLightPollution,
} from "../../data/tracker/lightPollution";
import { TrackerObservingRail, type RailFacts } from "./map/TrackerObservingRail";
import { OrbitAppMenu } from "../layout/OrbitAppMenu";
import { TrackerCallout } from "./onboarding/TrackerCallout";
import { useOnboarding, type Tour } from "./onboarding/useOnboarding";
import { buildRail, type RailCandidate } from "../../data/tracker/observingRail";
import { cardMediaFor } from "../../data/tracker/cardMedia";
import { useDismissableSurface } from "../../data/tracker/dismissable";
import { EclipseFigure } from "./media/CardFigures";
import { assessEventTerrain, describeTerrain } from "../../data/tracker/eventTerrain";
import { compassPoint } from "../../data/tracker/meteorActivity";
import { TrackerMapControls } from "./map/TrackerMapControls";
import { TrackerMapLightLegend } from "./map/TrackerMapLegend";
import { TrackerSkyChart } from "./TrackerSkyChart";
import { TrackerExperience, experienceFor } from "./TrackerExperience";
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
const TrackerEclipseMap = lazy(() =>
  import("./viz/TrackerEclipseMap").then((module) => ({ default: module.TrackerEclipseMap })),
);
import { TrackerAuroraArt } from "./viz/TrackerAuroraArt";
import {
  lunarGeographicVisibility,
  lunarLocalVisibility,
} from "../../data/tracker/lunarEclipse";
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

/**
 * Which conditions belong in the panel, in the order they help.
 *
 * A whitelist rather than a slice: the panel is an answer, and the answer is
 * "can I see it and how good will it look", which is cloud and transparency.
 * Temperature belongs on the event page, where there is room for it to be
 * context rather than one of three things competing for the reader's eye.
 */
const PANEL_CONDITION_IDS = ["cloud", "transparency", "air-quality"] as const;

/**
 * The first-run tour: four stops on the shell, and nothing else.
 *
 * Short on purpose. Onboarding that explains the whole product is a manual
 * nobody reads; four callouts on the four controls a reader has to find is a
 * label on each. Everything past that is better taught at the moment it becomes
 * relevant, which is what the same mechanism does for contextual callouts.
 *
 * Every anchor is a control that is genuinely on screen. The rail step is
 * skipped rather than faked when no place has been chosen yet — the hook drops
 * steps whose anchor is not rendered, so nothing here has to pretend.
 */
const FIRST_RUN_TOUR: Tour = {
  id: "first-run-v1",
  steps: [
    {
      id: "place",
      anchor: ".tk-map-topbar-lead",
      title: "Choose a place",
      body: "Search, use your location, or tap the map.",
      placement: "bottom",
    },
    {
      id: "rail",
      anchor: ".tk-rail",
      title: "What to look for",
      body: "The strongest opportunities from this place, best first. Open one for timing, direction and conditions.",
      placement: "top",
    },
    {
      id: "date",
      anchor: ".tk-map-topbar-centre",
      title: "Change the date",
      body: "Arrows step a night either way. Tap the date itself for a month, with eclipses and shower peaks marked.",
      placement: "bottom",
    },
    {
      id: "layers",
      anchor: ".tk-layers",
      title: "Layers",
      body: "Add light pollution, darkness, aurora, and an event's own geography.",
      placement: "bottom",
    },
  ],
};

/**
 * Which observing card an event of each kind arrives in.
 *
 * The rail names its event cards after the kind, so this is the inverse of
 * `catalogueEventForCard` and the two must not drift apart.
 */
const CARD_FOR_EVENT: Record<string, string> = {
  "solar-eclipse": "solar-eclipse",
  "lunar-eclipse": "lunar-eclipse",
  "meteor-shower": "meteors",
};

/**
 * Leaving Tracker for the rest of Orbit Studio.
 *
 * Explorer and Playground switch products inside one React tree; Tracker is
 * mounted from its own entry point behind `?app=tracker`, so the way out is a
 * real navigation rather than a state change. The destinations are the same
 * three the other two offer, spelled the way this entry point understands them.
 */
const suite = {
  home: () => window.location.assign(window.location.pathname),
  explorer: () => window.location.assign(`${window.location.pathname}?app=explorer`),
  playground: () => window.location.assign(`${window.location.pathname}?app=playground`),
};

/**
 * The brand mark, which is also the way home.
 *
 * Explorer and Playground both put their logo at the top left and make it the
 * button that returns to Orbit Studio. Tracker had neither the mark nor the
 * route: once a reader was on the map there was no way back to the suite short
 * of editing the URL. This is the same control they already know, and it
 * collapses to the icon where the full mark will not fit.
 */
function TrackerBrand() {
  return (
    <button
      type="button"
      className="tk-brand"
      aria-label="Open Orbit Studio home"
      onClick={suite.home}
    >
      <img className="tk-brand-full" src="/brand/orbit-studio-tracker-logo-dark.png" alt="Orbit Studio Tracker" />
      <img className="tk-brand-icon" src="/brand/orbit-studio-tracker-icon.png" alt="" aria-hidden />
    </button>
  );
}

function TrackerSuiteMenu() {
  return (
    <OrbitAppMenu
      activeApp="tracker"
      onOpenHome={suite.home}
      onOpenExplorer={suite.explorer}
      onOpenPlayground={suite.playground}
      onOpenTracker={suite.home}
    />
  );
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
  /**
   * What the list is ordered by: the significance band with the event's own
   * quality placing it inside that band. See `significance.ts` — this is why a
   * routine Full Moon with the night's highest raw strength still sorts below a
   * partial lunar eclipse.
   */
  priority: number;
  /**
   * Whether this belongs in Best tonight at all, and why.
   *
   * Kept on the event rather than filtered away immediately, because an
   * ineligible phenomenon is still reachable by direct lookup and needs to be
   * able to say why it is not being recommended.
   */
  eligibility: EligibilityVerdict;
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
  /**
   * Where the reader is on the map, in the browser's history.
   *
   * `navigate` pushes and `settle` replaces — see `useTrackerMapHistory` for
   * why a map needs both. Panning must not fill the back stack, and Back from a
   * drill-in must still land on the viewport that was on screen.
   */
  const { location, navigate, settle, back, returnTo } = useTrackerMapHistory();
  /** One view. The date says which night; there is nothing else to choose. */
  const view: TrackerView = "tonight";

  /**
   * The pin is the observing location.
   *
   * Not a separate "inspected" point beside a confirmed home: one pin, one
   * meaning, so "what can I see from here" has exactly one answer. The stored
   * confirmed place seeds the first pin and is otherwise just a memory of where
   * the reader was last.
   */
  const [placeName, setPlaceName] = useState<SelectedPlace | null>(() => loadConfirmedPlace());
  const place = useMemo<SelectedPlace | null>(() => {
    if (!location.pin) return null;
    // A named place is only the same place while the pin has not moved off it.
    const named =
      placeName &&
      Math.abs(placeName.latitude - location.pin.latitudeDeg) < 0.01 &&
      Math.abs(placeName.longitude - location.pin.longitudeDeg) < 0.01
        ? placeName
        : null;
    return (
      named ?? {
        // No comma: `shortPlaceName` takes the part before the first one, which
        // is the right rule for "Portland, Oregon, United States" and would cut
        // a coordinate pair in half.
        name: `${location.pin.latitudeDeg.toFixed(2)}° ${location.pin.latitudeDeg >= 0 ? "N" : "S"} ${Math.abs(location.pin.longitudeDeg).toFixed(2)}° ${location.pin.longitudeDeg >= 0 ? "E" : "W"}`,
        context: "Picked on the map",
        latitude: location.pin.latitudeDeg,
        longitude: location.pin.longitudeDeg,
        fromDevice: false,
      }
    );
  }, [location.pin, placeName]);

  /**
   * Whether the reader named this place themselves.
   *
   * The precedence the product needs, in order: a place the reader searched for
   * and chose; a place resolved from their device; a reverse lookup for a point
   * they simply tapped; and coordinates when none of those is honest.
   *
   * Only the third of those should ever be overwritten by a geocoder. Search
   * for "Wood Village" and Tracker was calling it "Troutdale" a moment later,
   * because Photon reports the nearest settlement to those coordinates and the
   * panel took that answer over the reader's own. A reverse lookup is a good
   * guess about a point nobody named; it is not a correction to a name somebody
   * chose on purpose.
   */
  const placeWasChosen = useMemo(
    () =>
      Boolean(
        location.pin &&
          placeName &&
          Math.abs(placeName.latitude - location.pin.latitudeDeg) < 0.01 &&
          Math.abs(placeName.longitude - location.pin.longitudeDeg) < 0.01,
      ),
    [location.pin, placeName],
  );

  /**
   * What the pinned point turns out to be.
   *
   * ## Why it is a query rather than part of the pin
   *
   * The pin is a coordinate and is authoritative immediately; the *name* is a
   * network round trip that may fail. Keeping them apart is what lets the panel
   * open with the point already selected and fill the name in when it arrives,
   * instead of waiting on a geocoder before showing anything.
   *
   * Keyed on the rounded pin so panning within a hundred metres does not
   * re-ask, and cached for the session because a place does not move.
   */
  const pinKey = location.pin
    ? `${location.pin.latitudeDeg.toFixed(3)},${location.pin.longitudeDeg.toFixed(3)}`
    : null;
  const pinContext = useQuery({
    queryKey: ["tracker", "reverse", pinKey],
    enabled: pinKey !== null,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!location.pin) return null;
      const adapter = geocoderFor();
      if (!adapter?.reverse) return null;
      const found = await adapter.reverse(
        location.pin.latitudeDeg,
        location.pin.longitudeDeg,
        signal,
      );
      // Past this the nearest named thing is not a description of where the
      // reader pointed. Ocean taps come back with an island four hundred
      // kilometres away, and naming it would be inventing context.
      if (!found || (found.distanceKm !== null && found.distanceKm > 60)) return null;
      return found;
    },
  });

  /**
   * Choosing a place through the picker or the device.
   *
   * Both the name and the pin move together, and the pin is what everything
   * downstream reads — so a search result and a tap on the map arrive at
   * exactly the same state.
   */
  const selectPlace = useCallback(
    (next: SelectedPlace) => {
      setPlaceName(next);
      navigate({
        pin: { latitudeDeg: next.latitude, longitudeDeg: next.longitude },
        centre: { latitudeDeg: next.latitude, longitudeDeg: next.longitude },
        /**
         * Close enough to see the region, far enough to see where else to go.
         *
         * The floor was 2.6, which meant something on the hand-built map's
         * 1–4 scale and means "most of a continent" in MapLibre's. Searching
         * for Wood Village put the reader in orbit over North America. At 8.5
         * the answer arrives with Portland, Gresham, the Columbia and the road
         * out to Mount Hood around it, which is the context that makes a
         * location worth choosing.
         *
         * A floor rather than an assignment, so somebody already looking
         * closely at a valley is not pulled back out by naming a place in it.
         */
        zoom: Math.max(location.zoom, 8.5),
        detail: null,
        drill: null,
      });
    },
    [location.zoom, navigate],
  );

  const selectedId = location.detail;
  const overlay: Overlay =
    location.detail && location.drill === "sky"
      ? "sky-map"
      : location.detail && location.drill === "field"
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
  selectedIdRef.current = selectedId;
  drillRef.current = location.drill;
  /**
   * Whether the layer sheet is open, for the narrow-screen rules only.
   *
   * Deliberately not in the URL: it is not a place the reader can be sent to,
   * and putting it there would make opening a panel a thing to press Back
   * through.
   */
  const [layersOpen, setLayersOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  /**
   * The instant "today" rolls over on, kept separate from the chosen date.
   *
   * Only used when no date is selected. It exists so a page left open across
   * midnight moves to the new night on its own; a page showing a chosen date
   * must not move at all.
   */
  const [todayAnchor, setTodayAnchor] = useState(() => new Date());

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

  /** Today in the observer's own zone, which is what "no date chosen" means. */
  const today = useMemo(() => todayIn(clock.timeZone, todayAnchor), [clock.timeZone, todayAnchor]);

  /** The date on screen: the reader's choice, or today. */
  const selectedDate = location.date ?? today;
  const isToday = selectedDate === today;

  /**
   * The instant handed to the astronomy.
   *
   * For a chosen date, local noon: the observation period anchors to the night
   * an instant falls in, so midnight on the 12th would land inside the 11th's
   * evening and quietly answer for the wrong night.
   *
   * For today, `now` — which is not the same thing. A reader looking at this at
   * 1 AM is inside a night that began yesterday evening, and that night is the
   * one they are standing under. Anchoring today at noon would skip it and show
   * them the *next* evening, twenty hours away: the aurora nowcast would fall
   * outside its half-hour horizon, and the page would drop to the three-day
   * K-index for a night the reader is currently outside in.
   */
  const planAnchor = useMemo(
    () => (isToday ? todayAnchor : instantForDate(selectedDate, clock.timeZone)),
    [clock.timeZone, isToday, selectedDate, todayAnchor],
  );

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
  /**
   * The identity of the last *real* plan, not merely the last effect run.
   *
   * The guard used to be a boolean flipped on the first run, and that was not
   * the same thing. Tracker restores the reader's place from local storage
   * asynchronously, so the first run happens while `night` is still null and
   * only marks the flag; the plan then arrives, the identity changes from
   * nothing to something, and the effect treats that as "the night rolled over"
   * and clears the event.
   *
   * The consequence is the bug the comment above says this was written to
   * prevent, reintroduced from the other side: `?app=tracker&event=aurora`
   * loaded, the URL was rewritten to `?app=tracker`, and the reader landed on
   * Saturn. Comparing plan identities rather than counting runs makes the
   * condition say what it means — the night the reader was looking at has been
   * replaced by a different one.
   */
  const settledPlan = useRef<string | null>(null);
  useEffect(() => {
    const key = night?.identity.key ?? null;
    const previous = settledPlan.current;
    if (key !== null) settledPlan.current = key;
    const rolledOver = previous !== null && key !== null && previous !== key;
    // The guard used to also ask whether the reader was in Tonight rather than
    // Upcoming. There is only one view now, so the question has no content.
    if (rolledOver && (selectedIdRef.current !== null || drillRef.current !== null)) {
      settle({ detail: null, drill: null });
    }
    if (!night) return;
    const delay = Math.min(
      Math.max(1_000, Date.parse(night.period.endUtc) - Date.now() + 1_000),
      2_147_000_000,
    );
    const timer = globalThis.setTimeout(() => setTodayAnchor(new Date()), delay);
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
      if (hasPassedTonight(opportunity.profile, now, night.period)) {
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

  const tonightEvents = useMemo<TonightEvent[]>(() => {
    if (!night || !withSky || !place) return [];
    const context = {
      clock,
      now,
      meteors: night.meteors,
      evidenceStatus: environment.status,
      // What to call this night, so every sentence agrees with the heading.
      nightLabel: describeDate(selectedDate, today).heading,
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
              credit:
                "Drawn from this pairing's own positions at the recommended moment. Discs are enlarged to be legible; the separation between them is to scale.",
            }
          : /**
             * A solar eclipse is drawn too, for the same reason.
             *
             * It used to fall through to a generic long exposure of a dark sky
             * at Paranal — an image with no eclipse in it, under a heading
             * announcing an annular one. What the reader needs is how much of
             * the Sun is covered *here*, which the event already knows, so the
             * hero draws that number instead of illustrating the wrong thing.
             */
            science?.kind === "solar-eclipse"
            ? {
                kind: "drawn" as const,
                node: <EclipseFigure media={cardMediaFor(entry.opportunity) as never} />,
                credit:
                  "Drawn from this eclipse's own local circumstances: the Sun's disc, and how much of it the Moon covers from the selected place at maximum.",
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
        /**
         * What the reader will actually see, matched to what is being shown.
         *
         * Taken from the imagery's own note only when imagery is what is on
         * screen. A drawn eclipse inherited the night-sky photograph's caption
         * — "a long exposure from a dark observatory site" — under a picture of
         * a corona, describing an image that was no longer there.
         */
        expectation:
          media.kind === "drawn" && science?.kind === "conjunction"
            ? "Two points of light close together, and nothing like this size. The drawing enlarges both so they can be told apart; what your eyes see is the Moon at this phase with a steady point beside it, separated by about the width shown."
            : media.kind === "drawn" && science?.kind === "solar-eclipse"
              ? entry.opportunity.guidance.appearance
              : imagery.eyeExpectation,
        safety: entry.opportunity.guidance.safety,
        // Passed events sink rather than disappear: "the Moon is already down"
        // is worth being able to see, and it is not a recommendation.
        priority: passed ? -1 : entry.priority,
        /**
         * Eligibility, decided on the phenomenon and never on the weather.
         *
         * `entry.strength` keeps its phenomenon-only meaning — the weather is
         * applied to ordering, not to it — so a clear sky cannot promote
         * something into this list and cloud cannot drop it out.
         */
        eligibility: passed
          ? { eligible: false, reason: "Already set for tonight." }
          : entry.opportunity.kind === "meteors"
            ? // The rate this observer would actually see at the best moment,
              // not the shower's headline ZHR under ideal skies.
              // The *shower's* contribution, not the total: the sporadic
              // background is exactly what this gate is trying to exclude, so
              // counting it towards the threshold would defeat the gate.
              meteorEligibility(entry.opportunity, night.meteors.best?.showerPerHour ?? null)
            : entry.opportunity.kind === "moon"
              ? moonEligibility(entry.opportunity)
              : generalEligibility(entry.strength),
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
                      /**
                       * The band is limited by the aurora, not only by the sky.
                       *
                       * This was `access` alone, so a clear night over a quiet
                       * field produced "Excellent" — and that word appeared in
                       * the Best tonight column beside a page explaining that
                       * the oval was too far north to see. The reader is told
                       * the opportunity is excellent and, two lines down, that
                       * there is nothing to look at.
                       *
                       * Every other event takes `min(sky, phenomenon)` in
                       * `viewability`; aurora bypassed it by building this
                       * object by hand. It now applies the same rule, with the
                       * aurora's own ranking strength as the phenomenon term.
                       */
                      band: (() => {
                        const limiting = Math.min(access, ranking.strength / 0.6);
                        return limiting >= 0.7
                          ? "excellent"
                          : limiting >= 0.45
                            ? "good"
                            : limiting >= 0.2
                              ? "possible"
                              : "unlikely";
                      })(),
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
              : { label: VISIBILITY_LABEL, value: "Not known", tone: "unknown" },
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
            // The credit already says what this is and where it came from,
            // which is the part that matters; "Forecast visualisation" only
            // named the asset category.
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
          priority: !worthListing
            ? -0.5
            : expired
              ? 0.05
              : priorityFor(
                  // Aurora's band comes from whether it could be seen from
                  // here, which is the same question `auroraEligibility` asks
                  // and a different one from what OVATION reports overhead.
                  auroraSignificance(
                    auroraLocalVisibility?.kind === "overhead"
                      ? "overhead"
                      : auroraLocalVisibility?.kind === "horizon"
                        ? "horizon"
                        : "none",
                  ),
                  ranking.strength,
                ),
          /**
           * Aurora earns its slot from the aurora, not from the sky.
           *
           * It used to be listed unconditionally so that a reader at high
           * latitude would always find it. That was the right instinct applied
           * in the wrong place: being findable is a job for direct lookup, and
           * a permanent row in a recommendation list says "this is one of
           * tonight's options" about a night with no aurora.
           */
          eligibility: auroraEligibility(auroraLocalVisibility, Boolean(darkWindow)),
          entry: null,
          window: null,
          passed: false,
        });
      }
    }

    /**
     * Everything observable, ranked, whether recommended or not.
     *
     * Ineligible events keep a rank here so they remain openable by direct
     * lookup — excluding something from a recommendation list must not delete
     * it from the product. What Best tonight shows is the eligible subset,
     * taken below.
     */
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

  /**
   * The ranked list, favouring the category currently on the hero.
   *
   * "Favouring" is a stable partition rather than a re-score: events of the
   * active category keep their own order and come first, then everything else
   * keeps its own order. The ranking is never rewritten to flatter the page you
   * happen to be on — a meteor page with nothing observable still shows Saturn
   * above a shower that has finished.
   */
  /**
   * Best tonight: the eligible subset, re-ranked among themselves.
   *
   * Two stages, deliberately separate. Eligibility asks whether there is a real
   * reason to go outside for this tonight; ranking asks how the real reasons
   * compare. Collapsing them is what produced a six-row list with aurora sixth
   * on a night with no aurora — an ordering of things nobody should order.
   */
  const bestTonight = useMemo(
    () => rankTonight(tonightEvents.filter((event) => event.eligibility.eligible)),
    [tonightEvents],
  );

  /**
   * What leads the page: the top of the one ranking, and nothing else.
   *
   * ## The contradiction this removes
   *
   * There used to be two authorities. `chooseHero` picked the hero from the
   * *full* ranked set — everything observable, recommended or not — and it won
   * whenever its pick out-scored the top of Best tonight. On a real night from
   * Portland that produced a page led by the Full Moon, whose own card said
   * there was no particular lunar event to watch, above a Best tonight list
   * whose first row was Saturn. Two surfaces, two answers, both computed by
   * Tracker, neither wrong on its own terms.
   *
   * The brief's requirement is one authoritative model that the hero, the side
   * visualization, the ranked list and the detail copy all agree with. So the
   * hero is `bestTonight[0]` — literally the same array the list renders from,
   * with the same ranks — and the only thing that can override it is the reader
   * explicitly opening something else.
   *
   * The guarantees `chooseHero` existed to provide have not been dropped; they
   * moved into the ordering itself. A telescope target still cannot displace a
   * naked-eye one, because `EQUIPMENT_DEMOTION` is applied to `strength` before
   * the band is computed. Nothing weak is promoted to fill the slot, because
   * eligibility already removed everything below the floor. And where nothing
   * is eligible at all, the page says so rather than leading with the least bad
   * option — which is why the fallback is a quiet-night state and not
   * `tonightEvents[0]`.
   */
  const heroEvent = useMemo(() => {
    if (selectedId) {
      const found = tonightEvents.find((event) => event.id === selectedId);
      if (found) return found;
    }
    return bestTonight[0] ?? null;
  }, [bestTonight, selectedId, tonightEvents]);


  /**
   * The hero's presentation, saying plainly when Tracker is not recommending it.
   *
   * The hero is normally the top of Best tonight and therefore eligible by
   * construction. The exception is direct lookup: a reader can open Meteors on a
   * night with no shower, and that page must still tell them the truth rather
   * than describing the sporadic background as tonight's opportunity.
   *
   * Only the recommendation sentence is replaced, and only with the eligibility
   * reason — which is a fact about the sky ("no shower is active tonight"),
   * never a verdict about the reader's evening. The three metrics are untouched
   * because they are facts too: the best time, the rate, and which way to face
   * are all still correct and still useful to somebody who went out anyway.
   */
  const heroPresentation = useMemo(() => {
    if (!heroEvent) return null;
    if (heroEvent.eligibility.eligible) return heroEvent.presentation;
    // A phenomenon that already explains its own limiting condition keeps its
    // own words; replacing them with the generic reason loses detail. See
    // `EventPresentation.selfExplaining`.
    if (heroEvent.presentation.selfExplaining) return heroEvent.presentation;
    return {
      ...heroEvent.presentation,
      recommendation: heroEvent.presentation.where
        ? `${heroEvent.eligibility.reason} ${heroEvent.presentation.where.sentence}`
        : heroEvent.eligibility.reason,
    } as EventPresentation;
  }, [heroEvent]);

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
    /**
     * Only the eligible, and never padded.
     *
     * A night with one worthwhile opportunity shows one row. The selected event
     * is appended only when it is itself eligible; opening something Tracker
     * does not recommend shows it in the hero with the reason, and does not
     * insert it into a list of recommendations.
     */
    return visibleRanked(bestTonight, heroEvent.id, 6).map((event) => ({
      presentation: event.presentation,
      imagery: event.media.kind === "imagery" ? event.media.imagery : null,
      thumb: event.media.kind === "drawn" ? event.media.node : undefined,
      illuminatedFraction:
        event.media.kind === "imagery" ? event.media.illuminatedFraction : undefined,
      waning: event.media.kind === "imagery" ? event.media.waning : undefined,
      active: event.id === heroEvent.id,
      rank: event.rank,
    }));
  }, [bestTonight, heroEvent]);

  /**
   * The air, read from the whole hourly series rather than from one snapshot.
   *
   * The NowCast needs the twelve hours before the instant being asked about,
   * and the merged snapshots carry one value each — so this reads the aerosol
   * series directly. Null without it, which suppresses the health card, which
   * is the right answer for a page that cannot show its working.
   */
  const airQuality = useMemo(
    () =>
      aerosol.data && heroEvent
        ? readAirQuality(
            aerosol.data.map((sample) => ({ atUtc: sample.atUtc, pm25: sample.surfacePm25 })),
            heroEvent.presentation.atUtc,
            now,
          )
        : null,
    [aerosol.data, heroEvent, now],
  );

  const conditions = useMemo(() => {
    if (!place || !heroEvent) return [];
    const opportunity = heroEvent.entry?.opportunity ?? null;
    const category = heroEvent.presentation.categoryId;
    return conditionCards({
      atUtc: heroEvent.presentation.atUtc,
      latitudeDeg: place.latitude,
      longitudeDeg: place.longitude,
      snapshots,
      airQuality,
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
  }, [airQuality, conditionsPending, environment.status, heroEvent, now, place, snapshots]);

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
    // Named for the night actually on screen. "Saturn tonight" is wrong in a
    // tab showing 7 September, and the tab title is how this page is found
    // again in a row of tabs, in history and in a shared link.
    document.title = heroEvent
      ? `${heroEvent.presentation.title} ${describeDate(selectedDate, today).heading} — Orbit Studio Tracker`
      : "Orbit Studio Tracker";
  }, [heroEvent, selectedDate, today]);

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
    () =>
      heroEvent?.entry
        ? // The same instant the hero's instruction names, so the drawn region
          // and the sentence beside it cannot describe different moments.
          gazeRegionFor(heroEvent.entry.opportunity, skyPath, heroEvent.presentation.atUtc)
        : null,
    [heroEvent, skyPath],
  );


  /**
   * The exploratory twin of the aurora panel.
   *
   * Built separately rather than reusing the card's element, because the card
   * shares a scroll surface with the page and must not capture drags, while
   * this one has the screen to itself and should. Only aurora needs it here —
   * every other Tonight visualization is a chart rather than a map.
   */
  const lunarEclipseField = useMemo(
    () => lunarEclipseGeometry(heroEvent, place, "card"),
    [heroEvent, place],
  );

  /**
   * The same eclipse at hemisphere scale, built once and kept.
   *
   * Separate from the card's node rather than shared, exactly as the aurora map
   * is. Sharing one node made the card behind the overlay silently become the
   * interactive, finely sampled version of itself — a panel that shares a scroll
   * surface with the page must not capture drags, and the expanded one has the
   * screen to itself and should.
   *
   * Keying this on `overlay` meant the whole hemisphere was re-derived every
   * time the drill-in opened — and closing and reopening the same map measured
   * 15 427 ms in the production build at phone width, worse than the first open
   * because the browser was also tearing down and rebuilding the field.
   *
   * Nothing about the geometry depends on whether the overlay is open: the
   * eclipse's contact times and the reader's coordinates are the only inputs.
   * So the cache is keyed on those, `overlay` only decides whether the node is
   * rendered, and reopening is a lookup. A single entry is enough — the reader
   * has one event open at a time, and holding the previous event's hemisphere
   * would be megabytes to save a computation they may never ask for again.
   */
  const expandedEclipseCache = useRef<{
    key: string;
    value: ReturnType<typeof lunarEclipseGeometry>;
  } | null>(null);

  /**
   * The cache key: the eclipse and the place, which are its only inputs.
   *
   * Null whenever there is no hemisphere to build, which is how both the warm-up
   * below and the read at open time agree on when there is nothing to do.
   */
  const expandedEclipseKey = useMemo(() => {
    const science = heroEvent?.entry?.opportunity.science;
    if (!place || science?.kind !== "lunar-eclipse") return null;
    return `${science.timing.maximumUtc}|${place.latitude}|${place.longitude}`;
  }, [heroEvent, place]);

  const buildExpandedEclipse = useCallback(() => {
    if (!expandedEclipseKey) return null;
    if (expandedEclipseCache.current?.key !== expandedEclipseKey) {
      expandedEclipseCache.current = {
        key: expandedEclipseKey,
        value: lunarEclipseGeometry(heroEvent, place, "full"),
      };
    }
    return expandedEclipseCache.current.value;
  }, [expandedEclipseKey, heroEvent, place]);

  /**
   * ## The warm-up that was tried here, and taken out again
   *
   * The obvious next move after the drawing was fixed was to build the
   * hemisphere before it was asked for: the reader is already looking at a card
   * labelled "Open full map", and idle time is free. It worked — the longest
   * task on open fell from 202 ms to 105 ms.
   *
   * It also broke Escape. The accessibility gate reported that focus no longer
   * returned to the location picker's trigger when its popover was dismissed,
   * and the cause was this: React Aria restores focus asynchronously after the
   * popover unmounts, and a forty-millisecond synchronous block landing in that
   * window pushes the restore past the moment it is expected. That is not a
   * test artifact — a reader pressing Escape while the warm-up ran would feel
   * the same delay, on the control this product's whole entry flow depends on.
   *
   * Chunking the geometry would fix it and means restructuring the astronomy;
   * a worker would fix it and means serialising thirty thousand cells back
   * across the boundary. Neither is worth a hundred milliseconds on an
   * interaction that is already well under the threshold where anyone notices.
   * So the work stays on the open, where it is one task nobody is waiting
   * through, and the picker keeps its keyboard behaviour.
   */
  const lunarEclipseExpanded = useMemo(() => {
    if (overlay !== "field-map") return null;
    // A cache hit in the ordinary case; the warm-up above has usually run.
    return buildExpandedEclipse();
    // `expandedEclipseKey` is a dependency in substance — `buildExpandedEclipse`
    // closes over it — and is listed so the memo re-reads when the event changes.
  }, [buildExpandedEclipse, expandedEclipseKey, overlay]);

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

  /**
   * A solar eclipse's geography, for the page and its drill-in.
   *
   * Built only when the night's hero actually is one, because tracing the path
   * and sampling the coverage is real work and no other event needs it.
   */
  const solarEclipseField = useMemo(() => {
    if (!place || !heroEvent || heroEvent.presentation.categoryId !== "eclipses") return null;
    const science = heroEvent.entry?.opportunity.science;
    if (!science || science.kind !== "solar-eclipse") return null;
    const found = nextSolarEclipses(new Date(Date.parse(science.peakUtc) - 86_400_000), 2).find(
      (entry) => Math.abs(Date.parse(entry.peakUtc) - Date.parse(science.peakUtc)) < 86_400_000,
    );
    if (!found) return null;
    const centralPath = traceCentralPath(found, 6, 240, true);
    const bounds = mapExtentFor(place.latitude, place.longitude, centralPath, 26, 72);
    return {
      event: found,
      centralPath,
      bounds,
      coverage: coverageField(found, bounds, 1.5),
      local: localSolarCircumstances(found, place.latitude, place.longitude, centralPath),
    };
  }, [heroEvent, place]);

  /**
   * The eclipse map at hemisphere scale, for the drill-in.
   *
   * Interactive here and inert on the card, for the reason the aurora map is:
   * a panel sharing a scroll surface with the page must not capture drags, and
   * this one owns the screen.
   */
  const expandedEclipse = useMemo(() => {
    if (!lunarEclipseExpanded || !place || !heroEvent) return null;
    return (
      <Suspense fallback={<div className="tk-viz-panel tk-viz-loading" aria-busy="true" />}>
        <TrackerEclipseMap
          kind="lunar"
          title={heroEvent.presentation.title}
          maximumUtc={lunarEclipseExpanded.timing.maximumUtc}
          visibility={lunarEclipseExpanded.visibility}
          local={lunarEclipseExpanded.local}
          bounds={lunarEclipseExpanded.bounds}
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
          timing={lunarEclipseExpanded.timing}
          observerAltitudeDeg={lunarEclipseExpanded.altitudeDeg}
        />
      </Suspense>
    );
  }, [clock, heroEvent, inspected, lunarEclipseExpanded, place]);

  /**
   * The clip that shows what this actually looks like, where one exists.
   *
   * Hoisted out of the overlay's JSX so the sporadic-meteor state can put it
   * beside the practical steps: the clip is pinned at 604px by its aspect
   * ratio, and on its own in a thousand-pixel panel it left a dark column that
   * read as content failing to load.
   */
  const footageNode = useMemo(() => {
    const experience = heroEvent?.entry ? experienceFor(heroEvent.entry.opportunity.kind) : null;
    return experience ? (
      <div className="tk-overlay-footage">
        <TrackerExperience media={experience} />
      </div>
    ) : null;
  }, [heroEvent]);

  /**
   * The lunar eclipse's geographic visibility, when one is the hero.
   *
   * ## Why this is here at all
   *
   * The right-hand slot is "phenomenon-specific primary evidence", and for an
   * eclipse that evidence is geographic: whether the Moon is above the horizon
   * where you are while Earth's shadow crosses it, and where else on Earth the
   * same is true. Tonight's page was falling through to the altitude-and-bearing
   * chart instead — which is a real and useful tool, and is the answer to a
   * different question. The Upcoming page had the geographic map all along, so
   * the same eclipse showed two different primary visualizations depending on
   * which door the reader came through.
   *
   * Computed in its own memo rather than inside `visualization` so the sampling
   * — which is a few thousand horizon evaluations — is not redone every time an
   * unrelated dependency of that memo changes.
   */
  /**
   * Whether the reason there is nothing to recommend is simply the hour.
   *
   * Dawn is not a disappointing night. Every opportunity having *passed* is a
   * different statement from none of them being worth going out for, and a
   * reader at 5:59am told "nothing stands out tonight" would rightly conclude
   * Tracker had not noticed the sun coming up.
   */
  const nightIsOver = useMemo(() => {
    if (!night || tonightEvents.length === 0) return false;
    if (now.getTime() < Date.parse(night.period.startUtc)) return false;
    return tonightEvents.every((event) => event.passed);
  }, [night, now, tonightEvents]);

  const visualization = useMemo(() => {
    if (!heroEvent || !night || !place) return null;
    const timing = `${formatClockTime(night.period.startUtc, clock)} to ${formatClockTime(night.period.endUtc, clock)}`;
    // "Saturn tonight" is wrong on a night that is not tonight.
    const nightWord = describeDate(selectedDate, today).heading;
    /**
     * The line under the chart, which is now an instruction rather than a grade.
     *
     * It used to read "Worth going out for tonight" / "Worth a look if you are
     * out anyway" — the same lifestyle verdict the hero has stopped giving, in
     * a panel whose whole subject is where and when. The chart already shows
     * the window; the words say which way to face while looking at it.
     */
    const where = heroEvent.presentation.where;
    const ineligible = !heroEvent.eligibility.eligible;
    const verdict = {
      headline: ineligible
        ? heroEvent.eligibility.reason
        : (where?.sentence ??
          `Best around ${formatClockTime(heroEvent.presentation.atUtc, clock)} ${nightWord}.`),
      detail: where?.change ?? heroEvent.presentation.support ?? "",
      tone: "unknown" as const,
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

    /**
     * An eclipse leads with where on Earth, never with where in your sky.
     *
     * The universal hierarchy is: left, the recommendation; right, the
     * phenomenon's own primary evidence. For an eclipse that evidence is the
     * visibility footprint — the question "can I see it from here" is a question
     * about geography, and the altitude chart cannot answer it. The chart is
     * still one control away, under "Where to look", where it answers the
     * question it is actually good at.
     */
    /**
     * A solar eclipse leads with where on Earth, exactly as a lunar one does.
     *
     * This branch is new because solar eclipses are new to this page. They used
     * to reach a page only through the Upcoming browse, which built their
     * visualisation itself; now that they surface on their own date in the
     * ordinary ranking, the page they land on has to draw them. Without this
     * the reader got an eclipse page with a sky chart on it — a chart that
     * cannot answer the only question a solar eclipse raises, which is whether
     * the shadow reaches where they are standing.
     */
    if (solarEclipseField) {
      return (
        <Suspense fallback={<div className="tk-viz-panel tk-viz-loading" aria-busy="true" />}>
          <TrackerEclipseMap
            kind="solar"
            event={solarEclipseField.event}
            coverage={solarEclipseField.coverage}
            centralPath={solarEclipseField.centralPath}
            local={solarEclipseField.local}
            bounds={solarEclipseField.bounds}
            observer={{
              latitudeDeg: place.latitude,
              longitudeDeg: place.longitude,
              label: place.name,
            }}
            clock={clock}
            onOpenFullMap={() => navigate({ drill: "field" })}
            interactive={false}
            inspection={null}
            destinations={null}
          />
        </Suspense>
      );
    }

    if (lunarEclipseField) {
      return (
        <Suspense fallback={<div className="tk-viz-panel tk-viz-loading" aria-busy="true" />}>
          <TrackerEclipseMap
            kind="lunar"
            title={heroEvent.presentation.title}
            maximumUtc={lunarEclipseField.timing.maximumUtc}
            visibility={lunarEclipseField.visibility}
            local={lunarEclipseField.local}
            bounds={lunarEclipseField.bounds}
            observer={{
              latitudeDeg: place.latitude,
              longitudeDeg: place.longitude,
              label: place.name,
            }}
            clock={clock}
            // Null on the expanded map itself: a control that reopens the thing
            // you are already looking at is the inert-button defect in another
            // costume.
            onOpenFullMap={() => navigate({ drill: "field" })}
            interactive={false}
            inspection={null}
            timing={lunarEclipseField.timing}
            observerAltitudeDeg={lunarEclipseField.altitudeDeg}
          />
        </Suspense>
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
          title={`Meteor activity ${nightWord}`}
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
          title={`${heroEvent.presentation.title} ${nightWord}`}
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
  }, [
    aurora.data,
    auroraAssessment,
    auroraLocalVisibility,
    clock,
    gaze,
    heroEvent,
    lunarEclipseField,
    navigate,
    night,
    place,
    selectedDate,
    skyPath,
    today,
  ]);


  /**
   * The map, always. Everything else is over it or instead of it.
   *
   * ## What changed, and why the old shape could not be adjusted
   *
   * This returned a `<main>` containing a header and then one of three
   * destinations — Upcoming, an event page, or a quiet-night notice. The map
   * existed inside one of them, as a panel, one click from the edge of the
   * product. Every question started with "which page", which is the interaction
   * model this pass exists to remove.
   *
   * Now there is one canvas. The controls float on it, the panel opens over it
   * when a point is picked, and the only thing that takes it off the screen is
   * a deliberate drill-in that the reader asked for and can Back out of.
   */
  /**
   * Which environment layers are on, narrowed to the ones that exist.
   *
   * The URL can carry anything; a stale link naming a layer that has since been
   * removed should open the map without it rather than with a broken one.
   */
  const activeLayers = useMemo(() => {
    const known = new Set<string>(MAP_LAYER_IDS);
    return new Set(location.layers.filter((entry) => known.has(entry)));
  }, [location.layers]);

  /**
   * The notable event the map is drawing, if any.
   *
   * Resolved from the catalogue rather than stored whole, so a shared link
   * carries an id and the geometry is recomputed from the ephemeris — nothing
   * about an eclipse is ever read back out of a URL.
   */
  const selectedEvent = useMemo<CatalogueEvent | null>(() => {
    if (!location.event) return null;
    // A generous window back, because a link to an event is often opened on the
    // day itself, by which time the search's own "from" has passed the peak.
    const from = new Date(Date.now() - 400 * 86_400_000);
    return catalogue(from).find((entry) => entry.id === location.event) ?? null;
  }, [location.event]);

  /**
   * The event's geography.
   *
   * Deliberately keyed on the event alone. These fields are global and depend
   * on nothing about where the reader is looking, so panning and zooming must
   * never recompute them — that lesson came from the eclipse map, and it is the
   * difference between a map that pans smoothly with an eclipse on it and one
   * that stutters.
   */
  const eventOverlay = useMemo(
    () => (selectedEvent ? buildEventOverlay(selectedEvent) : null),
    [selectedEvent],
  );

  /** Choosing an event sets the date to its night and draws it. */
  /**
   * Changing the night, and clearing what the night invalidates.
   *
   * The pin, the viewport and the active layers all survive: none of them is a
   * statement about a date, and moving the reader's map because they asked
   * about tomorrow would be a strange answer to the question. A drill-in is
   * dropped, because a sky chart drawn for one night's event is not a chart for
   * the next one.
   *
   * The selected event is dropped only when the new night is not its night. An
   * eclipse overlay belongs to the day the eclipse happens; left drawn over a
   * date three weeks later it is a path across the ground for something that is
   * not going to happen, which is worse than showing nothing. Where the event
   * does span the chosen night — a shower's peak date is its own — it stays,
   * so stepping a day either side of a peak does not throw the event away.
   *
   * Today is stored as null so a shared link does not pin somebody else's
   * "today" to the day it was copied.
   */
  const selectDate = useCallback(
    (next: string) => {
      const stale =
        selectedEvent !== null && eventDate(selectedEvent, clock.timeZone) !== next;
      navigate({
        date: next === today ? null : next,
        drill: null,
        ...(stale ? { event: null, card: null } : {}),
      });
    },
    [clock.timeZone, navigate, selectedEvent, today],
  );

  const selectEvent = useCallback(
    (event: CatalogueEvent) => {
      const date = eventDate(event, clock.timeZone);
      navigate({
        event: event.id,
        date: date === today ? null : date,
        detail: null,
        drill: null,
        // Open the card for it, so a search lands the reader on the answer
        // rather than on a highlighted map they now have to read. If that
        // event is not observable from here, the rail will not contain the
        // card and `expandedCardId` drops it — the map still moves, and no
        // empty card is forced open to explain an absence.
        card: CARD_FOR_EVENT[event.kind] ?? null,
      });
    },
    [clock.timeZone, navigate, today],
  );

  /**
   * The vendored light-pollution composite, decoded once and only when wanted.
   *
   * A megabyte of PNG and a full decode is not something to spend on a reader
   * who never opens the layer, so it is fetched the first time the layer is
   * switched on and kept for the session afterwards.
   */
  const lightPollution = useQuery({
    queryKey: ["tracker", "light-pollution"],
    enabled: location.layers.includes("light-pollution"),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: () => loadLightPollution(),
  });

  /**
   * The measurement at the selected place.
   *
   * A separate query from the archive itself because it is a different thing to
   * wait for: opening the archive fetches a 400 KB index once per session, and
   * this fetches the single 256×256 tile that covers the reader's own point.
   * Keyed on the place at three decimals — about 100 m, finer than the archive
   * resolves — so panning the map never triggers a fetch and only a genuine
   * change of place does.
   */
  const lightHere = useQuery({
    queryKey: [
      "tracker",
      "light-pollution",
      "at",
      place ? `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}` : null,
    ],
    enabled: Boolean(place) && Boolean(lightPollution.data),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    queryFn: () => lightPollution.data!.at(place!.latitude, place!.longitude),
  });

  /**
   * The nowcast grid itself, which is what the map draws from.
   *
   * OVATION is a *nowcast*: it describes the next half hour or so, and NOAA
   * publishes exactly one of them. Tracker lets the reader choose any night,
   * and the layer was drawing that same half-hour grid over every one of them —
   * a picture of tonight's aurora presented as a forecast for a date three
   * weeks out, with nothing on screen to say so. It is offered only for today,
   * and the panel says why on any other date.
   */
  const auroraGrid = selectedDate === today ? (aurora.data?.grid ?? null) : null;

  /**
   * The place as the reader should see it named, everywhere it is named.
   *
   * The map's picker and the event header's picker are the same control in two
   * places, and they were being handed different values: the map got the
   * reverse-geocoded name and the header got the raw record, so one said
   * "Fairbanks" while the other said "64.84° N 147.72° W · Picked on the map".
   * One point cannot have two names on one screen.
   */
  const namedPlace = useMemo(
    () =>
      place && !placeWasChosen && pinContext.data?.name
        ? { ...place, name: pinContext.data.name, context: pinContext.data.context }
        : place,
    [place, placeWasChosen, pinContext.data],
  );

  /**
   * Whether the map has been dragged far enough from the selection to be worth
   * offering a way back. Half a screen at the current scale, roughly — close
   * enough and the button would be a no-op with a different label.
   */
  const awayFromPin = useMemo(() => {
    if (!location.pin) return false;
    const degreesAcross = 360 / 2 ** location.zoom;
    return (
      Math.abs(location.centre.latitudeDeg - location.pin.latitudeDeg) > degreesAcross * 0.25 ||
      Math.abs(location.centre.longitudeDeg - location.pin.longitudeDeg) > degreesAcross * 0.25
    );
  }, [location.centre, location.pin, location.zoom]);

  /**
   * What each active layer says at the selected point, in words.
   *
   * Reading a value off a colour ramp is the reader's job only if the product
   * has failed: whatever is drawn has to be interpretable at the one point they
   * care about. A list rather than one value, because several layers can be on.
   */
  /**
   * What each active layer reads at the selected point.
   *
   * Keyed by layer rather than listed, because these are now rendered under the
   * switch that turned each one on. They used to sit in a stack at the foot of
   * the location panel; when the rail replaced that panel the readings had
   * nowhere to go, and a layer that draws a continent-wide field with no
   * statement of what it says *here* leaves the reader matching a colour
   * against a legend — which is the work a map exists to do for them.
   */
  const layerReadings = useMemo(() => {
    if (!place) return undefined;
    const readings: Partial<Record<string, { value: string; detail: string | null }>> = {};
    if (activeLayers.has("light-pollution") && lightHere.data !== undefined) {
      const words = describeLightPollution(lightHere.data);
      readings["light-pollution"] = {
        // The measurement is quoted alongside the band, because the band is a
        // judgement and the number is the fact it was made from.
        value: `${words.label} · ${lightHere.data.toFixed(1)} nW/cm²/sr`,
        detail: words.detail,
      };
    }
    if (activeLayers.has("aurora") && auroraGrid) {
      const percent = auroraProbabilityAt(auroraGrid, place.latitude, place.longitude);
      readings.aurora = {
        value: percent > 0 ? `${percent}% chance here` : "Below 1% here",
        detail:
          percent >= 30
            ? "Worth watching the northern horizon."
            : percent >= 10
              ? "Possible low on the horizon from a dark site."
              : "Not expected from this latitude tonight.",
      };
    }
    return readings;
  }, [activeLayers, auroraGrid, lightHere.data, place]);

  /**
   * What the selected event means *here*.
   *
   * Computed at the exact coordinate rather than looked up in the drawn field:
   * the field is sampled at whatever step draws well, and for an eclipse a cell
   * four degrees away is the difference between totality and a partial.
   */
  /**
   * The rail: what is worth looking at from here, and in what order.
   *
   * Built from the same ranking the event page uses — two authorities
   * disagreeing about what is best is a defect this project has already fixed
   * once — with a floor applied so a quiet night shows two cards rather than
   * five, three of which are "something is above the horizon".
   */
  const railCards = useMemo(() => {
    const toCandidate = (event: (typeof tonightEvents)[number]): RailCandidate[] =>
      event.entry
        ? [
            {
              id: event.id,
              presentation: event.presentation,
              opportunity: event.entry.opportunity,
              rank: event.rank,
              significance: event.entry.opportunity.significance,
              media: cardMediaFor(event.entry.opportunity),
              window: event.window,
            },
          ]
        : [];

    const candidates: RailCandidate[] = bestTonight.flatMap(toCandidate);

    /**
     * The Moon, whether or not it was recommended.
     *
     * `bestTonight` is the *recommendation* list and it filters on eligibility,
     * which a routine phase does not pass — correctly, because "the Moon is up"
     * is not a reason to go outside. But its phase and its timing decide what
     * else is possible every single night, so the rail carries it regardless
     * and lets the reader decide. It is the one object that is always worth
     * knowing about.
     *
     * Skipped when an eclipse of it is already a candidate: the same body twice
     * is the duplication the rail's Moon rule exists to prevent.
     */
    const hasMoon = candidates.some((candidate) =>
      ["moon", "lunar-eclipse"].includes(candidate.opportunity.kind),
    );
    if (!hasMoon) {
      const moon = tonightEvents.find((event) => event.entry?.opportunity.kind === "moon");
      if (moon) candidates.push(...toCandidate(moon));
    }

    return buildRail(candidates);
  }, [bestTonight, tonightEvents]);

  /**
   * The catalogue event a rail card corresponds to, where there is one.
   *
   * This is what makes expanding a card change the map rather than merely
   * highlight the card. An eclipse card and the eclipse overlay are the same
   * subject reached two ways — through the rail or through event search — so
   * selecting either has to produce the same state, and the rail resolves its
   * card to the catalogue entry for the night on screen.
   *
   * Objects that are simply up have no catalogue entry and no overlay, which is
   * correct: there is no geography to Saturn being visible.
   */
  const catalogueEventForCard = useCallback(
    (cardId: string): string | null => {
      const kinds: Record<string, "solar-eclipse" | "lunar-eclipse" | "meteor-shower"> = {
        "solar-eclipse": "solar-eclipse",
        "lunar-eclipse": "lunar-eclipse",
        meteors: "meteor-shower",
      };
      const kind = kinds[cardId];
      if (!kind) return null;
      const from = new Date(Date.now() - 400 * 86_400_000);
      const match = catalogue(from).find(
        (entry) => entry.kind === kind && eventDate(entry, clock.timeZone) === selectedDate,
      );
      return match?.id ?? null;
    },
    [clock.timeZone, selectedDate],
  );

  /** The card the reader has open, narrowed to one that still exists. */
  const expandedCardId = useMemo(
    () => (railCards.some((card) => card.id === location.card) ? location.card : null),
    [location.card, railCards],
  );
  const expandedCard = railCards.find((card) => card.id === expandedCardId) ?? null;

  /**
   * An open card is a transient surface, so the map dismisses it like any other.
   *
   * It was the one overlay that ignored the convention: clicking the map left
   * the card open *and* moved the observing location, which is the worst of
   * both — the reader lost the place they had chosen and still had to find the
   * close button. Registering it here rather than in the rail because the open
   * card lives in the URL, not in the rail's own state.
   *
   * Dismissing this way does exactly what the card's own close button does, so
   * Back behaves the same however the reader closed it.
   */
  const collapseCard = useCallback(() => navigate({ card: null }), [navigate]);
  useDismissableSurface(expandedCardId !== null, collapseCard);

  /**
   * Where the reader should be facing for the card they have open.
   *
   * Taken from the card's own instruction rather than derived again. The
   * instruction reads the sky at the *recommended* moment, not at the night's
   * best — deliberately, because those differ on any night whose peak hour is
   * clouded out, and moving the window is the whole point. A cue computed from
   * the peak instead would point somewhere the card is not sending anybody,
   * which is worse than no cue: a reader who goes outside and finds the map
   * disagreeing with the card has been told two directions by one product.
   *
   * Null for a meteor shower even when its radiant is up and has a bearing.
   * The radiant is where the trails appear to come *from*; staring at it is
   * the commonest mistake in meteor watching, because trails there are head-on
   * and almost pointlike. The card says "Whole sky" and tells the reader to
   * look half the sky away from it, and an arrow on the map would undo that
   * sentence. Only a path you actually point at gets a cue.
   */
  const observingBearing = useMemo(() => {
    if (!expandedCard) return null;
    const instruction = expandedCard.presentation.where;
    if (!instruction || instruction.azimuthDeg === null) return null;
    const path = skyPathFor(expandedCard.opportunity, expandedCard.window);
    return path?.kind === "target" ? instruction.azimuthDeg : null;
  }, [expandedCard]);

  /**
   * Terrain for the expanded card, and only for it.
   *
   * Keyed on the card and the place, so panning and zooming never trigger a
   * DEM fetch and switching cards cancels the previous one. This is the whole
   * of the "do not compute terrain during pan" requirement: nothing here
   * depends on the viewport.
   */
  const terrain = useQuery({
    /**
     * Keyed on what the answer actually depends on, and nothing that ticks.
     *
     * The instant was in here, and it moves: the clock advances, the ranking
     * recomputes, the key changes, and the query restarts — aborting the one
     * that was almost finished. The card sat on "checking the terrain horizon"
     * for ever, having computed the right answer several times over and thrown
     * each one away. Terrain depends on the place, the bearing sector and the
     * night, not on the second.
     */
    queryKey: [
      "tracker",
      "terrain",
      place ? `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}` : null,
      expandedCard?.id ?? null,
      selectedDate,
    ],
    enabled: Boolean(place && expandedCard),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!place || !expandedCard) return null;
      const path = skyPathFor(expandedCard.opportunity, expandedCard.window);
      /**
       * Nothing to check where the phenomenon has no direction.
       *
       * A meteor shower's radiant has one, but the meteors do not: they arrive
       * over the whole sky, so a ridge in one direction does not block the
       * shower. Reporting terrain for it would be answering a question the
       * phenomenon does not raise.
       */
      if (!path || path.kind === "rate") return null;
      const best =
        path.points.reduce<(typeof path.points)[number] | null>(
          (top, point) => (!top || point.relative > top.relative ? point : top),
          null,
        ) ?? path.points[0];
      if (!best) return null;
      return assessEventTerrain({
        observer: { latitudeDeg: place.latitude, longitudeDeg: place.longitude },
        best: {
          atUtc: best.atUtc,
          azimuthDeg: best.azimuthDeg,
          altitudeDeg: best.altitudeDeg,
        },
        // Thinned: a point every few minutes is far finer than the terrain, and
        // each distinct bearing costs DEM tiles.
        track: path.points.filter((_, index) => index % 3 === 0),
        signal,
      });
    },
  });

  /**
   * Everything an expanded card shows, for that card.
   *
   * Phenomenon-specific by construction: the facts come from the presentation
   * the ranking already built for *that* event, so an eclipse shows contact
   * times and a planet shows an altitude without this function knowing which is
   * which. Conditions are the two that explain the observation; the terrain
   * line is only present once it has been computed.
   */
  const eventReading = useMemo(() => {
    if (!place || !selectedEvent || !eventOverlay) return null;
    return readEventAt(
      selectedEvent,
      eventOverlay,
      place.latitude,
      place.longitude,
      clock.timeZone ?? undefined,
    );
  }, [clock.timeZone, eventOverlay, place, selectedEvent]);

  const railFactsFor = useCallback(
    (card: (typeof railCards)[number]): RailFacts => {
      const expanded = card.id === expandedCardId;
      const [when, what, where] = card.presentation.metrics;
      const facts = [when, what, where]
        .filter((metric) => metric && metric.value)
        .map((metric) => ({ label: metric.label, value: metric.value }));
      const terrainResult = expanded ? terrain.data : undefined;
      return {
        facts,
        terrain:
          terrainResult
            ? describeTerrain(terrainResult, compassPoint(terrainResult.bearingDeg), (utc) =>
                formatClockTime(utc, clock),
              )
            : null,
        terrainPending: expanded && terrain.isFetching,
        conditions: PANEL_CONDITION_IDS.flatMap(
          (id) => conditions.find((entry) => entry.id === id) ?? [],
        ).slice(0, 2),
        /**
         * Why this is notable, in the significance model's own words.
         *
         * Its `reasons` are facts a reader could check — "37 days from
         * opposition" — which is exactly what the brief asks for in place of a
         * grade or a score.
         */
        note: card.significance?.reasons?.[0] ?? null,
        /**
         * Attached to the card the overlay is actually about.
         *
         * `CARD_FOR_EVENT` is the same mapping the event search uses, so a
         * reading can never surface on a card describing a different event.
         */
        event:
          selectedEvent && CARD_FOR_EVENT[selectedEvent.kind] === card.id ? eventReading : null,
      };
    },
    [clock, conditions, eventReading, expandedCardId, selectedEvent, terrain.data, terrain.isFetching],
  );




  /**
   * Upcoming is not a destination any more.
   *
   * It was a second place to be, with its own browse modes, its own calendar
   * and its own idea of time — built when Tracker navigated between Tonight and
   * Upcoming. The date control replaced that: a future night is this night with
   * a different date, reached by the same control, on the same map, without
   * going anywhere. Keeping a parallel destination alive beside it meant two
   * answers to "when", one of which nothing in the interface pointed at.
   *
   * `TrackerUpcoming` and the future-event data behind it are left in the tree
   * rather than deleted — the ranking and the horizon logic are worth keeping
   * and may well be wanted again — but nothing routes to them, and the URL no
   * longer carries a mode.
   */
  /**
   * The tour, offered once and never in the way.
   *
   * Started after the map has settled rather than on mount: a callout pointing
   * at a control while the map behind it is still blank teaches nothing, and
   * the rail step needs the rail to exist before it can point at it.
   */
  const onboarding = useOnboarding();
  const offeredTour = useRef(false);
  useEffect(() => {
    if (offeredTour.current || !place || !night) return;
    offeredTour.current = true;
    const timer = window.setTimeout(() => onboarding.offer(FIRST_RUN_TOUR), 1200);
    return () => window.clearTimeout(timer);
    // Offered once per session; `onboarding` is recreated each render and is
    // deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night, place]);

  const detailOpen = Boolean(place && location.detail);

  /**
   * The map as it was when the reader last left it for a full-screen page.
   *
   * "Back to the map" is a destination, not a step. Whatever the reader did
   * while they were away — changed the date, opened a drill-in, opened a
   * different event from the ranked list — the way back is to the map they
   * came from, in one press. Captured on the transition into the detail view
   * rather than read from history, because history is exactly the thing that
   * has moved on.
   */
  const mapBeforeDetail = useRef<TrackerMapLocation | null>(null);
  const wasDetailOpen = useRef(false);
  if (detailOpen && !wasDetailOpen.current) {
    mapBeforeDetail.current = { ...location, detail: null, drill: null };
  }
  wasDetailOpen.current = detailOpen;

  const backToMap = useCallback(() => {
    const remembered = mapBeforeDetail.current;
    // Nothing remembered means the reader arrived on a detail URL directly, so
    // the map they "came from" is the one this location describes without it.
    returnTo(remembered ?? { ...location, detail: null, drill: null });
  }, [location, returnTo]);
  /** Narrowed for the detail branch, which only renders when both exist. */
  const detailPlace = place;

  return (
    <main
      className="tracker-shell tk-map-shell"
      data-map-state={detailOpen ? "detail" : "map"}
      /* Read only by the narrow-screen rules, which collapse an expanded card
         while the layer sheet is open so the two do not fill the phone between
         them. The card stays selected; only its presentation is suppressed. */
      data-layers-open={layersOpen ? "true" : "false"}
    >
      {/* Search is the accessible route to a location: the map must never be
          the only way in, and a reader who cannot drag can still type. */}
      <a className="tracker-skip" href="#tk-map-search">
        Skip to place search
      </a>

      <TrackerMapCanvas
        centre={location.centre}
        zoom={location.zoom}
        // Looking around. Replaces the current entry, so a drag leaves one.
        onMove={(centre, zoom) => settle({ centre, zoom })}
        // A decision. Pushes, so Back undoes it.
        onPick={(point) =>
          navigate({
            pin: point,
            detail: null,
            drill: null,
          })
        }
        pin={location.pin}
        pinLabel={namedPlace ? shortPlaceName(namedPlace) : null}
        bearingDeg={observingBearing}
        daylightAt={now}
        auroraGrid={auroraGrid}
        lightPollution={lightPollution.data ?? null}
        layers={activeLayers}
        eventOverlay={eventOverlay}
        label="Map of observing locations"
      />

      {/* --- the furniture, placed by kind -------------------------------
       *
       * What you are looking at goes top left, when goes top centre, what is
       * drawn over it goes top right, what you do to the view goes bottom
       * right, and context that is only sometimes worth having goes bottom
       * left. A reader who finds one control can guess where the others are,
       * which is the whole of what makes this a system rather than five
       * widgets that happen to float.
       */}
      <div className="tk-map-topbar">
        {/* Inside the lead, not beside it: the bar is a three-column grid whose
            centre column must stay centred on the viewport, and a fourth child
            wrapped onto its own row and stretched across the width. */}
        <div className="tk-map-topbar-lead" id="tk-map-search">
          <TrackerBrand />
          {/* The trigger names what the panel names. Two labels for one point —
              a resolved place in the panel and raw coordinates in the header —
              is the interface arguing with itself. */}
          <TrackerPlace place={namedPlace} onSelect={selectPlace} />
        </div>

        {/* Time is a parameter of the map, not a place to navigate to. The
            segmented `Tonight | Upcoming` control that used to sit here made it
            a destination, which meant the reader had to leave the thing they
            were looking at in order to ask about a different night. */}
        <div className="tk-map-topbar-centre">
          <TrackerDate
            date={selectedDate}
            today={today}
            timeZone={clock.timeZone}
            onSelect={(next: string) => selectDate(next)}
          />
        </div>

        <div className="tk-map-topbar-end">
          {/* Product actions only. Choosing what the map draws used to sit
              here too, which put a map control in the navigation cluster; it
              now lives on the map's own edge with zoom and recentre. */}
          <TrackerEventFinder
            from={now}
            selected={selectedEvent}
            onSelect={selectEvent}
            onClear={() => navigate({ event: null })}
          />
          {/* Last in the group, because it leaves Tracker rather than changing
              what the map shows. It is also the only route home on a phone,
              where the brand mark does not fit. */}
          <TrackerSuiteMenu />
        </div>
      </div>

      <TrackerMapControls
        layersControl={
          <TrackerMapLayers
            readings={layerReadings}
            // Only when no rail card exists to carry it, so the reading appears
            // exactly once wherever the reader is looking.
            eventReading={
              eventReading &&
              !railCards.some(
                (card) => selectedEvent && CARD_FOR_EVENT[selectedEvent.kind] === card.id,
              )
                ? eventReading
                : null
            }
            active={activeLayers}
            onToggle={(layer) => {
              // A toggle in a set, so several layers can describe one place.
              const next = new Set(activeLayers);
              if (next.has(layer)) next.delete(layer);
              else next.add(layer);
              navigate({ layers: [...next] });
            }}
            unavailable={{
              ...(selectedDate !== today
                ? { aurora: "Forecast only reaches tonight" }
                : auroraGrid
                  ? {}
                  : { aurora: "No current forecast available" }),
              /**
               * The archive is a large object served from elsewhere, and
               * elsewhere can be down. Saying so is the difference between a
               * layer that is off and a layer that looks on and draws nothing —
               * which, for this one, would read as "no artificial light here".
               */
              ...(lightPollution.isError ? { "light-pollution": "Measurements unavailable" } : {}),
            }}
            eventOverlayLabel={selectedEvent ? overlayTitle(selectedEvent) : null}
            onClearEvent={() => navigate({ event: null })}
            onOpenChange={setLayersOpen}
          />
        }
        onZoom={(steps) =>
          settle({
            zoom: Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, location.zoom + steps)),
          })
        }
        onRecentre={
          // Only when the map has actually wandered off the selection. A button
          // that is usually a no-op teaches the reader the controls are decor.
          location.pin && awayFromPin
            ? () => settle({ centre: location.pin as { latitudeDeg: number; longitudeDeg: number } })
            : null
        }
        onLocate={(latitudeDeg, longitudeDeg) =>
          // The same state a map click produces. One concept, three routes in.
          selectPlace({
            name: "Where you are",
            context: "From your device",
            latitude: latitudeDeg,
            longitude: longitudeDeg,
            fromDevice: true,
          })
        }
      />

      {/* The key to the one layer whose colour is a measured number. Only while
          that layer is on, and never over a detail page. */}
      {activeLayers.has("light-pollution") && !detailOpen && !lightPollution.isError ? (
        <TrackerMapLightLegend radiance={lightHere.data ?? null} />
      ) : null}

      {place && !detailOpen ? (
        <TrackerObservingRail
          cards={railCards}
          expandedId={expandedCardId}
          /**
           * Expanding is a decision, so it pushes: Back undoes it, and "Back to
           * the map" from a detail page comes back to the card that was open.
           */
          onExpand={(id) => {
            // Expanding makes that object the map's active context, so an event
            // card brings its own geography with it.
            const event = catalogueEventForCard(id);
            navigate(event ? { card: id, event } : { card: id });
          }}
          onCollapse={() => navigate({ card: null })}
          onOpenDetail={(id) => navigate({ detail: id, drill: null })}
          place={placeWasChosen ? shortPlaceName(place) : (pinContext.data?.name ?? shortPlaceName(place))}
          loading={!night}
          factsFor={railFactsFor}
        />
      ) : null}

      {onboarding.step && !detailOpen ? (
        <TrackerCallout
          step={onboarding.step}
          index={onboarding.index}
          total={onboarding.total}
          onNext={onboarding.next}
          onBack={onboarding.back}
          onClose={onboarding.close}
        />
      ) : null}

      {detailOpen && detailPlace ? (
        <div className="tk-map-detail">
          <button
            type="button"
            className="tk-back tk-map-detail-back"
            onClick={backToMap}
          >
            ← Back to the map
          </button>
          {/**
            * No header here, deliberately.
            *
            * The event page is laid out to fit a viewport exactly — six window
            * sizes are measured for it — and a full header spends that budget
            * reproducing a place and a date the reader can see on the map they
            * just came from. The way back floats over the page instead, and
            * everything about *when* stays on the map where the brief puts it.
            */}
          {heroEvent && night ? (
        <>
          <PhenomenonPage
            categoryId={heroEvent.presentation.categoryId}
            nightWord={describeDate(selectedDate, today).heading}
            presentation={heroPresentation ?? heroEvent.presentation}
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
              navigate({ detail: id, drill: null });
            }}
            onPrimaryAction={() =>
              navigate({
                drill: heroEvent.presentation.primaryAction.kind === "sky-map" ? "sky" : "field",
              })
            }
            /**
             * The second tool, where the event genuinely has two.
             *
             * An eclipse is the case that forces it: "View visibility map"
             * answers *where on Earth*, and the altitude-and-bearing chart
             * answers *where in your sky*. One control cannot be both, and
             * making it try is how a button labelled "View visibility map" came
             * to open a sky chart. Only offered where there is a real path to
             * draw — a control that opens an empty panel is the inert-button
             * defect again.
             */
            tertiaryAction={
              heroEvent.presentation.primaryAction.kind !== "sky-map" &&
              skyPath &&
              skyPath.kind !== "rate"
                ? { label: "Where to look", onSelect: () => navigate({ drill: "sky" }) }
                : null
            }
            onReminder={() => remind(heroEvent.presentation)}
            safety={heroEvent.safety}
            expectation={heroEvent.expectation}
            // The place is context for the ranking, not its title. Kept short:
            // a saved location can be a full postal description, and repeating
            // it at length under a heading two lines from the header's copy of
            // it reads as a stutter.
            // "Best tonight" on today, "Best on 12 Aug" on any other date. The
            // calendar already says when the reader is looking, so the heading
            // names the night rather than the software's state — no "Historical
            // results", no "Past mode".
            listHeading={`Best ${describeDate(selectedDate, today).heading}`}
            listCaption={`From ${shortPlaceName(place)} · ranked by overall observing opportunity`}
            planIdentity={night.identity.key}
          />

          {/* What it actually looks like, where verified footage exists.
              It belongs behind this control rather than on the page: it is
              context for a decision somebody has already made, and a looping
              video in the main row would compete with tonight's forecast for
              the same attention. */}
          <TrackerOverlay
            open={overlay === "sky-map"}
            onClose={() => back({ drill: null })}
            /**
             * Named for what this panel is, not for whichever control opened it.
             *
             * It used `primaryAction.label`, which is "View visibility map" on
             * an eclipse — so opening the sky chart from the *tertiary* control
             * produced a panel headed "View visibility map" above an
             * altitude-and-bearing chart. The same conflation of "where on
             * Earth" and "where in your sky" that this pass exists to separate,
             * reappearing in the title bar.
             */
            title={`${
              heroEvent.presentation.primaryAction.kind === "sky-map"
                ? heroEvent.presentation.primaryAction.label
                : "Where to look"
            } — ${heroEvent.presentation.title}`}
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
                  No shower is active tonight. What you would be watching is the
                  background rate: sporadic meteors that belong to no shower and can
                  appear anywhere in the sky.
                </p>
                {/* The clip and the steps share a row. The clip is fixed at
                    604px by its aspect ratio, so alone in a wide panel it left
                    a dark column beside it; the steps fill that column with
                    something the reader wants anyway. */}
                <div className="tk-howto-row">
                  {footageNode}
                <ol className="tk-howto-steps">
                  <li>
                    <b>Get away from lights.</b> Putting a wall or a hedge between you
                    and the nearest street lamp helps more than any equipment.
                  </li>
                  <li>
                    <b>Take in as much sky as you can.</b> Lie back if you are able to.
                    Watching one spot means missing most of what appears.
                  </li>
                  <li>
                    <b>Give it half an hour.</b> Your eyes need about twenty minutes to
                    adapt, and the rate is an average over a long wait.
                  </li>
                  <li>
                    <b>Go later if you can.</b> You see more towards dawn, when your side
                    of Earth is facing the direction it is moving.
                  </li>
                </ol>
                </div>
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
                  {/* A brief window is an instant, and printing it as a range
                      produced "8:13–8:13 PM" on a shallow eclipse — a span with
                      identical ends, which reads as a bug rather than as a
                      short event. The hero metric already applied this rule;
                      the drill-in was formatting the same value by hand. */}
                  {heroEvent.window && !heroEvent.window.brief
                    ? formatClockRange(heroEvent.window.startUtc, heroEvent.window.endUtc, clock)
                    : formatClockTime(
                        heroEvent.window?.peakUtc ??
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

            {skyPath && skyPath.kind !== "rate" ? footageNode : null}
          </TrackerOverlay>

          <TrackerOverlay
            open={overlay === "field-map"}
            onClose={() => back({ drill: null })}
            title={
              heroEvent.id === "aurora" ? "Current auroral oval" : "Visibility map"
            }
            subtitle={
              heroEvent.id !== "aurora"
                ? "Computed geometry for your location."
                : auroraAssessment?.freshness === "stale" ||
                    auroraAssessment?.freshness === "unavailable"
                  ? // The drill-in inherits the same field the card shows, so it
                    // inherits the same obligation not to describe an expired
                    // nowcast as one that is valid for the next half hour.
                    "NOAA OVATION nowcast, expired. What was last published, not what is happening now."
                  : "NOAA OVATION nowcast: where the oval is now, valid for about half an hour."
            }
          >
            <div className="tk-overlay-map">
              {expandedVisualization ?? expandedEclipse ?? visualization}
            </div>
          </TrackerOverlay>
        </>
      ) : (
        /**
         * Nothing to recommend, and why — which is not always the same why.
         *
         * `tk-quiet` marks the one page whose subtitle is its whole content, so
         * the 720px tier stops hiding it. Left hidden, this rendered as the
         * words "A quiet night" alone on a blank screen, which reads as the
         * product having failed rather than having answered.
         *
         * The three cases are genuinely different and were previously one
         * sentence. Being told "nothing stands out tonight" at 5:59 in the
         * morning is wrong in a way a reader would notice: the night did not
         * disappoint, it ended.
         */
        <div
          className="tk-page tk-tonight tk-quiet"
          data-plan-identity={night?.identity.key}
          data-quiet-reason={
            night?.period.kind === "polar-day"
              ? "polar-day"
              : nightIsOver
                ? "night-over"
                : "nothing-eligible"
          }
        >
          <div className="tk-page-heading">
            <h1>{nightIsOver ? "The night is over" : "A quiet night"}</h1>
            <p>
              {night?.period.kind === "polar-day"
                ? "The Sun does not set here today, so there is no dark sky to look at."
                : nightIsOver
                  ? `It is getting light at ${shortPlaceName(place)} and everything worth watching ${describeDate(selectedDate, today).heading} has set. Tomorrow night is on the Upcoming pages, or pick a date to plan another one.`
                  : `Nothing above the horizon ${describeDate(selectedDate, today).heading} from ${shortPlaceName(place)} stands out enough to recommend. The Moon, the planets that are up and the background meteor rate are all still on the Upcoming pages.`}
            </p>
          </div>
        </div>
          )}
        </div>
      ) : null}
    </main>
  );
}

/**
 * A lunar eclipse's geographic visibility at one of two extents.
 *
 * Shared by the card and the drill-in so the two cannot disagree about the
 * geometry, and parameterised by extent rather than by a boolean on a single
 * memo so the card is never silently rebuilt as the interactive version of
 * itself while the overlay is open.
 *
 * The sampling steps differ deliberately: the card answers "can I see it from
 * around here" over a regional box, and the full map answers "where on Earth"
 * over most of a hemisphere, which needs a finer step to keep the moonrise and
 * moonset boundaries smooth at that scale.
 */
function lunarEclipseGeometry(
  heroEvent: TonightEvent | null,
  place: SelectedPlace | null,
  extent: "card" | "full",
) {
  const science = heroEvent?.entry?.opportunity.science;
  if (!place || science?.kind !== "lunar-eclipse") return null;
  const timing = science.timing;
  const full = extent === "full";
  const bounds = full
    ? { south: -85, north: 85, west: place.longitude - 175, east: place.longitude + 175 }
    : {
        south: Math.max(-85, place.latitude - 40),
        north: Math.min(85, place.latitude + 40),
        west: place.longitude - 70,
        east: place.longitude + 70,
      };
  return {
    timing,
    bounds,
    visibility: lunarGeographicVisibility(timing, bounds, full ? 1.4 : 2, full ? 13 : 9),
    local: lunarLocalVisibility(timing, place.latitude, place.longitude),
    altitudeDeg:
      science.localContactAltitudesDeg?.maximum ??
      Object.values(science.localContactAltitudesDeg ?? {})[0] ??
      0,
  };
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
