import { useEffect, useMemo, useState } from "react";
import { signalAppReady } from "../../lib/appReady";
import { downloadCalendarFile } from "../../lib/trackerCalendar";
import {
  deepestTwilightBand,
  trackerObservationPeriod,
  type ObservationPeriod,
} from "../../data/tracker/observationPeriod";
import { meteorNight, type MeteorNight } from "../../data/tracker/meteorActivity";
import { tonightsOpportunities } from "../../data/tracker/phenomena";
import {
  applySkyAccess,
  chooseHero,
  explainRank,
  rankOpportunities,
  type Ranking,
  type SkyAdjustedOpportunity,
} from "../../data/tracker/opportunity";
import { TrackerNightChart } from "./TrackerNightChart";
import { TrackerCondition } from "./TrackerCondition";
import {
  actionLine,
  bestViewingWindow,
  hasPassedTonight,
  nearestSnapshot,
  skyAccess,
  type BestWindow,
  type ConditionSnapshot,
} from "../../data/tracker/conditions";
import { adapterFor, conditionsFor, type WeatherAdapter } from "../../data/tracker/weatherProviders";

/**
 * Orbit Studio Tracker.
 *
 * Mounted at the entry point rather than inside App, because App imports the
 * 16 MB satellite catalog and TRACKER_PRD R7.1 requires an observer page not to
 * pay for it. Opening Tracker is therefore a real navigation, not a mode switch.
 *
 * The shape of this screen comes from V1 §3: a visual, a concise explanation of
 * what can be seen, when and where to look, an action, and a ranked list of the
 * alternatives — all present immediately, with no catalog to browse. The hero
 * and the list are one system; selecting from the list changes the hero.
 *
 * V1 §2 governs what it may ask for, and the answer is location and nothing
 * else. No equipment profile, no camping switch, no interests, no experience
 * level. Whether tonight suits a telescope is a property of tonight, and it is
 * computed rather than asked.
 */

const PRESETS = [
  { label: "London", latitude: 51.4779, longitude: -0.0015 },
  { label: "New York", latitude: 40.7128, longitude: -74.006 },
  { label: "Nairobi", latitude: -1.2921, longitude: 36.8219 },
  { label: "Sydney", latitude: -33.8688, longitude: 151.2093 },
  { label: "Tromsø", latitude: 69.6496, longitude: 18.956 },
];

type LocationState =
  | { status: "locating" }
  | { status: "resolved"; latitude: number; longitude: number; label: string }
  | { status: "manual"; reason: string };

function timeOnly(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

function hoursBetween(startIso: string, endIso: string): number {
  return (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000;
}

export function TrackerApp() {
  const [location, setLocation] = useState<LocationState>({ status: "locating" });
  const [whenIso, setWhenIso] = useState(() => new Date().toISOString().slice(0, 16));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPassive, setShowPassive] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [weather, setWeather] = useState<WeatherState>({ status: "idle" });

  // V1 A1: location is the only thing asked for, and it is asked for once, on
  // arrival. A refusal is not an error state — it falls through to manual entry
  // with the same screen behind it.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocation({ status: "manual", reason: "This browser cannot report a location." });
      return;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        setLocation({
          status: "resolved",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "your location",
        });
      },
      () => {
        if (cancelled) return;
        setLocation({
          status: "manual",
          reason: "Location permission was not given, so pick a place instead.",
        });
      },
      { timeout: 8000, maximumAge: 600_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    signalAppReady();
  }, []);

  const resolved = location.status === "resolved" ? location : null;

  // Conditions are fetched for the *selected* location, never the device's, so
  // planning a trip somewhere else gives that place's sky rather than this
  // one's. A failure is not an error screen: the phenomenon recommendation
  // stands unadjusted and the details say conditions were unavailable.
  useEffect(() => {
    if (!resolved) return;
    const adapter = adapterFor(resolved.latitude, resolved.longitude);
    if (!adapter) {
      setWeather({ status: "unavailable", reason: "No free forecast source covers that location." });
      return;
    }
    const controller = new AbortController();
    setWeather({ status: "loading" });
    conditionsFor(adapter, resolved.latitude, resolved.longitude, controller.signal)
      .then((snapshots) => setWeather({ status: "ready", snapshots, adapter }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setWeather({
          status: "unavailable",
          reason: error instanceof Error ? error.message : "The forecast could not be fetched.",
        });
      });
    return () => controller.abort();
  }, [resolved]);

  const night = useMemo(() => {
    if (!resolved) return null;
    try {
      const period = trackerObservationPeriod(
        resolved.latitude,
        resolved.longitude,
        new Date(`${whenIso}:00Z`),
      );
      const ranking = rankOpportunities(
        tonightsOpportunities(resolved.latitude, resolved.longitude, period),
      );
      const meteors = meteorNight(resolved.latitude, resolved.longitude, period);
      return { period, ranking, meteors };
    } catch {
      return null;
    }
  }, [resolved, whenIso]);

  const snapshots = weather.status === "ready" ? weather.snapshots : EMPTY_SNAPSHOTS;

  // One pass computing, for each opportunity, when to actually go outside given
  // both the phenomenon and the sky. Both halves are kept; only the ordering
  // sees the weather.
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
        // Nothing left of it tonight, so it cannot be recommended at all. It
        // stays in the list — V1 §5 keeps "the peak has passed" passive rather
        // than hiding it — but it sinks below everything still to come.
        access.set(opportunity.id, 0);
        continue;
      }
      const window = bestViewingWindow(
        opportunity.profile,
        snapshots,
        opportunity.transparency,
        entry.strength,
        now,
      );
      if (window) {
        windows.set(opportunity.id, window);
        const snapshot = nearestSnapshot(snapshots, window.peakUtc);
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
    // The hero must be something still to come, and the rest of the hero rule
    // still applies to whatever is left. Both live in chooseHero.
    return chooseHero(withSky.ranked, withSky.passed);
  }, [withSky, selectedId, night]);

  return (
    <main className="tracker-shell">
      <header className="tracker-header">
        <img src="/brand/orbit-studio-tracker-logo.png" alt="Orbit Studio Tracker" />
        <p>What is worth going outside for tonight, when to look, and where.</p>
      </header>

      <TrackerLocation
        location={location}
        whenIso={whenIso}
        onWhen={setWhenIso}
        onPick={(latitude, longitude, label) =>
          setLocation({ status: "resolved", latitude, longitude, label })
        }
      />

      {location.status === "locating" ? (
        <p className="tracker-note">Finding where you are…</p>
      ) : null}

      {night && resolved ? (
        <>
          {selected ? (
            <TrackerHero
              entry={selected}
              night={night}
              window={withSky?.windows.get(selected.opportunity.id) ?? null}
              passed={withSky?.passed.has(selected.opportunity.id) ?? false}
              snapshots={snapshots}
              seen={seen.includes(selected.opportunity.id)}
              onSeen={() =>
                setSeen((current) =>
                  current.includes(selected.opportunity.id)
                    ? current
                    : [...current, selected.opportunity.id],
                )
              }
            />
          ) : (
            <section className="tracker-hero tracker-hero-empty" aria-label="Tonight">
              <h2>Nothing worth a special trip tonight</h2>
              <p>
                {night.period.kind === "polar-day"
                  ? "The Sun does not set here today, so there is nothing to see after dark — there is no after dark."
                  : "Everything above the horizon tonight is either too low, too faint or too washed out to be worth going out for. That is a real answer, and better than talking you into a disappointing hour outside."}
              </p>
              {night.ranking.ranked.length > 0 ? (
                <p>Anything still up is listed below.</p>
              ) : null}
            </section>
          )}

          <TrackerRankedList
            ranked={withSky?.ranked ?? []}
            windows={withSky?.windows ?? new Map()}
            passed={withSky?.passed ?? new Set()}
            snapshots={snapshots}
            selectedId={selected?.opportunity.id ?? null}
            onSelect={setSelectedId}
          />

          <TrackerPassive
            night={night}
            weather={weather}
            expanded={showPassive}
            onToggle={() => setShowPassive((current) => !current)}
          />
        </>
      ) : null}

      <footer className="tracker-footer">
        <p>
          What is in the sky is computed on your device from an analytic ephemeris and a vendored
          meteor stream catalogue. The forecast is not: your location, rounded to about a
          kilometre, is sent to a public weather service to fetch it, and the result is cached by
          grid cell rather than against you. There is no account and nothing else leaves the page.
        </p>
        <p>
          Satellite passes and aurora are not here yet. Both need a live feed whose terms need a
          server in front of them, and a server is a running cost — which is a decision to make
          rather than something to slip in. Inventing either from what is in the bundle would be
          worse than their absence.
        </p>
      </footer>
    </main>
  );
}

/* -------------------------------------------------------------------- parts */

function TrackerLocation({
  location,
  whenIso,
  onWhen,
  onPick,
}: {
  location: LocationState;
  whenIso: string;
  onWhen: (value: string) => void;
  onPick: (latitude: number, longitude: number, label: string) => void;
}) {
  // Seeded from whatever is actually selected, so the fields are not still
  // reading London while the Sydney chip is lit. They are an editable view of
  // the current location, not a separate one.
  const [latitude, setLatitude] = useState(
    location.status === "resolved" ? location.latitude : 51.4779,
  );
  const [longitude, setLongitude] = useState(
    location.status === "resolved" ? location.longitude : -0.0015,
  );
  useEffect(() => {
    if (location.status !== "resolved") return;
    setLatitude(location.latitude);
    setLongitude(location.longitude);
  }, [location]);

  return (
    <section className="tracker-location" aria-label="Where and when">
      {location.status === "manual" ? <p className="tracker-note">{location.reason}</p> : null}
      <div className="tracker-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={
              location.status === "resolved" && location.label === preset.label ? "active" : ""
            }
            onClick={() => onPick(preset.latitude, preset.longitude, preset.label)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="tracker-fields">
        <label>
          Latitude
          <input
            type="number"
            step={0.5}
            value={latitude}
            onChange={(event) => setLatitude(Number(event.target.value))}
          />
        </label>
        <label>
          Longitude
          <input
            type="number"
            step={0.5}
            value={longitude}
            onChange={(event) => setLongitude(Number(event.target.value))}
          />
        </label>
        <label>
          Night of (UTC)
          <input
            type="datetime-local"
            value={whenIso}
            onChange={(event) => onWhen(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="tracker-use-coordinates"
          onClick={() => onPick(latitude, longitude, "these coordinates")}
        >
          Use these coordinates
        </button>
      </div>
    </section>
  );
}

interface Night {
  period: ObservationPeriod;
  ranking: Ranking;
  meteors: MeteorNight;
}

type WeatherState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; snapshots: ConditionSnapshot[]; adapter: WeatherAdapter }
  | { status: "unavailable"; reason: string };

/** Stable identity, so the memo below does not rerun on every render. */
const EMPTY_SNAPSHOTS: ConditionSnapshot[] = [];

function TrackerHero({
  entry,
  night,
  window,
  passed,
  snapshots,
  seen,
  onSeen,
}: {
  entry: SkyAdjustedOpportunity;
  night: Night;
  window: BestWindow | null;
  passed: boolean;
  snapshots: ConditionSnapshot[];
  seen: boolean;
  onSeen: () => void;
}) {
  const { opportunity } = entry;
  const { guidance } = opportunity;
  const isMeteors = opportunity.kind === "meteors";

  // The recommended time is the sky-aware one where a forecast exists, and the
  // phenomenon's own best where it does not.
  const whenUtc = window?.peakUtc ?? guidance.whenUtc;
  const atBest = nearestSnapshot(snapshots, whenUtc);

  return (
    <section className="tracker-hero" aria-label="Tonight's recommendation">
      {/* R5.6: safety is rendered before anything else and has no disclosure
          control. Nothing in the current phenomena sets it, but the position is
          reserved so that adding a solar event cannot quietly bury it. */}
      {guidance.safety ? (
        <p className="tracker-safety" role="alert">
          {guidance.safety}
        </p>
      ) : null}

      <div className="tracker-hero-head">
        <div>
          <h2>{opportunity.title}</h2>
          <p className="tracker-hero-summary">{opportunity.summary}</p>
        </div>
        <span className={`tracker-band tracker-band-${entry.band.replace(" ", "-")}`}>
          {entry.band}
        </span>
      </div>

      {passed ? (
        <p className="tracker-action-line">
          Already set for tonight — it was best around {timeOnly(guidance.whenUtc)} UTC. The
          times below are for the night as a whole.
        </p>
      ) : null}

      {window ? (
        <>
          <TrackerCondition
            viewability={window.viewability}
            temperatureC={atBest?.temperatureC ?? null}
            atUtc={whenUtc}
          />
          {/* One short conclusion, next to the action. Never a forecast card. */}
          <p className="tracker-action-line">{actionLine(window, atBest?.temperatureC ?? null)}</p>
          {window.viewability.limitedBySky ? (
            <p className="tracker-sky-limited">
              {opportunity.title} {opportunity.kind === "meteors" ? "are" : "is"} worth seeing
              tonight — it is the sky that is in the way, not the {opportunity.kind === "meteors" ? "shower" : "target"}.
            </p>
          ) : null}
        </>
      ) : null}

      <TrackerNightChart
        period={night.period}
        rateSamples={isMeteors ? night.meteors.samples : undefined}
        highlightUtc={whenUtc}
        highlightLabel="the best time to be outside"
      />

      <dl className="tracker-guidance">
        <div>
          <dt>Go outside</dt>
          <dd>
            {window
              ? `${timeOnly(window.startUtc)}–${timeOnly(window.endUtc)} UTC`
              : `${timeOnly(guidance.whenUtc)} UTC`}
          </dd>
        </div>
        <div>
          <dt>Face</dt>
          <dd>{guidance.direction ?? "any direction — it is not a fixed point"}</dd>
        </div>
        <div>
          <dt>Look</dt>
          <dd>{guidance.elevation}</dd>
        </div>
        <div>
          <dt>Give it</dt>
          <dd>{guidance.howLong}</dd>
        </div>
        <div>
          <dt>You need</dt>
          <dd className={guidance.equipment === "eyes" ? "" : "tracker-equipment-required"}>
            {guidance.equipment === "eyes"
              ? "Nothing but your eyes"
              : guidance.equipment === "binoculars"
                ? "Binoculars"
                : "A telescope"}
          </dd>
        </div>
      </dl>

      <p className="tracker-appearance">
        <strong>What it looks like.</strong> {guidance.appearance}
      </p>
      {guidance.technique ? (
        <p className="tracker-technique">
          <strong>Worth knowing.</strong> {guidance.technique}
        </p>
      ) : null}

      <div className="tracker-actions">
        <button
          type="button"
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
          className={seen ? "tracker-seen" : ""}
          onClick={onSeen}
          aria-pressed={seen}
        >
          {seen ? "You saw it" : "I saw it"}
        </button>
      </div>

      <details className="tracker-why">
        <summary>Why this, and why tonight</summary>
        <h3>Why it is visible from here, tonight</h3>
        <p>{opportunity.tonight}</p>
        <h3>Why this happens at all</h3>
        <p>{opportunity.phenomenon}</p>
        <h3>How it was ranked</h3>
        <ul>
          {explainRank(entry).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {window?.movedByWeather ? (
          <>
            <h3>Why not the peak</h3>
            <p>
              The phenomenon is strongest at {timeOnly(guidance.whenUtc)} UTC, but the forecast
              has the sky opening later. The time above is where the two together are best.
            </p>
          </>
        ) : null}
        {opportunity.limitations.length > 0 ? (
          <>
            <h3>What this estimate does not account for</h3>
            <ul>
              {opportunity.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {opportunity.missingInputs.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}
      </details>
    </section>
  );
}

function TrackerRankedList({
  ranked,
  windows,
  passed,
  snapshots,
  selectedId,
  onSelect,
}: {
  ranked: SkyAdjustedOpportunity[];
  windows: Map<string, BestWindow>;
  passed: Set<string>;
  snapshots: ConditionSnapshot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (ranked.length === 0) return null;
  return (
    <section className="tracker-list" aria-label="Tonight, ranked">
      {/* The list holds everything, including whatever is currently in the hero,
          because V1 §3 makes them one system: selecting an item moves it to the
          hero, and a list that dropped the current selection would leave no way
          back to it. It was headed "Also up tonight" first, which read as a
          list of the others while showing the hero at the top of it. */}
      <h2>Tonight, ranked</h2>
      <ol>
        {ranked.map((entry) => (
          <li key={entry.opportunity.id}>
            <button
              type="button"
              className={entry.opportunity.id === selectedId ? "active" : ""}
              onClick={() => onSelect(entry.opportunity.id)}
            >
              <span className="tracker-list-title">{entry.opportunity.title}</span>
              <span className="tracker-list-summary">{entry.opportunity.summary}</span>
              {(() => {
                if (passed.has(entry.opportunity.id)) {
                  return <span className="tracker-passed">Already set tonight</span>;
                }
                const window = windows.get(entry.opportunity.id);
                if (!window) return null;
                const snapshot = nearestSnapshot(snapshots, window.peakUtc);
                return (
                  <TrackerCondition
                    viewability={window.viewability}
                    temperatureC={snapshot?.temperatureC ?? null}
                    atUtc={window.peakUtc}
                    showFreshness={false}
                  />
                );
              })()}
              <span className="tracker-list-meta">
                {/* A3: the requirement is unmistakable in the list itself, before
                    the user commits to opening anything. */}
                {entry.opportunity.guidance.equipment !== "eyes" ? (
                  <span className="tracker-equipment-required">
                    {entry.opportunity.guidance.equipment === "telescope"
                      ? "Telescope required"
                      : "Binoculars required"}
                  </span>
                ) : null}
                <span className={`tracker-band tracker-band-${entry.band.replace(" ", "-")}`}>
                  {entry.band}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The passive half of V1 §5: model detail, source age, low-ranked events and the
 * reason something was demoted. Accessible, never in the way. It is behind a
 * disclosure control because putting "the Sun never gets below 18° tonight" in
 * front of someone deciding whether to go outside is how a product becomes
 * discouraging without becoming more honest.
 */
function TrackerPassive({
  night,
  weather,
  expanded,
  onToggle,
}: {
  night: Night;
  weather: WeatherState;
  expanded: boolean;
  onToggle: () => void;
}) {
  const darkest = deepestTwilightBand(night.period);
  return (
    <section className="tracker-passive" aria-label="Conditions and sources">
      <button type="button" onClick={onToggle} aria-expanded={expanded}>
        {expanded ? "Hide the detail" : "Conditions, sources and what was left out"}
      </button>
      {expanded ? (
        <div className="tracker-passive-body">
          <h3>The night itself</h3>
          {night.period.kind === "night" ? (
            <p>
              Sunset {timeOnly(night.period.startUtc)} to sunrise {timeOnly(night.period.endUtc)}{" "}
              UTC, {hoursBetween(night.period.startUtc, night.period.endUtc).toFixed(1)} hours.
              Darkest tonight: {darkest ? `${darkest} twilight` : "never dark"}. The Sun reaches{" "}
              {night.period.deepestSunAltitudeDeg.toFixed(1)}° at its lowest.
            </p>
          ) : (
            <p>{night.period.limitation}</p>
          )}
          {night.period.limitation && night.period.kind === "night" ? (
            <p>{night.period.limitation}</p>
          ) : null}

          <h3>What the meteor rate estimate leaves out</h3>
          <ul>
            {night.meteors.missingInputs.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {weather.status === "ready" ? (
              <li>
                Cloud is not in the rate itself — the number stays a clear-sky ceiling, and the
                forecast is applied separately as sky access.
              </li>
            ) : (
              <li>Cloud cover, because no forecast could be fetched for this location.</li>
            )}
          </ul>

          {night.ranking.notTonight.length > 0 ? (
            <>
              <h3>Up, but not worth it tonight</h3>
              <p>
                {night.ranking.notTonight.map((entry) => entry.title).join(", ")} — all too low or
                too washed out from where you are.
              </p>
            </>
          ) : null}

          <h3>Conditions</h3>
          {weather.status === "ready" ? (
            <>
              <p>{weather.adapter.source.attribution}</p>
              <p>
                Forecast issued {weather.snapshots[0]?.issuedUtc.slice(0, 16).replace("T", " ")} UTC,
                cached by forecast grid cell rather than by user. This source costs nothing to
                query, which is why it is on the free path.
              </p>
              <p>
                Their terms ask a caller to identify its application in a request header. A browser
                cannot: the header is on the Fetch standard's forbidden list, so whatever is set is
                discarded and the browser sends its own. Resolving that properly needs a caching
                proxy, which is a server, which costs money — so it is a decision rather than an
                oversight.
              </p>
            </>
          ) : weather.status === "unavailable" ? (
            <p>
              Conditions unavailable — {weather.reason} Everything above is the phenomenon on its
              own, with no weather adjustment applied.
            </p>
          ) : (
            <p>Fetching the forecast…</p>
          )}
          <p>
            Smoke is not yet fetched from anywhere. Where a smoke forecast is missing it is treated
            as unknown rather than as clean air, so a smoky sky currently reads as whatever the
            cloud cover says.
          </p>

          <h3>Where the numbers come from</h3>
          <p>
            Positions, twilight and eclipse circumstances are computed from Astronomy Engine and
            are as certain as the ephemeris. Meteor stream parameters come from a pinned snapshot
            of the IMO working list and the IAU Meteor Data Center established-shower list.
            Expected meteor rates are an estimate built on those, and the number quoted is a
            ceiling for a genuinely dark sky rather than a prediction of your evening.
          </p>
        </div>
      ) : null}
    </section>
  );
}
