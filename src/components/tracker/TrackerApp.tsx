import { useEffect, useMemo, useState } from "react";
import { signalAppReady } from "../../lib/appReady";
import {
  deepestTwilightBand,
  trackerObservationPeriod,
} from "../../data/tracker/observationPeriod";

/**
 * Orbit Studio Tracker.
 *
 * Mounted at the entry point rather than inside App, because App imports the
 * 16 MB satellite catalog and TRACKER_PRD R7.1 requires an observer page not to
 * pay for it. Opening Tracker is therefore a real navigation, not a mode switch.
 *
 * This is the first increment: the observation period a night is framed against
 * (R4.1–R4.3). Events, ranking and guidance come next; nothing here claims to
 * rank anything yet.
 */

const PRESETS = [
  { label: "London", latitude: 51.4779, longitude: -0.0015 },
  { label: "Nairobi", latitude: -1.2921, longitude: 36.8219 },
  { label: "Tromsø", latitude: 69.6496, longitude: 18.956 },
  { label: "Sydney", latitude: -33.8688, longitude: 151.2093 },
];

function timeOnly(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

function hoursBetween(startIso: string, endIso: string): number {
  return (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000;
}

export function TrackerApp() {
  const [latitude, setLatitude] = useState(51.4779);
  const [longitude, setLongitude] = useState(-0.0015);
  const [whenIso, setWhenIso] = useState(() => new Date().toISOString().slice(0, 16));

  const period = useMemo(() => {
    try {
      return trackerObservationPeriod(latitude, longitude, new Date(`${whenIso}:00Z`));
    } catch {
      return null;
    }
  }, [latitude, longitude, whenIso]);

  const darkest = period ? deepestTwilightBand(period) : null;

  // No renderer here, so the boot indicator is told directly.
  useEffect(() => { signalAppReady(); }, []);

  return (
    <main className="tracker-shell">
      <header className="tracker-header">
        <img src="/brand/orbit-studio-tracker-logo.png" alt="Orbit Studio Tracker" />
        <p>What is worth watching from where you are, when to look, and how reliable it is.</p>
      </header>

      <section className="tracker-location" aria-label="Observer location and time">
        <div className="tracker-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={
                latitude === preset.latitude && longitude === preset.longitude ? "active" : ""
              }
              onClick={() => {
                setLatitude(preset.latitude);
                setLongitude(preset.longitude);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="tracker-fields">
          <label>
            Latitude
            <input type="number" step={0.5} value={latitude}
                   onChange={(event) => setLatitude(Number(event.target.value))} />
          </label>
          <label>
            Longitude
            <input type="number" step={0.5} value={longitude}
                   onChange={(event) => setLongitude(Number(event.target.value))} />
          </label>
          <label>
            UTC
            <input type="datetime-local" value={whenIso}
                   onChange={(event) => setWhenIso(event.target.value)} />
          </label>
        </div>
      </section>

      {period ? (
        <section className="tracker-period" aria-label="Tonight">
          <h2>Tonight</h2>
          {period.kind === "night" ? (
            <p className="tracker-period-frame">
              Sunset <strong>{timeOnly(period.startUtc)}</strong> to sunrise{" "}
              <strong>{timeOnly(period.endUtc)}</strong> UTC —{" "}
              {hoursBetween(period.startUtc, period.endUtc).toFixed(1)} hours.
            </p>
          ) : (
            <p className="tracker-period-frame">
              {period.kind === "polar-day"
                ? "The Sun does not set here today."
                : "The Sun does not rise here today."}
            </p>
          )}

          <dl className="tracker-darkness">
            {(["civil", "nautical", "astronomical"] as const).map((band) => {
              const window = period.darkness[band];
              return (
                <div key={band} className={window ? "" : "is-absent"}>
                  <dt>{band[0].toUpperCase() + band.slice(1)} darkness</dt>
                  <dd>
                    {window
                      ? `${timeOnly(window.startUtc)} – ${timeOnly(window.endUtc)} UTC`
                      : "not reached"}
                  </dd>
                </div>
              );
            })}
            <div>
              <dt>Sun at its lowest</dt>
              <dd>{period.deepestSunAltitudeDeg.toFixed(1)}°</dd>
            </div>
          </dl>

          <p className="tracker-note">
            {darkest
              ? `Darkest tonight: ${darkest} twilight.`
              : "No darkness tonight."}
            {period.limitation ? ` ${period.limitation}` : ""}
          </p>
        </section>
      ) : (
        <p className="tracker-note">That location or time could not be resolved.</p>
      )}

      <footer className="tracker-footer">
        <p>
          Positions and twilight times are computed locally from an analytic ephemeris.
          Event ranking, observation guidance and forecast layers are not built yet.
        </p>
      </footer>
    </main>
  );
}
