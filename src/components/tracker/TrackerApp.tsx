import { useEffect, useMemo, useState } from "react";
import { signalAppReady } from "../../lib/appReady";
import { downloadCalendarFile } from "../../lib/trackerCalendar";
import {
  clockForCoordinates,
  deviceClock,
  formatWindowPhrase,
  formatClockTime,
  formatNightLabel,
  formatTemperature,
  type PlaceClock,
} from "../../lib/localTime";
import {
  type ObservationPeriod,
} from "../../data/tracker/observationPeriod";
import { type MeteorNight } from "../../data/tracker/meteorActivity";
import { planNight } from "../../data/tracker/schedule";
import { gazeRegionFor, skyPathFor } from "../../data/tracker/skyPath";
import { compassPoint } from "../../data/tracker/meteorActivity";
import { TrackerSkyChart } from "./TrackerSkyChart";
import { TrackerSkyPlate } from "./TrackerSkyPlate";
import { TrackerMeteorTimeline } from "./TrackerMeteorTimeline";
import { TrackerUpcoming } from "./TrackerUpcoming";
import { TrackerCalendar } from "./TrackerCalendar";
import { TrackerNow } from "./TrackerNow";
import {
  applySkyAccess,
  chooseHero,
  partitionByAvailability,
  verdictFor,
  viewingConclusion,
  type Ranking,
  type SkyAdjustedOpportunity,
} from "../../data/tracker/opportunity";
import {
  bestViewingWindow,
  hasPassedTonight,
  nearestSnapshot,
  readCondition,
  skyAccess,
  type BestWindow,
  type ConditionSnapshot,
} from "../../data/tracker/conditions";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { adapterFor, conditionsFor } from "../../data/tracker/weatherProviders";
import { heroImageryFor, IMAGERY_CLASS_LABEL } from "../../data/tracker/imagery";
import { TrackerScene } from "./TrackerScene";
import { TrackerCondition } from "./TrackerCondition";
import { TrackerPlace, type SelectedPlace } from "./TrackerPlace";
import { TrackerEntry } from "./TrackerEntry";

/**
 * Orbit Studio Tracker.
 *
 * Mounted at the entry point rather than inside App, because App imports the
 * 16 MB satellite catalog and an observer page must not pay for it.
 *
 * ## What this screen is for
 *
 * Getting somebody outside. Everything above the fold is an invitation: a
 * picture of what they are being invited to see, the time to go, the direction
 * to face, what the sky will be doing, and one button.
 *
 * The previous version put a chart first and coordinates second, and explained
 * its own data sources in the footer. All of that was true and none of it
 * belonged in front of the reader. The calculations behind it are unchanged;
 * only the order is different, which is the point — the analysis was never the
 * problem, its position was.
 *
 * Times are the selected place's local clock, never UTC and not necessarily the
 * device's: somebody planning a trip to a dark-sky site needs that site's
 * midnight, not their own.
 */

interface Night {
  period: ObservationPeriod;
  ranking: Ranking;
  meteors: MeteorNight;
}

const EMPTY_SNAPSHOTS: ConditionSnapshot[] = [];

/**
 * One client for the page.
 *
 * The forecast is worth keeping for an hour — it is a grid-cell forecast, not a
 * per-user one, and both providers ask callers to cache. `retry` is bounded
 * because a provider that is down stays down for longer than a reader will
 * wait, and a retry storm against a free service is the wrong way to treat it.
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

/**
 * Tonight's sky over the selected place.
 *
 * Replaces a hand-rolled effect that had one gap worth naming: there was no
 * loading state at all, so for about 300 ms after a place was chosen the
 * interface asserted "Conditions unavailable" — a wrong answer rather than an
 * absent one. `isPending` distinguishes "not asked yet" from "asked and
 * failed", which is the distinction the reader needed and the effect could not
 * express.
 */
function useConditions(place: SelectedPlace | null) {
  const adapter = place ? adapterFor(place.latitude, place.longitude) : null;
  return useQuery({
    queryKey: [
      "conditions",
      adapter?.source.id ?? "none",
      // Rounded, so two observers in the same forecast cell share one entry and
      // a precise location is never used as a cache key.
      place ? place.latitude.toFixed(2) : null,
      place ? place.longitude.toFixed(2) : null,
    ],
    enabled: Boolean(place && adapter),
    queryFn: async ({ signal }) => {
      if (!place || !adapter) throw new Error("No location");
      const snapshots = await conditionsFor(adapter, place.latitude, place.longitude, signal);
      return { snapshots, adapter };
    },
  });
}

export function TrackerApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrackerScreen />
    </QueryClientProvider>
  );
}

function TrackerScreen() {
  const [place, setPlace] = useState<SelectedPlace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);

  // Asked once, on arrival. A hand-picked place is never overwritten by it —
  // somebody planning a trip would lose the plan on the next render.
  useEffect(() => {
    signalAppReady();
  }, []);

  const clock: PlaceClock = useMemo(() => {
    if (!place) return deviceClock();
    // The device knows its own zone exactly; anywhere else is resolved from
    // coordinates rather than guessed from longitude.
    return place.fromDevice
      ? deviceClock()
      : clockForCoordinates(place.latitude, place.longitude);
  }, [place]);

  const [view, setView] = useState<TrackerView>("tonight");
  // Now and Tonight are the same night asked two different questions. Now was
  // previously gated on this same boolean, which meant the tab existed and
  // rendered Tonight unchanged — navigation asserting a product and shipping a
  // duplicate.
  const showsNight = view === "tonight";
  const weather = useConditions(place);

  // Tonight is one question asked of the shared schedule layer, not its own
  // pipeline. It used to be computed inline here, which is why there was
  // nowhere for a second night to come from.
  const night = useMemo(
    () =>
      place
        ? planNight(place.latitude, place.longitude, new Date(), clock.timeZone)
        : null,
    [place, clock.timeZone],
  );

  const snapshots = weather.data?.snapshots ?? EMPTY_SNAPSHOTS;
  // "Not asked yet" is not "asked and failed". Conflating them is what made the
  // interface claim conditions were unavailable while it was still fetching.
  const conditionsPending = weather.isPending || weather.isFetching;
  const conditionsReady = weather.isSuccess;

  const withSky = useMemo(() => {
    if (!night) return null;
    const now = new Date();
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
        snapshots,
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
  }, [night, snapshots]);

  const selected: SkyAdjustedOpportunity | null = useMemo(() => {
    if (!withSky) return null;
    if (selectedId) {
      const found = withSky.ranked.find((entry) => entry.opportunity.id === selectedId);
      if (found) return found;
    }
    return chooseHero(withSky.ranked, withSky.passed);
  }, [withSky, selectedId]);

  // Split rather than filtered. An object below the horizon for the rest of the
  // night is not an "Also tonight" recommendation — it was taking a slot in a
  // ranked list of things to go outside for while saying it could not be seen.
  const { observable: alternatives, unavailable } = useMemo(() => {
    if (!withSky) return { observable: [], unavailable: [] };
    const rest = withSky.ranked.filter(
      (entry) => entry.opportunity.id !== selected?.opportunity.id,
    );
    return partitionByAvailability(rest, withSky.passed);
  }, [withSky, selected]);

  // The tab title is how this page is found again in a row of tabs, in history
  // and in a shared link. "Orbit Studio" on every view told nobody anything.
  useEffect(() => {
    const lead = selected?.opportunity.title;
    document.title = lead
      ? `${lead} tonight — Orbit Studio Tracker`
      : "Orbit Studio Tracker";
  }, [selected]);

  return (
    <main className="tracker-shell">
      <a className="tracker-skip" href="#tracker-more">
        Skip to tonight's list
      </a>
      <header className="tracker-bar">
        <img
          className="tracker-bar-logo"
          src="/brand/orbit-studio-tracker-logo.png"
          alt="Orbit Studio Tracker"
        />
        {/* The application's own navigation, present from the moment there is a
            place to compute for. These are four different questions over one
            shared schedule layer, not four sorts of the same list. */}
        {place ? (
          <nav className="tracker-nav" aria-label="Tracker views">
            {VIEWS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="tracker-nav-item"
                aria-current={view === entry.id ? "page" : undefined}
                onClick={() => setView(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : null}
        {/* The bar carries the location only once there is one. Before that the
            entry screen owns the single control, rather than two instances of
            the same component competing for the same job. */}
        {place ? <TrackerPlace place={place} onSelect={setPlace} /> : null}
      </header>

      {!place ? <TrackerEntry onSelect={setPlace} /> : null}

      {place && view === "upcoming" ? (
        <TrackerUpcoming place={place} clock={clock} onOpenNight={() => setView("tonight")} />
      ) : null}



      {/* Tonight is one screen. The hero, the ranked rail and the unavailable
          context are a single grid that owns exactly the space under the
          header — not a page with sections stacked beneath it. */}
      {showsNight && night && place ? (
        <div className="tk-tonight">
          {/* The shape of the night along the top: when it gets dark, when the
              best moment falls, when it ends. Four times a reader otherwise has
              to dig out of a paragraph, and the line the composition hangs
              from. */}
          <ul className="tk-nightbar">
            <li>
              Sunset <b>{formatClockTime(night.period.startUtc, clock)}</b>
            </li>
            {night.period.darkness.astronomical ? (
              <li>
                Dark <b>{formatClockTime(night.period.darkness.astronomical.startUtc, clock)}</b>
              </li>
            ) : null}
            {selected && withSky?.windows.get(selected.opportunity.id) ? (
              <li className="is-peak">
                {selected.opportunity.title} best{" "}
                <b>
                  {formatClockTime(
                    withSky.windows.get(selected.opportunity.id)!.peakUtc,
                    clock,
                  )}
                </b>
              </li>
            ) : null}
            <li>
              Dawn <b>{formatClockTime(night.period.endUtc, clock)}</b>
            </li>
          </ul>
      {selected ? (
        <TrackerHero
          entry={selected}
          night={night}
          clock={clock}
          place={place}
          viewingWindow={withSky?.windows.get(selected.opportunity.id) ?? null}
          passed={withSky?.passed.has(selected.opportunity.id) ?? false}
          snapshots={snapshots}
          conditionsKnown={conditionsReady}
          conditionsPending={conditionsPending}
          seen={seen.includes(selected.opportunity.id)}
          onSeen={() =>
            setSeen((current) =>
              current.includes(selected.opportunity.id)
                ? current
                : [...current, selected.opportunity.id],
            )
          }
        />
      ) : null}

      {showsNight && night && place && !selected ? (
        <section className="tracker-hero tracker-hero-quiet" aria-label="Tonight">
          <TrackerScene
            imagery={heroImageryFor("none", "night-sky")}
            className="tracker-hero-scene"
            priority
            showCredit
          />
          <div className="tracker-hero-panel">
            <p className="tracker-hero-eyebrow">
              {formatNightLabel(night.period.startUtc, clock)} · {place.name}
            </p>
            <h1>A quiet night</h1>
            <p className="tracker-hero-summary">
              {night.period.kind === "polar-day"
                ? "The Sun does not set here today, so there is no dark sky to look at."
                : "Nothing above the horizon tonight is worth a special trip from here. Better to save the effort for a night that deserves it."}
            </p>
          </div>
        </section>
      ) : null}

      {showsNight && alternatives.length > 0 && withSky ? (
        <section className="tracker-more" id="tracker-more" aria-label="Also tonight">
          <h2>Also tonight</h2>
          <div className="tracker-cards">
            {alternatives.slice(0, 3).map((entry) => (
              <TrackerCard
                key={entry.opportunity.id}
                entry={entry}
                clock={clock}
                viewingWindow={withSky.windows.get(entry.opportunity.id) ?? null}
                passed={withSky.passed.has(entry.opportunity.id)}
                snapshots={snapshots}
                conditionsKnown={conditionsReady}
          conditionsPending={conditionsPending}
                onSelect={() => {
                  setSelectedId(entry.opportunity.id);
                  globalThis.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {showsNight && unavailable.length > 0 ? (
        <section className="tracker-unavailable" aria-label="Not observable tonight">
          <h2>Below the horizon</h2>
          {/* Context, not a recommendation. These used to sit in the ranked
              list saying "Already set tonight", which is a strange thing for a
              list of things to go outside for to contain. They stay visible
              because a reader who went looking for the Moon and could not find
              it is better served by being told it is down than by being left to
              wonder whether Tracker forgot about it. */}
          <ul className="tracker-unavailable-list">
            {unavailable.map((entry) => (
              <li key={entry.opportunity.id}>
                <span className="tracker-unavailable-name">{entry.opportunity.title}</span>
                <span className="tracker-unavailable-note">
                  Below the horizon for the rest of tonight
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {night && place ? (
        <TrackerDetail
          night={night}
          weather={weather}
          conditionsReady={conditionsReady}
          clock={clock}
          place={place}
          expanded={showDetail}
          onToggle={() => setShowDetail((current) => !current)}
        />
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

/* ------------------------------------------------------------------- views */

export type TrackerView = "tonight" | "upcoming";

/**
 * Two views, because there are two questions.
 *
 * There were four. "Now" was a separate destination asking whether to step
 * outside in the next hour — but Tracker already knows the time, so making the
 * reader choose between Now and Tonight was asking them to do the product's
 * job. Tonight adapts to the moment instead. "Calendar" was a separate
 * destination for browsing dates, which is not a different question from
 * planning ahead; it is a different way of looking at the same future, so it is
 * a mode inside Upcoming.
 *
 * What is left is what a person actually wants to know: what about tonight, and
 * what about later.
 */
const VIEWS: { id: TrackerView; label: string }[] = [
  { id: "tonight", label: "Tonight" },
  { id: "upcoming", label: "Upcoming" },
];

/* ------------------------------------------------------------------- hero */

function TrackerHero({
  entry,
  night,
  clock,
  place,
  viewingWindow,
  passed,
  snapshots,
  conditionsKnown,
  conditionsPending,
  seen,
  onSeen,
}: {
  entry: SkyAdjustedOpportunity;
  night: Night;
  clock: PlaceClock;
  place: SelectedPlace;
  viewingWindow: BestWindow | null;
  passed: boolean;
  snapshots: ConditionSnapshot[];
  conditionsKnown: boolean;
  conditionsPending: boolean;
  seen: boolean;
  onSeen: () => void;
}) {
  const { opportunity } = entry;
  const { guidance } = opportunity;
  const imagery = heroImageryFor(opportunity.id, opportunity.kind);
  const whenUtc = viewingWindow?.peakUtc ?? guidance.whenUtc;
  const atBest = nearestSnapshot(snapshots, whenUtc);
  const headline = night.meteors.headline;
  const bestSample = night.meteors.best;

  // Where there is no viewing window the sky is still known, and the sentence
  // still has to name it. Reading the label off a null window produced
  // "Excellent in itself, but skies make it a gamble" — the one case where the
  // weather is worst is the case the wording dropped it.
  const reading = viewingWindow?.viewability.reading ?? (atBest ? readCondition(atBest) : null);
  const conclusion = viewingConclusion(
    opportunity.title,
    opportunity.kind,
    entry.band,
    viewingWindow?.viewability.band ?? (reading ? "unlikely" : "possible"),
    reading?.phrase ?? "",
    conditionsKnown && Boolean(reading),
    passed,
  );

  // The geometry, drawn from the samples themselves. Null where the phenomenon
  // has no position worth drawing, which is a real answer rather than a reason
  // to invent one.
  const path = skyPathFor(opportunity, viewingWindow);
  // Where to face, which for a shower is deliberately not where the radiant is.
  const gaze = gazeRegionFor(opportunity, path);
  const verdict = verdictFor({
    band: entry.band,
    unavailable: passed,
    skyAccess: viewingWindow ? viewingWindow.viewability.access : null,
    minutesUntilWindow: viewingWindow
      ? Math.round((Date.parse(viewingWindow.startUtc) - Date.now()) / 60_000)
      : null,
    needsDarkSite: opportunity.transparency === "high",
  });

  return (
    <section className="tracker-hero tk-observe" aria-label="Tonight's recommendation">
      {/* Two columns, both load-bearing. The photograph used to be the page —
          a full-bleed image with the text laid over its dark half — which made
          the layout a function of where the picture happened to be dark. It is
          now one element among several, sized and placed deliberately, and the
          sky drawing sits beside it as the thing that actually tells you what
          to do outside. */}
      <div className="tk-observe-main">
        {/* Safety is rendered before anything else and has no disclosure
            control. Nothing sets it yet; the position is reserved so that
            adding a solar event cannot quietly bury it. */}
        {guidance.safety ? (
          <p className="tracker-safety" role="alert">
            {guidance.safety}
          </p>
        ) : null}

        {/* The decision, before the description. Tracker's value is judgement,
            and a grade like "excellent" is not one — this is. */}
        <p
          className="tk-verdict"
          data-tone={
            verdict === "GO OUT NOW" || verdict === "WORTH STAYING UP FOR"
              ? "go"
              : verdict === "NOT WORTH A SPECIAL TRIP" || verdict === "BELOW THE HORIZON"
                ? "no"
                : "hold"
          }
        >
          {verdict}
        </p>

        <p className="tracker-hero-eyebrow">
          {formatNightLabel(night.period.startUtc, clock)} · {place.name}
        </p>
        <h1>{opportunity.title}</h1>
        <p className="tracker-hero-summary">{opportunity.summary}</p>

        {/* The four things a person actually acts on, given the width they
            deserve and labelled directly. These used to be a stack of
            sentences and a legend; a legend is a key to a chart, and this is
            not a chart — it is the answer. */}
        <dl className="tk-facts">
          <div className="tk-fact">
            <dt>When</dt>
            <dd className="tk-fact-strong">
              {viewingWindow
                ? formatWindowPhrase(viewingWindow, clock)
                : formatClockTime(guidance.whenUtc, clock)}
            </dd>
          </div>
          {gaze ? (
            <div className="tk-fact">
              <dt>Face</dt>
              <dd className="tk-fact-strong">{compassPoint(gaze.centerAzimuthDeg)}</dd>
            </div>
          ) : null}
          {gaze ? (
            <div className="tk-fact">
              <dt>Look</dt>
              <dd className="tk-fact-strong">{Math.round(gaze.centerAltitudeDeg)}° up</dd>
            </div>
          ) : null}
          <div className="tk-fact">
            <dt>Sky</dt>
            <dd>
              {conditionsPending ? (
                <span className="tracker-skeleton" aria-hidden />
              ) : viewingWindow ? (
                <TrackerCondition
                  viewability={viewingWindow.viewability}
                  temperatureC={atBest?.temperatureC ?? null}
                  atUtc={whenUtc}
                  clock={clock}
                  showFreshness={false}
                />
              ) : (
                <span className="tk-fact-strong">Not known</span>
              )}
            </dd>
          </div>
        </dl>

        <p className="tracker-hero-directions">
          {guidance.howLong.split(".")[0]}.{" "}
          {guidance.equipment === "eyes"
            ? "No equipment needed."
            : guidance.equipment === "binoculars"
              ? "Binoculars required."
              : "Telescope required."}
        </p>

        {conditionsPending ? null : <p className="tracker-hero-conclusion">{conclusion}</p>}

        <div className="tracker-hero-actions">
          <button
            type="button"
            className="tracker-primary"
            onClick={() =>
              downloadCalendarFile({
                title: `${opportunity.title} — Orbit Studio Tracker`,
                description: [
                  opportunity.summary,
                  guidance.direction ? `Face ${guidance.direction}.` : "",
                  guidance.elevation,
                  guidance.appearance,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                startUtc: whenUtc,
                durationMinutes: guidance.durationMinutes,
                remindMinutesBefore: 20,
              })
            }
          >
            Remind me
          </button>
          <button
            type="button"
            className={seen ? "tracker-secondary tracker-seen" : "tracker-secondary"}
            onClick={onSeen}
            aria-pressed={seen}
          >
            {seen ? "You saw it" : "I saw it"}
          </button>
        </div>

        <details className="tracker-hero-more">
          <summary>Show me where, and what to expect</summary>
          <dl>
            <div>
              <dt>Where to look</dt>
              <dd>{guidance.elevation}</dd>
            </div>
            <div>
              <dt>What you will actually see</dt>
              <dd>{guidance.appearance}</dd>
            </div>
            {opportunity.alsoWith ? (
              <div>
                <dt>{opportunity.alsoWith.lead}</dt>
                <dd>{opportunity.alsoWith.appearance}</dd>
              </div>
            ) : null}
            {guidance.technique ? (
              <div>
                <dt>Worth knowing</dt>
                <dd>{guidance.technique}</dd>
              </div>
            ) : null}
            <div>
              <dt>How long to give it</dt>
              <dd>{guidance.howLong}</dd>
            </div>
          </dl>
          {/* The picture is beautiful on purpose; this is where it says what it
              is, so nobody goes outside expecting the photograph. */}
          <p className="tracker-imagery-note">
            <strong>{IMAGERY_CLASS_LABEL[imagery.classification]}.</strong>{" "}
            {imagery.eyeExpectation ?? ""} {imagery.credit ?? ""}
          </p>
        </details>
      </div>

      {/* The observing column: what the sky is doing, then the photograph as
          context for it rather than as the surface everything is printed on. */}
      <aside className="tk-observe-side">
        {/* Composed per phenomenon rather than forced through one projection.
            A shower has two separate questions — when is it best, and where do
            I look — and they need different axes: quality against time for the
            first, a compass for the second. A planet has one question, and
            bearing against altitude answers it directly. */}
        {/* One frame, one ground, one caption voice — parameterised by what the
            phenomenon actually is. A shower's quality is a function of time; a
            planet's is a function of where it is. The drawing inside differs;
            everything around it does not. */}
        {path ? (
          <TrackerSkyPlate
            tone={opportunity.kind}
            /* No photographic ground. Putting a starfield behind a plotted
               curve made the picture compete with the data it was supposed to
               support, and legibility of a functional graphic is not something
               to trade for atmosphere. Real celestial media belongs elsewhere
               in the experience. */
            title={
              path.kind === "radiant"
                ? "How the shower builds through the night"
                : path.kind === "rate"
                  ? "How many to expect through the night"
                  : `Where to find ${opportunity.title.replace(/^The /, "")}`
            }
            caption={
              path.kind === "radiant"
                ? "The radiant climbs as the night goes on, and the rate climbs with it. The bright section is the window worth going out for."
                : path.kind === "rate"
                  ? "No shower is running, so these are sporadic meteors. They pick up towards dawn, as your side of the Earth turns to face the direction it is travelling. The bright section is the window worth going out for."
                  : "Its path from where you are. The bright section is the window worth going out for."
            }
          >
            {path.kind === "radiant" || path.kind === "rate" ? (
              <TrackerMeteorTimeline
                path={path}
                meteors={night.meteors}
                clock={clock}
                windowStartUtc={path.windowStartUtc}
                windowEndUtc={path.windowEndUtc}
              />
            ) : (
              <TrackerSkyChart
                path={path}
                clock={clock}
                tone={opportunity.kind}
                label={opportunity.title}
              />
            )}
          </TrackerSkyPlate>
        ) : null}

        {/* Subject imagery — a planet portrait, the Moon at tonight's phase —
            keeps its own frame, because it is a picture of the thing rather
            than the sky the thing is in. Photographs of sky are the plate's
            ground instead of a second box below it. */}
        {imagery.treatment !== "photo" ? (
          <figure className="tk-observe-media">
            <TrackerScene
              className="tk-observe-scene"
              imagery={imagery}
              priority
              showCredit
              illuminatedFraction={
                opportunity.sceneHints?.illuminatedFraction ??
                bestSample?.moonIlluminatedFraction ??
                0.5
              }
              waning={opportunity.sceneHints?.waning ?? false}
            />
          </figure>
        ) : null}
      </aside>
    </section>
  );
}

/* ------------------------------------------------------------------ cards */

function TrackerCard({
  entry,
  clock,
  viewingWindow,
  passed,
  snapshots,
  conditionsKnown,
  conditionsPending,
  onSelect,
}: {
  entry: SkyAdjustedOpportunity;
  clock: PlaceClock;
  viewingWindow: BestWindow | null;
  passed: boolean;
  snapshots: ConditionSnapshot[];
  conditionsKnown: boolean;
  conditionsPending: boolean;
  onSelect: () => void;
}) {
  const { opportunity } = entry;
  const imagery = heroImageryFor(opportunity.id, opportunity.kind);
  const atBest = nearestSnapshot(
    snapshots,
    viewingWindow?.peakUtc ?? opportunity.guidance.whenUtc,
  );

  // Where there is no viewing window the sky is still known, and the sentence
  // still has to name it. Reading the label off a null window produced
  // "Excellent in itself, but skies make it a gamble" — the one case where the
  // weather is worst is the case the wording dropped it.
  const reading = viewingWindow?.viewability.reading ?? (atBest ? readCondition(atBest) : null);
  const conclusion = viewingConclusion(
    opportunity.title,
    opportunity.kind,
    entry.band,
    viewingWindow?.viewability.band ?? (reading ? "unlikely" : "possible"),
    reading?.phrase ?? "",
    conditionsKnown && Boolean(reading),
    passed,
  );

  return (
    <button
      type="button"
      className={passed ? "tracker-card tracker-card-passed" : "tracker-card"}
      onClick={onSelect}
    >
      <span className="tracker-card-media">
        <TrackerScene
          className="tracker-card-scene"
          imagery={imagery}
          illuminatedFraction={opportunity.sceneHints?.illuminatedFraction ?? 0.5}
          waning={opportunity.sceneHints?.waning ?? false}
        />
      </span>
      <span className="tracker-card-body">
        <span className="tracker-card-title">{opportunity.title}</span>
        <span className="tracker-card-summary">{opportunity.summary}</span>
        <span className="tracker-card-when">
          {passed
            ? "Already set tonight"
            : viewingWindow
              ? formatWindowPhrase(viewingWindow, clock)
              : formatClockTime(opportunity.guidance.whenUtc, clock)}
          {atBest && !passed ? ` · ${formatTemperature(atBest.temperatureC)}` : ""}
        </span>
        {conditionsPending ? (
          <span className="tracker-condition tracker-condition-pending">
            <span className="tracker-skeleton" aria-hidden />
            Checking the sky…
          </span>
        ) : viewingWindow && !passed ? (
          <TrackerCondition
            viewability={viewingWindow.viewability}
            temperatureC={null}
            atUtc={viewingWindow.peakUtc}
            clock={clock}
            showFreshness={false}
            compact
          />
        ) : null}
        {conditionsPending ? null : (
          <span className="tracker-card-conclusion">{conclusion}</span>
        )}
        {opportunity.guidance.equipment !== "eyes" ? (
          <span className="tracker-equipment-required">
            {opportunity.guidance.equipment === "telescope"
              ? "Telescope required"
              : "Binoculars required"}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------- detail */

/**
 * Everything analytical, one control away.
 *
 * None of it was deleted — the model detail, the sources, the chart and the
 * caveats are all still here and all still true. They are simply not what
 * somebody deciding whether to put a coat on needs to read first.
 */
function TrackerDetail({
  night,
  weather,
  conditionsReady,
  clock,
  place,
  expanded,
  onToggle,
}: {
  night: Night;
  weather: ReturnType<typeof useConditions>;
  conditionsReady: boolean;
  clock: PlaceClock;
  place: SelectedPlace;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="tracker-detail" aria-label="Why Tracker recommends this">
      <button type="button" onClick={onToggle} aria-expanded={expanded}>
        {expanded ? "Close" : "Why Tracker recommends this"}
      </button>
      {expanded ? (
        <div className="tracker-detail-body">
          <h3>Tonight</h3>
          {night.period.kind === "night" ? (
            <p>
              Sunset {formatClockTime(night.period.startUtc, clock)} to sunrise{" "}
              {formatClockTime(night.period.endUtc, clock)}.{" "}
              {night.period.darkness.astronomical
                ? `Full darkness from ${formatClockTime(night.period.darkness.astronomical.startUtc, clock)} to ${formatClockTime(night.period.darkness.astronomical.endUtc, clock)}.`
                : "The sky never reaches full astronomical darkness tonight."}
            </p>
          ) : (
            <p>{night.period.limitation}</p>
          )}

          {/* The meteor activity chart lived here as well as in the main
              composition, so opening this put two of the same visualisation on
              one screen — the second one explaining the first. There is one
              primary timing graphic, and it is the one above. */}

          <h3>What the estimates leave out</h3>
          <ul>
            {night.meteors.missingInputs.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {conditionsReady ? (
              <li>
                Cloud is not in the meteor rate itself — that number is a clear-sky ceiling, and
                the forecast is applied separately.
              </li>
            ) : (
              <li>Cloud cover, because no forecast could be fetched for here.</li>
            )}
            {clock.approximate ? (
              <li>
                No time zone is recorded for these coordinates, so times here are estimated from
                longitude and can be an hour out.
              </li>
            ) : null}
          </ul>

          <h3>Sources</h3>
          <p>
            Positions, twilight and eclipse circumstances are computed on your device from an
            analytic ephemeris. Meteor stream parameters come from a pinned snapshot of the IMO
            working list and the IAU Meteor Data Center established-shower list. Rates are an
            estimate built on those, quoted as a dark-sky ceiling rather than a prediction.
          </p>
          {weather.data ? <p>{weather.data.adapter.source.attribution}</p> : null}
          {weather.isError ? (
            <p>
              Conditions unavailable —{" "}
              {weather.error instanceof Error ? weather.error.message : "the forecast failed."}
            </p>
          ) : null}
          <p>Place search © OpenStreetMap contributors, ODbL. Geocoding by Photon.</p>
          <p className="tracker-detail-coords">
            {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------- helpers */

/** "Face northeast." — from guidance that may already be a fuller sentence. */
function facingSentence(direction: string): string {
  if (direction.startsWith("anywhere")) {
    const match = /the ([a-z-]+) sky/.exec(direction);
    return match ? `Look anywhere, but keep the ${match[1]} in view.` : "Look anywhere overhead.";
  }
  return `Face ${direction}.`;
}
