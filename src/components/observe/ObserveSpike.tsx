import { useEffect, useMemo, useState } from "react";
import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MakeTime,
  Observer,
  SearchRiseSet,
} from "astronomy-engine";

/**
 * FEASIBILITY SPIKE — not a product surface.
 *
 * Exists to answer two questions before an Observe PRD is written:
 *
 *   1. does the deterministic astronomy layer meet our accuracy and provenance
 *      requirements at acceptable bundle cost?
 *   2. what does a minimal topocentric renderer actually cost in this codebase?
 *
 * It proves coordinate transformation, observer location and time, a horizon,
 * alt-azimuth placement, several known bodies and one event trajectory. It is
 * deliberately unpolished: no styling system, no responsive work, no
 * interaction beyond the inputs, and it is not reachable from navigation.
 *
 * Everything drawn here is computed locally. No network, no backend, no feed.
 */

const BODIES: { body: Body; label: string; color: string }[] = [
  { body: Body.Sun, label: "Sun", color: "#ffd166" },
  { body: Body.Moon, label: "Moon", color: "#e8eef5" },
  { body: Body.Mercury, label: "Mercury", color: "#b6a48c" },
  { body: Body.Venus, label: "Venus", color: "#f6e2b3" },
  { body: Body.Mars, label: "Mars", color: "#e2795c" },
  { body: Body.Jupiter, label: "Jupiter", color: "#e6cba8" },
  { body: Body.Saturn, label: "Saturn", color: "#dcc98f" },
];

const SIZE = 520;
const RADIUS = SIZE / 2 - 30;

/**
 * Alt-azimuth to screen. The horizon is the outer circle and the zenith is the
 * centre, so altitude is a radius and azimuth is an angle — north at the top and
 * east to the LEFT, because the observer is looking up rather than down at a map.
 */
function project(altitudeDeg: number, azimuthDeg: number) {
  const r = ((90 - altitudeDeg) / 90) * RADIUS;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  return {
    // Mirrored in x relative to a map projection. Written the obvious way first,
    // which put due-east Saturn on the right — correct for a map, wrong for a
    // sky chart, and the error is invisible until a known body is checked
    // against a compass.
    x: SIZE / 2 - r * Math.sin(azimuth),
    y: SIZE / 2 - r * Math.cos(azimuth),
  };
}

interface BrightStar {
  name?: string;
  raHours: number;
  decDeg: number;
  magnitude: number;
}

export function ObserveSpike() {
  // Loaded on demand: the catalog is 768 KB and the point of the spike is that
  // an observer page must not pay for anything it is not showing.
  const [stars, setStars] = useState<BrightStar[]>([]);
  useEffect(() => {
    void import("../../data/stars/hygBrightStars.v41.json").then((module) => {
      const all = (module.default as BrightStar[]).filter((star) => star.magnitude <= 3.5);
      setStars(all);
    });
  }, []);
  const [latitude, setLatitude] = useState(51.4779);
  const [longitude, setLongitude] = useState(-0.0015);
  const [whenIso, setWhenIso] = useState("2026-08-14T21:30");

  const { positions, trajectory, riseSet, skyStars, error } = useMemo(() => {
    try {
      const observer = new Observer(latitude, longitude, 0);
      const time = MakeTime(new Date(`${whenIso}:00Z`));

      const positions = BODIES.map((entry) => {
        const equator = Equator(entry.body, time, observer, true, true);
        const horizon = Horizon(time, observer, equator.ra, equator.dec, "normal");
        const illumination =
          entry.body === Body.Moon ? Illumination(entry.body, time) : null;
        return {
          ...entry,
          altitude: horizon.altitude,
          azimuth: horizon.azimuth,
          phase: illumination ? illumination.phase_fraction : null,
        };
      });

      // One event trajectory: where the Moon travels over the following twelve
      // hours, which is the shape any pass or transit path will reuse.
      const trajectory: { x: number; y: number; altitude: number }[] = [];
      for (let minute = 0; minute <= 720; minute += 10) {
        const step = MakeTime(new Date(new Date(`${whenIso}:00Z`).getTime() + minute * 60000));
        const equator = Equator(Body.Moon, step, observer, true, true);
        const horizon = Horizon(step, observer, equator.ra, equator.dec, "normal");
        trajectory.push({ ...project(horizon.altitude, horizon.azimuth), altitude: horizon.altitude });
      }

      const riseSet = BODIES.slice(0, 2).map((entry) => {
        const rise = SearchRiseSet(entry.body, observer, +1, time, 2);
        const set = SearchRiseSet(entry.body, observer, -1, time, 2);
        return {
          label: entry.label,
          rise: rise ? rise.date.toISOString().slice(11, 16) : "—",
          set: set ? set.date.toISOString().slice(11, 16) : "—",
        };
      });

      // The existing star catalog is equatorial, so it reaches the sky view
      // through exactly the same Horizon() call as the planets — no new
      // pipeline, no new asset.
      const skyStars = stars
        .map((star) => {
          const horizon = Horizon(time, observer, star.raHours, star.decDeg, "normal");
          return { ...star, altitude: horizon.altitude, azimuth: horizon.azimuth };
        })
        .filter((star) => star.altitude > 0);

      return { positions, trajectory, riseSet, skyStars, error: null as string | null };
    } catch (cause) {
      return { positions: [], trajectory: [], riseSet: [], skyStars: [], error: String(cause) };
    }
  }, [latitude, longitude, stars, whenIso]);

  return (
    <div style={{ padding: 20, color: "#dfeaf4", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1rem", margin: "0 0 4px" }}>Observe — feasibility spike</h1>
      <p style={{ fontSize: "0.75rem", color: "#8ea3b5", margin: "0 0 14px", maxWidth: "70ch" }}>
        Not a product surface. Proves topocentric transformation, observer location and
        time, horizon, alt-azimuth placement, known bodies and one trajectory. Everything
        is computed in the browser with no network call.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <label style={{ fontSize: "0.72rem" }}>
          Latitude{" "}
          <input type="number" step={0.5} value={latitude}
                 onChange={(event) => setLatitude(Number(event.target.value))} />
        </label>
        <label style={{ fontSize: "0.72rem" }}>
          Longitude{" "}
          <input type="number" step={0.5} value={longitude}
                 onChange={(event) => setLongitude(Number(event.target.value))} />
        </label>
        <label style={{ fontSize: "0.72rem" }}>
          UTC{" "}
          <input type="datetime-local" value={whenIso}
                 onChange={(event) => setWhenIso(event.target.value)} />
        </label>
      </div>

      {error ? (
        <p style={{ color: "#ff9b8a" }}>{error}</p>
      ) : (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <svg width={SIZE} height={SIZE} style={{ background: "#050a12", borderRadius: 12 }}>
            {[0, 30, 60].map((altitude) => (
              <circle key={altitude} cx={SIZE / 2} cy={SIZE / 2}
                      r={((90 - altitude) / 90) * RADIUS}
                      fill="none" stroke="rgba(126,154,176,0.25)" />
            ))}
            {["N", "E", "S", "W"].map((label, index) => {
              const at = project(-4, index * 90);
              return (
                <text key={label} x={at.x} y={at.y} fill="#7d93a6" fontSize={11}
                      textAnchor="middle">{label}</text>
              );
            })}

            {skyStars.map((star, index) => {
              const at = project(star.altitude, star.azimuth);
              return (
                <circle key={star.name ?? index} cx={at.x} cy={at.y}
                        r={Math.max(0.6, (4 - star.magnitude) * 0.7)}
                        fill="rgba(226,238,250,0.85)" />
              );
            })}

            {/* Trajectory, drawn only where the body is above the horizon. */}
            <polyline
              points={trajectory.filter((p) => p.altitude > 0).map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke="rgba(232,238,245,0.45)" strokeDasharray="4 4" />

            {positions.map((entry) => {
              if (entry.altitude < 0) return null;
              const at = project(entry.altitude, entry.azimuth);
              return (
                <g key={entry.label}>
                  <circle cx={at.x} cy={at.y} r={entry.label === "Sun" ? 7 : 5}
                          fill={entry.color} />
                  <text x={at.x + 9} y={at.y + 4} fill="#cfe0ee" fontSize={11}>
                    {entry.label}
                  </text>
                </g>
              );
            })}
          </svg>

          <div style={{ fontSize: "0.75rem", minWidth: 260 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ color: "#8ea3b5" }}>
                  <th style={{ textAlign: "left" }}>Body</th>
                  <th style={{ textAlign: "right" }}>Alt</th>
                  <th style={{ textAlign: "right" }}>Az</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((entry) => (
                  <tr key={entry.label}
                      style={{ opacity: entry.altitude < 0 ? 0.4 : 1 }}>
                    <td>{entry.label}{entry.phase !== null ? ` (${(entry.phase * 100).toFixed(0)}% lit)` : ""}</td>
                    <td style={{ textAlign: "right" }}>{entry.altitude.toFixed(1)}°</td>
                    <td style={{ textAlign: "right" }}>{entry.azimuth.toFixed(0)}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ color: "#8ea3b5", marginTop: 12 }}>
              <span style={{ display: "block" }}>
                {skyStars.length} cataloged stars above the horizon
              </span>
              {riseSet.map((entry) => (
                <span key={entry.label} style={{ display: "block" }}>
                  {entry.label}: rises {entry.rise} UTC, sets {entry.set} UTC
                </span>
              ))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
