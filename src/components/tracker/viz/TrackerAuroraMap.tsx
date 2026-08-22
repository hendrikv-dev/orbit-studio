import { useMemo } from "react";
import {
  NOAA_SWPC_SOURCE,
  assessAurora,
  auroraProbabilityAt,
  auroraVisibility,
  type AuroraAssessment,
  type AuroraGrid,
  type AuroraVisibility,
} from "../../../data/tracker/aurora";
import { formatClockTime, type PlaceClock } from "../../../lib/localTime";
import { TrackerGeoMap, type MapBounds, type MapProjection } from "./TrackerGeoMap";

/**
 * The auroral oval over the observer's own region.
 *
 * This occupies exactly the slot the meteor activity graph occupies, at the same
 * size, in the same place. That constraint is the point of the whole system:
 * the phenomenon changed, so the drawing changed, and nothing else did.
 *
 * ## What the field is
 *
 * NOAA's OVATION nowcast, on its published one-degree grid, sampled across the
 * map's own extent. The value is NOAA's own quantity — the probability of
 * visible aurora at that location — and it is drawn, labelled and attributed as
 * theirs. Tracker adds no model of its own on top of it, which is why this is
 * the one place in the product where a percentage appears at all.
 *
 * ## What the field is not
 *
 * It is not a forecast for tonight. It is a nowcast valid for roughly the next
 * half hour, and the panel says so in the same breath as it shows the number.
 * The temptation with a map this pretty is to leave it up as though it meant
 * something at 2am; the issue time is printed on it precisely so that it cannot.
 */

interface Props {
  grid: AuroraGrid;
  assessment: AuroraAssessment;
  bounds: MapBounds;
  observer: { latitudeDeg: number; longitudeDeg: number; label: string };
  clock: PlaceClock;
  /**
   * Opens the expanded map, or null when this *is* the expanded map.
   *
   * Null rather than a no-op: a control that is present and does nothing is the
   * defect this pass exists to remove, so the button is absent instead.
   */
  onOpenFullMap: (() => void) | null;
  /** See the eclipse map: a temporary question, never the saved place. */
  inspection?: {
    point: { latitudeDeg: number; longitudeDeg: number } | null;
    onSelect: (latitudeDeg: number, longitudeDeg: number) => void;
  } | null;
  interactive?: boolean;
  /** The reader's own visibility, so the map and the page cannot disagree. */
  visibility?: AuroraVisibility | null;
}

/**
 * The colour ramp.
 *
 * Perceptually ordered and deliberately not a rainbow: a reader has to be able
 * to rank two patches at a glance, and a hue-cycling scale makes that a memory
 * test. Low activity sits close to the map's own ground so a quiet night looks
 * quiet rather than looking like a legend with nothing in it.
 */
const RAMP: { stop: number; color: string }[] = [
  { stop: 5, color: "rgba(72, 96, 150, 0.42)" },
  { stop: 15, color: "rgba(64, 150, 168, 0.55)" },
  { stop: 30, color: "rgba(79, 216, 176, 0.62)" },
  { stop: 50, color: "rgba(196, 226, 122, 0.7)" },
  { stop: 75, color: "rgba(240, 169, 92, 0.78)" },
];

function colorFor(probability: number): string | null {
  let color: string | null = null;
  for (const entry of RAMP) {
    if (probability >= entry.stop) color = entry.color;
  }
  return color;
}

export function TrackerAuroraMap({
  grid,
  assessment,
  bounds,
  observer,
  clock,
  onOpenFullMap,
  inspection = null,
  interactive = false,
  visibility = null,
}: Props) {
  /**
   * The picked point, answered by the same model as the reader's own location.
   *
   * `assessAurora` is re-run for the point rather than reusing the observer's
   * assessment, because the whole question is how the answer changes with
   * where you stand — reusing it would draw a pin that says nothing new.
   */
  const inspectedVisibility = useMemo(() => {
    if (!inspection?.point) return null;
    const at = assessment.validity?.fromUtc ?? new Date().toISOString();
    const local = assessAurora(
      { grid, currentKp: assessment.kp, kpForecast: [], fetchedAtUtc: at, source: NOAA_SWPC_SOURCE, failures: [] },
      inspection.point.latitudeDeg,
      inspection.point.longitudeDeg,
      at,
      new Date(at),
    );
    return auroraVisibility(local, grid, inspection.point.latitudeDeg, inspection.point.longitudeDeg);
  }, [assessment.kp, assessment.validity, grid, inspection?.point]);
  // One degree matches the source grid exactly, so nothing is interpolated on
  // the way in. The smoothing happens once, visually, in the map's own filter.
  const cells = useMemo(() => {
    const found: { lat: number; lon: number; probability: number }[] = [];
    for (let lat = Math.floor(bounds.south); lat <= Math.ceil(bounds.north); lat += 1) {
      for (let lon = Math.floor(bounds.west); lon <= Math.ceil(bounds.east); lon += 1) {
        const probability = auroraProbabilityAt(grid, lat, lon);
        if (probability >= 5) found.push({ lat, lon, probability });
      }
    }
    return found;
  }, [bounds, grid]);

  /**
   * Whether this field is still describing now.
   *
   * The rest of the page withdraws its conclusions once the nowcast expires,
   * but the map went on painting the same saturated oval underneath the words
   * "current auroral conditions are unavailable". A picture is a claim, and a
   * bright one is a confident claim: the two disagreed, and the picture is the
   * one a reader believes. It is still drawn, because what NOAA last published
   * is worth seeing, but drawn as history — faint, and labelled as expired.
   */
  const expired = assessment.freshness === "stale" || assessment.freshness === "unavailable";

  const field = (projection: MapProjection) => {
    const cellWidth = Math.abs(projection.x(1) - projection.x(0));
    const cellHeight = Math.abs(projection.y(1) - projection.y(0));
    return (
      <g filter="url(#tk-geomap-smooth)" opacity={expired ? 0.22 : 1}>
        {cells.map((cell) => {
          const color = colorFor(cell.probability);
          if (!color) return null;
          return (
            <rect
              key={`${cell.lat}:${cell.lon}`}
              x={projection.x(cell.lon) - cellWidth / 2}
              y={projection.y(cell.lat) - cellHeight / 2}
              width={cellWidth + 1}
              height={cellHeight + 1}
              fill={color}
            />
          );
        })}
      </g>
    );
  };

  const issued = formatClockTime(grid.observationUtc, clock);
  const valid = formatClockTime(grid.forecastUtc, clock);
  const age = assessment.gridAgeMinutes;

  return (
    <div className={`tk-viz-panel tk-auroramap${expired ? " is-expired" : ""}`}>
      <TrackerGeoMap
        bounds={bounds}
        marker={observer}
        legend={[
          { swatch: "rgba(72, 96, 150, 0.6)", label: "5%" },
          { swatch: "rgba(64, 150, 168, 0.7)", label: "15%" },
          { swatch: "rgba(79, 216, 176, 0.75)", label: "30%" },
          { swatch: "rgba(196, 226, 122, 0.8)", label: "50%" },
          { swatch: "rgba(240, 169, 92, 0.85)", label: "75%+" },
        ]}
        title={expired ? "Aurora nowcast — expired" : "Aurora nowcast"}
        timing={
          expired
            ? `Last observed ${issued} · expired ${valid}`
            : `Observed ${issued} · valid to about ${valid}`
        }
        action={onOpenFullMap ? { label: "Open full map", onSelect: onOpenFullMap } : undefined}
        interactive={interactive}
        selected={
          inspection?.point
            ? {
                ...inspection.point,
                label: `${inspection.point.latitudeDeg.toFixed(1)}°, ${inspection.point.longitudeDeg.toFixed(1)}°`,
              }
            : null
        }
        onSelectPoint={inspection?.onSelect}
        summary={
          <dl>
            {visibility ? (
              <div>
                <dt>From {observer.label}</dt>
                <dd>{visibility.statement}</dd>
              </div>
            ) : null}
            {inspectedVisibility && inspection?.point ? (
              <div>
                <dt>
                  From {inspection.point.latitudeDeg.toFixed(1)}°,{" "}
                  {inspection.point.longitudeDeg.toFixed(1)}°
                </dt>
                <dd>{inspectedVisibility.statement}</dd>
              </div>
            ) : null}
          </dl>
        }
        ariaLabel={
          expired
            ? `Expired aurora nowcast centred on ${observer.label}, shown as history. ` +
              assessment.statement
            : `Aurora forecast map centred on ${observer.label}. ${assessment.statement}`
        }
      >
        {field}
      </TrackerGeoMap>

      <div
        className={`tk-viz-verdict is-${
          assessment.outlook === "plausible-tonight"
            ? "good"
            : assessment.outlook === "north-of-you"
              ? "fair"
              : assessment.outlook === "quiet"
                ? "poor"
                : "unknown"
        }`}
      >
        <p className="tk-viz-verdict-head">
          {assessment.outlook === "plausible-tonight"
            ? "Aurora is plausible from here"
            : assessment.outlook === "north-of-you"
              ? "The oval is away from you"
              : assessment.outlook === "quiet"
                ? "Quiet tonight"
                : "Not enough data"}
        </p>
        <p className="tk-viz-verdict-detail">
          {assessment.statement}{" "}
          {age !== null && age > 120
            ? "This nowcast is out of date — reload before acting on it."
            : "Valid for about the next half hour."}
        </p>
      </div>
    </div>
  );
}
