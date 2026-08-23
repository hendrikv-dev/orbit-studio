import { useMemo } from "react";
import type { EclipseDestinations } from "../../../data/tracker/eclipseDestinations";
import {
  localSolarCircumstances,
  type CentralPathPoint,
  type CoverageField,
  type LocalSolarCircumstances,
  type SolarEclipseEvent,
} from "../../../data/tracker/solarEclipse";
import {
  capOutline,
  lunarLocalVisibility,
  type LunarEclipseTiming,
  type LunarGeographicVisibility,
  type LunarLocalVisibility,
} from "../../../data/tracker/lunarEclipse";
import { formatClockTime, type PlaceClock } from "../../../lib/localTime";
import { TrackerGeoMap, type MapBounds, type MapProjection } from "./TrackerGeoMap";

/**
 * Eclipse geometry, in the same slot as the aurora map and the meteor graph.
 *
 * Two eclipses, two genuinely different geometries, one component — because the
 * *layout* must not change and the *content* must. A solar eclipse has a track:
 * a line the Moon's shadow draws across the Earth, with coverage falling away
 * either side of it, and the only question that matters is which side of it you
 * are on. A lunar eclipse has no track at all. The Moon is eclipsed for
 * everybody at once, and the map is answering whether the Moon is above your
 * horizon while it happens.
 *
 * Drawing a track on a lunar eclipse map, or a visibility blob on a solar one,
 * would be the failure this component exists to prevent: a picture that looks
 * like the right kind of answer to the wrong question.
 *
 * Every value drawn here is computed from the ephemeris in
 * `solarEclipse.ts` and `lunarEclipse.ts`. Nothing is traced from a published
 * map, and the resolution of the sampling is stated in the legend rather than
 * smoothed into an implied precision it does not have.
 */

const SOLAR_BANDS: { floor: number; color: string; label: string }[] = [
  { floor: 0.9, color: "rgba(238, 214, 255, 0.82)", label: "90%+" },
  { floor: 0.75, color: "rgba(178, 152, 246, 0.72)", label: "75–90%" },
  { floor: 0.5, color: "rgba(120, 116, 224, 0.62)", label: "50–75%" },
  { floor: 0.2, color: "rgba(78, 96, 186, 0.5)", label: "20–50%" },
  { floor: 0.01, color: "rgba(60, 76, 140, 0.36)", label: "Under 20%" },
];

/** What each candidate is, in the reader's terms rather than the code's. */
const DESTINATION_LABEL: Record<string, string> = {
  "closest-visibility": "Nearest place it is visible",
  "closest-central": "Nearest totality or annularity",
  "best-nearby": "Best view within reach",
};

function bandColor(fraction: number): string | null {
  for (const band of SOLAR_BANDS) {
    if (fraction >= band.floor) return band.color;
  }
  return null;
}

interface SolarProps {
  kind: "solar";
  event: SolarEclipseEvent;
  coverage: CoverageField;
  centralPath: CentralPathPoint[];
  local: LocalSolarCircumstances;
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
  /**
   * Letting the reader ask about somewhere that is not home.
   *
   * The point is deliberately not a place: it never touches the saved
   * location, it is not persisted, and it disappears with the map. "What would
   * this look like from my parents' house" is a question worth answering
   * without making somebody re-enter where they live afterwards.
   */
  inspection?: {
    point: { latitudeDeg: number; longitudeDeg: number } | null;
    onSelect: (latitudeDeg: number, longitudeDeg: number) => void;
  } | null;
  /** Whether this instance is the exploratory one. */
  interactive?: boolean;
  /**
   * Where to go, when the reader asks.
   *
   * "It isn't visible from your location" is a refusal rather than an answer to
   * "where should I go to see the next eclipse", so the map carries the
   * candidates and their local circumstances rather than sending the reader
   * somewhere else to find them.
   */
  destinations?: EclipseDestinations | null;
}

interface LunarProps {
  kind: "lunar";
  title: string;
  maximumUtc: string;
  visibility: LunarGeographicVisibility;
  /** The reader's own circumstances, from the eclipse's real contact times. */
  local: LunarLocalVisibility;
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
  /** Moon altitude at maximum from the observer, which is the local answer. */
  observerAltitudeDeg: number;
  /** See `SolarProps.inspection`. */
  inspection?: {
    point: { latitudeDeg: number; longitudeDeg: number } | null;
    onSelect: (latitudeDeg: number, longitudeDeg: number) => void;
  } | null;
  interactive?: boolean;
  /** The eclipse's contact times, so a picked point can be answered for. */
  timing: LunarEclipseTiming;
}

export type TrackerEclipseMapProps = SolarProps | LunarProps;

export function TrackerEclipseMap(props: TrackerEclipseMapProps) {
  return props.kind === "solar" ? <SolarEclipseMap {...props} /> : <LunarEclipseMap {...props} />;
}

/** "6m 23s", the way eclipse durations are always quoted. */
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

/* ----------------------------------------------------------------- solar */

function SolarEclipseMap({
  event,
  coverage,
  centralPath,
  local,
  bounds,
  observer,
  clock,
  onOpenFullMap,
  inspection = null,
  interactive = false,
  destinations = null,
}: SolarProps) {
  /**
   * The picked point's circumstances, from the same per-observer routine the
   * reader's own line uses — contacts by bisection, maximum by golden section.
   * Nothing here is interpolated off the drawn field.
   */
  const inspected = useMemo(
    () =>
      inspection?.point
        ? localSolarCircumstances(
            event,
            inspection.point.latitudeDeg,
            inspection.point.longitudeDeg,
          )
        : null,
    [event, inspection?.point],
  );

  const cells = useMemo(
    () => coverage.cells.filter((cell) => cell.obscuration >= 0.01 && cell.sunUp),
    [coverage.cells],
  );

  const field = (projection: MapProjection) => {
    const cellWidth = Math.abs(projection.x(coverage.stepDeg) - projection.x(0));
    const cellHeight = Math.abs(projection.y(coverage.stepDeg) - projection.y(0));
    // Only the stretch of track that crosses this map. Drawing the whole path
    // would send a line off both edges of every regional view, which reads as a
    // rendering fault rather than as a shadow leaving the frame.
    const visiblePath = centralPath.filter(
      (point) =>
        point.latitudeDeg >= bounds.south - 12 &&
        point.latitudeDeg <= bounds.north + 12,
    );
    const pathData = visiblePath.length
      ? `M ${visiblePath
          .map(
            (point) =>
              `${projection.x(point.longitudeDeg).toFixed(1)},${projection.y(point.latitudeDeg).toFixed(1)}`,
          )
          .join(" L ")}`
      : "";

    // The band of central eclipse, drawn from its measured limits rather than
    // implied by a coverage contour. The two are different things: the 90%
    // contour is where nine tenths of the Sun is covered, and the band is where
    // the Moon covers it completely. Conflating them is what a stroked line of
    // arbitrary width would have done.
    const banded = visiblePath.filter((point) => point.limits !== null);
    const bandData =
      banded.length > 1
        ? `M ${banded
            .map(
              (point) =>
                `${projection.x(point.limits!.northLongitudeDeg).toFixed(1)},${projection
                  .y(point.limits!.northLatitudeDeg)
                  .toFixed(1)}`,
            )
            .join(" L ")} L ${[...banded]
            .reverse()
            .map(
              (point) =>
                `${projection.x(point.limits!.southLongitudeDeg).toFixed(1)},${projection
                  .y(point.limits!.southLatitudeDeg)
                  .toFixed(1)}`,
            )
            .join(" L ")} Z`
        : "";

    return (
      <>
        <g filter="url(#tk-geomap-smooth)">
          {cells.map((cell) => {
            const color = bandColor(cell.obscuration);
            if (!color) return null;
            return (
              <rect
                key={`${cell.latitudeDeg}:${cell.longitudeDeg}`}
                x={projection.x(cell.longitudeDeg) - cellWidth / 2}
                y={projection.y(cell.latitudeDeg) - cellHeight / 2}
                width={cellWidth + 1}
                height={cellHeight + 1}
                fill={color}
              />
            );
          })}
        </g>
        {bandData ? <path d={bandData} className="tk-eclipse-band" /> : null}
        {pathData ? (
          <>
            <path d={pathData} className="tk-eclipse-track-glow" />
            <path d={pathData} className="tk-eclipse-track" />
          </>
        ) : null}

        {/* Where to go, drawn where it is.
        
            A candidate is a place, so it belongs on the map beside the reader's
            own marker rather than only in a list underneath it — the whole
            point of the question is the spatial relationship between where you
            are and where the eclipse is. */}
        {destinations?.candidates.map((candidate) => (
          <g
            key={`${candidate.kind}:${candidate.latitudeDeg.toFixed(2)}`}
            className="tk-dest-marker"
            transform={`translate(${projection.x(candidate.longitudeDeg)} ${projection.y(
              candidate.latitudeDeg,
            )})`}
          >
            <circle r={7} className="tk-dest-halo" />
            <circle r={3} className="tk-dest-dot" />
            <text x={10} y={4} className="tk-dest-label">
              {DESTINATION_LABEL[candidate.kind] ?? candidate.kind}
            </text>
          </g>
        ))}
      </>
    );
  };

  const centralLabel = event.kind === "annular" ? "Annular centre line" : "Totality centre line";
  const bandLabel = event.kind === "annular" ? "Annular band" : "Totality band";
  const widest = centralPath.reduce(
    (best, point) => Math.max(best, point.limits?.widthKm ?? 0),
    0,
  );
  const legend = [
    ...(centralPath.length
      ? [
          { swatch: "var(--tk-eclipse-track)", label: centralLabel },
          ...(widest > 0
            ? [{ swatch: "var(--tk-eclipse-band)", label: `${bandLabel} (${Math.round(widest)} km)` }]
            : []),
        ]
      : []),
    ...SOLAR_BANDS.map((band) => ({ swatch: band.color, label: band.label })),
  ];

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: clock.timeZone ?? "UTC",
  }).format(new Date(event.peakUtc));

  return (
    <div className="tk-viz-panel tk-eclipsemap">
      <TrackerGeoMap
        bounds={bounds}
        marker={observer}
        legend={legend}
        title="Eclipse path and coverage"
        timing={
          local.peakUtc
            ? `${dateLabel} · maximum here ${formatClockTime(local.peakUtc, clock)}`
            : `${dateLabel} · not visible from here`
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
            <div>
              <dt>From {observer.label}</dt>
              <dd>
                {local.obscurationFraction > 0
                  ? `${Math.round(local.obscurationFraction * 100)}% of the Sun covered, maximum ${local.peakUtc ? formatClockTime(local.peakUtc, clock) : "unknown"}.`
                  : "This eclipse is not visible from here."}
              </dd>
            </div>
            {/* Where to go, in words as well as on the drawing. This is the
                answer to "where should I go", and a reader who cannot see the
                map has to be able to reach it. */}
            {destinations?.candidates.map((candidate) => (
              <div key={`${candidate.kind}:${candidate.latitudeDeg.toFixed(2)}`}>
                <dt>{DESTINATION_LABEL[candidate.kind]}</dt>
                <dd>
                  {candidate.summary}{" "}
                  <span className="tk-dest-note">
                    {Math.round(candidate.distanceKm)} km in a straight line — not a
                    driving distance.
                  </span>
                </dd>
              </div>
            ))}
            {inspected && inspection?.point ? (
              <div>
                <dt>
                  From {inspection.point.latitudeDeg.toFixed(1)}°,{" "}
                  {inspection.point.longitudeDeg.toFixed(1)}°
                </dt>
                <dd>
                  {inspected.obscurationFraction <= 0 || !inspected.visibleFromHere
                    ? inspected.obscurationFraction > 0
                      ? "The eclipse happens below the horizon there, so it cannot be seen from that point."
                      : "The eclipse is not visible from there."
                    : `${Math.round(inspected.obscurationFraction * 100)}% covered${
                        inspected.kind === "total"
                          ? ` — total${inspected.centralDurationSeconds ? ` for ${formatDuration(inspected.centralDurationSeconds)}` : ""}`
                          : inspected.kind === "annular"
                            ? ` — annular${inspected.centralDurationSeconds ? ` for ${formatDuration(inspected.centralDurationSeconds)}` : ""}`
                            : ""
                      }, maximum ${inspected.peakUtc ? formatClockTime(inspected.peakUtc, clock) : "unknown"}.${
                        inspected.distanceToCentralLineKm !== null && inspected.kind === "partial"
                          ? ` The centre line is about ${Math.round(inspected.distanceToCentralLineKm)} km away.`
                          : ""
                      } A certified solar filter is required there too.`}
                </dd>
              </div>
            ) : null}
          </dl>
        }
        ariaLabel={
          centralPath.length
            ? `Map of the ${event.kind} solar eclipse on ${dateLabel}, showing the centre line and the bands where the Sun is partly covered, with ${observer.label} marked.`
            : `Map of the partial solar eclipse on ${dateLabel}, showing how much of the Sun is covered across the region, with ${observer.label} marked.`
        }
      >
        {field}
      </TrackerGeoMap>

      <div
        className={`tk-viz-verdict is-${
          !local.visibleFromHere
            ? "unknown"
            : local.kind === "total" || local.kind === "annular"
              ? "good"
              : local.obscurationFraction >= 0.5
                ? "fair"
                : "poor"
        }`}
      >
        <p className="tk-viz-verdict-head">
          {!local.visibleFromHere
            ? "Not visible from here"
            : local.kind === "total"
              ? "You are inside the path of totality"
              : local.kind === "annular"
                ? "You are inside the annular path"
                : `${Math.round(local.obscurationFraction * 100)}% covered from here`}
        </p>
        <p className="tk-viz-verdict-detail">
          {local.distanceToCentralLineKm !== null && local.kind === "partial"
            ? `The centre line passes about ${Math.round(local.distanceToCentralLineKm / 10) * 10} km away. `
            : ""}
          {local.centralDurationSeconds !== null
            ? `${formatDuration(local.centralDurationSeconds)} of ${
                local.kind === "annular" ? "annularity" : "totality"
              } here. `
            : ""}
          The centre line is the shadow axis; coverage is sampled every{" "}
          {coverage.stepDeg}°.
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- lunar */

function LunarEclipseMap({
  title,
  maximumUtc,
  visibility,
  local,
  bounds,
  observer,
  clock,
  onOpenFullMap,
  observerAltitudeDeg,
  inspection = null,
  interactive = false,
  timing,
}: LunarProps) {
  /**
   * The picked point's own circumstances, computed the same way the reader's
   * are — same contact times, same altitude function. A second model here would
   * be a way for the map and the answer to disagree.
   */
  const inspected = inspection?.point
    ? lunarLocalVisibility(timing, inspection.point.latitudeDeg, inspection.point.longitudeDeg)
    : null;
  /**
   * Fill by band, outlined by the real horizon curves.
   *
   * The fill is a raster because a filled region has to be rasterised
   * somewhere, but the *boundary* is drawn from `capOutline` — the actual locus
   * where the Moon's computed altitude reaches zero. That is the difference
   * between this and what it replaces: the edges are the geometry rather than
   * the sampling grid, so they curve the way the terminator curves instead of
   * stepping in five-degree blocks.
   */
  const field = (projection: MapProjection) => {
    const cellWidth = Math.abs(projection.x(visibility.stepDeg) - projection.x(0));
    const cellHeight = Math.abs(projection.y(visibility.stepDeg) - projection.y(0));
    const fills: Record<string, string | null> = {
      all: "rgba(196, 152, 120, 0.62)",
      moonrise: "rgba(126, 138, 196, 0.46)",
      moonset: "rgba(158, 122, 176, 0.46)",
      none: null,
    };

    // A cap's edge crosses the antimeridian for most eclipses, so the outline is
    // broken into runs rather than drawn as one polyline that would otherwise
    // sweep a false horizontal line back across the whole map.
    const outlinePath = (points: { latitudeDeg: number; longitudeDeg: number }[]) => {
      const runs: string[] = [];
      let current: string[] = [];
      let previousLon: number | null = null;
      for (const point of points) {
        if (previousLon !== null && Math.abs(point.longitudeDeg - previousLon) > 180) {
          if (current.length > 1) runs.push(current.join(" "));
          current = [];
        }
        current.push(
          `${current.length === 0 ? "M" : "L"}${projection.x(point.longitudeDeg).toFixed(1)} ${projection.y(point.latitudeDeg).toFixed(1)}`,
        );
        previousLon = point.longitudeDeg;
      }
      if (current.length > 1) runs.push(current.join(" "));
      return runs.join(" ");
    };

    return (
      <g>
        <g filter="url(#tk-geomap-smooth)">
          {visibility.cells.map((cell) => {
            const fill = fills[cell.band];
            if (!fill) return null;
            return (
              <rect
                key={`${cell.latitudeDeg}:${cell.longitudeDeg}`}
                x={projection.x(cell.longitudeDeg) - cellWidth / 2}
                y={projection.y(cell.latitudeDeg) - cellHeight / 2}
                width={cellWidth + 1}
                height={cellHeight + 1}
                fill={fill}
              />
            );
          })}
        </g>
        {/* The horizon at first and last contact: the two curves that decide
            whether a place sees all of the eclipse, some, or none. */}
        <path
          className="tk-lunar-limit"
          d={outlinePath(capOutline(visibility.keyCaps.start, 240))}
          fill="none"
          stroke="rgba(238, 224, 255, 0.5)"
          strokeWidth={0.9}
          strokeDasharray="4 3"
        />
        <path
          className="tk-lunar-limit"
          d={outlinePath(capOutline(visibility.keyCaps.end, 240))}
          fill="none"
          stroke="rgba(238, 224, 255, 0.5)"
          strokeWidth={0.9}
          strokeDasharray="4 3"
        />
        {/* Where the Moon is overhead at maximum — the centre of the region,
            and the one point on Earth with the eclipse at the zenith. */}
        <circle
          className="tk-lunar-sublunar"
          cx={projection.x(visibility.keyCaps.maximum.longitudeDeg)}
          cy={projection.y(visibility.keyCaps.maximum.latitudeDeg)}
          r={3}
          fill="none"
          stroke="rgba(255, 226, 190, 0.85)"
          strokeWidth={1.1}
        />
      </g>
    );
  };

  const bandSentence =
    local.band === "all"
      ? "The whole of it is above your horizon."
      : local.band === "moonrise"
        ? `The Moon rises during the eclipse here, at ${local.horizonCrossingUtc ? formatClockTime(local.horizonCrossingUtc, clock) : "moonrise"} — the earlier phases happen below your horizon.`
        : local.band === "moonset"
          ? `The Moon sets during the eclipse here, at ${local.horizonCrossingUtc ? formatClockTime(local.horizonCrossingUtc, clock) : "moonset"} — the later phases happen below your horizon.`
          : "The Moon is below your horizon throughout, so none of it is visible from here.";

  return (
    <div className="tk-viz-panel tk-eclipsemap">
      <TrackerGeoMap
        bounds={bounds}
        marker={observer}
        legend={[
          { swatch: "rgba(196, 152, 120, 0.8)", label: "All of it visible" },
          { swatch: "rgba(126, 138, 196, 0.7)", label: "Moon rises during" },
          { swatch: "rgba(158, 122, 176, 0.7)", label: "Moon sets during" },
        ]}
        title="Where the eclipse can be seen"
        timing={`Maximum ${formatClockTime(maximumUtc, clock)} · ${title}`}
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
            <div>
              <dt>From {observer.label}</dt>
              <dd>{bandSentence}</dd>
            </div>
            {inspected && inspection?.point ? (
              <div>
                <dt>
                  From {inspection.point.latitudeDeg.toFixed(1)}°,{" "}
                  {inspection.point.longitudeDeg.toFixed(1)}°
                </dt>
                <dd>
                  {inspected.band === "all"
                    ? `The whole eclipse is above the horizon there. The Moon stands ${Math.round(inspected.altitudeAtMaximumDeg)}° up at maximum.`
                    : inspected.band === "none"
                      ? "The Moon is below the horizon there throughout, so none of it is visible."
                      : `${inspected.band === "moonrise" ? "The Moon rises" : "The Moon sets"} during the eclipse there, at ${inspected.horizonCrossingUtc ? formatClockTime(inspected.horizonCrossingUtc, clock) : "the horizon"} — about ${Math.round(inspected.visibleFraction * 100)}% of it is visible.`}
                </dd>
              </div>
            ) : null}
          </dl>
        }
        ariaLabel={
          `Map of where on Earth the Moon is above the horizon during this eclipse. ` +
          `Shaded regions distinguish seeing all of it from places where the Moon rises or sets part-way through. ` +
          `${observer.label} is marked. ${bandSentence}`
        }
      >
        {field}
      </TrackerGeoMap>

      <div
        className={`tk-viz-verdict is-${
          local.band === "all" && observerAltitudeDeg > 15
            ? "good"
            : local.band === "none"
              ? "poor"
              : "fair"
        }`}
      >
        <p className="tk-viz-verdict-head">
          {local.band === "none"
            ? "Not visible from here"
            : observerAltitudeDeg > 0
              ? `The Moon is ${Math.round(observerAltitudeDeg)}° up from here at maximum`
              : "The Moon is below your horizon at maximum"}
        </p>
        <p className="tk-viz-verdict-detail">
          {local.band === "all"
            ? "A lunar eclipse is the same event everywhere the Moon is up, so nowhere sees more of it than you will."
            : local.band === "none"
              ? "The Moon is on the far side of the Earth throughout."
              : "The shaded regions show who sees all of it and who catches only part."}
        </p>
      </div>
    </div>
  );
}
