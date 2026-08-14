import { useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { buildCsv, downloadCsv } from "../../lib/csvExport";
import type { ExplorerHistoricalCatalogObject } from "../../data/explorerHistoricalCatalog";
import {
  explorerLifetimeBands,
  survivalAt,
  type LifetimeBand,
  type LifetimePopulation,
} from "../../data/explorerLifetime";

/**
 * Measured orbital lifetime: how long objects at a given altitude actually stay
 * up, from the catalog's own decay dates.
 *
 * The altitude bands are ordered, so they are coloured with one hue stepped by
 * lightness rather than with seven separate hues. Adjacent steps of a sequential
 * ramp are close by construction, so identity does not rest on colour: the
 * separated curves are labelled where they end, every band is in the legend, and
 * the table below carries the exact figures.
 */

/** Single-hue sequential ramp, low altitude to high. Each step clears 3:1
 *  against the panel surface and rises monotonically in luminance. */
const BAND_COLORS = [
  "#1c6aa8",
  "#2b83c7",
  "#4a9cdd",
  "#6fb4ec",
  "#8cc4f2",
  "#a8d5f8",
  "#c2e2fb",
];

const PLOT = { left: 46, right: 108, top: 12, bottom: 26 };
const WIDTH = 640;
const HEIGHT = 300;
const MAX_YEARS = 40;

export function ExplorerLifetimeView({
  objects,
  snapshotYear,
}: {
  objects: readonly ExplorerHistoricalCatalogObject[];
  snapshotYear: number;
}) {
  const [population, setPopulation] = useState<LifetimePopulation>("non-maneuvering");
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const bands = useMemo(
    () => explorerLifetimeBands(objects, snapshotYear, population),
    [objects, population, snapshotYear],
  );

  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const xOf = (years: number) => PLOT.left + (Math.min(years, MAX_YEARS) / MAX_YEARS) * plotWidth;
  const yOf = (survival: number) => PLOT.top + (1 - survival) * plotHeight;

  const pathFor = (band: LifetimeBand) => {
    const steps: string[] = [];
    let previous = 1;
    for (const point of band.curve) {
      if (point.years > MAX_YEARS) break;
      // A Kaplan-Meier curve is a step function; drawing it as a slope would
      // imply decay between the observations rather than at them.
      steps.push(`L ${xOf(point.years).toFixed(1)} ${yOf(previous).toFixed(1)}`);
      steps.push(`L ${xOf(point.years).toFixed(1)} ${yOf(point.survival).toFixed(1)}`);
      previous = point.survival;
    }
    steps.push(`L ${xOf(MAX_YEARS).toFixed(1)} ${yOf(previous).toFixed(1)}`);
    return `M ${xOf(0).toFixed(1)} ${yOf(1).toFixed(1)} ${steps.join(" ")}`;
  };

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = ((event.clientX - rect.left) / rect.width) * WIDTH;
    if (ratio < PLOT.left || ratio > PLOT.left + plotWidth) {
      setHoverYear(null);
      return;
    }
    setHoverYear(Math.round(((ratio - PLOT.left) / plotWidth) * MAX_YEARS));
  };

  return (
    <section className="explorer-lifetime" aria-label="Measured orbital lifetime">
      <header className="explorer-lifetime-header">
        <button
          className="explorer-export-button"
          type="button"
          onClick={() => {
            const csv = buildCsv(
              bands,
              [
                { header: "perigee_band_km", value: (band) => `${band.lowKm}-${band.highKm}` },
                { header: "objects_measured", value: (band) => band.observed },
                { header: "decayed", value: (band) => band.decayed },
                { header: "still_in_orbit", value: (band) => band.censored },
                {
                  header: "median_lifetime_yr",
                  // Matches the table: a median of 0 whole years reads as "under 1".
                  value: (band) =>
                    band.medianYears === null
                      ? "beyond record"
                      : band.medianYears < 1
                        ? "<1"
                        : band.medianYears,
                },
                { header: "survival_1yr", value: (band) => survivalAt(band.curve, 1).toFixed(3) },
                { header: "survival_5yr", value: (band) => survivalAt(band.curve, 5).toFixed(3) },
                { header: "survival_10yr", value: (band) => survivalAt(band.curve, 10).toFixed(3) },
                { header: "survival_25yr", value: (band) => survivalAt(band.curve, 25).toFixed(3) },
              ],
              [
                "Orbit Studio - measured orbital lifetime (Kaplan-Meier)",
                `Population: ${population === "payload" ? "payloads (maneuvering)" : "debris, rocket bodies and components (non-maneuvering)"}`,
                `Snapshot year: ${snapshotYear}`,
                "Source: GCAT (J. McDowell, planet4589.org/space/gcat), CC BY 4.0",
                "Includes objects whose orbit was recorded within a year of coming into existence, in near-circular orbits.",
                "Objects still in orbit are censored at their current age, not counted as decayed.",
                "median_lifetime_yr = 'beyond record' where survival never reaches 0.5 within the observed record.",
              ],
            );
            downloadCsv(`orbit-studio-orbital-lifetime-${population}.csv`, csv);
          }}
        >
          <Download aria-hidden="true" size={13} />
          Export CSV
        </button>
        <h2>How long orbits last</h2>
        <p>
          Measured from the decay dates of real objects, not from a drag model. An
          object still in orbit counts toward the population at risk for as long as
          it has been up, rather than being treated as long-lived or dropped.
        </p>
        <div className="explorer-lifetime-population" role="group"
             aria-label="Population measured">
          <button aria-pressed={population === "non-maneuvering"} type="button"
                  className={population === "non-maneuvering" ? "active" : ""}
                  onClick={() => setPopulation("non-maneuvering")}>
            Debris & rocket bodies
          </button>
          <button aria-pressed={population === "payload"} type="button"
                  className={population === "payload" ? "active" : ""}
                  onClick={() => setPopulation("payload")}>
            Payloads
          </button>
        </div>
        {population === "payload" ? (
          <p className="explorer-lifetime-warning" role="status">
            Payloads are inserted low and raised to their operating altitude, so the
            recorded orbit is often not where the object lived. This curve therefore
            describes how satellites are operated rather than how orbits decay: the
            lowest band appears to outlast the one above it, which drag does not permit.
          </p>
        ) : null}
      </header>

      <div className="explorer-lifetime-body">
        <figure className="explorer-lifetime-figure">
          <svg
            ref={svgRef}
            role="img"
            aria-label="Fraction of objects still in orbit against years since the object came into existence, by perigee band"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            onMouseLeave={() => setHoverYear(null)}
            onMouseMove={handleMove}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((value) => (
              <g key={value}>
                <line className="explorer-lifetime-grid"
                      x1={PLOT.left} x2={PLOT.left + plotWidth}
                      y1={yOf(value)} y2={yOf(value)} />
                <text className="explorer-lifetime-axis" x={PLOT.left - 8} y={yOf(value) + 3}
                      textAnchor="end">
                  {value * 100}%
                </text>
              </g>
            ))}
            {[0, 10, 20, 30, 40].map((year) => (
              <text key={year} className="explorer-lifetime-axis"
                    x={xOf(year)} y={HEIGHT - 8} textAnchor="middle">
                {year}
              </text>
            ))}

            {bands.map((band, index) => (
              <path key={band.id} d={pathFor(band)} fill="none"
                    stroke={BAND_COLORS[index]} strokeWidth={2}
                    strokeLinejoin="round" />
            ))}

            {/* Direct labels only where the curves are actually apart; the rest
                converge on zero and would collide. The legend and the table
                carry those. */}
            {bands.map((band, index) => {
              const final = survivalAt(band.curve, MAX_YEARS);
              if (final < 0.08) return null;
              return (
                <text key={band.id} className="explorer-lifetime-direct"
                      x={PLOT.left + plotWidth + 8} y={yOf(final) + 3}
                      fill={BAND_COLORS[index]}>
                  {band.label}
                </text>
              );
            })}

            {hoverYear !== null ? (
              <line className="explorer-lifetime-crosshair"
                    x1={xOf(hoverYear)} x2={xOf(hoverYear)}
                    y1={PLOT.top} y2={PLOT.top + plotHeight} />
            ) : null}
          </svg>
          <figcaption>Years since the object came into existence</figcaption>
        </figure>

        <div className="explorer-lifetime-readout">
          <p className="explorer-lifetime-readout-title">
            {hoverYear === null
              ? "Still in orbit after 10 years"
              : `Still in orbit after ${hoverYear} year${hoverYear === 1 ? "" : "s"}`}
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Perigee</th>
                <th scope="col">Still up</th>
                <th scope="col">Median life</th>
                <th scope="col">Measured</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((band, index) => (
                <tr key={band.id}>
                  <th scope="row">
                    <span className="explorer-lifetime-key"
                          style={{ background: BAND_COLORS[index] }} aria-hidden="true" />
                    {band.label}
                  </th>
                  <td>
                    {(survivalAt(band.curve, hoverYear ?? 10) * 100).toFixed(0)}%
                  </td>
                  <td>
                    {band.medianYears === null
                      ? <span title="Half the population has not decayed in the whole record">
                          beyond record
                        </span>
                      : band.medianYears < 1
                        ? "under 1 yr"
                        : `${band.medianYears} yr`}
                  </td>
                  <td>{band.observed.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="explorer-lifetime-caveat">
            Counts objects whose orbit was recorded within a year of coming into
            existence, in near-circular orbits, so the recorded perigee is where the
            object actually was. “Beyond record” means half the band has still not
            decayed within the {snapshotYear - 1957} years of observation available.
          </p>
        </div>
      </div>
    </section>
  );
}
