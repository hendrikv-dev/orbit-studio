import { useMemo } from "react";
import type {
  CentralPathPoint,
  CoverageField,
  LocalSolarCircumstances,
  SolarEclipseEvent,
} from "../../../data/tracker/solarEclipse";
import type { LunarVisibilityField } from "../../../data/tracker/lunarEclipse";
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
  onOpenFullMap: () => void;
}

interface LunarProps {
  kind: "lunar";
  title: string;
  maximumUtc: string;
  visibility: LunarVisibilityField;
  bounds: MapBounds;
  observer: { latitudeDeg: number; longitudeDeg: number; label: string };
  clock: PlaceClock;
  onOpenFullMap: () => void;
  /** Moon altitude at maximum from the observer, which is the local answer. */
  observerAltitudeDeg: number;
}

export type TrackerEclipseMapProps = SolarProps | LunarProps;

export function TrackerEclipseMap(props: TrackerEclipseMapProps) {
  return props.kind === "solar" ? <SolarEclipseMap {...props} /> : <LunarEclipseMap {...props} />;
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
}: SolarProps) {
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
        {pathData ? (
          <>
            <path d={pathData} className="tk-eclipse-track-glow" />
            <path d={pathData} className="tk-eclipse-track" />
          </>
        ) : null}
      </>
    );
  };

  const centralLabel = event.kind === "annular" ? "Annular centre line" : "Totality centre line";
  const legend = [
    ...(centralPath.length
      ? [{ swatch: "var(--tk-eclipse-track)", label: centralLabel }]
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
        action={{ label: "Open full map", onSelect: onOpenFullMap }}
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
          Coverage sampled every {coverage.stepDeg}°; the centre line is exact.
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
  bounds,
  observer,
  clock,
  onOpenFullMap,
  observerAltitudeDeg,
}: LunarProps) {
  const field = (projection: MapProjection) => {
    const cellWidth = Math.abs(projection.x(visibility.stepDeg) - projection.x(0));
    const cellHeight = Math.abs(projection.y(visibility.stepDeg) - projection.y(0));
    return (
      <g filter="url(#tk-geomap-smooth)">
        {visibility.cells.map((cell) => {
          if (cell.visibleFraction <= 0) return null;
          const color =
            cell.visibleFraction >= 0.95
              ? "rgba(196, 152, 120, 0.66)"
              : cell.visibleFraction >= 0.5
                ? "rgba(150, 128, 168, 0.52)"
                : "rgba(96, 106, 156, 0.38)";
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
    );
  };

  return (
    <div className="tk-viz-panel tk-eclipsemap">
      <TrackerGeoMap
        bounds={bounds}
        marker={observer}
        legend={[
          { swatch: "rgba(196, 152, 120, 0.8)", label: "Whole eclipse" },
          { swatch: "rgba(150, 128, 168, 0.7)", label: "Part of it" },
          { swatch: "rgba(96, 106, 156, 0.55)", label: "Moon rising or setting" },
        ]}
        title="Where the eclipse can be seen"
        timing={`Maximum ${formatClockTime(maximumUtc, clock)} · ${title}`}
        action={{ label: "Open full map", onSelect: onOpenFullMap }}
        ariaLabel={`Map showing where on Earth the Moon is above the horizon during this eclipse, with ${observer.label} marked.`}
      >
        {field}
      </TrackerGeoMap>

      <div className={`tk-viz-verdict is-${observerAltitudeDeg > 15 ? "good" : observerAltitudeDeg > 0 ? "fair" : "unknown"}`}>
        <p className="tk-viz-verdict-head">
          {observerAltitudeDeg > 0
            ? `The Moon is ${Math.round(observerAltitudeDeg)}° up from here at maximum`
            : "The Moon is below your horizon at maximum"}
        </p>
        <p className="tk-viz-verdict-detail">
          A lunar eclipse has no track — it is the same event everywhere the Moon
          is up, which is what this shaded region is.
        </p>
      </div>
    </div>
  );
}
