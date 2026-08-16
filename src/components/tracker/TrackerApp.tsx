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
  explainRank,
  rankOpportunities,
  type RankedOpportunity,
  type Ranking,
} from "../../data/tracker/opportunity";
import { TrackerNightChart } from "./TrackerNightChart";

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

  const selected: RankedOpportunity | null = useMemo(() => {
    if (!night) return null;
    if (selectedId) {
      const found = night.ranking.ranked.find((entry) => entry.opportunity.id === selectedId);
      if (found) return found;
    }
    return night.ranking.hero;
  }, [night, selectedId]);

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
            ranking={night.ranking}
            selectedId={selected?.opportunity.id ?? null}
            onSelect={setSelectedId}
          />

          <TrackerPassive
            night={night}
            expanded={showPassive}
            onToggle={() => setShowPassive((current) => !current)}
          />
        </>
      ) : null}

      <footer className="tracker-footer">
        <p>
          Everything on this page is computed on your device from an analytic ephemeris and a
          vendored meteor stream catalogue. Nothing is sent anywhere, and no account exists.
          Satellite passes and aurora are not here yet: both need live data Tracker does not
          fetch, and inventing them from what is in the bundle would be worse than their absence.
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
  const [latitude, setLatitude] = useState(51.4779);
  const [longitude, setLongitude] = useState(-0.0015);

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

function TrackerHero({
  entry,
  night,
  seen,
  onSeen,
}: {
  entry: RankedOpportunity;
  night: Night;
  seen: boolean;
  onSeen: () => void;
}) {
  const { opportunity } = entry;
  const { guidance } = opportunity;
  const isMeteors = opportunity.kind === "meteors";

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

      <TrackerNightChart
        period={night.period}
        rateSamples={isMeteors ? night.meteors.samples : undefined}
        highlightUtc={guidance.whenUtc}
        highlightLabel="the best time to be outside"
      />

      <dl className="tracker-guidance">
        <div>
          <dt>Go outside</dt>
          <dd>{timeOnly(guidance.whenUtc)} UTC</dd>
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
              startUtc: guidance.whenUtc,
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
  ranking,
  selectedId,
  onSelect,
}: {
  ranking: Ranking;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (ranking.ranked.length === 0) return null;
  return (
    <section className="tracker-list" aria-label="Tonight, ranked">
      {/* The list holds everything, including whatever is currently in the hero,
          because V1 §3 makes them one system: selecting an item moves it to the
          hero, and a list that dropped the current selection would leave no way
          back to it. It was headed "Also up tonight" first, which read as a
          list of the others while showing the hero at the top of it. */}
      <h2>Tonight, ranked</h2>
      <ol>
        {ranking.ranked.map((entry) => (
          <li key={entry.opportunity.id}>
            <button
              type="button"
              className={entry.opportunity.id === selectedId ? "active" : ""}
              onClick={() => onSelect(entry.opportunity.id)}
            >
              <span className="tracker-list-title">{entry.opportunity.title}</span>
              <span className="tracker-list-summary">{entry.opportunity.summary}</span>
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
  expanded,
  onToggle,
}: {
  night: Night;
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

          <h3>What was not taken into account</h3>
          <ul>
            {night.meteors.missingInputs.map((line) => (
              <li key={line}>{line}</li>
            ))}
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
