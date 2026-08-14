import { useMemo, useState } from "react";
import { Download, ExternalLink, ScatterChart } from "lucide-react";
import { buildCsv, downloadCsv } from "../../lib/csvExport";
import type { ExplorerHistoricalCatalogObject } from "../../data/explorerHistoricalCatalog";
import {
  fragmentSurvivalByYear,
  type FragmentationEvent,
} from "../../data/explorerFragmentation";
import {
  fragmentationCauseFor,
  fragmentationCauseReference,
} from "../../data/explorerFragmentationCause";

/**
 * The debris lens: which break-ups produced the orbital debris population, and
 * how much of each one is still up there.
 *
 * Ranked by fragments still in orbit rather than fragments produced. Those are
 * different questions and they order the list differently — the 2021 ASAT test
 * made 1,806 fragments and has 7 left, while a smaller break-up at a higher
 * altitude can still be contributing decades later. What is still in orbit is
 * the consequence; what was produced is the event.
 */

interface ExplorerDebrisViewProps {
  events: readonly FragmentationEvent[];
  objects: readonly ExplorerHistoricalCatalogObject[];
  snapshotYear: number;
  snapshotLabel: string;
  onShowInPopulation: (event: FragmentationEvent) => void;
}

const DATE_PRECISION_LABEL: Record<FragmentationEvent["datePrecision"], string> = {
  second: "to the second",
  minute: "to the minute",
  day: "to the day",
  month: "month only",
  year: "year only",
};

function formatEventDate(event: FragmentationEvent): string {
  const iso = event.dateIso;
  switch (event.datePrecision) {
    case "year":
      return iso.slice(0, 4);
    case "month":
      return iso.slice(0, 7);
    case "day":
      return iso.slice(0, 10);
    default:
      return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  }
}

/** Remaining-fragment curve. Sourced decay dates only — not a decay model. */
function SurvivalCurve({
  series,
  totalFragments,
}: {
  series: { year: number; remaining: number; fraction: number }[];
  /** The event's full fragment count. `series[0]` is already a year in, so it
      undercounts anything that decayed within twelve months of the break-up. */
  totalFragments: number;
}) {
  if (series.length < 2) return null;
  const width = 320;
  const height = 96;
  const lastYear = series[series.length - 1].year;
  const firstYear = series[0].year;
  const span = Math.max(1, lastYear - firstYear);
  const points = series
    .map((point) => {
      const x = ((point.year - firstYear) / span) * width;
      const y = height - point.fraction * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <figure className="explorer-debris-survival">
      <div className="explorer-debris-survival-plot">
        {/* Without a scale the area could be 0-100% or 60-100% and the reader
            cannot tell. The Lifetime view labels its axis; so does this. */}
        <div className="explorer-debris-survival-axis" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <svg preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} role="img"
             aria-label={`Fragments remaining from ${firstYear} to ${lastYear}`}>
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line key={fraction} className="explorer-debris-survival-grid"
                  x1={0} x2={width} y1={height * fraction} y2={height * fraction} />
          ))}
          <polyline points={`0,${height} ${points} ${width},${height}`}
                    className="explorer-debris-survival-area" />
          <polyline points={points} className="explorer-debris-survival-line" />
        </svg>
      </div>
      <figcaption>
        <span>{firstYear}</span>
        <span>
          {series[series.length - 1].remaining.toLocaleString()} of{" "}
          {totalFragments.toLocaleString()} still in orbit
        </span>
        <span>{lastYear}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Where the fragments ended up relative to the parent. The bar spans the
 * fragment perigee range with the parent's own perigee marked, because the
 * pieces pushed below the parent are the ones that come back first.
 */
function DispersionBar({ event }: { event: FragmentationEvent }) {
  const spread = event.fragmentPerigeeKm;
  const parent = event.parentOrbit;
  if (!spread || !parent) return null;
  const low = Math.min(spread.minKm, parent.perigeeKm);
  const high = Math.max(spread.maxKm, parent.perigeeKm);
  const span = Math.max(1, high - low);
  const position = (value: number) => ((value - low) / span) * 100;

  return (
    <div className="explorer-debris-dispersion">
      <p className="explorer-debris-dispersion-title">
        Fragment perigee range vs parent perigee
      </p>
      <div className="explorer-debris-dispersion-track">
        <span
          className="explorer-debris-dispersion-range"
          style={{
            left: `${position(spread.minKm)}%`,
            width: `${position(spread.maxKm) - position(spread.minKm)}%`,
          }}
        />
        <span className="explorer-debris-dispersion-median"
              style={{ left: `${position(spread.medianKm)}%` }} />
        <span className="explorer-debris-dispersion-parent"
              style={{ left: `${position(parent.perigeeKm)}%` }} />
      </div>
      {/* Without end labels the bar spans the full width by construction and
          says nothing; the scale is what makes the marker positions readable. */}
      <div className="explorer-debris-dispersion-scale" aria-hidden="true">
        <span>{Math.round(low).toLocaleString()} km</span>
        <span>{Math.round(high).toLocaleString()} km</span>
      </div>
      <dl>
        <div>
          <dt>
            <span className="explorer-debris-key explorer-debris-key-parent" aria-hidden="true" />
            Parent perigee
          </dt>
          <dd>{Math.round(parent.perigeeKm).toLocaleString()} km</dd>
        </div>
        <div>
          <dt>Fragment perigee, median</dt>
          <dd>{Math.round(spread.medianKm).toLocaleString()} km</dd>
        </div>
        <div>
          <dt>Lowest fragment</dt>
          <dd>{Math.round(spread.minKm).toLocaleString()} km</dd>
        </div>
      </dl>
    </div>
  );
}

export function ExplorerDebrisView({
  events,
  objects,
  snapshotYear,
  snapshotLabel,
  onShowInPopulation,
}: ExplorerDebrisViewProps) {
  const ranked = useMemo(
    () =>
      [...events]
        .sort((a, b) => b.inOrbitCount - a.inOrbitCount || b.fragmentCount - a.fragmentCount)
        .slice(0, 120),
    [events],
  );
  const [selectedId, setSelectedId] = useState<string | null>(ranked[0]?.id ?? null);
  const selected = ranked.find((event) => event.id === selectedId) ?? ranked[0];
  const survival = useMemo(
    () => (selected ? fragmentSurvivalByYear(objects, selected, snapshotYear) : []),
    [objects, selected, snapshotYear],
  );

  const totalInOrbit = events.reduce((sum, event) => sum + event.inOrbitCount, 0);
  const totalFragments = events.reduce((sum, event) => sum + event.fragmentCount, 0);

  if (!selected) return null;
  const cause = fragmentationCauseFor(selected);

  return (
    <section className="explorer-debris" aria-label="Debris and fragmentation">
      <header className="explorer-debris-header">
        <button
          className="explorer-export-button"
          type="button"
          onClick={() => {
            const csv = buildCsv(
              ranked,
              [
                { header: "parent", value: (event) => event.parentName },
                { header: "parent_record_id", value: (event) => event.parentRecordId },
                { header: "event_date_utc", value: (event) => event.dateIso },
                { header: "date_precision", value: (event) => event.datePrecision },
                { header: "date_uncertain", value: (event) => (event.dateUncertain ? "true" : "false") },
                { header: "assessed_cause", value: (event) => fragmentationCauseFor(event).cause ?? "" },
                { header: "cause_standing", value: (event) => fragmentationCauseFor(event).standing },
                { header: "fragments_cataloged", value: (event) => event.fragmentCount },
                { header: "fragments_in_orbit", value: (event) => event.inOrbitCount },
                { header: "parent_perigee_km", value: (event) => event.parentOrbit?.perigeeKm.toFixed(1) },
                { header: "parent_apogee_km", value: (event) => event.parentOrbit?.apogeeKm.toFixed(1) },
                { header: "parent_inclination_deg", value: (event) => event.parentOrbit?.inclinationDeg.toFixed(2) },
                { header: "fragment_perigee_min_km", value: (event) => event.fragmentPerigeeKm?.minKm.toFixed(1) },
                { header: "fragment_perigee_median_km", value: (event) => event.fragmentPerigeeKm?.medianKm.toFixed(1) },
              ],
              [
                "Orbit Studio - fragmentation events",
                `Snapshot: ${snapshotLabel}`,
                "Parentage, dates and orbits: GCAT (J. McDowell, planet4589.org/space/gcat), CC BY 4.0",
                `Assessed cause: ${fragmentationCauseReference.reportNumber} - ${fragmentationCauseReference.title}`,
                "cause_standing: assessed | assessed-unknown (investigated, undetermined) | unassessed (outside the cited reference)",
                "fragments_in_orbit counts objects with no decay date recorded at the snapshot.",
              ],
            );
            downloadCsv("orbit-studio-fragmentation-events.csv", csv);
          }}
        >
          <Download aria-hidden="true" size={13} />
          Export CSV
        </button>
        <div>
          <h2>Fragmentation events</h2>
          <p>
            {totalFragments.toLocaleString()} cataloged fragments from{" "}
            {events.length.toLocaleString()} recorded break-ups;{" "}
            {totalInOrbit.toLocaleString()} still in orbit at {snapshotLabel}.
          </p>
        </div>
      </header>

      <div className="explorer-debris-body">
        <ol className="explorer-debris-list" aria-label="Break-ups by fragments still in orbit">
          {ranked.map((event) => {
            const share = event.fragmentCount > 0
              ? event.inOrbitCount / event.fragmentCount
              : 0;
            return (
              <li key={event.id}>
                <button
                  aria-current={event.id === selected.id}
                  className={event.id === selected.id ? "active" : ""}
                  type="button"
                  onClick={() => setSelectedId(event.id)}
                >
                  <span className="explorer-debris-list-name">{event.parentName}</span>
                  <span className="explorer-debris-list-year">
                    {event.dateIso.slice(0, 4)}
                  </span>
                  <span className="explorer-debris-list-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, share * 100)}%` }} />
                  </span>
                  <span className="explorer-debris-list-count">
                    {event.inOrbitCount.toLocaleString()}
                    <small> / {event.fragmentCount.toLocaleString()}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <article className="explorer-debris-detail">
          <h3>{selected.parentName}</h3>
          <p className="explorer-debris-when">
            {formatEventDate(selected)}
            <span className="explorer-debris-precision">
              recorded {DATE_PRECISION_LABEL[selected.datePrecision]}
              {selected.dateUncertain ? "; source marks this date uncertain" : ""}
            </span>
          </p>

          {/* Cause is the one fact GCAT does not carry, so it never appears
              without saying where it came from and how firm it is. */}
          <p className={`explorer-debris-cause explorer-debris-cause-${cause.standing}`}>
            <strong>{cause.label}</strong>
            {cause.note ? <span>{cause.note}</span> : null}
            {cause.standing === "unassessed" ? null : (
              <span>
                Assessed by{" "}
                <a href={fragmentationCauseReference.url} rel="noreferrer" target="_blank">
                  {fragmentationCauseReference.reportNumber}
                  <ExternalLink aria-hidden="true" size={11} />
                </a>
              </span>
            )}
          </p>

          <dl className="explorer-debris-facts">
            <div>
              <dt>Fragments cataloged</dt>
              <dd>{selected.fragmentCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Still in orbit</dt>
              <dd>
                {selected.inOrbitCount.toLocaleString()}
                <small>
                  {" "}
                  ({((selected.inOrbitCount / selected.fragmentCount) * 100).toFixed(0)}%)
                </small>
              </dd>
            </div>
            {selected.parentOrbit ? (
              <div>
                <dt>Parent orbit</dt>
                <dd>
                  {Math.round(selected.parentOrbit.perigeeKm).toLocaleString()} ×{" "}
                  {Math.round(selected.parentOrbit.apogeeKm).toLocaleString()} km,{" "}
                  {selected.parentOrbit.inclinationDeg.toFixed(1)}°
                </dd>
              </div>
            ) : null}
          </dl>

          <SurvivalCurve series={survival} totalFragments={selected.fragmentCount} />
          <DispersionBar event={selected} />

          <button
            className="explorer-debris-population-link"
            type="button"
            onClick={() => onShowInPopulation(selected)}
          >
            <ScatterChart aria-hidden="true" size={14} />
            Show these fragments on the population view
          </button>

          <p className="explorer-debris-caveat">
            Parentage, separation dates and decay dates are sourced from GCAT. Cause
            comes from a separate NASA reference and is shown only where that
            reference assesses this exact break-up. Remaining fragments are those with
            no decay date recorded at {snapshotLabel}.
          </p>
        </article>
      </div>
    </section>
  );
}
